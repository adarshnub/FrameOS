import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createId, type Asset } from "@frameos/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonConfig } from "../config.js";
import { createProject } from "../domain/project-factory.js";
import { createServices, type FrameOSServices } from "../services/services.js";

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function waitForJob(services: FrameOSServices, jobId: string) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const job = services.jobs.getJob(jobId);
    if (["completed", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(`Job ${jobId} did not finish`);
}

describe("external analyzer isolation", () => {
  let root: string;
  let services: FrameOSServices | undefined;
  const fixtureWorker = fileURLToPath(
    new URL("../../test-fixtures/analyzer-worker.mjs", import.meta.url),
  );

  beforeEach(async () => {
    root = await mkdtemp(resolve(tmpdir(), "frameos-external-analysis-"));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await services?.close();
    await rm(root, { recursive: true, force: true });
  });

  async function manifest(options?: { corruptBinaryHash?: boolean }) {
    const modelPath = resolve(root, "fixture-model.bin");
    await writeFile(modelPath, "audited model fixture", "utf8");
    const manifestPath = resolve(root, "analyzer.json");
    const binaryHash = await sha256(process.execPath);
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          schemaVersion: "1.0.0",
          protocolVersion: "1.0.0",
          id: "whisper.cpp.transcribe",
          version: "1.2.3-test",
          capabilityId: "analysis.transcription.whisper",
          name: "Fixture transcription",
          description: "Isolated analyzer protocol fixture",
          outputTypes: ["transcript"],
          assetKinds: ["audio", "video"],
          deterministic: true,
          parameterSchema: {
            type: "object",
            properties: {
              text: { type: "string", maxLength: 10_000 },
              mode: { enum: ["oversize", "hang"] },
            },
            additionalProperties: false,
          },
          executable: {
            path: process.execPath,
            sha256: options?.corruptBinaryHash ? "0".repeat(64) : binaryHash,
            version: process.version,
            license: "MIT-test-fixture",
            arguments: [fixtureWorker],
          },
          model: {
            path: modelPath,
            sha256: await sha256(modelPath),
            version: "tiny-test",
            license: "test-only",
          },
          resources: [
            {
              path: fixtureWorker,
              sha256: await sha256(fixtureWorker),
              role: "protocol-adapter",
              version: "1.0.0-test",
              license: "MIT-test-fixture",
            },
          ],
          limits: {
            timeoutMs: 2_000,
            maxOutputBytes: 1_024,
            maxSegments: 100,
          },
          metadata: { fixture: true },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    return { manifestPath, binaryHash };
  }

  async function startServices(manifestPath: string) {
    const config: DaemonConfig = {
      host: "127.0.0.1",
      port: 31_415,
      dataDirectory: resolve(root, "data"),
      authToken: "external-analysis-token-longer-than-thirty-two-characters",
      authTokenPath: resolve(root, "data", "auth-token"),
      allowedMediaRoots: [root],
      analyzerManifestPaths: [manifestPath],
      remoteMode: false,
    };
    services = await createServices(config);
    return services;
  }

  async function addAudioAsset(activeServices: FrameOSServices) {
    const mediaPath = resolve(root, "speech.wav");
    await writeFile(mediaPath, "audio fixture", "utf8");
    const project = createProject({ name: "External analyzer" });
    await activeServices.projects.create(project);
    const asset: Asset = {
      id: createId(),
      name: "Speech",
      kind: "audio",
      uri: pathToFileURL(mediaPath).href,
      hash: await sha256(mediaPath),
      managed: false,
      streams: [],
      proxies: [],
      analysisRefs: [],
      licenseMetadata: {},
      semanticMetadata: {},
    };
    await activeServices.transactions.execute({
      projectId: project.projectId,
      baseRevision: 0,
      idempotencyKey: "external-analyzer-asset",
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
    return { project, asset };
  }

  it("executes a hash-verified model worker with a clean environment and persists provenance", async () => {
    const { manifestPath, binaryHash } = await manifest();
    const activeServices = await startServices(manifestPath);
    const descriptor = activeServices.analysis
      .listAnalyzers()
      .find((candidate) => candidate.id === "whisper.cpp.transcribe");
    expect(descriptor).toMatchObject({
      available: true,
      version: "1.2.3-test",
      binaryHash,
      binaryLicense: "MIT-test-fixture",
      modelLicense: "test-only",
      bundleHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    const capability = (
      await activeServices.capabilities.listCapabilities(
        "analysis.transcription.whisper",
      )
    )[0];
    expect(capability).toMatchObject({
      available: true,
      license: "MIT-test-fixture",
      metadata: { binaryHash },
    });

    const { project, asset } = await addAudioAsset(activeServices);
    vi.stubEnv("FRAMEOS_TEST_SECRET", "must-not-reach-worker");
    const queued = await activeServices.analysis.start({
      projectId: project.projectId,
      assetId: asset.id,
      analyzers: ["whisper.cpp.transcribe"],
      parameters: {
        "whisper.cpp.transcribe": {
          text: "Agent-visible isolated transcript",
        },
      },
      force: false,
    });
    const completed = await waitForJob(activeServices, queued.id);
    expect(completed.status, JSON.stringify(completed)).toBe("completed");
    const analyzedProject = await activeServices.projects.load(
      project.projectId,
    );
    const artifactId = analyzedProject.assets[asset.id]!.analysisRefs[0]!;
    const artifact = analyzedProject.analyses[artifactId]!;
    const document = await activeServices.projects.readAnalysisDocument(
      project.projectId,
      artifactId,
    );
    expect(artifact).toMatchObject({
      binaryHash,
      modelHash: descriptor!.modelHash,
      bundleHash: descriptor!.bundleHash,
    });
    expect(document).toMatchObject({
      binaryHash,
      modelHash: descriptor!.modelHash,
      bundleHash: descriptor!.bundleHash,
      metadata: {
        resourceRoles: ["protocol-adapter"],
        secretVisible: false,
        runtime: {
          binaryHash,
          binaryLicense: "MIT-test-fixture",
          modelLicense: "test-only",
        },
        analyzerBundle: {
          bundleHash: descriptor!.bundleHash,
          resources: [expect.objectContaining({ role: "protocol-adapter" })],
        },
      },
    });
    expect(document.segments[0]?.text).toBe(
      "Agent-visible isolated transcript",
    );
    expect(
      await activeServices.analysis.search({
        projectId: project.projectId,
        query: "isolated transcript",
        mode: "lexical",
        limit: 10,
      }),
    ).toHaveLength(1);

    const invalidParameters = await activeServices.analysis.start({
      projectId: project.projectId,
      assetId: asset.id,
      analyzers: ["whisper.cpp.transcribe"],
      parameters: { "whisper.cpp.transcribe": { text: 42 } },
      force: true,
    });
    expect(
      await waitForJob(activeServices, invalidParameters.id),
    ).toMatchObject({
      status: "failed",
      error: { code: "VALIDATION_ERROR" },
    });

    const oversized = await activeServices.analysis.start({
      projectId: project.projectId,
      assetId: asset.id,
      analyzers: ["whisper.cpp.transcribe"],
      parameters: { "whisper.cpp.transcribe": { mode: "oversize" } },
      force: true,
    });
    expect(await waitForJob(activeServices, oversized.id)).toMatchObject({
      status: "failed",
      error: { code: "RESOURCE_LIMIT" },
    });

    const hanging = await activeServices.analysis.start({
      projectId: project.projectId,
      assetId: asset.id,
      analyzers: ["whisper.cpp.transcribe"],
      parameters: { "whisper.cpp.transcribe": { mode: "hang" } },
      force: true,
    });
    activeServices.jobs.cancel(hanging.id);
    expect(await waitForJob(activeServices, hanging.id)).toMatchObject({
      status: "cancelled",
      error: { code: "JOB_CANCELLED" },
    });
  }, 15_000);

  it("keeps a hash-mismatched analyzer discoverable but unavailable", async () => {
    const { manifestPath } = await manifest({ corruptBinaryHash: true });
    const activeServices = await startServices(manifestPath);
    expect(
      activeServices.analysis
        .listAnalyzers()
        .find((candidate) => candidate.id === "whisper.cpp.transcribe"),
    ).toMatchObject({
      available: false,
      reasonUnavailable: expect.stringContaining("SHA-256"),
    });
    expect(
      (
        await activeServices.capabilities.listCapabilities(
          "analysis.transcription.whisper",
        )
      )[0],
    ).toMatchObject({
      available: false,
      reasonUnavailable: expect.stringContaining("SHA-256"),
    });
  });
});
