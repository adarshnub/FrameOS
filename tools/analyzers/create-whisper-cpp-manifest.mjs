#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const usage = `Usage:
  node tools/analyzers/create-whisper-cpp-manifest.mjs \\
    --whisper <whisper-cli> --whisper-version <version> \\
    --model <ggml-model> --model-version <version> --model-license <license> \\
    --output <manifest.json> [--ffmpeg <ffmpeg> --ffmpeg-version <version> --ffmpeg-license <license>]

The generated manifest pins the current Node executable, FrameOS adapter, CLI,
model, and optional FFmpeg binary. Review every license before distribution.`;

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name?.startsWith("--") || value === undefined) throw new Error(usage);
    values.set(name.slice(2), value);
  }
  return values;
}

async function file(path) {
  const canonical = await realpath(resolve(path));
  if (!(await stat(canonical)).isFile())
    throw new Error(`${path} is not a file`);
  return canonical;
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function required(values, name) {
  const value = values.get(name);
  if (!value) throw new Error(`Missing --${name}\n\n${usage}`);
  return value;
}

async function main() {
  const values = parseArguments(process.argv.slice(2));
  const whisperPath = await file(required(values, "whisper"));
  const modelPath = await file(required(values, "model"));
  const outputPath = resolve(required(values, "output"));
  const adapterPath = await file(
    fileURLToPath(new URL("./whisper-cpp-worker.mjs", import.meta.url)),
  );
  const nodePath = await file(process.execPath);
  const resources = [
    {
      path: adapterPath,
      sha256: await sha256(adapterPath),
      role: "protocol-adapter",
      version: "1.0.0",
      license: "MIT",
    },
    {
      path: whisperPath,
      sha256: await sha256(whisperPath),
      role: "whisper-cli",
      version: required(values, "whisper-version"),
      license: "MIT",
    },
  ];
  const ffmpegValue = values.get("ffmpeg");
  if (ffmpegValue !== undefined) {
    const ffmpegPath = await file(ffmpegValue);
    resources.push({
      path: ffmpegPath,
      sha256: await sha256(ffmpegPath),
      role: "ffmpeg",
      version: required(values, "ffmpeg-version"),
      license: required(values, "ffmpeg-license"),
    });
  }
  const manifest = {
    schemaVersion: "1.0.0",
    protocolVersion: "1.0.0",
    id: "whisper.cpp.transcribe",
    version: "1.0.0",
    capabilityId: "analysis.transcription.whisper",
    name: "Local whisper.cpp transcription",
    description:
      "Segment and word-timestamped local transcription through whisper.cpp",
    outputTypes: ["transcript"],
    assetKinds: ["audio", "video"],
    deterministic: false,
    parameterSchema: {
      type: "object",
      properties: {
        language: {
          type: "string",
          pattern: "^(auto|[A-Za-z]{2,3}(?:-[A-Za-z0-9]+)?)$",
          default: "auto",
        },
        translate: { type: "boolean", default: false },
        threads: { type: "integer", minimum: 1, maximum: 256 },
        noGpu: { type: "boolean", default: false },
        prompt: { type: "string", maxLength: 16384 },
        maxLength: { type: "integer", minimum: 0, maximum: 100000 },
        temperature: { type: "number", minimum: 0, maximum: 1 },
        splitOnWord: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
    executable: {
      path: nodePath,
      sha256: await sha256(nodePath),
      version: process.version,
      license: "Node.js license bundle (distribution review required)",
      arguments: [adapterPath],
    },
    model: {
      path: modelPath,
      sha256: await sha256(modelPath),
      version: required(values, "model-version"),
      license: required(values, "model-license"),
    },
    resources,
    limits: {
      timeoutMs: 1_800_000,
      maxOutputBytes: 67_108_864,
      maxSegments: 250_000,
    },
    metadata: {
      adapter: "frameos.whisper-cpp-worker",
      upstream: "https://github.com/ggml-org/whisper.cpp",
    },
  };
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${outputPath}\n`);
  process.stdout.write(
    `Set FRAMEOS_ANALYZER_MANIFESTS to this path after completing license review.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
