import { describe, expect, it, vi } from "vitest";
import {
  assetSchema,
  clipSchema,
  createId,
  frameTime,
  operationCatalog,
  titleSchema,
  toSeconds,
  type CapabilityDescriptor,
} from "@frameos/contracts";
import { createProject } from "../domain/project-factory.js";
import { aiPlanRequestSchema } from "./ai-plan.js";
import {
  canonicalizeNewEntityIds,
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
  it("repairs model placeholder IDs while preserving links to newly created items", () => {
    const f = fixture();
    const sequenceId = f.op.arguments.sequenceId;
    const added = {
      ...f.clip,
      id: "generated-detail-clip",
      timelineRange: {
        ...f.clip.timelineRange,
        start: frameTime(60, f.clip.timelineRange.start.rate),
      },
    };
    const steps = [
      {
        label: "Add a second shot",
        operation: {
          type: "item.add",
          operationId: "placeholder-operation",
          targetId: f.track.id,
          arguments: { sequenceId, trackId: f.track.id, item: added },
        },
      },
      {
        label: "Move the new shot",
        operation: {
          ...f.op,
          targetId: added.id,
          arguments: { ...f.op.arguments, x: 20 },
        },
      },
    ];
    const normalized = canonicalizeNewEntityIds(steps);
    const addedOperation = normalized[0]?.operation as {
      targetId: string;
      arguments: { item: { id: string } };
    };
    const movedOperation = normalized[1]?.operation as { targetId: string };
    expect(addedOperation.arguments.item.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(movedOperation.targetId).toBe(addedOperation.arguments.item.id);
    expect(addedOperation.targetId).toBe(f.track.id);
    const result = validateAdvancedSteps(
      f.project,
      steps,
      new Set(["item.add", "video.position.set"]),
      f.request,
    );
    const created = result.draft.sequences[sequenceId]!.tracks[0]!.items.find(
      (item) => item.id !== f.clip.id,
    );
    expect(created?.type).toBe("clip");
    if (created?.type !== "clip") throw new Error("New clip missing");
    expect(created.transform.positionX).toBe(20);
  });
  it("edits existing timeline footage without requiring media selection again", () => {
    const f = fixture();
    f.request.assetIds = [];
    const result = validateAdvancedSteps(
      f.project,
      [{ label: "Move existing shot", operation: f.op }],
      new Set([f.op.type]),
      f.request,
    );
    expect(
      result.draft.sequences[f.op.arguments.sequenceId]!.tracks[0]!.items[0],
    ).toMatchObject({ transform: { positionX: 20 } });
  });
  it("resolves a clip effect's omitted track from its unique target item", () => {
    const f = fixture();
    const effect = {
      id: createId(),
      capabilityId: "frameos.video.vignette",
      version: "1.0.0",
      parameters: { strength: 0.6 },
    };
    const result = validateAdvancedSteps(
      f.project,
      [
        {
          label: "Vignette the shot",
          operation: {
            type: "effect.add",
            operationId: createId(),
            targetId: f.clip.id,
            arguments: { sequenceId: f.op.arguments.sequenceId, effect },
          },
        },
      ],
      new Set(["effect.add"]),
      f.request,
    );
    expect(result.steps[0]?.op.arguments).toMatchObject({
      trackId: f.track.id,
    });
    expect(
      result.draft.sequences[f.op.arguments.sequenceId]!.tracks[0]!.items[0]!,
    ).toMatchObject({ effects: [{ capabilityId: "frameos.video.vignette" }] });
  });
  it("resolves a clip audio gain operation's required track", () => {
    const f = fixture();
    const result = validateAdvancedSteps(
      f.project,
      [
        {
          label: "Lower shot audio",
          operation: {
            type: "audio.gain.set",
            operationId: createId(),
            targetId: f.clip.id,
            arguments: { sequenceId: f.op.arguments.sequenceId, gainDb: -6 },
          },
        },
      ],
      new Set(["audio.gain.set"]),
      f.request,
    );
    expect(result.steps[0]?.op.arguments).toMatchObject({
      trackId: f.track.id,
    });
    expect(
      result.draft.sequences[f.op.arguments.sequenceId]!.tracks[0]!.items[0]!,
    ).toMatchObject({ audio: { gainDb: -6 } });
  });
  it("resolves an effect parameter change that targets the effect ID", () => {
    const f = fixture();
    const effectId = createId();
    const result = validateAdvancedSteps(
      f.project,
      [
        {
          label: "Add blur",
          operation: {
            type: "effect.add",
            operationId: createId(),
            targetId: f.clip.id,
            arguments: {
              sequenceId: f.op.arguments.sequenceId,
              trackId: f.track.id,
              effect: {
                id: effectId,
                capabilityId: "frameos.video.gaussian-blur",
                version: "1.0.0",
                parameters: {},
              },
            },
          },
        },
        {
          label: "Set sigma",
          operation: {
            type: "effect.parameter.set",
            operationId: createId(),
            targetId: effectId,
            arguments: {
              sequenceId: f.op.arguments.sequenceId,
              effectId,
              parameter: "sigma",
              value: 10,
              unset: false,
            },
          },
        },
      ],
      new Set(["effect.add", "effect.parameter.set"]),
      f.request,
    );
    expect(result.steps[1]?.op.targetId).toBe(f.clip.id);
    expect(result.steps[1]?.op.arguments).toMatchObject({
      trackId: f.track.id,
    });
    expect(
      result.draft.sequences[f.op.arguments.sequenceId]!.tracks[0]!.items[0]!,
    ).toMatchObject({ effects: [{ parameters: { sigma: 10 } }] });
  });
  it.each(["invalid-json", "render-mapping"])(
    "repairs %s against the original revision",
    async (failure) => {
      const f = fixture();
      const bad = {
        ...f.op,
        type: "effect.add",
        arguments: {
          sequenceId: f.op.arguments.sequenceId,
          trackId: f.track.id,
          effect: {
            id: createId(),
            capabilityId: "arbitrary.plugin",
            version: "1.0.0",
            parameters: {},
          },
        },
      };
      const generate = vi.fn<GenerateEdit>();
      for (const value of [
        {
          objective: "Move shot",
          requirements: ["20px right"],
          clarification: "",
        },
        {
          tools: [
            { name: f.op.type, purpose: "Move" },
            { name: "effect.add", purpose: "Effect" },
          ],
          unsupported: [],
        },
        failure === "invalid-json"
          ? "broken json"
          : {
              summary: "Invalid effect",
              warnings: [],
              steps: [{ label: "effect", operation: bad }],
            },
        {
          summary: "Move shot",
          warnings: [],
          steps: [{ label: "20px right", operation: f.op }],
        },
      ])
        generate.mockResolvedValueOnce({
          text: typeof value === "string" ? value : JSON.stringify(value),
          model: "test",
          inputTokens: 1,
          outputTokens: 1,
        });
      const result = await planAdvanced({
        ...f,
        context: {},
        generate,
        signal: new AbortController().signal,
        resolveUri: (u) => u,
      });
      expect(generate).toHaveBeenCalledTimes(4);
      expect(result.steps[0]?.op.type).toBe(f.op.type);
      expect(f.clip.transform.positionX).toBe(0);
      expect(result.usage.inputTokens).toBe(4);
    },
  );
  it.each([24, 30, 60])(
    "inserts ten seconds of %s fps source and a title from 3–7 seconds without a reference",
    (fps) => {
      const f = fixture();
      f.track.items = [];
      f.project.assets[f.clip.assetId]!.duration = frameTime(20 * fps, {
        numerator: fps,
        denominator: 1,
      });
      const seconds = (value: number) =>
        frameTime(value, { numerator: 1, denominator: 1 });
      const range = { start: seconds(0), duration: seconds(10) };
      const titleTrack = {
        ...f.track,
        id: createId(),
        name: "Titles",
        order: 2,
        items: [],
      };
      f.project.sequences[f.op.arguments.sequenceId]!.tracks.unshift(
        titleTrack,
      );
      const title = titleSchema.parse({
        id: createId(),
        name: "Welcome",
        type: "title",
        text: "welcome to frameos",
        timelineRange: {
          start: frameTime(90, { numerator: 30, denominator: 1 }),
          duration: frameTime(120, { numerator: 30, denominator: 1 }),
        },
      });
      const add = (item: unknown, trackId = f.track.id) => ({
        operationId: createId(),
        type: "item.add",
        arguments: { sequenceId: f.op.arguments.sequenceId, trackId, item },
      });
      const result = validateAdvancedSteps(
        f.project,
        [
          {
            label: "Keep first ten seconds",
            operation: add({
              ...f.clip,
              timelineRange: range,
              sourceRange: range,
            }),
          },
          {
            label: "Welcome from 3 to 7",
            operation: add(title, titleTrack.id),
          },
        ],
        new Set(["item.add"]),
        f.request,
      );
      const items = result.draft.sequences[
        f.op.arguments.sequenceId
      ]!.tracks.find((t) => t.id === f.track.id)!.items;
      expect(items).toHaveLength(1);
      expect(toSeconds(items[0]!.timelineRange.duration)).toBe(10);
      expect(
        items[0]!.type === "clip" &&
          items[0]!.sourceRange.duration.rate.numerator,
      ).toBe(fps);
      const caption = result.draft.sequences[
        f.op.arguments.sequenceId
      ]!.tracks.find((t) => t.id === titleTrack.id)!.items[0]!;
      expect(toSeconds(caption.timelineRange.start)).toBe(3);
      expect(toSeconds(caption.timelineRange.duration)).toBe(4);
      expect(f.track.items).toHaveLength(0);
    },
  );
  it("routes installed canonical operations and excludes side effects and missing render adapters", () => {
    const { capabilities } = fixture();
    const names = routeOperations(capabilities).map((o) => o.name);
    expect(names).toContain("video.position.set");
    expect(names).toContain("clip.ripple_delete");
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
