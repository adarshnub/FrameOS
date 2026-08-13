import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import {
  analysisDocumentSchema,
  FrameOSError,
  createId,
  isEntityId,
  migrateProjectDocument,
  projectSchema,
  transactionRequestSchema,
  transactionResultSchema,
  type Operation,
  type AnalysisDocument,
  type Project,
  type TransactionRequest,
  type TransactionResult,
} from "@frameos/contracts";

export interface StoredTransactionRecord {
  transactionId: string;
  committedAt: string;
  idempotencyKey: string;
  request: TransactionRequest;
  result: TransactionResult;
  inverseOperations: Operation[];
}

export interface DraftRecord {
  draftId: string;
  createdAt: string;
  expiresAt: string;
  request: TransactionRequest;
  result: TransactionResult;
  project: Project;
  inverseOperations: Operation[];
}

function parseJson<T>(raw: string, context: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new FrameOSError(
      "INTERNAL_ERROR",
      `Stored ${context} is invalid JSON`,
      500,
    );
  }
}

export class ProjectStore {
  private readonly projectsDirectory: string;
  private readonly locks = new Map<string, Promise<void>>();

  public constructor(private readonly dataDirectory: string) {
    this.projectsDirectory = resolve(dataDirectory, "projects");
  }

  public async initialize(): Promise<void> {
    await mkdir(this.projectsDirectory, { recursive: true });
  }

