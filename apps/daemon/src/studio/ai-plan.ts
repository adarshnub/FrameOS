import { z } from "zod";
import {
  createId,
  fromSeconds,
  toSeconds,
  operationSchema,
  FrameOSError,
  type Project,
  type Operation,
} from "@frameos/contracts";
import { executeOperations } from "../domain/operation-executor.js";

const ref = z.string().min(1).max(100);
const seconds = z.number().finite().min(0).max(86400);
const base = { label: z.string().min(1).max(300) };
export const aiActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...base,
      type: z.literal("transition"),
      from: ref,
      to: ref,
      duration: z.number().finite().min(0.08).max(3),
      kind: z.literal("dissolve"),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("track"),
      ref,
      name: z.string().min(1).max(100),
      kind: z.enum(["video", "audio"]),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("add"),
      ref,
      track: ref,
      assetId: z.uuid(),
      start: seconds,
      source: seconds,
      duration: seconds.positive(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("trim"),
      item: ref,
      source: seconds,
      duration: seconds.positive(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("move"),
      item: ref,
      track: ref,
      start: seconds,
    })
    .strict(),
  z
    .object({ ...base, type: z.literal("split"), item: ref, ref, at: seconds })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("picture"),
      item: ref,
      rotation: z.number().min(-360).max(360),
      scale: z.number().min(0.01).max(10),
      opacity: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("volume"),
      item: ref,
      gainDb: z.number().min(-120).max(48),
    })
    .strict(),
  z.object({ ...base, type: z.literal("delete"), item: ref }).strict(),
  z
    .object({
      ...base,
      type: z.literal("title"),
      ref,
      track: ref,
      text: z.string().min(1).max(2000),
      start: seconds,
      duration: seconds.positive(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("track_enabled"),
      track: ref,
      enabled: z.boolean(),
    })
    .strict(),
]);
export const aiPlanSchema = z
  .object({
    summary: z.string().min(1).max(2000),
    clarification: z.string().max(2000),
    warnings: z.array(z.string().max(1000)).max(20),
    actions: z.array(aiActionSchema).max(60),
  })
  .strict();
export const aiPlanRequestSchema = z
  .object({
    projectId: z.uuid(),
    baseRevision: z.int().nonnegative(),
    brief: z.string().trim().min(1).max(8000),
    assetIds: z.array(z.uuid()).max(20).default([]),
    referenceAssetId: z.uuid().optional(),
    selectedItemId: z.uuid().nullable().optional(),
    playhead: seconds.default(0),
    durations: z.record(z.uuid(), seconds.positive()).default({}),
    secondsPerClip: z.number().min(1).max(30).default(5),
  })
  .strict();
