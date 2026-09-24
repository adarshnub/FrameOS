/** Isolated native effect acceptance; --live also calls the configured Gemini planner. */
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
  effectInstanceSchema,
  createId,
  frameTime,
  toSeconds,
} from "@frameos/contracts";
import { createProject } from "../apps/daemon/dist/domain/project-factory.js";
import { createServices } from "../apps/daemon/dist/services/services.js";
import { compileMltXml } from "../apps/daemon/dist/engine/mlt-compiler.js";
import {
  StudioAiService,
  vertexEditGenerator,
} from "../apps/daemon/dist/studio/ai-service.js";
import { aiPlanRequestSchema } from "../apps/daemon/dist/studio/ai-plan.js";

const root = resolve(
  process.env.FRAMEOS_QA_DIR || ".frameos-data/qa/ai-effects",
);
await mkdir(root, { recursive: true });
const services = await createServices({
  host: "127.0.0.1",
  port: 31419,
  dataDirectory: resolve(root, "store"),
  authToken: "isolated-ai-effects-qa-token-000000",
  authTokenPath: resolve(root, "auth-token"),
  allowedMediaRoots: [root],
  remoteMode: false,
  engineWorkerPath: process.env.FRAMEOS_ENGINE_WORKER,
});
const capabilities = await services.capabilities.listCapabilities();
const availableCapabilities = new Set(
  capabilities.filter((c) => c.available).map((c) => c.id),
);
const t = (n) => frameTime(n, { numerator: 30, denominator: 1 });
const range = (start, duration) => ({ start: t(start), duration: t(duration) });
const report = { startedAt: new Date().toISOString(), checks: [], plans: [] };
const check = (name) => {
  report.checks.push(name);
  console.log("PASS", name);
};
const run = (cmd, args) =>
  execFileSync(cmd, args, { maxBuffer: 16 * 1024 * 1024 });
const assets = {};
for (const [name, source] of Object.entries({
  blue: "color=c=blue:s=1920x1080:r=30:d=4",
  green:
    "color=c=0x00ff00:s=1920x1080:r=30:d=4,drawbox=x=800:y=400:w=320:h=280:color=red:t=fill",
  white: "color=c=white:s=1920x1080:r=30:d=4",
  detail: "testsrc2=s=1920x1080:r=30:d=4",
})) {
  const path = resolve(root, name + ".mp4");
  run("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    source,
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=4",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-threads",
    "2",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    path,
  ]);
  assets[name] = assetSchema.parse({
    id: createId(),
    kind: "video",
    name,
    uri: pathToFileURL(path).href,
    hash: "a".repeat(64),
    duration: t(120),
  });
}
const clip = (asset) =>
  clipSchema.parse({
    id: createId(),
    type: "clip",
    name: asset.name,
    assetId: asset.id,
    timelineRange: range(0, 60),
    sourceRange: range(0, 60),
  });
const effect = (id, parameters) =>
  effectInstanceSchema.parse({
    id: createId(),
    capabilityId: id,
    version: "1.0.0",
    parameters,
  });
const project = createProject({ name: "Native AI effect QA" });
Object.values(assets).forEach((a) => (project.assets[a.id] = a));
const sequence = project.sequences[project.settings.defaultSequenceId];
const video = sequence.tracks.find((t) => t.kind === "video");
const overlay = trackSchema.parse({
  id: createId(),
  kind: "video",
  name: "Overlay",
  order: 10,
});
sequence.tracks.push(overlay);
async function render(name, p = project, frames = 60) {
  const xml = resolve(root, name + ".mlt"),
    output = resolve(root, name + ".mp4");
  await writeFile(
    xml,
    compileMltXml(p, undefined, {
      availableCapabilities,
      resolveFrameosUri: (uri) =>
        services.projects.resolveProjectUri(p.projectId, uri),
    }),
  );
  await services.worker.render(
    xml,
    output,
    undefined,
    undefined,
    { start: 0, end: frames - 1 },
    capabilities,
  );
  return output;
}
const image = (path, at = 0.5) =>
  run("ffmpeg", [
    "-v",
    "error",
    "-ss",
    String(at),
    "-i",
    path,
    "-frames:v",
    "1",
    "-vf",
    "scale=192:108",
    "-pix_fmt",
    "rgb24",
    "-f",
    "rawvideo",
    "pipe:1",
  ]);
