import { describe, expect, it, vi } from "vitest";
import {
  assetSchema,
  clipSchema,
  createId,
  frameTime,
  operationCatalog,
  type CapabilityDescriptor,
} from "@frameos/contracts";
import { createProject } from "../domain/project-factory.js";
import { aiPlanRequestSchema } from "./ai-plan.js";
import {
  planAdvanced,
  routeOperations,
  validateAdvancedSteps,
} from "./advanced-planner.js";
import type { GenerateEdit } from "./ai-service.js";

function cap(id: string, available = true): CapabilityDescriptor {
  return {
    id,
    available,
    kind: "operation",
    name: id,
    description: "",
    baseline: false,
    provider: "test",
    alternatives: [],
    metadata: {},
  };
}
function fixture() {
  const project = createProject({ name: "Advanced planning" });
  const sequence = project.sequences[project.settings.defaultSequenceId]!;
  const track = sequence.tracks.find((t) => t.kind === "video")!;
  const asset = assetSchema.parse({
    id: createId(),
    name: "source.mp4",
    uri: "C:/media/source.mp4",
    hash: "a".repeat(64),
    kind: "video",
    duration: frameTime(300, sequence.format.frameRate),
  });
  project.assets[asset.id] = asset;
  const clip = clipSchema.parse({
    id: createId(),
    name: "Shot",
    type: "clip",
    assetId: asset.id,
    timelineRange: {
      start: frameTime(0, sequence.format.frameRate),
      duration: frameTime(30, sequence.format.frameRate),
    },
    sourceRange: {
      start: frameTime(0, sequence.format.frameRate),
      duration: frameTime(30, sequence.format.frameRate),
    },
  });
  track.items.push(clip);
  const request = aiPlanRequestSchema.parse({
    planner: "advanced",
    projectId: project.projectId,
    baseRevision: project.revision,
    brief: "Move shot 20 pixels to the right",
    assetIds: [asset.id],
  });
  const op = {
    operationId: createId(),
    type: "video.position.set",
    targetId: clip.id,
    preconditions: [],
    arguments: { sequenceId: sequence.id, trackId: track.id, x: 20, y: 0 },
  };
  const capabilities = [
    cap("engine.mlt"),
    cap("mlt.filter.affine"),
    ...operationCatalog.map((o) => cap(`operation.${o.name}`)),
  ];
  return { project, request, clip, track, op, capabilities };
}

describe("advanced capability routing and planning", () => {
  it("routes installed canonical operations and excludes side effects and missing render adapters", () => {
    const { capabilities } = fixture();
    const names = routeOperations(capabilities).map((o) => o.name);
    expect(names).toContain("video.position.set");
    expect(names).not.toContain("video.crop.set");
    expect(names).not.toContain("asset.remove");
    expect(names).not.toContain("color.lut.apply");
    expect(routeOperations([cap("operation.video.position.set")])).toEqual([]);
    expect(
      routeOperations([
        cap("mlt.filter.affine"),
        cap("operation.video.position.set", false),
      ]),
    ).toEqual([]);
  });
  it("rejects an unselected operation and preserves locked items", () => {
    const { project, request, clip, op } = fixture();
    expect(() =>
      validateAdvancedSteps(
        project,
        [{ label: "move", operation: op }],
        new Set(),
        request,
      ),
    ).toThrow("Unselected operation");
    clip.locked = true;
    expect(() =>
      validateAdvancedSteps(
        project,
        [{ label: "move", operation: op }],
        new Set([op.type]),
        request,
      ),
    ).toThrow("locked");
    expect(clip.transform.positionX).toBe(0);
  });
  it("rejects inserting the reference video", () => {
    const { project, request, clip, track, op } = fixture();
    request.referenceAssetId = clip.assetId;
    const add = {
      ...op,
      type: "item.add",
      targetId: undefined,
      arguments: {
        sequenceId: op.arguments.sequenceId,
        trackId: track.id,
        item: {
          ...clip,
          id: createId(),
          timelineRange: {
            ...clip.timelineRange,
            start: frameTime(30, clip.timelineRange.start.rate),
          },
        },
      },
    };
    expect(() =>
      validateAdvancedSteps(
        project,
        [{ label: "copy reference", operation: add }],
        new Set(["item.add"]),
        request,
      ),
    ).toThrow("reference");
    expect(track.items).toHaveLength(1);
  });
  it("runs three provider stages, sends only selected tool schemas, and produces a render-validated proposal", async () => {
    const f = fixture();
    const generate = vi.fn<GenerateEdit>();
    for (const value of [
      {
        objective: "Move shot",
        requirements: ["20px right"],
        clarification: "",
      },
      {
        tools: [{ name: f.op.type, purpose: "Position the shot" }],
        unsupported: [],
      },
      {
        summary: "Move shot right",
        warnings: [],
        steps: [{ label: "20 pixels right", operation: f.op }],
      },
    ])
      generate.mockResolvedValueOnce({
        text: JSON.stringify(value),
        model: "test",
        inputTokens: 10,
        outputTokens: 5,
      });
    const result = await planAdvanced({
      ...f,
      context: {},
      signal: new AbortController().signal,
      generate,
      resolveUri: (uri) => uri,
    });
    expect(generate).toHaveBeenCalledTimes(3);
    const schema = JSON.stringify(generate.mock.calls[2]?.[3]);
    expect(schema).toContain("video.position.set");
    expect(schema).not.toContain("video.scale.set");
    expect(result.planning.stages.at(-1)).toBe("render_graph_validation");
    expect(result.steps[0]?.op.type).toBe(f.op.type);
    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 15 });
    expect(f.clip.transform.positionX).toBe(0);
    expect(generate.mock.calls[2]?.[0]).not.toContain("C:/media/source.mp4");
    expect(generate.mock.calls[0]?.[0]).toContain("SOURCE ASSET IDS");
    expect(generate.mock.calls[0]?.[0]).toContain("REFERENCE ASSET ID");
  });
  it("fails before provider costs without a native worker", async () => {
    const f = fixture();
    const generate = vi.fn<GenerateEdit>();
    await expect(
      planAdvanced({
        ...f,
        capabilities: [],
        context: {},
        signal: new AbortController().signal,
        generate,
        resolveUri: (uri) => uri,
      }),
    ).rejects.toThrow("native worker");
    expect(generate).not.toHaveBeenCalled();
  });
  it("does not invent replacements for unsupported requirements", async () => {
    const f = fixture();
    const generate = vi
      .fn<GenerateEdit>()
      .mockResolvedValueOnce({
        text: JSON.stringify({
          objective: "Optical flow",
          requirements: ["optical flow"],
          clarification: "",
        }),
        model: "test",
        inputTokens: 1,
        outputTokens: 1,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          tools: [],
          unsupported: ["Optical flow adapter unavailable"],
        }),
        model: "test",
        inputTokens: 1,
        outputTokens: 1,
      });
    const result = await planAdvanced({
      ...f,
      context: {},
      signal: new AbortController().signal,
      generate,
      resolveUri: (uri) => uri,
    });
    expect(result.steps).toEqual([]);
    expect(result.clarification).toContain("Optical flow");
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
