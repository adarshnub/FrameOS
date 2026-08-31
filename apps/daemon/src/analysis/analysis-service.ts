import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analysisDocumentSchema,
  analysisSearchRequestSchema,
  analysisSearchResultSchema,
  assetAnalysisRequestSchema,
  createId,
  FrameOSError,
  type AnalysisDocument,
  type AnalysisSearchRequest,
  type AnalysisSearchResult,
  type AnalysisSegment,
  type AnalyzerDescriptor,
  type AssetAnalysisRequest,
  type Project,
} from "@frameos/contracts";
import type { EventBus } from "../events/event-bus.js";
import type { JobManager } from "../jobs/job-manager.js";
import type { MediaPolicy } from "../security/media-policy.js";
import type { ProjectStore } from "../store/project-store.js";
import type {
  AnalysisIndexRow,
  JobRecord,
  RuntimeDatabase,
} from "../store/runtime-database.js";
import type { TransactionEngine } from "../domain/transaction-engine.js";
import { parseCaptionDocument } from "../interchange/captions.js";
import type { AnalyzerPlugin, AnalyzerPluginLoadResult } from "./types.js";

const allAssetKinds: Project["assets"][string]["kind"][] = [
  "video",
  "audio",
  "image",
  "image_sequence",
  "subtitle",
  "font",
  "generated",
];

export const analyzerDescriptors: AnalyzerDescriptor[] = [
  {
    id: "frameos.asset-metadata",
    version: "1.0.0",
    capabilityId: "analysis.asset-metadata",
    name: "Asset metadata summary",
    description:
      "Creates a deterministic searchable summary from canonical asset and stream metadata.",
    outputTypes: ["asset_summary"],
    assetKinds: allAssetKinds,
    available: true,
    deterministic: true,
    parameterSchema: {},
  },
  {
    id: "frameos.subtitle-text",
    version: "1.0.0",
    capabilityId: "analysis.subtitle-text",
    name: "Subtitle text parser",
    description:
      "Parses an approved local SRT or WebVTT subtitle asset into timestamped searchable transcript segments.",
    outputTypes: ["transcript"],
    assetKinds: ["subtitle"],
    available: true,
    deterministic: true,
    parameterSchema: {},
  },
  {
    id: "whisper.cpp.transcribe",
    version: "planned",
    capabilityId: "analysis.transcription.whisper",
    name: "Speech transcription",
    description:
      "Produces word-timestamped transcripts through an audited whisper.cpp worker.",
    outputTypes: ["transcript", "words"],
    assetKinds: ["video", "audio"],
    available: false,
    deterministic: false,
    reasonUnavailable: "No audited whisper.cpp model and worker are installed",
    parameterSchema: {},
  },
  {
    id: "ffmpeg.silence.detect",
    version: "planned",
    capabilityId: "analysis.silence.ffmpeg",
    name: "Silence detection",
    description:
      "Produces reproducible silence ranges through an audited FFmpeg worker.",
    outputTypes: ["silence"],
    assetKinds: ["video", "audio"],
    available: false,
    deterministic: true,
    reasonUnavailable: "No audited FFmpeg analyzer worker is installed",
    parameterSchema: {},
  },
  {
    id: "ffmpeg.scene.detect",
    version: "planned",
    capabilityId: "analysis.scenes.ffmpeg",
    name: "Scene and shot detection",
    description:
      "Produces reproducible scene ranges through an audited FFmpeg worker.",
    outputTypes: ["scenes"],
    assetKinds: ["video"],
    available: false,
    deterministic: true,
    reasonUnavailable: "No audited FFmpeg scene analyzer worker is installed",
    parameterSchema: {},
  },
  {
    id: "ffmpeg.beats.detect",
    version: "planned",
    capabilityId: "analysis.beats.ffmpeg",
    name: "Beat and onset detection",
    description:
      "Produces reproducible beat/onset markers through audited FFmpeg PCM decoding and deterministic energy-flux analysis.",
    outputTypes: ["beats"],
    assetKinds: ["video", "audio"],
    available: false,
    deterministic: true,
    reasonUnavailable: "No audited FFmpeg beat analyzer worker is installed",
    parameterSchema: {},
  },
  {
    id: "onnx.visual-intelligence",
    version: "planned",
    capabilityId: "analysis.visual.onnx",
    name: "Visual intelligence",
    description:
      "Produces scene, face, object, OCR, quality, and embedding artifacts through audited ONNX models.",
    outputTypes: ["scenes", "objects", "ocr", "quality", "embeddings"],
    assetKinds: ["video", "image", "image_sequence"],
    available: false,
    deterministic: false,
    reasonUnavailable: "No audited ONNX Runtime model bundle is installed",
    parameterSchema: {},
  },
  {
    id: "google.vertex.gemini.video",
    version: "planned",
    capabilityId: "analysis.visual.gemini",
    name: "Gemini video intelligence",
    description:
      "Uses Vertex AI Gemini with a temporary private Cloud Storage object to produce timestamped visual semantic segments.",
    outputTypes: ["visual_semantic"],
    assetKinds: ["video", "audio", "image"],
    available: false,
    deterministic: false,
    reasonUnavailable:
      "Configure Vertex AI Gemini, Cloud Storage, and Application Default Credentials",
    parameterSchema: {},
  },
];

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted)
    throw new FrameOSError("JOB_CANCELLED", "Job was cancelled", 409);
}

