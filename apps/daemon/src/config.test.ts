import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

  it("allows a Docker-local wildcard bind without remote TLS requirements", async () => {
    const config = await loadConfig({
      FRAMEOS_DATA_DIR: await dataDirectory(),
      FRAMEOS_HOST: "0.0.0.0",
      FRAMEOS_DOCKER_LOCAL_ONLY: "true",
    });

    expect(config.remoteMode).toBe(false);
  });

  it("limits Docker-local mode to the wildcard bind used by Compose", async () => {
    await expect(
      loadConfig({
        FRAMEOS_DATA_DIR: await dataDirectory(),
        FRAMEOS_HOST: "192.168.1.10",
        FRAMEOS_DOCKER_LOCAL_ONLY: "true",
      }),
    ).rejects.toThrow("FRAMEOS_DOCKER_LOCAL_ONLY requires FRAMEOS_HOST=0.0.0.0");
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
      resolve(config.workspaceRoot!, "plugins/whisper.json"),
      resolve(config.workspaceRoot!, "plugins/onnx.json"),
    ]);
  });

  it("loads FRAMEOS settings from dotenv without overriding process values", async () => {
    const root = await dataDirectory();
    const environmentPath = resolve(root, ".env");
    await writeFile(
      environmentPath,
      [
        `FRAMEOS_DATA_DIR=${resolve(root, "dotenv-data")}`,
        "FRAMEOS_PORT=32001",
        "FRAMEOS_OPENAI_MODEL=gpt-4.1-mini",
        "UNRELATED_VALUE=ignored",
      ].join("\n"),
      "utf8",
    );
    const environment: NodeJS.ProcessEnv = {
      FRAMEOS_ENV_FILE: environmentPath,
      FRAMEOS_PORT: "32002",
    };
    const config = await loadConfig(environment);

    expect(config.port).toBe(32_002);
    expect(config.environmentFilePath).toBe(environmentPath);
    expect(environment.FRAMEOS_OPENAI_MODEL).toBe("gpt-4.1-mini");
    expect(environment.UNRELATED_VALUE).toBeUndefined();
  });
});
