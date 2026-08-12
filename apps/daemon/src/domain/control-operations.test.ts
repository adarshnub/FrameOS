import {
  createId,
  frameTime,
  type Clip,
  type EffectInstance,
  type Operation,
  type Project,
} from "@frameos/contracts";
import { describe, expect, it } from "vitest";
import { createProject } from "./project-factory.js";
import { executeOperations } from "./operation-executor.js";

function projectWithClip(): { project: Project; clip: Clip; trackId: string } {
  const project = createProject({ name: "Control fixture" });
  const sequence = project.sequences[project.settings.defaultSequenceId]!;
  const track = sequence.tracks.find(
    (candidate) => candidate.kind === "video",
  )!;
  const assetId = createId();
  project.assets[assetId] = {
    id: assetId,
    name: "source.mov",
    kind: "video",
    uri: "file:///fixture/source.mov",
    hash: "0123456789abcdef0123456789abcdef",
    managed: false,
    streams: [],
    duration: frameTime(1_000, sequence.format.frameRate),
    proxies: [],
    analysisRefs: [],
    licenseMetadata: {},
    semanticMetadata: {},
  };
  const clip: Clip = {
    id: createId(),
    type: "clip",
    name: "Source",
    assetId,
    sourceRange: {
      start: frameTime(0, sequence.format.frameRate),
      duration: frameTime(100, sequence.format.frameRate),
    },
    timelineRange: {
      start: frameTime(0, sequence.format.frameRate),
      duration: frameTime(100, sequence.format.frameRate),
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
  track.items.push(clip);
  return { project, clip, trackId: track.id };
}

function expectExactInverse(project: Project, operations: Operation[]) {
  const result = executeOperations(project, operations);
  expect(
    executeOperations(result.project, result.inverseOperations).project,
  ).toEqual(project);
  return result.project;
}

describe("fine-grained editor controls", () => {
  it("registers and removes asset proxies with exact inverses", () => {
    const { project, clip } = projectWithClip();
    const asset = project.assets[clip.assetId]!;
    const proxyUri = `frameos://projects/${project.projectId}/assets/${asset.id}-proxy-0123456789abcdef.mp4`;
    const registered = expectExactInverse(project, [
      {
        operationId: createId(),
        type: "asset.proxy.create",
        targetId: asset.id,
        preconditions: [],
        arguments: { uri: proxyUri },
      },
    ]);
    expect(registered.assets[asset.id]?.proxies).toEqual([proxyUri]);

    const removed = expectExactInverse(registered, [
      {
        operationId: createId(),
        type: "asset.proxy.remove",
        targetId: asset.id,
        preconditions: [],
        arguments: { uri: proxyUri },
      },
    ]);
    expect(removed.assets[asset.id]?.proxies).toEqual([]);
  });

  it("updates transform and audio properties without replacing a clip", () => {
    const { project, clip, trackId } = projectWithClip();
    const target = {
      sequenceId: project.settings.defaultSequenceId,
      trackId,
    };
    const result = expectExactInverse(project, [
      {
        operationId: createId(),
        type: "video.position.set",
        targetId: clip.id,
        preconditions: [],
        arguments: { ...target, x: 320, y: 180 },
      },
      {
        operationId: createId(),
        type: "video.crop.set",
        targetId: clip.id,
        preconditions: [],
        arguments: { ...target, top: 0.1, right: 0.2, bottom: 0.3, left: 0.4 },
      },
      {
        operationId: createId(),
        type: "video.opacity.set",
        targetId: clip.id,
        preconditions: [],
        arguments: { ...target, opacity: 0.75 },
      },
      {
        operationId: createId(),
        type: "audio.pan.set",
        targetId: clip.id,
        preconditions: [],
        arguments: { ...target, pan: -0.25 },
      },
      {
        operationId: createId(),
        type: "audio.channel_map.set",
        targetId: clip.id,
        preconditions: [],
        arguments: { ...target, channelMap: [1, 0] },
      },
    ]);
    const changed = result.sequences[
      result.settings.defaultSequenceId
    ]!.tracks.flatMap((track) => track.items).find(
      (item) => item.id === clip.id,
    );
    expect(changed?.type === "clip" ? changed.transform.positionX : 0).toBe(
      320,
    );
    expect(changed?.type === "clip" ? changed.transform.cropLeft : 0).toBe(0.4);
    expect(changed?.type === "clip" ? changed.audio.channelMap : []).toEqual([
      1, 0,
    ]);
  });

  it("snaps a clip and applies a reversible picture-in-picture preset", () => {
    const { project, clip, trackId } = projectWithClip();
    const sequence = project.sequences[project.settings.defaultSequenceId]!;
    const result = expectExactInverse(project, [
      {
        operationId: createId(),
        type: "clip.snap",
        targetId: clip.id,
        preconditions: [],
        arguments: {
          sequenceId: sequence.id,
          trackId,
          timelineStart: frameTime(20, sequence.format.frameRate),
        },
      },
      {
        operationId: createId(),
        type: "video.picture_in_picture.apply",
        targetId: clip.id,
        preconditions: [],
        arguments: {
          sequenceId: sequence.id,
          trackId,
          corner: "bottom_right",
          scale: 0.25,
          marginPixels: 48,
          opacity: 0.8,
        },
      },
    ]);
    const changed = result.sequences[sequence.id]!.tracks.flatMap(
      (track) => track.items,
    ).find((item) => item.id === clip.id);
    expect(changed?.timelineRange.start.value).toBe(20);
    expect(
      changed?.type === "clip" ? changed.transform : undefined,
    ).toMatchObject({
      positionX: 672,
      positionY: 357,
      scaleX: 0.25,
      scaleY: 0.25,
      opacity: 0.8,
    });
  });

  it("reorders a clip in its track without changing timing", () => {
    const { project, clip, trackId } = projectWithClip();
    const sequence = project.sequences[project.settings.defaultSequenceId]!;
    const track = sequence.tracks.find(
      (candidate) => candidate.id === trackId,
    )!;
    const second = structuredClone(clip);
    second.id = createId();
    second.name = "Second";
    second.timelineRange.start = frameTime(100, sequence.format.frameRate);
    second.sourceRange.start = frameTime(100, sequence.format.frameRate);
    track.items.push(second);
    const groupId = createId();
    const edited = expectExactInverse(project, [
      {
        operationId: createId(),
        type: "clip.reorder",
        targetId: clip.id,
        preconditions: [],
        arguments: { sequenceId: sequence.id, trackId, index: 1 },
      },
      {
        operationId: createId(),
        type: "clip.group",
        preconditions: [],
        arguments: {
          group: {
            id: groupId,
            name: "Interview pair",
            sequenceId: sequence.id,
            itemIds: [clip.id, second.id],
            metadata: {},
          },
        },
      },
    ]);
    expect(
      edited.sequences[sequence.id]?.tracks[0]?.items.map((item) => item.id),
    ).toEqual([second.id, clip.id]);
    expect(edited.itemGroups[groupId]?.itemIds).toEqual([clip.id, second.id]);
  });

  it("reorders and controls tracks with reversible state changes", () => {
    const { project, trackId } = projectWithClip();
    const sequence = project.sequences[project.settings.defaultSequenceId]!;
    const busId = createId();
    sequence.buses.push({
      id: busId,
      name: "Program",
      gainDb: 0,
      muted: false,
      effects: [],
    });
    const result = expectExactInverse(project, [
      {
        operationId: createId(),
        type: "track.reorder",
        targetId: trackId,
        preconditions: [],
        arguments: { sequenceId: sequence.id, order: 0 },
      },
      {
        operationId: createId(),
        type: "track.lock",
        targetId: trackId,
        preconditions: [],
        arguments: { sequenceId: sequence.id },
      },
      {
        operationId: createId(),
        type: "track.mute",
        targetId: trackId,
        preconditions: [],
        arguments: { sequenceId: sequence.id },
      },
      {
        operationId: createId(),
        type: "track.sync_lock",
        targetId: trackId,
        preconditions: [],
        arguments: { sequenceId: sequence.id, enabled: false },
      },
      {
        operationId: createId(),
        type: "track.bus.assign",
        targetId: trackId,
        preconditions: [],
        arguments: { sequenceId: sequence.id, busId },
      },
    ]);
    const changed = result.sequences[
      result.settings.defaultSequenceId
    ]!.tracks.find((track) => track.id === trackId)!;
    expect(changed).toMatchObject({
      order: 0,
      locked: true,
      muted: true,
      syncLocked: false,
      busId,
    });
  });

  it("controls effect stacks, parameters, ranges, and automation keyframes", () => {
    const { project, clip, trackId } = projectWithClip();
    const curveId = createId();
    const firstEffect: EffectInstance = {
      id: createId(),
      capabilityId: "mlt.filter.brightness",
      version: "1",
      enabled: true,
      parameters: {},
      automationCurves: [{ id: curveId, parameter: "level", keyframes: [] }],
    };
    const secondEffect: EffectInstance = {
      id: createId(),
      capabilityId: "mlt.filter.saturation",
      version: "1",
      enabled: true,
      parameters: {},
      automationCurves: [],
    };
    clip.effects.push(firstEffect, secondEffect);
    const keyframeId = createId();
    const base = {
      sequenceId: project.settings.defaultSequenceId,
      trackId,
      effectId: firstEffect.id,
    };
    const result = expectExactInverse(project, [
      {
        operationId: createId(),
        type: "effect.disable",
        targetId: clip.id,
        preconditions: [],
        arguments: base,
      },
      {
        operationId: createId(),
        type: "effect.reorder",
        targetId: clip.id,
        preconditions: [],
        arguments: { ...base, index: 1 },
      },
      {
        operationId: createId(),
        type: "effect.parameter.set",
        targetId: clip.id,
        preconditions: [],
        arguments: { ...base, parameter: "level", value: 0.5, unset: false },
      },
      {
        operationId: createId(),
        type: "effect.range.set",
        targetId: clip.id,
        preconditions: [],
        arguments: {
          ...base,
          range: {
            start: frameTime(10, { numerator: 30, denominator: 1 }),
            duration: frameTime(20, { numerator: 30, denominator: 1 }),
          },
        },
      },
      {
        operationId: createId(),
        type: "keyframe.add",
        targetId: clip.id,
        preconditions: [],
        arguments: {
          ...base,
          curveId,
          keyframe: {
            id: keyframeId,
            time: frameTime(5, { numerator: 30, denominator: 1 }),
            value: 0.25,
            interpolation: "linear",
          },
        },
      },
      {
        operationId: createId(),
        type: "keyframe.move",
        targetId: clip.id,
        preconditions: [],
        arguments: {
          ...base,
          curveId,
          keyframeId,
          time: frameTime(8, { numerator: 30, denominator: 1 }),
        },
      },
      {
        operationId: createId(),
        type: "keyframe.value.set",
        targetId: clip.id,
        preconditions: [],
        arguments: { ...base, curveId, keyframeId, value: 0.9 },
      },
      {
        operationId: createId(),
        type: "keyframe.interpolation.set",
        targetId: clip.id,
        preconditions: [],
        arguments: {
          ...base,
          curveId,
          keyframeId,
          interpolation: "smooth",
        },
      },
    ]);
    const changed = result.sequences[
      result.settings.defaultSequenceId
    ]!.tracks.flatMap((track) => track.items).find(
      (item) => item.id === clip.id,
    );
    const effects =
      changed !== undefined && "effects" in changed ? changed.effects : [];
    expect(effects.map((effect) => effect.id)).toEqual([
      secondEffect.id,
      firstEffect.id,
    ]);
    expect(effects[1]).toMatchObject({
      enabled: false,
      parameters: { level: 0.5 },
    });
    expect(effects[1]?.automationCurves[0]?.keyframes[0]).toMatchObject({
      id: keyframeId,
      time: { value: 8 },
      value: 0.9,
      interpolation: "smooth",
    });
  });

  it("adds, edits, and removes a transition with exact inverse restoration", () => {
    const { project, clip: left, trackId } = projectWithClip();
    const sequence = project.sequences[project.settings.defaultSequenceId]!;
    left.timelineRange.duration = frameTime(50, sequence.format.frameRate);
    left.sourceRange.duration = frameTime(50, sequence.format.frameRate);
    const right = structuredClone(left);
    right.id = createId();
    right.name = "Right";
    right.timelineRange.start = frameTime(50, sequence.format.frameRate);
    right.sourceRange.start = frameTime(50, sequence.format.frameRate);
    sequence.tracks.find((track) => track.id === trackId)!.items.push(right);
    const transitionId = createId();
    const curveId = createId();
    const transitionKeyframeId = createId();
    const transition = {
      id: transitionId,
      type: "transition" as const,
      name: "Dissolve",
      timelineRange: {
        start: frameTime(45, sequence.format.frameRate),
        duration: frameTime(10, sequence.format.frameRate),
      },
      enabled: true,
      locked: false,
      metadata: {},
      capabilityId: "frameos.transition.dissolve",
      fromItemId: left.id,
      toItemId: right.id,
      parameters: {},
      automationCurves: [{ id: curveId, parameter: "softness", keyframes: [] }],
    };
    const result = expectExactInverse(project, [
      {
        operationId: createId(),
        type: "transition.add",
        preconditions: [],
        arguments: { sequenceId: sequence.id, trackId, transition },
      },
      {
        operationId: createId(),
        type: "transition.parameter.set",
        targetId: transitionId,
        preconditions: [],
        arguments: {
          sequenceId: sequence.id,
          trackId,
          parameter: "softness",
          value: 0.2,
          unset: false,
        },
      },
      {
        operationId: createId(),
        type: "transition.duration.set",
        targetId: transitionId,
        preconditions: [],
        arguments: {
          sequenceId: sequence.id,
          trackId,
          duration: frameTime(8, sequence.format.frameRate),
        },
      },
      {
        operationId: createId(),
        type: "transition.keyframe.add",
        targetId: transitionId,
        preconditions: [],
        arguments: {
          sequenceId: sequence.id,
          trackId,
          curveId,
          keyframe: {
            id: transitionKeyframeId,
            time: frameTime(4, sequence.format.frameRate),
            value: 0.75,
            interpolation: "linear",
          },
        },
      },
    ]);
    const changed = result.sequences[
      result.settings.defaultSequenceId
    ]!.tracks.flatMap((track) => track.items).find(
      (item) => item.id === transitionId,
    );
    expect(
      changed?.type === "transition" ? changed.parameters.softness : null,
    ).toBe(0.2);
    expect(changed?.timelineRange.duration.value).toBe(8);
    expect(
      changed?.type === "transition"
        ? changed.automationCurves[0]?.keyframes[0]?.id
        : undefined,
    ).toBe(transitionKeyframeId);
  });

  it("rejects a transition that does not straddle its endpoint edit", () => {
    const { project, clip: left, trackId } = projectWithClip();
    const sequence = project.sequences[project.settings.defaultSequenceId]!;
    left.timelineRange.duration = frameTime(50, sequence.format.frameRate);
    left.sourceRange.duration = frameTime(50, sequence.format.frameRate);
    const right = structuredClone(left);
    right.id = createId();
    right.name = "Right";
    right.timelineRange.start = frameTime(50, sequence.format.frameRate);
    right.sourceRange.start = frameTime(50, sequence.format.frameRate);
    sequence.tracks.find((track) => track.id === trackId)!.items.push(right);

    expect(() =>
      executeOperations(project, [
        {
          operationId: createId(),
          type: "transition.add",
          preconditions: [],
          arguments: {
            sequenceId: sequence.id,
            trackId,
            transition: {
              id: createId(),
              type: "transition",
              name: "Invalid dissolve",
              timelineRange: {
                start: frameTime(50, sequence.format.frameRate),
                duration: frameTime(10, sequence.format.frameRate),
              },
              enabled: true,
              locked: false,
              metadata: {},
              capabilityId: "frameos.transition.dissolve",
              fromItemId: left.id,
              toItemId: right.id,
              parameters: {},
              automationCurves: [],
            },
          },
        },
      ]),
    ).toThrow(/straddle the edit point/u);
  });
});
