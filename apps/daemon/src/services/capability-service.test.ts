import { describe, expect, it } from "vitest";
import type { EngineWorkerClient } from "../engine/worker-client.js";
import { CapabilityService } from "./capability-service.js";

describe("normalized adapter capabilities", () => {
  it("derives agent-facing availability from the audited native snapshot", async () => {
    const worker = {
      discoverCapabilities: async () => [
        {
          id: "engine.mlt",
          kind: "producer" as const,
          name: "MLT",
          description: "test",
          available: true,
          baseline: true,
          provider: "test",
          alternatives: [],
          metadata: {},
        },
        {
          id: "mlt.producer.color",
          kind: "producer" as const,
          name: "Color",
          description: "test",
          available: true,
          baseline: true,
          provider: "test",
          alternatives: [],
          metadata: {},
        },
        {
          id: "preview.frame",
          kind: "consumer" as const,
          name: "Frame preview",
          description: "test",
          available: true,
          baseline: true,
          provider: "test",
          alternatives: [],
          metadata: {},
        },
        {
          id: "mlt.filter.affine",
          kind: "filter" as const,
          name: "Affine",
          description: "test",
          available: false,
          baseline: true,
          provider: "test",
          reasonUnavailable: "not installed",
          alternatives: [],
          metadata: {},
        },
        {
          id: "mlt.filter.avfilter.exposure",
          kind: "filter" as const,
          name: "Exposure",
          description: "test",
          available: true,
          baseline: true,
          provider: "test",
          alternatives: [],
          metadata: {},
        },
        {
          id: "mlt.filter.avfilter.eq",
          kind: "filter" as const,
          name: "EQ",
          description: "test",
          available: true,
          baseline: true,
          provider: "test",
          alternatives: [],
          metadata: {},
        },
        {
          id: "mlt.filter.avfilter.colortemperature",
          kind: "filter" as const,
          name: "Color temperature",
          description: "test",
          available: true,
          baseline: true,
          provider: "test",
          alternatives: [],
          metadata: {},
        },
        {
          id: "mlt.filter.avfilter.curves",
          kind: "filter" as const,
          name: "Curves",
          description: "test",
          available: true,
          baseline: true,
          provider: "test",
          alternatives: [],
          metadata: {},
        },
        {
          id: "mlt.filter.avfilter.lut3d",
          kind: "filter" as const,
          name: "3D LUT",
          description: "test",
          available: true,
          baseline: true,
          provider: "test",
          alternatives: [],
          metadata: {},
        },
      ],
    } as unknown as EngineWorkerClient;
    const capabilities = await new CapabilityService(worker).listCapabilities();

    expect(
      capabilities.find(
        (capability) => capability.id === "frameos.generator.solid",
      ),
    ).toMatchObject({
      available: true,
      metadata: {
        underlyingCapabilities: ["engine.mlt", "mlt.producer.color"],
      },
    });
    expect(
      capabilities.find(
        (capability) => capability.id === "frameos.video.transform",
      ),
    ).toMatchObject({
      available: false,
      reasonUnavailable: expect.stringContaining("mlt.filter.affine"),
    });
    expect(
      capabilities.find(
        (capability) => capability.id === "frameos.color.primary",
      ),
    ).toMatchObject({
      available: true,
      metadata: {
        underlyingCapabilities: [
          "engine.mlt",
          "mlt.filter.avfilter.exposure",
          "mlt.filter.avfilter.eq",
          "mlt.filter.avfilter.colortemperature",
          "mlt.filter.avfilter.curves",
          "mlt.filter.avfilter.lut3d",
        ],
      },
    });
    expect(
      capabilities.find(
        (capability) => capability.id === "preview.contact_sheet",
      ),
    ).toMatchObject({
      available: true,
      metadata: {
        underlyingCapabilities: ["engine.mlt", "preview.frame"],
      },
    });
    expect(
      capabilities.find(
        (capability) => capability.id === "operation.preview.waveform",
      ),
    ).toMatchObject({
      available: false,
      reasonUnavailable: expect.stringContaining("preview.waveform"),
      metadata: { requiredCapabilities: ["preview.waveform"] },
    });
  });
});
