import { describe, expect, it } from "vitest";
import { createId, effectInstanceSchema } from "@frameos/contracts";
import { videoEffectCapabilities, videoEffectFilter } from "./video-effects.js";

const effect = (
  capabilityId: string,
  parameters: Record<string, unknown> = {},
) =>
  effectInstanceSchema.parse({
    id: createId(),
    capabilityId,
    version: "1.0.0",
    parameters,
  });
describe("normalized video effects", () => {
  it("maps validated controls and exposes their exact parameter bounds", () => {
    expect(
      videoEffectFilter(
        effect("frameos.video.chroma-key", {
          color: "#00ff00",
          tolerance: 0.2,
        }),
      )?.properties,
    ).toEqual([
      ["key", "#00ff00"],
      ["variance", 0.2],
    ]);
    expect(
      videoEffectFilter(effect("frameos.video.gaussian-blur", { sigma: 12 }))
        ?.service,
    ).toBe("avfilter.gblur");
    expect(videoEffectCapabilities).toHaveLength(3);
    expect(JSON.stringify(videoEffectCapabilities)).toContain('"maximum":100');
  });
  it("rejects raw expressions, unknown fields and unavailable effect modes", () => {
    for (const parameters of [
      { sigma: "10;movie=secret" },
      { sigma: 101 },
      { sigma: 10, uri: "/etc/passwd" },
    ])
      expect(() =>
        videoEffectFilter(effect("frameos.video.gaussian-blur", parameters)),
      ).toThrow();
    expect(() =>
      videoEffectFilter({
        ...effect("frameos.video.vignette"),
        maskRef: createId(),
      }),
    ).toThrow("no mask");
    expect(() =>
      videoEffectFilter(
        effect("frameos.video.chroma-key", { color: "movie=file" }),
      ),
    ).toThrow();
  });
});
