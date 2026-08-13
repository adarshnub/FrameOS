import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  analysisDocumentSchema,
  analysisSearchRequestSchema,
  analysisSearchResultSchema,
  analyzerPluginManifestSchema,
  analyzerDescriptorSchema,
  analyzerWorkerEventSchema,
  analyzerWorkerRequestSchema,
  assetAnalysisRequestSchema,
} from "./analysis.js";
import {
  assetImportRequestSchema,
  assetImportResultSchema,
  assetProxyRequestSchema,
  assetThumbnailRequestSchema,
  mediaProbeResultSchema,
} from "./assets.js";
import {
  captionExportRequestSchema,
  captionExportResultSchema,
  captionImportRequestSchema,
  captionImportResultSchema,
} from "./captions.js";
import {
  agentExecutionRequestSchema,
  agentExecutionResultSchema,
  agentEvaluationSchema,
  agentRevisionRequestSchema,
  agentRevisionResultSchema,
  agentRunSchema,
  agentSessionSchema,
  approvalDecisionSchema,
  approvalSchema,
  editPlanSchema,
} from "./agent.js";
import {
  interchangeReportSchema,
  otioExportRequestSchema,
  otioExportResultSchema,
  otioImportRequestSchema,
  otioImportResultSchema,
} from "./interchange.js";
import { jobRecordSchema } from "./jobs.js";
import {
  executableOperationSchemas,
  operationSchema,
  transactionRequestSchema,
  transactionResultSchema,
} from "./operations.js";
import { assetSchema, projectSchema } from "./project.js";
import { previewArtifactSchema, previewRequestSchema } from "./previews.js";
import {
  semanticAddDynamicCaptionsRequestSchema,
  semanticCreateHighlightRequestSchema,
  semanticEditPlanSchema,
  semanticFindRequestSchema,
  semanticFindResultSchema,
  semanticMakeVerticalRequestSchema,
  semanticMatchCutsToMusicRequestSchema,
  semanticRemoveSilencesRequestSchema,
  semanticSyncBrollRequestSchema,
} from "./semantic.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checking = process.argv.includes("--check");

async function emit(relativePath: string, value: unknown): Promise<void> {
  const path = resolve(packageRoot, relativePath);
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  await emitTextAt(path, contents, relativePath);
}

async function emitTextAt(
  path: string,
  contents: string,
  label: string,
): Promise<void> {
  if (checking) {
    const current = await readFile(path, "utf8").catch(() => undefined);
    if (current !== contents)
      throw new Error(`${label} is stale; run npm run artifacts`);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

async function emitWorkspaceText(
  relativePath: string,
  contents: string,
): Promise<void> {
  const workspaceRoot = resolve(packageRoot, "..", "..");
  await emitTextAt(
    resolve(workspaceRoot, relativePath),
    contents,
    relativePath,
  );
}

function jsonSchema(schema: z.ZodType, id: string): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: id,
    ...z.toJSONSchema(schema, {
      target: "draft-2020-12",
      unrepresentable: "any",
    }),
  };
}

