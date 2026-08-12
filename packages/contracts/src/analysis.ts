import { z } from "zod";
import { entityIdSchema, metadataSchema, streamSchema } from "./project.js";
import { rationalTimeSchema, timeRangeSchema } from "./time.js";
import { errorCodes } from "./errors.js";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const analyzerAssetKindSchema = z.enum([
  "video",
  "audio",
  "image",
  "image_sequence",
  "subtitle",
  "font",
  "generated",
]);

export const analyzerDescriptorSchema = z
  .object({
    id: z.string().min(1).max(256),
    version: z.string().min(1).max(64),
    capabilityId: z.string().min(1).max(512),
    name: z.string().min(1).max(256),
    description: z.string().min(1).max(2_048),
    outputTypes: z.array(z.string().min(1).max(128)).min(1).max(32),
    assetKinds: z.array(analyzerAssetKindSchema).min(1),
    available: z.boolean(),
    deterministic: z.boolean(),
    modelHash: z.string().min(16).max(256).optional(),
    binaryHash: sha256Schema.optional(),
    bundleHash: sha256Schema.optional(),
    binaryLicense: z.string().min(1).max(256).optional(),
    modelLicense: z.string().min(1).max(256).optional(),
    reasonUnavailable: z.string().min(1).max(2_048).optional(),
    parameterSchema: metadataSchema.default({}),
  })
  .strict();

const analyzerExecutableSchema = z
  .object({
    path: z.string().min(1).max(32_768),
    sha256: sha256Schema,
    version: z.string().min(1).max(128),
    license: z.string().min(1).max(256),
    arguments: z
      .array(
        z
          .string()
          .max(4_096)
          .refine((value) => !value.includes("\0")),
      )
      .max(64)
      .default([]),
  })
  .strict();

const analyzerModelSchema = z
  .object({
    path: z.string().min(1).max(32_768),
    sha256: sha256Schema,
    version: z.string().min(1).max(128),
    license: z.string().min(1).max(256),
  })
  .strict();

const analyzerResourceSchema = z
  .object({
    path: z.string().min(1).max(32_768),
    sha256: sha256Schema,
    role: z.string().min(1).max(128),
    version: z.string().min(1).max(128).optional(),
    license: z.string().min(1).max(256),
  })
  .strict();

export const analyzerPluginManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    protocolVersion: z.literal("1.0.0"),
    id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/u),
    version: z.string().min(1).max(64),
    capabilityId: z.string().min(1).max(512),
    name: z.string().min(1).max(256),
    description: z.string().min(1).max(2_048),
    outputTypes: z.array(z.string().min(1).max(128)).min(1).max(32),
    assetKinds: z.array(analyzerAssetKindSchema).min(1),
    deterministic: z.boolean(),
    parameterSchema: metadataSchema.default({}),
    executable: analyzerExecutableSchema,
    model: analyzerModelSchema.optional(),
    resources: z.array(analyzerResourceSchema).max(128).default([]),
    limits: z
      .object({
        timeoutMs: z
          .int()
          .min(1_000)
          .max(24 * 60 * 60 * 1_000),
        maxOutputBytes: z
          .int()
          .min(1_024)
          .max(256 * 1_024 * 1_024),
        maxSegments: z.int().min(1).max(1_000_000),
      })
      .strict()
      .default({
        timeoutMs: 30 * 60 * 1_000,
        maxOutputBytes: 64 * 1_024 * 1_024,
        maxSegments: 250_000,
      }),
    metadata: metadataSchema.default({}),
  })
  .strict()
  .superRefine((manifest, context) => {
    const roles = new Set<string>();
    const paths = new Set<string>();
    manifest.resources.forEach((resource, index) => {
      if (roles.has(resource.role)) {
        context.addIssue({
          code: "custom",
          path: ["resources", index, "role"],
          message: "Analyzer resource roles must be unique",
        });
      }
      if (paths.has(resource.path)) {
        context.addIssue({
          code: "custom",
          path: ["resources", index, "path"],
          message: "Analyzer resource paths must be unique",
        });
      }
      roles.add(resource.role);
      paths.add(resource.path);
    });
  });

const analyzerWorkerResourceSchema = z
  .object({
    role: z.string().min(1).max(128),
    path: z.string().min(1).max(32_768),
    sha256: sha256Schema,
    version: z.string().min(1).max(128).optional(),
  })
  .strict();

export const analyzerWorkerRequestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    requestId: entityIdSchema,
    analyzerId: z.string().min(1).max(256),
    analyzerVersion: z.string().min(1).max(64),
    asset: z
      .object({
        id: entityIdSchema,
        name: z.string().min(1).max(1_024),
        kind: analyzerAssetKindSchema,
        path: z.string().min(1).max(32_768),
        hash: z.string().min(16).max(256),
        streams: z.array(streamSchema),
        duration: rationalTimeSchema.optional(),
        semanticMetadata: metadataSchema,
      })
      .strict(),
    parameters: metadataSchema,
    modelPath: z.string().min(1).max(32_768).optional(),
    resources: z.array(analyzerWorkerResourceSchema).max(128).default([]),
  })
  .strict();