  private projectDirectory(projectId: string): string {
    if (!isEntityId(projectId)) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Project id must be a UUID",
        422,
      );
    }
    const directory = resolve(this.projectsDirectory, projectId);
    if (!directory.startsWith(`${this.projectsDirectory}${sep}`)) {
      throw new FrameOSError(
        "FORBIDDEN",
        "Project path escaped the data directory",
        403,
      );
    }
    return directory;
  }

  private async atomicWrite(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${createId()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, path);
  }

  public async withProjectLock<T>(
    projectId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(projectId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const queued = previous.then(() => gate);
    this.locks.set(projectId, queued);
    await previous;
    try {
      return await action();
    } finally {
      release?.();
      if (this.locks.get(projectId) === queued) {
        this.locks.delete(projectId);
      }
    }
  }

  public async create(project: Project): Promise<Project> {
    const parsed = projectSchema.parse(project);
    const directory = this.projectDirectory(parsed.projectId);
    try {
      await mkdir(directory, { recursive: false });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Project ${parsed.projectId} already exists`,
          409,
        );
      }
      throw error;
    }
    await mkdir(resolve(directory, "history", "revisions"), {
      recursive: true,
    });
    await mkdir(resolve(directory, "drafts"), { recursive: true });
    await mkdir(resolve(directory, "assets"), { recursive: true });
    await mkdir(resolve(directory, "analysis"), { recursive: true });
    await mkdir(resolve(directory, "proxies"), { recursive: true });
    await mkdir(resolve(directory, "cache"), { recursive: true });
    await this.atomicWrite(resolve(directory, "project.frameos.json"), parsed);
    await this.atomicWrite(
      resolve(directory, "history", "revisions", "0.json"),
      parsed,
    );
    await writeFile(resolve(directory, "history", "operations.ndjson"), "", {
      encoding: "utf8",
      flag: "wx",
    });
    return parsed;
  }

  private async recover(projectId: string): Promise<void> {
    const directory = this.projectDirectory(projectId);
    const pendingPath = resolve(
      directory,
      "history",
      "pending-transaction.json",
    );
    let pending: StoredTransactionRecord;
    try {
      pending = parseJson<StoredTransactionRecord>(
        await readFile(pendingPath, "utf8"),
        "pending transaction",
      );
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "ENOENT" ||
        (error instanceof FrameOSError && error.code === "NOT_FOUND")
      ) {
        return;
      }
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    const projectPath = resolve(directory, "project.frameos.json");
    const current = migrateProjectDocument(
      parseJson<unknown>(await readFile(projectPath, "utf8"), "project"),
    );
    if (current.revision === pending.request.baseRevision) {
      try {
        const revisionRaw = await readFile(
          resolve(
            directory,
            "history",
            "revisions",
            `${pending.result.resultingRevision}.json`,
          ),
          "utf8",
        );
        const recovered = migrateProjectDocument(
          parseJson<unknown>(revisionRaw, "pending revision"),
        );
        if (
          recovered.projectId !== projectId ||
          recovered.revision !== pending.result.resultingRevision
        ) {
          throw new FrameOSError(
            "INTERNAL_ERROR",
            "Pending transaction revision does not match its marker",
            500,
          );
        }
        await this.atomicWrite(projectPath, recovered);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          await rm(pendingPath, { force: true });
          return;
        }
        throw error;
      }
    }
    const recoveredCurrent = migrateProjectDocument(
      parseJson<unknown>(await readFile(projectPath, "utf8"), "project"),
    );
    if (recoveredCurrent.revision !== pending.result.resultingRevision) {
      throw new FrameOSError(
        "INTERNAL_ERROR",
        "Pending transaction conflicts with the current project revision",
        500,
      );
    }
    const history = await this.readHistoryUnsafe(projectId);
    if (
      !history.some((record) => record.transactionId === pending.transactionId)
    ) {
      await appendFile(
        resolve(directory, "history", "operations.ndjson"),
        `${JSON.stringify(pending)}\n`,
        "utf8",
      );
    }
    await rm(pendingPath, { force: true });
  }

  public async load(projectId: string): Promise<Project> {
    const directory = this.projectDirectory(projectId);
    await this.recover(projectId);
    try {
      const raw = await readFile(
        resolve(directory, "project.frameos.json"),
        "utf8",
      );
      return migrateProjectDocument(parseJson<unknown>(raw, "project"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new FrameOSError(
          "NOT_FOUND",
          `Project ${projectId} was not found`,
          404,
        );
      }
      throw error;
    }
  }

  public async loadRevision(
    projectId: string,
    revision: number,
  ): Promise<Project> {
    if (!Number.isInteger(revision) || revision < 0) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Revision must be a non-negative integer",
        422,
      );
    }
    try {
      const raw = await readFile(
        resolve(
          this.projectDirectory(projectId),
          "history",
          "revisions",
          `${revision}.json`,
        ),
        "utf8",
      );
      return migrateProjectDocument(parseJson<unknown>(raw, "revision"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new FrameOSError(
          "NOT_FOUND",
          `Revision ${revision} was not found`,
          404,
        );
      }
      throw error;
    }
  }

  public async list(): Promise<
    Array<{
      projectId: string;
      name: string;
      revision: number;
      updatedAt: string;
    }>
  > {
    await this.initialize();
    const entries = await readdir(this.projectsDirectory, {
      withFileTypes: true,
    });
    const projects = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && isEntityId(entry.name))
        .map(async (entry) => {
          try {
            const project = await this.load(entry.name);
            return {
              projectId: project.projectId,
              name: project.settings.name,
              revision: project.revision,
              updatedAt: project.updatedAt,
            };
          } catch {
            return undefined;
          }
        }),
    );
    return projects.filter(
      (project): project is NonNullable<typeof project> =>
        project !== undefined,
    );
  }

  public async fork(
    projectId: string,
    revision: number,
    name: string,
  ): Promise<Project> {
    const source = await this.loadRevision(projectId, revision);
    const now = new Date().toISOString();
    const forked = projectSchema.parse({
      ...structuredClone(source),
      projectId: createId(),
      revision: 0,
      createdAt: now,
      updatedAt: now,
      settings: { ...source.settings, name },
      metadata: { ...source.metadata, forkedFrom: { projectId, revision } },
    });
    return this.create(forked);
  }

  private async readHistoryUnsafe(
    projectId: string,
  ): Promise<StoredTransactionRecord[]> {
    try {
      const raw = await readFile(
        resolve(
          this.projectDirectory(projectId),
          "history",
          "operations.ndjson",
        ),
        "utf8",
      );
      return raw
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) =>
          parseJson<StoredTransactionRecord>(line, "transaction history"),
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  public async history(projectId: string): Promise<StoredTransactionRecord[]> {
    await this.load(projectId);
    return this.readHistoryUnsafe(projectId);
  }

  public async findIdempotentResult(
    projectId: string,
    key: string,
  ): Promise<TransactionResult | undefined> {
    const records = await this.readHistoryUnsafe(projectId);
    return records.find((record) => record.idempotencyKey === key)?.result;
  }

  public async commitUnsafe(
    project: Project,
    request: TransactionRequest,
    result: TransactionResult,
    inverseOperations: Operation[],
  ): Promise<void> {
    const parsedRequest = transactionRequestSchema.parse(request);
    const parsedResult = transactionResultSchema.parse(result);
    const parsedProject = projectSchema.parse(project);
    const directory = this.projectDirectory(project.projectId);
    const record: StoredTransactionRecord = {
      transactionId: parsedResult.transactionId,
      committedAt: new Date().toISOString(),
      idempotencyKey: parsedRequest.idempotencyKey,
      request: parsedRequest,
      result: parsedResult,
      inverseOperations,
    };
    const pendingPath = resolve(
      directory,
      "history",
      "pending-transaction.json",
    );
    await this.atomicWrite(pendingPath, record);
    await this.atomicWrite(
      resolve(
        directory,
        "history",
        "revisions",
        `${parsedProject.revision}.json`,
      ),
      parsedProject,
    );
    await this.atomicWrite(
      resolve(directory, "project.frameos.json"),
      parsedProject,
    );
    await appendFile(
      resolve(directory, "history", "operations.ndjson"),
      `${JSON.stringify(record)}\n`,
      "utf8",
    );
    await rm(pendingPath, { force: true });
  }

  public async saveDraft(draft: DraftRecord): Promise<void> {
    const path = resolve(
      this.projectDirectory(draft.project.projectId),
      "drafts",
      `${draft.draftId}.json`,
    );
    await this.atomicWrite(path, draft);
  }

  public async loadDraft(
    projectId: string,
    draftId: string,
  ): Promise<DraftRecord> {
    if (!isEntityId(draftId)) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Draft id must be a UUID",
        422,
      );
    }
    try {
      const raw = await readFile(
        resolve(this.projectDirectory(projectId), "drafts", `${draftId}.json`),
        "utf8",
      );
      const draft = parseJson<DraftRecord>(raw, "draft");
      if (Date.parse(draft.expiresAt) <= Date.now()) {
        await this.deleteDraft(projectId, draftId);
        throw new FrameOSError(
          "NOT_FOUND",
          `Draft ${draftId} has expired`,
          404,
        );
      }
      return draft;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new FrameOSError(
          "NOT_FOUND",
          `Draft ${draftId} was not found`,
          404,
        );
      }
      throw error;
    }
  }

  public async deleteDraft(projectId: string, draftId: string): Promise<void> {
    if (!isEntityId(draftId)) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Draft id must be a UUID",
        422,
      );
    }
    await rm(
      resolve(this.projectDirectory(projectId), "drafts", `${draftId}.json`),
      { force: true },
    );
  }

  public async projectStorageBytes(projectId: string): Promise<number> {
    const projectPath = resolve(
      this.projectDirectory(projectId),
      "project.frameos.json",
    );
    return (await stat(projectPath)).size;
  }

  public async writeAnalysisDocument(
    document: AnalysisDocument,
  ): Promise<string> {
    const parsed = analysisDocumentSchema.parse(document);
    const path = resolve(
      this.projectDirectory(parsed.projectId),
      "analysis",
      `${parsed.artifactId}.json`,
    );
    await this.atomicWrite(path, parsed);
    return `frameos://projects/${parsed.projectId}/analysis/${parsed.artifactId}.json`;
  }

  public async readAnalysisDocument(
    projectId: string,
    artifactId: string,
  ): Promise<AnalysisDocument> {
    if (!isEntityId(artifactId)) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Analysis artifact id must be a UUID",
        422,
      );
    }
    try {
      const raw = await readFile(
        resolve(
          this.projectDirectory(projectId),
          "analysis",
          `${artifactId}.json`,
        ),
        "utf8",
      );
      const document = analysisDocumentSchema.parse(
        parseJson<unknown>(raw, "analysis document"),
      );
      if (
        document.projectId !== projectId ||
        document.artifactId !== artifactId
      ) {
        throw new FrameOSError(
          "INTERNAL_ERROR",
          "Analysis sidecar identity does not match its project path",
          500,
        );
      }
      return document;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new FrameOSError(
          "NOT_FOUND",
          `Analysis artifact ${artifactId} sidecar was not found`,
          404,
        );
      }
      throw error;
    }
  }

  public async deleteAnalysisDocument(
    projectId: string,
    artifactId: string,
  ): Promise<void> {
    if (!isEntityId(artifactId)) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Analysis artifact id must be a UUID",
        422,
      );
    }
    await rm(
      resolve(
        this.projectDirectory(projectId),
        "analysis",
        `${artifactId}.json`,
      ),
      { force: true },
    );
  }

  public async importManagedAsset(
    projectId: string,
    assetId: string,
    sourcePath: string,
  ): Promise<string> {
    if (!isEntityId(assetId)) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Managed asset id must be a UUID",
        422,
      );
    }
    const rawExtension = extname(sourcePath).toLowerCase();
    const extension = /^\.[a-z0-9]{1,16}$/u.test(rawExtension)
      ? rawExtension
      : "";
    const filename = `${assetId}${extension}`;
    await copyFile(
      sourcePath,
      resolve(this.projectDirectory(projectId), "assets", filename),
      fsConstants.COPYFILE_EXCL,
    );
    return `frameos://projects/${projectId}/assets/${filename}`;
  }

  public managedProxyLocation(
    projectId: string,
    assetId: string,
    identity: string,
  ): { path: string; uri: string } {
    if (!isEntityId(assetId) || !/^[a-f0-9]{16}$/u.test(identity)) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Managed proxy identity is invalid",
        422,
      );
    }
    const filename = `${assetId}-proxy-${identity}.mp4`;
    const uri = `frameos://projects/${projectId}/assets/${filename}`;
    return { path: this.resolveProjectUri(projectId, uri), uri };
  }

  public resolveProjectUri(projectId: string, uri: string): string {
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Managed asset URI is invalid",
        422,
      );
    }
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (
      parsed.protocol !== "frameos:" ||
      parsed.hostname !== "projects" ||
      segments.length !== 3 ||
      segments[0] !== projectId ||
      segments[1] !== "assets" ||
      !/^[0-9a-f-]{36}(?:-proxy-[a-f0-9]{16})?(?:\.[a-z0-9]{1,16})?$/u.test(
        segments[2] ?? "",
      )
    ) {
      throw new FrameOSError(
        "FORBIDDEN",
        "Managed asset URI does not belong to this project",
        403,
      );
    }
    const assetsDirectory = resolve(this.projectDirectory(projectId), "assets");
    const path = resolve(assetsDirectory, segments[2]!);
    if (!path.startsWith(`${assetsDirectory}${sep}`)) {
      throw new FrameOSError(
        "FORBIDDEN",
        "Managed asset URI escaped its project bundle",
        403,
      );
    }
    return path;
  }

  public async deleteManagedAsset(
    projectId: string,
    uri: string,
  ): Promise<void> {
    await rm(this.resolveProjectUri(projectId, uri), { force: true });
  }

  public idempotencyDigest(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }
}