const pixel = (bytes, x, y) => [
  ...bytes.subarray((y * 192 + x) * 3, (y * 192 + x) * 3 + 3),
];
try {
  for (const id of [
    "frameos.video.chroma-key",
    "frameos.video.gaussian-blur",
    "frameos.video.vignette",
  ])
    assert(availableCapabilities.has(id), id);
  video.items = [clip(assets.blue)];
  overlay.items = [clip(assets.green)];
  overlay.items[0].effects = [
    effect("frameos.video.chroma-key", { color: "#00ff00", tolerance: 0.15 }),
  ];
  let output = await render("chroma"),
    bytes = image(output);
  assert(
    pixel(bytes, 10, 10)[2] > 200 && pixel(bytes, 10, 10)[1] < 40,
    "Keyed green must reveal the blue background",
  );
  assert(
    pixel(bytes, 96, 54)[0] > 200 && pixel(bytes, 96, 54)[2] < 40,
    "Red foreground must survive keying",
  );
  check("native chroma key removes green and preserves foreground");
  overlay.items = [];
  video.items = [clip(assets.white)];
  video.items[0].effects = [
    effect("frameos.video.vignette", { strength: 0.8 }),
  ];
  bytes = image(await render("vignette"));
  assert(
    pixel(bytes, 96, 54)[0] > 230 && pixel(bytes, 5, 5)[0] < 150,
    "Vignette must darken corners and retain the centre",
  );
  check("native vignette darkens edges");
  video.items = [clip(assets.detail)];
  const sharp = image(await render("sharp"));
  video.items[0].effects = [
    effect("frameos.video.gaussian-blur", { sigma: 20 }),
  ];
  const blurred = image(await render("blur"));
  const energy = (b) => {
    let e = 0;
    for (let y = 1; y < 107; y++)
      for (let x = 1; x < 191; x++)
        for (let c = 0; c < 3; c++)
          e += Math.pow(
            b[(y * 192 + x) * 3 + c] - b[(y * 192 + x - 1) * 3 + c],
            2,
          );
    return e;
  };
  assert(
    energy(blurred) < energy(sharp) * 0.85,
    `Blur must reduce image edge energy: sharp=${energy(sharp)}, blurred=${energy(blurred)}`,
  );
  check("native Gaussian blur reduces fine detail");
  video.items = [clip(assets.blue)];
  const title = titleSchema.parse({
    id: createId(),
    type: "title",
    name: "Motion title",
    text: "FRAMEOS",
    timelineRange: range(0, 60),
    style: { fontSize: 150 },
    automationCurves: [
      {
        id: createId(),
        parameter: "transform.opacity",
        keyframes: [
          { id: createId(), time: t(0), value: 0 },
          { id: createId(), time: t(30), value: 1 },
        ],
      },
      {
        id: createId(),
        parameter: "transform.positionX",
        keyframes: [
          { id: createId(), time: t(0), value: -400 },
          { id: createId(), time: t(30), value: 0 },
        ],
      },
    ],
  });
  overlay.items = [title];
  output = await render("animated-title");
  const whiteCount = (b) => {
    let n = 0;
    for (let i = 0; i < b.length; i += 3) if (b[i] > 150 && b[i + 1] > 150) n++;
    return n;
  };
  assert(
    whiteCount(image(output, 1.25)) > 100,
    "Animated title must be visible after fade-in",
  );
  assert(whiteCount(image(output, 0)) < 5, "Title must begin transparent");
  check("native title animates opacity and position");
  if (process.argv.includes("--live")) {
    const generator = vertexEditGenerator(process.env);
    let generation = 0;
    const ai = new StudioAiService(services, async (...args) => {
      const response = await generator(...args);
      await writeFile(
        resolve(root, `gemini-response-${++generation}.json`),
        response.text,
      );
      return response;
    });
    const p = createProject({ name: "Live Gemini complex editing QA" });
    Object.values(assets).forEach((a) => (p.assets[a.id] = a));
    await services.projects.create(p);
    const request = aiPlanRequestSchema.parse({
      planner: "advanced",
      projectId: p.projectId,
      baseRevision: p.revision,
      assetIds: [assets.detail.id, assets.blue.id],
      brief:
        "Create a new 6-second landscape montage. Use the first 3 seconds of detail followed by the first 3 seconds of blue, with hard cuts. Apply a vignette of strength 0.6 to detail. Add the white title FRAMEOS on a separate video overlay from 1 to 3 seconds, fading opacity from zero to one over its first 0.5 seconds using linear item transform keyframes. Reduce the detail clip audio gain to -6 dB. Preserve source assets. Use only these requested effects. No reference video is needed.",
    });
    console.log("RUN live Gemini complex montage");
    const plan = await ai.plan(request);
    report.plans.push(plan);
    await writeFile(
      resolve(root, "live-plan.json"),
      JSON.stringify(plan, null, 2),
    );
    assert.equal(
      plan.clarification,
      "",
      "A fully specified supported edit must produce a plan",
    );
    assert(plan.steps.length > 0);
    assert.equal(
      (await services.projects.load(p.projectId)).revision,
      p.revision,
      "Planning must not mutate",
    );
    const result = await services.transactions.execute({
      projectId: p.projectId,
      baseRevision: p.revision,
      idempotencyKey: "qa-apply-" + createId(),
      mode: "commit",
      operations: plan.steps.map((s) => s.op),
    });
    const s = result.project.sequences[p.settings.defaultSequenceId];
    const items = s.tracks
      .filter((t) => t.enabled)
      .flatMap((t) => t.items.filter((i) => i.enabled));
    const clips = items.filter((i) => i.type === "clip"),
      titles = items.filter((i) => i.type === "title");
    assert.equal(clips.length, 2);
    assert.equal(titles.length, 1);
    assert(
      clips.some((c) =>
        c.effects.some((e) => e.capabilityId === "frameos.video.vignette"),
      ),
    );
    assert(
      titles[0].automationCurves.some(
        (c) => c.parameter === "transform.opacity",
      ),
    );
    assert(
      Math.abs(
        Math.max(
          ...items.map(
            (i) =>
              toSeconds(i.timelineRange.start) +
              toSeconds(i.timelineRange.duration),
          ),
        ) - 6,
      ) < 0.04,
    );
    output = await render("live-complex", result.project, 180);
    assert(
      whiteCount(image(output, 2)) > 20,
      "AI title must be visible in native output",
    );
    await services.transactions.undo(p.projectId, "qa-undo-" + createId());
    assert.equal(
      (await services.projects.load(p.projectId)).sequences[
        p.settings.defaultSequenceId
      ].tracks.flatMap((t) => t.items).length,
      0,
      "One Undo must revert the whole AI edit",
    );
    check(
      "live Gemini plans, atomically applies, renders and undoes a complex montage",
    );
    // Editing existing clips should not require reselecting source media.
    const existing = await services.transactions.redo(
      p.projectId,
      "qa-redo-" + createId(),
    );
    const correction = await ai.plan(
      aiPlanRequestSchema.parse({
        planner: "advanced",
        projectId: p.projectId,
        baseRevision: existing.project.revision,
        assetIds: [],
        selectedItemId: clips[0].id,
        brief:
          "On the existing detail clip, add Gaussian blur with sigma 10. Keep all timing, other effects, title, audio and other clips unchanged. Do not insert more media.",
      }),
    );
    report.plans.push(correction);
    assert.equal(correction.clarification, "");
    const corrected = await services.transactions.execute({
      projectId: p.projectId,
      baseRevision: existing.project.revision,
      idempotencyKey: "qa-correction-" + createId(),
      mode: "commit",
      operations: correction.steps.map((s) => s.op),
    });
    assert(
      corrected.project.sequences[p.settings.defaultSequenceId].tracks
        .flatMap((t) => t.items)
        .some(
          (i) =>
            i.type === "clip" &&
            i.effects.some(
              (e) => e.capabilityId === "frameos.video.gaussian-blur",
            ),
        ),
    );
    await render("live-existing-blur", corrected.project, 180);
    check(
      "live Gemini applies blur to existing footage without selecting assets again",
    );

    const multi = createProject({
      name: "Live Gemini ten five-minute sources",
    });
    const selected = [];
    for (let n = 0; n < 10; n++) {
      const path = resolve(root, `long-source-${n + 1}.mp4`);
      run("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-stream_loop",
        "74",
        "-i",
        resolve(root, n % 2 ? "blue.mp4" : "detail.mp4"),
        "-t",
        "300",
        "-c",
        "copy",
        path,
      ]);
      const a = assetSchema.parse({
        ...assets.detail,
        id: createId(),
        name: `Source ${n + 1}`,
        uri: pathToFileURL(path).href,
        duration: t(9000),
      });
      multi.assets[a.id] = a;
      selected.push(a.id);
    }
    await services.projects.create(multi);
    console.log("RUN live Gemini montage from ten five-minute sources");
    const many = await ai.plan(
      aiPlanRequestSchema.parse({
        planner: "advanced",
        projectId: multi.projectId,
        baseRevision: multi.revision,
        assetIds: selected,
        brief:
          "Create a 20-second montage using all ten selected sources in numeric source-name order. Take precisely the first two seconds of each source, placing them consecutively on one enabled video track with hard cuts and no gaps. Keep their original sound. No titles, effects or references are needed.",
      }),
    );
    report.plans.push(many);
    assert.equal(many.clarification, "");
    const assembled = await services.transactions.execute({
      projectId: multi.projectId,
      baseRevision: multi.revision,
      idempotencyKey: "qa-ten-" + createId(),
      mode: "commit",
      operations: many.steps.map((s) => s.op),
    });
    const shots = assembled.project.sequences[
      multi.settings.defaultSequenceId
    ].tracks
      .filter((t) => t.enabled)
      .flatMap((t) => t.items.filter((i) => i.enabled && i.type === "clip"))
      .sort(
        (a, b) =>
          toSeconds(a.timelineRange.start) - toSeconds(b.timelineRange.start),
      );
    assert.equal(shots.length, 10);
    shots.forEach((shot, n) => {
      assert.equal(shot.assetId, selected[n]);
      assert.equal(toSeconds(shot.timelineRange.start), n * 2);
      assert.equal(toSeconds(shot.timelineRange.duration), 2);
    });
    output = await render("live-ten-clips", assembled.project, 600);
    for (let n = 1; n < 10; n += 2)
      assert(
        pixel(image(output, n * 2 + 1), 96, 54)[2] > 200,
        "Blue source must appear at each expected cut",
      );
    check(
      "live Gemini assembles and renders ten five-minute sources in the requested order",
    );
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
    resolve(root, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await services.jobs.shutdown();
  services.database.close();
}