const analysisSegmentFields = {
  range: timeRangeSchema.optional(),
  text: z.string().max(1_000_000).optional(),
  labels: z.array(z.string().min(1).max(256)).max(256).default([]),
  confidence: z.number().finite().min(0).max(1).optional(),
  speaker: z.string().min(1).max(256).optional(),
  embedding: z.array(z.number().finite()).min(1).max(4_096).optional(),
  metadata: metadataSchema.default({}),
};

function hasAnalysisData(segment: {
  text?: string | undefined;
  labels: string[];
  embedding?: number[] | undefined;
  metadata: Record<string, unknown>;
}): boolean {
  return (
    segment.text !== undefined ||
    segment.labels.length > 0 ||
    segment.embedding !== undefined ||
    Object.keys(segment.metadata).length > 0
  );
}

export const analysisSegmentSchema = z
  .object({ id: entityIdSchema, ...analysisSegmentFields })
  .strict()
  .refine(hasAnalysisData, {
    message: "An analysis segment must contain searchable data",
  });

export const analyzerWorkerSegmentSchema = z
  .object(analysisSegmentFields)
  .strict()
  .refine(hasAnalysisData, {
    message: "An analysis segment must contain searchable data",
  });

export const analyzerWorkerProgressEventSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    requestId: entityIdSchema,
    type: z.literal("progress"),
    progress: z.number().finite().min(0).max(1),
    message: z.string().max(2_048).optional(),
  })
  .strict();

export const analyzerWorkerResultEventSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    requestId: entityIdSchema,
    type: z.literal("result"),
    outputType: z.string().min(1).max(128),
    segments: z.array(analyzerWorkerSegmentSchema).max(1_000_000),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const analyzerWorkerErrorEventSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    requestId: entityIdSchema,
    type: z.literal("error"),
    code: z.enum(errorCodes),
    message: z.string().min(1).max(8_192),
  })
  .strict();

export const analyzerWorkerEventSchema = z.discriminatedUnion("type", [
  analyzerWorkerProgressEventSchema,
  analyzerWorkerResultEventSchema,
  analyzerWorkerErrorEventSchema,
]);

export const analysisDocumentSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactId: entityIdSchema,
    projectId: entityIdSchema,
    assetId: entityIdSchema,
    assetHash: z.string().min(16).max(256),
    analyzerId: z.string().min(1).max(256),
    analyzerVersion: z.string().min(1).max(64),
    parametersHash: z.string().length(64),
    modelHash: z.string().min(16).max(256).optional(),
    binaryHash: sha256Schema.optional(),
    bundleHash: sha256Schema.optional(),
    type: z.string().min(1).max(128),
    segments: z.array(analysisSegmentSchema).max(1_000_000),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const assetAnalysisRequestSchema = z
  .object({
    projectId: entityIdSchema,
    assetId: entityIdSchema,
    analyzers: z.array(z.string().min(1).max(256)).min(1).max(32),
    parameters: z.record(z.string(), metadataSchema).default({}),
    force: z.boolean().default(false),
  })
  .strict();

export const analysisSearchRequestSchema = z
  .object({
    projectId: entityIdSchema,
    query: z.string().max(8_192).default(""),
    mode: z.enum(["lexical", "semantic", "hybrid"]).default("lexical"),
    queryEmbedding: z.array(z.number().finite()).min(1).max(4_096).optional(),
    assetIds: z.array(entityIdSchema).max(10_000).optional(),
    types: z.array(z.string().min(1).max(128)).max(128).optional(),
    limit: z.int().positive().max(500).default(50),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      (request.mode === "semantic" || request.mode === "hybrid") &&
      request.queryEmbedding === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["queryEmbedding"],
        message: "Semantic search requires a query embedding",
      });
    }
  });

export const analysisSearchResultSchema = z
  .object({
    segmentId: entityIdSchema,
    artifactId: entityIdSchema,
    assetId: entityIdSchema,
    type: z.string().min(1).max(128),
    score: z.number().finite().min(0).max(1),
    lexicalScore: z.number().finite().min(0).max(1).optional(),
    semanticScore: z.number().finite().min(0).max(1).optional(),
    range: timeRangeSchema.optional(),
    text: z.string().max(1_000_000).optional(),
    labels: z.array(z.string().min(1).max(256)).max(256),
    speaker: z.string().min(1).max(256).optional(),
    confidence: z.number().finite().min(0).max(1).optional(),
    metadata: metadataSchema.default({}),
  })
  .strict();

export type AnalyzerDescriptor = z.infer<typeof analyzerDescriptorSchema>;
export type AnalyzerPluginManifest = z.infer<
  typeof analyzerPluginManifestSchema
>;
export type AnalyzerWorkerRequest = z.infer<typeof analyzerWorkerRequestSchema>;
export type AnalyzerWorkerEvent = z.infer<typeof analyzerWorkerEventSchema>;
export type AnalysisSegment = z.infer<typeof analysisSegmentSchema>;
export type AnalysisDocument = z.infer<typeof analysisDocumentSchema>;
export type AssetAnalysisRequest = z.infer<typeof assetAnalysisRequestSchema>;
export type AnalysisSearchRequest = z.infer<typeof analysisSearchRequestSchema>;
export type AnalysisSearchResult = z.infer<typeof analysisSearchResultSchema>;
