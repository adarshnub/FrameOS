import {
  FrameOSError,
  createId,
  transactionRequestSchema,
  transactionResultSchema,
  type Project,
  type TransactionRequest,
  type TransactionResult,
} from "@frameos/contracts";
import { executeOperations } from "./operation-executor.js";
import type {
  DraftRecord,
  ProjectStore,
  StoredTransactionRecord,
} from "../store/project-store.js";
import type { MediaPolicy } from "../security/media-policy.js";
import type { CapabilityService } from "../services/capability-service.js";

const DRAFT_LIFETIME_MS = 30 * 60 * 1_000;

export class TransactionEngine {
  public constructor(
    private readonly store: ProjectStore,
    private readonly mediaPolicy: MediaPolicy,
    private readonly capabilityService?: CapabilityService,
  ) {}

  private collectRequestedCapabilities(
    value: unknown,
    capabilities: Set<string>,
  ): void {
    if (Array.isArray(value)) {
      for (const item of value)
        this.collectRequestedCapabilities(item, capabilities);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "capabilityId" && typeof child === "string")
        capabilities.add(child);
      else this.collectRequestedCapabilities(child, capabilities);
    }
  }

  private async validateCapabilities(
    request: TransactionRequest,
  ): Promise<void> {
    if (this.capabilityService === undefined) return;
    const requested = new Set<string>();
    for (const operation of request.operations)
      this.collectRequestedCapabilities(operation.arguments, requested);
    if (requested.size === 0) return;
    const available = new Set(
      (await this.capabilityService.listCapabilities())
        .filter((capability) => capability.available)
        .map((capability) => capability.id),
    );
    const unavailable = [...requested].filter(
      (capabilityId) => !available.has(capabilityId),
    );
    if (unavailable.length > 0) {
      throw new FrameOSError(
        "CAPABILITY_UNAVAILABLE",
        `Required capabilities are unavailable: ${unavailable.join(", ")}`,
        424,
        unavailable.map((capabilityId) => ({
          field: "capabilityId",
          message: "Capability is unavailable",
          value: capabilityId,
        })),
      );
    }
  }

  private buildResult(
    request: TransactionRequest,
    project: Project,
    execution: ReturnType<typeof executeOperations>,
    transactionId: string,
    draftId?: string,
  ): TransactionResult {
    return transactionResultSchema.parse({
      transactionId,
      projectId: request.projectId,
      baseRevision: request.baseRevision,
      resultingRevision: project.revision,
      mode: request.mode,
      ...(draftId === undefined ? {} : { draftId }),
      changes: execution.changes,
      warnings: execution.warnings,
      unavailableCapabilities: [],
      affectedRanges: execution.affectedRanges,
      project,
    });
  }

  public async execute(input: unknown): Promise<TransactionResult> {
    const request = transactionRequestSchema.parse(input);
    await this.mediaPolicy.validateTransaction(request);
    await this.validateCapabilities(request);
    return this.store.withProjectLock(request.projectId, async () => {
      const existing = await this.store.findIdempotentResult(
        request.projectId,
        request.idempotencyKey,
      );
      if (existing !== undefined) {
        return existing;
      }

      const current = await this.store.load(request.projectId);
      if (current.revision !== request.baseRevision) {
        throw new FrameOSError(
          "REVISION_CONFLICT",
          `Expected revision ${request.baseRevision}, current revision is ${current.revision}`,
          409,
        );
      }

      const execution = executeOperations(current, request.operations);
      const transactionId = createId();
      execution.project.updatedAt = new Date().toISOString();

      if (request.mode === "validate") {
        execution.project.revision = current.revision;
        return this.buildResult(
          request,
          execution.project,
          execution,
          transactionId,
        );
      }

      execution.project.revision = current.revision + 1;
      if (request.mode === "preview") {
        const draftId = createId();
        const result = this.buildResult(
          request,
          execution.project,
          execution,
          transactionId,
          draftId,
        );
        const now = Date.now();
        const draft: DraftRecord = {
          draftId,
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + DRAFT_LIFETIME_MS).toISOString(),
          request,
          result,
          project: execution.project,
          inverseOperations: execution.inverseOperations,
        };
        await this.store.saveDraft(draft);
        return result;
      }

      const result = this.buildResult(
        request,
        execution.project,
        execution,
        transactionId,
      );
      await this.store.commitUnsafe(
        execution.project,
        request,
        result,
        execution.inverseOperations,
      );
      return result;
    });
  }

  public async commitDraft(
    projectId: string,
    draftId: string,
  ): Promise<TransactionResult> {
    return this.store.withProjectLock(projectId, async () => {
      const draft = await this.store.loadDraft(projectId, draftId);
      const current = await this.store.load(projectId);
      if (current.revision !== draft.request.baseRevision) {
        throw new FrameOSError(
          "REVISION_CONFLICT",
          `Draft is based on revision ${draft.request.baseRevision}, current revision is ${current.revision}`,
          409,
        );
      }
      const commitRequest: TransactionRequest = {
        ...draft.request,
        mode: "commit",
      };
      const commitResult: TransactionResult = {
        ...draft.result,
        mode: "commit",
        resultingRevision: current.revision + 1,
      };
      delete commitResult.draftId;
      draft.project.revision = current.revision + 1;
      draft.project.updatedAt = new Date().toISOString();
      await this.store.commitUnsafe(
        draft.project,
        commitRequest,
        commitResult,
        draft.inverseOperations,
      );
      await this.store.deleteDraft(projectId, draftId);
      return commitResult;
    });
  }

  public async rollbackDraft(
    projectId: string,
    draftId: string,
  ): Promise<void> {
    await this.store.withProjectLock(projectId, async () =>
      this.store.deleteDraft(projectId, draftId),
    );
  }

  public async undo(
    projectId: string,
    idempotencyKey: string,
  ): Promise<TransactionResult> {
    return this.navigateHistory(projectId, idempotencyKey, "undo");
  }

  public async redo(
    projectId: string,
    idempotencyKey: string,
  ): Promise<TransactionResult> {
    return this.navigateHistory(projectId, idempotencyKey, "redo");
  }

  private async navigateHistory(
    projectId: string,
    idempotencyKey: string,
    direction: "undo" | "redo",
  ): Promise<TransactionResult> {
    return this.store.withProjectLock(projectId, async () => {
      const existing = await this.store.findIdempotentResult(
        projectId,
        idempotencyKey,
      );
      if (existing) return existing;
      const current = await this.store.load(projectId);
      const history = await this.store.history(projectId);
      const done: StoredTransactionRecord[] = [];
      const undone: StoredTransactionRecord[] = [];
      // Reconstruct the editing cursor from the persisted log, not revision - 1:
      // undo/redo themselves create revisions and must never become user edits.
      for (const record of history) {
        const kind = record.result.changes[0]?.operationType;
        const legacyRedo = record.request.operations.every(
          (op) => op.provenance?.actorId === "frameos.redo",
        );
        if (kind === "project.undo") {
          const previous = done.pop();
          if (previous) undone.push(previous);
        } else if (kind === "project.redo" || legacyRedo) {
          const next = undone.pop();
          if (next) done.push(next);
        } else {
          done.push(record);
          undone.length = 0;
        }
      }
      const target = direction === "undo" ? done.at(-1) : undone.at(-1);
      if (!target)
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `No edits to ${direction}`,
          422,
        );
      const targetRevision =
        direction === "undo"
          ? target.request.baseRevision
          : target.result.resultingRevision;
      const snapshot = await this.store.loadRevision(projectId, targetRevision);
      const restored: Project = {
        ...structuredClone(snapshot),
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      const request = transactionRequestSchema.parse({
        projectId,
        baseRevision: current.revision,
        idempotencyKey,
        mode: "commit",
        operations: [
          {
            operationId: createId(),
            type: "project.metadata.set",
            preconditions: [],
            provenance: {
              actorType: "system",
              actorId: `frameos.${direction}`,
              reason: `${direction} ${target.transactionId}`,
            },
            arguments: { values: { restoredFromRevision: targetRevision } },
          },
        ],
      });
      const result = transactionResultSchema.parse({
        transactionId: createId(),
        projectId,
        baseRevision: current.revision,
        resultingRevision: restored.revision,
        mode: "commit",
        changes: [
          {
            operationId: request.operations[0]!.operationId,
            operationType: `project.${direction}`,
            entityIds: [projectId],
            summary: `${direction}: restored revision ${targetRevision}`,
          },
        ],
        warnings: [],
        unavailableCapabilities: [],
        affectedRanges: [],
        project: restored,
      });
      await this.store.commitUnsafe(restored, request, result, []);
      return result;
    });
  }
}
