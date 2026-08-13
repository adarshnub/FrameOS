import { FrameOSError } from "./errors.js";
import { projectSchema, type Project } from "./project.js";

export const currentProjectSchemaVersion = "1.0.0" as const;

export const publishedProjectSchemaVersions = [
  currentProjectSchemaVersion,
] as const;

export type PublishedProjectSchemaVersion =
  (typeof publishedProjectSchemaVersions)[number];

function schemaVersionOf(document: unknown): string | undefined {
  if (
    document !== null &&
    typeof document === "object" &&
    "schemaVersion" in document
  ) {
    const version = (document as { schemaVersion?: unknown }).schemaVersion;
    return typeof version === "string" ? version : undefined;
  }
  return undefined;
}

export function migrateProjectDocument(document: unknown): Project {
  const version = schemaVersionOf(document);
  if (version === undefined) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Project document is missing schemaVersion",
      422,
    );
  }
  if (!version.startsWith("1.")) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Project schema ${version} is outside the supported 1.x compatibility line`,
      422,
    );
  }
  switch (version) {
    case "1.0.0":
      return projectSchema.parse(document);
    default:
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Project schema ${version} is not published by this FrameOS build`,
        422,
      );
  }
}
