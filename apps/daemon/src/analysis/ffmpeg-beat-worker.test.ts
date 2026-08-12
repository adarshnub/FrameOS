import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analyzerWorkerEventSchema, createId } from "@frameos/contracts";
import { describe, expect, it } from "vitest";

const worker = fileURLToPath(
  new URL(
    "../../../../tools/analyzers/ffmpeg-beat-worker.mjs",
    import.meta.url,
  ),
);
const fakeFfmpeg = fileURLToPath(
  new URL("../../test-fixtures/fake-ffmpeg-beats.mjs", import.meta.url),
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

describe("FFmpeg beat protocol worker", () => {
  it("maps deterministic PCM energy onsets to beat marker ranges", async () => {
    const requestId = createId();
    const result = await execute({
      schemaVersion: "1.0.0",
      requestId,
      analyzerId: "ffmpeg.beats.detect",
      analyzerVersion: "1.0.0",
      asset: {
        id: createId(),
        name: "fixture.wav",
        kind: "audio",
        path: "fixture.wav",
        hash: "a".repeat(64),
        streams: [],
        duration: {
          value: 4_000,
          rate: { numerator: 1_000, denominator: 1 },
        },
        semanticMetadata: {},
      },
      parameters: {
        sensitivity: 0.5,
        minIntervalMs: 500,
        windowMs: 100,
      },
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
      outputType: "beats",
      segments: [
        {
          range: { start: { value: 1_000 }, duration: { value: 100 } },
          labels: ["beat", "onset"],
          metadata: { index: 0, sampleRate: 8_000, windowMs: 100 },
        },
        {
          range: { start: { value: 2_000 }, duration: { value: 100 } },
          metadata: { index: 1 },
        },
        {
          range: { start: { value: 3_000 }, duration: { value: 100 } },
          metadata: { index: 2 },
        },
      ],
      metadata: {
        engine: "frameos.energy-flux-onset-v1",
        pcmDecoder: "ffmpeg.pcm_f32le",
        sampleRate: 8_000,
        windowMs: 100,
        minIntervalMs: 500,
        sensitivity: 0.5,
        estimatedBpm: 60,
      },
    });
  });
});
