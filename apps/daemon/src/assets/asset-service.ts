import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assetImportRequestSchema,
  assetImportResultSchema,
  assetProxyRequestSchema,
  assetThumbnailRequestSchema,
  createId,
  FrameOSError,
  rescaleTime,
  type Asset,
  type AssetImportRequest,
  type AssetImportResult,
  type AssetProxyRequest,
  type AssetThumbnailRequest,
  type JobRecord,
  type MediaProbeResult,
} from "@frameos/contracts";
import type { EngineWorkerClient } from "../engine/worker-client.js";
import type { EventBus } from "../events/event-bus.js";
import type { MediaPolicy } from "../security/media-policy.js";
import type { ProjectStore } from "../store/project-store.js";
import type { TransactionEngine } from "../domain/transaction-engine.js";
import type { JobManager } from "../jobs/job-manager.js";

const extensionKinds = new Map<
  string,
  Exclude<Asset["kind"], "generated" | "image_sequence">
>([
  [".mp4", "video"],
  [".mov", "video"],
  [".mkv", "video"],
  [".webm", "video"],
  [".mxf", "video"],
  [".avi", "video"],
  [".wav", "audio"],
  [".mp3", "audio"],
  [".flac", "audio"],
  [".m4a", "audio"],
  [".aac", "audio"],
  [".ogg", "audio"],
  [".png", "image"],
  [".jpg", "image"],
  [".jpeg", "image"],
  [".webp", "image"],
  [".tif", "image"],
  [".tiff", "image"],
  [".exr", "image"],
  [".srt", "subtitle"],
  [".vtt", "subtitle"],
  [".ass", "subtitle"],
  [".ssa", "subtitle"],
  [".ttf", "font"],
  [".otf", "font"],
  [".woff", "font"],
  [".woff2", "font"],
]);

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function localPath(uri: string): string {
  if (uri.startsWith("file:")) return fileURLToPath(uri);
  if (!isAbsolute(uri)) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Asset import requires an absolute path or file URI",
      422,
    );
  }
  return uri;
}

export class AssetService {
  private readonly derivativeLocks = new Map<string, Promise<void>>();

  public constructor(
    private readonly projects: ProjectStore,
    private readonly transactions: TransactionEngine,
    private readonly mediaPolicy: MediaPolicy,
    private readonly events: EventBus,
    private readonly worker: EngineWorkerClient,
    private readonly jobs: JobManager,
  ) {}

  private async withDerivativeLock<T>(
    key: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.derivativeLocks.get(key) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const queued = previous.then(() => gate);
    this.derivativeLocks.set(key, queued);
    await previous;
    try {
      return await action();
    } finally {
      release?.();
      if (this.derivativeLocks.get(key) === queued) {
        this.derivativeLocks.delete(key);
      }
    }
  }

