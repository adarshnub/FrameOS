import {
  createId,
  frameTime,
  type Asset,
  type Clip,
  type Operation,
  type Project,
  type Track,
} from "@frameos/contracts";
import { describe, expect, it } from "vitest";
import { createProject } from "./project-factory.js";
import { executeOperations } from "./operation-executor.js";

interface EditorialFixture {
  project: Project;
  track: Track;
  asset: Asset;
}

function fixture(): EditorialFixture {
  const project = createProject({
    name: "Editorial operation fixture",
    frameRate: { numerator: 30, denominator: 1 },
  });
  const sequence = project.sequences[project.settings.defaultSequenceId]!;
  const track = sequence.tracks.find(
    (candidate) => candidate.kind === "video",
  )!;
  const asset: Asset = {
    id: createId(),
    name: "source.mov",
    kind: "video",
    uri: "file:///fixture/source.mov",
    hash: "0123456789abcdef0123456789abcdef",
    managed: false,
    streams: [],
    duration: frameTime(10_000, sequence.format.frameRate),
    proxies: [],
    analysisRefs: [],
    licenseMetadata: {},
    semanticMetadata: {},
  };
  project.assets[asset.id] = asset;
  return { project, track, asset };
}

function clip(
  context: EditorialFixture,
  start: number,
  duration: number,
  sourceStart = start,
  id = createId(),
): Clip {
  const rate =
    context.project.sequences[context.project.settings.defaultSequenceId]!
      .format.frameRate;
  return {
    id,
    type: "clip",
    name: `Clip ${start.toString()}`,
    assetId: context.asset.id,
    sourceRange: {
      start: frameTime(sourceStart, rate),
      duration: frameTime(duration, rate),
    },
    timelineRange: {
      start: frameTime(start, rate),
      duration: frameTime(duration, rate),
    },
    enabled: true,
    locked: false,
    metadata: {},
    transform: {
      positionX: 0,
      positionY: 0,
      anchorX: 0.5,
      anchorY: 0.5,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
      cropTop: 0,
      cropRight: 0,
      cropBottom: 0,
      cropLeft: 0,
      blendMode: "normal",
    },
    timeMap: [],
    effects: [],
    audio: { gainDb: 0, pan: 0, muted: false, channelMap: [] },
    links: [],
    semanticMetadata: {},
  };
}

function executeAndRestore(project: Project, operation: Operation) {
  const executed = executeOperations(project, [operation]);
  const restored = executeOperations(
    executed.project,
    executed.inverseOperations,
  );
  expect(restored.project).toEqual(project);
  return executed;
}

