import { describe, expect, it } from "vitest";
import {
  analysisSearchRequestSchema,
  analysisSegmentSchema,
  analyzerPluginManifestSchema,
  analyzerWorkerEventSchema,
  createId,
} from "./index.js";

describe("analysis contracts", () => {
  it("requires an external query embedding for semantic search", () => {
    const request = {
      projectId: createId(),
      query: "speaker quote",
      mode: "semantic",
      limit: 20,
    };
    expect(analysisSearchRequestSchema.safeParse(request).success).toBe(false);
    expect(
      analysisSearchRequestSchema.parse({
        ...request,
        queryEmbedding: [0.25, -0.5, 0.75],
      }).queryEmbedding,
    ).toEqual([0.25, -0.5, 0.75]);
  });

  it("rejects empty analysis segments that cannot be searched or evaluated", () => {
    expect(
      analysisSegmentSchema.safeParse({
        id: createId(),
        labels: [],
        metadata: {},
      }).success,
    ).toBe(false);
  });

  it("defines hash-pinned analyzer manifests and bounded worker events", () => {
    const manifest = analyzerPluginManifestSchema.parse({
      schemaVersion: "1.0.0",
      protocolVersion: "1.0.0",
      id: "whisper.cpp.transcribe",
      version: "1.0.0",
      capabilityId: "analysis.transcription.whisper",
      name: "Transcription",
      description: "Audited local transcription worker",
      outputTypes: ["transcript"],
      assetKinds: ["audio", "video"],
      deterministic: false,
      executable: {
        path: "bin/analyzer",
        sha256: "a".repeat(64),
        version: "1.0.0",
        license: "MIT",
      },
      model: {
        path: "models/model.bin",
        sha256: "b".repeat(64),
        version: "tiny",
        license: "model-license",
      },
    });
    expect(manifest.limits).toMatchObject({
      timeoutMs: 30 * 60 * 1_000,
      maxOutputBytes: 64 * 1_024 * 1_024,
      maxSegments: 250_000,
    });
    expect(
      analyzerPluginManifestSchema.safeParse({
        ...manifest,
        executable: { ...manifest.executable, sha256: "not-a-hash" },
      }).success,
    ).toBe(false);
    expect(
      analyzerPluginManifestSchema.safeParse({
        ...manifest,
        resources: [
          {
            path: "one",
            sha256: "c".repeat(64),
            role: "runtime",
            license: "MIT",
          },
          {
            path: "two",
            sha256: "d".repeat(64),
            role: "runtime",
            license: "MIT",
          },
        ],
      }).success,
    ).toBe(false);

    const event = analyzerWorkerEventSchema.parse({
      schemaVersion: "1.0.0",
      requestId: createId(),
      type: "result",
      outputType: "transcript",
      segments: [{ text: "hello" }],
    });
    expect(
      event.type === "result" ? event.segments[0] : undefined,
    ).toMatchObject({ text: "hello", labels: [], metadata: {} });
  });
});
