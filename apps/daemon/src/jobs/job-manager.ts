import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FrameOSError,
  isEntityId,
  previewArtifactSchema,
  previewRequestSchema,
  rescaleTime,
  type Project,
  type PreviewArtifact,
  type ContactSheetPreviewRequest,
  type PreviewRequest,
  type RationalTime,
  type RenderProfile,
  type WaveformPreviewRequest,
} from "@frameos/contracts";
import { compileMltXml } from "../engine/mlt-compiler.js";
import type { EngineWorkerClient } from "../engine/worker-client.js";
import type { EventBus } from "../events/event-bus.js";
import type { ProjectStore } from "../store/project-store.js";
import type { JobRecord, RuntimeDatabase } from "../store/runtime-database.js";

export interface RenderRequest {
  projectId: string;
  sequenceId?: string;
  revision?: number;
  outputName: string;
  renderProfileId?: string;
}

export type ManagedJobRunner = (
  signal: AbortSignal,
  reportProgress: (progress: number) => void,
  context: { jobId: string; jobDirectory: string },
) => Promise<Record<string, unknown>>;

function safeOutputName(value: string): string {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/u.test(value) ||
    value.includes("..")
  ) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Output name contains unsafe characters",
      422,
    );
  }
  return value;
}

function snapshotHash(project: Project): string {
  return createHash("sha256").update(JSON.stringify(project)).digest("hex");
}

function artifactMimeType(name: string): string {
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".mp4")) return "video/mp4";
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function artifactUri(jobId: string, name: string): string {
  return `/api/v1/jobs/${jobId}/artifacts/${encodeURIComponent(name)}`;
}

function visitSequenceGraph(
  project: Project,
  sequenceId: string,
  visitor: (sequence: Project["sequences"][string]) => void,
): void {
  const visited = new Set<string>();
  const visit = (currentId: string): void => {
    if (visited.has(currentId)) return;
    visited.add(currentId);
    const sequence = project.sequences[currentId];
    if (sequence === undefined) return;
    visitor(sequence);
    for (const track of sequence.tracks) {
      for (const item of track.items) {
        if (item.type === "nested_sequence" && item.enabled) {
          visit(item.sequenceId);
        }
      }
    }
  };
  visit(sequenceId);
}

function resizeSequenceGraphForOutput(
  project: Project,
  sequenceId: string,
  width: number,
  height: number,
): void {
  visitSequenceGraph(project, sequenceId, (sequence) => {
    const widthScale = width / sequence.format.width;
    const heightScale = height / sequence.format.height;
    for (const track of sequence.tracks) {
      for (const item of track.items) {
        if ("transform" in item) {
          item.transform.positionX *= widthScale;
          item.transform.positionY *= heightScale;
        }
      }
    }
    sequence.format.width = width;
    sequence.format.height = height;
  });
}

interface RenderExecutionOptions {
  profile?: RenderProfile;
  sourceProjectHash?: string;
  frameRange?: { start: number; end: number };
  preview?: Omit<PreviewArtifact, "entries" | "provenanceUri">;
  previewAt?: RationalTime;
  mediaSelection?: "original" | "prefer_proxy";
}

function sampledFrames(
  start: number,
  end: number,
  requestedCount: number,
): number[] {
  const span = end - start + 1;
  const count = Math.min(requestedCount, span);
  if (count <= 1) return [start];
  const result: number[] = [];
  const distance = BigInt(span - 1);
  const denominator = BigInt(count - 1);
  for (let index = 0; index < count; index += 1) {
    const offset = (BigInt(index) * distance) / denominator;
    result.push(start + Number(offset));
  }
  return result;
}

export class JobManager {
  private readonly controllers = new Map<string, AbortController>();
  private readonly activeTasks = new Set<Promise<void>>();

  public constructor(
    private readonly database: RuntimeDatabase,
    private readonly projectStore: ProjectStore,
    private readonly worker: EngineWorkerClient,
    private readonly events: EventBus,
    private readonly dataDirectory: string,
  ) {}

