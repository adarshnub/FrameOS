import { z } from "zod";
import { analysisSearchResultSchema } from "./analysis.js";
import { entityIdSchema } from "./project.js";
import { operationSchema } from "./operations.js";
import { timeRangeSchema } from "./time.js";

export const semanticFindKindSchema = z.enum([
  "speaker",
  "quote",
  "scene",
  "object",
  "silence",
  "best_take",
]);

export const semanticFindRequestSchema = z
  .object({
    projectId: entityIdSchema,
    kind: semanticFindKindSchema,
    query: z.string().max(8_192).default(""),
    assetIds: z.array(entityIdSchema).max(10_000).optional(),
    limit: z.int().positive().max(500).default(50),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      ["speaker", "quote", "scene", "object"].includes(request.kind) &&
      request.query.trim() === ""
    ) {
      context.addIssue({
        code: "custom",
        path: ["query"],
        message: `${request.kind} search requires a query`,
      });
    }
  });

export const semanticFindResultSchema = z
  .object({
    kind: semanticFindKindSchema,
    query: z.string().max(8_192),
    matches: z.array(analysisSearchResultSchema).max(500),
  })
  .strict();

export const semanticRemoveSilencesRequestSchema = z
  .object({
    projectId: entityIdSchema,
    baseRevision: z.int().nonnegative().optional(),
    sequenceId: entityIdSchema.optional(),
    trackIds: z.array(entityIdSchema).min(1).max(128),
    assetIds: z.array(entityIdSchema).max(10_000).optional(),
    minDurationMs: z.int().min(10).max(86_400_000).default(500),
    edgePaddingMs: z.int().min(0).max(5_000).default(0),
    maximumOperations: z.int().min(1).max(200).default(200),
  })
  .strict();

export const semanticMakeVerticalRequestSchema = z
  .object({
    projectId: entityIdSchema,
    baseRevision: z.int().nonnegative().optional(),
    sequenceId: entityIdSchema.optional(),
    trackIds: z.array(entityIdSchema).max(256).optional(),
    outputWidth: z.int().min(240).max(4_320).default(1_080),
    outputHeight: z.int().min(240).max(7_680).default(1_920),
    fit: z.enum(["cover", "contain"]).default("cover"),
    maximumOperations: z.int().min(1).max(200).default(200),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.outputWidth >= request.outputHeight) {
      context.addIssue({
        code: "custom",
        path: ["outputWidth"],
        message: "Vertical output width must be less than output height",
      });
    }
  });

export const semanticMatchCutsToMusicRequestSchema = z
  .object({
    projectId: entityIdSchema,
    baseRevision: z.int().nonnegative().optional(),
    sequenceId: entityIdSchema.optional(),
    musicClipId: entityIdSchema,
    trackIds: z.array(entityIdSchema).min(1).max(128).optional(),
    minimumConfidence: z.number().finite().min(0).max(1).default(0.5),
    minimumSpacingMs: z.int().min(50).max(10_000).default(250),
    maximumOperations: z.int().min(1).max(200).default(200),
  })
  .strict();

export const semanticAddDynamicCaptionsRequestSchema = z
  .object({
    projectId: entityIdSchema,
    baseRevision: z.int().nonnegative().optional(),
    sequenceId: entityIdSchema.optional(),
    sourceClipIds: z.array(entityIdSchema).min(1).max(128),
    artifactIds: z.array(entityIdSchema).min(1).max(1_000).optional(),
    captionTrackId: entityIdSchema.optional(),
    name: z.string().min(1).max(1_024).default("Dynamic captions"),
    language: z.string().min(2).max(64).default("und"),
    style: z.record(z.string(), z.unknown()).default({}),
    minimumConfidence: z.number().finite().min(0).max(1).default(0),
    wordHighlight: z.boolean().default(true),
    maximumOperations: z.int().min(1).max(200).default(200),
  })
  .strict();

