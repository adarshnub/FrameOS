import {
  createId,
  frameTime,
  type EffectInstance,
  type Operation,
} from "@frameos/contracts";
import { describe, expect, it } from "vitest";
import { createProject } from "./project-factory.js";
import { executeOperations } from "./operation-executor.js";

describe("normalized audio processing operations", () => {
  it("persists a complete reversible output processing chain", () => {
    const project = createProject({ name: "Audio processing" });
    const sequence = project.sequences[project.settings.defaultSequenceId]!;
    const audioTrack = sequence.tracks.find((track) => track.kind === "audio")!;
    const effect: EffectInstance = {
      id: createId(),
      capabilityId: "frameos.audio.channel-strip",
      version: "1.0.0",
      enabled: true,
      parameters: { preserved: "yes" },
      automationCurves: [],
    };
    sequence.outputEffects.push(effect);
    const target = { sequenceId: sequence.id, effectId: effect.id };
    const fadeId = createId();
    const eqBandId = createId();
    const operations: Operation[] = [
      {
        operationId: createId(),
        type: "audio.fade.add",
        targetId: sequence.id,
        preconditions: [],
        arguments: {
          ...target,
          fade: {
            id: fadeId,
            kind: "in",
            duration: frameTime(15, sequence.format.frameRate),
            curve: "equal_power",
          },
        },
      },
      {
        operationId: createId(),
        type: "audio.fade.remove",
        targetId: sequence.id,
        preconditions: [],
        arguments: { ...target, fadeId },
      },
      {
        operationId: createId(),
        type: "audio.fade.add",
        targetId: sequence.id,
        preconditions: [],
        arguments: {
          ...target,
          fade: {
            id: fadeId,
            kind: "in",
            duration: frameTime(15, sequence.format.frameRate),
            curve: "equal_power",
          },
        },
      },
      {
        operationId: createId(),
        type: "audio.normalize",
        targetId: sequence.id,
        preconditions: [],
        arguments: {
          ...target,
          targetLufs: -16,
          truePeakDb: -1,
          mode: "dialogue",
        },
      },
      {
        operationId: createId(),
        type: "audio.eq.set",
        targetId: sequence.id,
        preconditions: [],
        arguments: {
          ...target,
          bands: [
            {
              id: eqBandId,
              kind: "bell",
              frequencyHz: 3_000,
              gainDb: 2.5,
              q: 1.2,
              enabled: true,
            },
          ],
        },
      },
      {
        operationId: createId(),
        type: "audio.compress",
        targetId: sequence.id,
        preconditions: [],
        arguments: {
          ...target,
          thresholdDb: -18,
          ratio: 3,
          attackMs: 15,
          releaseMs: 120,
          kneeDb: 6,
          makeupGainDb: 2,
        },
      },
      {
        operationId: createId(),
        type: "audio.limit",
        targetId: sequence.id,
        preconditions: [],
        arguments: {
          ...target,
          ceilingDb: -1,
          releaseMs: 80,
          lookaheadMs: 5,
        },
      },
      {
        operationId: createId(),
        type: "audio.denoise",
        targetId: sequence.id,
        preconditions: [],
        arguments: { ...target, amount: 0.4 },
      },
      {
        operationId: createId(),
        type: "audio.duck",
        targetId: sequence.id,
        preconditions: [],
        arguments: {
          ...target,
          sidechainId: audioTrack.id,
          reductionDb: 9,
          thresholdDb: -30,
          attackMs: 20,
          releaseMs: 250,
        },
      },
      {
        operationId: createId(),
        type: "audio.enhance_voice",
        targetId: sequence.id,
        preconditions: [],
        arguments: { ...target, amount: 0.65, preserveAmbience: true },
      },
    ];

    const result = executeOperations(project, operations);
    const parameters =
      result.project.sequences[sequence.id]!.outputEffects[0]!.parameters;
    expect(parameters).toMatchObject({
      preserved: "yes",
      normalization: { targetLufs: -16, truePeakDb: -1, mode: "dialogue" },
      eq: { bands: [{ id: eqBandId, frequencyHz: 3_000 }] },
      compressor: { thresholdDb: -18, ratio: 3 },
      limiter: { ceilingDb: -1 },
      denoise: { amount: 0.4 },
      ducking: { sidechainId: audioTrack.id, reductionDb: 9 },
      voiceEnhancement: { amount: 0.65, preserveAmbience: true },
    });
    expect(parameters.fades).toEqual([
      expect.objectContaining({ id: fadeId, curve: "equal_power" }),
    ]);
    expect(
      executeOperations(result.project, result.inverseOperations).project,
    ).toEqual(project);
  });
});