  private track(task: Promise<void>): void {
    this.activeTasks.add(task);
    void task.finally(() => this.activeTasks.delete(task));
  }

  public async startRender(request: RenderRequest): Promise<JobRecord> {
    if (!isEntityId(request.projectId)) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Project id must be a UUID",
        422,
      );
    }
    const outputName = safeOutputName(request.outputName);
    const snapshot =
      request.revision === undefined
        ? await this.projectStore.load(request.projectId)
        : await this.projectStore.loadRevision(
            request.projectId,
            request.revision,
          );
    const project = structuredClone(snapshot);
    const profile =
      request.renderProfileId === undefined
        ? undefined
        : project.renderProfiles[request.renderProfileId];
    if (request.renderProfileId !== undefined && profile === undefined) {
      throw new FrameOSError(
        "NOT_FOUND",
        `Render profile ${request.renderProfileId} was not found`,
        404,
      );
    }
    if (
      profile !== undefined &&
      (Object.keys(profile.color).length > 0 ||
        Object.keys(profile.video).length > 0 ||
        Object.keys(profile.audio).length > 0)
    ) {
      throw new FrameOSError(
        "CAPABILITY_UNAVAILABLE",
        "Advanced render-profile codec/color options are not mapped by the current worker",
        424,
      );
    }
    const selectedSequenceId =
      request.sequenceId ?? project.settings.defaultSequenceId;
    const sequence = project.sequences[selectedSequenceId];
    if (sequence === undefined) {
      throw new FrameOSError(
        "NOT_FOUND",
        `Sequence ${selectedSequenceId} was not found`,
        404,
      );
    }
    if (profile !== undefined) {
      resizeSequenceGraphForOutput(
        project,
        selectedSequenceId,
        profile.width,
        profile.height,
      );
      visitSequenceGraph(project, selectedSequenceId, (renderSequence) => {
        renderSequence.format.frameRate = profile.frameRate;
        renderSequence.format.sampleRate = profile.sampleRate;
        renderSequence.format.channels = profile.channels;
      });
    }
    const job = this.database.createJob(
      project.projectId,
      project.revision,
      "render",
      {
        outputName,
        sequenceId: selectedSequenceId,
        ...(request.renderProfileId === undefined
          ? {}
          : { renderProfileId: request.renderProfileId }),
      },
    );
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    this.track(
      this.runRender(job, project, outputName, selectedSequenceId, controller, {
        ...(profile === undefined ? {} : { profile }),
        sourceProjectHash: snapshotHash(snapshot),
      }),
    );
    return job;
  }

  public async startPreview(request: PreviewRequest): Promise<JobRecord> {
    const parsed = previewRequestSchema.parse(request);
    const sourceProject =
      parsed.source.type === "draft"
        ? (
            await this.projectStore.loadDraft(
              parsed.projectId,
              parsed.source.draftId,
            )
          ).project
        : await this.projectStore.loadRevision(
            parsed.projectId,
            parsed.source.revision,
          );
    if (parsed.kind === "waveform") {
      return this.startWaveformPreview(parsed, sourceProject);
    }
    const project = structuredClone(sourceProject);
    const selectedSequenceId =
      parsed.sequenceId ?? project.settings.defaultSequenceId;
    const sequence = project.sequences[selectedSequenceId];
    if (sequence === undefined)
      throw new FrameOSError(
        "NOT_FOUND",
        `Sequence ${selectedSequenceId} was not found`,
        404,
      );
    const scale = Math.min(
      1,
      parsed.maxWidth / sequence.format.width,
      parsed.maxHeight / sequence.format.height,
    );
    const previewWidth = Math.max(
      2,
      Math.floor((sequence.format.width * scale) / 2) * 2,
    );
    const previewHeight = Math.max(
      2,
      Math.floor((sequence.format.height * scale) / 2) * 2,
    );
    resizeSequenceGraphForOutput(
      project,
      selectedSequenceId,
      previewWidth,
      previewHeight,
    );
    const start =
      parsed.kind === "frame"
        ? rescaleTime(parsed.at, sequence.format.frameRate).time.value
        : parsed.range === undefined
          ? 0
          : rescaleTime(parsed.range.start, sequence.format.frameRate).time
              .value;
    const duration =
      parsed.kind === "frame"
        ? 1
        : parsed.range === undefined
          ? Math.max(
              1,
              ...sequence.tracks.flatMap((track) =>
                track.items.map((item) => {
                  const itemStart = rescaleTime(
                    item.timelineRange.start,
                    sequence.format.frameRate,
                  ).time.value;
                  const itemDuration = rescaleTime(
                    item.timelineRange.duration,
                    sequence.format.frameRate,
                  ).time.value;
                  return itemStart + itemDuration;
                }),
              ),
            )
          : Math.max(
              1,
              rescaleTime(parsed.range.duration, sequence.format.frameRate).time
                .value,
            );
    const end = start + duration - 1;
    const outputName = safeOutputName(
      parsed.kind === "frame"
        ? `preview-frame-${createHash("sha256")
            .update(JSON.stringify(parsed.at))
            .digest("hex")
            .slice(0, 16)}.png`
        : parsed.kind === "region"
          ? `preview-region-${start.toString()}-${end.toString()}.mp4`
          : `preview-contact-sheet-${start.toString()}-${end.toString()}.json`,
    );
    const job = this.database.createJob(
      project.projectId,
      project.revision,
      "preview",
      {
        kind: parsed.kind,
        source: parsed.source,
        sequenceId: selectedSequenceId,
        quality: "draft",
        frameRange: { start, end },
        dimensions: {
          width: sequence.format.width,
          height: sequence.format.height,
        },
        ...(parsed.kind === "contact_sheet"
          ? { frameCount: parsed.frameCount, columns: parsed.columns }
          : {}),
      },
    );
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    if (parsed.kind === "contact_sheet") {
      this.track(
        this.runContactSheet(
          job,
          project,
          selectedSequenceId,
          controller,
          parsed,
          { start, end },
          snapshotHash(sourceProject),
        ),
      );
    } else {
      this.track(
        this.runRender(
          job,
          project,
          outputName,
          selectedSequenceId,
          controller,
          {
            sourceProjectHash: snapshotHash(sourceProject),
            frameRange: { start, end },
            mediaSelection: "prefer_proxy",
            preview: {
              kind: parsed.kind,
              width: sequence.format.width,
              height: sequence.format.height,
              ...(parsed.kind === "region" && parsed.range !== undefined
                ? { range: parsed.range }
                : {}),
            },
            ...(parsed.kind === "frame" ? { previewAt: parsed.at } : {}),
          },
        ),
      );
    }
    return job;
  }

  private async startWaveformPreview(
    request: WaveformPreviewRequest,
    project: Project,
  ): Promise<JobRecord> {
    const asset = project.assets[request.assetId];
    if (asset === undefined) {
      throw new FrameOSError(
        "NOT_FOUND",
        `Asset ${request.assetId} was not found`,
        404,
      );
    }
    if (!asset.streams.some((stream) => stream.kind === "audio")) {
      throw new FrameOSError(
        "UNSUPPORTED_FORMAT",
        `Asset ${asset.id} has no registered audio stream`,
        422,
      );
    }
    const capabilities = await this.worker.discoverCapabilities();
    const waveformCapability = capabilities.find(
      (capability) => capability.id === "preview.waveform",
    );
    if (waveformCapability?.available !== true) {
      throw new FrameOSError(
        "CAPABILITY_UNAVAILABLE",
        waveformCapability?.reasonUnavailable ??
          "Native waveform generation is unavailable",
        424,
      );
    }
    const mediaPath = asset.uri.startsWith("frameos:")
      ? this.projectStore.resolveProjectUri(project.projectId, asset.uri)
      : asset.uri.startsWith("file:")
        ? fileURLToPath(asset.uri)
        : asset.uri;
    if (!isAbsolute(mediaPath)) {
      throw new FrameOSError(
        "UNSUPPORTED_FORMAT",
        "Waveform generation requires a local media path",
        422,
      );
    }
    const startMs =
      request.range === undefined
        ? 0
        : rescaleTime(request.range.start, {
            numerator: 1_000,
            denominator: 1,
          }).time.value;
    const endMs =
      request.range === undefined
        ? undefined
        : startMs +
          rescaleTime(request.range.duration, {
            numerator: 1_000,
            denominator: 1,
          }).time.value;
    const job = this.database.createJob(
      project.projectId,
      project.revision,
      "preview",
      {
        kind: "waveform",
        source: request.source,
        assetId: asset.id,
        assetHash: asset.hash,
        dimensions: { width: request.maxWidth, height: request.maxHeight },
        startMs,
        ...(endMs === undefined ? {} : { endMs }),
        ...(request.channel === undefined ? {} : { channel: request.channel }),
      },
    );
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    this.track(
      this.runWaveformPreview(
        job,
        project,
        mediaPath,
        request,
        controller,
        capabilities,
        snapshotHash(project),
        startMs,
        endMs,
      ),
    );
    return job;
  }

  private async runWaveformPreview(
    job: JobRecord,
    project: Project,
    mediaPath: string,
    request: WaveformPreviewRequest,
    controller: AbortController,
    capabilities: Awaited<
      ReturnType<EngineWorkerClient["discoverCapabilities"]>
    >,
    sourceProjectHash: string,
    startMs: number,
    endMs: number | undefined,
  ): Promise<void> {
    try {
      this.database.updateJob(job.id, {
        status: "running",
        progress: 0.05,
        error: null,
      });
      this.events.publish(
        "preview.started",
        { jobId: job.id, revision: project.revision, kind: "waveform" },
        project.projectId,
      );
      const jobDirectory = resolve(this.dataDirectory, "jobs", job.id);
      await mkdir(jobDirectory, { recursive: true });
      const outputName = safeOutputName(`waveform-${request.assetId}.svg`);
      const outputPath = resolve(jobDirectory, outputName);
      const result = await this.worker.waveform(
        mediaPath,
        outputPath,
        {
          width: request.maxWidth,
          height: request.maxHeight,
          startMs,
          ...(endMs === undefined ? {} : { endMs }),
          ...(request.channel === undefined
            ? {}
            : { channel: request.channel }),
        },
        controller.signal,
        capabilities,
      );
      this.database.updateJob(job.id, { progress: 0.9 });
      const provenanceName = "provenance.json";
      const provenancePath = resolve(jobDirectory, provenanceName);
      const provenance = {
        schemaVersion: "1.0.0",
        jobId: job.id,
        kind: "preview",
        previewKind: "waveform",
        projectId: project.projectId,
        projectRevision: project.revision,
        sourceProjectHash,
        assetId: request.assetId,
        assetHash: project.assets[request.assetId]!.hash,
        range: request.range,
        channel: request.channel,
        workerResult: result,
        capability: capabilities.find(
          (capability) => capability.id === "preview.waveform",
        ),
        completedAt: new Date().toISOString(),
      };
      await writeFile(
        provenancePath,
        `${JSON.stringify(provenance, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
      const waveformArtifact = {
        name: outputName,
        uri: artifactUri(job.id, outputName),
        mimeType: "image/svg+xml",
      };
      const provenanceArtifact = {
        name: provenanceName,
        uri: artifactUri(job.id, provenanceName),
        mimeType: "application/json",
      };
      const preview = previewArtifactSchema.parse({
        kind: "waveform",
        width: request.maxWidth,
        height: request.maxHeight,
        ...(request.range === undefined ? {} : { range: request.range }),
        entries: [
          {
            ...waveformArtifact,
            metadata: {
              sampleRate: result.sampleRate,
              channels: result.channels,
              channel: result.channel,
              sampleFrames: result.sampleFrames,
            },
          },
        ],
        provenanceUri: provenanceArtifact.uri,
      });
      const completed = this.database.updateJob(job.id, {
        status: "completed",
        progress: 1,
        output: {
          artifacts: [waveformArtifact, provenanceArtifact],
          preview,
          projectRevision: project.revision,
          sourceProjectHash,
        },
        error: null,
      });
      this.events.publish("preview.completed", completed, project.projectId);
    } catch (error) {
      const frameError =
        error instanceof FrameOSError
          ? error
          : new FrameOSError(
              "INTERNAL_ERROR",
              "Waveform preview failed unexpectedly",
              500,
            );
      const status =
        frameError.code === "JOB_CANCELLED" ? "cancelled" : "failed";
      const failed = this.database.updateJob(job.id, {
        status,
        error: { code: frameError.code, message: frameError.message },
      });
      this.events.publish("preview.failed", failed, project.projectId);
    } finally {
      this.controllers.delete(job.id);
    }
  }

  private async runContactSheet(
    job: JobRecord,
    project: Project,
    sequenceId: string,
    controller: AbortController,
    request: ContactSheetPreviewRequest,
    frameRange: { start: number; end: number },
    sourceProjectHash: string,
  ): Promise<void> {
    try {
      this.database.updateJob(job.id, {
        status: "running",
        progress: 0.05,
        error: null,
      });
      this.events.publish(
        "preview.started",
        { jobId: job.id, revision: project.revision },
        project.projectId,
      );
      const sequence = project.sequences[sequenceId];
      if (sequence === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Sequence ${sequenceId} was not found`,
          404,
        );
      }
      const jobDirectory = resolve(this.dataDirectory, "jobs", job.id);
      await mkdir(jobDirectory, { recursive: true });
      const xmlPath = resolve(jobDirectory, "project.mlt");
      const engineCapabilities = await this.worker.discoverCapabilities();
      const compiledGraph = compileMltXml(project, sequenceId, {
        mediaSelection: "prefer_proxy",
        resolveFrameosUri: (uri) =>
          this.projectStore.resolveProjectUri(project.projectId, uri),
        availableCapabilities: new Set(
          engineCapabilities
            .filter((capability) => capability.available)
            .map((capability) => capability.id),
        ),
      });
      await writeFile(xmlPath, compiledGraph, {
        encoding: "utf8",
        flag: "wx",
      });
      const frames = sampledFrames(
        frameRange.start,
        frameRange.end,
        request.frameCount,
      );
      const frameArtifacts: Array<{
        name: string;
        uri: string;
        mimeType: string;
        at: RationalTime;
        metadata: Record<string, unknown>;
      }> = [];
      for (let index = 0; index < frames.length; index += 1) {
        if (controller.signal.aborted) {
          throw new FrameOSError("JOB_CANCELLED", "Job was cancelled", 409);
        }
        const frame = frames[index]!;
        const outputName = safeOutputName(
          `preview-contact-${String(index + 1).padStart(3, "0")}-${frame}.png`,
        );
        const outputPath = resolve(jobDirectory, outputName);
        await this.worker.render(
          xmlPath,
          outputPath,
          undefined,
          controller.signal,
          { start: frame, end: frame },
          engineCapabilities,
        );
        frameArtifacts.push({
          name: outputName,
          uri: artifactUri(job.id, outputName),
          mimeType: "image/png",
          at: { value: frame, rate: sequence.format.frameRate },
          metadata: {
            index,
            row: Math.floor(index / request.columns),
            column: index % request.columns,
            columns: request.columns,
            frame,
          },
        });
        this.database.updateJob(job.id, {
          progress: 0.15 + (0.75 * (index + 1)) / frames.length,
        });
      }

      const manifestName = "contact-sheet.json";
      const manifestPath = resolve(jobDirectory, manifestName);
      const provenanceName = "provenance.json";
      const provenancePath = resolve(jobDirectory, provenanceName);
      const contactSheet = {
        schemaVersion: "1.0.0",
        kind: "contact_sheet",
        projectId: project.projectId,
        projectRevision: project.revision,
        sequenceId,
        requestedFrameCount: request.frameCount,
        actualFrameCount: frames.length,
        columns: request.columns,
        range: request.range,
        entries: frameArtifacts,
      };
      await writeFile(
        manifestPath,
        `${JSON.stringify(contactSheet, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
      const provenance = {
        schemaVersion: "1.0.0",
        jobId: job.id,
        kind: "preview",
        previewKind: "contact_sheet",
        projectId: project.projectId,
        projectRevision: project.revision,
        sourceProjectHash,
        compiledGraphHash: createHash("sha256")
          .update(compiledGraph)
          .digest("hex"),
        mediaSelection: "prefer_proxy",
        sequenceId,
        frameRange,
        sampledFrames: frames,
        engineCapabilities,
        completedAt: new Date().toISOString(),
      };
      await writeFile(
        provenancePath,
        `${JSON.stringify(provenance, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
      const manifestArtifact = {
        name: manifestName,
        uri: artifactUri(job.id, manifestName),
        mimeType: "application/json",
      };
      const provenanceArtifact = {
        name: provenanceName,
        uri: artifactUri(job.id, provenanceName),
        mimeType: "application/json",
      };
      const preview = previewArtifactSchema.parse({
        kind: "contact_sheet",
        width: sequence.format.width,
        height: sequence.format.height,
        range: request.range,
        entries: frameArtifacts,
        provenanceUri: provenanceArtifact.uri,
      });
      const completed = this.database.updateJob(job.id, {
        status: "completed",
        progress: 1,
        output: {
          artifacts: [
            ...frameArtifacts.map(
              ({ at: _at, metadata: _metadata, ...entry }) => entry,
            ),
            manifestArtifact,
            provenanceArtifact,
          ],
          preview,
          projectRevision: project.revision,
          sourceProjectHash,
        },
        error: null,
      });
      this.events.publish("preview.completed", completed, project.projectId);
    } catch (error) {
      const frameError =
        error instanceof FrameOSError
          ? error
          : new FrameOSError(
              "INTERNAL_ERROR",
              "Contact-sheet preview failed unexpectedly",
              500,
            );
      const status =
        frameError.code === "JOB_CANCELLED" ? "cancelled" : "failed";
      const failed = this.database.updateJob(job.id, {
        status,
        error: { code: frameError.code, message: frameError.message },
      });
      this.events.publish("preview.failed", failed, project.projectId);
    } finally {
      this.controllers.delete(job.id);
    }
  }

  public startManagedJob(input: {
    projectId: string;
    projectRevision: number;
    kind: "analysis" | "proxy" | "thumbnail";
    request: Record<string, unknown>;
    idempotencyKey?: string;
    runner: ManagedJobRunner;
  }): JobRecord {
    if (!isEntityId(input.projectId)) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Project id must be a UUID",
        422,
      );
    }
    if (input.idempotencyKey !== undefined) {
      const prior = this.database.findIdempotentJob(
        input.projectId,
        input.kind,
        input.idempotencyKey,
      );
      if (prior !== undefined) return prior;
    }
    const job = this.database.createJob(
      input.projectId,
      input.projectRevision,
      input.kind,
      input.request,
      input.idempotencyKey,
    );
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    this.track(this.runManagedJob(job, controller, input.runner));
    return job;
  }

  private async runManagedJob(
    job: JobRecord,
    controller: AbortController,
    runner: ManagedJobRunner,
  ): Promise<void> {
    try {
      this.database.updateJob(job.id, {
        status: "running",
        progress: 0.01,
        error: null,
      });
      this.events.publish(
        `${job.kind}.started`,
        { jobId: job.id, revision: job.projectRevision },
        job.projectId,
      );
      const jobDirectory = resolve(this.dataDirectory, "jobs", job.id);
      await mkdir(jobDirectory, { recursive: true });
      const output = await runner(
        controller.signal,
        (progress) => {
          if (!Number.isFinite(progress)) return;
          this.database.updateJob(job.id, {
            progress: Math.max(0.01, Math.min(0.99, progress)),
          });
        },
        { jobId: job.id, jobDirectory },
      );
      if (controller.signal.aborted) {
        throw new FrameOSError("JOB_CANCELLED", "Job was cancelled", 409);
      }
      const completed = this.database.updateJob(job.id, {
        status: "completed",
        progress: 1,
        output,
        error: null,
      });
      this.events.publish(`${job.kind}.completed`, completed, job.projectId);
    } catch (error) {
      const frameError =
        error instanceof FrameOSError
          ? error
          : new FrameOSError(
              "INTERNAL_ERROR",
              `${job.kind} job failed unexpectedly`,
              500,
            );
      const status =
        frameError.code === "JOB_CANCELLED" ? "cancelled" : "failed";
      const failed = this.database.updateJob(job.id, {
        status,
        error: { code: frameError.code, message: frameError.message },
      });
      this.events.publish(`${job.kind}.failed`, failed, job.projectId);
    } finally {
      this.controllers.delete(job.id);
    }
  }

  private async runRender(
    job: JobRecord,
    project: Project,
    outputName: string,
    sequenceId: string | undefined,
    controller: AbortController,
    options: RenderExecutionOptions = {},
  ): Promise<void> {
    try {
      this.database.updateJob(job.id, {
        status: "running",
        progress: 0.05,
        error: null,
      });
      this.events.publish(
        `${job.kind}.started`,
        { jobId: job.id, revision: project.revision },
        project.projectId,
      );
      const jobDirectory = resolve(this.dataDirectory, "jobs", job.id);
      await mkdir(jobDirectory, { recursive: true });
      const xmlPath = resolve(jobDirectory, "project.mlt");
      const outputPath = resolve(jobDirectory, outputName);
      const engineCapabilities = await this.worker.discoverCapabilities();
      const compiledGraph = compileMltXml(project, sequenceId, {
        mediaSelection: options.mediaSelection ?? "original",
        resolveFrameosUri: (uri) =>
          this.projectStore.resolveProjectUri(project.projectId, uri),
        availableCapabilities: new Set(
          engineCapabilities
            .filter((capability) => capability.available)
            .map((capability) => capability.id),
        ),
      });
      await writeFile(xmlPath, compiledGraph, {
        encoding: "utf8",
        flag: "wx",
      });
      this.database.updateJob(job.id, { progress: 0.15 });
      await this.worker.render(
        xmlPath,
        outputPath,
        options.profile,
        controller.signal,
        options.frameRange,
        engineCapabilities,
      );
      const manifestPath = resolve(jobDirectory, "provenance.json");
      const manifest = {
        schemaVersion: "1.0.0",
        jobId: job.id,
        kind: job.kind,
        projectId: project.projectId,
        projectRevision: project.revision,
        sourceProjectHash: options.sourceProjectHash,
        compiledGraphHash: createHash("sha256")
          .update(compiledGraph)
          .digest("hex"),
        sequenceId,
        renderProfile: options.profile,
        mediaSelection: options.mediaSelection ?? "original",
        outputName,
        engineCapabilities,
        completedAt: new Date().toISOString(),
      };
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      const outputArtifact = {
        name: outputName,
        uri: artifactUri(job.id, outputName),
        mimeType: artifactMimeType(outputName),
      };
      const provenanceArtifact = {
        name: "provenance.json",
        uri: artifactUri(job.id, "provenance.json"),
        mimeType: "application/json",
      };
      const preview =
        options.preview === undefined
          ? undefined
          : previewArtifactSchema.parse({
              ...options.preview,
              entries: [
                {
                  ...outputArtifact,
                  metadata: {},
                  ...(options.previewAt === undefined
                    ? {}
                    : { at: options.previewAt }),
                },
              ],
              provenanceUri: provenanceArtifact.uri,
            });
      const completed = this.database.updateJob(job.id, {
        status: "completed",
        progress: 1,
        output: {
          artifacts: [outputArtifact, provenanceArtifact],
          ...(preview === undefined ? {} : { preview }),
          projectRevision: project.revision,
          sourceProjectHash: options.sourceProjectHash,
        },
        error: null,
      });
      this.events.publish(
        `${job.kind}.completed`,
        completed,
        project.projectId,
      );
    } catch (error) {
      const frameError =
        error instanceof FrameOSError
          ? error
          : new FrameOSError(
              "INTERNAL_ERROR",
              "Render failed unexpectedly",
              500,
            );
      const status =
        frameError.code === "JOB_CANCELLED" ? "cancelled" : "failed";
      const failed = this.database.updateJob(job.id, {
        status,
        error: { code: frameError.code, message: frameError.message },
      });
      this.events.publish(`${job.kind}.failed`, failed, project.projectId);
    } finally {
      this.controllers.delete(job.id);
    }
  }

  public getJob(id: string): JobRecord {
    return this.database.getJob(id);
  }

  public async resolveArtifact(
    jobId: string,
    name: string,
  ): Promise<{ path: string; mimeType: string }> {
    const safeName = safeOutputName(name);
    const job = this.database.getJob(jobId);
    if (job.status !== "completed") {
      throw new FrameOSError(
        "REVISION_CONFLICT",
        `Job ${jobId} has no completed artifacts`,
        409,
      );
    }
    const artifacts = Array.isArray(job.output?.artifacts)
      ? job.output.artifacts
      : [];
    const artifact = artifacts.find(
      (candidate): candidate is { name: string; mimeType: string } =>
        typeof candidate === "object" &&
        candidate !== null &&
        "name" in candidate &&
        candidate.name === safeName &&
        "mimeType" in candidate &&
        typeof candidate.mimeType === "string",
    );
    if (artifact === undefined) {
      throw new FrameOSError(
        "NOT_FOUND",
        `Artifact ${safeName} was not found for job ${jobId}`,
        404,
      );
    }
    const jobsRoot = resolve(this.dataDirectory, "jobs", job.id);
    const path = resolve(jobsRoot, safeName);
    if (!path.startsWith(`${jobsRoot}${sep}`)) {
      throw new FrameOSError("FORBIDDEN", "Artifact path escaped its job", 403);
    }
    const info = await stat(path).catch(() => undefined);
    if (info === undefined || !info.isFile()) {
      throw new FrameOSError(
        "NOT_FOUND",
        `Artifact ${safeName} is no longer available`,
        404,
      );
    }
    return { path, mimeType: artifact.mimeType };
  }

  public listJobs(projectId?: string): JobRecord[] {
    return this.database.listJobs(projectId);
  }

  public findIdempotentJob(
    projectId: string,
    kind: "analysis" | "proxy" | "thumbnail",
    idempotencyKey: string,
  ): JobRecord | undefined {
    return this.database.findIdempotentJob(projectId, kind, idempotencyKey);
  }

  public cancel(id: string): JobRecord {
    const job = this.database.getJob(id);
    if (["completed", "failed", "cancelled"].includes(job.status)) {
      return job;
    }
    this.controllers.get(id)?.abort();
    const cancelled = this.database.updateJob(id, {
      status: "cancelled",
      error: { code: "JOB_CANCELLED", message: "Job was cancelled" },
    });
    this.events.publish("job.cancelled", cancelled, job.projectId);
    return cancelled;
  }

  public async shutdown(): Promise<void> {
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled([...this.activeTasks]);
  }
}
