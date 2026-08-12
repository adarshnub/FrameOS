import { describe, expect, it } from "vitest";
import { previewArtifactSchema, previewRequestSchema } from "./previews.js";

describe("preview contracts", () => {
  it("applies bounded preview defaults", () => {
    const request = previewRequestSchema.parse({
      projectId: "018f47b1-8f5c-7ca4-9f30-123456789abc",
      source: { type: "revision", revision: 4 },
      kind: "frame",
      at: { value: 100, rate: { numerator: 30_000, denominator: 1_001 } },
    });
    expect(request).toMatchObject({ maxWidth: 960, maxHeight: 540 });
  });

  it("validates artifact entries and rejects local-path-only results", () => {
    expect(() =>
      previewArtifactSchema.parse({
        kind: "frame",
        width: 640,
        height: 360,
        entries: [{ path: "C:/private/frame.png" }],
        provenanceUri: "/api/v1/jobs/example/artifacts/provenance.json",
      }),
    ).toThrow();
  });
});
