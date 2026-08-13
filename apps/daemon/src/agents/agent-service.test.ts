import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { capabilityDescriptorSchema, createId } from "@frameos/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonConfig } from "../config.js";
import { createProject } from "../domain/project-factory.js";
import { createServices, type FrameOSServices } from "../services/services.js";
import { AgentService } from "./agent-service.js";
import { ProviderRegistry, type AgentProvider } from "./provider.js";

describe("agent service", () => {
  let root: string;
  let services: FrameOSServices;

  beforeEach(async () => {
    root = await mkdtemp(resolve(tmpdir(), "frameos-agent-test-"));
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

  it("connects a provider through the neutral interface and persists a structured plan", async () => {
    const project = await services.projects.create(
      createProject({ name: "Provider bridge" }),
    );
    const provider: AgentProvider = {
      kind: "local",
      model: "fixture-model",
      async createPlan(input) {
        return {
          responseId: "fixture-response",
          usage: {
            inputTokens: 1_000,
            cachedInputTokens: 250,
            outputTokens: 100,
            totalTokens: 1_100,
            estimatedCostUsd: 0.00044,
            pricingSource: "test pricing",
          },
          plan: {
            goal: input.request,
            summary: "Trim one frame after validating timeline boundaries.",
            assumptions: [],
            clarificationRequired: false,
            steps: [
              {
                id: "trim-opening",
                description: "Use clip.trim on the selected opening clip.",
                operationFamilies: ["editorial"],
                expectedAffectedRanges: [],
                verification: ["frame", "timeline_invariants"],
              },
            ],
            warnings: [],
          },
        };
      },
    };
    const registry = new ProviderRegistry();
    registry.add(provider);
    const agents = new AgentService(
      services.database,
      services.projects,
      services.capabilities,
      registry,
      services.events,
      services.transactions,
      services.analysis,
      services.jobs,
    );
    const session = await agents.createSession({
      projectId: project.projectId,
      provider: "local",
      model: "fixture-model",
      approvalMode: "supervised",
    });
    const run = await agents.plan(session.id, "Trim the opening by one frame");
    expect(run.state).toBe("planned");
    expect(run.providerResponseId).toBe("fixture-response");
    expect(agents.getRun(run.id).plan?.steps[0]?.operationFamilies).toEqual([
      "editorial",
    ]);
    expect(
      services.database.summarizeProviderUsage({ sessionId: session.id }),
    ).toMatchObject({
      requests: 1,
      inputTokens: 1_000,
      cachedInputTokens: 250,
      outputTokens: 100,
      estimatedCostUsd: 0.00044,
    });
  });

  it("records incurred usage and stops a run that exceeds its provider budget", async () => {
    const project = await services.projects.create(
      createProject({ name: "Cost limited planning" }),
    );
    const registry = new ProviderRegistry();
    registry.add({
      kind: "local",
      model: "priced-model",
      async createPlan(input) {
        return {
          usage: {
            inputTokens: 2_000,
            cachedInputTokens: 0,
            outputTokens: 200,
            totalTokens: 2_200,
            estimatedCostUsd: 0.02,
            pricingSource: "test pricing",
          },
          plan: {
            goal: input.request,
            summary: "A plan that exceeds the configured test budget.",
            assumptions: [],
            clarificationRequired: false,
            steps: [
              {
                id: "metadata",
                description: "Set metadata.",
                operationFamilies: ["project"],
                expectedAffectedRanges: [],
                verification: ["timeline_invariants"],
              },
            ],
            warnings: [],
          },
        };
      },
    });
    const agents = new AgentService(
      services.database,
      services.projects,
      services.capabilities,
      registry,
      services.events,
      services.transactions,
      services.analysis,
      services.jobs,
    );
    const session = await agents.createSession({
      projectId: project.projectId,
      provider: "local",
      model: "priced-model",
      budgets: { maxProviderCostUsd: 0.01 },
    });

    await expect(agents.plan(session.id, "Set metadata")).rejects.toMatchObject(
      { code: "RESOURCE_LIMIT" },
    );
    expect(
      services.database.summarizeProviderUsage({ sessionId: session.id }),
    ).toMatchObject({ requests: 1, estimatedCostUsd: 0.02 });
  });

  it("keeps supervised edits in a draft until an explicit approval commits them", async () => {
    const project = await services.projects.create(
      createProject({ name: "Supervised edit" }),
    );
    const registry = new ProviderRegistry();
    registry.add({
      kind: "local",
      model: "fixture-model",
      async createPlan(input) {
        return {
          plan: {
            goal: input.request,
            summary: "Set project workflow metadata.",
            assumptions: [],
            clarificationRequired: false,
            steps: [
              {
                id: "metadata",
                description: "Apply deterministic metadata.",
                operationFamilies: ["project"],
                expectedAffectedRanges: [],
                verification: ["timeline_invariants"],
              },
            ],
            warnings: [],
          },
        };
      },
    });
    const agents = new AgentService(
      services.database,
      services.projects,
      services.capabilities,
      registry,
      services.events,
      services.transactions,
      services.analysis,
      services.jobs,
    );
    const session = await agents.createSession({
      projectId: project.projectId,
      provider: "local",
      model: "fixture-model",
      approvalMode: "supervised",
      allowedOperationFamilies: ["project"],
    });
    const planned = await agents.plan(session.id, "Mark this as reviewed");
    const execution = await agents.execute(planned.id, {
      operations: [
        {
          operationId: createId(),
          type: "project.metadata.set",
          preconditions: [],
          arguments: { values: { reviewed: true } },
        },
      ],
    });
    expect(execution.run.state).toBe("awaiting_approval");
    expect(execution.approval?.status).toBe("pending");
    expect(execution.evaluation).toMatchObject({ cycle: 1, passed: true });
    expect(execution.evaluation?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "timeline.invariants", status: "pass" }),
        expect.objectContaining({
          id: "composition.visual_preview",
          status: "unavailable",
        }),
      ]),
    );
    expect((await services.projects.load(project.projectId)).revision).toBe(0);

    const revised = await agents.revise(planned.id, {
      operations: [
        {
          operationId: createId(),
          type: "project.metadata.set",
          preconditions: [],
          arguments: { values: { reviewed: "revised" } },
        },
      ],
    });
    expect(revised.evaluation).toMatchObject({ cycle: 2, passed: true });
    expect(revised.approval).toMatchObject({ status: "pending" });
    expect(revised.approval?.id).not.toBe(execution.approval?.id);
    expect(agents.getApproval(execution.approval!.id).status).toBe("rejected");
    expect(agents.listEvaluations(planned.id)).toHaveLength(2);
    expect(agents.getRun(planned.id).state).toBe("awaiting_approval");

    const reevaluated = await agents.evaluate(planned.id);
    expect(reevaluated.cycle).toBe(3);
    await expect(agents.evaluate(planned.id)).rejects.toMatchObject({
      code: "RESOURCE_LIMIT",
    });

    const decision = await agents.decideApproval(revised.approval!.id, {
      decision: "approve",
      decidedBy: "test-user",
      note: "Looks correct",
    });
    expect(decision.run.state).toBe("completed");
    expect(decision.approval.status).toBe("approved");
    const committed = await services.projects.load(project.projectId);
    expect(committed.revision).toBe(1);
    expect(committed.metadata.reviewed).toBe("revised");
    const history = await services.projects.history(project.projectId);
    expect(history[0]?.request.operations[0]?.provenance).toMatchObject({
      actorType: "agent",
      actorId: session.id,
      model: "fixture-model",
      runId: planned.id,
    });
  });

  it("records a rendered representative frame when the native preview capability is available", async () => {
    const project = await services.projects.create(
      createProject({ name: "Rendered evaluation" }),
    );
    vi.spyOn(services.worker, "discoverCapabilities").mockResolvedValue([
      capabilityDescriptorSchema.parse({
        id: "engine.mlt",
        kind: "producer",
        name: "Test MLT worker",
        description: "Test-only available worker",
        available: true,
        baseline: true,
        provider: "test",
        providerVersion: "1",
        license: "MIT",
        alternatives: [],
        metadata: {},
      }),
    ]);
    vi.spyOn(services.worker, "render").mockImplementation(
      async (_xmlPath, outputPath) => {
        await writeFile(outputPath, "rendered-frame", "utf8");
        return '{"status":"completed"}';
      },
    );
    const registry = new ProviderRegistry();
    registry.add({
      kind: "local",
      model: "preview-model",
      async createPlan(input) {
        return {
          plan: {
            goal: input.request,
            summary: "Preview a deterministic metadata edit.",
            assumptions: [],
            clarificationRequired: false,
            steps: [
              {
                id: "metadata",
                description: "Set metadata and inspect a representative frame.",
                operationFamilies: ["project"],
                expectedAffectedRanges: [],
                verification: ["frame", "timeline_invariants"],
              },
            ],
            warnings: [],
          },
        };
      },
    });
    const agents = new AgentService(
      services.database,
      services.projects,
      services.capabilities,
      registry,
      services.events,
      services.transactions,
      services.analysis,
      services.jobs,
    );
    const session = await agents.createSession({
      projectId: project.projectId,
      provider: "local",
      model: "preview-model",
      approvalMode: "supervised",
      allowedOperationFamilies: ["project"],
    });
    const run = await agents.plan(session.id, "Mark the project for review");
    const execution = await agents.execute(run.id, {
      operations: [
        {
          operationId: createId(),
          type: "project.metadata.set",
          preconditions: [],
          arguments: { values: { previewed: true } },
        },
      ],
    });
    expect(execution.evaluation?.previews).toEqual([
      expect.objectContaining({
        kind: "frame",
        status: "completed",
        artifactUris: expect.arrayContaining([
          expect.stringMatching(/^\/api\/v1\/jobs\//u),
        ]),
      }),
    ]);
    expect(execution.evaluation?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "composition.visual_preview",
          status: "warning",
        }),
      ]),
    );
    expect(JSON.stringify(execution.evaluation)).not.toContain(root);
  });

  it("supplies relevant untrusted transcript segments to the planning provider", async () => {
    const project = await services.projects.create(
      createProject({ name: "Transcript-aware planning" }),
    );
    const subtitlePath = resolve(root, "planning.srt");
    await writeFile(
      subtitlePath,
      "1\n00:00:01,000 --> 00:00:03,000\nThe portable launch quote is here.\n",
    );
    const imported = await services.assets.import({
      projectId: project.projectId,
      baseRevision: 0,
      idempotencyKey: "agent-transcript-asset",
      uri: pathToFileURL(subtitlePath).href,
      kind: "subtitle",
      managed: false,
      licenseMetadata: {},
    });
    const analysisJob = await services.analysis.start({
      projectId: project.projectId,
      assetId: imported.asset.id,
      analyzers: ["frameos.subtitle-text"],
      parameters: {},
      force: false,
    });
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (services.jobs.getJob(analysisJob.id).status === "completed") break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }

    let receivedContext: unknown;
    const registry = new ProviderRegistry();
    registry.add({
      kind: "local",
      model: "context-model",
      async createPlan(input) {
        receivedContext = input.analysisContext;
        return {
          plan: {
            goal: input.request,
            summary: "Use the indexed quote.",
            assumptions: [],
            clarificationRequired: false,
            steps: [
              {
                id: "quote",
                description: "Locate and edit around the quote.",
                operationFamilies: ["editorial"],
                expectedAffectedRanges: [],
                verification: ["timeline_invariants"],
              },
            ],
            warnings: [],
          },
        };
      },
    });
    const agents = new AgentService(
      services.database,
      services.projects,
      services.capabilities,
      registry,
      services.events,
      services.transactions,
      services.analysis,
      services.jobs,
    );
    const session = await agents.createSession({
      projectId: project.projectId,
      provider: "local",
      model: "context-model",
      approvalMode: "propose",
    });
    await agents.plan(session.id, "Find the portable launch quote");
    expect(receivedContext).toEqual([
      expect.objectContaining({
        assetId: imported.asset.id,
        type: "transcript",
        text: "The portable launch quote is here.",
      }),
    ]);
  });
});
