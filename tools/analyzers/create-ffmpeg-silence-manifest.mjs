#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const usage = `Usage:
  node tools/analyzers/create-ffmpeg-silence-manifest.mjs \\
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
    fileURLToPath(new URL("./ffmpeg-silence-worker.mjs", import.meta.url)),
  );
  const nodePath = await file(process.execPath);
  const outputPath = resolve(required(values, "output"));
  const manifest = {
    schemaVersion: "1.0.0",
    protocolVersion: "1.0.0",
    id: "ffmpeg.silence.detect",
    version: "1.0.0",
    capabilityId: "analysis.silence.ffmpeg",
    name: "Audited FFmpeg silence detection",
    description: "Timestamped silence ranges from FFmpeg silencedetect",
    outputTypes: ["silence"],
    assetKinds: ["audio", "video"],
    deterministic: true,
    parameterSchema: {
      type: "object",
      properties: {
        noiseDb: { type: "number", minimum: -120, maximum: 0, default: -35 },
        minDurationMs: {
          type: "integer",
          minimum: 10,
          maximum: 86400000,
          default: 500,
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
      adapter: "frameos.ffmpeg-silence-worker",
      upstream: "https://ffmpeg.org/ffmpeg-filters.html#silencedetect",
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
