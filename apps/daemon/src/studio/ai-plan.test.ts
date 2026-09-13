import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { assetSchema, createId, toSeconds } from "@frameos/contracts";
import { createProject } from "../domain/project-factory.js";
import { executeOperations } from "../domain/operation-executor.js";
import { aiPlanSchema, aiPlanRequestSchema, compileAiPlan } from "./ai-plan.js";
import { compileMltXml } from "../engine/mlt-compiler.js";

function fixture() {
  const project = createProject({ name: "AI plan test" });
  const asset = assetSchema.parse({
    id: createId(),
    name: "sample.mp4",
    kind: "video",
    uri: pathToFileURL(resolve("sample.mp4")).href,
    hash: "a".repeat(64),
    duration: { value: 600, rate: { numerator: 30, denominator: 1 } },
  });
  project.assets[asset.id] = asset;
  const request = aiPlanRequestSchema.parse({
    projectId: project.projectId,
    baseRevision: 0,
    brief: "Make an edit",
    assetIds: [asset.id],
  });
  return { project, asset, request };
}

function mediaPlan(extra: unknown[]) {
  const f = fixture();
  const plan = aiPlanSchema.parse({
    summary: "Independent audio edit",
    clarification: "",
    warnings: [],
    actions: [
      {
        type: "track",
        ref: "v",
        name: "Picture",
        kind: "video",
        label: "Picture",
      },
      { type: "track", ref: "a", name: "Sound", kind: "audio", label: "Sound" },
      {
        type: "add",
        ref: "shot",
        track: "v",
        assetId: f.asset.id,
        start: 0,
        source: 2,
        duration: 6,
        label: "Add shot",
      },
      ...extra,
    ],
  });
  const steps = compileAiPlan(f.project, plan, f.request);
  const result = executeOperations(
    f.project,
    steps.map((s) => s.op),
  ).project;
  const seq = result.sequences[result.settings.defaultSequenceId]!;
  return {
    ...f,
    result,
    steps,
    seq,
    video: seq.tracks.find((t) => t.name === "Picture")!,
    audio: seq.tracks.find((t) => t.name === "Sound")!,
  };
}
describe("AI independent sound and retiming", () => {
  it("detaches, cuts sound independently, processes it and relinks without doubling the original", () => {
    const { video, audio, project, steps, result } = mediaPlan([
      {
        type: "detach_audio",
        item: "shot",
        ref: "sound",
        track: "a",
        label: "Detach sound",
      },
      {
        type: "split",
        item: "sound",
        ref: "tail",
        at: 3,
        label: "Split audio at 3",
      },
      { type: "volume", item: "tail", gainDb: -9, label: "Lower tail" },
      {
        type: "audio_fade",
        item: "tail",
        kind: "out",
        duration: 1,
        curve: "linear",
        label: "Fade out",
      },
      {
        type: "link",
        item: "shot",
        other: "sound",
        linked: true,
        label: "Relink",
      },
    ]);
    expect(video.items[0]).toMatchObject({
      audio: { muted: true },
      links: [audio.items[0]!.id],
    });
    expect(audio.items).toHaveLength(2);
    expect(audio.items.map((i) => toSeconds(i.timelineRange.duration))).toEqual(
      [3, 3],
    );
    expect(toSeconds(video.items[0]!.timelineRange.duration)).toBe(6);
    expect(audio.items[1]).toMatchObject({
      audio: { gainDb: -9, muted: false },
    });
    expect(
      project.sequences[project.settings.defaultSequenceId]!.tracks.every(
        (t) => !t.items.length,
      ),
    ).toBe(true);
    expect(steps.every((s) => s.op.provenance?.actorType === "agent")).toBe(
      true,
    );
    const xml = compileMltXml(result, undefined, {
      availableCapabilities: new Set([
        "mlt.filter.avfilter.volume",
        "mlt.filter.avfilter.afade",
      ]),
    });
    expect(xml).toContain('hide="video"');
    expect(xml).toContain("-120dB");
    expect(xml).toContain("avfilter.afade");
  });
  it("supports fractional slow motion and splitting retimed clips", () => {
    const { video } = mediaPlan([
      { type: "speed", item: "shot", speed: 0.5, label: "Half speed" },
      {
        type: "split",
        item: "shot",
        ref: "tail",
        at: 6,
        label: "Split slow motion",
      },
      {
        type: "volume",
        item: "tail",
        gainDb: -6,
        label: "Quieter slow motion",
      },
    ]);
    expect(video.items.map((i) => toSeconds(i.timelineRange.duration))).toEqual(
      [6, 6],
    );
    expect(
      video.items.map(
        (i) => i.type === "clip" && i.timeMap.map((k) => k.value),
      ),
    ).toEqual([
      [60, 150],
      [150, 240],
    ]);
  });
  it("compiles a native speech processing chain and timeline ducking", () => {
    const { result, audio } = mediaPlan([
      {
        type: "detach_audio",
        item: "shot",
        ref: "voice",
        track: "a",
        label: "Detach voice",
      },
      {
        type: "audio_enhance_voice",
        item: "voice",
        amount: 0.5,
        label: "Enhance speech",
      },
      {
        type: "audio_normalize",
        item: "voice",
        targetLufs: -16,
        truePeakDb: -1,
        mode: "integrated",
        label: "Normalize",
      },
      {
        type: "audio_limit",
        item: "voice",
        ceilingDb: -1,
        releaseMs: 100,
        lookaheadMs: 5,
        label: "Limit",
      },
      {
        type: "mute",
        item: "shot",
        muted: false,
        label: "Use picture sound as a test bed",
      },
      {
        type: "audio_duck",
        item: "shot",
        sidechain: "voice",
        reductionDb: 12,
        attack: 0.1,
        release: 0.4,
        label: "Duck bed",
      },
    ]);
    expect(audio.items[0]).toMatchObject({
      effects: [
        {
          parameters: {
            denoise: { amount: 0.25 },
            normalization: { targetLufs: -16 },
          },
        },
      ],
    });
    const xml = compileMltXml(result, undefined, {
      availableCapabilities: new Set([
        "mlt.filter.avfilter.volume",
        "mlt.filter.avfilter.afftdn",
        "mlt.filter.avfilter.highpass",
        "mlt.filter.avfilter.equalizer",
        "mlt.filter.avfilter.acompressor",
        "mlt.filter.avfilter.alimiter",
        "mlt.filter.avfilter.loudnorm",
      ]),
    });
    expect(xml).toContain("pow(10,(-12*");
    expect(xml).toContain("avfilter.loudnorm");
  });
  it("compiles ramps with holds and rejects descending ramp points", () => {
    const ramp = {
      type: "speed_ramp",
      item: "shot",
      duration: 8,
      label: "Ramp",
      points: [
        { at: 0, source: 2 },
        { at: 2, source: 3 },
        { at: 4, source: 3 },
        { at: 8, source: 8 },
      ],
    };
    const { video } = mediaPlan([ramp]);
    expect(toSeconds(video.items[0]!.timelineRange.duration)).toBe(8);
    expect(video.items[0]).toMatchObject({
      timeMap: [{ value: 60 }, { value: 90 }, { value: 90 }, { value: 240 }],
    });
    expect(() =>
      mediaPlan([
        {
          ...ramp,
          points: [
            { at: 0, source: 8 },
            { at: 8, source: 2 },
          ],
        },
      ]),
    ).toThrow("non-descending");
  });
  it("rejects double detachment, out-of-range fades and self-ducking", () => {
    const detach = {
      type: "detach_audio",
      item: "shot",
      ref: "sound",
      track: "a",
      label: "Detach",
    };
    expect(() => mediaPlan([detach, { ...detach, ref: "again" }])).toThrow(
      "already detached",
    );
    expect(() =>
      mediaPlan([
        {
          type: "audio_fade",
          item: "shot",
          kind: "in",
          duration: 7,
          curve: "linear",
          label: "Too long",
        },
      ]),
    ).toThrow("fit");
    expect(() =>
      mediaPlan([
        {
          type: "audio_duck",
          item: "shot",
          sidechain: "shot",
          reductionDb: 6,
          attack: 0.1,
          release: 0.2,
          label: "Invalid",
        },
      ]),
    ).toThrow("different audible");
  });
  it("undoes detachment in one operation and preserves processing with unique IDs", () => {
    const { project, steps } = mediaPlan([
      {
        type: "audio_fade",
        item: "shot",
        kind: "in",
        duration: 1,
        curve: "linear",
        label: "Fade",
      },
      {
        type: "detach_audio",
        item: "shot",
        ref: "sound",
        track: "a",
        label: "Detach",
      },
    ]);
    const before = executeOperations(
      project,
      steps.slice(0, -1).map((s) => s.op),
    ).project;
    expect(steps.at(-1)!.op.type).toBe("sequence.replace");
    const change = executeOperations(before, [steps.at(-1)!.op]);
    expect(
      executeOperations(change.project, change.inverseOperations).project,
    ).toEqual(before);
  });
  it("changes speed after a retimed split without bringing back removed source sections", () => {
    const { video } = mediaPlan([
      { type: "speed", item: "shot", speed: 0.5, label: "Slow" },
      { type: "split", item: "shot", ref: "tail", at: 6, label: "Split" },
      { type: "speed", item: "tail", speed: 1, label: "Restore tail speed" },
    ]);
    expect(toSeconds(video.items[1]!.timelineRange.duration)).toBe(3);
    expect(video.items[1]).toMatchObject({
      sourceRange: { start: { value: 150 }, duration: { value: 90 } },
    });
  });
  it("adds an audio crossfade with source handles", () => {
    const { audio, result } = mediaPlan([
      {
        type: "detach_audio",
        item: "shot",
        ref: "sound",
        track: "a",
        label: "Detach",
      },
      { type: "split", item: "sound", ref: "tail", at: 3, label: "Split" },
      {
        type: "transition",
        from: "sound",
        to: "tail",
        kind: "audio_crossfade",
        duration: 1,
        label: "Crossfade",
      },
    ]);
    expect(audio.items[2]).toMatchObject({
      capabilityId: "frameos.transition.audio_crossfade",
    });
    const xml = compileMltXml(result, undefined, {
      availableCapabilities: new Set([
        "mlt.filter.avfilter.volume",
        "mlt.transition.mix",
      ]),
    });
    expect(xml).toContain('name="mlt_service">mix');
  });
});
describe("AI edit compiler", () => {
  it("compiles aliases, explicit source ranges, rotation, titles and splits without mutating the project", () => {
    const { project, asset, request } = fixture();
    const plan = aiPlanSchema.parse({
      summary: "Two shots with a title",
      clarification: "",
      warnings: [],
      actions: [
        {
          type: "track",
          ref: "montage",
          name: "AI montage",
          kind: "video",
          label: "Create montage",
        },
        {
          type: "add",
          ref: "shot_a",
          track: "montage",
          assetId: asset.id,
          start: 0,
          source: 2,
          duration: 4,
          label: "Use seconds 2–6",
        },
        {
          type: "add",
          ref: "shot_b",
          track: "montage",
          assetId: asset.id,
          start: 4,
          source: 10,
          duration: 3,
          label: "Use seconds 10–13",
        },
        {
          type: "picture",
          item: "shot_b",
          rotation: 15,
          scale: 0.75,
          opacity: 1,
          label: "Rotate second shot",
        },
        {
          type: "split",
          item: "shot_a",
          ref: "shot_a_right",
          at: 2,
          label: "Split first shot at 2s",
        },
        {
          type: "track",
          ref: "titles",
          name: "Titles",
          kind: "video",
          label: "Create title track",
        },
        {
          type: "title",
          ref: "intro_title",
          track: "titles",
          text: "Our story",
          start: 0,
          duration: 2,
          label: "Add title",
        },
      ],
    });
    const steps = compileAiPlan(project, plan, request);
    const result = executeOperations(
      project,
      steps.map((s) => s.op),
    ).project;
    const sequence = result.sequences[result.settings.defaultSequenceId]!;
    const clips = sequence.tracks.find((t) => t.name === "AI montage")!.items;
    expect(clips).toHaveLength(3);
    expect(clips.map((i) => toSeconds(i.timelineRange.duration))).toEqual([
      2, 2, 3,
    ]);
    expect(clips[2]).toMatchObject({
      transform: { rotation: 15, scaleX: 0.75 },
    });
    expect(
      sequence.tracks.find((t) => t.name === "Titles")!.items[0],
    ).toMatchObject({ text: "Our story" });
    expect(project.revision).toBe(0);
    expect(
      project.sequences[project.settings.defaultSequenceId]!.tracks.flatMap(
        (t) => t.items,
      ),
    ).toHaveLength(0);
    expect(steps.every((s) => s.op.provenance?.actorType === "agent")).toBe(
      true,
    );
  });
  it("rejects out of bounds ranges and media outside the selection", () => {
    const { project, asset, request } = fixture();
    const track =
      project.sequences[project.settings.defaultSequenceId]!.tracks[0]!;
    const plan = aiPlanSchema.parse({
      summary: "Bad range",
      clarification: "",
      warnings: [],
      actions: [
        {
          type: "add",
          ref: "new_shot",
          track: track.id,
          assetId: asset.id,
          start: 0,
          source: 19,
          duration: 4,
          label: "Invalid range",
        },
      ],
    });
    expect(() => compileAiPlan(project, plan, request)).toThrow(
      "outside the source",
    );
    expect(() =>
      compileAiPlan(project, plan, { ...request, assetIds: [createId()] }),
    ).toThrow("outside your selection");
  });
  it("rejects overlapping edits before approval", () => {
    const { project, asset, request } = fixture();
    const track =
      project.sequences[project.settings.defaultSequenceId]!.tracks[0]!;
    const plan = aiPlanSchema.parse({
      summary: "Overlap",
      clarification: "",
      warnings: [],
      actions: [
        {
          type: "add",
          ref: "shot1",
          track: track.id,
          assetId: asset.id,
          start: 0,
          source: 0,
          duration: 4,
          label: "Add one",
        },
        {
          type: "add",
          ref: "shot2",
          track: track.id,
          assetId: asset.id,
          start: 2,
          source: 0,
          duration: 4,
          label: "Overlap",
        },
      ],
    });
    expect(() => compileAiPlan(project, plan, request)).toThrow();
  });
  it("never compiles actions when clarification is required", () => {
    const { project, request } = fixture();
    expect(
      compileAiPlan(
        project,
        {
          summary: "Unsupported export",
          clarification:
            "Native export is unavailable. Would you like editing only?",
          warnings: [],
          actions: [],
        },
        request,
      ),
    ).toEqual([]);
  });
  it("rejects executable code, arbitrary operations and unknown fields", () => {
    expect(
      aiPlanSchema.safeParse({
        summary: "bad",
        clarification: "",
        warnings: [],
        actions: [{ type: "shell", command: "echo bad", label: "Run" }],
      }).success,
    ).toBe(false);
    expect(
      aiPlanRequestSchema.safeParse({
        projectId: createId(),
        baseRevision: 0,
        brief: "edit",
        token: "secret",
      }).success,
    ).toBe(false);
  });
});

