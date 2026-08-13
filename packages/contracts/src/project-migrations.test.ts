import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  currentProjectSchemaVersion,
  migrateProjectDocument,
  publishedProjectSchemaVersions,
} from "./project-migrations.js";

describe("project schema migrations", () => {
  it("opens one fixture for every published 1.x project schema version", async () => {
    for (const version of publishedProjectSchemaVersions) {
      const fixturePath = resolve(
        "fixtures",
        "projects",
        version,
        "minimal.project.frameos.json",
      );
      const raw = JSON.parse(await readFile(fixturePath, "utf8")) as unknown;
      const migrated = migrateProjectDocument(raw);
      expect(migrated.schemaVersion).toBe(currentProjectSchemaVersion);
      expect(migrated.projectId).toBe("018f6f3a-1d3b-7000-8000-000000000001");
      expect(
        migrated.sequences[migrated.settings.defaultSequenceId],
      ).toBeDefined();
    }
  });

  it("rejects project documents outside the published compatibility line", () => {
    expect(() => migrateProjectDocument({ schemaVersion: "2.0.0" })).toThrow(
      /outside the supported 1\.x/u,
    );
    expect(() => migrateProjectDocument({ schemaVersion: "1.99.0" })).toThrow(
      /not published/u,
    );
    expect(() => migrateProjectDocument({})).toThrow(/missing schemaVersion/u);
  });
});
