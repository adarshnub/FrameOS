import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonConfig } from "../config.js";
import { createProject } from "../domain/project-factory.js";
import { createServices, type FrameOSServices } from "../services/services.js";

async function waitForJob(services: FrameOSServices, jobId: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const job = services.jobs.getJob(jobId);
    if (["completed", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(`Job ${jobId} did not finish`);
}

describe("managed asset ingestion", () => {
  let root: string;
  let services: FrameOSServices;

  beforeEach(async () => {
    root = await mkdtemp(resolve(tmpdir(), "frameos-asset-test-"));
    const config: DaemonConfig = {
      host: "127.0.0.1",
      port: 31_415,
      dataDirectory: resolve(root, "data"),
      authToken: "asset-test-token-longer-than-thirty-two-characters",
      authTokenPath: resolve(root, "data", "auth-token"),
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

  it("hashes, copies, registers, retries idempotently, and analyzes a managed subtitle", async () => {
    const contents = [
      "1",
      "00:00:00,500 --> 00:00:02,000",
      "The managed project bundle remains portable.",
      "",
    ].join("\n");
    const source = resolve(root, "portable.srt");
    await writeFile(source, contents);
    const project = createProject({ name: "Managed assets" });
    await services.projects.create(project);
    const request = {
      projectId: project.projectId,
      baseRevision: 0,
      idempotencyKey: "managed-subtitle-import",
      uri: pathToFileURL(source).href,
      kind: "subtitle" as const,
      managed: true,
      licenseMetadata: { license: "CC-BY-4.0" },
    };

    const imported = await services.assets.import(request);
    expect(imported.cached).toBe(false);
    expect(imported.warnings).toEqual([]);
    expect(imported.asset.hash).toBe(
      createHash("sha256").update(contents).digest("hex"),
    );
    expect(imported.asset.uri).toMatch(/^frameos:\/\/projects\//u);
    const managedPath = services.projects.resolveProjectUri(
      project.projectId,
      imported.asset.uri,
    );
    expect(await readFile(managedPath, "utf8")).toBe(contents);

    const retried = await services.assets.import(request);
    expect(retried.cached).toBe(true);
    expect(retried.asset.id).toBe(imported.asset.id);
    expect((await services.projects.load(project.projectId)).revision).toBe(1);

    const job = await services.analysis.start({
      projectId: project.projectId,
      assetId: imported.asset.id,
      analyzers: ["frameos.subtitle-text"],
      parameters: {},
      force: false,
    });
    expect((await waitForJob(services, job.id)).status).toBe("completed");
    const matches = await services.analysis.search({
      projectId: project.projectId,
      query: "portable",
      mode: "lexical",
      limit: 10,
    });
    expect(matches[0]?.assetId).toBe(imported.asset.id);
  });

  it("reports missing probing without fabricating stream metadata", async () => {
    const source = resolve(root, "camera.mp4");
    await writeFile(source, "not-real-media");
    const project = createProject({ name: "Probe gate" });
    await services.projects.create(project);
    const imported = await services.assets.import({
      projectId: project.projectId,
      baseRevision: 0,
      idempotencyKey: "video-probe-gate-import",
      uri: source,
      kind: "video",
      managed: false,
      licenseMetadata: {},
    });
    expect(imported.asset.streams).toEqual([]);
    expect(imported.warnings).toEqual([
      expect.objectContaining({ code: "PROBE_UNAVAILABLE" }),
    ]);
  });

  it("generates, hashes, and atomically registers an idempotent managed proxy", async () => {
    const source = resolve(root, "camera.mp4");
    await writeFile(source, "source-video-fixture");
    const project = createProject({ name: "Proxy fixture" });
    await services.projects.create(project);
    const imported = await services.assets.import({
      projectId: project.projectId,
      baseRevision: 0,
      idempotencyKey: "proxy-source-import",
      uri: source,
      kind: "video",
      managed: false,
      licenseMetadata: {},
    });
    vi.spyOn(services.worker, "discoverCapabilities").mockResolvedValue([
      {
        id: "asset.proxy.create",
        kind: "consumer",
        name: "Proxy",
        description: "test",
        available: true,
        baseline: true,
        provider: "test",
        alternatives: [],
        metadata: {},
      },
      {
        id: "asset.thumbnail.create",
        kind: "consumer",
        name: "Thumbnail",
        description: "test",
        available: true,
        baseline: true,
        provider: "test",
        alternatives: [],
        metadata: {},
      },
    ]);
    const nativeProxy = vi
      .spyOn(services.worker, "createProxy")
      .mockImplementation(async (_input, output, options) => {
        expect(options).toEqual({ maxWidth: 960, maxHeight: 540 });
        await writeFile(output, "generated-proxy-fixture");
        return {
          status: "completed",
          width: 960,
          height: 540,
          container: "mp4",
          videoCodec: "mpeg4",
          audioCodec: "aac",
        };
      });
    const request = {
      projectId: project.projectId,
      assetId: imported.asset.id,
      baseRevision: 1,
      idempotencyKey: "managed-proxy-create",
      maxWidth: 960,
      maxHeight: 540,
    };
    const queued = await services.assets.createProxy(request);
    const concurrentQueued = await services.assets.createProxy({
      ...request,
      idempotencyKey: "managed-proxy-concurrent",
    });
    const completed = await waitForJob(services, queued.id);
    const concurrentCompleted = await waitForJob(services, concurrentQueued.id);
    expect(completed.status).toBe("completed");
    expect(concurrentCompleted.status).toBe("completed");
    expect(
      [completed.output?.cached, concurrentCompleted.output?.cached].sort(),
    ).toEqual([false, true]);
    expect(nativeProxy).toHaveBeenCalledTimes(1);
    expect(completed.output).toMatchObject({
      assetId: imported.asset.id,
      sourceAssetHash: imported.asset.hash,
      proxyHash: createHash("sha256")
        .update("generated-proxy-fixture")
        .digest("hex"),
    });
    const updated = await services.projects.load(project.projectId);
    expect(updated.revision).toBe(2);
    const proxyUri = updated.assets[imported.asset.id]?.proxies[0];
    expect(proxyUri).toMatch(/-proxy-[a-f0-9]{16}\.mp4$/u);
    expect(
      await readFile(
        services.projects.resolveProjectUri(project.projectId, proxyUri!),
        "utf8",
      ),
    ).toBe("generated-proxy-fixture");

    const retried = await services.assets.createProxy(request);
    expect(retried.id).toBe(queued.id);
    expect(nativeProxy).toHaveBeenCalledTimes(1);

    const cacheHit = await services.assets.createProxy({
      ...request,
      baseRevision: 2,
      idempotencyKey: "managed-proxy-cache-hit",
    });
    const cacheHitCompleted = await waitForJob(services, cacheHit.id);
    expect(cacheHitCompleted).toMatchObject({
      status: "completed",
      output: { cached: true, proxyUri },
    });
    expect(nativeProxy).toHaveBeenCalledTimes(1);
    expect((await services.projects.load(project.projectId)).revision).toBe(2);

    const nativeThumbnail = vi
      .spyOn(services.worker, "createThumbnail")
      .mockImplementation(async (_input, output, options) => {
        expect(options).toEqual({
          timeMs: 1_500,
          maxWidth: 640,
          maxHeight: 360,
        });
        await writeFile(output, "generated-thumbnail-fixture");
        return {
          status: "completed",
          width: 640,
          height: 360,
          timeMs: 1_500,
          frame: 45,
          format: "png",
        };
      });
    const thumbnailRequest = {
      projectId: project.projectId,
      assetId: imported.asset.id,
      revision: 2,
      idempotencyKey: "source-thumbnail-create",
      at: { value: 1_500, rate: { numerator: 1_000, denominator: 1 } },
      maxWidth: 640,
      maxHeight: 360,
    };
    const thumbnailJob =
      await services.assets.createThumbnail(thumbnailRequest);
    const thumbnailCompleted = await waitForJob(services, thumbnailJob.id);
    expect(thumbnailCompleted.status).toBe("completed");
    expect(thumbnailCompleted.output).toMatchObject({
      assetId: imported.asset.id,
      outputHash: createHash("sha256")
        .update("generated-thumbnail-fixture")
        .digest("hex"),
      artifacts: expect.arrayContaining([
        expect.objectContaining({ mimeType: "image/png" }),
      ]),
    });
    const thumbnailName = (
      thumbnailCompleted.output?.artifacts as Array<{ name: string }>
    )[0]!.name;
    const thumbnailArtifact = await services.jobs.resolveArtifact(
      thumbnailJob.id,
      thumbnailName,
    );
    expect(await readFile(thumbnailArtifact.path, "utf8")).toBe(
      "generated-thumbnail-fixture",
    );
    const retriedThumbnail =
      await services.assets.createThumbnail(thumbnailRequest);
    expect(retriedThumbnail.id).toBe(thumbnailJob.id);
    expect(nativeThumbnail).toHaveBeenCalledTimes(1);
  });
});
