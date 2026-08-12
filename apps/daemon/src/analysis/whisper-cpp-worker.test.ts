import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analyzerWorkerEventSchema, createId } from "@frameos/contracts";
import { describe, expect, it } from "vitest";

const worker = fileURLToPath(
  new URL(
    "../../../../tools/analyzers/whisper-cpp-worker.mjs",
    import.meta.url,
  ),
);
const fakeCli = fileURLToPath(
  new URL("../../test-fixtures/fake-whisper-cli.mjs", import.meta.url),
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

describe("whisper.cpp protocol worker", () => {
  it("maps upstream JSON offsets and token probabilities into FrameOS segments", async () => {
    const requestId = createId();
    const result = await execute({
      schemaVersion: "1.0.0",
      requestId,
      analyzerId: "whisper.cpp.transcribe",
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
      parameters: { language: "auto", threads: 2, noGpu: true },
      modelPath: "fixture-model.bin",
      resources: [
        {
          role: "whisper-cli",
          path: process.execPath,
          sha256: "b".repeat(64),
        },
        {
          role: "whisper-cli-entrypoint",
          path: fakeCli,
          sha256: "c".repeat(64),
        },
      ],
    });
    expect(result.code).toBe(0);
    const events = result.output
      .trim()
      .split("\n")
      .map((line) => analyzerWorkerEventSchema.parse(JSON.parse(line)));
    expect(events).toContainEqual(
      expect.objectContaining({ type: "progress", progress: 0.5 }),
    );
    expect(events.at(-1)).toMatchObject({
      requestId,
      type: "result",
      outputType: "transcript",
      segments: [
        {
          range: {
            start: { value: 0, rate: { numerator: 1_000, denominator: 1 } },
            duration: {
              value: 1_250,
              rate: { numerator: 1_000, denominator: 1 },
            },
          },
          text: " FrameOS transcript",
          labels: ["speech"],
          confidence: 0.85,
          metadata: {
            words: [
              expect.objectContaining({ text: " FrameOS", confidence: 0.9 }),
              expect.objectContaining({ text: " transcript", confidence: 0.8 }),
            ],
          },
        },
      ],
      metadata: {
        language: "en",
        translated: false,
        engine: "whisper.cpp",
        wordTimestamps: true,
      },
    });
  });

  it("fails closed when the pinned CLI resource is absent", async () => {
    const result = await execute({
      schemaVersion: "1.0.0",
      requestId: createId(),
      parameters: {},
      asset: { path: "fixture.wav" },
      modelPath: "fixture-model.bin",
      resources: [],
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain("Required whisper-cli resource");
  });
});