export type AiPlanRequest = z.infer<typeof aiPlanRequestSchema>;
export const visualReviewRequestSchema = aiPlanRequestSchema
  .extend({
    frames: z
      .array(
        z
          .object({
            role: z.enum(["timeline", "reference"]),
            at: seconds,
            jpeg: z
              .string()
              .min(16)
              .max(350000)
              .regex(/^[A-Za-z0-9+/]+={0,2}$/),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    pendingEdits: z.array(z.string().max(300)).max(60).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.frames.some((f) => f.role === "timeline"))
      context.addIssue({
        code: "custom",
        message: "Timeline preview frames are required.",
      });
    if (
      value.referenceAssetId &&
      !value.frames.some((f) => f.role === "reference")
    )
      context.addIssue({
        code: "custom",
        message: "Reference preview frames are required.",
      });
  });
export type VisualReviewRequest = z.infer<typeof visualReviewRequestSchema>;
export type AiPlan = z.infer<typeof aiPlanSchema>;
export interface AiStep {
  label: string;
  op: Operation;
  assetId?: string;
  itemId?: string;
  trackId?: string;
}

/** Compile model suggestions into allowlisted, schema-checked editing operations.
 * Apply only to a cloned document so every step is valid before approval. */
export function compileAiPlan(
  source: Project,
  plan: AiPlan,
  request: AiPlanRequest,
): AiStep[] {
  if (plan.clarification.trim()) return [];
  if (!plan.actions.length)
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "The AI returned no edits. Try a more specific instruction.",
      422,
    );
  let project = structuredClone(source);
  const aliases = new Map<string, string>();
  const steps: AiStep[] = [];
  const seq = () => project.sequences[project.settings.defaultSequenceId]!;
  const id = (value: string) => aliases.get(value) || value;
  const newRef = (value: string) => {
    if (aliases.has(value) || JSON.stringify(source).includes(value))
      throw new Error("AI reused an existing reference: " + value);
    const next = createId();
    aliases.set(value, next);
    return next;
  };
  const time = (s: number) => fromSeconds(s, seq().format.frameRate).time;
  const range = (start: number, duration: number) => ({
    start: time(start),
    duration: time(duration),
  });
  const locate = (reference: string) => {
    for (const track of seq().tracks) {
      const item = track.items.find((i) => i.id === id(reference));
      if (item) {
        if (track.locked || item.locked)
          throw Error("AI cannot edit a locked item.");
        return { track, item };
      }
    }
    throw Error("AI referenced an unknown timeline item.");
  };
  const sourceBounds = (assetId: string, start: number, duration: number) => {
    const asset = project.assets[assetId];
    if (!asset) throw Error("AI referenced unknown media.");
    const limit = asset.duration
      ? toSeconds(asset.duration)
      : request.durations[assetId];
    if (limit === undefined)
      throw Error(
        "Preview the source media to load its duration before planning edits.",
      );
    if (duration <= 0 || start + duration > limit + 1 / 30)
      throw Error("AI requested a range outside the source media.");
  };
  for (const a of plan.actions) {
    let type: string, args: unknown, targetId: string | undefined;
    let itemId: string | undefined,
      assetId: string | undefined,
      trackId: string | undefined;
    const sequenceId = seq().id;
    if (a.type === "track") {
      trackId = newRef(a.ref);
      type = "track.add";
      args = {
        sequenceId,
        track: {
          id: trackId,
          name: a.name,
          kind: a.kind,
          order: Math.max(0, ...seq().tracks.map((t) => t.order)) + 1,
          enabled: true,
          locked: false,
          muted: false,
          syncLocked: true,
          items: [],
          effects: [],
          metadata: {},
        },
      };
    } else if (a.type === "add") {
      if (a.assetId === request.referenceAssetId)
        throw Error("Reference footage cannot be added to the output.");
      if (request.assetIds.length && !request.assetIds.includes(a.assetId))
        throw Error("AI tried to add media outside your selection.");
      sourceBounds(a.assetId, a.source, a.duration);
      itemId = newRef(a.ref);
      trackId = id(a.track);
      assetId = a.assetId;
      const asset = project.assets[a.assetId]!;
      if (
        seq().tracks.find((t) => t.id === trackId)?.kind !==
        (asset.kind === "audio" ? "audio" : "video")
      )
        throw Error("AI selected an incompatible media track.");
      type = "item.add";
      args = {
        sequenceId,
        trackId,
        item: {
          id: itemId,
          type: "clip",
          name: asset.name,
          assetId,
          timelineRange: range(a.start, a.duration),
          sourceRange: range(a.source, a.duration),
          enabled: true,
          locked: false,
          metadata: {},
          transform: {},
          audio: {},
          timeMap: [],
          effects: [],
          links: [],
          semanticMetadata: {},
        },
      };
    } else if (a.type === "transition") {
      const left = locate(a.from),
        right = locate(a.to);
      if (
        left.track.id !== right.track.id ||
        left.track.kind !== "video" ||
        left.item.type !== "clip" ||
        right.item.type !== "clip"
      )
        throw Error("Dissolves require two video clips on the same track.");
      const cut = toSeconds(right.item.timelineRange.start);
      if (
        !left.item.enabled ||
        !right.item.enabled ||
        left.item.timeMap.length ||
        right.item.timeMap.length ||
        project.assets[left.item.assetId]?.kind !== "video" ||
        project.assets[right.item.assetId]?.kind !== "video"
      )
        throw Error("Dissolves require enabled, unretimed video clips.");
      const leftEnd =
        toSeconds(left.item.timelineRange.start) +
        toSeconds(left.item.timelineRange.duration);
      // Keep both handles on whole frames, including fractional frame rates.
      const half = toSeconds(time(a.duration / 2)),
        duration = half * 2;
      if (
        half <= 0 ||
        Math.abs(leftEnd - cut) > 0.0001 ||
        half > toSeconds(left.item.timelineRange.duration) ||
        half > toSeconds(right.item.timelineRange.duration)
      )
        throw Error(
          "Dissolves must bridge adjacent clips and fit their durations.",
        );
      sourceBounds(
        left.item.assetId,
        toSeconds(left.item.sourceRange.start),
        toSeconds(left.item.sourceRange.duration) + half,
      );
      if (toSeconds(right.item.sourceRange.start) < half)
        throw Error("The incoming clip needs source handles for a dissolve.");
      sourceBounds(
        right.item.assetId,
        toSeconds(right.item.sourceRange.start) - half,
        toSeconds(right.item.sourceRange.duration) + half,
      );
      if (
        left.track.items.some(
          (i) =>
            i.type === "transition" &&
            toSeconds(i.timelineRange.start) < cut + half &&
            toSeconds(i.timelineRange.start) +
              toSeconds(i.timelineRange.duration) >
              cut - half,
        )
      )
        throw Error("Dissolves cannot overlap.");
      trackId = left.track.id;
      itemId = createId();
      type = "transition.add";
      args = {
        sequenceId,
        trackId,
        transition: {
          id: itemId,
          type: "transition",
          name: "Dissolve",
          capabilityId: "frameos.transition.dissolve",
          fromItemId: left.item.id,
          toItemId: right.item.id,
          timelineRange: range(cut - half, duration),
          enabled: true,
          locked: false,
          metadata: {},
          parameters: {},
          automationCurves: [],
        },
      };
    } else if (a.type === "title") {
      itemId = newRef(a.ref);
      trackId = id(a.track);
      type = "title.add";
      args = {
        sequenceId,
        trackId,
        title: {
          id: itemId,
          type: "title",
          name: a.text.slice(0, 60),
          text: a.text,
          timelineRange: range(a.start, a.duration),
          enabled: true,
          locked: false,
          metadata: {},
          style: {},
          transform: {},
          effects: [],
        },
      };
    } else if (a.type === "track_enabled") {
      trackId = id(a.track);
      const track = seq().tracks.find((t) => t.id === trackId);
      if (!track || track.locked) throw Error("AI cannot change this track.");
      type = "track.update";
      targetId = trackId;
      args = { sequenceId, values: { enabled: a.enabled } };
    } else {
      const { track, item } = locate(a.item);
      targetId = itemId = item.id;
      trackId = track.id;
      if (a.type === "delete") {
        type = "item.delete";
        args = { sequenceId, trackId };
      } else if (a.type === "picture") {
        if (item.type !== "clip" && item.type !== "title")
          throw Error("AI picture edits require a visual item.");
        type = "item.transform.set";
        args = {
          sequenceId,
          trackId,
          transform: {
            ...item.transform,
            rotation: a.rotation,
            scaleX: a.scale,
            scaleY: a.scale,
            opacity: a.opacity,
          },
        };
      } else {
        if (item.type !== "clip") throw Error("AI action requires a clip.");
        if (item.timeMap.length)
          throw Error("AI cannot edit complex retimed clips yet.");
        assetId = item.assetId;
        switch (a.type) {
          case "trim":
            sourceBounds(assetId, a.source, a.duration);
            type = "clip.trim";
            args = {
              sequenceId,
              trackId,
              sourceRange: range(a.source, a.duration),
            };
            break;
          case "move":
            type = "clip.move";
            args = {
              sequenceId,
              fromTrackId: trackId,
              toTrackId: id(a.track),
              timelineStart: time(a.start),
            };
            break;
          case "split":
            type = "clip.split";
            args = {
              sequenceId,
              trackId,
              at: time(a.at),
              rightClipId: newRef(a.ref),
            };
            break;
          case "volume":
            type = "audio.gain.set";
            args = { sequenceId, trackId, gainDb: a.gainDb };
            break;
        }
      }
    }
    const op = operationSchema.parse({
      operationId: createId(),
      type,
      arguments: args,
      ...(targetId ? { targetId } : {}),
      preconditions: [],
      provenance: { actorType: "agent", actorId: "studio.gemini-editor" },
    });
    project = executeOperations(project, [op]).project;
    steps.push({
      label: a.label,
      op,
      ...(assetId ? { assetId } : {}),
      ...(itemId ? { itemId } : {}),
      ...(trackId ? { trackId } : {}),
    });
  }
  return steps;
}