it("applies a portrait canvas and independent crop and position", () => {
  const { result } = mediaPlan([
    { type: "canvas", label: "Portrait", width: 1080, height: 1920 },
    {
      type: "reframe",
      label: "Subject framing",
      item: "shot",
      values: { positionX: 120, cropLeft: 0.1, scaleX: 1.4 },
    },
  ]);
  const sequence = result.sequences[result.settings.defaultSequenceId]!;
  expect(sequence.format.width).toBe(1080);
  expect(sequence.format.height).toBe(1920);
  const clip = sequence.tracks
    .flatMap((t) => t.items)
    .find((i) => i.type === "clip");
  expect(clip && "transform" in clip && clip.transform.positionX).toBe(120);
});

it("compiles transform animation curves with local second-based keyframes", () => {
  const { result, steps } = mediaPlan([
    {
      type: "transform_animation",
      label: "Camera push in",
      item: "shot",
      curves: [
        {
          parameter: "transform.scaleX",
          keyframes: [
            { time: 0, value: 1, interpolation: "linear" },
            { time: 6, value: 1.2, interpolation: "linear" },
          ],
        },
        {
          parameter: "transform.scaleY",
          keyframes: [
            { time: 0, value: 1, interpolation: "linear" },
            { time: 6, value: 1.2, interpolation: "linear" },
          ],
        },
      ],
    },
  ]);
  const clip = result.sequences[
    result.settings.defaultSequenceId
  ]!.tracks.flatMap((track) => track.items).find(
    (item) => item.type === "clip",
  );
  expect(steps.at(-1)?.op.type).toBe("item.automation.set");
  expect(
    clip && "automationCurves" in clip && clip.automationCurves,
  ).toHaveLength(2);
});

it("builds deterministic camera-shake curves from a bounded macro", () => {
  const make = () =>
    mediaPlan([
      {
        type: "camera_shake",
        label: "Reference handheld motion",
        item: "shot",
        amplitudePixels: 18,
        rotationDegrees: 1.2,
        frequencyHz: 4,
        overscan: 1.08,
        seed: 42,
      },
    ]);
  const first = make();
  const second = make();
  const curves = first.result.sequences[
    first.result.settings.defaultSequenceId
  ]!.tracks.flatMap((track) => track.items).find(
    (item) => item.type === "clip",
  );
  const otherCurves = second.result.sequences[
    second.result.settings.defaultSequenceId
  ]!.tracks.flatMap((track) => track.items).find(
    (item) => item.type === "clip",
  );
  const values = (item: typeof curves) =>
    item && "automationCurves" in item
      ? item.automationCurves?.map((curve) =>
          curve.keyframes.map((keyframe) => keyframe.value),
        )
      : undefined;
  expect(first.steps.at(-1)?.op.type).toBe("item.automation.set");
  expect(values(curves)).toHaveLength(5);
  expect(values(curves)).toEqual(values(otherCurves));
});