describe("advanced editorial operations", () => {
  it("inserts a clip and ripples every following item", () => {
    const context = fixture();
    const first = clip(context, 0, 10);
    const second = clip(context, 10, 10);
    context.track.items.push(first, second);
    const inserted = clip(context, 10, 5, 100);
    const result = executeAndRestore(context.project, {
      operationId: createId(),
      type: "clip.insert",
      preconditions: [],
      arguments: {
        sequenceId: context.project.settings.defaultSequenceId,
        trackId: context.track.id,
        clip: inserted,
      },
    });
    const items = result.project.sequences[
      result.project.settings.defaultSequenceId
    ]!.tracks.find((track) => track.id === context.track.id)!.items;
    expect(
      items.find((item) => item.id === second.id)?.timelineRange.start.value,
    ).toBe(15);
    expect(items.find((item) => item.id === inserted.id)).toBeDefined();
  });

  it("overwrites the middle of a clip with deterministic left/right remainders", () => {
    const context = fixture();
    const original = clip(context, 0, 30);
    context.track.items.push(original);
    const replacement = clip(context, 10, 10, 200);
    const rightRemainderId = createId();
    const result = executeAndRestore(context.project, {
      operationId: createId(),
      type: "clip.overwrite",
      preconditions: [],
      arguments: {
        sequenceId: context.project.settings.defaultSequenceId,
        trackId: context.track.id,
        clip: replacement,
        rightRemainderId,
      },
    });
    const items = result.project.sequences[
      result.project.settings.defaultSequenceId
    ]!.tracks.find((track) => track.id === context.track.id)!.items;
    const left = items.find((item) => item.id === original.id);
    const right = items.find((item) => item.id === rightRemainderId);
    expect(left?.timelineRange).toMatchObject({
      start: { value: 0 },
      duration: { value: 10 },
    });
    expect(right?.timelineRange).toMatchObject({
      start: { value: 20 },
      duration: { value: 10 },
    });
    expect(right?.type === "clip" ? right.sourceRange.start.value : -1).toBe(
      20,
    );
  });

  it("ripple-deletes a clip and closes the exact timeline interval", () => {
    let seed = 0x5eed;
    const random = (): number => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      return seed;
    };
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const context = fixture();
      const firstDuration = 1 + (random() % 60);
      const removedDuration = 1 + (random() % 60);
      const lastDuration = 1 + (random() % 60);
      const first = clip(context, 0, firstDuration);
      const removed = clip(
        context,
        firstDuration,
        removedDuration,
        firstDuration,
      );
      const last = clip(
        context,
        firstDuration + removedDuration,
        lastDuration,
        firstDuration + removedDuration,
      );
      context.track.items.push(first, removed, last);
      const result = executeAndRestore(context.project, {
        operationId: createId(),
        type: "clip.ripple_delete",
        targetId: removed.id,
        preconditions: [],
        arguments: {
          sequenceId: context.project.settings.defaultSequenceId,
          trackId: context.track.id,
        },
      });
      const items = result.project.sequences[
        result.project.settings.defaultSequenceId
      ]!.tracks.find((track) => track.id === context.track.id)!.items;
      expect(items).toHaveLength(2);
      expect(
        items.find((item) => item.id === last.id)?.timelineRange.start.value,
      ).toBe(firstDuration);
    }
  });

  it("performs exact roll, slip, and slide edits", () => {
    const rollContext = fixture();
    const left = clip(rollContext, 0, 10, 0);
    const right = clip(rollContext, 10, 10, 10);
    rollContext.track.items.push(left, right);
    const rolled = executeAndRestore(rollContext.project, {
      operationId: createId(),
      type: "clip.roll",
      targetId: left.id,
      preconditions: [],
      arguments: {
        sequenceId: rollContext.project.settings.defaultSequenceId,
        trackId: rollContext.track.id,
        rightClipId: right.id,
        at: frameTime(12, { numerator: 30, denominator: 1 }),
      },
    });
    const rolledItems = rolled.project.sequences[
      rolled.project.settings.defaultSequenceId
    ]!.tracks.find((track) => track.id === rollContext.track.id)!.items;
    expect(rolledItems[0]?.timelineRange.duration.value).toBe(12);
    expect(rolledItems[1]?.timelineRange.start.value).toBe(12);
    expect(
      rolledItems[1]?.type === "clip"
        ? rolledItems[1].sourceRange.start.value
        : -1,
    ).toBe(12);

    const slipContext = fixture();
    const slippedClip = clip(slipContext, 0, 10, 0);
    slipContext.track.items.push(slippedClip);
    const slipped = executeAndRestore(slipContext.project, {
      operationId: createId(),
      type: "clip.slip",
      targetId: slippedClip.id,
      preconditions: [],
      arguments: {
        sequenceId: slipContext.project.settings.defaultSequenceId,
        trackId: slipContext.track.id,
        sourceStart: frameTime(25, { numerator: 30, denominator: 1 }),
      },
    });
    const slippedItem = slipped.project.sequences[
      slipped.project.settings.defaultSequenceId
    ]!.tracks.find((track) => track.id === slipContext.track.id)!.items[0];
    expect(
      slippedItem?.type === "clip" ? slippedItem.sourceRange.start.value : -1,
    ).toBe(25);

    const slideContext = fixture();
    const previous = clip(slideContext, 0, 10, 0);
    const middle = clip(slideContext, 10, 10, 10);
    const next = clip(slideContext, 20, 10, 20);
    slideContext.track.items.push(previous, middle, next);
    const slid = executeAndRestore(slideContext.project, {
      operationId: createId(),
      type: "clip.slide",
      targetId: middle.id,
      preconditions: [],
      arguments: {
        sequenceId: slideContext.project.settings.defaultSequenceId,
        trackId: slideContext.track.id,
        timelineStart: frameTime(12, { numerator: 30, denominator: 1 }),
      },
    });
    const slidItems = slid.project.sequences[
      slid.project.settings.defaultSequenceId
    ]!.tracks.find((track) => track.id === slideContext.track.id)!.items;
    expect(slidItems.map((item) => item.timelineRange.start.value)).toEqual([
      0, 12, 22,
    ]);
    expect(slidItems.map((item) => item.timelineRange.duration.value)).toEqual([
      12, 10, 8,
    ]);
  });

  it("links clips symmetrically and restores the whole sequence exactly", () => {
    const context = fixture();
    const sequence =
      context.project.sequences[context.project.settings.defaultSequenceId]!;
    const audioTrack = sequence.tracks.find(
      (candidate) => candidate.kind === "audio",
    )!;
    const video = clip(context, 0, 20);
    const audio = clip(context, 0, 20);
    context.track.items.push(video);
    audioTrack.items.push(audio);
    const result = executeAndRestore(context.project, {
      operationId: createId(),
      type: "clip.link",
      targetId: video.id,
      preconditions: [],
      arguments: {
        sequenceId: sequence.id,
        trackId: context.track.id,
        otherTrackId: audioTrack.id,
        otherClipId: audio.id,
      },
    });
    const resultSequence =
      result.project.sequences[result.project.settings.defaultSequenceId]!;
    const resultVideo = resultSequence.tracks
      .flatMap((track) => track.items)
      .find((item) => item.id === video.id);
    const resultAudio = resultSequence.tracks
      .flatMap((track) => track.items)
      .find((item) => item.id === audio.id);
    expect(resultVideo?.type === "clip" ? resultVideo.links : []).toEqual([
      audio.id,
    ]);
    expect(resultAudio?.type === "clip" ? resultAudio.links : []).toEqual([
      video.id,
    ]);
  });

  it("creates deterministic freeze, reverse, constant-speed, and speed-ramp maps", () => {
    const freezeContext = fixture();
    const frozenClip = clip(freezeContext, 0, 10, 20);
    freezeContext.track.items.push(frozenClip);
    const frozen = executeAndRestore(freezeContext.project, {
      operationId: createId(),
      type: "clip.freeze_frame",
      targetId: frozenClip.id,
      preconditions: [],
      arguments: {
        sequenceId: freezeContext.project.settings.defaultSequenceId,
        trackId: freezeContext.track.id,
        sourceTime: frameTime(25, { numerator: 30, denominator: 1 }),
        startKeyframeId: createId(),
        endKeyframeId: createId(),
      },
    });
    const frozenResult = frozen.project.sequences[
      frozen.project.settings.defaultSequenceId
    ]!.tracks.find((track) => track.id === freezeContext.track.id)!.items[0];
    expect(
      frozenResult?.type === "clip"
        ? frozenResult.timeMap.map((key) => key.value)
        : [],
    ).toEqual([25, 25]);

    const reverseContext = fixture();
    const reversedClip = clip(reverseContext, 0, 10, 20);
    reverseContext.track.items.push(reversedClip);
    const reversed = executeAndRestore(reverseContext.project, {
      operationId: createId(),
      type: "clip.reverse",
      targetId: reversedClip.id,
      preconditions: [],
      arguments: {
        sequenceId: reverseContext.project.settings.defaultSequenceId,
        trackId: reverseContext.track.id,
        startKeyframeId: createId(),
        endKeyframeId: createId(),
      },
    });
    const reversedResult = reversed.project.sequences[
      reversed.project.settings.defaultSequenceId
    ]!.tracks.find((track) => track.id === reverseContext.track.id)!.items[0];
    expect(
      reversedResult?.type === "clip"
        ? reversedResult.timeMap.map((key) => key.value)
        : [],
    ).toEqual([30, 20]);

    const speedContext = fixture();
    const speedClip = clip(speedContext, 0, 20, 40);
    speedContext.track.items.push(speedClip);
    const sped = executeAndRestore(speedContext.project, {
      operationId: createId(),
      type: "clip.speed.set",
      targetId: speedClip.id,
      preconditions: [],
      arguments: {
        sequenceId: speedContext.project.settings.defaultSequenceId,
        trackId: speedContext.track.id,
        speed: { numerator: 2, denominator: 1 },
        startKeyframeId: createId(),
        endKeyframeId: createId(),
      },
    });
    const spedResult = sped.project.sequences[
      sped.project.settings.defaultSequenceId
    ]!.tracks.find((track) => track.id === speedContext.track.id)!.items[0];
    expect(spedResult?.timelineRange.duration.value).toBe(10);

    const rampContext = fixture();
    const rampClip = clip(rampContext, 0, 20, 100);
    rampContext.track.items.push(rampClip);
    const ramped = executeAndRestore(rampContext.project, {
      operationId: createId(),
      type: "clip.speed_ramp.set",
      targetId: rampClip.id,
      preconditions: [],
      arguments: {
        sequenceId: rampContext.project.settings.defaultSequenceId,
        trackId: rampContext.track.id,
        timelineDuration: frameTime(15, { numerator: 30, denominator: 1 }),
        keyframes: [
          {
            id: createId(),
            time: frameTime(0, { numerator: 30, denominator: 1 }),
            value: 100,
            interpolation: "linear",
          },
          {
            id: createId(),
            time: frameTime(15, { numerator: 30, denominator: 1 }),
            value: 120,
            interpolation: "linear",
          },
        ],
      },
    });
    const rampedResult = ramped.project.sequences[
      ramped.project.settings.defaultSequenceId
    ]!.tracks.find((track) => track.id === rampContext.track.id)!.items[0];
    expect(rampedResult?.timelineRange.duration.value).toBe(15);
  });
});