function metadataAnalyzer(): AnalyzerPlugin {
  return {
    descriptor: analyzerDescriptors[0]!,
    async analyze({ asset, signal }) {
      throwIfCancelled(signal);
      const codecs = [...new Set(asset.streams.map((stream) => stream.codec))];
      const labels = [
        asset.kind,
        ...asset.streams.map((stream) => stream.kind),
      ];
      return {
        type: "asset_summary",
        segments: [
          {
            id: createId(),
            text: [asset.name, asset.kind, ...codecs].join(" "),
            labels: [...new Set(labels)],
            metadata: {
              uri: asset.uri,
              streamCount: asset.streams.length,
              codecs,
            },
          },
        ],
        metadata: { source: "canonical-asset-metadata" },
      };
    },
  };
}

function subtitleAnalyzer(
  mediaPolicy: MediaPolicy,
  projects: ProjectStore,
): AnalyzerPlugin {
  return {
    descriptor: analyzerDescriptors[1]!,
    async analyze({ project, asset, signal }) {
      throwIfCancelled(signal);
      await mediaPolicy.validateUris([asset.uri]);
      const path = asset.uri.startsWith("frameos:")
        ? projects.resolveProjectUri(project.projectId, asset.uri)
        : asset.uri.startsWith("file:")
          ? fileURLToPath(asset.uri)
          : asset.uri;
      if (!isAbsolute(path)) {
        throw new FrameOSError(
          "UNSUPPORTED_FORMAT",
          "Subtitle analysis requires an approved local file",
          422,
        );
      }
      const info = await stat(path);
      if (info.size > 32 * 1_024 * 1_024) {
        throw new FrameOSError(
          "RESOURCE_LIMIT",
          "Subtitle analysis is limited to 32 MiB per asset",
          413,
        );
      }
      const format = path.toLowerCase().endsWith(".vtt") ? "vtt" : "srt";
      const parsed = parseCaptionDocument(await readFile(path, "utf8"), format);
      const segments: AnalysisSegment[] = parsed.cues.map((cue) => ({
        id: cue.id,
        range: cue.range,
        text: cue.text.replace(/<[^>]{1,256}>/gu, "").trim(),
        labels: ["subtitle", "speech"],
        metadata: {
          untrustedSourceText: true,
          sourceFormat: format,
          sourceStyle: cue.style,
        },
      }));
      throwIfCancelled(signal);
      if (segments.length === 0) {
        throw new FrameOSError(
          "UNSUPPORTED_FORMAT",
          "No valid SRT or WebVTT cues were found",
          422,
        );
      }
      return {
        type: "transcript",
        segments,
        metadata: {
          format,
          warnings: parsed.warnings,
        },
      };
    },
  };
}

