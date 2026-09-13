import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assetSchema, createId } from "@frameos/contracts";
import { createProject } from "../domain/project-factory.js";
import { createServices, type FrameOSServices } from "../services/services.js";
import { aiPlanRequestSchema } from "./ai-plan.js";
import { aiPlanSchema } from "./ai-plan.js";
import { z } from "zod";
import {
  StudioAiService,
  vertexEditGenerator,
  vertexSchema,
  type GenerateEdit,
} from "./ai-service.js";
import { AccessTokenProvider } from "../analysis/vertex-gemini-analyzer.js";

describe("Vertex edit response handling", () => {
  afterEach(() => vi.restoreAllMocks());
  it("preserves all real Zod action variants (oneOf)", () => {
    const schema = vertexSchema(z.toJSONSchema(aiPlanSchema));
    const properties = schema.properties as Record<
      string,
      { items: { anyOf: unknown[] } }
    >;
    expect(properties.actions!.items.anyOf).toHaveLength(10);
  });
  it("keeps action variants, enum discriminators and consistent field order", () => {
    expect(
      vertexSchema({
        type: "object",
        properties: {
          actions: {
            type: "array",
            items: {
              anyOf: [
                {
                  type: "object",
                  required: ["type"],
                  properties: { type: { type: "string", const: "trim" } },
                  additionalProperties: false,
                },
              ],
            },
          },
        },
      }),
    ).toEqual({
      type: "OBJECT",
      propertyOrdering: ["actions"],
      properties: {
        actions: {
          type: "ARRAY",
          items: {
            anyOf: [
              {
                type: "OBJECT",
                required: ["type"],
                properties: { type: { type: "STRING", enum: ["trim"] } },
                propertyOrdering: ["type"],
              },
            ],
          },
        },
      },
    });
  });
  const environment = {
    FRAMEOS_GEMINI_PROVIDER: "vertex-ai",
    FRAMEOS_GOOGLE_CLOUD_PROJECT: "test-project",
    FRAMEOS_GCS_BUCKET: "test-bucket",
  };
  it("reserves output budget and excludes thought text", async () => {
    vi.spyOn(AccessTokenProvider.prototype, "get").mockResolvedValue(
      "test-token",
    );
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  { text: "private reasoning", thought: true },
                  { text: "{}" },
                ],
              },
            },
          ],
        }),
      ),
    );
    const result = await vertexEditGenerator(environment)(
      "Edit",
      new AbortController().signal,
    );
    expect(result.text).toBe("{}");
    const payload = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(payload.generationConfig.thinkingConfig.thinkingBudget).toBe(1024);
    expect(payload.generationConfig.maxOutputTokens).toBeGreaterThan(1024);
  });
  it.each(["MAX_TOKENS", "SAFETY"])(
    "never accepts incomplete output (%s)",
    async (finishReason) => {
      vi.spyOn(AccessTokenProvider.prototype, "get").mockResolvedValue(
        "test-token",
      );
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              { finishReason, content: { parts: [{ text: "{}" }] } },
            ],
          }),
        ),
      );
      await expect(
        vertexEditGenerator(environment)("Edit", new AbortController().signal),
      ).rejects.toThrow("No edits were applied");
    },
  );
});

describe("Studio AI service", () => {
  let root: string, services: FrameOSServices;
  beforeEach(async () => {
    root = await mkdtemp(resolve(tmpdir(), "frameos-ai-test-"));
    services = await createServices({
      host: "127.0.0.1",
      port: 31415,
      dataDirectory: resolve(root, "data"),
      authToken: "test-token-longer-than-thirty-two-characters",
      authTokenPath: resolve(root, "token"),
      allowedMediaRoots: [root],
      remoteMode: false,
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await services.close();
    await rm(root, { recursive: true, force: true });
  });
  async function fixture() {
    const project = createProject({ name: "AI service QA" });
    const asset = assetSchema.parse({
      id: createId(),
      name: "UNTRUSTED name",
      kind: "video",
      uri: "file:///sample.mp4",
      hash: "f".repeat(64),
      duration: { value: 600, rate: { numerator: 30, denominator: 1 } },
    });
    project.assets[asset.id] = asset;
    // Store test data in memory at the project-load boundary; transactions still validate real documents.
    vi.spyOn(services.projects, "load").mockResolvedValue(project);
    vi.spyOn(services.analysis, "search").mockResolvedValue([]);
    const validate = vi
      .spyOn(services.transactions, "execute")
      .mockImplementation(async () => ({}) as never);
    const request = aiPlanRequestSchema.parse({
      projectId: project.projectId,
      baseRevision: 0,
      brief: "Use source 2–6 seconds",
      assetIds: [asset.id],
    });
    const plan = {
      summary: "Use four seconds",
      clarification: "",
      warnings: [],
      actions: [
        {
          type: "add",
          ref: "new_clip",
          track:
            project.sequences[project.settings.defaultSequenceId]!.tracks[0]!
              .id,
          assetId: asset.id,
          start: 0,
          source: 2,
          duration: 4,
          label: "Use source 2–6 seconds",
        },
      ],
    };
    return { project, request, plan, validate };
  }
  it("calls a real provider boundary with the brief and returns validated operations, never commits", async () => {
    const { project, request, plan, validate } = await fixture();
    const generate = vi.fn<GenerateEdit>().mockResolvedValue({
      text: JSON.stringify(plan),
      model: "gemini-test",
      inputTokens: 100,
      outputTokens: 50,
    });
    const result = await new StudioAiService(services, generate).plan(request);
    expect(generate.mock.calls[0]![0]).toContain(request.brief);
    expect(generate.mock.calls[0]![0]).not.toContain("file:///sample.mp4");
    expect(result.steps[0]?.op.type).toBe("item.add");
    expect(validate).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "validate", baseRevision: 0 }),
    );
    expect(project.revision).toBe(0);
  });
  it("rejects stale requests before charging the provider", async () => {
    const { request } = await fixture();
    const generate = vi.fn<GenerateEdit>();
    await expect(
      new StudioAiService(services, generate).plan({
        ...request,
        baseRevision: 1,
      }),
    ).rejects.toThrow("project changed");
    expect(generate).not.toHaveBeenCalled();
  });
  it("rejects invalid model output and releases the planning lock", async () => {
    const { request, validate } = await fixture();
    const generate = vi.fn<GenerateEdit>().mockResolvedValue({
      text: "not json",
      model: "gemini-test",
      inputTokens: 0,
      outputTokens: 0,
    });
    const service = new StudioAiService(services, generate);
    await expect(service.plan(request)).rejects.toThrow("invalid edit plan");
    await expect(service.plan(request)).rejects.toThrow("invalid edit plan");
    expect(validate).not.toHaveBeenCalled();
  });
  it("returns clarification without an executable plan", async () => {
    const { request, validate } = await fixture();
    const generate = vi.fn<GenerateEdit>().mockResolvedValue({
      text: JSON.stringify({
        summary: "Cannot render",
        clarification: "Would you like a timeline edit instead?",
        warnings: [],
        actions: [],
      }),
      model: "gemini-test",
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(
      (await new StudioAiService(services, generate).plan(request)).steps,
    ).toEqual([]);
    expect(validate).not.toHaveBeenCalled();
  });
});
