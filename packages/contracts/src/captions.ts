import { z } from "zod";
import {
  transactionModeSchema,
  transactionResultSchema,
} from "./operations.js";
import { metadataSchema } from "./project.js";

export const captionInterchangeFormatSchema = z.enum(["srt", "vtt"]);

export const captionInterchangeWarningSchema = z
  .object({
    code: z.enum([
      "IGNORED_BLOCK",
      "EMPTY_CUE",
      "CUE_SETTING_PRESERVED",
      "TIMING_ROUNDED",
      "STYLE_NOT_EXPORTED",
    ]),
    message: z.string().min(1).max(4_096),
    cueIndex: z.int().nonnegative().optional(),
  })
  .strict();

export const captionImportRequestSchema = z
  .object({
    projectId: z.string().uuid(),
    sequenceId: z.string().uuid(),
    baseRevision: z.int().nonnegative(),
    idempotencyKey: z.string().min(8).max(512),
    mode: transactionModeSchema.default("commit"),
    format: captionInterchangeFormatSchema,
    content: z
      .string()
      .min(1)
      .max(4 * 1_024 * 1_024),
    trackId: z.string().uuid().optional(),
    name: z.string().min(1).max(1_024).default("Imported captions"),
    language: z.string().min(2).max(64).default("und"),
    enabled: z.boolean().default(true),
    style: metadataSchema.default({}),
  })
  .strict();

export const captionImportResultSchema = z
  .object({
    captionTrackId: z.string().uuid(),
    cueCount: z.int().nonnegative(),
    warnings: z.array(captionInterchangeWarningSchema),
    transaction: transactionResultSchema,
  })
  .strict();

export const captionExportRequestSchema = z
  .object({
    projectId: z.string().uuid(),
    sequenceId: z.string().uuid(),
    captionTrackId: z.string().uuid(),
    format: captionInterchangeFormatSchema,
    revision: z.int().nonnegative().optional(),
  })
  .strict();

export const captionExportResultSchema = z
  .object({
    format: captionInterchangeFormatSchema,
    content: z.string(),
    filename: z.string().min(1).max(255),
    mimeType: z.enum(["application/x-subrip", "text/vtt"]),
    captionTrackId: z.string().uuid(),
    cueCount: z.int().nonnegative(),
    revision: z.int().nonnegative(),
    warnings: z.array(captionInterchangeWarningSchema),
  })
  .strict();

export type CaptionInterchangeFormat = z.infer<
  typeof captionInterchangeFormatSchema
>;
export type CaptionInterchangeWarning = z.infer<
  typeof captionInterchangeWarningSchema
>;
export type CaptionImportRequest = z.infer<typeof captionImportRequestSchema>;
export type CaptionImportResult = z.infer<typeof captionImportResultSchema>;
export type CaptionExportRequest = z.infer<typeof captionExportRequestSchema>;
export type CaptionExportResult = z.infer<typeof captionExportResultSchema>;
