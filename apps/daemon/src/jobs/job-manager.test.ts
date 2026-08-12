import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  createId,
  frameTime,
  previewArtifactSchema,
  type Asset,
  type Clip,
} from "@frameos/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonConfig } from "../config.js";
import { createProject } from "../domain/project-factory.js";
import { createServices, type FrameOSServices } from "../services/services.js";

async function waitForJob(
  services: FrameOSServices,
  jobId: string,
): Promise<ReturnType<FrameOSServices["jobs"]["getJob"]>> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const job = services.jobs.getJob(jobId);
    if (["completed", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error("Timed out waiting for preview job");
}

describe("preview artifacts", () => {
  let root: string;
  let services: FrameOSServices;

  beforeEach(async () => {
    root = await mkdtemp(resolve(tmpdir(), "frameos-preview-test-"));
    const config: DaemonConfig = {
      host: "127.0.0.1",
      port: 31_415,
      dataDirectory: resolve(root, "data"),
      authToken: "test-token-that-is-longer-than-thirty-two-characters",
      authTokenPath: resolve(root, "auth-token"),
      allowedMediaRoots: [root],
      remoteMode: false,
    };
    services = await createServices(config);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await services.close();
    await rm(root, { recursive: true, force: true });
  });

  it("renders an exact frame and exposes only authenticated artifact references", async () => {
    const project = await services.projects.create(
      createProject({ name: "Frame preview" }),
    );
    vi.spyOn(services.worker, "render").mockImplementation(
      async (_xmlPath, outputPath, _profile, _signal, frameRange) => {
        expect(frameRange).toEqual({ start: 48, end: 48 });
        await writeFile(outputPath, "fixture-png", "utf8");
        return '{"status":"completed"}';
      },
    );
    const queued = await services.jobs.startPreview({
      projectId: project.projectId,
      source: { type: "revision", revision: 0 },
      kind: "frame",
      at: { value: 48, rate: { numerator: 30, denominator: 1 } },
      maxWidth: 640,
      maxHeight: 360,
    });
    const completed = await waitForJob(services, queued.id);
    expect(completed.status).toBe("completed");
    expect(JSON.stringify(completed.output)).not.toContain(root);
    const preview = previewArtifactSchema.parse(completed.output?.preview);
    expect(preview).toMatchObject({
      kind: "frame",
      width: 640,
      height: 360,
    });
    expect(preview.entries[0]?.uri).toMatch(
      new RegExp(`^/api/v1/jobs/${queued.id}/artifacts/`, "u"),
    );
    const artifact = await services.jobs.resolveArtifact(
      queued.id,
      preview.entries[0]!.name,
    );
    expect(artifact.mimeType).toBe("image/png");
    expect(await readFile(artifact.path, "utf8")).toBe("fixture-png");
  });

  it("renders evenly sampled contact-sheet frames through one immutable graph", async () => {
    const project = await services.projects.create(
      createProject({ name: "Contact sheet" }),
    );
    const renderedFrames: number[] = [];
    vi.spyOn(services.worker, "render").mockImplementation(
      async (_xmlPath, outputPath, _profile, _signal, frameRange) => {
        renderedFrames.push(frameRange!.start);
        expect(frameRange!.end).toBe(frameRange!.start);
        await writeFile(outputPath, `frame-${frameRange!.start}`, "utf8");
        return '{"status":"completed"}';
      },
    );
    const queued = await services.jobs.startPreview({
      projectId: project.projectId,
      source: { type: "revision", revision: 0 },
      kind: "contact_sheet",
      range: {
        start: { value: 0, rate: { numerator: 30, denominator: 1 } },
        duration: { value: 90, rate: { numerator: 30, denominator: 1 } },
      },
      frameCount: 12,
      columns: 4,
      maxWidth: 960,
      maxHeight: 540,
    });
    const completed = await waitForJob(services, queued.id);
    expect(completed.status).toBe("completed");
    expect(renderedFrames).toHaveLength(12);
    expect(renderedFrames[0]).toBe(0);
    expect(renderedFrames.at(-1)).toBe(89);
    const preview = previewArtifactSchema.parse(completed.output?.preview);
    expect(preview.kind).toBe("contact_sheet");
    expect(preview.entries).toHaveLength(12);
    expect(preview.entries[4]?.metadata).toMatchObject({
      row: 1,
      column: 0,
      columns: 4,
    });
    const manifest = await services.jobs.resolveArtifact(
      queued.id,
      "contact-sheet.json",
    );
    expect(
      JSON.parse(await readFile(manifest.path, "utf8")).actualFrameCount,
    ).toBe(12);
  });

  it("generates revision-pinned waveform SVG and provenance artifacts", async () => {
    const sourceProject = createProject({ name: "Waveform preview" });
    const sequence =
      sourceProject.sequences[sourceProject.settings.defaultSequenceId]!;
    const mediaPath = resolve(root, "voice.wav");
    await writeFile(mediaPath, "fixture-wave", "utf8");
    const asset: Asset = {
      id: createId(),
      name: "Voice.wav",
      kind: "audio",
      uri: mediaPath,
      hash: "5".repeat(64),
      managed: false,
      streams: [
        {
          index: 0,
          kind: "audio",
          codec: "pcm_s16le",
          sampleRate: 48_000,
          channels: 2,
          metadata: {},
        },
      ],
      duration: frameTime(300, sequence.format.frameRate),
      proxies: [],
      analysisRefs: [],
      licenseMetadata: {},
      semanticMetadata: {},
    };
    sourceProject.assets[asset.id] = asset;
    const project = await services.projects.create(sourceProject);
    const capability = {
      id: "preview.waveform",
      kind: "consumer" as const,
      name: "Waveform",
      description: "test",
      available: true,
      baseline: true,
      provider: "test",
      alternatives: [],
      metadata: {},
    };
    vi.spyOn(services.worker, "discoverCapabilities").mockResolvedValue([
      capability,
    ]);
    const waveform = vi
      .spyOn(services.worker, "waveform")
      .mockImplementation(async (_inputPath, outputPath, options) => {
        expect(options).toMatchObject({
          width: 800,
          height: 200,
          startMs: 1_000,
          endMs: 3_000,
          channel: 1,
        });
        await writeFile(outputPath, "<svg></svg>\n", "utf8");
        return {
          status: "completed",
          sampleRate: 48_000,
          channels: 2,
          channel: 1,
          sampleFrames: 96_000,
          startMs: 1_000,
          endMs: 3_000,
        };
      });
    const queued = await services.jobs.startPreview({
      projectId: project.projectId,
      source: { type: "revision", revision: 0 },
      kind: "waveform",
      assetId: asset.id,
      range: {
        start: frameTime(30, sequence.format.frameRate),
        duration: frameTime(60, sequence.format.frameRate),
      },
      channel: 1,
      maxWidth: 800,
      maxHeight: 200,
    });
    const completed = await waitForJob(services, queued.id);
    expect(completed.status).toBe("completed");
    expect(waveform).toHaveBeenCalledTimes(1);
    const preview = previewArtifactSchema.parse(completed.output?.preview);
    expect(preview).toMatchObject({
      kind: "waveform",
      width: 800,
      height: 200,
      entries: [
        expect.objectContaining({
          mimeType: "image/svg+xml",
          metadata: expect.objectContaining({ sampleRate: 48_000 }),
        }),
      ],
    });
    const artifact = await services.jobs.resolveArtifact(
      queued.id,
      preview.entries[0]!.name,
    );
    expect(artifact.mimeType).toBe("image/svg+xml");
    expect(await readFile(artifact.path, "utf8")).toContain("<svg>");
  });

  it("uses one capability snapshot and preserves transform geometry in scaled previews", async () => {
    const sourceProject = createProject({
      name: "Scaled preview",
      width: 1920,
      height: 1080,
    });
    const sequence =
      sourceProject.sequences[sourceProject.settings.defaultSequenceId]!;
    const track = sequence.tracks.find(
      (candidate) => candidate.kind === "video",
    )!;
    const asset: Asset = {
      id: createId(),
      name: "Preview.mp4",
      kind: "video",
      uri: resolve(root, "Preview.mp4"),
      hash: "44444444444444444444444444444444",
      managed: false,
      streams: [],
      duration: frameTime(120, sequence.format.frameRate),
      proxies: [resolve(root, "Preview-proxy.mp4")],
      analysisRefs: [],
      licenseMetadata: {},
      semanticMetadata: {},
    };
    const clip: Clip = {
      id: createId(),
      name: "Preview clip",
      type: "clip",
      assetId: asset.id,
      sourceRange: {
        start: frameTime(0, sequence.format.frameRate),
        duration: frameTime(30, sequence.format.frameRate),
      },
      timelineRange: {
        start: frameTime(0, sequence.format.frameRate),
        duration: frameTime(30, sequence.format.frameRate),
      },
      enabled: true,
      locked: false,
      metadata: {},
      transform: {
        positionX: 192,
        positionY: 0,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: 0.5,
        scaleY: 0.5,
        rotation: 0,
        opacity: 1,
        cropTop: 0,
        cropRight: 0,
        cropBottom: 0,
        cropLeft: 0,
        blendMode: "normal",
      },
      timeMap: [],
      effects: [],
      audio: { gainDb: 0, pan: 0, muted: false, channelMap: [] },
      links: [],
      semanticMetadata: {},
    };
    sourceProject.assets[asset.id] = asset;
    track.items.push(clip);
    const project = await services.projects.create(sourceProject);
    const discover = vi
      .spyOn(services.worker, "discoverCapabilities")
      .mockResolvedValue([
        {
          id: "engine.mlt",
          kind: "producer",
          name: "MLT",
          description: "test",
          available: true,
          baseline: true,
          provider: "test",
          alternatives: [],
          metadata: {},
        },
        {
          id: "mlt.filter.affine",
          kind: "filter",
          name: "Affine",
          description: "test",
          available: true,
          baseline: true,
          provider: "test",
          alternatives: [],
          metadata: {},
        },
      ]);
    vi.spyOn(services.worker, "render").mockImplementation(
      async (xmlPath, outputPath) => {
        const xml = await readFile(xmlPath, "utf8");
        expect(xml).toContain(
          '<property name="transition.rect">35%/25%:50%x50%:100%</property>',
        );
        expect(xml).toContain("Preview-proxy.mp4");
        expect(xml).not.toContain(
          '<property name="resource">' +
            resolve(root, "Preview.mp4") +
            "</property>",
        );
        await writeFile(outputPath, "scaled-preview", "utf8");
        return '{"status":"completed"}';
      },
    );
    const queued = await services.jobs.startPreview({
      projectId: project.projectId,
      source: { type: "revision", revision: 0 },
      kind: "frame",
      at: frameTime(0, sequence.format.frameRate),
      maxWidth: 640,
      maxHeight: 360,
    });
    const completed = await waitForJob(services, queued.id);
    expect(completed.status).toBe("completed");
    expect(discover).toHaveBeenCalledTimes(1);
  });
});
