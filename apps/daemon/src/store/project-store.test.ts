import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectStore } from "./project-store.js";

describe("project store migrations", () => {
  let root: string;
  let store: ProjectStore;

  beforeEach(async () => {
    root = await mkdtemp(resolve(tmpdir(), "frameos-store-migration-test-"));
    store = new ProjectStore(resolve(root, "data"));
    await store.initialize();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("opens a published 1.x project fixture through the authoritative store path", async () => {
    const fixturePath = resolve(
      "..",
      "..",
      "packages",
      "contracts",
      "fixtures",
      "projects",
      "1.0.0",
      "minimal.project.frameos.json",
    );
    const raw = await readFile(fixturePath, "utf8");
    const fixture = JSON.parse(raw) as { projectId: string };
    const projectDirectory = resolve(
      root,
      "data",
      "projects",
      fixture.projectId,
    );
    await mkdir(resolve(projectDirectory, "history", "revisions"), {
      recursive: true,
    });
    await writeFile(resolve(projectDirectory, "project.frameos.json"), raw);
    await writeFile(
      resolve(projectDirectory, "history", "revisions", "0.json"),
      raw,
    );

    const loaded = await store.load(fixture.projectId);
    const revision = await store.loadRevision(fixture.projectId, 0);
    expect(loaded.schemaVersion).toBe("1.0.0");
    expect(revision).toEqual(loaded);
    expect(loaded.sequences[loaded.settings.defaultSequenceId]).toBeDefined();
  });
});
