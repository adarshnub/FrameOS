import { describe, expect, it } from "vitest";
import { EngineWorkerClient } from "./worker-client.js";

describe("engine worker capability fallback", () => {
  it("reports every audited baseline service as unavailable without a worker", async () => {
    const capabilities = await new EngineWorkerClient().discoverCapabilities();
    expect(capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mlt.filter.affine",
          available: false,
          baseline: true,
        }),
        expect.objectContaining({
          id: "mlt.filter.avfilter.volume",
          available: false,
          baseline: true,
        }),
        expect.objectContaining({
          id: "mlt.filter.qtext",
          available: false,
          baseline: true,
        }),
        expect.objectContaining({
          id: "mlt.transition.luma",
          available: false,
          baseline: true,
        }),
        expect.objectContaining({
          id: "mlt.producer.color",
          available: false,
          baseline: true,
        }),
        expect.objectContaining({
          id: "preview.waveform",
          available: false,
          baseline: true,
        }),
        expect.objectContaining({
          id: "asset.proxy.create",
          available: false,
          baseline: true,
        }),
        expect.objectContaining({
          id: "asset.thumbnail.create",
          available: false,
          baseline: true,
        }),
      ]),
    );
  });
});
