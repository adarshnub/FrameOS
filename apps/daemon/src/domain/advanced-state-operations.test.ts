import {
  createId,
  frameTime,
  type Asset,
  type Clip,
  type EffectInstance,
  type Operation,
} from "@frameos/contracts";
import { describe, expect, it } from "vitest";
import { createProject } from "./project-factory.js";
import { executeOperations } from "./operation-executor.js";

function fixture() {
  const project = createProject({ name: "Advanced state fixture" });
  const sequence = project.sequences[project.settings.defaultSequenceId]!;
  const track = sequence.tracks.find(
    (candidate) => candidate.kind === "video",
  )!;
  const makeAsset = (name: string): Asset => ({
    id: createId(),
    name,
    kind: "video",
    uri: `file:///fixture/${name}`,
    hash: `${createId().replaceAll("-", "")}abcdef0123456789`,
    managed: false,
    streams: [],
    duration: frameTime(1_000, sequence.format.frameRate),
    proxies: [],
    analysisRefs: [],
    licenseMetadata: {},
    semanticMetadata: {},
  });
  const firstAsset = makeAsset("one.mov");
  const secondAsset = makeAsset("two.mov");
  project.assets[firstAsset.id] = firstAsset;
  project.assets[secondAsset.id] = secondAsset;
  const effect: EffectInstance = {
    id: createId(),
    capabilityId: "mlt.filter.masked-test",
    version: "1",
    enabled: true,
    parameters: {},
    automationCurves: [],
  };
  const clip: Clip = {
    id: createId(),
    type: "clip",
    name: "Tracked shot",
    assetId: firstAsset.id,
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
    effects: [effect],
    audio: { gainDb: 0, pan: 0, muted: false, channelMap: [] },
    links: [],
    semanticMetadata: {},
  };
  track.items.push(clip);
  return { project, sequence, track, clip, effect, firstAsset, secondAsset };
}

function executeAndRestore(
  project: ReturnType<typeof fixture>["project"],
  operations: Operation[],
) {
  const executed = executeOperations(project, operations);
  const restored = executeOperations(
    executed.project,
    executed.inverseOperations,
  );
  expect(restored.project).toEqual(project);
  return executed.project;
}

