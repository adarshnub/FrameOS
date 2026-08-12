import { createId, frameTime, type Clip } from "@frameos/contracts";
import { describe, expect, it } from "vitest";
import { createProject } from "../domain/project-factory.js";
import { exportOtio, importOtio } from "./otio.js";

describe("OpenTimelineIO interchange", () => {
  it("round-trips canonical FrameOS state through namespaced metadata", () => {
    const project = createProject({
      name: "Round trip",
      frameRate: { numerator: 24_000, denominator: 1_001 },
    });
    const sequence = project.sequences[project.settings.defaultSequenceId]!;
    const track = sequence.tracks.find(
      (candidate) => candidate.kind === "video",
    )!;
    const assetId = createId();
    project.assets[assetId] = {
      id: assetId,
      name: "shot.mov",
      kind: "video",
      uri: "file:///fixtures/shot.mov",
      hash: "0123456789abcdef0123456789abcdef",
      managed: false,
      streams: [],
      duration: frameTime(240, sequence.format.frameRate),
      proxies: [],
      analysisRefs: [],
      licenseMetadata: {},
      semanticMetadata: {},
    };
    const clip: Clip = {
      id: createId(),
      type: "clip",
      name: "Hero shot",
      assetId,
      sourceRange: {
        start: frameTime(12, sequence.format.frameRate),
        duration: frameTime(80, sequence.format.frameRate),
      },
      timelineRange: {
        start: frameTime(0, sequence.format.frameRate),
        duration: frameTime(80, sequence.format.frameRate),
      },
      enabled: true,
      locked: false,
      metadata: {},
      transform: {
        positionX: 100,
        positionY: 20,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: 0.8,
        scaleY: 0.8,
        rotation: 2,
        opacity: 0.9,
        cropTop: 0,
        cropRight: 0,
        cropBottom: 0,
        cropLeft: 0,
        blendMode: "normal",
      },
      timeMap: [],
      effects: [],
      audio: { gainDb: -3, pan: 0, muted: false, channelMap: [] },
      links: [],
      semanticMetadata: { subject: "speaker" },
    };
    track.items.push(clip);

    const exported = exportOtio(project);
    expect(exported.document.OTIO_SCHEMA).toBe("Timeline.1");
    expect(exported.report.approximated).toBeGreaterThan(0);

    const imported = importOtio(exported.document, "Imported copy");
    const restoredSequence =
      imported.project.sequences[imported.project.settings.defaultSequenceId]!;
    const restored = restoredSequence.tracks
      .flatMap((candidate) => candidate.items)
      .find((item) => item.id === clip.id);
    expect(imported.project.projectId).not.toBe(project.projectId);
    expect(imported.project.settings.name).toBe("Imported copy");
    expect(restored).toEqual(clip);
    expect(imported.report.approximated).toBe(1);
  });

  it("imports a standard OTIO clip and gap into a valid canonical timeline", () => {
    const otio = {
      OTIO_SCHEMA: "Timeline.1",
      name: "Editorial exchange",
      metadata: {},
      tracks: {
        OTIO_SCHEMA: "Stack.1",
        children: [
          {
            OTIO_SCHEMA: "Track.1",
            name: "V1",
            kind: "Video",
            children: [
              {
                OTIO_SCHEMA: "Clip.2",
                name: "Opening",
                source_range: {
                  OTIO_SCHEMA: "TimeRange.1",
                  start_time: {
                    OTIO_SCHEMA: "RationalTime.1",
                    value: 10,
                    rate: 24,
                  },
                  duration: {
                    OTIO_SCHEMA: "RationalTime.1",
                    value: 48,
                    rate: 24,
                  },
                },
                media_references: {
                  DEFAULT_MEDIA: {
                    OTIO_SCHEMA: "ExternalReference.1",
                    name: "opening.mov",
                    target_url: "file:///media/opening.mov",
                    available_range: {
                      OTIO_SCHEMA: "TimeRange.1",
                      start_time: {
                        OTIO_SCHEMA: "RationalTime.1",
                        value: 0,
                        rate: 24,
                      },
                      duration: {
                        OTIO_SCHEMA: "RationalTime.1",
                        value: 240,
                        rate: 24,
                      },
                    },
                  },
                },
                active_media_reference_key: "DEFAULT_MEDIA",
                effects: [],
                enabled: true,
              },
              {
                OTIO_SCHEMA: "Gap.1",
                name: "Pause",
                source_range: {
                  OTIO_SCHEMA: "TimeRange.1",
                  start_time: {
                    OTIO_SCHEMA: "RationalTime.1",
                    value: 0,
                    rate: 24,
                  },
                  duration: {
                    OTIO_SCHEMA: "RationalTime.1",
                    value: 12,
                    rate: 24,
                  },
                },
              },
            ],
          },
        ],
        metadata: {},
      },
    };

    const imported = importOtio(otio);
    const sequence =
      imported.project.sequences[imported.project.settings.defaultSequenceId]!;
    expect(sequence.format.frameRate).toEqual({
      numerator: 24,
      denominator: 1,
    });
    expect(sequence.tracks).toHaveLength(1);
    expect(sequence.tracks[0]?.items.map((item) => item.type)).toEqual([
      "clip",
      "gap",
    ]);
    expect(sequence.tracks[0]?.items[1]?.timelineRange.start.value).toBe(48);
    expect(Object.values(imported.project.assets)[0]?.uri).toBe(
      "file:///media/opening.mov",
    );
    expect(imported.report).toMatchObject({
      direction: "import",
      dropped: 0,
      unsupported: 0,
    });
  });
});
