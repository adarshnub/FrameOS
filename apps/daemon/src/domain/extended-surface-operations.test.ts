import {
  createId,
  frameTime,
  type Asset,
  type AudioBus,
  type CaptionTrack,
  type EffectInstance,
  type Gap,
  type Marker,
  type Operation,
  type Project,
  type Title,
} from "@frameos/contracts";
import { describe, expect, it } from "vitest";
import { createProject } from "./project-factory.js";
import { executeOperations } from "./operation-executor.js";

function fixture() {
  const project = createProject({
    name: "Extended operation surface",
    frameRate: { numerator: 30, denominator: 1 },
  });
  const sequence = project.sequences[project.settings.defaultSequenceId]!;
  const videoTrack = sequence.tracks.find((track) => track.kind === "video")!;
  const asset: Asset = {
    id: createId(),
    name: "Interview",
    kind: "video",
    uri: "C:\\media\\interview.mp4",
    hash: "abcdef0123456789abcdef0123456789",
    managed: false,
    streams: [],
    duration: frameTime(600, sequence.format.frameRate),
    proxies: [],
    analysisRefs: [],
    licenseMetadata: {},
    semanticMetadata: {},
  };
  project.assets[asset.id] = asset;
  return { project, sequence, videoTrack, asset };
}

function expectExactInverse(project: Project, operations: Operation[]) {
  const executed = executeOperations(project, operations);
  expect(executed.inverseOperations).toHaveLength(operations.length);
  const restored = executeOperations(
    executed.project,
    executed.inverseOperations,
  );
  expect(restored.project).toEqual(project);
  return executed.project;
}

