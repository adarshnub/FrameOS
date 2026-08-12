import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createId, type Asset } from "@frameos/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

describe("analysis service", () => {
  let root: string;
  let services: FrameOSServices;

  beforeEach(async () => {
    root = await mkdtemp(resolve(tmpdir(), "frameos-analysis-test-"));
    const config: DaemonConfig = {
      host: "127.0.0.1",
      port: 31_415,
      dataDirectory: resolve(root, "data"),
      authToken: "analysis-test-token-longer-than-thirty-two-characters",
      authTokenPath: resolve(root, "data", "auth-token"),
      allowedMediaRoots: [root],
      remoteMode: false,
    };
    services = await createServices(config);
  });

  afterEach(async () => {
    await services.close();
    await rm(root, { recursive: true, force: true });
  });

  it("parses, attaches, caches, and searches timestamped subtitle analysis", async () => {
    const subtitlePath = resolve(root, "interview.srt");
    await writeFile(
      subtitlePath,
      [
        "1",
        "00:00:01,000 --> 00:00:03,500",
        "Build the agent-native editing layer.",
        "",
        "2",
        "00:00:04,000 --> 00:00:06,000",
        "Every edit remains deterministic.",
        "",
      ].join("\n"),
    );
    const project = createProject({ name: "Analysis fixture" });
    await services.projects.create(project);
    const asset: Asset = {
      id: createId(),
      name: "Interview transcript",
      kind: "subtitle",
      uri: pathToFileURL(subtitlePath).href,
      hash: "abcdef0123456789abcdef0123456789",
      managed: false,
      streams: [],
      proxies: [],
      analysisRefs: [],
      licenseMetadata: {},
      semanticMetadata: {},
    };
    await services.transactions.execute({
      projectId: project.projectId,
      baseRevision: 0,
      idempotencyKey: "analysis-asset-import",
      mode: "commit",
      operations: [
        {
          operationId: createId(),
          type: "asset.add",
          preconditions: [],
          arguments: { asset },
        },
      ],
    });

    const request = {
      projectId: project.projectId,
      assetId: asset.id,
      analyzers: ["frameos.subtitle-text"],
      parameters: {},
      force: false,
    };
    const firstJob = await services.analysis.start(request);
    const firstResult = await waitForJob(services, firstJob.id);
    expect(firstResult.status).toBe("completed");
    expect(firstResult.output?.artifacts).toHaveLength(1);

    const analyzedProject = await services.projects.load(project.projectId);
    expect(analyzedProject.revision).toBe(2);
    expect(analyzedProject.assets[asset.id]?.analysisRefs).toHaveLength(1);
    const artifactId = analyzedProject.assets[asset.id]!.analysisRefs[0]!;
    const sidecar = await services.projects.readAnalysisDocument(
      project.projectId,
      artifactId,
    );
    expect(sidecar.segments).toHaveLength(2);
    expect(sidecar.parametersHash).toMatch(/^[a-f0-9]{64}$/u);

    const matches = await services.analysis.search({
      projectId: project.projectId,
      query: "agent native",
      mode: "lexical",
      limit: 10,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      assetId: asset.id,
      artifactId,
      type: "transcript",
    });
    expect(matches[0]?.range?.start.value).toBe(1_000);

    const cachedJob = await services.analysis.start(request);
    const cachedResult = await waitForJob(services, cachedJob.id);
    expect(cachedResult.status).toBe("completed");
    expect(
      (cachedResult.output?.artifacts as Array<{ cached: boolean }>)[0]?.cached,
    ).toBe(true);
    expect((await services.projects.load(project.projectId)).revision).toBe(2);

    await services.transactions.undo(
      project.projectId,
      "undo-analysis-attachment",
    );
    const restored = await services.projects.load(project.projectId);
    expect(restored.assets[asset.id]?.analysisRefs).toEqual([]);
    expect(restored.analyses).toEqual({});
    expect(
      await services.analysis.search({
        projectId: project.projectId,
        query: "agent native",
        mode: "lexical",
        limit: 10,
      }),
    ).toEqual([]);
  });

  it("reports the exact missing capability for model-backed analyzers", async () => {
    const project = createProject({ name: "Unavailable analyzer" });
    await services.projects.create(project);
    const mediaPath = resolve(root, "speech.wav");
    await writeFile(mediaPath, "fixture");
    const asset: Asset = {
      id: createId(),
      name: "Speech",
      kind: "audio",
      uri: pathToFileURL(mediaPath).href,
      hash: "1234567890abcdef1234567890abcdef",
      managed: false,
      streams: [],
      proxies: [],
      analysisRefs: [],
      licenseMetadata: {},
      semanticMetadata: {},
    };
    await services.transactions.execute({
      projectId: project.projectId,
      baseRevision: 0,
      idempotencyKey: "unavailable-analysis-asset",
      mode: "commit",
      operations: [
        {
          operationId: createId(),
          type: "asset.add",
          preconditions: [],
          arguments: { asset },
        },
      ],
    });

    await expect(
      services.analysis.start({
        projectId: project.projectId,
        assetId: asset.id,
        analyzers: ["whisper.cpp.transcribe"],
        parameters: {},
        force: false,
      }),
    ).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
  });
});