const projectJsonSchema = jsonSchema(
  projectSchema,
  "https://frameos.dev/schema/v1/project.json",
);
const assetJsonSchema = jsonSchema(
  assetSchema,
  "https://frameos.dev/schema/v1/asset.json",
);
const analyzerDescriptorJsonSchema = jsonSchema(
  analyzerDescriptorSchema,
  "https://frameos.dev/schema/v1/analyzer-descriptor.json",
);
const analyzerPluginManifestJsonSchema = jsonSchema(
  analyzerPluginManifestSchema,
  "https://frameos.dev/schema/v1/analyzer-plugin-manifest.json",
);
const analyzerWorkerRequestJsonSchema = jsonSchema(
  analyzerWorkerRequestSchema,
  "https://frameos.dev/schema/v1/analyzer-worker-request.json",
);
const analyzerWorkerEventJsonSchema = jsonSchema(
  analyzerWorkerEventSchema,
  "https://frameos.dev/schema/v1/analyzer-worker-event.json",
);
const analysisDocumentJsonSchema = jsonSchema(
  analysisDocumentSchema,
  "https://frameos.dev/schema/v1/analysis-document.json",
);
const assetAnalysisRequestJsonSchema = jsonSchema(
  assetAnalysisRequestSchema,
  "https://frameos.dev/schema/v1/asset-analysis-request.json",
);
const analysisSearchRequestJsonSchema = jsonSchema(
  analysisSearchRequestSchema,
  "https://frameos.dev/schema/v1/analysis-search-request.json",
);
const analysisSearchResultJsonSchema = jsonSchema(
  analysisSearchResultSchema,
  "https://frameos.dev/schema/v1/analysis-search-result.json",
);
const semanticFindRequestJsonSchema = jsonSchema(
  semanticFindRequestSchema,
  "https://frameos.dev/schema/v1/semantic-find-request.json",
);
const semanticFindResultJsonSchema = jsonSchema(
  semanticFindResultSchema,
  "https://frameos.dev/schema/v1/semantic-find-result.json",
);
const semanticRemoveSilencesRequestJsonSchema = jsonSchema(
  semanticRemoveSilencesRequestSchema,
  "https://frameos.dev/schema/v1/semantic-remove-silences-request.json",
);
const semanticMakeVerticalRequestJsonSchema = jsonSchema(
  semanticMakeVerticalRequestSchema,
  "https://frameos.dev/schema/v1/semantic-make-vertical-request.json",
);
const semanticMatchCutsToMusicRequestJsonSchema = jsonSchema(
  semanticMatchCutsToMusicRequestSchema,
  "https://frameos.dev/schema/v1/semantic-match-cuts-to-music-request.json",
);
const semanticAddDynamicCaptionsRequestJsonSchema = jsonSchema(
  semanticAddDynamicCaptionsRequestSchema,
  "https://frameos.dev/schema/v1/semantic-add-dynamic-captions-request.json",
);
const semanticCreateHighlightRequestJsonSchema = jsonSchema(
  semanticCreateHighlightRequestSchema,
  "https://frameos.dev/schema/v1/semantic-create-highlight-request.json",
);
const semanticSyncBrollRequestJsonSchema = jsonSchema(
  semanticSyncBrollRequestSchema,
  "https://frameos.dev/schema/v1/semantic-sync-broll-request.json",
);
const semanticEditPlanJsonSchema = jsonSchema(
  semanticEditPlanSchema,
  "https://frameos.dev/schema/v1/semantic-edit-plan.json",
);
const jobRecordJsonSchema = jsonSchema(
  jobRecordSchema,
  "https://frameos.dev/schema/v1/job.json",
);
const previewRequestJsonSchema = jsonSchema(
  previewRequestSchema,
  "https://frameos.dev/schema/v1/preview-request.json",
);
const previewArtifactJsonSchema = jsonSchema(
  previewArtifactSchema,
  "https://frameos.dev/schema/v1/preview-artifact.json",
);
const assetImportRequestJsonSchema = jsonSchema(
  assetImportRequestSchema,
  "https://frameos.dev/schema/v1/asset-import-request.json",
);
const assetImportResultJsonSchema = jsonSchema(
  assetImportResultSchema,
  "https://frameos.dev/schema/v1/asset-import-result.json",
);
const assetProxyRequestJsonSchema = jsonSchema(
  assetProxyRequestSchema,
  "https://frameos.dev/schema/v1/asset-proxy-request.json",
);
const assetThumbnailRequestJsonSchema = jsonSchema(
  assetThumbnailRequestSchema,
  "https://frameos.dev/schema/v1/asset-thumbnail-request.json",
);
const mediaProbeResultJsonSchema = jsonSchema(
  mediaProbeResultSchema,
  "https://frameos.dev/schema/v1/media-probe-result.json",
);
const operationJsonSchema = jsonSchema(
  operationSchema,
  "https://frameos.dev/schema/v1/operation.json",
);
const transactionRequestJsonSchema = jsonSchema(
  transactionRequestSchema,
  "https://frameos.dev/schema/v1/transaction-request.json",
);
const transactionResultJsonSchema = jsonSchema(
  transactionResultSchema,
  "https://frameos.dev/schema/v1/transaction-result.json",
);
const agentSessionJsonSchema = jsonSchema(
  agentSessionSchema,
  "https://frameos.dev/schema/v1/agent-session.json",
);
const agentRunJsonSchema = jsonSchema(
  agentRunSchema,
  "https://frameos.dev/schema/v1/agent-run.json",
);
const editPlanJsonSchema = jsonSchema(
  editPlanSchema,
  "https://frameos.dev/schema/v1/edit-plan.json",
);
const agentExecutionRequestJsonSchema = jsonSchema(
  agentExecutionRequestSchema,
  "https://frameos.dev/schema/v1/agent-execution-request.json",
);
const agentExecutionResultJsonSchema = jsonSchema(
  agentExecutionResultSchema,
  "https://frameos.dev/schema/v1/agent-execution-result.json",
);
const agentEvaluationJsonSchema = jsonSchema(
  agentEvaluationSchema,
  "https://frameos.dev/schema/v1/agent-evaluation.json",
);
const agentRevisionRequestJsonSchema = jsonSchema(
  agentRevisionRequestSchema,
  "https://frameos.dev/schema/v1/agent-revision-request.json",
);
const agentRevisionResultJsonSchema = jsonSchema(
  agentRevisionResultSchema,
  "https://frameos.dev/schema/v1/agent-revision-result.json",
);
const approvalJsonSchema = jsonSchema(
  approvalSchema,
  "https://frameos.dev/schema/v1/approval.json",
);
const approvalDecisionJsonSchema = jsonSchema(
  approvalDecisionSchema,
  "https://frameos.dev/schema/v1/approval-decision.json",
);
const interchangeReportJsonSchema = jsonSchema(
  interchangeReportSchema,
  "https://frameos.dev/schema/v1/interchange-report.json",
);
const otioImportRequestJsonSchema = jsonSchema(
  otioImportRequestSchema,
  "https://frameos.dev/schema/v1/otio-import-request.json",
);
const otioImportResultJsonSchema = jsonSchema(
  otioImportResultSchema,
  "https://frameos.dev/schema/v1/otio-import-result.json",
);
const otioExportRequestJsonSchema = jsonSchema(
  otioExportRequestSchema,
  "https://frameos.dev/schema/v1/otio-export-request.json",
);
const otioExportResultJsonSchema = jsonSchema(
  otioExportResultSchema,
  "https://frameos.dev/schema/v1/otio-export-result.json",
);
const captionImportRequestJsonSchema = jsonSchema(
  captionImportRequestSchema,
  "https://frameos.dev/schema/v1/caption-import-request.json",
);
const captionImportResultJsonSchema = jsonSchema(
  captionImportResultSchema,
  "https://frameos.dev/schema/v1/caption-import-result.json",
);
const captionExportRequestJsonSchema = jsonSchema(
  captionExportRequestSchema,
  "https://frameos.dev/schema/v1/caption-export-request.json",
);
const captionExportResultJsonSchema = jsonSchema(
  captionExportResultSchema,
  "https://frameos.dev/schema/v1/caption-export-result.json",
);

const envelope = (schema: Record<string, unknown>) => ({
  type: "object",
  required: ["data", "error", "meta"],
  properties: {
    data: { anyOf: [schema, { type: "null" }] },
    error: {
      anyOf: [
        {
          type: "object",
          required: ["code", "message"],
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            details: { type: "array" },
          },
        },
        { type: "null" },
      ],
    },
    meta: { type: "object", additionalProperties: true },
  },
});

