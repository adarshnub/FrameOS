import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createId } from "@frameos/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DaemonConfig } from "../config.js";
import { createServices, type FrameOSServices } from "../services/services.js";
import { buildHttpServer } from "./server.js";

describe("HTTP control plane", () => {
  let root: string;
  let app: FastifyInstance;
  let services: FrameOSServices;
  const token = "test-token-that-is-longer-than-thirty-two-characters";

  beforeEach(async () => {
    root = await mkdtemp(resolve(tmpdir(), "frameos-http-test-"));
    const config: DaemonConfig = {
      host: "127.0.0.1",
      port: 31_415,
      dataDirectory: resolve(root, "data"),
      authToken: token,
      authTokenPath: resolve(root, "data", "auth-token"),
      allowedMediaRoots: [root],
      remoteMode: false,
    };
    services = await createServices(config);
    app = await buildHttpServer(services);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  const authorization = { authorization: `Bearer ${token}` };

  it("requires bearer authentication for every API resource", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/projects",
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
    expect(response.body).not.toContain(token);
  });

  it("creates, commits, reads revisions, and rejects stale writes", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: authorization,
      payload: {
        name: "HTTP vertical slice",
        frameRate: { numerator: 30_000, denominator: 1_001 },
      },
    });
    expect(created.statusCode).toBe(201);
    const project = created.json().data as {
      projectId: string;
      revision: number;
    };
    const transaction = {
      projectId: project.projectId,
      baseRevision: 0,
      idempotencyKey: "http-transaction-idempotency",
      mode: "commit",
      operations: [
        {
          operationId: createId(),
          type: "project.metadata.set",
          preconditions: [],
          arguments: { values: { workflow: "agent" } },
        },
      ],
    };
    const committed = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: authorization,
      payload: transaction,
    });
    expect(committed.statusCode).toBe(200);
    expect(committed.json().data.resultingRevision).toBe(1);

    const revision = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.projectId}/revisions/1`,
      headers: authorization,
    });
    expect(revision.statusCode).toBe(200);
    expect(revision.headers.etag).toBe('"1"');
    expect(revision.json().data.metadata).toEqual({ workflow: "agent" });

    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: authorization,
      payload: {
        ...transaction,
        idempotencyKey: "different-stale-request",
        operations: [{ ...transaction.operations[0], operationId: createId() }],
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("REVISION_CONFLICT");
  });

  it("registers and searches a local asset through the REST transaction boundary", async () => {
    const mediaPath = resolve(root, "interview.mp4");
    await writeFile(mediaPath, "fixture");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: authorization,
      payload: { name: "Asset API" },
    });
    const projectId = String(created.json().data.projectId);
    const assetId = createId();
    const imported = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/assets`,
      headers: authorization,
      payload: {
        baseRevision: 0,
        idempotencyKey: "http-asset-import-fixture",
        asset: {
          id: assetId,
          name: "Interview master",
          kind: "video",
          uri: pathToFileURL(mediaPath).href,
          hash: "abcdef0123456789abcdef0123456789",
          managed: false,
          streams: [],
          proxies: [],
          analysisRefs: [],
          licenseMetadata: {},
          semanticMetadata: { speaker: "Ada" },
        },
      },
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json().data.resultingRevision).toBe(1);

    const searched = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/assets?search=ada`,
      headers: authorization,
    });
    expect(searched.statusCode).toBe(200);
    expect(searched.json().data).toHaveLength(1);
    expect(searched.json().data[0].id).toBe(assetId);
  });

  it("imports and exports captions through revision-safe REST contracts", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: authorization,
      payload: { name: "Caption API" },
    });
    const project = created.json().data as {
      projectId: string;
      settings: { defaultSequenceId: string };
    };
    const imported = await app.inject({
      method: "POST",
      url: "/api/v1/imports/captions",
      headers: authorization,
      payload: {
        projectId: project.projectId,
        sequenceId: project.settings.defaultSequenceId,
        baseRevision: 0,
        idempotencyKey: "rest-caption-import-fixture",
        mode: "commit",
        format: "vtt",
        content: "WEBVTT\n\n00:00.000 --> 00:01.250\nCaption via REST\n",
        name: "English",
        language: "en",
      },
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json().data.cueCount).toBe(1);

    const exported = await app.inject({
      method: "POST",
      url: "/api/v1/exports/captions",
      headers: authorization,
      payload: {
        projectId: project.projectId,
        sequenceId: project.settings.defaultSequenceId,
        captionTrackId: imported.json().data.captionTrackId,
        format: "srt",
        revision: 1,
      },
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.json().data.content).toContain(
      "00:00:00,000 --> 00:00:01,250",
    );
    expect(exported.json().data.revision).toBe(1);
  });

  it("runs and searches reproducible asset analysis through REST", async () => {
    const mediaPath = resolve(root, "analysis-source.mp4");
    await writeFile(mediaPath, "fixture");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: authorization,
      payload: { name: "Analysis API" },
    });
    const projectId = String(created.json().data.projectId);
    const assetId = createId();
    await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/assets`,
      headers: authorization,
      payload: {
        baseRevision: 0,
        idempotencyKey: "analysis-api-asset-import",
        asset: {
          id: assetId,
          name: "Agent editing interview",
          kind: "video",
          uri: pathToFileURL(mediaPath).href,
          hash: "fedcba9876543210fedcba9876543210",
          streams: [{ index: 0, kind: "video", codec: "h264", metadata: {} }],
        },
      },
    });
    const started = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/assets/${assetId}/analysis`,
      headers: authorization,
      payload: {
        projectId,
        assetId,
        analyzers: ["frameos.asset-metadata"],
      },
    });
    expect(started.statusCode).toBe(202);
    const jobId = String(started.json().data.id);
    let job: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/jobs/${jobId}`,
        headers: authorization,
      });
      job = response.json().data as Record<string, unknown>;
      if (["completed", "failed", "cancelled"].includes(String(job.status)))
        break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    expect(job.status).toBe("completed");

    const searched = await app.inject({
      method: "POST",
      url: "/api/v1/assets/search",
      headers: authorization,
      payload: {
        projectId,
        query: "agent editing",
        mode: "lexical",
        limit: 10,
      },
    });
    expect(searched.statusCode).toBe(200);
    expect(searched.json().data[0]).toMatchObject({
      assetId,
      type: "asset_summary",
    });
    expect(searched.json().meta.searchBackend).toContain("flat-cosine");
  });

  it("exposes non-mutating semantic edit planning through REST", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: authorization,
      payload: { name: "Semantic API" },
    });
    const project = created.json().data as {
      projectId: string;
      settings: { defaultSequenceId: string };
      sequences: Record<
        string,
        { tracks: Array<{ id: string; kind: string }> }
      >;
    };
    const trackId = project.sequences[
      project.settings.defaultSequenceId
    ]!.tracks.find((track) => track.kind === "video")!.id;
    const planned = await app.inject({
      method: "POST",
      url: "/api/v1/semantic/remove-silences/plan",
      headers: authorization,
      payload: {
        projectId: project.projectId,
        baseRevision: 0,
        trackIds: [trackId],
      },
    });
    expect(planned.statusCode).toBe(200);
    expect(planned.json().data).toMatchObject({
      projectId: project.projectId,
      baseRevision: 0,
      semanticOperation: "semantic.remove_silences",
      operations: [],
    });
    expect((await services.projects.load(project.projectId)).revision).toBe(0);
  });

  it("persists agent policy while keeping unconfigured providers capability-gated", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: authorization,
      payload: { name: "Agent policy" },
    });
    const projectId = String(created.json().data.projectId);
    const sessionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/agents/sessions",
      headers: authorization,
      payload: {
        projectId,
        provider: "local",
        model: "unconfigured-test-model",
        approvalMode: "propose",
        budgets: { maxPreviewCycles: 1, maxOperationsPerTransaction: 10 },
      },
    });
    expect(sessionResponse.statusCode).toBe(201);
    const session = sessionResponse.json().data as {
      id: string;
      approvalMode: string;
    };
    expect(session.approvalMode).toBe("propose");

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/v1/agents/runs",
      headers: authorization,
      payload: {
        sessionId: session.id,
        request: "Trim the opening by one frame",
      },
    });
    expect(runResponse.statusCode).toBe(422);
    expect(runResponse.json().error.code).toBe("CAPABILITY_UNAVAILABLE");
  });

  it("exports and reimports OTIO with an explicit interchange report", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: authorization,
      payload: { name: "OTIO source" },
    });
    const projectId = String(created.json().data.projectId);
    const exported = await app.inject({
      method: "POST",
      url: "/api/v1/exports/otio",
      headers: authorization,
      payload: { projectId },
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.json().data.document.OTIO_SCHEMA).toBe("Timeline.1");
    expect(exported.json().data.report.direction).toBe("export");

    const imported = await app.inject({
      method: "POST",
      url: "/api/v1/imports/otio",
      headers: authorization,
      payload: {
        document: exported.json().data.document,
        projectName: "OTIO copy",
      },
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.headers.location).toMatch(/^\/api\/v1\/projects\//u);
    expect(imported.json().data.project.projectId).not.toBe(projectId);
    expect(imported.json().data.project.settings.name).toBe("OTIO copy");
    expect(imported.json().data.report.direction).toBe("import");
  });

  it("turns a missing native engine into a structured failed job without stopping the daemon", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: authorization,
      payload: { name: "Worker isolation" },
    });
    const projectId = String(created.json().data.projectId);
    const queued = await app.inject({
      method: "POST",
      url: "/api/v1/renders",
      headers: authorization,
      payload: { projectId, outputName: "output.mp4" },
    });
    expect(queued.statusCode).toBe(202);
    const jobId = String(queued.json().data.id);
    let job: { status: string; error?: { code: string } } = queued.json().data;
    for (
      let attempt = 0;
      attempt < 50 &&
      !["failed", "cancelled", "completed"].includes(job.status);
      attempt += 1
    ) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/jobs/${jobId}`,
        headers: authorization,
      });
      job = response.json().data;
    }
    expect(job.status).toBe("failed");
    expect(job.error?.code).toBe("CAPABILITY_UNAVAILABLE");
    expect(
      (await app.inject({ method: "GET", url: "/health" })).statusCode,
    ).toBe(200);
  });

  it("serves completed preview artifacts only through authenticated job URLs", async () => {
    vi.spyOn(services.worker, "render").mockImplementation(
      async (_xmlPath, outputPath) => {
        await writeFile(outputPath, "http-preview-fixture", "utf8");
        return '{"status":"completed"}';
      },
    );
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: authorization,
      payload: { name: "Artifact delivery" },
    });
    const projectId = String(created.json().data.projectId);
    const queued = await app.inject({
      method: "POST",
      url: "/api/v1/previews",
      headers: authorization,
      payload: {
        projectId,
        source: { type: "revision", revision: 0 },
        kind: "frame",
        at: { value: 0, rate: { numerator: 30, denominator: 1 } },
      },
    });
    expect(queued.statusCode).toBe(202);
    const jobId = String(queued.json().data.id);
    let job = queued.json().data as {
      status: string;
      output?: { preview?: { entries?: Array<{ name: string }> } };
    };
    for (
      let attempt = 0;
      attempt < 100 && job.status !== "completed";
      attempt += 1
    ) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
      job = (
        await app.inject({
          method: "GET",
          url: `/api/v1/jobs/${jobId}`,
          headers: authorization,
        })
      ).json().data;
    }
    expect(job.status).toBe("completed");
    const artifactName = job.output?.preview?.entries?.[0]?.name;
    expect(artifactName).toBeDefined();
    const url = `/api/v1/jobs/${jobId}/artifacts/${encodeURIComponent(artifactName!)}`;
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    const artifact = await app.inject({
      method: "GET",
      url,
      headers: authorization,
    });
    expect(artifact.statusCode).toBe(200);
    expect(artifact.headers["content-type"]).toContain("image/png");
    expect(artifact.body).toBe("http-preview-fixture");
  });
});