describe("extended low-level editor surface", () => {
  it("updates sequence color space and audio layout with exact inverses", () => {
    const { project, sequence } = fixture();
    const edited = expectExactInverse(project, [
      {
        operationId: createId(),
        type: "sequence.color_space.set",
        targetId: sequence.id,
        preconditions: [],
        arguments: { colorSpace: "rec2020-pq" },
      },
      {
        operationId: createId(),
        type: "sequence.audio_layout.set",
        targetId: sequence.id,
        preconditions: [],
        arguments: { sampleRate: 96_000, channels: 6 },
      },
    ]);
    expect(edited.sequences[sequence.id]?.format).toMatchObject({
      colorSpace: "rec2020-pq",
      sampleRate: 96_000,
      channels: 6,
    });
  });

  it("round-trips metadata, gaps, titles, track effects, buses, captions, and markers", () => {
    const { project, sequence, videoTrack, asset } = fixture();
    const gap: Gap = {
      id: createId(),
      type: "gap",
      name: "Intentional pause",
      timelineRange: {
        start: frameTime(100, sequence.format.frameRate),
        duration: frameTime(10, sequence.format.frameRate),
      },
      enabled: true,
      locked: false,
      metadata: {},
    };
    const title: Title = {
      id: createId(),
      type: "title",
      name: "Lower third",
      text: "Ada — Editor",
      timelineRange: {
        start: frameTime(120, sequence.format.frameRate),
        duration: frameTime(60, sequence.format.frameRate),
      },
      enabled: true,
      locked: false,
      metadata: {},
      style: { fontFamily: "Inter", fontSize: 48 },
      transform: {
        positionX: 0,
        positionY: 0.35,
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
      effects: [],
    };
    const updatedTitle: Title = {
      ...structuredClone(title),
      text: "Ada — Agent-native editor",
      style: { ...title.style, color: "#ffffff" },
    };
    const effect: EffectInstance = {
      id: createId(),
      capabilityId: "mlt.filter.test",
      version: "1.0.0",
      enabled: true,
      parameters: { amount: 0.25 },
      automationCurves: [],
    };
    const mainBus: AudioBus = {
      id: createId(),
      name: "Main",
      gainDb: 0,
      muted: false,
      effects: [],
    };
    const dialogBus: AudioBus = {
      id: createId(),
      name: "Dialog",
      gainDb: -1,
      muted: false,
      effects: [],
    };
    const marker: Marker = {
      id: createId(),
      name: "Review",
      range: {
        start: frameTime(200, sequence.format.frameRate),
        duration: frameTime(1, sequence.format.frameRate),
      },
      metadata: {},
    };
    const updatedMarker: Marker = {
      ...structuredClone(marker),
      name: "Client review",
      color: "amber",
    };
    const captions: CaptionTrack = {
      id: createId(),
      name: "English",
      language: "en",
      enabled: true,
      cues: [],
      style: {},
    };

    const edited = expectExactInverse(project, [
      {
        operationId: createId(),
        type: "asset.metadata.set",
        targetId: asset.id,
        preconditions: [],
        arguments: { values: { speaker: "Ada" }, replace: false },
      },
      {
        operationId: createId(),
        type: "asset.license.set",
        targetId: asset.id,
        preconditions: [],
        arguments: { values: { license: "CC-BY-4.0" }, replace: false },
      },
      {
        operationId: createId(),
        type: "asset.offline.set",
        targetId: asset.id,
        preconditions: [],
        arguments: { offline: true, unset: false },
      },
      {
        operationId: createId(),
        type: "gap.add",
        preconditions: [],
        arguments: {
          sequenceId: sequence.id,
          trackId: videoTrack.id,
          gap,
          index: 0,
        },
      },
      {
        operationId: createId(),
        type: "title.add",
        preconditions: [],
        arguments: {
          sequenceId: sequence.id,
          trackId: videoTrack.id,
          title,
          index: 1,
        },
      },
      {
        operationId: createId(),
        type: "title.update",
        targetId: title.id,
        preconditions: [],
        arguments: {
          sequenceId: sequence.id,
          trackId: videoTrack.id,
          title: updatedTitle,
        },
      },
      {
        operationId: createId(),
        type: "title.template.apply",
        targetId: title.id,
        preconditions: [],
        arguments: {
          sequenceId: sequence.id,
          trackId: videoTrack.id,
          templateId: "lower-third.clean",
          style: { accentColor: "#ffcc00" },
          replaceStyle: false,
        },
      },
      {
        operationId: createId(),
        type: "track.effect.add",
        targetId: videoTrack.id,
        preconditions: [],
        arguments: { sequenceId: sequence.id, effect, index: 0 },
      },
      {
        operationId: createId(),
        type: "effect.preset.apply",
        targetId: videoTrack.id,
        preconditions: [],
        arguments: {
          sequenceId: sequence.id,
          trackId: videoTrack.id,
          effectId: effect.id,
          parameters: { amount: 0.75, mix: 0.5 },
          replace: true,
        },
      },
      {
        operationId: createId(),
        type: "audio.bus.add",
        preconditions: [],
        arguments: { sequenceId: sequence.id, bus: mainBus, index: 0 },
      },
      {
        operationId: createId(),
        type: "audio.bus.add",
        preconditions: [],
        arguments: { sequenceId: sequence.id, bus: dialogBus, index: 1 },
      },
      {
        operationId: createId(),
        type: "audio.bus.route",
        targetId: dialogBus.id,
        preconditions: [],
        arguments: { sequenceId: sequence.id, outputBusId: mainBus.id },
      },
      {
        operationId: createId(),
        type: "marker.add",
        preconditions: [],
        arguments: { sequenceId: sequence.id, marker, index: 0 },
      },
      {
        operationId: createId(),
        type: "marker.update",
        targetId: marker.id,
        preconditions: [],
        arguments: { sequenceId: sequence.id, marker: updatedMarker },
      },
      {
        operationId: createId(),
        type: "marker.move",
        targetId: marker.id,
        preconditions: [],
        arguments: {
          sequenceId: sequence.id,
          range: {
            start: frameTime(240, sequence.format.frameRate),
            duration: frameTime(1, sequence.format.frameRate),
          },
        },
      },
      {
        operationId: createId(),
        type: "caption.track.add",
        preconditions: [],
        arguments: { sequenceId: sequence.id, track: captions, index: 0 },
      },
      {
        operationId: createId(),
        type: "caption.style.set",
        targetId: captions.id,
        preconditions: [],
        arguments: {
          sequenceId: sequence.id,
          style: { fontFamily: "Inter", background: "#000000cc" },
        },
      },
    ]);

    expect(edited.assets[asset.id]?.semanticMetadata.offline).toBe(true);
    expect(edited.sequences[sequence.id]?.tracks[0]?.items).toHaveLength(2);
    expect(
      edited.sequences[sequence.id]?.tracks[0]?.items.find(
        (item) => item.id === title.id && item.type === "title",
      ),
    ).toMatchObject({
      templateId: "lower-third.clean",
      style: { color: "#ffffff", accentColor: "#ffcc00" },
    });
    expect(edited.sequences[sequence.id]?.buses).toHaveLength(2);
    expect(edited.sequences[sequence.id]?.captions[0]?.style).toHaveProperty(
      "fontFamily",
      "Inter",
    );
  });

  it("preserves ordering when removing pre-existing state", () => {
    const { project, sequence, videoTrack } = fixture();
    const gaps = [0, 20, 40].map<Gap>((start, index) => ({
      id: createId(),
      type: "gap",
      name: `Gap ${index}`,
      timelineRange: {
        start: frameTime(start, sequence.format.frameRate),
        duration: frameTime(10, sequence.format.frameRate),
      },
      enabled: true,
      locked: false,
      metadata: {},
    }));
    videoTrack.items.push(...gaps);
    const captions = ["A", "B", "C"].map<CaptionTrack>((name) => ({
      id: createId(),
      name,
      language: "en",
      enabled: true,
      cues: [],
      style: {},
    }));
    sequence.captions.push(...captions);
    const markers = [0, 10, 20].map<Marker>((start, index) => ({
      id: createId(),
      name: `Marker ${index}`,
      range: {
        start: frameTime(start, sequence.format.frameRate),
        duration: frameTime(1, sequence.format.frameRate),
      },
      metadata: {},
    }));
    sequence.markers.push(...markers);

    expectExactInverse(project, [
      {
        operationId: createId(),
        type: "gap.remove",
        targetId: gaps[1]!.id,
        preconditions: [],
        arguments: { sequenceId: sequence.id, trackId: videoTrack.id },
      },
      {
        operationId: createId(),
        type: "caption.track.remove",
        targetId: captions[1]!.id,
        preconditions: [],
        arguments: { sequenceId: sequence.id },
      },
      {
        operationId: createId(),
        type: "marker.remove",
        targetId: markers[1]!.id,
        preconditions: [],
        arguments: { sequenceId: sequence.id },
      },
    ]);
  });

  it("duplicates and nests sequences without permitting recursive graphs", () => {
    const { project, sequence, videoTrack } = fixture();
    const duplicate = structuredClone(sequence);
    duplicate.id = createId();
    duplicate.name = "Reusable scene";
    for (const track of duplicate.tracks) track.id = createId();
    const nestedItem = {
      id: createId(),
      type: "nested_sequence" as const,
      name: "Reusable scene instance",
      sequenceId: duplicate.id,
      sourceRange: undefined,
      timelineRange: {
        start: frameTime(0, sequence.format.frameRate),
        duration: frameTime(90, sequence.format.frameRate),
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
      effects: [],
      audio: { gainDb: 0, pan: 0, muted: false, channelMap: [] },
    };
    const edited = expectExactInverse(project, [
      {
        operationId: createId(),
        type: "sequence.duplicate",
        targetId: sequence.id,
        preconditions: [],
        arguments: { sequence: duplicate },
      },
      {
        operationId: createId(),
        type: "sequence.nest",
        preconditions: [],
        arguments: {
          sequenceId: sequence.id,
          trackId: videoTrack.id,
          item: nestedItem,
          index: 0,
        },
      },
    ]);
    expect(edited.sequences[duplicate.id]?.name).toBe("Reusable scene");
    expect(edited.sequences[sequence.id]?.tracks[0]?.items[0]).toMatchObject({
      id: nestedItem.id,
      sequenceId: duplicate.id,
    });

    const duplicateVideoTrack = duplicate.tracks.find(
      (track) => track.kind === "video",
    )!;
    expect(() =>
      executeOperations(edited, [
        {
          operationId: createId(),
          type: "sequence.nest",
          preconditions: [],
          arguments: {
            sequenceId: duplicate.id,
            trackId: duplicateVideoTrack.id,
            item: {
              ...structuredClone(nestedItem),
              id: createId(),
              sequenceId: sequence.id,
            },
          },
        },
      ]),
    ).toThrow(/cycle/u);
  });
});
