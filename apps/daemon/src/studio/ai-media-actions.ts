import { z } from "zod";
import {
  audioNormalizeOperationSchema,
  audioCompressOperationSchema,
  audioLimitOperationSchema,
  audioDenoiseOperationSchema,
  audioEqSetOperationSchema,
} from "@frameos/contracts";

const target = {
  label: z.string().min(1).max(300),
  item: z.string().min(1).max(100),
};
const seconds = z.number().finite().min(0).max(86400);
const effectTarget = {
  sequenceId: true,
  trackId: true,
  effectId: true,
} as const;
export const mediaActionSchemas = [
  z
    .object({
      ...target,
      type: z.literal("detach_audio"),
      ref: z.string().min(1).max(100),
      track: z.string().min(1).max(100),
    })
    .strict(),
  z
    .object({
      ...target,
      type: z.literal("link"),
      other: z.string().min(1).max(100),
      linked: z.boolean(),
    })
    .strict(),
  z.object({ ...target, type: z.literal("mute"), muted: z.boolean() }).strict(),
  z
    .object({
      ...target,
      type: z.literal("pan"),
      pan: z.number().finite().min(-1).max(1),
    })
    .strict(),
  z
    .object({
      ...target,
      type: z.literal("speed"),
      speed: z.number().finite().min(0.0625).max(16),
    })
    .strict(),
  z.object({ ...target, type: z.literal("reverse") }).strict(),
  z.object({ ...target, type: z.literal("freeze"), source: seconds }).strict(),
  z
    .object({
      ...target,
      type: z.literal("speed_ramp"),
      duration: seconds.positive(),
      points: z
        .array(z.object({ at: seconds, source: seconds }).strict())
        .min(2)
        .max(32),
    })
    .strict(),
  z
    .object({
      ...target,
      type: z.literal("audio_fade"),
      kind: z.enum(["in", "out"]),
      duration: seconds.positive(),
      curve: z.enum(["linear", "equal_power", "s_curve", "logarithmic"]),
    })
    .strict(),
  z
    .object({
      ...target,
      type: z.literal("audio_reset"),
      processing: z.enum([
        "fades",
        "normalization",
        "eq",
        "compressor",
        "limiter",
        "denoise",
        "timelineDuck",
        "all",
      ]),
    })
    .strict(),
  z
    .object({
      ...target,
      type: z.literal("audio_normalize"),
      ...audioNormalizeOperationSchema.shape.arguments.omit(effectTarget).shape,
      mode: z.literal("integrated").default("integrated"),
      truePeakDb: z.number().finite().min(-9).max(0),
    })
    .strict(),
  z
    .object({
      ...target,
      type: z.literal("audio_compress"),
      ...audioCompressOperationSchema.shape.arguments.omit(effectTarget).shape,
      thresholdDb: z.number().finite().min(-60).max(0),
      ratio: z.number().finite().min(1).max(20),
      attackMs: z.number().finite().min(0.01).max(2000),
      releaseMs: z.number().finite().min(1).max(9000),
      kneeDb: z.number().finite().min(0).max(18).default(6),
      makeupGainDb: z.number().finite().min(0).max(36).default(0),
    })
    .strict(),
  z
    .object({
      ...target,
      type: z.literal("audio_limit"),
      ...audioLimitOperationSchema.shape.arguments.omit(effectTarget).shape,
      releaseMs: z.number().finite().min(1).max(8000),
      lookaheadMs: z.number().finite().min(0.1).max(80).default(5),
    })
    .strict(),
  z
    .object({
      ...target,
      type: z.literal("audio_denoise"),
      ...audioDenoiseOperationSchema.shape.arguments.omit({
        ...effectTarget,
        noiseProfileUri: true,
      }).shape,
    })
    .strict(),
  z
    .object({
      ...target,
      type: z.literal("audio_eq"),
      bands: z
        .array(
          audioEqSetOperationSchema.shape.arguments.shape.bands.element.omit({
            id: true,
          }),
        )
        .max(16),
    })
    .strict(),
  z
    .object({
      ...target,
      type: z.literal("audio_enhance_voice"),
      amount: z.number().finite().min(0).max(1),
    })
    .strict(),
  z
    .object({
      ...target,
      type: z.literal("audio_duck"),
      sidechain: z.string().min(1).max(100),
      reductionDb: z.number().finite().min(0).max(60),
      attack: seconds.positive(),
      release: seconds.positive(),
    })
    .strict(),
] as const;
