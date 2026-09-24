/** Creates a small QA project on a running daemon; never modifies existing projects. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.env.FRAMEOS_QA_URL || "http://127.0.0.1:31415";
const token =
  process.env.FRAMEOS_AUTH_TOKEN?.trim() ||
  (
    await readFile(
      join(process.env.FRAMEOS_DATA_DIR || ".frameos-data", "auth-token"),
      "utf8",
    )
  ).trim();
const headers = { authorization: "Bearer " + token };
const request = async (path, options = {}) => {
  const response = await fetch(base + "/api/v1" + path, {
    signal: AbortSignal.timeout(60000),
    ...options,
  });
  assert(response.ok, `${path}: HTTP ${response.status}`);
  return response;
};
const api = async (method, path, body) =>
  (
    await (
      await request(path, {
        method,
        headers: { ...headers, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    ).json()
  ).data;
const caps = await api("GET", "/capabilities");
assert(caps.some((c) => c.id === "engine.mlt" && c.available));
let project = await api("POST", "/projects", {
  name: "Manual HTTP smoke " + new Date().toISOString(),
});
const form = new FormData();
form.append(
  "file",
  new Blob([await readFile(process.argv[2])], { type: "video/mp4" }),
  "qa-source.mp4",
);
const imported = (
  await (
    await request(
      `/assets/uploads?projectId=${project.projectId}&baseRevision=${project.revision}&kind=video`,
      {
        method: "POST",
        headers,
        body: form,
      },
    )
  ).json()
).data;
project = imported.transaction.project;
const session = await request(
  `/projects/${project.projectId}/playback-session`,
  { method: "POST", headers },
);
const cookie = session.headers.get("set-cookie").split(";")[0];
const media = await request(
  `/projects/${project.projectId}/assets/${imported.asset.id}/content`,
  {
    headers: { cookie, range: "bytes=0-1023" },
  },
);
assert.equal(media.status, 206);
assert.equal((await media.arrayBuffer()).byteLength, 1024);
const sequenceId = project.settings.defaultSequenceId;
const sequence = project.sequences[sequenceId];
const time = (value) => ({ value, rate: sequence.format.frameRate });
const range = { start: time(0), duration: time(60) };
project = (
  await api("POST", "/transactions", {
    projectId: project.projectId,
    baseRevision: project.revision,
    idempotencyKey: "http-smoke-" + randomUUID(),
    mode: "commit",
    operations: [
      {
        operationId: randomUUID(),
        type: "clip.insert",
        preconditions: [],
        arguments: {
          sequenceId,
          trackId: sequence.tracks.find((t) => t.kind === "video").id,
          clip: {
            id: randomUUID(),
            type: "clip",
            name: "HTTP upload",
            assetId: imported.asset.id,
            timelineRange: range,
            sourceRange: range,
            transform: {},
            audio: {},
          },
        },
      },
    ],
  })
).project;
let job = await api("POST", "/renders", {
  projectId: project.projectId,
  sequenceId,
  revision: project.revision,
  outputName: "http-smoke.mp4",
});
const started = performance.now();
while (!["completed", "failed", "cancelled"].includes(job.status)) {
  assert(performance.now() - started < 120000, "Render exceeded two minutes");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  job = await api("GET", "/jobs/" + job.id);
}
assert.equal(job.status, "completed", JSON.stringify(job.error));
const artifact = await request(
  `/projects/${project.projectId}/jobs/${job.id}/artifacts/http-smoke.mp4`,
  { headers: { cookie } },
);
assert.match(artifact.headers.get("content-disposition"), /attachment/);
const output = join(
  await mkdtemp(join(tmpdir(), "frameos-http-")),
  "output.mp4",
);
await writeFile(output, Buffer.from(await artifact.arrayBuffer()));
const info = JSON.parse(
  execFileSync(
    "ffprobe",
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", output],
    { encoding: "utf8" },
  ),
);
assert(Math.abs(Number(info.format.duration) - 2) < 0.12);
assert(
  info.streams.some(
    (s) => s.codec_type === "video" && s.width === 1920 && s.height === 1080,
  ),
);
assert(info.streams.some((s) => s.codec_type === "audio"));
console.log(
  JSON.stringify(
    {
      status: "passed",
      projectId: project.projectId,
      jobId: job.id,
      checks: [
        "native capability",
        "multipart upload",
        "cookie range playback",
        "timeline commit",
        "native export",
        "cookie artifact download",
      ],
      duration: Number(info.format.duration),
    },
    null,
    2,
  ),
);
