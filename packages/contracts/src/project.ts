import { z } from "zod";
import {
  rationalRateSchema,
  rationalTimeSchema,
  signedRationalTimeSchema,
  timeRangeSchema,
} from "./time.js";

export const entityIdSchema = z.string().uuid();
export const metadataSchema = z.record(z.string(), z.unknown());

export const interpolationSchema = z.enum([
  "hold",
  "linear",
  "bezier",
  "smooth",
]);

export const keyframeSchema = z
  .object({
    id: entityIdSchema,
    time: rationalTimeSchema,
    value: z.union([
      z.number().finite(),
      z.string().max(16_384),
      z.boolean(),
      z.array(z.number().finite()).max(16),
    ]),
    interpolation: interpolationSchema.default("linear"),
    inTangent: z.number().finite().optional(),
    outTangent: z.number().finite().optional(),
  })
  .strict();

export const automationCurveSchema = z
  .object({
    id: entityIdSchema,
    parameter: z.string().min(1).max(256),
    keyframes: z.array(keyframeSchema).max(100_000),
  })
  .strict();

export const effectInstanceSchema = z
  .object({
    id: entityIdSchema,
    capabilityId: z.string().min(1).max(512),
    version: z.string().min(1).max(64),
    enabled: z.boolean().default(true),
    range: timeRangeSchema.optional(),
    parameters: metadataSchema.default({}),
    automationCurves: z.array(automationCurveSchema).default([]),
    maskRef: entityIdSchema.optional(),
  })
  .strict();

