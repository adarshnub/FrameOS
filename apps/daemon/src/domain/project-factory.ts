import {
  createId,
  frameTime,
  projectSchema,
  type Project,
  type RationalRate,
} from "@frameos/contracts";

export interface CreateProjectInput {
  name: string;
  width?: number;
  height?: number;
  frameRate?: RationalRate;
  sampleRate?: number;
  channels?: number;
}

export function createProject(input: CreateProjectInput): Project {
  const now = new Date().toISOString();
  const projectId = createId();
  const sequenceId = createId();
  const videoTrackId = createId();
  const audioTrackId = createId();
  const frameRate = input.frameRate ?? { numerator: 30, denominator: 1 };

  return projectSchema.parse({
    schemaVersion: "1.0.0",
    projectId,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    settings: {
      name: input.name,
      defaultSequenceId: sequenceId,
      timeDisplay: "timecode",
    },
    assets: {},
    sequences: {
      [sequenceId]: {
        id: sequenceId,
        name: "Main",
        format: {
          width: input.width ?? 1_920,
          height: input.height ?? 1_080,
          frameRate,
          sampleRate: input.sampleRate ?? 48_000,
          channels: input.channels ?? 2,
          pixelAspectRatio: { numerator: 1, denominator: 1 },
          colorSpace: "rec709",
        },
        tracks: [
          {
            id: videoTrackId,
            name: "V1",
            kind: "video",
            order: 1,
            enabled: true,
            locked: false,
            muted: false,
            syncLocked: true,
            items: [],
            effects: [],
            metadata: {},
          },
          {
            id: audioTrackId,
            name: "A1",
            kind: "audio",
            order: 0,
            enabled: true,
            locked: false,
            muted: false,
            syncLocked: true,
            items: [],
            effects: [],
            metadata: {},
          },
        ],
        markers: [],
        captions: [],
        buses: [],
        outputEffects: [],
        metadata: {
          createdAtFrame: frameTime(0, frameRate),
        },
      },
    },
    analyses: {},
    renderProfiles: {},
    metadata: {},
  });
}
