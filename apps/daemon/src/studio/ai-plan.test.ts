import { describe, expect, it } from "vitest";
import { assetSchema, createId, toSeconds } from "@frameos/contracts";
import { createProject } from "../domain/project-factory.js";
import { executeOperations } from "../domain/operation-executor.js";
import { aiPlanSchema, aiPlanRequestSchema, compileAiPlan } from "./ai-plan.js";

function fixture() {
  const project = createProject({ name: "AI plan test" });
  const asset = assetSchema.parse({
    id: createId(),
    name: "sample.mp4",
    kind: "video",
    uri: "file:///sample.mp4",
    hash: "a".repeat(64),
    duration: { value: 600, rate: { numerator: 30, denominator: 1 } },
  });
  project.assets[asset.id] = asset;
  const request = aiPlanRequestSchema.parse({
    projectId: project.projectId,
    baseRevision: 0,
    brief: "Make an edit",
    assetIds: [asset.id],
  });
  return { project, asset, request };
}
describe("AI edit compiler", () => {
  it("compiles aliases, explicit source ranges, rotation, titles and splits without mutating the project", () => {
    const { project, asset, request } = fixture();
    const plan = aiPlanSchema.parse({
      summary: "Two shots with a title",
      clarification: "",
      warnings: [],
      actions: [
        {
          type: "track",
          ref: "montage",
          name: "AI montage",
          kind: "video",
          label: "Create montage",
        },
        {
          type: "add",
          ref: "shot_a",
          track: "montage",
          assetId: asset.id,
          start: 0,
          source: 2,
          duration: 4,
          label: "Use seconds 2–6",
        },
        {
          type: "add",
          ref: "shot_b",
          track: "montage",
          assetId: asset.id,
          start: 4,
          source: 10,
          duration: 3,
          label: "Use seconds 10–13",
        },
        {
          type: "picture",
          item: "shot_b",
          rotation: 15,
          scale: 0.75,
          opacity: 1,
          label: "Rotate second shot",
        },
        {
          type: "split",
          item: "shot_a",
          ref: "shot_a_right",
          at: 2,
          label: "Split first shot at 2s",
        },
        {
          type: "track",
          ref: "titles",
          name: "Titles",
          kind: "video",
          label: "Create title track",
        },
        {
          type: "title",
          ref: "intro_title",
          track: "titles",
          text: "Our story",
          start: 0,
          duration: 2,
          label: "Add title",
        },
      ],
    });
    const steps = compileAiPlan(project, plan, request);
    const result = executeOperations(
      project,
      steps.map((s) => s.op),
    ).project;
    const sequence = result.sequences[result.settings.defaultSequenceId]!;
    const clips = sequence.tracks.find((t) => t.name === "AI montage")!.items;
    expect(clips).toHaveLength(3);
    expect(clips.map((i) => toSeconds(i.timelineRange.duration))).toEqual([
      2, 2, 3,
    ]);
    expect(clips[2]).toMatchObject({
      transform: { rotation: 15, scaleX: 0.75 },
    });
    expect(
      sequence.tracks.find((t) => t.name === "Titles")!.items[0],
    ).toMatchObject({ text: "Our story" });
    expect(project.revision).toBe(0);
    expect(
      project.sequences[project.settings.defaultSequenceId]!.tracks.flatMap(
        (t) => t.items,
      ),
    ).toHaveLength(0);
    expect(steps.every((s) => s.op.provenance?.actorType === "agent")).toBe(
      true,
    );
  });
  it("rejects out of bounds ranges and media outside the selection", () => {
    const { project, asset, request } = fixture();
    const track =
      project.sequences[project.settings.defaultSequenceId]!.tracks[0]!;
    const plan = aiPlanSchema.parse({
      summary: "Bad range",
      clarification: "",
      warnings: [],
      actions: [
        {
          type: "add",
          ref: "new_shot",
          track: track.id,
          assetId: asset.id,
          start: 0,
          source: 19,
          duration: 4,
          label: "Invalid range",
        },
      ],
    });
    expect(() => compileAiPlan(project, plan, request)).toThrow(
      "outside the source",
    );
    expect(() =>
      compileAiPlan(project, plan, { ...request, assetIds: [createId()] }),
    ).toThrow("outside your selection");
  });
  it("rejects overlapping edits before approval", () => {
    const { project, asset, request } = fixture();
    const track =
      project.sequences[project.settings.defaultSequenceId]!.tracks[0]!;
    const plan = aiPlanSchema.parse({
      summary: "Overlap",
      clarification: "",
      warnings: [],
      actions: [
        {
          type: "add",
          ref: "shot1",
          track: track.id,
          assetId: asset.id,
          start: 0,
          source: 0,
          duration: 4,
          label: "Add one",
        },
        {
          type: "add",
          ref: "shot2",
          track: track.id,
          assetId: asset.id,
          start: 2,
          source: 0,
          duration: 4,
          label: "Overlap",
        },
      ],
    });
    expect(() => compileAiPlan(project, plan, request)).toThrow();
  });
  it("never compiles actions when clarification is required", () => {
    const { project, request } = fixture();
    expect(
      compileAiPlan(
        project,
        {
          summary: "Unsupported export",
          clarification:
            "Native export is unavailable. Would you like editing only?",
          warnings: [],
          actions: [],
        },
        request,
      ),
    ).toEqual([]);
  });
  it("rejects executable code, arbitrary operations and unknown fields", () => {
    expect(
      aiPlanSchema.safeParse({
        summary: "bad",
        clarification: "",
        warnings: [],
        actions: [{ type: "shell", command: "echo bad", label: "Run" }],
      }).success,
    ).toBe(false);
    expect(
      aiPlanRequestSchema.safeParse({
        projectId: createId(),
        baseRevision: 0,
        brief: "edit",
        token: "secret",
      }).success,
    ).toBe(false);
  });
});
