#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const usage = `Usage:
  node tools/analyzers/create-ffmpeg-beat-manifest.mjs \\
    --ffmpeg <ffmpeg> --ffmpeg-version <version> --ffmpeg-license <audited-license> \\
    --output <manifest.json>`;

function argumentsMap(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name?.startsWith("--") || value === undefined) throw new Error(usage);
    values.set(name.slice(2), value);
  }
  return values;
}

function required(values, name) {
  const value = values.get(name);
  if (!value) throw new Error(`Missing --${name}\n\n${usage}`);
  return value;
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

async function main() {
  const values = argumentsMap(process.argv.slice(2));
  const ffmpegPath = await file(required(values, "ffmpeg"));
  const adapterPath = await file(
    fileURLToPath(new URL("./ffmpeg-beat-worker.mjs", import.meta.url)),
  );
  const nodePath = await file(process.execPath);
  const outputPath = resolve(required(values, "output"));
  const manifest = {
    schemaVersion: "1.0.0",
    protocolVersion: "1.0.0",
    id: "ffmpeg.beats.detect",
    version: "1.0.0",
    capabilityId: "analysis.beats.ffmpeg",
    name: "Audited FFmpeg beat and onset detection",
    description:
      "Deterministic energy-flux beat/onset markers from FFmpeg-decoded mono PCM",
    outputTypes: ["beats"],
    assetKinds: ["audio", "video"],
    deterministic: true,
    parameterSchema: {
      type: "object",
      properties: {
        sensitivity: {
          type: "number",
          minimum: 0.05,
          maximum: 0.95,
          default: 0.35,
        },
        minIntervalMs: {
          type: "integer",
          minimum: 50,
          maximum: 10000,
          default: 250,
        },
        windowMs: {
          type: "integer",
          minimum: 20,
          maximum: 250,
          default: 50,
        },
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
    resources: [
      {
        path: adapterPath,
        sha256: await sha256(adapterPath),
        role: "protocol-adapter",
        version: "1.0.0",
        license: "MIT",
      },
      {
        path: ffmpegPath,
        sha256: await sha256(ffmpegPath),
        role: "ffmpeg",
        version: required(values, "ffmpeg-version"),
        license: required(values, "ffmpeg-license"),
      },
    ],
    limits: {
      timeoutMs: 1_800_000,
      maxOutputBytes: 67_108_864,
      maxSegments: 250_000,
    },
    metadata: {
      adapter: "frameos.ffmpeg-beat-worker",
      decoder: "FFmpeg pcm_f32le",
      algorithm: "frameos.energy-flux-onset-v1",
    },
  };
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${outputPath}\n`);
  process.stdout.write(
    "Set FRAMEOS_ANALYZER_MANIFESTS to this path after license review.\n",
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
