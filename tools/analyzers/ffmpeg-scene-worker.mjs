#!/usr/bin/env node
import { spawn } from "node:child_process";

const PROTOCOL_VERSION = "1.0.0";
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_LOG_BYTES = 8 * 1024 * 1024;
let activeChild;

function emit(requestId, value) {
  process.stdout.write(
    `${JSON.stringify({ schemaVersion: PROTOCOL_VERSION, requestId, ...value })}\n`,
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
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new Error("FFmpeg emitted an invalid scene timestamp");
  return Math.round(seconds * 1_000);
}

function assetDurationMs(request) {
  const duration = request.asset?.duration;
  if (duration === undefined)
    throw new Error("Scene detection requires a probed asset duration");
  return milliseconds(
    (duration.value * duration.rate.denominator) / duration.rate.numerator,
  );
}

function validate(request) {
  if (request.schemaVersion !== PROTOCOL_VERSION || !request.requestId)
    throw new Error("Unsupported or invalid analyzer request");
  if (typeof request.asset?.path !== "string")
    throw new Error("Asset path is missing");
  const parameters = request.parameters ?? {};
  for (const key of Object.keys(parameters)) {
    if (!new Set(["threshold", "minSceneDurationMs"]).has(key))
      throw new Error(`Unsupported parameter ${key}`);
  }
  const threshold = parameters.threshold ?? 0.35;
  const minSceneDurationMs = parameters.minSceneDurationMs ?? 250;
  if (!Number.isFinite(threshold) || threshold < 0.01 || threshold > 0.99)
    throw new Error("threshold must be from 0.01 through 0.99");
  if (
    !Number.isInteger(minSceneDurationMs) ||
    minSceneDurationMs < 0 ||
    minSceneDurationMs > 3_600_000
  ) {
    throw new Error(
      "minSceneDurationMs must be an integer from 0 through 3600000",
    );
  }
  return { threshold, minSceneDurationMs };
}

function range(startMs, endMs) {
  return {
    start: { value: startMs, rate: { numerator: 1_000, denominator: 1 } },
    duration: {
      value: endMs - startMs,
      rate: { numerator: 1_000, denominator: 1 },
    },
  };
}

async function analyze(request) {
  const parameters = validate(request);
  const durationMs = assetDurationMs(request);
  if (durationMs <= 0) throw new Error("Asset duration must be positive");
  const command = commandFor(request);
  emit(request.requestId, {
    type: "progress",
    progress: 0.05,
    message: "Scanning video for scene boundaries",
  });
  const stderr = await new Promise((resolve, reject) => {
    const child = spawn(
      command.executable,
      [
        ...command.prefix,
        "-nostdin",
        "-hide_banner",
        "-threads",
        "1",
        "-filter_threads",
        "1",
        "-i",
        request.asset.path,
        "-an",
        "-vf",
        `select=gt(scene\\,${String(parameters.threshold)}),showinfo`,
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
        reject(new Error("FFmpeg scene log exceeded 8 MiB"));
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

  const detected = [];
  for (const line of stderr.split(/\r?\n/u)) {
    if (!line.includes("showinfo")) continue;
    const match = /\bpts_time:\s*([-+\d.eE]+)/u.exec(line);
    if (match === null) continue;
    const timestamp = milliseconds(Number(match[1]));
    if (timestamp > 0 && timestamp < durationMs) detected.push(timestamp);
  }
  const boundaries = [0];
  for (const timestamp of [...new Set(detected)].sort((a, b) => a - b)) {
    if (timestamp - boundaries.at(-1) >= parameters.minSceneDurationMs)
      boundaries.push(timestamp);
  }
  if (
    boundaries.length > 1 &&
    durationMs - boundaries.at(-1) < parameters.minSceneDurationMs
  ) {
    boundaries.pop();
  }
  boundaries.push(durationMs);
  const segments = boundaries.slice(0, -1).map((startMs, index) => ({
    range: range(startMs, boundaries[index + 1]),
    labels: ["scene", "shot"],
    confidence: 1,
    metadata: {
      index,
      threshold: parameters.threshold,
      boundaryStartMs: startMs,
    },
  }));
  emit(request.requestId, {
    type: "result",
    outputType: "scenes",
    segments,
    metadata: {
      engine: "ffmpeg.select.scene+showinfo",
      threshold: parameters.threshold,
      minSceneDurationMs: parameters.minSceneDurationMs,
      detectedBoundaryCount: boundaries.length - 2,
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
      error instanceof Error ? error.message : "Scene analyzer failed";
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
