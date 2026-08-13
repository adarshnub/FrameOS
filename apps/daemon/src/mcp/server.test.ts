import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DaemonConfig } from "../config.js";
import { createServices, type FrameOSServices } from "../services/services.js";
import { createMcpServer } from "./server.js";

describe("MCP surface", () => {
  let root: string;
  let services: FrameOSServices;
  let client: Client;
  let server: ReturnType<typeof createMcpServer>;

  beforeEach(async () => {
    root = await mkdtemp(resolve(tmpdir(), "frameos-mcp-test-"));
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
    server = createMcpServer(services);
    client = new Client(
      { name: "frameos-test-client", version: "0.1.0" },
      { capabilities: {} },
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    await services.close();
    await rm(root, { recursive: true, force: true });
  });

  it("discovers the compact stable tool set and returns structured results", async () => {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    expect(names).toContain("project.create");
    expect(names).toContain("operations.search");
    expect(names).toContain("transaction.commit");
    expect(names).toContain("preview.frame");
    expect(names).toContain("caption.import");
    expect(names).toContain("caption.export");
    expect(names).toContain("semantic.find");
    expect(names).toContain("semantic.remove_silences.plan");
    expect(names).toContain("asset.proxy.create");
    expect(names).toContain("asset.thumbnail.create");
    expect(names).toContain("semantic.make_vertical.plan");
    expect(names).toContain("semantic.match_cuts_to_music.plan");
    expect(names).toContain("semantic.add_dynamic_captions.plan");
    expect(names).toContain("semantic.create_highlight.plan");
    expect(names).toContain("semantic.sync_broll.plan");
    expect(names.length).toBeLessThanOrEqual(42);

    const created = await client.callTool({
      name: "project.create",
      arguments: { name: "MCP project" },
    });
    expect(created.isError).not.toBe(true);
    const structured = created.structuredContent as {
      result: { projectId: string };
    };
    const state = await client.readResource({
      uri: `frameos://projects/${structured.result.projectId}/timeline-map`,
    });
    const content = state.contents[0];
    expect(content?.mimeType).toBe("application/json");
    expect(
      content !== undefined && "text" in content
        ? JSON.parse(content.text).revision
        : undefined,
    ).toBe(0);
  });

  it("round-trips captions through structured MCP tools", async () => {
    const created = await client.callTool({
      name: "project.create",
      arguments: { name: "MCP captions" },
    });
    const project = (
      created.structuredContent as {
        result: {
          projectId: string;
          settings: { defaultSequenceId: string };
        };
      }
    ).result;
    const imported = await client.callTool({
      name: "caption.import",
      arguments: {
        projectId: project.projectId,
        sequenceId: project.settings.defaultSequenceId,
        baseRevision: 0,
        idempotencyKey: "mcp-caption-import-fixture",
        mode: "commit",
        format: "srt",
        content: "1\n00:00:00,000 --> 00:00:02,000\nCaption via MCP\n",
        name: "Agent captions",
        language: "en",
      },
    });
    expect(imported.isError).not.toBe(true);
    const captionTrackId = (
      imported.structuredContent as {
        result: { captionTrackId: string };
      }
    ).result.captionTrackId;

    const exported = await client.callTool({
      name: "caption.export",
      arguments: {
        projectId: project.projectId,
        sequenceId: project.settings.defaultSequenceId,
        captionTrackId,
        format: "vtt",
        revision: 1,
      },
    });
    expect(exported.isError).not.toBe(true);
    expect(
      (exported.structuredContent as { result: { content: string } }).result
        .content,
    ).toContain("Caption via MCP");
  });

  it("reports waveform availability through the capability catalog", async () => {
    expect(
      (await services.capabilities.listCapabilities("preview.waveform"))[0],
    ).toMatchObject({
      id: "preview.waveform",
      available: false,
      reasonUnavailable: expect.stringContaining("not configured"),
    });
  });
});
