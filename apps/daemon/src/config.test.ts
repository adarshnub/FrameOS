import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("daemon configuration", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function dataDirectory(): Promise<string> {
    const root = await mkdtemp(resolve(tmpdir(), "frameos-config-test-"));
    roots.push(root);
    return root;
  }

  it("refuses remote mode without scoped tokens even when TLS is configured", async () => {
    await expect(
      loadConfig({
        FRAMEOS_DATA_DIR: await dataDirectory(),
        FRAMEOS_HOST: "0.0.0.0",
        FRAMEOS_TLS_CERT: "server.crt",
        FRAMEOS_TLS_KEY: "server.key",
      }),
    ).rejects.toThrow("FRAMEOS_SCOPED_TOKENS");
  });

  it("parses named least-privilege remote tokens", async () => {
    const config = await loadConfig({
      FRAMEOS_DATA_DIR: await dataDirectory(),
      FRAMEOS_HOST: "0.0.0.0",
      FRAMEOS_TLS_CERT: "server.crt",
      FRAMEOS_TLS_KEY: "server.key",
      FRAMEOS_SCOPED_TOKENS: JSON.stringify([
        {
          id: "render-node",
          token: "a-remote-secret-that-is-at-least-thirty-two-characters",
          scopes: ["project:read", "render:write"],
        },
      ]),
    });
    expect(config.remoteMode).toBe(true);
    expect(config.scopedTokens).toEqual([
      {
        id: "render-node",
        token: "a-remote-secret-that-is-at-least-thirty-two-characters",
        scopes: ["project:read", "render:write"],
      },
    ]);
  });

  it("resolves explicitly configured analyzer manifests", async () => {
    const root = await dataDirectory();
    const config = await loadConfig({
      FRAMEOS_DATA_DIR: root,
      FRAMEOS_ANALYZER_MANIFESTS: [
        "plugins/whisper.json",
        "plugins/onnx.json",
      ].join(";"),
    });
    expect(config.analyzerManifestPaths).toEqual([
      resolve("plugins/whisper.json"),
      resolve("plugins/onnx.json"),
    ]);
  });
});
