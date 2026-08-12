import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { FrameOSError, frameTime, type CaptionTrack } from "@frameos/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DaemonConfig } from "../config.js";
import { createProject } from "../domain/project-factory.js";
import { createServices, type FrameOSServices } from "../services/services.js";
import { parseCaptionDocument, serializeCaptionTrack } from "./captions.js";

describe("caption interchange", () => {
  let root: string;
  let services: FrameOSServices;

  beforeEach(async () => {
    root = await mkdtemp(resolve(tmpdir(), "frameos-caption-test-"));
    const config: DaemonConfig = {
      host: "127.0.0.1",
      port: 31_415,
      dataDirectory: resolve(root, "data"),
      authToken: "test-token-that-is-longer-than-thirty-two-characters",
      authTokenPath: resolve(root, "auth-token"),
      allowedMediaRoots: [root],
      remoteMode: false,
    };
    services = await createServices(config);
  });

  afterEach(async () => {
    await services.close();
    await rm(root, { recursive: true, force: true });
  });

  it("parses SRT and WebVTT cues without flattening multiline text", () => {
    const srt = parseCaptionDocument(
      "1\r\n00:00:01,250 --> 00:00:03,000\r\nHello\r\nworld\r\n",
      "srt",
    );
    expect(srt.cues).toHaveLength(1);
    expect(srt.cues[0]?.range.start.value).toBe(1_250);
    expect(srt.cues[0]?.text).toBe("Hello\nworld");

    const vtt = parseCaptionDocument(
      "WEBVTT\n\nNOTE generated fixture\nignored\n\nintro\n00:01.000 --> 00:02.500 align:start\nHello agent\n",
      "vtt",
    );
    expect(vtt.cues[0]?.text).toBe("Hello agent");
    expect(vtt.cues[0]?.style).toMatchObject({
      "frameos:caption-interchange": {
        identifier: "intro",
        settings: "align:start",
      },
    });
    expect(vtt.warnings.map((warning) => warning.code)).toEqual([
      "IGNORED_BLOCK",
      "CUE_SETTING_PRESERVED",
    ]);
  });

  it("rejects malformed timing instead of silently dropping a cue", () => {
    expect(() =>
      parseCaptionDocument("WEBVTT\n\n00:bogus --> 00:02.000\nBroken\n", "vtt"),
    ).toThrowError(FrameOSError);
  });

  it("serializes canonical rational time and reports millisecond/style loss", () => {
    const track: CaptionTrack = {
      id: "01999999-9999-7999-8999-999999999999",
      name: "Captions",
      language: "en",
      enabled: true,
      style: { fontFamily: "Inter" },
      cues: [
        {
          id: "01999999-9999-7999-8999-999999999998",
          range: {
            start: frameTime(1, { numerator: 24, denominator: 1 }),
            duration: frameTime(24, { numerator: 24, denominator: 1 }),
          },
          text: "Frame accurate",
          words: [],
          style: { color: "white" },
        },
      ],
    };
    const result = serializeCaptionTrack(track, "srt");
    expect(result.content).toContain(
      "00:00:00,042 --> 00:00:01,042\nFrame accurate",
    );
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "STYLE_NOT_EXPORTED",
      "TIMING_ROUNDED",
      "STYLE_NOT_EXPORTED",
    ]);
  });

  it("imports through one reversible transaction and exports a pinned revision", async () => {
    const project = createProject({ name: "Caption transaction" });
    await services.projects.create(project);
    const sequenceId = project.settings.defaultSequenceId;
    const request = {
      projectId: project.projectId,
      sequenceId,
      baseRevision: 0,
      idempotencyKey: "caption-import-idempotency-fixture",
      mode: "commit" as const,
      format: "srt" as const,
      content:
        "1\n00:00:00,000 --> 00:00:01,500\nFirst line\n\n2\n00:00:02,000 --> 00:00:03,000\nSecond line\n",
      name: "English subtitles",
      language: "en",
      enabled: true,
      style: {},
    };
    const imported = await services.captions.import(request);
    expect(imported.cueCount).toBe(2);
    expect(imported.transaction.resultingRevision).toBe(1);

    const retried = await services.captions.import(request);
    expect(retried.captionTrackId).toBe(imported.captionTrackId);
    expect(retried.transaction.transactionId).toBe(
      imported.transaction.transactionId,
    );

    const exported = await services.captions.export({
      projectId: project.projectId,
      sequenceId,
      captionTrackId: imported.captionTrackId,
      format: "vtt",
      revision: 1,
    });
    expect(exported.revision).toBe(1);
    expect(exported.content).toContain("WEBVTT\n\n");
    expect(exported.content).toContain("Second line");

    await services.transactions.undo(
      project.projectId,
      "caption-import-undo-idempotency",
    );
    const undone = await services.projects.load(project.projectId);
    expect(undone.sequences[sequenceId]?.captions).toEqual([]);
  });
});