  public async createProxy(request: AssetProxyRequest): Promise<JobRecord> {
    const parsed = assetProxyRequestSchema.parse(request);
    const project = await this.projects.load(parsed.projectId);
    const prior = this.jobs.findIdempotentJob(
      parsed.projectId,
      "proxy",
      parsed.idempotencyKey,
    );
    if (prior !== undefined) {
      const comparable = {
        projectId: prior.projectId,
        assetId: prior.input.assetId,
        baseRevision: prior.projectRevision,
        idempotencyKey: prior.input.idempotencyKey,
        maxWidth: prior.input.maxWidth,
        maxHeight: prior.input.maxHeight,
      };
      if (JSON.stringify(comparable) !== JSON.stringify(parsed)) {
        throw new FrameOSError(
          "REVISION_CONFLICT",
          "Proxy idempotency key was already used with a different request",
          409,
        );
      }
      return prior;
    }
    if (project.revision !== parsed.baseRevision) {
      throw new FrameOSError(
        "REVISION_CONFLICT",
        `Expected revision ${parsed.baseRevision.toString()}, current revision is ${project.revision.toString()}`,
        409,
      );
    }
    const asset = project.assets[parsed.assetId];
    if (asset === undefined) {
      throw new FrameOSError(
        "NOT_FOUND",
        `Asset ${parsed.assetId} was not found`,
        404,
      );
    }
    if (asset.kind !== "video") {
      throw new FrameOSError(
        "UNSUPPORTED_FORMAT",
        "This proxy wave supports video assets only",
        422,
      );
    }
    const capabilities = await this.worker.discoverCapabilities();
    const proxyCapability = capabilities.find(
      (capability) => capability.id === "asset.proxy.create",
    );
    if (proxyCapability?.available !== true) {
      throw new FrameOSError(
        "CAPABILITY_UNAVAILABLE",
        proxyCapability?.reasonUnavailable ??
          "The audited native proxy transcoder is unavailable",
        424,
      );
    }
    if (!asset.uri.startsWith("frameos:")) {
      await this.mediaPolicy.validateUris([asset.uri]);
    }
    const sourcePath = asset.uri.startsWith("frameos:")
      ? this.projects.resolveProjectUri(project.projectId, asset.uri)
      : localPath(asset.uri);
    const proxyCacheKey = createHash("sha256")
      .update(
        JSON.stringify({
          assetHash: asset.hash,
          maxWidth: parsed.maxWidth,
          maxHeight: parsed.maxHeight,
          provider: proxyCapability.provider,
          providerVersion: proxyCapability.providerVersion ?? "unknown",
          profile: {
            container: "mp4",
            videoCodec: "mpeg4",
            audioCodec: "aac",
          },
        }),
      )
      .digest("hex");
    const identity = proxyCacheKey.slice(0, 16);
    const proxy = this.projects.managedProxyLocation(
      project.projectId,
      asset.id,
      identity,
    );
    const cachedProxyInfo = asset.proxies.includes(proxy.uri)
      ? await stat(proxy.path).catch(() => undefined)
      : undefined;
    if (cachedProxyInfo?.isFile() === true && cachedProxyInfo.size > 0) {
      return this.jobs.startManagedJob({
        projectId: project.projectId,
        projectRevision: project.revision,
        kind: "proxy",
        idempotencyKey: parsed.idempotencyKey,
        request: {
          assetId: asset.id,
          assetHash: asset.hash,
          baseRevision: parsed.baseRevision,
          idempotencyKey: parsed.idempotencyKey,
          maxWidth: parsed.maxWidth,
          maxHeight: parsed.maxHeight,
          proxyCacheKey,
        },
        runner: async (_signal, reportProgress) => {
          reportProgress(0.9);
          return {
            assetId: asset.id,
            sourceAssetHash: asset.hash,
            proxyUri: proxy.uri,
            proxyHash: await sha256File(proxy.path),
            sizeBytes: cachedProxyInfo.size,
            proxyCacheKey,
            cached: true,
          };
        },
      });
    }
    return this.jobs.startManagedJob({
      projectId: project.projectId,
      projectRevision: project.revision,
      kind: "proxy",
      idempotencyKey: parsed.idempotencyKey,
      request: {
        assetId: asset.id,
        assetHash: asset.hash,
        baseRevision: parsed.baseRevision,
        idempotencyKey: parsed.idempotencyKey,
        maxWidth: parsed.maxWidth,
        maxHeight: parsed.maxHeight,
        proxyCacheKey,
      },
      runner: async (signal, reportProgress) =>
        this.withDerivativeLock(proxy.path, async () => {
          const latestProject = await this.projects.load(project.projectId);
          const latestProxyInfo = latestProject.assets[
            asset.id
          ]?.proxies.includes(proxy.uri)
            ? await stat(proxy.path).catch(() => undefined)
            : undefined;
          if (latestProxyInfo?.isFile() === true && latestProxyInfo.size > 0) {
            reportProgress(0.9);
            return {
              assetId: asset.id,
              sourceAssetHash: asset.hash,
              proxyUri: proxy.uri,
              proxyHash: await sha256File(proxy.path),
              sizeBytes: latestProxyInfo.size,
              proxyCacheKey,
              cached: true,
            };
          }
          await rm(proxy.path, { force: true });
          try {
            reportProgress(0.1);
            const workerResult = await this.worker.createProxy(
              sourcePath,
              proxy.path,
              { maxWidth: parsed.maxWidth, maxHeight: parsed.maxHeight },
              signal,
              capabilities,
            );
            const proxyInfo = await stat(proxy.path);
            if (!proxyInfo.isFile() || proxyInfo.size === 0) {
              throw new FrameOSError(
                "PLUGIN_FAILURE",
                "Native proxy worker produced no usable file",
                500,
              );
            }
            if (signal.aborted) {
              throw new FrameOSError(
                "JOB_CANCELLED",
                "Proxy generation was cancelled",
                409,
              );
            }
            reportProgress(0.85);
            const proxyHash = await sha256File(proxy.path);
            const transaction = await this.transactions.execute({
              projectId: project.projectId,
              baseRevision: parsed.baseRevision,
              idempotencyKey: `asset-proxy-${this.projects.idempotencyDigest(parsed.idempotencyKey)}`,
              mode: "commit",
              operations: [
                {
                  operationId: createId(),
                  type: "asset.proxy.create",
                  targetId: asset.id,
                  preconditions: [],
                  provenance: {
                    actorType: "system",
                    actorId: "asset.proxy.create",
                  },
                  arguments: { uri: proxy.uri },
                },
              ],
            });
            this.events.publish(
              "asset.proxy.created",
              {
                assetId: asset.id,
                proxyUri: proxy.uri,
                transactionId: transaction.transactionId,
              },
              project.projectId,
            );
            return {
              assetId: asset.id,
              sourceAssetHash: asset.hash,
              proxyUri: proxy.uri,
              proxyHash,
              sizeBytes: proxyInfo.size,
              proxyCacheKey,
              cached: false,
              workerResult,
              transaction,
            };
          } catch (error) {
            await rm(proxy.path, { force: true });
            throw error;
          }
        }),
    });
  }

