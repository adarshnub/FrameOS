#!/usr/bin/env node
import { spawn } from "node:child_process";

const PROTOCOL_VERSION = "1.0.0";
const SAMPLE_RATE = 8_000;
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_LOG_BYTES = 8 * 1024 * 1024;
const MAX_ENERGY_WINDOWS = 2_000_000;
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

function validate(request) {
  if (request.schemaVersion !== PROTOCOL_VERSION || !request.requestId)
    throw new Error("Unsupported or invalid analyzer request");
  if (typeof request.asset?.path !== "string")
    throw new Error("Asset path is missing");
  const parameters = request.parameters ?? {};
  for (const key of Object.keys(parameters)) {
    if (!new Set(["sensitivity", "minIntervalMs", "windowMs"]).has(key))
      throw new Error(`Unsupported parameter ${key}`);
  }
  const sensitivity = parameters.sensitivity ?? 0.35;
  const minIntervalMs = parameters.minIntervalMs ?? 250;
  const windowMs = parameters.windowMs ?? 50;
  if (!Number.isFinite(sensitivity) || sensitivity < 0.05 || sensitivity > 0.95)
    throw new Error("sensitivity must be from 0.05 through 0.95");
  if (
    !Number.isInteger(minIntervalMs) ||
    minIntervalMs < 50 ||
    minIntervalMs > 10_000
  ) {
    throw new Error("minIntervalMs must be an integer from 50 through 10000");
  }
  if (!Number.isInteger(windowMs) || windowMs < 20 || windowMs > 250)
    throw new Error("windowMs must be an integer from 20 through 250");
  return { sensitivity, minIntervalMs, windowMs };
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function detectOnsets(energies, parameters) {
  if (energies.length < 3) return [];
  const flux = energies.map((energy, index) =>
    index === 0 ? 0 : Math.max(0, energy - energies[index - 1]),
  );
  let maximum = 0;
  for (const strength of flux) maximum = Math.max(maximum, strength);
  if (!Number.isFinite(maximum) || maximum <= Number.EPSILON) return [];
  const floor = median(flux);
  const threshold = floor + (maximum - floor) * parameters.sensitivity;
  const candidates = [];
  for (let index = 1; index < flux.length - 1; index += 1) {
    const strength = flux[index];
    if (
      strength >= threshold &&
      strength >= flux[index - 1] &&
      strength >= flux[index + 1]
    ) {
      candidates.push({ index, strength });
    }
  }
  const selected = [];
  for (const candidate of candidates) {
    const previous = selected.at(-1);
    if (
      previous !== undefined &&
      (candidate.index - previous.index) * parameters.windowMs <
        parameters.minIntervalMs
    ) {
      if (candidate.strength > previous.strength)
        selected[selected.length - 1] = candidate;
      continue;
    }
    selected.push(candidate);
  }
  return selected.map((candidate) => ({
    atMs: candidate.index * parameters.windowMs,
    strength: candidate.strength,
    confidence: Math.min(1, candidate.strength / maximum),
  }));
}

function range(startMs, durationMs) {
  return {
    start: { value: startMs, rate: { numerator: 1_000, denominator: 1 } },
    duration: {
      value: durationMs,
      rate: { numerator: 1_000, denominator: 1 },
    },
  };
}

function estimateBpm(onsets) {
  if (onsets.length < 2) return undefined;
  const intervals = onsets
    .slice(1)
    .map((onset, index) => onset.atMs - onsets[index].atMs)
    .filter((interval) => interval > 0);
  if (intervals.length === 0) return undefined;
  return Number((60_000 / median(intervals)).toFixed(3));
}

async function extractEnergies(request, parameters) {
  const command = commandFor(request);
  const samplesPerWindow = Math.max(
    1,
    Math.round((SAMPLE_RATE * parameters.windowMs) / 1_000),
  );
  return new Promise((resolve, reject) => {
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
        "-vn",
        "-ac",
        "1",
        "-ar",
        String(SAMPLE_RATE),
        "-acodec",
        "pcm_f32le",
        "-f",
        "f32le",
        "pipe:1",
      ],
      {
        env: process.env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    activeChild = child;
    const energies = [];
    let carry = Buffer.alloc(0);
    let sumSquares = 0;
    let sampleCount = 0;
    let logBytes = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      const bytes = carry.length === 0 ? chunk : Buffer.concat([carry, chunk]);
      const completeBytes = bytes.length - (bytes.length % 4);
      for (let offset = 0; offset < completeBytes; offset += 4) {
        const sample = bytes.readFloatLE(offset);
        if (!Number.isFinite(sample)) {
          fail(new Error("FFmpeg emitted a non-finite PCM sample"));
          return;
        }
        sumSquares += sample * sample;
        sampleCount += 1;
        if (sampleCount === samplesPerWindow) {
          energies.push(Math.sqrt(sumSquares / sampleCount));
          if (energies.length > MAX_ENERGY_WINDOWS) {
            fail(new Error("Audio exceeded the beat analyzer window limit"));
            return;
          }
          sumSquares = 0;
          sampleCount = 0;
        }
      }
      carry = bytes.subarray(completeBytes);
    });
    child.stderr.on("data", (chunk) => {
      logBytes += Buffer.byteLength(chunk);
      if (logBytes > MAX_LOG_BYTES)
        fail(new Error("FFmpeg beat-analysis log exceeded 8 MiB"));
    });
    child.once("error", fail);
    child.once("close", (code) => {
      if (activeChild === child) activeChild = undefined;
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error(`FFmpeg exited with code ${String(code)}`));
        return;
      }
      if (carry.length !== 0) {
        reject(new Error("FFmpeg emitted a truncated PCM sample"));
        return;
      }
      if (sampleCount > 0) energies.push(Math.sqrt(sumSquares / sampleCount));
      resolve(energies);
    });
  });
}

async function analyze(request) {
  const parameters = validate(request);
  emit(request.requestId, {
    type: "progress",
    progress: 0.05,
    message: "Extracting deterministic mono PCM for onset detection",
  });
  const energies = await extractEnergies(request, parameters);
  const onsets = detectOnsets(energies, parameters);
  const bpm = estimateBpm(onsets);
  emit(request.requestId, {
    type: "result",
    outputType: "beats",
    segments: onsets.map((onset, index) => ({
      range: range(onset.atMs, parameters.windowMs),
      labels: ["beat", "onset"],
      confidence: onset.confidence,
      metadata: {
        index,
        onsetStrength: Number(onset.strength.toFixed(9)),
        sampleRate: SAMPLE_RATE,
        windowMs: parameters.windowMs,
      },
    })),
    metadata: {
      engine: "frameos.energy-flux-onset-v1",
      pcmDecoder: "ffmpeg.pcm_f32le",
      sampleRate: SAMPLE_RATE,
      windowMs: parameters.windowMs,
      minIntervalMs: parameters.minIntervalMs,
      sensitivity: parameters.sensitivity,
      ...(bpm === undefined ? {} : { estimatedBpm: bpm }),
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
      error instanceof Error ? error.message : "Beat analyzer failed";
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
