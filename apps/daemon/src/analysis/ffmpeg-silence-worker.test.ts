import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analyzerWorkerEventSchema, createId } from "@frameos/contracts";
import { describe, expect, it } from "vitest";

const worker = fileURLToPath(
  new URL(
    "../../../../tools/analyzers/ffmpeg-silence-worker.mjs",
    import.meta.url,
  ),
);
const fakeFfmpeg = fileURLToPath(
  new URL("../../test-fixtures/fake-ffmpeg-silence.mjs", import.meta.url),
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

describe("FFmpeg silence protocol worker", () => {
  it("maps silencedetect output to rational-time analysis segments", async () => {
    const requestId = createId();
    const result = await execute({
      schemaVersion: "1.0.0",
      requestId,
      analyzerId: "ffmpeg.silence.detect",
      analyzerVersion: "1.0.0",
      asset: {
        id: createId(),
        name: "fixture.wav",
        kind: "audio",
        path: "fixture.wav",
        hash: "a".repeat(64),
        streams: [],
        semanticMetadata: {},
      },
      parameters: { noiseDb: -40, minDurationMs: 300 },
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
      outputType: "silence",
      segments: [
        {
          range: {
            start: { value: 500, rate: { numerator: 1_000, denominator: 1 } },
            duration: {
              value: 1_250,
              rate: { numerator: 1_000, denominator: 1 },
            },
          },
          labels: ["silence"],
          confidence: 1,
          metadata: { noiseDb: -40, measuredDurationMs: 1_250 },
        },
      ],
      metadata: {
        engine: "ffmpeg.silencedetect",
        noiseDb: -40,
        minDurationMs: 300,
      },
    });
  });
});
