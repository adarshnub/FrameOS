import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createId, frameTime, type Asset, type Clip } from "@frameos/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MediaPolicy } from "../security/media-policy.js";
import { ProjectStore } from "../store/project-store.js";
import { createProject } from "./project-factory.js";
import { TransactionEngine } from "./transaction-engine.js";

describe("transaction engine", () => {
  let root: string;
  let mediaPath: string;
  let store: ProjectStore;
  let engine: TransactionEngine;

  beforeEach(async () => {
    root = await mkdtemp(resolve(tmpdir(), "frameos-test-"));
    const mediaRoot = resolve(root, "media");
    await mkdir(mediaRoot);
    mediaPath = resolve(mediaRoot, "sample.mp4");
    await writeFile(mediaPath, "fixture");
    store = new ProjectStore(resolve(root, "data"));
    await store.initialize();
    const policy = new MediaPolicy([mediaRoot]);
    await policy.initialize();
    engine = new TransactionEngine(store, policy);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function fixtureAsset(): Asset {
    return {
      id: createId(),
      name: "sample.mp4",
      kind: "video",
      uri: pathToFileURL(mediaPath).href,
      hash: "0123456789abcdef0123456789abcdef",
      managed: false,
      streams: [],
      duration: frameTime(300, { numerator: 30, denominator: 1 }),
      proxies: [],
      analysisRefs: [],
      licenseMetadata: {},
      semanticMetadata: {},
    };
  }

  it("commits atomically, persists history, and returns idempotent results", async () => {
    const project = await store.create(createProject({ name: "Atomic edit" }));
    const sequence = project.sequences[project.settings.defaultSequenceId];
    expect(sequence).toBeDefined();
    const track = sequence?.tracks.find(
      (candidate) => candidate.kind === "video",
    );
    expect(track).toBeDefined();
    const asset = fixtureAsset();
    const clip: Clip = {
      id: createId(),
      name: "Interview",
      type: "clip",
      assetId: asset.id,
      sourceRange: {
        start: frameTime(0, sequence!.format.frameRate),
        duration: frameTime(120, sequence!.format.frameRate),
      },
      timelineRange: {
        start: frameTime(0, sequence!.format.frameRate),
        duration: frameTime(120, sequence!.format.frameRate),
      },
      enabled: true,
      locked: false,
      metadata: {},
      transform: {
        positionX: 0,
        positionY: 0,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        opacity: 1,
        cropTop: 0,
        cropRight: 0,
        cropBottom: 0,
        cropLeft: 0,
        blendMode: "normal",
      },
      timeMap: [],
      effects: [],
      audio: { gainDb: 0, pan: 0, muted: false, channelMap: [] },
      links: [],
      semanticMetadata: {},
    };
    const request = {
      projectId: project.projectId,
      baseRevision: 0,
      idempotencyKey: "atomic-add-asset-and-clip",
      mode: "commit" as const,
      operations: [
        {
          operationId: createId(),
          type: "asset.add" as const,
          preconditions: [],
          arguments: { asset },
        },
        {
          operationId: createId(),
          type: "item.add" as const,
          preconditions: [],
          arguments: {
            sequenceId: sequence!.id,
            trackId: track!.id,
            item: clip,
          },
        },
      ],
    };
    const first = await engine.execute(request);
    const second = await engine.execute(request);
    expect(first.resultingRevision).toBe(1);
    expect(second.transactionId).toBe(first.transactionId);
    const stored = await store.load(project.projectId);
    expect(stored.assets[asset.id]?.name).toBe("sample.mp4");
    expect(
      stored.sequences[sequence!.id]?.tracks.find(
        (candidate) => candidate.id === track!.id,
      )?.items,
    ).toHaveLength(1);
    expect(await store.history(project.projectId)).toHaveLength(1);
  });

  it("rejects stale revisions without partial mutation", async () => {
    const project = await store.create(createProject({ name: "Conflict" }));
    await engine.execute({
      projectId: project.projectId,
      baseRevision: 0,
      idempotencyKey: "first-metadata-edit",
      mode: "commit",
      operations: [
        {
          operationId: createId(),
          type: "project.metadata.set",
          preconditions: [],
          arguments: { values: { first: true } },
        },
      ],
    });
    await expect(
      engine.execute({
        projectId: project.projectId,
        baseRevision: 0,
        idempotencyKey: "stale-metadata-edit",
        mode: "commit",
        operations: [
          {
            operationId: createId(),
            type: "project.metadata.set",
            preconditions: [],
            arguments: { values: { stale: true } },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect((await store.load(project.projectId)).metadata).toEqual({
      first: true,
    });
  });

  it("rejects managed proxy references owned by another project", async () => {
    const project = await store.create(
      createProject({ name: "Managed URI ownership" }),
    );
    const otherProjectId = createId();
    await expect(
      engine.execute({
        projectId: project.projectId,
        baseRevision: 0,
        idempotencyKey: "cross-project-proxy-reference",
        mode: "commit",
        operations: [
          {
            operationId: createId(),
            type: "asset.proxy.create",
            targetId: createId(),
            preconditions: [],
            arguments: {
              uri: `frameos://projects/${otherProjectId}/assets/${createId()}-proxy-0123456789abcdef.mp4`,
            },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
  });

  it("keeps preview drafts isolated until explicitly committed", async () => {
    const project = await store.create(createProject({ name: "Preview" }));
    const preview = await engine.execute({
      projectId: project.projectId,
      baseRevision: 0,
      idempotencyKey: "preview-metadata-edit",
      mode: "preview",
      operations: [
        {
          operationId: createId(),
          type: "project.metadata.set",
          preconditions: [],
          arguments: { values: { draft: true } },
        },
      ],
    });
    expect((await store.load(project.projectId)).revision).toBe(0);
    expect(preview.draftId).toBeDefined();
    const committed = await engine.commitDraft(
      project.projectId,
      preview.draftId!,
    );
    expect(committed.resultingRevision).toBe(1);
    expect((await store.load(project.projectId)).metadata).toEqual({
      draft: true,
    });
  });

  it("blocks media outside configured roots", async () => {
    const project = await store.create(createProject({ name: "Media policy" }));
    const forbiddenPath = resolve(root, "outside.mp4");
    await writeFile(forbiddenPath, "fixture");
    const asset = fixtureAsset();
    asset.uri = pathToFileURL(forbiddenPath).href;
    await expect(
      engine.execute({
        projectId: project.projectId,
        baseRevision: 0,
        idempotencyKey: "forbidden-asset-import",
        mode: "commit",
        operations: [
          {
            operationId: createId(),
            type: "asset.add",
            preconditions: [],
            arguments: { asset },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("restores exact state through undo and reapplies the original transaction through redo", async () => {
    const project = await store.create(createProject({ name: "Undo redo" }));
    await engine.execute({
      projectId: project.projectId,
      baseRevision: 0,
      idempotencyKey: "metadata-to-redo",
      mode: "commit",
      operations: [
        {
          operationId: createId(),
          type: "project.metadata.set",
          preconditions: [],
          arguments: { values: { take: "B" } },
        },
      ],
    });
    const undone = await engine.undo(
      project.projectId,
      "undo-metadata-transaction",
    );
    expect(undone.resultingRevision).toBe(2);
    expect((await store.load(project.projectId)).metadata).toEqual({});
    const redone = await engine.redo(
      project.projectId,
      "redo-metadata-transaction",
    );
    expect(redone.resultingRevision).toBe(3);
    expect((await store.load(project.projectId)).metadata).toEqual({
      take: "B",
    });
  });

  it("finishes a transaction interrupted after its revision snapshot was written", async () => {
    const project = await store.create(createProject({ name: "Recovery" }));
    await engine.execute({
      projectId: project.projectId,
      baseRevision: 0,
      idempotencyKey: "recover-this-commit",
      mode: "commit",
      operations: [
        {
          operationId: createId(),
          type: "project.metadata.set",
          preconditions: [],
          arguments: { values: { recovered: true } },
        },
      ],
    });
    const record = (await store.history(project.projectId))[0]!;
    const revisionZero = await store.loadRevision(project.projectId, 0);
    const projectDirectory = resolve(
      root,
      "data",
      "projects",
      project.projectId,
    );
    await writeFile(
      resolve(projectDirectory, "project.frameos.json"),
      `${JSON.stringify(revisionZero, null, 2)}\n`,
    );
    await writeFile(
      resolve(projectDirectory, "history", "operations.ndjson"),
      "",
    );
    await writeFile(
      resolve(projectDirectory, "history", "pending-transaction.json"),
      `${JSON.stringify(record, null, 2)}\n`,
    );
    const recovered = await store.load(project.projectId);
    expect(recovered.revision).toBe(1);
    expect(recovered.metadata).toEqual({ recovered: true });
    expect(await store.history(project.projectId)).toHaveLength(1);
  });

  it("forks any immutable revision into an independent project bundle", async () => {
    const project = await store.create(createProject({ name: "Source" }));
    const fork = await store.fork(project.projectId, 0, "Alternative cut");
    expect(fork.projectId).not.toBe(project.projectId);
    expect(fork.revision).toBe(0);
    expect(fork.settings.name).toBe("Alternative cut");
    expect(fork.metadata.forkedFrom).toEqual({
      projectId: project.projectId,
      revision: 0,
    });
  });
});
