#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

const PROTOCOL_VERSION = "1.0.0";
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_CHILD_OUTPUT_BYTES = 64 * 1024;
const DIRECT_AUDIO_EXTENSIONS = new Set([".flac", ".mp3", ".ogg", ".wav"]);
let activeChild;

function event(requestId, value) {
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: PROTOCOL_VERSION,
      requestId,
      ...value,
    })}\n`,
  );
}

function fail(requestId, message, code = "PLUGIN_FAILURE") {
  if (requestId) event(requestId, { type: "error", code, message });
  else process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function resource(request, role, required = true) {
  const match = request.resources?.find((candidate) => candidate.role === role);
  if (match === undefined && required) {
    throw new Error(`Required ${role} resource was not provided`);
  }
  return match?.path;
}

function validateParameters(parameters) {
  const allowed = new Set([
    "language",
    "translate",
    "threads",
    "noGpu",
    "prompt",
    "maxLength",
    "temperature",
    "splitOnWord",
  ]);
  for (const key of Object.keys(parameters)) {
    if (!allowed.has(key)) throw new Error(`Unsupported parameter ${key}`);
  }
  if (
    parameters.language !== undefined &&
    (typeof parameters.language !== "string" ||
      !/^(auto|[a-z]{2,3}(?:-[a-z0-9]+)?)$/iu.test(parameters.language))
  ) {
    throw new Error("language must be auto or a language code");
  }
  for (const key of ["translate", "noGpu", "splitOnWord"]) {
    if (parameters[key] !== undefined && typeof parameters[key] !== "boolean") {
      throw new Error(`${key} must be a boolean`);
    }
  }
  if (
    parameters.threads !== undefined &&
    (!Number.isInteger(parameters.threads) ||
      parameters.threads < 1 ||
      parameters.threads > 256)
  ) {
    throw new Error("threads must be an integer from 1 to 256");
  }
  if (
    parameters.maxLength !== undefined &&
    (!Number.isInteger(parameters.maxLength) ||
      parameters.maxLength < 0 ||
      parameters.maxLength > 100_000)
  ) {
    throw new Error("maxLength must be an integer from 0 to 100000");
  }
  if (
    parameters.temperature !== undefined &&
    (typeof parameters.temperature !== "number" ||
      !Number.isFinite(parameters.temperature) ||
      parameters.temperature < 0 ||
      parameters.temperature > 1)
  ) {
    throw new Error("temperature must be a number from 0 to 1");
  }
  if (
    parameters.prompt !== undefined &&
    (typeof parameters.prompt !== "string" || parameters.prompt.length > 16_384)
  ) {
    throw new Error("prompt must be a string of at most 16384 characters");
  }
}

function commandFor(request, role) {
  const executable = resource(request, role);
  const entrypoint = resource(request, `${role}-entrypoint`, false);
  return {
    executable,
    prefixArguments: entrypoint === undefined ? [] : [entrypoint],
  };
}

function runCommand(command, arguments_, onStderr) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      command.executable,
      [...command.prefixArguments, ...arguments_],
      {
        env: process.env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    activeChild = child;
    let outputBytes = 0;
    let stderr = "";
    const consume = (chunk, stderrStream) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_CHILD_OUTPUT_BYTES) {
        child.kill();
        reject(new Error("Analyzer dependency output exceeded 64 KiB"));
        return;
      }
      if (stderrStream) {
        const text = chunk.toString("utf8");
        stderr += text;
        onStderr?.(text);
      }
    };
    child.stdout.on("data", (chunk) => consume(chunk, false));
    child.stderr.on("data", (chunk) => consume(chunk, true));
    child.once("error", reject);
    child.once("close", (code) => {
      if (activeChild === child) activeChild = undefined;
      if (code === 0) resolve();
      else {
        const detail = stderr.trim().slice(-2_048);
        reject(
          new Error(
            `${roleLabel(command.executable)} exited with code ${String(code)}${detail ? `: ${detail}` : ""}`,
          ),
        );
      }
    });
  });
}

function roleLabel(path) {
  return path.toLowerCase().includes("ffmpeg") ? "FFmpeg" : "whisper.cpp";
}

function range(from, to) {
  return {
    start: { value: from, rate: { numerator: 1_000, denominator: 1 } },
    duration: {
      value: Math.max(0, to - from),
      rate: { numerator: 1_000, denominator: 1 },
    },
  };
}

function probability(tokens) {
  const values = (tokens ?? [])
    .map((token) => token.p)
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  if (values.length === 0) return undefined;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round(average * 1_000_000) / 1_000_000;
}

function tokenMetadata(tokens) {
  return (tokens ?? [])
    .filter(
      (token) =>
        typeof token.text === "string" &&
        Number.isSafeInteger(token.offsets?.from) &&
        Number.isSafeInteger(token.offsets?.to) &&
        token.offsets.from >= 0 &&
        token.offsets.to >= token.offsets.from,
    )
    .map((token) => ({
      text: token.text,
      range: range(token.offsets.from, token.offsets.to),
      ...(Number.isFinite(token.p) && token.p >= 0 && token.p <= 1
        ? { confidence: token.p }
        : {}),
    }));
}

function parseResult(document) {
  if (!Array.isArray(document?.transcription)) {
    throw new Error("whisper.cpp JSON did not contain a transcription array");
  }
  return document.transcription.map((segment) => {
    const from = segment?.offsets?.from;
    const to = segment?.offsets?.to;
    if (
      typeof segment?.text !== "string" ||
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from < 0 ||
      to < from
    ) {
      throw new Error("whisper.cpp returned an invalid transcription segment");
    }
    const confidence = probability(segment.tokens);
    const words = tokenMetadata(segment.tokens);
    return {
      range: range(from, to),
      text: segment.text,
      labels: ["speech"],
      ...(confidence === undefined ? {} : { confidence }),
      ...(typeof segment.speaker === "string" && segment.speaker.length > 0
        ? { speaker: segment.speaker }
        : {}),
      metadata: words.length === 0 ? {} : { words },
    };
  });
}

async function analyze(request) {
  if (request.schemaVersion !== PROTOCOL_VERSION || !request.requestId) {
    throw new Error("Unsupported or invalid analyzer request");
  }
  if (!request.modelPath) throw new Error("A hash-pinned model is required");
  validateParameters(request.parameters ?? {});
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "frameos-whisper-"));
  try {
    let inputPath = request.asset?.path;
    if (typeof inputPath !== "string") throw new Error("Asset path is missing");
    if (!DIRECT_AUDIO_EXTENSIONS.has(extname(inputPath).toLowerCase())) {
      const ffmpeg = commandFor(request, "ffmpeg");
      const converted = join(temporaryDirectory, "input.wav");
      event(request.requestId, {
        type: "progress",
        progress: 0.02,
        message: "Extracting normalized audio",
      });
      await runCommand(ffmpeg, [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        inputPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-y",
        converted,
      ]);
      inputPath = converted;
    }

    const parameters = request.parameters ?? {};
    const outputBase = join(temporaryDirectory, "transcript");
    const arguments_ = [
      "--model",
      request.modelPath,
      "--file",
      inputPath,
      "--output-json-full",
      "--output-file",
      outputBase,
      "--no-prints",
      "--print-progress",
      "--language",
      parameters.language ?? "auto",
    ];
    if (parameters.translate) arguments_.push("--translate");
    if (parameters.noGpu) arguments_.push("--no-gpu");
    if (parameters.splitOnWord) arguments_.push("--split-on-word");
    if (parameters.threads !== undefined)
      arguments_.push("--threads", String(parameters.threads));
    if (parameters.maxLength !== undefined)
      arguments_.push("--max-len", String(parameters.maxLength));
    if (parameters.temperature !== undefined)
      arguments_.push("--temperature", String(parameters.temperature));
    if (parameters.prompt !== undefined)
      arguments_.push("--prompt", parameters.prompt);

    let stderrBuffer = "";
    await runCommand(commandFor(request, "whisper-cli"), arguments_, (text) => {
      stderrBuffer += text;
      const lines = stderrBuffer.split(/\r?\n/u);
      stderrBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const match = /progress\s*=\s*(\d{1,3})%/iu.exec(line);
        if (match) {
          const progress = Math.min(100, Number(match[1]));
          event(request.requestId, {
            type: "progress",
            progress:
              Math.round((0.05 + progress * 0.009) * 1_000_000) / 1_000_000,
            message: "Transcribing audio",
          });
        }
      }
    });
    const document = JSON.parse(await readFile(`${outputBase}.json`, "utf8"));
    event(request.requestId, {
      type: "result",
      outputType: "transcript",
      segments: parseResult(document),
      metadata: {
        language: document?.result?.language,
        translated: parameters.translate === true,
        engine: "whisper.cpp",
        wordTimestamps: true,
      },
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
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
    fail(undefined, "Analyzer request exceeded 4 MiB", "RESOURCE_LIMIT");
    process.stdin.destroy();
  }
});
process.stdin.on("end", async () => {
  let request;
  try {
    request = JSON.parse(input.trim());
    await analyze(request);
  } catch (error) {
    fail(
      request?.requestId,
      error instanceof Error ? error.message : "whisper.cpp adapter failed",
      error instanceof SyntaxError ? "VALIDATION_ERROR" : "PLUGIN_FAILURE",
    );
  }
});
