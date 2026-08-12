import { z } from "zod";
import { entityIdSchema, metadataSchema } from "./project.js";
import { rationalTimeSchema, timeRangeSchema } from "./time.js";

export const previewSourceSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("revision"),
      revision: z.int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("draft"),
      draftId: entityIdSchema,
    })
    .strict(),
]);

const previewBase = {
  projectId: entityIdSchema,
  source: previewSourceSchema,
  sequenceId: entityIdSchema.optional(),
  maxWidth: z.int().positive().max(3_840).default(960),
  maxHeight: z.int().positive().max(2_160).default(540),
};

export const framePreviewRequestSchema = z
  .object({
    ...previewBase,
    kind: z.literal("frame"),
    at: rationalTimeSchema,
  })
  .strict();

export const regionPreviewRequestSchema = z
  .object({
    ...previewBase,
    kind: z.literal("region"),
    range: timeRangeSchema.optional(),
  })
  .strict();

export const contactSheetPreviewRequestSchema = z
  .object({
    ...previewBase,
    kind: z.literal("contact_sheet"),
    range: timeRangeSchema,
    frameCount: z.int().min(2).max(64).default(12),
    columns: z.int().min(1).max(16).default(4),
  })
  .strict();

export const waveformPreviewRequestSchema = z
  .object({
    ...previewBase,
    kind: z.literal("waveform"),
    assetId: entityIdSchema,
    range: timeRangeSchema.optional(),
    channel: z.int().nonnegative().max(63).optional(),
  })
  .strict();

export const previewRequestSchema = z.discriminatedUnion("kind", [
  framePreviewRequestSchema,
  regionPreviewRequestSchema,
  contactSheetPreviewRequestSchema,
  waveformPreviewRequestSchema,
]);

export const previewArtifactEntrySchema = z
  .object({
    name: z.string().min(1).max(255),
    uri: z.string().min(1).max(8_192),
    mimeType: z.string().min(1).max(255),
    at: rationalTimeSchema.optional(),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const previewArtifactSchema = z
  .object({
    kind: z.enum(["frame", "region", "contact_sheet", "waveform"]),
    width: z.int().positive().max(3_840),
    height: z.int().positive().max(2_160),
    range: timeRangeSchema.optional(),
    entries: z.array(previewArtifactEntrySchema).min(1).max(65),
    provenanceUri: z.string().min(1).max(8_192),
  })
  .strict();

export type PreviewSource = z.infer<typeof previewSourceSchema>;
export type PreviewRequest = z.infer<typeof previewRequestSchema>;
export type FramePreviewRequest = z.infer<typeof framePreviewRequestSchema>;
export type RegionPreviewRequest = z.infer<typeof regionPreviewRequestSchema>;
export type ContactSheetPreviewRequest = z.infer<
  typeof contactSheetPreviewRequestSchema
>;
export type WaveformPreviewRequest = z.infer<
  typeof waveformPreviewRequestSchema
>;
export type PreviewArtifact = z.infer<typeof previewArtifactSchema>;