const bearerSecurity = [{ bearerAuth: [] }];
const openapi = {
  openapi: "3.1.0",
  info: {
    title: "FrameOS API",
    version: "0.1.0",
    description: "Deterministic, agent-native video editing control plane.",
    license: { name: "MIT", identifier: "MIT" },
  },
  servers: [{ url: "http://127.0.0.1:31415" }],
  paths: {
    "/health": {
      get: {
        operationId: "getHealth",
        responses: { "200": { description: "Healthy" } },
      },
    },
    "/api/v1/projects": {
      get: {
        operationId: "listProjects",
        security: bearerSecurity,
        responses: { "200": { description: "Projects" } },
      },
      post: {
        operationId: "createProject",
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateProjectInput" },
            },
          },
        },
        responses: { "201": { description: "Project created" } },
      },
    },
    "/api/v1/projects/{projectId}": {
      get: {
        operationId: "getProject",
        security: bearerSecurity,
        parameters: [{ $ref: "#/components/parameters/ProjectId" }],
        responses: {
          "200": {
            description: "Project state",
            content: {
              "application/json": {
                schema: envelope({ $ref: "#/components/schemas/Project" }),
              },
            },
          },
        },
      },
    },
    "/api/v1/projects/{projectId}/revisions": {
      get: {
        operationId: "listProjectRevisions",
        security: bearerSecurity,
        parameters: [{ $ref: "#/components/parameters/ProjectId" }],
        responses: {
          "200": { description: "Append-only transaction history" },
        },
      },
    },
    "/api/v1/projects/{projectId}/assets": {
      get: {
        operationId: "listProjectAssets",
        security: bearerSecurity,
        parameters: [{ $ref: "#/components/parameters/ProjectId" }],
        responses: { "200": { description: "Registered project assets" } },
      },
      post: {
        operationId: "importProjectAsset",
        security: bearerSecurity,
        parameters: [{ $ref: "#/components/parameters/ProjectId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["baseRevision", "idempotencyKey", "asset"],
                properties: {
                  baseRevision: { type: "integer", minimum: 0 },
                  idempotencyKey: {
                    type: "string",
                    minLength: 8,
                    maxLength: 512,
                  },
                  asset: { $ref: "#/components/schemas/Asset" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Asset registered atomically" },
          "403": { description: "Media path outside configured roots" },
          "409": { description: "Revision conflict" },
          "422": { description: "Asset or media validation failed" },
        },
      },
    },
    "/api/v1/assets/imports": {
      post: {
        operationId: "importLocalAsset",
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AssetImportRequest" },
            },
          },
        },
        responses: {
          "200": { description: "Idempotent import result" },
          "201": {
            description: "Local file hashed and registered atomically",
            content: {
              "application/json": {
                schema: envelope({
                  $ref: "#/components/schemas/AssetImportResult",
                }),
              },
            },
          },
          "403": { description: "Source is outside approved media roots" },
          "409": { description: "Revision conflict" },
          "422": { description: "Unsupported source or invalid request" },
        },
      },
    },
    "/api/v1/assets/uploads": {
      post: {
        operationId: "uploadManagedAsset",
        security: bearerSecurity,
        parameters: [
          {
            name: "projectId",
            in: "query",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "baseRevision",
            in: "query",
            required: true,
            schema: { type: "integer", minimum: 0 },
          },
          {
            name: "kind",
            in: "query",
            schema: {
              type: "string",
              enum: ["video", "audio", "image", "subtitle", "font"],
            },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: {
                  file: { type: "string", format: "binary" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Uploaded file stored as a managed asset" },
          "409": { description: "Revision conflict" },
          "413": { description: "Upload exceeds the configured limit" },
          "422": { description: "Unsupported or missing media file" },
        },
      },
    },
    "/api/v1/projects/{projectId}/assets/{assetId}": {
      get: {
        operationId: "getProjectAsset",
        security: bearerSecurity,
        parameters: [
          { $ref: "#/components/parameters/ProjectId" },
          {
            name: "assetId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": { description: "Registered asset" },
          "404": { description: "Asset missing" },
        },
      },
    },
    "/api/v1/projects/{projectId}/assets/{assetId}/proxies": {
      post: {
        operationId: "createAssetProxy",
        security: bearerSecurity,
        parameters: [
          { $ref: "#/components/parameters/ProjectId" },
          {
            name: "assetId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AssetProxyRequest" },
            },
          },
        },
        responses: {
          "202": {
            description: "Idempotent proxy job accepted",
            content: {
              "application/json": {
                schema: envelope({ $ref: "#/components/schemas/Job" }),
              },
            },
          },
          "409": { description: "Revision or idempotency conflict" },
          "424": { description: "Audited proxy capability unavailable" },
        },
      },
    },
    "/api/v1/projects/{projectId}/assets/{assetId}/thumbnails": {
      post: {
        operationId: "createAssetThumbnail",
        security: bearerSecurity,
        parameters: [
          { $ref: "#/components/parameters/ProjectId" },
          {
            name: "assetId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AssetThumbnailRequest" },
            },
          },
        },
        responses: {
          "202": {
            description: "Idempotent thumbnail job accepted",
            content: {
              "application/json": {
                schema: envelope({ $ref: "#/components/schemas/Job" }),
              },
            },
          },
          "409": { description: "Idempotency conflict" },
          "424": { description: "Audited thumbnail capability unavailable" },
        },
      },
    },
    "/api/v1/projects/{projectId}/assets/{assetId}/analysis": {
      get: {
        operationId: "listAssetAnalysis",
        security: bearerSecurity,
        parameters: [
          { $ref: "#/components/parameters/ProjectId" },
          {
            name: "assetId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: { "200": { description: "Attached analysis artifacts" } },
      },
      post: {
        operationId: "startAssetAnalysis",
        security: bearerSecurity,
        parameters: [
          { $ref: "#/components/parameters/ProjectId" },
          {
            name: "assetId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AssetAnalysisRequest" },
            },
          },
        },
        responses: {
          "202": { description: "Analysis job accepted" },
          "424": { description: "Analyzer capability unavailable" },
        },
      },
    },
    "/api/v1/analysis/analyzers": {
      get: {
        operationId: "listAnalyzers",
        security: bearerSecurity,
        responses: { "200": { description: "Analyzer capability catalog" } },
      },
    },
    "/api/v1/assets/search": {
      post: {
        operationId: "searchAssetAnalysis",
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AnalysisSearchRequest" },
            },
          },
        },
        responses: { "200": { description: "Ranked analysis segments" } },
      },
    },
    "/api/v1/semantic/find": {
      post: {
        operationId: "findSemanticRanges",
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SemanticFindRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Typed matches from reproducible analysis artifacts",
            content: {
              "application/json": {
                schema: envelope({
                  $ref: "#/components/schemas/SemanticFindResult",
                }),
              },
            },
          },
        },
      },
    },
    "/api/v1/semantic/remove-silences/plan": {
      post: {
        operationId: "planSemanticSilenceRemoval",
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/SemanticRemoveSilencesRequest",
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Non-mutating low-level transaction plan derived from silence artifacts",
            content: {
              "application/json": {
                schema: envelope({
                  $ref: "#/components/schemas/SemanticEditPlan",
                }),
              },
            },
          },
          "409": { description: "Revision conflict" },
          "413": { description: "Operation budget exceeded" },
        },
      },
    },
    "/api/v1/semantic/make-vertical/plan": {
      post: {
        operationId: "planSemanticVerticalConversion",
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/SemanticMakeVerticalRequest",
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Non-mutating low-level transaction plan for portrait conversion",
            content: {
              "application/json": {
                schema: envelope({
                  $ref: "#/components/schemas/SemanticEditPlan",
                }),
              },
            },
          },
          "409": { description: "Revision conflict" },
          "413": { description: "Operation budget exceeded" },
        },
      },
    },
    "/api/v1/semantic/match-cuts-to-music/plan": {
      post: {
        operationId: "planSemanticCutsToMusic",
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/SemanticMatchCutsToMusicRequest",
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Non-mutating low-level split plan derived from beat artifacts",
            content: {
              "application/json": {
                schema: envelope({
                  $ref: "#/components/schemas/SemanticEditPlan",
                }),
              },
            },
          },
          "409": { description: "Revision conflict" },
          "413": { description: "Operation budget exceeded" },
          "424": { description: "Music clip retime mapping unavailable" },
        },
      },
    },
    "/api/v1/semantic/add-dynamic-captions/plan": {
      post: {
        operationId: "planSemanticDynamicCaptions",
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/SemanticAddDynamicCaptionsRequest",
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Non-mutating caption-track plan derived from transcript artifacts",
            content: {
              "application/json": {
                schema: envelope({
                  $ref: "#/components/schemas/SemanticEditPlan",
                }),
              },
            },
          },
          "409": { description: "Revision conflict" },
          "413": { description: "Operation budget exceeded" },
        },
      },
    },
    "/api/v1/semantic/create-highlight/plan": {
      post: {
        operationId: "planSemanticCreateHighlight",
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/SemanticCreateHighlightRequest",
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Non-mutating highlight assembly plan derived from ranked analysis artifacts",
            content: {
              "application/json": {
                schema: envelope({
                  $ref: "#/components/schemas/SemanticEditPlan",
                }),
              },
            },
          },
          "409": { description: "Revision conflict" },
          "413": { description: "Operation budget exceeded" },
        },
      },
    },
    "/api/v1/semantic/sync-broll/plan": {
      post: {
        operationId: "planSemanticSyncBroll",
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/SemanticSyncBrollRequest",
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Non-mutating B-roll overlay plan derived from target and source analysis artifacts",
            content: {
              "application/json": {
                schema: envelope({
                  $ref: "#/components/schemas/SemanticEditPlan",
                }),
              },
            },
          },
          "409": { description: "Revision conflict" },
          "413": { description: "Operation budget exceeded" },
        },
      },
    },
    "/api/v1/projects/{projectId}/revisions/{revision}": {
      get: {
        operationId: "getProjectRevision",
        security: bearerSecurity,
        parameters: [
          { $ref: "#/components/parameters/ProjectId" },
          {
            name: "revision",
            in: "path",
            required: true,
            schema: { type: "integer", minimum: 0 },
          },
        ],
        responses: { "200": { description: "Immutable project revision" } },
      },
    },
    "/api/v1/projects/{projectId}/forks": {
      post: {
        operationId: "forkProjectRevision",
        security: bearerSecurity,
        parameters: [{ $ref: "#/components/parameters/ProjectId" }],
        responses: {
          "201": { description: "Independent project fork created" },
        },
      },
    },
    "/api/v1/projects/{projectId}/undo": {
      post: {
        operationId: "undoProjectTransaction",
        security: bearerSecurity,
        parameters: [{ $ref: "#/components/parameters/ProjectId" }],
        responses: { "200": { description: "Undo revision committed" } },
      },
    },
    "/api/v1/projects/{projectId}/redo": {
      post: {
        operationId: "redoProjectTransaction",
        security: bearerSecurity,
        parameters: [{ $ref: "#/components/parameters/ProjectId" }],
        responses: { "200": { description: "Original transaction reapplied" } },
      },
    },
    "/api/v1/transactions": {
      post: {
        operationId: "executeTransaction",
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TransactionRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Validated or committed transaction",
            content: {
              "application/json": {
                schema: envelope({
                  $ref: "#/components/schemas/TransactionResult",
                }),
              },
            },
          },
          "202": { description: "Preview draft accepted" },
          "409": { description: "Revision conflict" },
          "422": { description: "Validation failed" },
        },
      },
    },
    "/api/v1/imports/otio": {
      post: {
        operationId: "importOtio",
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/OtioImportRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "OTIO imported as a new project with loss report",
            content: {
              "application/json": {
                schema: envelope({
                  $ref: "#/components/schemas/OtioImportResult",
                }),
              },
            },
          },
          "415": { description: "Unsupported OTIO root object" },
          "422": { description: "Invalid or lossy interchange" },
        },
      },
    },
    "/api/v1/exports/otio": {
      post: {
        operationId: "exportOtio",
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/OtioExportRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "OTIO document and loss report",
            content: {
              "application/json": {
                schema: envelope({
                  $ref: "#/components/schemas/OtioExportResult",
                }),
              },
            },
          },
          "404": { description: "Project, revision, or sequence missing" },
        },
      },
    },
    "/api/v1/imports/captions": {
      post: {
        operationId: "importCaptions",
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CaptionImportRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Captions validated or atomically committed",
            content: {
              "application/json": {
                schema: envelope({
                  $ref: "#/components/schemas/CaptionImportResult",
                }),
              },
            },
          },
          "202": { description: "Caption import preview draft accepted" },
          "409": { description: "Revision conflict" },
          "415": { description: "Invalid or unsupported caption document" },
          "422": { description: "Caption validation failed" },
        },
      },
    },
    "/api/v1/exports/captions": {
      post: {
        operationId: "exportCaptions",
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CaptionExportRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Revision-pinned SRT or WebVTT caption document",
            content: {
              "application/json": {
                schema: envelope({
                  $ref: "#/components/schemas/CaptionExportResult",
                }),
              },
            },
          },
          "404": {
            description: "Project, sequence, revision, or track missing",
          },
        },
      },
    },
    "/api/v1/projects/{projectId}/drafts/{draftId}/commit": {
      post: {
        operationId: "commitTransactionDraft",
        security: bearerSecurity,
        parameters: [
          { $ref: "#/components/parameters/ProjectId" },
          {
            name: "draftId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": { description: "Draft committed" },
          "409": { description: "Revision conflict" },
        },
      },
    },
    "/api/v1/projects/{projectId}/drafts/{draftId}": {
      delete: {
        operationId: "rollbackTransactionDraft",
        security: bearerSecurity,
        parameters: [
          { $ref: "#/components/parameters/ProjectId" },
          {
            name: "draftId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: { "204": { description: "Draft removed" } },
      },
    },
    "/api/v1/capabilities": {
      get: {
        operationId: "listCapabilities",
        security: bearerSecurity,
        responses: { "200": { description: "Host capabilities" } },
      },
    },
    "/api/v1/operations": {
      get: {
        operationId: "listOperations",
        security: bearerSecurity,
        responses: { "200": { description: "Operation catalog" } },
      },
    },
    "/api/v1/operations/{name}": {
      get: {
        operationId: "getOperation",
        security: bearerSecurity,
        parameters: [
          {
            name: "name",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "Operation descriptor" },
          "404": { description: "Operation missing" },
        },
      },
    },
    "/api/v1/renders": {
      post: {
        operationId: "startRender",
        security: bearerSecurity,
        responses: { "202": { description: "Render job queued" } },
      },
    },
    "/api/v1/previews": {
      post: {
        operationId: "startPreview",
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PreviewRequest" },
            },
          },
        },
        responses: {
          "202": {
            description: "Preview job queued",
            content: {
              "application/json": {
                schema: envelope({ $ref: "#/components/schemas/Job" }),
              },
            },
          },
          "424": { description: "Preview capability unavailable" },
        },
      },
    },
    "/api/v1/agents/providers": {
      get: {
        operationId: "listAgentProviders",
        security: bearerSecurity,
        responses: { "200": { description: "Configured providers" } },
      },
    },
    "/api/v1/admin/logs": {
      get: {
        operationId: "listAdminLogs",
        security: bearerSecurity,
        parameters: [
          { name: "level", in: "query", schema: { type: "string" } },
          { name: "category", in: "query", schema: { type: "string" } },
          {
            name: "projectId",
            in: "query",
            schema: { type: "string", format: "uuid" },
          },
          { name: "search", in: "query", schema: { type: "string" } },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 2000 },
          },
        ],
        responses: {
          "200": { description: "Redacted structured daemon logs" },
        },
      },
    },
    "/api/v1/admin/usage": {
      get: {
        operationId: "getAdminProviderUsage",
        security: bearerSecurity,
        parameters: [
          {
            name: "projectId",
            in: "query",
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "sessionId",
            in: "query",
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": { description: "Provider token and estimated-cost ledger" },
        },
      },
    },
    "/api/v1/agents/sessions": {
      get: {
        operationId: "listAgentSessions",
        security: bearerSecurity,
        responses: { "200": { description: "Agent sessions" } },
      },
      post: {
        operationId: "createAgentSession",
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AgentSessionInput" },
            },
          },
        },
        responses: { "201": { description: "Agent session created" } },
      },
    },
    "/api/v1/agents/sessions/{sessionId}": {
      get: {
        operationId: "getAgentSession",
        security: bearerSecurity,
        parameters: [
          {
            name: "sessionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: { "200": { description: "Agent session" } },
      },
    },
    "/api/v1/agents/runs": {
      post: {
        operationId: "createAgentRun",
        security: bearerSecurity,
        responses: { "200": { description: "Structured edit plan created" } },
      },
    },
    "/api/v1/agents/runs/{runId}": {
      get: {
        operationId: "getAgentRun",
        security: bearerSecurity,
        parameters: [
          {
            name: "runId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: { "200": { description: "Agent run" } },
      },
    },
    "/api/v1/agents/runs/{runId}/execute": {
      post: {
        operationId: "executeAgentRun",
        security: bearerSecurity,
        parameters: [
          {
            name: "runId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/AgentExecutionRequest",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Draft created and approval policy applied",
            content: {
              "application/json": {
                schema: envelope({
                  $ref: "#/components/schemas/AgentExecutionResult",
                }),
              },
            },
          },
          "403": { description: "Operation family outside session policy" },
          "409": { description: "Invalid run state or stale revision" },
          "422": { description: "Operation or budget validation failed" },
        },
      },
    },
    "/api/v1/agents/runs/{runId}/evaluations": {
      get: {
        operationId: "listAgentEvaluations",
        security: bearerSecurity,
        parameters: [
          {
            name: "runId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: { "200": { description: "Persisted evaluation cycles" } },
      },
    },
    "/api/v1/agents/runs/{runId}/evaluate": {
      post: {
        operationId: "evaluateAgentDraft",
        security: bearerSecurity,
        parameters: [
          {
            name: "runId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": {
            description: "Deterministic draft evaluation",
            content: {
              "application/json": {
                schema: envelope({
                  $ref: "#/components/schemas/AgentEvaluation",
                }),
              },
            },
          },
          "409": { description: "Run has no evaluable draft" },
          "422": { description: "Preview-cycle budget exhausted" },
        },
      },
    },
    "/api/v1/agents/runs/{runId}/revise": {
      post: {
        operationId: "reviseAgentDraft",
        security: bearerSecurity,
        parameters: [
          {
            name: "runId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AgentRevisionRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Revised, evaluated draft",
            content: {
              "application/json": {
                schema: envelope({
                  $ref: "#/components/schemas/AgentRevisionResult",
                }),
              },
            },
          },
          "409": { description: "Run state or base revision conflict" },
          "422": { description: "Operation or preview-cycle budget exceeded" },
        },
      },
    },
    "/api/v1/approvals": {
      get: {
        operationId: "listApprovals",
        security: bearerSecurity,
        responses: { "200": { description: "Approval records" } },
      },
    },
    "/api/v1/approvals/{approvalId}": {
      get: {
        operationId: "getApproval",
        security: bearerSecurity,
        parameters: [
          {
            name: "approvalId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: { "200": { description: "Approval record" } },
      },
    },
    "/api/v1/approvals/{approvalId}/decision": {
      post: {
        operationId: "decideApproval",
        security: bearerSecurity,
        parameters: [
          {
            name: "approvalId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ApprovalDecision" },
            },
          },
        },
        responses: {
          "200": {
            description: "Draft approved/committed or rejected/rolled back",
          },
          "409": {
            description: "Approval already decided or revision conflict",
          },
        },
      },
    },
    "/api/v1/jobs": {
      get: {
        operationId: "listJobs",
        security: bearerSecurity,
        responses: {
          "200": {
            description: "Persistent jobs",
            content: {
              "application/json": {
                schema: envelope({
                  type: "array",
                  items: { $ref: "#/components/schemas/Job" },
                }),
              },
            },
          },
        },
      },
    },
    "/api/v1/jobs/{jobId}": {
      get: {
        operationId: "getJob",
        security: bearerSecurity,
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": {
            description: "Job state",
            content: {
              "application/json": {
                schema: envelope({ $ref: "#/components/schemas/Job" }),
              },
            },
          },
        },
      },
      delete: {
        operationId: "cancelJob",
        security: bearerSecurity,
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": {
            description: "Cancelled job",
            content: {
              "application/json": {
                schema: envelope({ $ref: "#/components/schemas/Job" }),
              },
            },
          },
        },
      },
    },
    "/api/v1/jobs/{jobId}/artifacts/{artifactName}": {
      get: {
        operationId: "downloadJobArtifact",
        security: bearerSecurity,
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "artifactName",
            in: "path",
            required: true,
            schema: { type: "string", minLength: 1, maxLength: 255 },
          },
        ],
        responses: {
          "200": {
            description: "Authenticated render or preview artifact",
            content: {
              "application/octet-stream": {
                schema: { type: "string", format: "binary" },
              },
              "image/png": { schema: { type: "string", format: "binary" } },
              "video/mp4": { schema: { type: "string", format: "binary" } },
              "application/json": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          "404": { description: "Artifact not found" },
          "409": { description: "Job is not complete" },
        },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    parameters: {
      ProjectId: {
        name: "projectId",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    },
    schemas: {
      Project: projectJsonSchema,
      Asset: assetJsonSchema,
      AnalyzerDescriptor: analyzerDescriptorJsonSchema,
      AnalyzerPluginManifest: analyzerPluginManifestJsonSchema,
      AnalyzerWorkerRequest: analyzerWorkerRequestJsonSchema,
      AnalyzerWorkerEvent: analyzerWorkerEventJsonSchema,
      AnalysisDocument: analysisDocumentJsonSchema,
      AssetAnalysisRequest: assetAnalysisRequestJsonSchema,
      AnalysisSearchRequest: analysisSearchRequestJsonSchema,
      AnalysisSearchResult: analysisSearchResultJsonSchema,
      SemanticFindRequest: semanticFindRequestJsonSchema,
      SemanticFindResult: semanticFindResultJsonSchema,
      SemanticRemoveSilencesRequest: semanticRemoveSilencesRequestJsonSchema,
      SemanticMakeVerticalRequest: semanticMakeVerticalRequestJsonSchema,
      SemanticMatchCutsToMusicRequest:
        semanticMatchCutsToMusicRequestJsonSchema,
      SemanticAddDynamicCaptionsRequest:
        semanticAddDynamicCaptionsRequestJsonSchema,
      SemanticCreateHighlightRequest: semanticCreateHighlightRequestJsonSchema,
      SemanticSyncBrollRequest: semanticSyncBrollRequestJsonSchema,
      SemanticEditPlan: semanticEditPlanJsonSchema,
      Job: jobRecordJsonSchema,
      PreviewRequest: previewRequestJsonSchema,
      PreviewArtifact: previewArtifactJsonSchema,
      AssetImportRequest: assetImportRequestJsonSchema,
      AssetImportResult: assetImportResultJsonSchema,
      AssetProxyRequest: assetProxyRequestJsonSchema,
      AssetThumbnailRequest: assetThumbnailRequestJsonSchema,
      Operation: operationJsonSchema,
      TransactionRequest: transactionRequestJsonSchema,
      TransactionResult: transactionResultJsonSchema,
      AgentSession: agentSessionJsonSchema,
      AgentRun: agentRunJsonSchema,
      EditPlan: editPlanJsonSchema,
      AgentExecutionRequest: agentExecutionRequestJsonSchema,
      AgentExecutionResult: agentExecutionResultJsonSchema,
      AgentEvaluation: agentEvaluationJsonSchema,
      AgentRevisionRequest: agentRevisionRequestJsonSchema,
      AgentRevisionResult: agentRevisionResultJsonSchema,
      Approval: approvalJsonSchema,
      ApprovalDecision: approvalDecisionJsonSchema,
      InterchangeReport: interchangeReportJsonSchema,
      OtioImportRequest: otioImportRequestJsonSchema,
      OtioImportResult: otioImportResultJsonSchema,
      OtioExportRequest: otioExportRequestJsonSchema,
      OtioExportResult: otioExportResultJsonSchema,
      CaptionImportRequest: captionImportRequestJsonSchema,
      CaptionImportResult: captionImportResultJsonSchema,
      CaptionExportRequest: captionExportRequestJsonSchema,
      CaptionExportResult: captionExportResultJsonSchema,
      AgentSessionInput: {
        type: "object",
        additionalProperties: false,
        required: ["projectId", "provider", "model"],
        properties: {
          projectId: { type: "string", format: "uuid" },
          provider: {
            type: "string",
            enum: [
              "openai-compatible",
              "anthropic",
              "gemini",
              "local",
              "external",
            ],
          },
          model: { type: "string" },
          approvalMode: {
            type: "string",
            enum: ["propose", "supervised", "autonomous"],
            default: "supervised",
          },
          budgets: { type: "object", additionalProperties: false },
          allowedOperationFamilies: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
      CreateProjectInput: {
        type: "object",
        required: ["name"],
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1, maxLength: 1024 },
          width: { type: "integer", minimum: 1, maximum: 65535 },
          height: { type: "integer", minimum: 1, maximum: 65535 },
          frameRate: {
            type: "object",
            required: ["numerator", "denominator"],
            properties: {
              numerator: { type: "integer", minimum: 1 },
              denominator: { type: "integer", minimum: 1 },
            },
          },
        },
      },
    },
  },
};

const mcpManifest = {
  protocolVersion: "2025-11-25",
  transports: ["stdio", "streamable-http"],
  endpoint: "/mcp",
  tools: [
    "project.create",
    "project.open",
    "project.inspect",
    "project.history",
    "capabilities.search",
    "operations.search",
    "operations.describe",
    "asset.import",
    "asset.proxy.create",
    "asset.thumbnail.create",
    "asset.inspect",
    "asset.analyze",
    "asset.search",
    "semantic.find",
    "semantic.remove_silences.plan",
    "semantic.make_vertical.plan",
    "semantic.match_cuts_to_music.plan",
    "semantic.add_dynamic_captions.plan",
    "semantic.create_highlight.plan",
    "semantic.sync_broll.plan",
    "transaction.create",
    "transaction.apply",
    "transaction.validate",
    "transaction.preview",
    "transaction.commit",
    "transaction.rollback",
    "preview.frame",
    "preview.contact_sheet",
    "preview.region",
    "preview.waveform",
    "render.start",
    "render.status",
    "render.cancel",
    "edit.plan",
    "edit.execute",
    "edit.evaluate",
    "edit.revise",
    "project.import_otio",
    "project.export_otio",
    "caption.import",
    "caption.export",
  ],
  operationResources: Object.keys(executableOperationSchemas).sort(),
};

const pythonClientMethods = [
  {
    name: "list_projects",
    method: "GET",
    path: "/api/v1/projects",
    args: "",
    body: "None",
  },
  {
    name: "create_project",
    method: "POST",
    path: "/api/v1/projects",
    args: "input: JsonObject",
    body: "input",
  },
  {
    name: "get_project",
    method: "GET",
    path: "/api/v1/projects/{project_id}",
    args: "project_id: str",
    body: "None",
  },
  {
    name: "get_project_revision",
    method: "GET",
    path: "/api/v1/projects/{project_id}/revisions/{revision}",
    args: "project_id: str, revision: int",
    body: "None",
  },
  {
    name: "execute_transaction",
    method: "POST",
    path: "/api/v1/transactions",
    args: "input: JsonObject",
    body: "input",
  },
  {
    name: "import_otio",
    method: "POST",
    path: "/api/v1/imports/otio",
    args: "input: JsonObject",
    body: "input",
  },
  {
    name: "export_otio",
    method: "POST",
    path: "/api/v1/exports/otio",
    args: "input: JsonObject",
    body: "input",
  },
  {
    name: "import_captions",
    method: "POST",
    path: "/api/v1/imports/captions",
    args: "input: JsonObject",
    body: "input",
  },
  {
    name: "export_captions",
    method: "POST",
    path: "/api/v1/exports/captions",
    args: "input: JsonObject",
    body: "input",
  },
  {
    name: "list_capabilities",
    method: "GET",
    path: "/api/v1/capabilities",
    args: "search: str | None = None",
    body: "None",
    query: "{'search': search} if search is not None else None",
  },
  {
    name: "list_admin_logs",
    method: "GET",
    path: "/api/v1/admin/logs",
    args: "level: str | None = None, category: str | None = None, project_id: str | None = None, search: str | None = None, limit: int | None = None",
    body: "None",
    query:
      "{key: value for key, value in {'level': level, 'category': category, 'projectId': project_id, 'search': search, 'limit': limit}.items() if value is not None}",
  },
  {
    name: "get_admin_provider_usage",
    method: "GET",
    path: "/api/v1/admin/usage",
    args: "project_id: str | None = None, session_id: str | None = None",
    body: "None",
    query:
      "{key: value for key, value in {'projectId': project_id, 'sessionId': session_id}.items() if value is not None}",
  },
  {
    name: "list_analyzers",
    method: "GET",
    path: "/api/v1/analysis/analyzers",
    args: "",
    body: "None",
  },
  {
    name: "import_asset",
    method: "POST",
    path: "/api/v1/assets/imports",
    args: "input: JsonObject",
    body: "input",
  },
  {
    name: "create_asset_proxy",
    method: "POST",
    path: "/api/v1/projects/{project_id}/assets/{asset_id}/proxies",
    args: "project_id: str, asset_id: str, input: JsonObject",
    body: "input",
  },
  {
    name: "create_asset_thumbnail",
    method: "POST",
    path: "/api/v1/projects/{project_id}/assets/{asset_id}/thumbnails",
    args: "project_id: str, asset_id: str, input: JsonObject",
    body: "input",
  },
  {
    name: "analyze_asset",
    method: "POST",
    path: "/api/v1/projects/{project_id}/assets/{asset_id}/analysis",
    args: "project_id: str, asset_id: str, input: JsonObject",
    body: "input",
  },
  {
    name: "list_asset_analysis",
    method: "GET",
    path: "/api/v1/projects/{project_id}/assets/{asset_id}/analysis",
    args: "project_id: str, asset_id: str",
    body: "None",
  },
  {
    name: "search_analysis",
    method: "POST",
    path: "/api/v1/assets/search",
    args: "input: JsonObject",
    body: "input",
  },
  {
    name: "find_semantic_ranges",
    method: "POST",
    path: "/api/v1/semantic/find",
    args: "input: JsonObject",
    body: "input",
  },
  {
    name: "plan_silence_removal",
    method: "POST",
    path: "/api/v1/semantic/remove-silences/plan",
    args: "input: JsonObject",
    body: "input",
  },
  {
    name: "plan_vertical_conversion",
    method: "POST",
    path: "/api/v1/semantic/make-vertical/plan",
    args: "input: JsonObject",
    body: "input",
  },
  {
    name: "plan_cuts_to_music",
    method: "POST",
    path: "/api/v1/semantic/match-cuts-to-music/plan",
    args: "input: JsonObject",
    body: "input",
  },
  {
    name: "plan_dynamic_captions",
    method: "POST",
    path: "/api/v1/semantic/add-dynamic-captions/plan",
    args: "input: JsonObject",
    body: "input",
  },
  {
    name: "plan_create_highlight",
    method: "POST",
    path: "/api/v1/semantic/create-highlight/plan",
    args: "input: JsonObject",
    body: "input",
  },
  {
    name: "plan_sync_broll",
    method: "POST",
    path: "/api/v1/semantic/sync-broll/plan",
    args: "input: JsonObject",
    body: "input",
  },
  {
    name: "get_job",
    method: "GET",
    path: "/api/v1/jobs/{job_id}",
    args: "job_id: str",
    body: "None",
  },
  {
    name: "start_preview",
    method: "POST",
    path: "/api/v1/previews",
    args: "input: JsonObject",
    body: "input",
  },
  {
    name: "cancel_job",
    method: "DELETE",
    path: "/api/v1/jobs/{job_id}",
    args: "job_id: str",
    body: "None",
  },
  {
    name: "create_agent_session",
    method: "POST",
    path: "/api/v1/agents/sessions",
    args: "input: JsonObject",
    body: "input",
  },
  {
    name: "plan_edit",
    method: "POST",
    path: "/api/v1/agents/runs",
    args: "session_id: str, request: str",
    body: "{'sessionId': session_id, 'request': request}",
  },
  {
    name: "execute_agent_run",
    method: "POST",
    path: "/api/v1/agents/runs/{run_id}/execute",
    args: "run_id: str, operations: JsonArray",
    body: "{'operations': operations}",
  },
  {
    name: "evaluate_agent_run",
    method: "POST",
    path: "/api/v1/agents/runs/{run_id}/evaluate",
    args: "run_id: str",
    body: "None",
  },
  {
    name: "list_agent_evaluations",
    method: "GET",
    path: "/api/v1/agents/runs/{run_id}/evaluations",
    args: "run_id: str",
    body: "None",
  },
  {
    name: "revise_agent_run",
    method: "POST",
    path: "/api/v1/agents/runs/{run_id}/revise",
    args: "run_id: str, operations: JsonArray",
    body: "{'operations': operations}",
  },
  {
    name: "list_approvals",
    method: "GET",
    path: "/api/v1/approvals",
    args: "project_id: str | None = None, status: str | None = None",
    body: "None",
    query:
      "{key: value for key, value in {'projectId': project_id, 'status': status}.items() if value is not None}",
  },
  {
    name: "decide_approval",
    method: "POST",
    path: "/api/v1/approvals/{approval_id}/decision",
    args: "approval_id: str, decision: JsonObject",
    body: "decision",
  },
] as const;

function pythonFormatPath(path: string): string {
  return path.replace(
    /\{([A-Za-z_][A-Za-z0-9_]*)\}/gu,
    (_, name: string) => `{quote(str(${name}))}`,
  );
}

function pythonSdkClient(): string {
  const methods = pythonClientMethods
    .map((method) => {
      const args = method.args === "" ? "" : `, ${method.args}`;
      const query = "query" in method ? method.query : "None";
      return `    def ${method.name}(self${args}) -> JsonValue:\n        return self._request("${method.method}", f"${pythonFormatPath(method.path)}", body=${method.body}, query=${query})\n`;
    })
    .join("\n");
  return `# Generated from packages/contracts/openapi/frameos.openapi.json. Do not edit by hand.\nfrom __future__ import annotations\n\nimport json\nfrom typing import Any\nfrom urllib.error import HTTPError\nfrom urllib.parse import quote, urlencode\nfrom urllib.request import Request, urlopen\n\nJsonObject = dict[str, Any]\nJsonArray = list[Any]\nJsonValue = JsonObject | JsonArray | str | int | float | bool | None\n\n\nclass FrameOSApiError(Exception):\n    def __init__(self, code: str, message: str, status: int, details: JsonArray | None = None) -> None:\n        super().__init__(message)\n        self.code = code\n        self.status = status\n        self.details = details\n\n\nclass FrameOSClient:\n    def __init__(self, base_url: str, token: str) -> None:\n        self.base_url = base_url.rstrip("/")\n        self.token = token\n\n    def _request(self, method: str, path: str, body: JsonValue = None, query: JsonObject | None = None) -> JsonValue:\n        if query:\n            path = f"{path}?{urlencode(query)}"\n        payload = None if body is None else json.dumps(body).encode("utf-8")\n        request = Request(\n            f"{self.base_url}{path}",\n            data=payload,\n            method=method,\n            headers={\n                "Authorization": f"Bearer {self.token}",\n                "Accept": "application/json",\n                **({} if body is None else {"Content-Type": "application/json"}),\n            },\n        )\n        try:\n            with urlopen(request) as response:\n                envelope = json.loads(response.read().decode("utf-8"))\n                status = response.status\n        except HTTPError as error:\n            status = error.code\n            try:\n                envelope = json.loads(error.read().decode("utf-8"))\n            except Exception as exc:  # pragma: no cover - transport fallback\n                raise FrameOSApiError(f"HTTP_{status}", str(error), status) from exc\n        api_error = envelope.get("error")\n        data = envelope.get("data")\n        if api_error is not None or data is None:\n            api_error = api_error or {"code": f"HTTP_{status}", "message": "Empty API response"}\n            raise FrameOSApiError(api_error.get("code", "UNKNOWN"), api_error.get("message", "Unknown API error"), status, api_error.get("details"))\n        return data\n\n${methods}    def download_job_artifact(self, job_id: str, artifact_name: str) -> bytes:\n        path = f"/api/v1/jobs/{quote(str(job_id))}/artifacts/{quote(str(artifact_name))}"\n        request = Request(\n            f"{self.base_url}{path}",\n            method="GET",\n            headers={"Authorization": f"Bearer {self.token}", "Accept": "*/*"},\n        )\n        with urlopen(request) as response:\n            return response.read()\n`;
}

await Promise.all([
  emit("schema/frameos-project.schema.json", projectJsonSchema),
  emit("schema/asset.schema.json", assetJsonSchema),
  emit("schema/analyzer-descriptor.schema.json", analyzerDescriptorJsonSchema),
  emit(
    "schema/analyzer-plugin-manifest.schema.json",
    analyzerPluginManifestJsonSchema,
  ),
  emit(
    "schema/analyzer-worker-request.schema.json",
    analyzerWorkerRequestJsonSchema,
  ),
  emit(
    "schema/analyzer-worker-event.schema.json",
    analyzerWorkerEventJsonSchema,
  ),
  emit("schema/analysis-document.schema.json", analysisDocumentJsonSchema),
  emit(
    "schema/asset-analysis-request.schema.json",
    assetAnalysisRequestJsonSchema,
  ),
  emit(
    "schema/analysis-search-request.schema.json",
    analysisSearchRequestJsonSchema,
  ),
  emit(
    "schema/analysis-search-result.schema.json",
    analysisSearchResultJsonSchema,
  ),
  emit(
    "schema/semantic-find-request.schema.json",
    semanticFindRequestJsonSchema,
  ),
  emit("schema/semantic-find-result.schema.json", semanticFindResultJsonSchema),
  emit(
    "schema/semantic-remove-silences-request.schema.json",
    semanticRemoveSilencesRequestJsonSchema,
  ),
  emit(
    "schema/semantic-make-vertical-request.schema.json",
    semanticMakeVerticalRequestJsonSchema,
  ),
  emit(
    "schema/semantic-match-cuts-to-music-request.schema.json",
    semanticMatchCutsToMusicRequestJsonSchema,
  ),
  emit(
    "schema/semantic-add-dynamic-captions-request.schema.json",
    semanticAddDynamicCaptionsRequestJsonSchema,
  ),
  emit(
    "schema/semantic-create-highlight-request.schema.json",
    semanticCreateHighlightRequestJsonSchema,
  ),
  emit(
    "schema/semantic-sync-broll-request.schema.json",
    semanticSyncBrollRequestJsonSchema,
  ),
  emit("schema/semantic-edit-plan.schema.json", semanticEditPlanJsonSchema),
  emit("schema/job.schema.json", jobRecordJsonSchema),
  emit("schema/preview-request.schema.json", previewRequestJsonSchema),
  emit("schema/preview-artifact.schema.json", previewArtifactJsonSchema),
  emit("schema/asset-import-request.schema.json", assetImportRequestJsonSchema),
  emit("schema/asset-import-result.schema.json", assetImportResultJsonSchema),
  emit("schema/asset-proxy-request.schema.json", assetProxyRequestJsonSchema),
  emit(
    "schema/asset-thumbnail-request.schema.json",
    assetThumbnailRequestJsonSchema,
  ),
  emit("schema/media-probe-result.schema.json", mediaProbeResultJsonSchema),
  emit("schema/operation.schema.json", operationJsonSchema),
  emit("schema/transaction-request.schema.json", transactionRequestJsonSchema),
  emit("schema/transaction-result.schema.json", transactionResultJsonSchema),
  emit("schema/agent-session.schema.json", agentSessionJsonSchema),
  emit("schema/agent-run.schema.json", agentRunJsonSchema),
  emit("schema/edit-plan.schema.json", editPlanJsonSchema),
  emit(
    "schema/agent-execution-request.schema.json",
    agentExecutionRequestJsonSchema,
  ),
  emit(
    "schema/agent-execution-result.schema.json",
    agentExecutionResultJsonSchema,
  ),
  emit("schema/agent-evaluation.schema.json", agentEvaluationJsonSchema),
  emit(
    "schema/agent-revision-request.schema.json",
    agentRevisionRequestJsonSchema,
  ),
  emit(
    "schema/agent-revision-result.schema.json",
    agentRevisionResultJsonSchema,
  ),
  emit("schema/approval.schema.json", approvalJsonSchema),
  emit("schema/approval-decision.schema.json", approvalDecisionJsonSchema),
  emit("schema/interchange-report.schema.json", interchangeReportJsonSchema),
  emit("schema/otio-import-request.schema.json", otioImportRequestJsonSchema),
  emit("schema/otio-import-result.schema.json", otioImportResultJsonSchema),
  emit("schema/otio-export-request.schema.json", otioExportRequestJsonSchema),
  emit("schema/otio-export-result.schema.json", otioExportResultJsonSchema),
  emit(
    "schema/caption-import-request.schema.json",
    captionImportRequestJsonSchema,
  ),
  emit(
    "schema/caption-import-result.schema.json",
    captionImportResultJsonSchema,
  ),
  emit(
    "schema/caption-export-request.schema.json",
    captionExportRequestJsonSchema,
  ),
  emit(
    "schema/caption-export-result.schema.json",
    captionExportResultJsonSchema,
  ),
  emit("openapi/frameos.openapi.json", openapi),
  emit("mcp/manifest.json", mcpManifest),
  emitWorkspaceText("packages/sdk-python/frameos/client.py", pythonSdkClient()),
  emitWorkspaceText(
    "packages/sdk-python/frameos/__init__.py",
    'from .client import FrameOSApiError, FrameOSClient\n\n__all__ = ["FrameOSApiError", "FrameOSClient"]\n',
  ),
]);