function cosine(left: number[], right: number[]): number | undefined {
  if (left.length !== right.length) return undefined;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return undefined;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export class AnalysisService {
  private readonly plugins: Map<string, AnalyzerPlugin>;
  private readonly descriptors: AnalyzerDescriptor[];

  public constructor(
    private readonly database: RuntimeDatabase,
    private readonly projects: ProjectStore,
    private readonly transactions: TransactionEngine,
    private readonly jobs: JobManager,
    private readonly events: EventBus,
    mediaPolicy: MediaPolicy,
    external: AnalyzerPluginLoadResult = { plugins: [], descriptors: [] },
  ) {
    const plugins: AnalyzerPlugin[] = [
      metadataAnalyzer(),
      subtitleAnalyzer(mediaPolicy, this.projects),
      ...external.plugins,
    ];
    this.plugins = new Map(
      plugins.map((plugin) => [plugin.descriptor.id, plugin]),
    );
    const descriptors = structuredClone(analyzerDescriptors);
    for (const externalDescriptor of external.descriptors) {
      const index = descriptors.findIndex(
        (candidate) =>
          candidate.id === externalDescriptor.id ||
          candidate.capabilityId === externalDescriptor.capabilityId,
      );
      if (index >= 0 && descriptors[index]!.available) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `External analyzer conflicts with built-in analyzer ${descriptors[index]!.id}`,
          422,
        );
      }
      if (index >= 0) descriptors[index] = externalDescriptor;
      else descriptors.push(externalDescriptor);
    }
    this.descriptors = descriptors;
  }

  public listAnalyzers(): AnalyzerDescriptor[] {
    return structuredClone(this.descriptors);
  }

  public async listAssetArtifacts(projectId: string, assetId: string) {
    const project = await this.projects.load(projectId);
    const asset = project.assets[assetId];
    if (asset === undefined)
      throw new FrameOSError(
        "NOT_FOUND",
        `Asset ${assetId} was not found`,
        404,
      );
    return asset.analysisRefs.map((id) => project.analyses[id]).filter(Boolean);
  }

  public async start(request: AssetAnalysisRequest): Promise<JobRecord> {
    const parsed = assetAnalysisRequestSchema.parse(request);
    const project = await this.projects.load(parsed.projectId);
    const asset = project.assets[parsed.assetId];
    if (asset === undefined) {
      throw new FrameOSError(
        "NOT_FOUND",
        `Asset ${parsed.assetId} was not found`,
        404,
      );
    }
    for (const analyzerId of parsed.analyzers) {
      const descriptor = this.descriptors.find(
        (candidate) => candidate.id === analyzerId,
      );
      if (descriptor === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Analyzer ${analyzerId} was not found`,
          404,
        );
      }
      if (!descriptor.available || !this.plugins.has(analyzerId)) {
        throw new FrameOSError(
          "CAPABILITY_UNAVAILABLE",
          descriptor.reasonUnavailable ??
            `Analyzer ${analyzerId} is unavailable`,
          424,
          [{ field: "analyzers", message: descriptor.capabilityId }],
        );
      }
      if (!descriptor.assetKinds.includes(asset.kind)) {
        throw new FrameOSError(
          "UNSUPPORTED_FORMAT",
          `Analyzer ${analyzerId} does not accept ${asset.kind} assets`,
          422,
        );
      }
    }
    return this.jobs.startManagedJob({
      projectId: project.projectId,
      projectRevision: project.revision,
      kind: "analysis",
      request: parsed,
      runner: async (signal, reportProgress) => {
        const artifacts = [];
        for (let index = 0; index < parsed.analyzers.length; index += 1) {
          throwIfCancelled(signal);
          const analyzerId = parsed.analyzers[index]!;
          const artifact = await this.runAnalyzer(
            parsed,
            analyzerId,
            signal,
            (pluginProgress) =>
              reportProgress(
                (index + Math.max(0, Math.min(1, pluginProgress))) /
                  parsed.analyzers.length,
              ),
          );
          artifacts.push(artifact);
          reportProgress((index + 1) / parsed.analyzers.length);
        }
        return {
          artifacts,
          searchBackend: this.database.analysisSearchBackend(),
        };
      },
    });
  }

  private async runAnalyzer(
    request: AssetAnalysisRequest,
    analyzerId: string,
    signal: AbortSignal,
    reportProgress: (progress: number) => void,
  ) {
    const plugin = this.plugins.get(analyzerId)!;
    const parameters = request.parameters[analyzerId] ?? {};
    const parametersHash = sha256(parameters);
    let project = await this.projects.load(request.projectId);
    const asset = project.assets[request.assetId];
    if (asset === undefined) {
      throw new FrameOSError(
        "NOT_FOUND",
        `Asset ${request.assetId} was removed`,
        404,
      );
    }
    const reproducibilityKey = sha256({
      assetHash: asset.hash,
      analyzerId,
      analyzerVersion: plugin.descriptor.version,
      modelHash: plugin.descriptor.modelHash,
      binaryHash: plugin.descriptor.binaryHash,
      bundleHash: plugin.descriptor.bundleHash,
      parametersHash,
    });
    const cacheKey = `${project.projectId}:${reproducibilityKey}`;
    if (!request.force) {
      const cached = this.database.getCachedAnalysis(cacheKey);
      if (cached !== undefined && project.analyses[cached.id] !== undefined) {
        const document = await this.projects.readAnalysisDocument(
          project.projectId,
          cached.id,
        );
        this.database.indexAnalysisDocument(document);
        return { artifact: cached, cached: true, reproducibilityKey };
      }
    }
    const result = await plugin.analyze({
      project,
      asset,
      parameters,
      signal,
      reportProgress,
    });
    throwIfCancelled(signal);
    if (!plugin.descriptor.outputTypes.includes(result.type)) {
      throw new FrameOSError(
        "PLUGIN_FAILURE",
        `Analyzer ${analyzerId} returned undeclared output type ${result.type}`,
        500,
      );
    }
    const artifactId = createId();
    const document = analysisDocumentSchema.parse({
      schemaVersion: "1.0.0",
      artifactId,
      projectId: project.projectId,
      assetId: asset.id,
      assetHash: asset.hash,
      analyzerId,
      analyzerVersion: plugin.descriptor.version,
      parametersHash,
      ...(plugin.descriptor.modelHash === undefined
        ? {}
        : { modelHash: plugin.descriptor.modelHash }),
      ...(plugin.descriptor.binaryHash === undefined
        ? {}
        : { binaryHash: plugin.descriptor.binaryHash }),
      ...(plugin.descriptor.bundleHash === undefined
        ? {}
        : { bundleHash: plugin.descriptor.bundleHash }),
      type: result.type,
      segments: result.segments,
      metadata: {
        ...(result.metadata ?? {}),
        reproducibilityKey,
        runtime: {
          ...(plugin.descriptor.binaryHash === undefined
            ? {}
            : { binaryHash: plugin.descriptor.binaryHash }),
          ...(plugin.descriptor.bundleHash === undefined
            ? {}
            : { bundleHash: plugin.descriptor.bundleHash }),
          ...(plugin.descriptor.binaryLicense === undefined
            ? {}
            : { binaryLicense: plugin.descriptor.binaryLicense }),
          ...(plugin.descriptor.modelHash === undefined
            ? {}
            : { modelHash: plugin.descriptor.modelHash }),
          ...(plugin.descriptor.modelLicense === undefined
            ? {}
            : { modelLicense: plugin.descriptor.modelLicense }),
        },
      },
    });
    const dataUri = await this.projects.writeAnalysisDocument(document);
    const artifact = {
      id: artifactId,
      analyzerId,
      analyzerVersion: plugin.descriptor.version,
      parametersHash,
      ...(plugin.descriptor.modelHash === undefined
        ? {}
        : { modelHash: plugin.descriptor.modelHash }),
      ...(plugin.descriptor.binaryHash === undefined
        ? {}
        : { binaryHash: plugin.descriptor.binaryHash }),
      ...(plugin.descriptor.bundleHash === undefined
        ? {}
        : { bundleHash: plugin.descriptor.bundleHash }),
      assetHash: asset.hash,
      type: result.type,
      timeRanges: result.segments.flatMap((segment) =>
        segment.range === undefined ? [] : [segment.range],
      ),
      dataUri,
      createdAt: new Date().toISOString(),
      metadata: {
        reproducibilityKey,
        segmentCount: result.segments.length,
        ...(plugin.descriptor.binaryHash === undefined
          ? {}
          : { binaryHash: plugin.descriptor.binaryHash }),
        ...(plugin.descriptor.bundleHash === undefined
          ? {}
          : { bundleHash: plugin.descriptor.bundleHash }),
        ...(plugin.descriptor.modelHash === undefined
          ? {}
          : { modelHash: plugin.descriptor.modelHash }),
      },
    };
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        throwIfCancelled(signal);
        project = await this.projects.load(project.projectId);
        if (project.assets[asset.id]?.hash !== asset.hash) {
          throw new FrameOSError(
            "REVISION_CONFLICT",
            "Asset changed while analysis was running",
            409,
          );
        }
        try {
          await this.transactions.execute({
            projectId: project.projectId,
            baseRevision: project.revision,
            idempotencyKey: `analysis-${reproducibilityKey}-${artifactId}`,
            mode: "commit",
            operations: [
              {
                operationId: createId(),
                type: "analysis.attach",
                targetId: asset.id,
                preconditions: [],
                provenance: {
                  actorType: "system",
                  actorId: analyzerId,
                },
                arguments: { assetId: asset.id, artifact },
              },
            ],
          });
          break;
        } catch (error) {
          if (
            !(error instanceof FrameOSError) ||
            error.code !== "REVISION_CONFLICT" ||
            attempt === 2
          ) {
            throw error;
          }
        }
      }
      this.database.indexAnalysisDocument(document);
      this.database.putCachedAnalysis(
        cacheKey,
        project.projectId,
        asset.id,
        artifact,
      );
      this.events.publish(
        "analysis.artifact_ready",
        { artifactId, assetId: asset.id, analyzerId },
        project.projectId,
      );
      return { artifact, cached: false, reproducibilityKey };
    } catch (error) {
      await this.projects.deleteAnalysisDocument(project.projectId, artifactId);
      throw error;
    }
  }

  private async ensureIndexed(project: Project): Promise<void> {
    await Promise.all(
      Object.values(project.analyses).map(async (artifact) => {
        try {
          const document = await this.projects.readAnalysisDocument(
            project.projectId,
            artifact.id,
          );
          this.database.indexAnalysisDocument(document);
        } catch (error) {
          if (!(error instanceof FrameOSError) || error.code !== "NOT_FOUND")
            throw error;
        }
      }),
    );
  }

  public async search(
    request: AnalysisSearchRequest,
  ): Promise<AnalysisSearchResult[]> {
    const parsed = analysisSearchRequestSchema.parse(request);
    const project = await this.projects.load(parsed.projectId);
    await this.ensureIndexed(project);
    const resultById = new Map<
      string,
      { row: AnalysisIndexRow; lexicalScore?: number; semanticScore?: number }
    >();
    if (parsed.mode !== "semantic") {
      for (const row of this.database.searchAnalysisText(
        project.projectId,
        parsed.query,
        Math.min(5_000, parsed.limit * 10),
      )) {
        resultById.set(row.segmentId, {
          row,
          lexicalScore:
            parsed.query.trim() === "" ? 1 : 1 / (1 + Math.abs(row.rank ?? 1)),
        });
      }
    }
    if (parsed.mode !== "lexical") {
      const queryEmbedding = parsed.queryEmbedding!;
      for (const row of this.database.listAnalysisVectors(project.projectId)) {
        if (row.embedding === undefined) continue;
        const similarity = cosine(queryEmbedding, row.embedding);
        if (similarity === undefined) continue;
        const existing = resultById.get(row.segmentId);
        resultById.set(row.segmentId, {
          row,
          ...(existing?.lexicalScore === undefined
            ? {}
            : { lexicalScore: existing.lexicalScore }),
          semanticScore: Math.max(0, Math.min(1, (similarity + 1) / 2)),
        });
      }
    }
    const assetIds =
      parsed.assetIds === undefined ? undefined : new Set(parsed.assetIds);
    const types =
      parsed.types === undefined ? undefined : new Set(parsed.types);
    return [...resultById.values()]
      .filter(
        ({ row }) =>
          project.analyses[row.artifactId] !== undefined &&
          (assetIds === undefined || assetIds.has(row.assetId)) &&
          (types === undefined || types.has(row.type)),
      )
      .map(({ row, lexicalScore, semanticScore }) => {
        const score =
          parsed.mode === "lexical"
            ? (lexicalScore ?? 0)
            : parsed.mode === "semantic"
              ? (semanticScore ?? 0)
              : (lexicalScore ?? 0) * 0.45 + (semanticScore ?? 0) * 0.55;
        return analysisSearchResultSchema.parse({
          segmentId: row.segmentId,
          artifactId: row.artifactId,
          assetId: row.assetId,
          type: row.type,
          score,
          ...(lexicalScore === undefined ? {} : { lexicalScore }),
          ...(semanticScore === undefined ? {} : { semanticScore }),
          ...(row.range === undefined ? {} : { range: row.range }),
          ...(row.text === undefined ? {} : { text: row.text }),
          labels: row.labels,
          ...(row.speaker === undefined ? {} : { speaker: row.speaker }),
          ...(row.confidence === undefined
            ? {}
            : { confidence: row.confidence }),
          metadata: row.metadata,
        });
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, parsed.limit);
  }
}