describe("mask, tracking, and multicam state", () => {
  it("maintains a reversible clip/tracking/mask/effect reference chain", () => {
    const { project, sequence, track, clip, effect, firstAsset } = fixture();
    const trackedObjectId = createId();
    const maskId = createId();
    const trackedObject = {
      id: trackedObjectId,
      name: "Speaker face",
      assetId: firstAsset.id,
      sequenceId: sequence.id,
      itemId: clip.id,
      range: {
        start: frameTime(0, sequence.format.frameRate),
        duration: frameTime(100, sequence.format.frameRate),
      },
      samples: [
        {
          id: createId(),
          time: frameTime(0, sequence.format.frameRate),
          x: 0.2,
          y: 0.2,
          width: 0.3,
          height: 0.3,
          rotation: 0,
          confidence: 0.99,
          metadata: {},
        },
        {
          id: createId(),
          time: frameTime(99, sequence.format.frameRate),
          x: 0.25,
          y: 0.2,
          width: 0.3,
          height: 0.3,
          rotation: 1,
          confidence: 0.95,
          metadata: {},
        },
      ],
      analyzerId: "fixture.tracker",
      analyzerVersion: "1",
      metadata: {},
    };
    const mask = {
      id: maskId,
      name: "Face mask",
      kind: "ellipse" as const,
      coordinateSpace: "normalized" as const,
      enabled: true,
      inverted: false,
      feather: 0.1,
      opacity: 1,
      points: [
        { x: 0.2, y: 0.2 },
        { x: 0.5, y: 0.5 },
      ],
      keyframes: [],
      trackedObjectId,
      metadata: {},
    };
    const result = executeAndRestore(project, [
      {
        operationId: createId(),
        type: "video.track_object",
        targetId: clip.id,
        preconditions: [],
        arguments: {
          sequenceId: sequence.id,
          trackId: track.id,
          trackedObject,
        },
      },
      {
        operationId: createId(),
        type: "mask.add",
        preconditions: [],
        arguments: { mask },
      },
      {
        operationId: createId(),
        type: "effect.mask.attach",
        targetId: clip.id,
        preconditions: [],
        arguments: {
          sequenceId: sequence.id,
          trackId: track.id,
          effectId: effect.id,
          maskId,
        },
      },
      {
        operationId: createId(),
        type: "mask.feather.set",
        targetId: maskId,
        preconditions: [],
        arguments: { feather: 0.25 },
      },
      {
        operationId: createId(),
        type: "mask.invert.set",
        targetId: maskId,
        preconditions: [],
        arguments: { inverted: true },
      },
    ]);
    expect(result.trackedObjects[trackedObjectId]).toBeDefined();
    expect(result.masks[maskId]).toMatchObject({
      trackedObjectId,
      feather: 0.25,
      inverted: true,
    });
    const resultClip = result.sequences[
      result.settings.defaultSequenceId
    ]!.tracks.flatMap((candidate) => candidate.items).find(
      (item) => item.id === clip.id,
    );
    expect(
      resultClip !== undefined && "effects" in resultClip
        ? resultClip.effects[0]?.maskRef
        : undefined,
    ).toBe(maskId);
    expect(
      resultClip?.type === "clip"
        ? resultClip.semanticMetadata.trackedObjectIds
        : undefined,
    ).toEqual([trackedObjectId]);
  });

  it("creates, switches, and synchronizes a multicam group with signed offsets", () => {
    const { project, sequence, firstAsset, secondAsset } = fixture();
    const groupId = createId();
    const firstAngleId = createId();
    const secondAngleId = createId();
    const group = {
      id: groupId,
      name: "Interview cameras",
      sequenceId: sequence.id,
      syncMethod: "manual" as const,
      angles: [
        {
          id: firstAngleId,
          name: "Wide",
          assetId: firstAsset.id,
          sourceRange: {
            start: frameTime(0, sequence.format.frameRate),
            duration: frameTime(200, sequence.format.frameRate),
          },
          syncOffset: frameTime(0, sequence.format.frameRate),
          enabled: true,
          metadata: {},
        },
        {
          id: secondAngleId,
          name: "Close",
          assetId: secondAsset.id,
          sourceRange: {
            start: frameTime(0, sequence.format.frameRate),
            duration: frameTime(200, sequence.format.frameRate),
          },
          syncOffset: { value: 0, rate: sequence.format.frameRate },
          enabled: true,
          metadata: {},
        },
      ],
      activeAngleAutomation: [],
      metadata: {},
    };
    const switchId = createId();
    const result = executeAndRestore(project, [
      {
        operationId: createId(),
        type: "multicam.create",
        preconditions: [],
        arguments: { group },
      },
      {
        operationId: createId(),
        type: "multicam.angle.switch",
        targetId: groupId,
        preconditions: [],
        arguments: {
          angleId: secondAngleId,
          at: frameTime(60, sequence.format.frameRate),
          keyframeId: switchId,
        },
      },
      {
        operationId: createId(),
        type: "multicam.sync",
        targetId: groupId,
        preconditions: [],
        arguments: {
          angleId: secondAngleId,
          syncOffset: { value: -3, rate: sequence.format.frameRate },
          syncMethod: "audio",
        },
      },
    ]);
    const changed = result.multicamGroups[groupId]!;
    expect(changed.syncMethod).toBe("audio");
    expect(changed.angles[1]?.syncOffset.value).toBe(-3);
    expect(changed.activeAngleAutomation[0]).toMatchObject({
      id: switchId,
      value: secondAngleId,
      time: { value: 60 },
    });
  });

  it("rejects dangling mask tracking references", () => {
    const { project } = fixture();
    expect(() =>
      executeOperations(project, [
        {
          operationId: createId(),
          type: "mask.add",
          preconditions: [],
          arguments: {
            mask: {
              id: createId(),
              name: "Invalid mask",
              kind: "rectangle",
              coordinateSpace: "normalized",
              enabled: true,
              inverted: false,
              feather: 0,
              opacity: 1,
              points: [
                { x: 0, y: 0 },
                { x: 1, y: 1 },
              ],
              keyframes: [],
              trackedObjectId: createId(),
              metadata: {},
            },
          },
        },
      ]),
    ).toThrow(/missing tracked object/u);
  });
});
