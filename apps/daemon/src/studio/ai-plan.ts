import { z } from "zod";
import {
  createId,
  frameTime,
  fromSeconds,
  toSeconds,
  operationSchema,
  clipSchema,
  itemAutomationParameterSchema,
  transformSchema,
  FrameOSError,
  type Project,
  type Operation,
} from "@frameos/contracts";
import { executeOperations } from "../domain/operation-executor.js";
import { mediaActionSchemas } from "./ai-media-actions.js";

const ref = z.string().min(1).max(100);
const seconds = z.number().finite().min(0).max(86400);
const base = { label: z.string().min(1).max(300) };
export const aiActionSchema = z.discriminatedUnion("type", [
  ...mediaActionSchemas,
  z
    .object({
      ...base,
      type: z.literal("canvas"),
      width: z.int().min(16).max(8192),
      height: z.int().min(16).max(8192),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("reframe"),
      item: ref,
      values: transformSchema.partial(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("transform_animation"),
      item: ref,
      curves: z
        .array(
          z
            .object({
              parameter: itemAutomationParameterSchema,
              keyframes: z
                .array(
                  z
                    .object({
                      time: seconds,
                      value: z.number().finite(),
                      interpolation: z
                        .enum(["hold", "linear", "bezier", "smooth"])
                        .default("linear"),
                    })
                    .strict(),
                )
                .min(1)
                .max(256),
            })
            .strict(),
        )
        .min(1)
        .max(16),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("camera_shake"),
      item: ref,
      amplitudePixels: z.number().finite().min(0).max(500),
      rotationDegrees: z.number().finite().min(0).max(20).default(1.5),
      frequencyHz: z.number().finite().min(0.5).max(12).default(4),
      overscan: z.number().finite().min(1).max(3).default(1.06),
      seed: z.int().min(0).max(2_147_483_647).default(1),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("transition"),
      from: ref,
      to: ref,
      duration: z.number().finite().min(0.08).max(3),
      kind: z.enum(["dissolve", "audio_crossfade"]),
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
    planner: z.enum(["simple", "advanced"]).default("simple"),
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
export const briefCheckRequestSchema = aiPlanRequestSchema
  .pick({
    planner: true,
    projectId: true,
    baseRevision: true,
    brief: true,
    assetIds: true,
    referenceAssetId: true,
    secondsPerClip: true,
  })
  .extend({ analyzeFootage: z.boolean().default(true) });
export type BriefCheckRequest = z.infer<typeof briefCheckRequestSchema>;
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
    if (
      aliases.has(value) ||
      JSON.stringify(source).includes(JSON.stringify(value))
    )
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
  const emit = (
    label: string,
    type: string,
    args: unknown,
    targetId?: string,
  ) => {
    const op = operationSchema.parse({
      operationId: createId(),
      type,
      arguments: args,
      ...(targetId ? { targetId } : {}),
      preconditions: [],
      provenance: { actorType: "agent", actorId: "studio.gemini-editor" },
    });
    project = executeOperations(project, [op]).project;
    steps.push({ label, op, ...(targetId ? { itemId: targetId } : {}) });
  };
  for (const a of plan.actions) {
    let type: string, args: unknown, targetId: string | undefined;
    let itemId: string | undefined,
      assetId: string | undefined,
      trackId: string | undefined;
    const sequenceId = seq().id;
    if (a.type === "canvas") {
      emit(
        a.label,
        "sequence.format.set",
        { format: { ...seq().format, width: a.width, height: a.height } },
        sequenceId,
      );
      continue;
    }
    if (
      mediaActionSchemas.some((schema) => schema.shape.type.value === a.type)
    ) {
      // Validate again here to narrow the extended action union.
      const action = z.discriminatedUnion("type", mediaActionSchemas).parse(a);
      const { track, item } = locate(action.item);
      if (item.type !== "clip")
        throw Error("This action requires a media clip.");
      const target = { sequenceId, trackId: track.id };
      const replace = (clip: typeof item) =>
        emit(action.label, "item.replace", { ...target, item: clip }, item.id);
      if (action.type === "detach_audio") {
        const asset = project.assets[item.assetId]!;
        const destination = seq().tracks.find((t) => t.id === id(action.track));
        if (track.kind !== "video" || asset.kind !== "video")
          throw Error("Detach audio requires a video clip.");
        if (
          asset.streams.length &&
          !asset.streams.some((s) => s.kind === "audio")
        )
          throw Error("This video has no audio stream.");
        if (!destination || destination.kind !== "audio" || destination.locked)
          throw Error("Choose an unlocked audio track for detached audio.");
        if (item.metadata.detachedAudioId)
          throw Error("This clip's audio is already detached.");
        const audioId = newRef(action.ref);
        const copyWithFreshIds = <T>(value: T): T =>
          JSON.parse(JSON.stringify(value), (key, v) =>
            key === "id" ? createId() : v,
          ) as T;
        const audio = {
          ...structuredClone(item),
          id: audioId,
          name: item.name + " · audio",
          links: [],
          transform: {},
          timeMap: copyWithFreshIds(item.timeMap),
          effects: copyWithFreshIds(
            item.effects.filter((e) =>
              e.capabilityId.startsWith("frameos.audio."),
            ),
          ),
          metadata: { ...item.metadata, detachedFromId: item.id },
        };
        // One reversible operation: Stop/Undo cannot leave duplicated sound.
        const sequence = structuredClone(seq());
        sequence.tracks
          .find((t) => t.id === destination.id)!
          .items.push(clipSchema.parse(audio));
        const original = sequence.tracks
          .find((t) => t.id === track.id)!
          .items.find((i) => i.id === item.id)!;
        if (original.type === "clip") {
          original.audio.muted = true;
          original.metadata.detachedAudioId = audioId;
        }
        emit(action.label, "sequence.replace", { sequence }, sequenceId);
        steps.at(-1)!.itemId = audioId;
      } else if (action.type === "link") {
        const other = locate(action.other);
        if (other.item.type !== "clip")
          throw Error("Only media clips can be linked.");
        emit(
          action.label,
          action.linked ? "clip.link" : "clip.unlink",
          {
            ...target,
            otherTrackId: other.track.id,
            otherClipId: other.item.id,
          },
          item.id,
        );
      } else if (action.type === "mute") {
        replace({ ...item, audio: { ...item.audio, muted: action.muted } });
      } else if (action.type === "pan") {
        emit(
          action.label,
          "audio.pan.set",
          { ...target, pan: action.pan },
          item.id,
        );
      } else if (
        action.type === "speed" ||
        action.type === "reverse" ||
        action.type === "freeze"
      ) {
        const keys = {
          ...target,
          startKeyframeId: createId(),
          endKeyframeId: createId(),
        };
        if (action.type === "speed") {
          let sourceRange = item.sourceRange;
          if (item.timeMap.length) {
            const values = item.timeMap.map((k) => Number(k.value));
            const start = Math.min(...values),
              finish = Math.max(...values);
            if (finish > start) {
              sourceRange = {
                start: { ...item.sourceRange.start, value: start },
                duration: {
                  rate: item.sourceRange.start.rate,
                  value: finish - start,
                },
              };
              replace({ ...item, sourceRange, timeMap: [] });
            }
          }
          // Round the output duration to a frame, then use the exact resulting ratio.
          const sourceFrames = time(toSeconds(sourceRange.duration)).value;
          const outputFrames = Math.max(
            1,
            Math.round(sourceFrames / action.speed),
          );
          emit(
            action.label,
            "clip.speed.set",
            {
              ...keys,
              speed: { numerator: sourceFrames, denominator: outputFrames },
            },
            item.id,
          );
        } else if (action.type === "freeze") {
          sourceBounds(item.assetId, action.source, 1 / 30);
          if (
            action.source < toSeconds(item.sourceRange.start) ||
            action.source >=
              toSeconds(item.sourceRange.start) +
                toSeconds(item.sourceRange.duration)
          )
            throw Error("Freeze frame must be inside the clip's source range.");
          emit(
            action.label,
            "clip.freeze_frame",
            {
              ...keys,
              sourceTime: fromSeconds(
                action.source,
                item.sourceRange.start.rate,
              ).time,
            },
            item.id,
          );
        } else emit(action.label, "clip.reverse", keys, item.id);
      } else if (action.type === "speed_ramp") {
        if (
          action.points[0]!.at !== 0 ||
          action.points.at(-1)!.at !== action.duration
        )
          throw Error(
            "Speed ramp points must span the full timeline duration.",
          );
        const sourceStart = toSeconds(item.sourceRange.start),
          sourceEnd = sourceStart + toSeconds(item.sourceRange.duration);
        const points = action.points;
        for (let n = 0; n < points.length; n++) {
          const point = points[n]!;
          if (
            point.source < sourceStart ||
            point.source > sourceEnd ||
            (n &&
              (time(point.at).value <= time(points[n - 1]!.at).value ||
                point.source < points[n - 1]!.source))
          )
            throw Error(
              "Speed ramps require increasing frame-aligned timeline points and non-descending source times inside the clip.",
            );
        }
        emit(
          action.label,
          "clip.speed_ramp.set",
          {
            ...target,
            timelineDuration: time(action.duration),
            keyframes: points.map((p) => ({
              id: createId(),
              time: time(p.at),
              value: fromSeconds(p.source, item.sourceRange.start.rate).time
                .value,
              interpolation: "linear",
            })),
          },
          item.id,
        );
      } else {
        let effect = item.effects.find(
          (e) =>
            e.capabilityId === "frameos.audio.channel-strip" &&
            e.enabled &&
            !e.range &&
            !e.automationCurves.length,
        );
        if (action.type === "audio_reset") {
          replace({
            ...item,
            effects: item.effects.flatMap((e) => {
              if (e.capabilityId !== "frameos.audio.channel-strip") return [e];
              if (action.processing === "all") return [];
              const parameters = { ...e.parameters };
              delete parameters[action.processing];
              return [{ ...e, parameters }];
            }),
          });
          continue;
        }
        if (!effect) {
          effect = {
            id: createId(),
            capabilityId: "frameos.audio.channel-strip",
            version: "1.0.0",
            enabled: true,
            parameters: {},
            automationCurves: [],
          };
          replace({ ...item, effects: [...item.effects, effect] });
        }
        const effectArgs = { ...target, effectId: effect.id };
        const {
          type: actionType,
          label: _label,
          item: _item,
          ...parameters
        } = action;
        if (action.type === "audio_fade") {
          if (
            time(action.duration).value <= 0 ||
            action.duration > toSeconds(item.timelineRange.duration)
          )
            throw Error("Audio fade must fit the clip duration.");
          emit(
            action.label,
            "audio.fade.add",
            {
              ...effectArgs,
              fade: {
                id: createId(),
                kind: action.kind,
                duration: time(action.duration),
                curve: action.curve,
              },
            },
            item.id,
          );
        } else if (action.type === "audio_eq") {
          if (
            action.bands.some(
              (b) =>
                b.frequencyHz >= seq().format.sampleRate / 2 ||
                (["low_cut", "high_cut"].includes(b.kind) && b.gainDb !== 0),
            )
          )
            throw Error(
              "EQ frequencies must be below Nyquist; cut filters require zero gain.",
            );
          emit(
            action.label,
            "audio.eq.set",
            {
              ...effectArgs,
              bands: action.bands.map((band) => ({ ...band, id: createId() })),
            },
            item.id,
          );
        } else if (action.type === "audio_enhance_voice") {
          emit(
            action.label + " · noise reduction",
            "audio.denoise",
            { ...effectArgs, amount: action.amount * 0.5 },
            item.id,
          );
          emit(
            action.label + " · speech EQ",
            "audio.eq.set",
            {
              ...effectArgs,
              bands: [
                {
                  id: createId(),
                  kind: "low_cut",
                  frequencyHz: 80,
                  gainDb: 0,
                  q: 0.707,
                  enabled: true,
                },
                {
                  id: createId(),
                  kind: "bell",
                  frequencyHz: 3000,
                  gainDb: action.amount * 3,
                  q: 0.707,
                  enabled: true,
                },
              ],
            },
            item.id,
          );
          emit(
            action.label + " · compression",
            "audio.compress",
            {
              ...effectArgs,
              thresholdDb: -18,
              ratio: 1 + action.amount * 2,
              attackMs: 10,
              releaseMs: 150,
              kneeDb: 6,
              makeupGainDb: 0,
            },
            item.id,
          );
        } else if (action.type === "audio_duck") {
          const other = locate(action.sidechain);
          if (
            other.item.type !== "clip" ||
            other.item.id === item.id ||
            !other.item.enabled ||
            !other.track.enabled ||
            other.track.muted ||
            other.item.audio.muted
          )
            throw Error("Ducking requires a different audible sidechain clip.");
          if (item.timeMap.length)
            throw Error(
              "Apply timeline ducking after finalizing timing on an unretimed audio clip.",
            );
          const start = Math.max(
            0,
            toSeconds(other.item.timelineRange.start) -
              toSeconds(item.timelineRange.start),
          );
          const finish = Math.min(
            toSeconds(item.timelineRange.duration),
            toSeconds(other.item.timelineRange.start) +
              toSeconds(other.item.timelineRange.duration) -
              toSeconds(item.timelineRange.start),
          );
          if (finish <= start)
            throw Error("The ducked clip and sidechain must overlap in time.");
          const latest = locate(item.id).item;
          if (latest.type !== "clip") throw Error("Audio clip disappeared.");
          replace({
            ...latest,
            effects: latest.effects.map((e) =>
              e.id === effect.id
                ? {
                    ...e,
                    parameters: {
                      ...e.parameters,
                      timelineDuck: {
                        start,
                        end: finish,
                        reductionDb: action.reductionDb,
                        attack: action.attack,
                        release: action.release,
                      },
                    },
                  }
                : e,
            ),
          });
        } else {
          emit(
            action.label,
            actionType.replace("audio_", "audio."),
            { ...effectArgs, ...parameters },
            item.id,
          );
        }
      }
      continue;
    }
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
          sourceRange: {
            start: fromSeconds(
              a.source,
              asset.duration?.rate ?? seq().format.frameRate,
            ).time,
            duration: fromSeconds(
              a.duration,
              asset.duration?.rate ?? seq().format.frameRate,
            ).time,
          },
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
        left.track.kind !== (a.kind === "dissolve" ? "video" : "audio") ||
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
        (a.kind === "dissolve" &&
          (project.assets[left.item.assetId]?.kind !== "video" ||
            project.assets[right.item.assetId]?.kind !== "video"))
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
          name: a.kind === "dissolve" ? "Dissolve" : "Audio crossfade",
          capabilityId: "frameos.transition." + a.kind,
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
      if (!("item" in a)) throw Error("Unknown AI action.");
      const { track, item } = locate(a.item);
      targetId = itemId = item.id;
      trackId = track.id;
      if (a.type === "delete") {
        type = "item.delete";
        args = { sequenceId, trackId };
      } else if (a.type === "picture" || a.type === "reframe") {
        if (item.type !== "clip" && item.type !== "title")
          throw Error("AI picture edits require a visual item.");
        type = "item.transform.set";
        args = {
          sequenceId,
          trackId,
          transform: {
            ...item.transform,
            ...(a.type === "reframe"
              ? a.values
              : {
                  rotation: a.rotation,
                  scaleX: a.scale,
                  scaleY: a.scale,
                  opacity: a.opacity,
                }),
          },
        };
      } else if (a.type === "camera_shake") {
        if (item.type !== "clip")
          throw Error("AI camera shake requires a video clip.");
        const durationFrames = Math.max(
          1,
          Math.round(
            (toSeconds(item.timelineRange.duration) *
              seq().format.frameRate.numerator) /
              seq().format.frameRate.denominator,
          ),
        );
        const frameStep = Math.max(
          1,
          Math.round(
            seq().format.frameRate.numerator /
              seq().format.frameRate.denominator /
              (a.frequencyHz * 2),
          ),
        );
        const random = (frame: number, channel: number) => {
          const value =
            Math.sin(
              (a.seed + 1) * 12.9898 + frame * 78.233 + channel * 37.719,
            ) * 43758.5453;
          return (value - Math.floor(value)) * 2 - 1;
        };
        const frames = Array.from(
          { length: Math.floor(durationFrames / frameStep) + 1 },
          (_, index) => Math.min(durationFrames, index * frameStep),
        );
        if (frames.at(-1) !== durationFrames) frames.push(durationFrames);
        const keyframes = (
          parameter: string,
          value: (frame: number) => number,
        ) => ({
          id: createId(),
          parameter,
          keyframes: frames.map((frame) => ({
            id: createId(),
            time: frameTime(frame, seq().format.frameRate),
            value: value(frame),
            interpolation: "smooth" as const,
          })),
        });
        type = "item.automation.set";
        args = {
          sequenceId,
          trackId,
          automationCurves: [
            keyframes(
              "transform.positionX",
              (frame) =>
                item.transform.positionX + random(frame, 0) * a.amplitudePixels,
            ),
            keyframes(
              "transform.positionY",
              (frame) =>
                item.transform.positionY + random(frame, 1) * a.amplitudePixels,
            ),
            keyframes(
              "transform.rotation",
              (frame) =>
                item.transform.rotation + random(frame, 2) * a.rotationDegrees,
            ),
            keyframes(
              "transform.scaleX",
              () => item.transform.scaleX * a.overscan,
            ),
            keyframes(
              "transform.scaleY",
              () => item.transform.scaleY * a.overscan,
            ),
          ],
        };
      } else if (a.type === "transform_animation") {
        if (
          item.type !== "clip" &&
          item.type !== "title" &&
          item.type !== "nested_sequence"
        )
          throw Error("AI transform animation edits require a visual item.");
        type = "item.automation.set";
        args = {
          sequenceId,
          trackId,
          automationCurves: a.curves.map((curve) => ({
            id: createId(),
            parameter: curve.parameter,
            keyframes: curve.keyframes.map((keyframe) => ({
              id: createId(),
              time: fromSeconds(keyframe.time, seq().format.frameRate).time,
              value: keyframe.value,
              interpolation: keyframe.interpolation,
            })),
          })),
        };
      } else {
        if (item.type !== "clip") throw Error("AI action requires a clip.");
        assetId = item.assetId;
        switch (a.type) {
          case "trim":
            sourceBounds(assetId, a.source, a.duration);
            type = "clip.trim";
            args = {
              sequenceId,
              trackId,
              sourceRange: range(a.source, a.duration),
              retimeStartKeyframeId: createId(),
              retimeEndKeyframeId: createId(),
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
              rightStartKeyframeId: createId(),
              leftEndKeyframeId: createId(),
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
      type: type!,
      arguments: args!,
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
  if (steps.length > 60)
    throw Error(
      "This plan needs more than 60 operations. Split it into smaller editing passes.",
    );
  return steps;
}
