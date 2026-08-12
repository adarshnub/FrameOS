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

function colorFixture(): {
  project: Project;
  clip: Clip;
  trackId: string;
  effect: EffectInstance;
} {
  const project = createProject({ name: "Color fixture" });
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
  const effect: EffectInstance = {
    id: createId(),
    capabilityId: "frameos.color.primary",
    version: "1.0.0",
    enabled: true,
    parameters: { preserved: true },
    automationCurves: [],
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
    effects: [effect],
    audio: { gainDb: 0, pan: 0, muted: false, channelMap: [] },
    links: [],
    semanticMetadata: {},
  };
  track.items.push(clip);
  return { project, clip, trackId: track.id, effect };
}

describe("normalized color operations", () => {
  it("updates a complete color pipeline and restores exact state through inverses", () => {
    const { project, clip, trackId, effect } = colorFixture();
    const sequenceId = project.settings.defaultSequenceId;
    const target = { sequenceId, trackId, effectId: effect.id };
    const operations: Operation[] = [
      {
        operationId: createId(),
        type: "color.exposure.set",
        targetId: clip.id,
        preconditions: [],
        arguments: { ...target, stops: 1.25 },
      },
      {
        operationId: createId(),
        type: "color.contrast.set",
        targetId: clip.id,
        preconditions: [],
        arguments: { ...target, contrast: 1.15 },
      },
      {
        operationId: createId(),
        type: "color.saturation.set",
        targetId: clip.id,
        preconditions: [],
        arguments: { ...target, saturation: 0.9 },
      },
      {
        operationId: createId(),
        type: "color.white_balance.set",
        targetId: clip.id,
        preconditions: [],
        arguments: { ...target, temperatureKelvin: 5_600, tint: 0.1 },
      },
      {
        operationId: createId(),
        type: "color.curves.set",
        targetId: clip.id,
        preconditions: [],
        arguments: {
          ...target,
          channel: "luma",
          points: [
            { input: 0, output: 0 },
            { input: 0.5, output: 0.55 },
            { input: 1, output: 1 },
          ],
        },
      },
      {
        operationId: createId(),
        type: "color.lift_gamma_gain.set",
        targetId: clip.id,
        preconditions: [],
        arguments: {
          ...target,
          lift: [0, 0.01, 0],
          gamma: [1, 1, 1],
          gain: [1.05, 1, 0.98],
        },
      },
      {
        operationId: createId(),
        type: "color.lut.apply",
        targetId: clip.id,
        preconditions: [],
        arguments: {
          ...target,
          uri: "frameos://projects/example/assets/look.cube",
          intensity: 0.75,
          interpolation: "tetrahedral",
        },
      },
      {
        operationId: createId(),
        type: "color.lut.remove",
        targetId: clip.id,
        preconditions: [],
        arguments: target,
      },
      {
        operationId: createId(),
        type: "color.lut.apply",
        targetId: clip.id,
        preconditions: [],
        arguments: {
          ...target,
          uri: "frameos://projects/example/assets/look.cube",
          intensity: 0.75,
          interpolation: "tetrahedral",
        },
      },
      {
        operationId: createId(),
        type: "color.ocio_transform.set",
        targetId: clip.id,
        preconditions: [],
        arguments: {
          ...target,
          sourceSpace: "ACEScg",
          destinationSpace: "Output - Rec.709",
          display: "sRGB",
          view: "ACES 1.3",
        },
      },
      {
        operationId: createId(),
        type: "color.space.set",
        targetId: sequenceId,
        preconditions: [],
        arguments: { colorSpace: "acescg" },
      },
      {
        operationId: createId(),
        type: "color.hdr_metadata.set",
        targetId: sequenceId,
        preconditions: [],
        arguments: { metadata: { maxCll: 1_000, maxFall: 400 } },
      },
    ];
    const result = executeOperations(project, operations);
    const updatedSequence = result.project.sequences[sequenceId]!;
    const updatedClip = updatedSequence.tracks
      .flatMap((track) => track.items)
      .find(
        (item): item is Clip => item.id === clip.id && item.type === "clip",
      )!;
    expect(updatedClip.effects[0]?.parameters).toMatchObject({
      preserved: true,
      exposureStops: 1.25,
      contrast: 1.15,
      saturation: 0.9,
      whiteBalance: { temperatureKelvin: 5_600, tint: 0.1 },
      lut: { intensity: 0.75, interpolation: "tetrahedral" },
      ocioTransform: {
        sourceSpace: "ACEScg",
        destinationSpace: "Output - Rec.709",
      },
    });
    expect(updatedSequence.format.colorSpace).toBe("acescg");
    expect(updatedSequence.metadata.hdr).toEqual({
      maxCll: 1_000,
      maxFall: 400,
    });
    expect(
      executeOperations(result.project, result.inverseOperations).project,
    ).toEqual(project);
  });

  it("does not apply normalized color controls to an unrelated effect", () => {
    const { project, clip, trackId, effect } = colorFixture();
    effect.capabilityId = "frameos.audio.eq";
    expect(() =>
      executeOperations(project, [
        {
          operationId: createId(),
          type: "color.exposure.set",
          targetId: clip.id,
          preconditions: [],
          arguments: {
            sequenceId: project.settings.defaultSequenceId,
            trackId,
            effectId: effect.id,
            stops: 1,
          },
        },
      ]),
    ).toThrow(/not a normalized FrameOS color effect/u);
  });
});
