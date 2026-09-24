/** Native acceptance: node tools/manual-editing-qa.mjs [--long-render]
 * Requires the built daemon, FFmpeg/ffprobe and FRAMEOS_ENGINE_WORKER.
 * Uses a separate QA store and generated media; never calls an AI provider.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createId, frameTime } from "@frameos/contracts";
import { createServices } from "../apps/daemon/dist/services/services.js";
import { buildHttpServer } from "../apps/daemon/dist/http/server.js";

const root = resolve(process.env.FRAMEOS_QA_DIR || ".frameos-data/qa/native");
await mkdir(root, { recursive: true });
const token = "frameos-native-qa-isolated-test-token";
const services = await createServices({
  host: "127.0.0.1",
  port: 31419,
  dataDirectory: resolve(root, "store"),
  authToken: token,
  authTokenPath: resolve(root, "auth-token"),
  allowedMediaRoots: [root],
  remoteMode: false,
  engineWorkerPath: process.env.FRAMEOS_ENGINE_WORKER,
});
const app = await buildHttpServer(services);
const api = async (method, url, payload) => {
  const response = await app.inject({
    method,
    url: "/api/v1" + url,
    headers: { authorization: "Bearer " + token },
    ...(payload === undefined ? {} : { payload }),
  });
  assert(response.statusCode < 400, `${method} ${url}: ${response.body}`);
  return response.json().data;
};
const report = {
  startedAt: new Date().toISOString(),
  scope: "10 video clips x 300 seconds, 1920x1080",
  checks: [],
  renders: [],
};
const check = (name) => {
  report.checks.push(name);
  console.log("PASS", name);
};
const run = (binary, args) =>
  execFileSync(binary, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
const pixels = [
  [255, 0, 0],
  [0, 0, 255],
  [0, 128, 0],
  [255, 255, 0],
  [255, 0, 255],
  [0, 255, 255],
  [255, 165, 0],
  [128, 0, 128],
  [255, 255, 255],
  [128, 128, 128],
];
function verifyColor(path, localTime, timelineTime) {
  const pixel = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-ss",
    String(localTime),
    "-i",
    path,
    "-frames:v",
    "1",
    "-vf",
    "scale=1:1",
    "-pix_fmt",
    "rgb24",
    "-f",
    "rawvideo",
    "pipe:1",
  ]);
  const expected = pixels[Math.min(9, Math.floor(timelineTime / 300))];
  assert.equal(pixel.length, 3, "Output contains a decoded frame");
  assert(
    expected.every((n, i) => Math.abs(n - pixel[i]) < 20),
    `Wrong picture at ${timelineTime}s: ${[...pixel]} expected ${expected}`,
  );
}
function audioDb(path, at) {
  const pcm = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-ss",
    String(at),
    "-i",
    path,
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
  assert(pcm.length > 1000, "Output contains decoded audio");
  let energy = 0;
  for (let i = 0; i < pcm.length; i += 4) energy += pcm.readFloatLE(i) ** 2;
  return 10 * Math.log10(energy / (pcm.length / 4));
}
const probe = (path) =>
  JSON.parse(
    run("ffprobe", [
      "-v",
      "error",
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      path,
    ]),
  );
const colors = [
  "red",
  "blue",
  "green",
  "yellow",
  "magenta",
  "cyan",
  "orange",
  "purple",
  "white",
  "gray",
];
let project;
try {
  const caps = await api("GET", "/capabilities");
  assert(
    caps.some((c) => c.id === "engine.mlt" && c.available),
    "Native renderer must be available",
  );
  check("native renderer available");
  project = await api("POST", "/projects", {
    name: "Manual editing acceptance " + report.startedAt,
  });
  report.projectId = project.projectId;
  const assets = [];
  for (let i = 0; i < 10; i++) {
    const path = resolve(root, `clip-${i + 1}.mp4`);
    if (!(await stat(path).catch(() => null))) {
      console.log("Generating five-minute fixture", i + 1);
      // A short encoded source is repeated by stream copy, avoiding 90,000
      // expensive source encodes while retaining ten real five-minute files.
      const seed = resolve(root, `seed-${i + 1}.mp4`);
      run("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=${colors[i]}:s=1920x1080:r=30:d=2`,
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=${220 + i * 55}:sample_rate=48000:duration=2`,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-threads",
        "2",
        "-c:a",
        "aac",
        "-ac",
        "2",
        "-b:a",
        "128k",
        "-shortest",
        seed,
      ]);
      run("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-stream_loop",
        "149",
        "-i",
        seed,
        "-t",
        "300",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        path,
      ]);
    }
    const media = probe(path);
    assert(Math.abs(Number(media.format.duration) - 300) < 0.1);
    const assetId = createId();
    await api("POST", "/assets/imports", {
      projectId: project.projectId,
      baseRevision: project.revision,
      idempotencyKey: "qa-import-" + assetId,
      uri: pathToFileURL(path).href,
      name: `Clip ${i + 1}`,
      kind: "video",
      managed: false,
      licenseMetadata: {},
    });
    project = await api("GET", `/projects/${project.projectId}`);
    const asset = Object.values(project.assets).find(
      (a) => a.name === `Clip ${i + 1}`,
    );
    assert(
      asset.duration &&
        Math.abs(
          (asset.duration.value * asset.duration.rate.denominator) /
            asset.duration.rate.numerator -
            300,
        ) < 0.15,
      "probe discovers five-minute duration",
    );
    assets.push(asset);
  }
  check("ten five-minute 1080p sources imported and probed");
  const sequenceId = project.settings.defaultSequenceId;
  let sequence = project.sequences[sequenceId];
  const track = sequence.tracks.find((t) => t.kind === "video");
  const rate = sequence.format.frameRate;
  const time = (s) =>
    frameTime(Math.round((s * rate.numerator) / rate.denominator), rate);
  const range = (start, duration) => ({
    start: time(start),
    duration: time(duration),
  });
  const op = (type, args, targetId) => ({
    operationId: createId(),
    type,
    arguments: { sequenceId, ...args },
    preconditions: [],
    ...(targetId ? { targetId } : {}),
  });
  const commit = async (operations) => {
    const result = await api("POST", "/transactions", {
      projectId: project.projectId,
      baseRevision: project.revision,
      idempotencyKey: "qa-" + createId(),
      mode: "commit",
      operations,
    });
    project = result.project;
    sequence = project.sequences[sequenceId];
    return result;
  };
  const clips = assets.map((asset, i) => ({
    id: createId(),
    type: "clip",
    name: asset.name,
    assetId: asset.id,
    timelineRange: range(i * 300, 300),
    sourceRange: {
      start: frameTime(0, asset.duration.rate),
      duration: frameTime(
        Math.round(
          (300 * asset.duration.rate.numerator) /
            asset.duration.rate.denominator,
        ),
        asset.duration.rate,
      ),
    },
    transform: {},
    audio: {},
    enabled: true,
    locked: false,
    metadata: {},
    timeMap: [],
    effects: [],
    links: [],
    semanticMetadata: {},
  }));
  await commit(
    clips.map((item) => op("item.add", { trackId: track.id, item })),
  );
  check("atomic assembly of a fifty-minute timeline");
  const first = clips[0],
    rightId = createId();
  await commit([
    op(
      "clip.split",
      { trackId: track.id, at: time(150), rightClipId: rightId },
      first.id,
    ),
  ]);
  assert.equal(sequence.tracks.find((t) => t.id === track.id).items.length, 11);
  await commit([
    op("audio.gain.set", { trackId: track.id, gainDb: -9 }, rightId),
  ]);
  for (let i = 0; i < 2; i++)
    project = (
      await api("POST", `/projects/${project.projectId}/undo`, {
        idempotencyKey: "qa-undo-" + createId(),
      })
    ).project;
  assert.equal(
    project.sequences[sequenceId].tracks.find((t) => t.id === track.id).items
      .length,
    10,
  );
  for (let i = 0; i < 2; i++)
    project = (
      await api("POST", `/projects/${project.projectId}/redo`, {
        idempotencyKey: "qa-redo-" + createId(),
      })
    ).project;
  sequence = project.sequences[sequenceId];
  assert.equal(
    sequence.tracks
      .find((t) => t.id === track.id)
      .items.find((i) => i.id === rightId).audio.gainDb,
    -9,
  );
  check("split, audio gain, repeated undo and redo");
  const saved = project.revision;
  const invalid = await app.inject({
    method: "POST",
    url: "/api/v1/transactions",
    headers: { authorization: "Bearer " + token },
    payload: {
      projectId: project.projectId,
      baseRevision: saved,
      idempotencyKey: "qa-overlap-" + createId(),
      mode: "commit",
      operations: [
        op(
          "clip.move",
          {
            fromTrackId: track.id,
            toTrackId: track.id,
            timelineStart: time(1),
          },
          clips[1].id,
        ),
      ],
    },
  });
  assert(invalid.statusCode >= 400, "overlapping manual move must be rejected");
  assert.equal(
    (await api("GET", `/projects/${project.projectId}`)).revision,
    saved,
  );
  check("invalid overlap leaves the project unchanged");
  async function wait(job) {
    const deadline = Date.now() + 2 * 60 * 60 * 1000;
    for (;;) {
      const current = await api("GET", "/jobs/" + job.id);
      if (current.status === "completed") return current;
      if (["failed", "cancelled"].includes(current.status))
        throw Error(JSON.stringify(current.error));
      assert(Date.now() < deadline, "Native job exceeded two-hour QA deadline");
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  // Render each cut neighborhood at full output resolution using the exact
  // long project graph, including sources that start at 45 minutes.
  for (const at of [0, 149, 299, 599, 1499, 2699, 2998]) {
    const job = await wait(
      await api("POST", "/previews", {
        kind: "region",
        projectId: project.projectId,
        sequenceId,
        source: { type: "revision", revision: project.revision },
        range: range(at, 2),
        maxWidth: 1920,
        maxHeight: 1080,
      }),
    );
    const artifact = job.output.artifacts.find(
      (a) => a.mimeType === "video/mp4",
    );
    assert(artifact, "region produces an MP4 artifact");
    const output = (await services.jobs.resolveArtifact(job.id, artifact.name))
      .path;
    const info = probe(output),
      video = info.streams.find((s) => s.codec_type === "video");
    assert.equal(video.width, 1920);
    assert.equal(video.height, 1080);
    assert(
      Math.abs(Number(info.format.duration) - 2) < 0.12,
      `region duration: ${info.format.duration}`,
    );
    for (const offset of [0.25, 1.25]) verifyColor(output, offset, at + offset);
    assert(
      Number.isFinite(audioDb(output, 0.25)),
      "Region audio is not silent",
    );
    if (at === 149) {
      const difference = audioDb(output, 1.25) - audioDb(output, 0.25);
      assert(
        Math.abs(difference + 9) < 1.5,
        `Split gain change should be -9 dB, got ${difference}`,
      );
      check("rendered split preserves the requested -9 dB audio change");
    }
    report.renders.push({
      kind: "region",
      at,
      path: output,
      duration: Number(info.format.duration),
    });
    console.log("PASS native cut region", at);
  }
  check("native 1080p cut previews across all fifty minutes");
  if (process.argv.includes("--long-render")) {
    const job = await wait(
      await api("POST", "/renders", {
        projectId: project.projectId,
        sequenceId,
        revision: project.revision,
        outputName: "manual-50-minute-1080p.mp4",
      }),
    );
    const output = (
      await services.jobs.resolveArtifact(job.id, "manual-50-minute-1080p.mp4")
    ).path;
    const info = probe(output),
      video = info.streams.find((s) => s.codec_type === "video"),
      audio = info.streams.find((s) => s.codec_type === "audio");
    assert.equal(video.width, 1920);
    assert.equal(video.height, 1080);
    assert(audio);
    assert(
      Math.abs(Number(info.format.duration) - 3000) < 0.12,
      `export duration ${info.format.duration}`,
    );
    for (let i = 0; i < 10; i++) verifyColor(output, i * 300 + 1, i * 300 + 1);
    report.renders.push({
      kind: "full",
      path: output,
      duration: Number(info.format.duration),
      videoCodec: video.codec_name,
      audioCodec: audio.codec_name,
    });
    check("complete fifty-minute 1080p export with audio");
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error.stack || error);
  process.exitCode = 1;
  console.error(report.error);
} finally {
  report.completedAt = new Date().toISOString();
  await writeFile(
    resolve(root, "manual-acceptance.json"),
    JSON.stringify(report, null, 2),
  );
  await app.close();
}
