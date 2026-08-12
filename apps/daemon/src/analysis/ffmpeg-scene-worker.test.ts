import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analyzerWorkerEventSchema, createId } from "@frameos/contracts";
import { describe, expect, it } from "vitest";

const worker = fileURLToPath(
  new URL(
    "../../../../tools/analyzers/ffmpeg-scene-worker.mjs",
    import.meta.url,
  ),
);
const fakeFfmpeg = fileURLToPath(
  new URL("../../test-fixtures/fake-ffmpeg-scene.mjs", import.meta.url),
);

function execute(
  request: object,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, output }));
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

describe("FFmpeg scene protocol worker", () => {
  it("maps scene-selected frames into contiguous rational-time ranges", async () => {
    const requestId = createId();
    const result = await execute({
      schemaVersion: "1.0.0",
      requestId,
      analyzerId: "ffmpeg.scene.detect",
      analyzerVersion: "1.0.0",
      asset: {
        id: createId(),
        name: "fixture.mp4",
        kind: "video",
        path: "fixture.mp4",
        hash: "a".repeat(64),
        streams: [],
        duration: {
          value: 10_000,
          rate: { numerator: 1_000, denominator: 1 },
        },
        semanticMetadata: {},
      },
      parameters: { threshold: 0.4, minSceneDurationMs: 500 },
      resources: [
        {
          role: "ffmpeg",
          path: process.execPath,
          sha256: "b".repeat(64),
        },
        {
          role: "ffmpeg-entrypoint",
          path: fakeFfmpeg,
          sha256: "c".repeat(64),
        },
      ],
    });
    expect(result.code).toBe(0);
    const events = result.output
      .trim()
      .split("\n")
      .map((line) => analyzerWorkerEventSchema.parse(JSON.parse(line)));
    expect(events.at(-1)).toMatchObject({
      requestId,
      type: "result",
      outputType: "scenes",
      segments: [
        {
          range: {
            start: { value: 0 },
            duration: { value: 3_000 },
          },
          labels: ["scene", "shot"],
          metadata: { index: 0, threshold: 0.4 },
        },
        {
          range: {
            start: { value: 3_000 },
            duration: { value: 4_200 },
          },
        },
        {
          range: {
            start: { value: 7_200 },
            duration: { value: 2_800 },
          },
        },
      ],
      metadata: {
        engine: "ffmpeg.select.scene+showinfo",
        threshold: 0.4,
        minSceneDurationMs: 500,
        detectedBoundaryCount: 2,
      },
    });
  });
});
