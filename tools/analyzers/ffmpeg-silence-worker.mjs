#!/usr/bin/env node
import { spawn } from "node:child_process";

const PROTOCOL_VERSION = "1.0.0";
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_LOG_BYTES = 8 * 1024 * 1024;
let activeChild;

function emit(requestId, value) {
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: PROTOCOL_VERSION,
      requestId,
      ...value,
    })}\n`,
  );
}

function resource(request, role) {
  const match = request.resources?.find((candidate) => candidate.role === role);
  if (match === undefined)
    throw new Error(`Required ${role} resource was not provided`);
  return match.path;
}

function commandFor(request) {
  const executable = resource(request, "ffmpeg");
  const entrypoint = request.resources?.find(
    (candidate) => candidate.role === "ffmpeg-entrypoint",
  )?.path;
  return { executable, prefix: entrypoint === undefined ? [] : [entrypoint] };
}

function milliseconds(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error("FFmpeg emitted an invalid silence timestamp");
  }
  return Math.round(seconds * 1_000);
}

function frameosRange(startSeconds, endSeconds) {
  const start = milliseconds(startSeconds);
  const end = milliseconds(endSeconds);
  if (end < start)
    throw new Error("FFmpeg emitted a negative silence duration");
  return {
    start: { value: start, rate: { numerator: 1_000, denominator: 1 } },
    duration: {
      value: end - start,
      rate: { numerator: 1_000, denominator: 1 },
    },
  };
}

function validate(request) {
  if (request.schemaVersion !== PROTOCOL_VERSION || !request.requestId) {
    throw new Error("Unsupported or invalid analyzer request");
  }
  if (typeof request.asset?.path !== "string")
    throw new Error("Asset path is missing");
  const parameters = request.parameters ?? {};
  for (const key of Object.keys(parameters)) {
    if (!new Set(["noiseDb", "minDurationMs"]).has(key)) {
      throw new Error(`Unsupported parameter ${key}`);
    }
  }
  const noiseDb = parameters.noiseDb ?? -35;
  const minDurationMs = parameters.minDurationMs ?? 500;
  if (!Number.isFinite(noiseDb) || noiseDb < -120 || noiseDb > 0) {
    throw new Error("noiseDb must be from -120 through 0");
  }
  if (
    !Number.isInteger(minDurationMs) ||
    minDurationMs < 10 ||
    minDurationMs > 86_400_000
  ) {
    throw new Error(
      "minDurationMs must be an integer from 10 through 86400000",
    );
  }
  return { noiseDb, minDurationMs };
}

function assetEndSeconds(request) {
  const duration = request.asset?.duration;
  if (duration === undefined) return undefined;
  return (duration.value * duration.rate.denominator) / duration.rate.numerator;
}

async function analyze(request) {
  const parameters = validate(request);
  const command = commandFor(request);
  emit(request.requestId, {
    type: "progress",
    progress: 0.05,
    message: "Scanning audio for silence",
  });
  const stderr = await new Promise((resolve, reject) => {
    const child = spawn(
      command.executable,
      [
        ...command.prefix,
        "-nostdin",
        "-hide_banner",
        "-i",
        request.asset.path,
        "-vn",
        "-af",
        `silencedetect=n=${String(parameters.noiseDb)}dB:d=${String(parameters.minDurationMs / 1_000)}`,
        "-f",
        "null",
        "-",
      ],
      {
        env: process.env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    activeChild = child;
    let log = "";
    let bytes = 0;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_LOG_BYTES) {
        child.kill();
        reject(new Error("FFmpeg silence log exceeded 8 MiB"));
        return;
      }
      log += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (activeChild === child) activeChild = undefined;
      if (code === 0) resolve(log);
      else reject(new Error(`FFmpeg exited with code ${String(code)}`));
    });
  });

  const starts = [];
  const segments = [];
  for (const line of stderr.split(/\r?\n/u)) {
    const startMatch = /silence_start(?:\.\d+)?:\s*([-+\d.eE]+)/u.exec(line);
    if (startMatch !== null) {
      starts.push(Number(startMatch[1]));
      continue;
    }
    const endMatch = /silence_end(?:\.\d+)?:\s*([-+\d.eE]+)/u.exec(line);
    if (endMatch !== null) {
      const start = starts.shift();
      if (start === undefined)
        throw new Error("FFmpeg emitted silence_end without silence_start");
      const end = Number(endMatch[1]);
      segments.push({
        range: frameosRange(start, end),
        labels: ["silence"],
        confidence: 1,
        metadata: {
          noiseDb: parameters.noiseDb,
          measuredDurationMs: milliseconds(end - start),
        },
      });
    }
  }
  const end = assetEndSeconds(request);
  if (starts.length > 0 && end === undefined) {
    throw new Error("Open-ended silence requires an asset duration");
  }
  for (const start of starts) {
    segments.push({
      range: frameosRange(start, end),
      labels: ["silence"],
      confidence: 1,
      metadata: {
        noiseDb: parameters.noiseDb,
        measuredDurationMs: milliseconds(end - start),
        reachedAssetEnd: true,
      },
    });
  }
  emit(request.requestId, {
    type: "result",
    outputType: "silence",
    segments,
    metadata: {
      engine: "ffmpeg.silencedetect",
      noiseDb: parameters.noiseDb,
      minDurationMs: parameters.minDurationMs,
    },
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    activeChild?.kill();
    process.exitCode = 1;
  });
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  if (Buffer.byteLength(input) > MAX_INPUT_BYTES) {
    process.stderr.write("Analyzer request exceeded 4 MiB\n");
    process.exitCode = 1;
    process.stdin.destroy();
  }
});
process.stdin.on("end", async () => {
  let request;
  try {
    request = JSON.parse(input.trim());
    await analyze(request);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Silence analyzer failed";
    if (request?.requestId) {
      emit(request.requestId, {
        type: "error",
        code: "PLUGIN_FAILURE",
        message,
      });
    } else {
      process.stderr.write(`${message}\n`);
    }
    process.exitCode = 1;
  }
});