export const streamSchema = z
  .object({
    index: z.int().nonnegative(),
    kind: z.enum(["video", "audio", "subtitle", "data"]),
    codec: z.string().min(1).max(128),
    duration: rationalTimeSchema.optional(),
    width: z.int().positive().max(65_535).optional(),
    height: z.int().positive().max(65_535).optional(),
    frameRate: rationalRateSchema.optional(),
    sampleRate: z.int().positive().max(768_000).optional(),
    channels: z.int().positive().max(128).optional(),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const analysisArtifactSchema = z
  .object({
    id: entityIdSchema,
    analyzerId: z.string().min(1).max(256),
    analyzerVersion: z.string().min(1).max(64),
    parametersHash: z.string().length(64).optional(),
    modelHash: z.string().max(256).optional(),
    binaryHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    bundleHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    assetHash: z.string().min(16).max(256),
    type: z.string().min(1).max(128),
    timeRanges: z.array(timeRangeSchema).default([]),
    dataUri: z.string().min(1).max(8_192),
    createdAt: z.string().datetime(),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const assetSchema = z
  .object({
    id: entityIdSchema,
    name: z.string().min(1).max(1_024),
    kind: z.enum([
      "video",
      "audio",
      "image",
      "image_sequence",
      "subtitle",
      "font",
      "generated",
    ]),
    uri: z.string().min(1).max(32_768),
    hash: z.string().min(16).max(256),
    managed: z.boolean().default(false),
    streams: z.array(streamSchema).default([]),
    duration: rationalTimeSchema.optional(),
    proxies: z.array(z.string().min(1).max(32_768)).default([]),
    analysisRefs: z.array(entityIdSchema).default([]),
    licenseMetadata: metadataSchema.default({}),
    semanticMetadata: metadataSchema.default({}),
  })
  .strict();

export const transformSchema = z
  .object({
    positionX: z.number().finite().default(0),
    positionY: z.number().finite().default(0),
    anchorX: z.number().finite().default(0.5),
    anchorY: z.number().finite().default(0.5),
    scaleX: z.number().finite().min(-100).max(100).default(1),
    scaleY: z.number().finite().min(-100).max(100).default(1),
    rotation: z.number().finite().default(0),
    opacity: z.number().finite().min(0).max(1).default(1),
    cropTop: z.number().finite().min(0).max(1).default(0),
    cropRight: z.number().finite().min(0).max(1).default(0),
    cropBottom: z.number().finite().min(0).max(1).default(0),
    cropLeft: z.number().finite().min(0).max(1).default(0),
    blendMode: z.string().min(1).max(128).default("normal"),
  })
  .strict();

export const audioPropertiesSchema = z
  .object({
    gainDb: z.number().finite().min(-120).max(48).default(0),
    pan: z.number().finite().min(-1).max(1).default(0),
    muted: z.boolean().default(false),
    channelMap: z.array(z.int().nonnegative()).max(128).default([]),
  })
  .strict();

const timelineItemBase = {
  id: entityIdSchema,
  name: z.string().min(1).max(1_024),
  timelineRange: timeRangeSchema,
  enabled: z.boolean().default(true),
  locked: z.boolean().default(false),
  metadata: metadataSchema.default({}),
};

export const clipSchema = z
  .object({
    ...timelineItemBase,
    type: z.literal("clip"),
    assetId: entityIdSchema,
    sourceRange: timeRangeSchema,
    transform: transformSchema.prefault({}),
    timeMap: z.array(keyframeSchema).default([]),
    effects: z.array(effectInstanceSchema).default([]),
    audio: audioPropertiesSchema.prefault({}),
    links: z.array(entityIdSchema).default([]),
    semanticMetadata: metadataSchema.default({}),
  })
  .strict();

export const gapSchema = z
  .object({
    ...timelineItemBase,
    type: z.literal("gap"),
  })
  .strict();

export const transitionSchema = z
  .object({
    ...timelineItemBase,
    type: z.literal("transition"),
    capabilityId: z.string().min(1).max(512),
    fromItemId: entityIdSchema,
    toItemId: entityIdSchema,
    parameters: metadataSchema.default({}),
    automationCurves: z.array(automationCurveSchema).default([]),
  })
  .strict();

export const nestedSequenceSchema = z
  .object({
    ...timelineItemBase,
    type: z.literal("nested_sequence"),
    sequenceId: entityIdSchema,
    sourceRange: timeRangeSchema.optional(),
    transform: transformSchema.prefault({}),
    effects: z.array(effectInstanceSchema).default([]),
    audio: audioPropertiesSchema.prefault({}),
  })
  .strict();

export const titleSchema = z
  .object({
    ...timelineItemBase,
    type: z.literal("title"),
    text: z.string().max(1_000_000),
    templateId: z.string().max(256).optional(),
    style: metadataSchema.default({}),
    transform: transformSchema.prefault({}),
    effects: z.array(effectInstanceSchema).default([]),
  })
  .strict();

export const generatorSchema = z
  .object({
    ...timelineItemBase,
    type: z.literal("generator"),
    capabilityId: z.string().min(1).max(512),
    parameters: metadataSchema.default({}),
    effects: z.array(effectInstanceSchema).default([]),
  })
  .strict();

export const timelineItemSchema = z.discriminatedUnion("type", [
  clipSchema,
  gapSchema,
  transitionSchema,
  nestedSequenceSchema,
  titleSchema,
  generatorSchema,
]);

export const markerSchema = z
  .object({
    id: entityIdSchema,
    name: z.string().min(1).max(1_024),
    range: timeRangeSchema,
    color: z.string().max(64).optional(),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const captionCueSchema = z
  .object({
    id: entityIdSchema,
    range: timeRangeSchema,
    text: z.string().max(100_000),
    speaker: z.string().max(512).optional(),
    words: z.array(metadataSchema).default([]),
    style: metadataSchema.default({}),
  })
  .strict();

export const captionTrackSchema = z
  .object({
    id: entityIdSchema,
    name: z.string().min(1).max(1_024),
    language: z.string().min(2).max(64),
    enabled: z.boolean().default(true),
    cues: z.array(captionCueSchema).default([]),
    style: metadataSchema.default({}),
  })
  .strict();

export const audioBusSchema = z
  .object({
    id: entityIdSchema,
    name: z.string().min(1).max(1_024),
    gainDb: z.number().finite().min(-120).max(48).default(0),
    muted: z.boolean().default(false),
    effects: z.array(effectInstanceSchema).default([]),
    outputBusId: entityIdSchema.optional(),
  })
  .strict();

export const maskPointSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    inTangentX: z.number().finite().optional(),
    inTangentY: z.number().finite().optional(),
    outTangentX: z.number().finite().optional(),
    outTangentY: z.number().finite().optional(),
  })
  .strict();

export const maskKeyframeSchema = z
  .object({
    id: entityIdSchema,
    time: rationalTimeSchema,
    points: z.array(maskPointSchema).min(1).max(100_000),
    feather: z.number().finite().nonnegative().default(0),
    opacity: z.number().finite().min(0).max(1).default(1),
    interpolation: interpolationSchema.default("linear"),
  })
  .strict();

export const maskSchema = z
  .object({
    id: entityIdSchema,
    name: z.string().min(1).max(1_024),
    kind: z.enum(["ellipse", "rectangle", "polygon", "bezier"]),
    coordinateSpace: z.enum(["normalized", "pixels"]).default("normalized"),
    enabled: z.boolean().default(true),
    inverted: z.boolean().default(false),
    feather: z.number().finite().nonnegative().default(0),
    opacity: z.number().finite().min(0).max(1).default(1),
    points: z.array(maskPointSchema).min(1).max(100_000),
    keyframes: z.array(maskKeyframeSchema).max(100_000).default([]),
    trackedObjectId: entityIdSchema.optional(),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const trackingSampleSchema = z
  .object({
    id: entityIdSchema,
    time: rationalTimeSchema,
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
    rotation: z.number().finite().default(0),
    confidence: z.number().finite().min(0).max(1),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const trackedObjectSchema = z
  .object({
    id: entityIdSchema,
    name: z.string().min(1).max(1_024),
    assetId: entityIdSchema.optional(),
    sequenceId: entityIdSchema.optional(),
    itemId: entityIdSchema.optional(),
    range: timeRangeSchema,
    samples: z.array(trackingSampleSchema).max(1_000_000),
    analyzerId: z.string().min(1).max(256),
    analyzerVersion: z.string().min(1).max(64),
    modelHash: z.string().max(256).optional(),
    metadata: metadataSchema.default({}),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.assetId === undefined && value.sequenceId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["assetId"],
        message: "Tracked object requires an assetId or sequenceId",
      });
    }
  });

export const multicamAngleSchema = z
  .object({
    id: entityIdSchema,
    name: z.string().min(1).max(1_024),
    assetId: entityIdSchema,
    sourceRange: timeRangeSchema,
    syncOffset: signedRationalTimeSchema,
    enabled: z.boolean().default(true),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const multicamGroupSchema = z
  .object({
    id: entityIdSchema,
    name: z.string().min(1).max(1_024),
    sequenceId: entityIdSchema.optional(),
    syncMethod: z
      .enum(["timecode", "audio", "marker", "manual"])
      .default("manual"),
    angles: z.array(multicamAngleSchema).min(2).max(256),
    activeAngleAutomation: z.array(keyframeSchema).max(100_000).default([]),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const itemGroupSchema = z
  .object({
    id: entityIdSchema,
    name: z.string().min(1).max(1_024),
    sequenceId: entityIdSchema,
    itemIds: z.array(entityIdSchema).min(2).max(100_000),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const trackSchema = z
  .object({
    id: entityIdSchema,
    name: z.string().min(1).max(1_024),
    kind: z.enum(["video", "audio", "caption", "data"]),
    order: z.int().min(0).max(10_000),
    enabled: z.boolean().default(true),
    locked: z.boolean().default(false),
    muted: z.boolean().default(false),
    syncLocked: z.boolean().default(true),
    busId: entityIdSchema.optional(),
    items: z.array(timelineItemSchema).default([]),
    effects: z.array(effectInstanceSchema).default([]),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const sequenceFormatSchema = z
  .object({
    width: z.int().positive().max(65_535),
    height: z.int().positive().max(65_535),
    frameRate: rationalRateSchema,
    sampleRate: z.int().positive().max(768_000).default(48_000),
    channels: z.int().positive().max(128).default(2),
    pixelAspectRatio: rationalRateSchema.default({
      numerator: 1,
      denominator: 1,
    }),
    colorSpace: z.string().min(1).max(256).default("rec709"),
  })
  .strict();

export const sequenceSchema = z
  .object({
    id: entityIdSchema,
    name: z.string().min(1).max(1_024),
    format: sequenceFormatSchema,
    tracks: z.array(trackSchema).max(1_000).default([]),
    markers: z.array(markerSchema).default([]),
    captions: z.array(captionTrackSchema).default([]),
    buses: z.array(audioBusSchema).default([]),
    outputEffects: z.array(effectInstanceSchema).default([]),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const renderProfileSchema = z
  .object({
    id: entityIdSchema,
    name: z.string().min(1).max(1_024),
    container: z.string().min(1).max(128),
    videoCodec: z.string().max(128).optional(),
    audioCodec: z.string().max(128).optional(),
    width: z.int().positive().max(65_535),
    height: z.int().positive().max(65_535),
    frameRate: rationalRateSchema,
    sampleRate: z.int().positive().max(768_000).default(48_000),
    channels: z.int().positive().max(128).default(2),
    color: metadataSchema.default({}),
    video: metadataSchema.default({}),
    audio: metadataSchema.default({}),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const projectSettingsSchema = z
  .object({
    name: z.string().min(1).max(1_024),
    defaultSequenceId: entityIdSchema,
    timeDisplay: z.enum(["timecode", "frames", "seconds"]).default("timecode"),
  })
  .strict();

export const projectSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    projectId: entityIdSchema,
    revision: z.int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    settings: projectSettingsSchema,
    assets: z.record(entityIdSchema, assetSchema).default({}),
    sequences: z.record(entityIdSchema, sequenceSchema),
    analyses: z.record(entityIdSchema, analysisArtifactSchema).default({}),
    renderProfiles: z.record(entityIdSchema, renderProfileSchema).default({}),
    masks: z.record(entityIdSchema, maskSchema).default({}),
    trackedObjects: z.record(entityIdSchema, trackedObjectSchema).default({}),
    multicamGroups: z.record(entityIdSchema, multicamGroupSchema).default({}),
    itemGroups: z.record(entityIdSchema, itemGroupSchema).default({}),
    metadata: metadataSchema.default({}),
  })
  .strict();

export type Project = z.infer<typeof projectSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type Sequence = z.infer<typeof sequenceSchema>;
export type Track = z.infer<typeof trackSchema>;
export type TimelineItem = z.infer<typeof timelineItemSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type Gap = z.infer<typeof gapSchema>;
export type Transition = z.infer<typeof transitionSchema>;
export type Title = z.infer<typeof titleSchema>;
export type Generator = z.infer<typeof generatorSchema>;
export type NestedSequence = z.infer<typeof nestedSequenceSchema>;
export type EffectInstance = z.infer<typeof effectInstanceSchema>;
export type CaptionTrack = z.infer<typeof captionTrackSchema>;
export type CaptionCue = z.infer<typeof captionCueSchema>;
export type AudioBus = z.infer<typeof audioBusSchema>;
export type Marker = z.infer<typeof markerSchema>;
export type AnalysisArtifact = z.infer<typeof analysisArtifactSchema>;
export type RenderProfile = z.infer<typeof renderProfileSchema>;
export type Mask = z.infer<typeof maskSchema>;
export type MaskPoint = z.infer<typeof maskPointSchema>;
export type TrackedObject = z.infer<typeof trackedObjectSchema>;
export type MulticamGroup = z.infer<typeof multicamGroupSchema>;
export type ItemGroup = z.infer<typeof itemGroupSchema>;
