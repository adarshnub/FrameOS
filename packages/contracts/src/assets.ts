import { z } from "zod";
import {
  assetSchema,
  entityIdSchema,
  metadataSchema,
  streamSchema,
} from "./project.js";
import { transactionResultSchema } from "./operations.js";
import { rationalTimeSchema } from "./time.js";

export const mediaProbeResultSchema = z
  .object({
    streams: z.array(streamSchema),
    duration: rationalTimeSchema.optional(),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const assetImportRequestSchema = z
  .object({
    projectId: entityIdSchema,
    baseRevision: z.int().nonnegative(),
    idempotencyKey: z.string().min(8).max(512),
    uri: z.string().min(1).max(32_768),
    name: z.string().min(1).max(1_024).optional(),
    kind: z
      .enum([
        "video",
        "audio",
        "image",
        "image_sequence",
        "subtitle",
        "font",
        "generated",
      ])
      .optional(),
    managed: z.boolean().default(false),
    licenseMetadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const assetImportResultSchema = z
  .object({
    asset: assetSchema,
    transaction: transactionResultSchema,
    warnings: z.array(
      z
        .object({
          code: z.string().min(1).max(128),
          message: z.string().min(1).max(8_192),
        })
        .strict(),
    ),
    cached: z.boolean(),
  })
  .strict();

export const assetProxyRequestSchema = z
  .object({
    projectId: entityIdSchema,
    assetId: entityIdSchema,
    baseRevision: z.int().nonnegative(),
    idempotencyKey: z.string().min(8).max(512),
    maxWidth: z.int().min(160).max(3_840).default(1_280),
    maxHeight: z.int().min(90).max(2_160).default(720),
  })
  .strict();

export const assetThumbnailRequestSchema = z
  .object({
    projectId: entityIdSchema,
    assetId: entityIdSchema,
    revision: z.int().nonnegative(),
    idempotencyKey: z.string().min(8).max(512),
    at: rationalTimeSchema,
    maxWidth: z.int().min(80).max(3_840).default(640),
    maxHeight: z.int().min(45).max(2_160).default(360),
  })
  .strict();

export type AssetImportRequest = z.infer<typeof assetImportRequestSchema>;
export type AssetImportResult = z.infer<typeof assetImportResultSchema>;
export type AssetProxyRequest = z.infer<typeof assetProxyRequestSchema>;
export type AssetThumbnailRequest = z.infer<typeof assetThumbnailRequestSchema>;
export type MediaProbeResult = z.infer<typeof mediaProbeResultSchema>;
