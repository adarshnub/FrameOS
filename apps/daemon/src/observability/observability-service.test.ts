import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ObservabilityService } from "./observability-service.js";

describe("observability service", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it("persists structured logs and recursively redacts secrets", async () => {
    root = await mkdtemp(resolve(tmpdir(), "frameos-logs-test-"));
    const service = new ObservabilityService(root);
    await service.initialize();
    service.record({
      level: "success",
      category: "agent",
      eventType: "agent.provider.request.completed",
      message: "Provider call completed",
      data: { usage: { totalTokens: 12 }, apiKey: "must-not-leak" },
    });
    await service.close();

    expect(service.list()[0]).toMatchObject({
      level: "success",
      data: { usage: { totalTokens: 12 }, apiKey: "[REDACTED]" },
    });
    const persisted = await readFile(
      resolve(root, "logs", "frameos.ndjson"),
      "utf8",
    );
    expect(persisted).not.toContain("must-not-leak");
  });
});