  public async createThumbnail(
    request: AssetThumbnailRequest,
  ): Promise<JobRecord> {
    const parsed = assetThumbnailRequestSchema.parse(request);
    const project = await this.projects.loadRevision(
      parsed.projectId,
      parsed.revision,
    );
    const prior = this.jobs.findIdempotentJob(
      parsed.projectId,
      "thumbnail",
      parsed.idempotencyKey,
    );
    if (prior !== undefined) {
      const comparable = {
        projectId: prior.projectId,
        assetId: prior.input.assetId,
        revision: prior.projectRevision,
        idempotencyKey: prior.input.idempotencyKey,
        at: prior.input.at,
        maxWidth: prior.input.maxWidth,
        maxHeight: prior.input.maxHeight,
      };
      if (JSON.stringify(comparable) !== JSON.stringify(parsed)) {
        throw new FrameOSError(
          "REVISION_CONFLICT",
          "Thumbnail idempotency key was already used with a different request",
          409,
        );
      }
      return prior;
    }
    const asset = project.assets[parsed.assetId];
    if (asset === undefined) {
      throw new FrameOSError(
        "NOT_FOUND",
        `Asset ${parsed.assetId} was not found in revision ${parsed.revision.toString()}`,
        404,
      );
    }
    if (asset.kind !== "video" && asset.kind !== "image") {
      throw new FrameOSError(
        "UNSUPPORTED_FORMAT",
        "Thumbnail generation supports video and image assets",
        422,
      );
    }
    const millisecondRate = { numerator: 1_000, denominator: 1 };
    const timeMs = rescaleTime(parsed.at, millisecondRate).time.value;
    if (timeMs < 0) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Thumbnail source time cannot be negative",
        422,
      );
    }
    if (
      asset.duration !== undefined &&
      timeMs >= rescaleTime(asset.duration, millisecondRate).time.value
    ) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Thumbnail source time is outside the asset duration",
        422,
      );
    }
    const capabilities = await this.worker.discoverCapabilities();
    const thumbnailCapability = capabilities.find(
      (capability) => capability.id === "asset.thumbnail.create",
    );
    if (thumbnailCapability?.available !== true) {
      throw new FrameOSError(
        "CAPABILITY_UNAVAILABLE",
        thumbnailCapability?.reasonUnavailable ??
          "The audited native thumbnail renderer is unavailable",
        424,
      );
    }
    if (!asset.uri.startsWith("frameos:")) {
      await this.mediaPolicy.validateUris([asset.uri]);
    }
    const sourcePath = asset.uri.startsWith("frameos:")
      ? this.projects.resolveProjectUri(project.projectId, asset.uri)
      : localPath(asset.uri);
    return this.jobs.startManagedJob({
      projectId: project.projectId,
      projectRevision: project.revision,
      kind: "thumbnail",
      idempotencyKey: parsed.idempotencyKey,
      request: {
        assetId: asset.id,
        assetHash: asset.hash,
        revision: parsed.revision,
        idempotencyKey: parsed.idempotencyKey,
        at: parsed.at,
        timeMs,
        maxWidth: parsed.maxWidth,
        maxHeight: parsed.maxHeight,
      },
      runner: async (signal, reportProgress, context) => {
        const outputName = `thumbnail-${asset.id}-${timeMs.toString()}.png`;
        const outputPath = resolve(context.jobDirectory, outputName);
        reportProgress(0.1);
        const workerResult = await this.worker.createThumbnail(
          sourcePath,
          outputPath,
          {
            timeMs,
            maxWidth: parsed.maxWidth,
            maxHeight: parsed.maxHeight,
          },
          signal,
          capabilities,
        );
        const outputInfo = await stat(outputPath);
        if (!outputInfo.isFile() || outputInfo.size === 0) {
          throw new FrameOSError(
            "PLUGIN_FAILURE",
            "Native thumbnail worker produced no usable file",
            500,
          );
        }
        reportProgress(0.85);
        const outputHash = await sha256File(outputPath);
        const provenanceName = "provenance.json";
        const provenance = {
          schemaVersion: "1.0.0",
          jobId: context.jobId,
          kind: "thumbnail",
          projectId: project.projectId,
          projectRevision: project.revision,
          assetId: asset.id,
          assetHash: asset.hash,
          at: parsed.at,
          timeMs,
          outputHash,
          workerResult,
          capability: thumbnailCapability,
          completedAt: new Date().toISOString(),
        };
        await writeFile(
          resolve(context.jobDirectory, provenanceName),
          `${JSON.stringify(provenance, null, 2)}\n`,
          { encoding: "utf8", flag: "wx" },
        );
        return {
          assetId: asset.id,
          assetHash: asset.hash,
          at: parsed.at,
          outputHash,
          workerResult,
          artifacts: [
            {
              name: outputName,
              uri: `/api/v1/jobs/${context.jobId}/artifacts/${encodeURIComponent(outputName)}`,
              mimeType: "image/png",
            },
            {
              name: provenanceName,
              uri: `/api/v1/jobs/${context.jobId}/artifacts/${provenanceName}`,
              mimeType: "application/json",
            },
          ],
        };
      },
    });
  }

  public async import(request: AssetImportRequest): Promise<AssetImportResult> {
    const parsed = assetImportRequestSchema.parse(request);
    const prior = (await this.projects.history(parsed.projectId)).find(
      (record) => record.idempotencyKey === parsed.idempotencyKey,
    );
    if (prior !== undefined) {
      const operation = prior.request.operations.find(
        (candidate) => candidate.type === "asset.add",
      );
      const assetId =
        operation?.type === "asset.add"
          ? operation.arguments.asset.id
          : undefined;
      const project = await this.projects.load(parsed.projectId);
      const asset = assetId === undefined ? undefined : project.assets[assetId];
      if (asset === undefined) {
        throw new FrameOSError(
          "REVISION_CONFLICT",
          "The idempotent asset-import result no longer exists in the project",
          409,
        );
      }
      return assetImportResultSchema.parse({
        asset,
        transaction: prior.result,
        warnings: [],
        cached: true,
      });
    }

    const project = await this.projects.load(parsed.projectId);
    if (project.revision !== parsed.baseRevision) {
      throw new FrameOSError(
        "REVISION_CONFLICT",
        `Expected revision ${parsed.baseRevision.toString()}, current revision is ${project.revision.toString()}`,
        409,
      );
    }
    await this.mediaPolicy.validateUris([parsed.uri]);
    if (parsed.uri.startsWith("frameos:")) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "New imports must reference an approved local source file",
        422,
      );
    }
    const path = localPath(parsed.uri);
    const info = await stat(path);
    if (!info.isFile()) {
      throw new FrameOSError(
        "UNSUPPORTED_FORMAT",
        "This import wave accepts regular files; image-sequence directories are capability-gated",
        422,
      );
    }
    const extension = extname(path).toLowerCase();
    const kind = parsed.kind ?? extensionKinds.get(extension);
    if (kind === undefined || kind === "image_sequence") {
      throw new FrameOSError(
        "UNSUPPORTED_FORMAT",
        `Cannot infer a supported asset kind from ${extension || "this file"}`,
        422,
      );
    }
    const id = createId();
    const hash = await sha256File(path);
    let probe: MediaProbeResult | undefined;
    const warnings: Array<{ code: string; message: string }> = [];
    if (kind === "video" || kind === "audio" || kind === "image") {
      try {
        probe = await this.worker.probe(path);
        if (probe.streams.length === 0) {
          throw new FrameOSError(
            "UNSUPPORTED_FORMAT",
            "Native probing found no decodable media streams",
            422,
          );
        }
      } catch (error) {
        if (
          error instanceof FrameOSError &&
          error.code === "CAPABILITY_UNAVAILABLE"
        ) {
          warnings.push({
            code: "PROBE_UNAVAILABLE",
            message:
              "The audited native media probe is not installed; stream and duration fields remain empty",
          });
        } else {
          throw error;
        }
      }
    }
    let canonicalUri = pathToFileURL(path).href;
    let managedUri: string | undefined;
    if (parsed.managed) {
      managedUri = await this.projects.importManagedAsset(
        project.projectId,
        id,
        path,
      );
      canonicalUri = managedUri;
    }
    const asset: Asset = {
      id,
      name: parsed.name ?? basename(path),
      kind,
      uri: canonicalUri,
      hash,
      managed: parsed.managed,
      streams:
        probe !== undefined
          ? probe.streams
          : kind === "subtitle"
            ? [
                {
                  index: 0,
                  kind: "subtitle",
                  codec: extension.slice(1) || "text",
                  metadata: {},
                },
              ]
            : [],
      ...(probe?.duration === undefined ? {} : { duration: probe.duration }),
      proxies: [],
      analysisRefs: [],
      licenseMetadata: parsed.licenseMetadata,
      semanticMetadata: {
        sourceSizeBytes: info.size,
        sourceModifiedAt: info.mtime.toISOString(),
        probeState:
          probe !== undefined
            ? "complete"
            : warnings.length === 0
              ? "not-required"
              : "unavailable",
        ...(probe === undefined ? {} : { probeMetadata: probe.metadata }),
      },
    };
    try {
      const transaction = await this.transactions.execute({
        projectId: project.projectId,
        baseRevision: parsed.baseRevision,
        idempotencyKey: parsed.idempotencyKey,
        mode: "commit",
        operations: [
          {
            operationId: createId(),
            type: "asset.add",
            preconditions: [],
            provenance: {
              actorType: "system",
              actorId: "asset.import",
            },
            arguments: { asset },
          },
        ],
      });
      const result = assetImportResultSchema.parse({
        asset,
        transaction,
        warnings,
        cached: false,
      });
      this.events.publish(
        "asset.imported",
        { assetId: asset.id, managed: asset.managed, warnings },
        project.projectId,
      );
      return result;
    } catch (error) {
      if (managedUri !== undefined) {
        await this.projects.deleteManagedAsset(project.projectId, managedUri);
      }
      throw error;
    }
  }
}