export const semanticCreateHighlightRequestSchema = z
  .object({
    projectId: entityIdSchema,
    baseRevision: z.int().nonnegative().optional(),
    sequenceId: entityIdSchema.optional(),
    sourceTrackIds: z.array(entityIdSchema).max(128).optional(),
    destinationTrackId: entityIdSchema.optional(),
    destinationTrackName: z.string().min(1).max(1_024).default("Highlight"),
    assetIds: z.array(entityIdSchema).max(10_000).optional(),
    artifactIds: z.array(entityIdSchema).max(1_000).optional(),
    query: z.string().max(8_192).default("quality highlight"),
    types: z
      .array(z.string().min(1).max(128))
      .min(1)
      .max(32)
      .default(["quality", "scenes", "shots"]),
    minimumScore: z.number().finite().min(0).max(1).default(0.5),
    maximumClipDurationMs: z.int().min(100).max(600_000).default(15_000),
    totalDurationMs: z.int().min(100).max(3_600_000).default(60_000),
    edgePaddingMs: z.int().min(0).max(5_000).default(0),
    maximumOperations: z.int().min(1).max(200).default(200),
  })
  .strict();

export const semanticSyncBrollRequestSchema = z
  .object({
    projectId: entityIdSchema,
    baseRevision: z.int().nonnegative().optional(),
    sequenceId: entityIdSchema.optional(),
    targetClipIds: z.array(entityIdSchema).min(1).max(128),
    brollTrackIds: z.array(entityIdSchema).max(128).optional(),
    destinationTrackId: entityIdSchema.optional(),
    destinationTrackName: z.string().min(1).max(1_024).default("B-roll"),
    targetArtifactIds: z.array(entityIdSchema).max(1_000).optional(),
    brollArtifactIds: z.array(entityIdSchema).max(1_000).optional(),
    brollAssetIds: z.array(entityIdSchema).max(10_000).optional(),
    query: z.string().max(8_192).default("broll"),
    targetTypes: z
      .array(z.string().min(1).max(128))
      .min(1)
      .max(32)
      .default(["transcript", "scenes", "shots"]),
    brollTypes: z
      .array(z.string().min(1).max(128))
      .min(1)
      .max(32)
      .default(["objects", "scenes", "shots", "quality"]),
    minimumTargetConfidence: z.number().finite().min(0).max(1).default(0),
    minimumBrollScore: z.number().finite().min(0).max(1).default(0.5),
    maximumOverlayDurationMs: z.int().min(100).max(600_000).default(5_000),
    edgePaddingMs: z.int().min(0).max(5_000).default(0),
    maximumOperations: z.int().min(1).max(200).default(200),
  })
  .strict();

export const semanticEditPlanSchema = z
  .object({
    projectId: entityIdSchema,
    baseRevision: z.int().nonnegative(),
    semanticOperation: z.enum([
      "semantic.remove_silences",
      "semantic.make_vertical",
      "semantic.match_cuts_to_music",
      "semantic.add_dynamic_captions",
      "semantic.create_highlight",
      "semantic.sync_broll",
    ]),
    operations: z.array(operationSchema).max(200),
    sourceArtifactIds: z.array(entityIdSchema).max(10_000),
    affectedRanges: z.array(timeRangeSchema).max(100_000),
    warnings: z.array(z.string().max(8_192)).max(10_000),
  })
  .strict();

export type SemanticFindRequest = z.infer<typeof semanticFindRequestSchema>;
export type SemanticFindResult = z.infer<typeof semanticFindResultSchema>;
export type SemanticRemoveSilencesRequest = z.infer<
  typeof semanticRemoveSilencesRequestSchema
>;
export type SemanticMakeVerticalRequest = z.infer<
  typeof semanticMakeVerticalRequestSchema
>;
export type SemanticMatchCutsToMusicRequest = z.infer<
  typeof semanticMatchCutsToMusicRequestSchema
>;
export type SemanticAddDynamicCaptionsRequest = z.infer<
  typeof semanticAddDynamicCaptionsRequestSchema
>;
export type SemanticCreateHighlightRequest = z.infer<
  typeof semanticCreateHighlightRequestSchema
>;
export type SemanticSyncBrollRequest = z.infer<
  typeof semanticSyncBrollRequestSchema
>;
export type SemanticEditPlan = z.infer<typeof semanticEditPlanSchema>;
