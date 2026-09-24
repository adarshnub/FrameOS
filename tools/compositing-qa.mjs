/** Native layered picture/audio regression checks. Run after manual-editing-qa generated sources. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assetSchema,
  clipSchema,
  titleSchema,
  trackSchema,
  createId,
  frameTime,
} from "@frameos/contracts";
import { createProject } from "../apps/daemon/dist/domain/project-factory.js";
import { compileMltXml } from "../apps/daemon/dist/engine/mlt-compiler.js";
import { EngineWorkerClient } from "../apps/daemon/dist/engine/worker-client.js";
const root = resolve(process.env.FRAMEOS_QA_DIR || ".frameos-data/qa/native");
const outputRoot = resolve(root, "compositing");
await mkdir(outputRoot, { recursive: true });
const worker = new EngineWorkerClient(process.env.FRAMEOS_ENGINE_WORKER);
const capabilities = await worker.discoverCapabilities();
const availableCapabilities = new Set(
  capabilities.filter((c) => c.available).map((c) => c.id),
);
const t = (n) => frameTime(n, { numerator: 30, denominator: 1 });
const range = (start, duration) => ({ start: t(start), duration: t(duration) });
const project = createProject({ name: "Native composition checks" }),
  sequence = project.sequences[project.settings.defaultSequenceId];
const red = assetSchema.parse({
  id: createId(),
  name: "Red",
  kind: "video",
  uri: pathToFileURL(resolve(root, "clip-1.mp4")).href,
  hash: "f".repeat(64),
  duration: t(9000),
});
const blue = assetSchema.parse({
  ...red,
  id: createId(),
  name: "Blue",
  uri: pathToFileURL(resolve(root, "clip-2.mp4")).href,
  hash: "b".repeat(64),
});
project.assets[red.id] = red;
project.assets[blue.id] = blue;
const clip = (asset) =>
  clipSchema.parse({
    id: createId(),
    name: asset.name,
    type: "clip",
    assetId: asset.id,
    sourceRange: range(30, 60),
    timelineRange: range(0, 60),
  });
const video = sequence.tracks.find((t) => t.kind === "video");
video.items = [clip(red)];
const pixels = (path) =>
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-ss",
    "0.5",
    "-i",
    path,
    "-frames:v",
    "1",
    "-vf",
    "scale=32:18",
    "-pix_fmt",
    "rgb24",
    "-f",
    "rawvideo",
    "pipe:1",
  ]);
async function render(name) {
  const xml = resolve(outputRoot, name + ".mlt"),
    output = resolve(outputRoot, name + ".mp4");
  await writeFile(
    xml,
    compileMltXml(project, sequence.id, { availableCapabilities }),
  );
  await worker.render(
    xml,
    output,
    undefined,
    undefined,
    { start: 0, end: 59 },
    capabilities,
  );
  return output;
}
const checks = [];
try {
  const top = trackSchema.parse({
    id: createId(),
    name: "Overlay",
    kind: "video",
    order: 10,
    items: [clip(blue)],
  });
  top.items[0].transform.opacity = 0.5;
  top.items[0].audio.muted = true;
  sequence.tracks.push(top);
  let output = await render("opacity");
  let image = pixels(output);
  let center = (9 * 32 + 16) * 3;
  assert(
    Math.abs(image[center] - 127) < 25 &&
      image[center + 1] < 30 &&
      Math.abs(image[center + 2] - 127) < 25,
    "Half-opacity blue must blend over red",
  );
  checks.push("half-opacity video layers blend");
  console.log("PASS", checks.at(-1));
  top.items = [
    titleSchema.parse({
      id: createId(),
      name: "Title",
      type: "title",
      text: "FRAMEOS",
      timelineRange: range(0, 60),
      style: { fontSize: 120 },
    }),
  ];
  output = await render("title");
  image = pixels(output);
  assert(
    image[0] > 200 && image[1] < 25 && image[2] < 25,
    "Title must preserve red footage outside text",
  );
  assert(
    [...image].some((v, i) => i % 3 === 1 && v > 60),
    "Title must contain visible text",
  );
  checks.push("title composites over footage");
  console.log("PASS", checks.at(-1));
  top.enabled = false;
  const audio = sequence.tracks.find((t) => t.kind === "audio");
  audio.items = [clip(blue)];
  output = await render("audio-mix");
  const pcm = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-ss",
    "0.5",
    "-i",
    output,
    "-t",
    "0.4",
    "-vn",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-f",
    "f32le",
    "pipe:1",
  ]);
  for (const frequency of [220, 275]) {
    let re = 0,
      im = 0,
      n = pcm.length / 4;
    for (let i = 0; i < n; i++) {
      const value = pcm.readFloatLE(i * 4),
        angle = (2 * Math.PI * frequency * i) / 16000;
      re += value * Math.cos(angle);
      im += value * Math.sin(angle);
    }
    assert(
      (2 * Math.hypot(re, im)) / n > 0.03,
      "Missing mixed tone " + frequency,
    );
  }
  checks.push("independent video and audio tracks are both audible");
  console.log("PASS", checks.at(-1));
  await writeFile(
    resolve(outputRoot, "report.json"),
    JSON.stringify({ status: "passed", checks }, null, 2),
  );
} catch (error) {
  await writeFile(
    resolve(outputRoot, "report.json"),
    JSON.stringify(
      { status: "failed", checks, error: String(error.stack) },
      null,
      2,
    ),
  );
  throw error;
}
