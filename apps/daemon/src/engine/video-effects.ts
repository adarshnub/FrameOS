import { z } from "zod";
import { FrameOSError, type EffectInstance } from "@frameos/contracts";

// A shared contract for capability discovery, AI planning and native rendering.
// No arbitrary filter names, FFmpeg expressions or file paths are accepted.
const definitions = [
  {
    id: "frameos.video.chroma-key",
    name: "Chroma key",
    description:
      "Remove a key colour from a foreground video or image over a lower video track. Basic keying; no spill suppression or edge refinement.",
    service: "chroma",
    schema: z
      .object({
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .default("#00ff00"),
        tolerance: z.number().finite().min(0).max(1).default(0.15),
      })
      .strict(),
    map: (
      p: Record<string, unknown>,
    ): Array<readonly [string, string | number]> => [
      ["key", String(p.color)],
      ["variance", Number(p.tolerance)],
    ],
  },
  {
    id: "frameos.video.gaussian-blur",
    name: "Gaussian blur",
    description:
      "Blur a whole video or image layer using a pixel radius. Static, unmasked and full clip duration.",
    service: "avfilter.gblur",
    schema: z
      .object({ sigma: z.number().finite().min(0).max(100).default(5) })
      .strict(),
    map: (
      p: Record<string, unknown>,
    ): Array<readonly [string, string | number]> => [
      ["av.sigma", Number(p.sigma)],
      ["av.steps", 2],
      ["av.threads", 2],
    ],
  },
  {
    id: "frameos.video.vignette",
    name: "Vignette",
    description:
      "Darken picture edges with strength from zero (none) to one (strong). Static, unmasked and full clip duration.",
    service: "avfilter.vignette",
    schema: z
      .object({ strength: z.number().finite().min(0).max(1).default(0.5) })
      .strict(),
    map: (
      p: Record<string, unknown>,
    ): Array<readonly [string, string | number]> => [
      ["av.angle", (Number(p.strength) * Math.PI) / 2],
      ["av.eval", "init"],
      ["av.dither", 0],
    ],
  },
];

export const videoEffectCapabilities = definitions.map((d) => ({
  id: d.id,
  kind: "filter" as const,
  name: d.name,
  description: d.description,
  dependencies: ["engine.mlt", `mlt.filter.${d.service}`],
  parameters: {
    ...z.toJSONSchema(d.schema),
    version: "1.0.0",
    target: "clip",
    restrictions: ["static", "unmasked", "full clip duration"],
  },
}));

export function videoEffectFilter(effect: EffectInstance) {
  const definition = definitions.find((d) => d.id === effect.capabilityId);
  if (!definition) return undefined;
  if (
    effect.version !== "1.0.0" ||
    effect.range ||
    effect.maskRef ||
    effect.automationCurves.length
  )
    throw new FrameOSError(
      "CAPABILITY_UNAVAILABLE",
      `${definition.name} requires version 1.0.0, static parameters, no mask and full clip duration`,
      424,
    );
  const parameters = definition.schema.parse(effect.parameters);
  return {
    service: definition.service,
    capabilityId: `mlt.filter.${definition.service}`,
    properties: definition.map(parameters),
  };
}
