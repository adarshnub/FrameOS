import { realpath } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FrameOSError,
  type Operation,
  type TransactionRequest,
} from "@frameos/contracts";

function hasScheme(value: string): boolean {
  return !isAbsolute(value) && /^[a-z][a-z0-9+.-]*:/iu.test(value);
}

export class MediaPolicy {
  private canonicalRoots: string[] = [];

  public constructor(private readonly roots: string[]) {}

  public async initialize(): Promise<void> {
    this.canonicalRoots = await Promise.all(
      this.roots.map(async (root) => realpath(resolve(root))),
    );
  }

  private async assertAllowedUri(uri: string): Promise<void> {
    if (uri.startsWith("frameos:")) {
      return;
    }
    if (hasScheme(uri) && !uri.startsWith("file:")) {
      throw new FrameOSError(
        "FORBIDDEN",
        "Remote media URLs are disabled; import through an approved downloader",
        403,
      );
    }
    const path = uri.startsWith("file:") ? fileURLToPath(uri) : uri;
    if (!isAbsolute(path)) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "External media paths must be absolute",
        422,
      );
    }
    let canonical: string;
    try {
      canonical = await realpath(path);
    } catch {
      throw new FrameOSError(
        "MEDIA_OFFLINE",
        "Media file does not exist or cannot be accessed",
        422,
      );
    }
    const allowed = this.canonicalRoots.some(
      (root) => canonical === root || canonical.startsWith(`${root}${sep}`),
    );
    if (!allowed) {
      throw new FrameOSError(
        "FORBIDDEN",
        "Media path is outside the configured media roots",
        403,
      );
    }
  }

  public async validateUris(uris: Iterable<string>): Promise<void> {
    for (const uri of uris) await this.assertAllowedUri(uri);
  }

  private operationUri(operation: Operation): string | undefined {
    if (operation.type === "asset.add") return operation.arguments.asset.uri;
    if (operation.type === "asset.relink") return operation.arguments.uri;
    if (operation.type === "asset.proxy.create") return operation.arguments.uri;
    return undefined;
  }

  private assertOwnedProjectUri(projectId: string, uri: string): void {
    if (!uri.startsWith("frameos:")) return;
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Managed media URI is invalid",
        422,
      );
    }
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (
      parsed.protocol !== "frameos:" ||
      parsed.hostname !== "projects" ||
      segments[0] !== projectId
    ) {
      throw new FrameOSError(
        "FORBIDDEN",
        "Managed media URI belongs to another project",
        403,
      );
    }
  }

  public async validateTransaction(request: TransactionRequest): Promise<void> {
    for (const operation of request.operations) {
      const uri = this.operationUri(operation);
      if (uri !== undefined) {
        this.assertOwnedProjectUri(request.projectId, uri);
        await this.validateUris([uri]);
      }
    }
  }
}
