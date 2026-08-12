import { describe, expect, it } from "vitest";
import {
  captionExportRequestSchema,
  captionImportRequestSchema,
} from "./captions.js";

describe("caption interchange contracts", () => {
  it("applies explicit safe defaults at the API boundary", () => {
    const parsed = captionImportRequestSchema.parse({
      projectId: "01999999-9999-7999-8999-999999999999",
      sequenceId: "01999999-9999-7999-8999-999999999998",
      baseRevision: 0,
      idempotencyKey: "caption-contract-fixture",
      format: "srt",
      content: "1\n00:00:00,000 --> 00:00:01,000\nHello\n",
    });
    expect(parsed).toMatchObject({
      mode: "commit",
      name: "Imported captions",
      language: "und",
      enabled: true,
      style: {},
    });
  });

  it("requires a concrete sequence and caption track for export", () => {
    expect(() =>
      captionExportRequestSchema.parse({
        projectId: "01999999-9999-7999-8999-999999999999",
        sequenceId: "not-a-uuid",
        captionTrackId: "01999999-9999-7999-8999-999999999997",
        format: "vtt",
      }),
    ).toThrow();
  });
});
