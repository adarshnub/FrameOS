import {
  FrameOSError,
  createId,
  transactionRequestSchema,
  transactionResultSchema,
  type Operation,
  type Project,
  type TransactionRequest,
  type TransactionResult,
} from "@frameos/contracts";
import { executeOperations } from "./operation-executor.js";
import type { DraftRecord, ProjectStore } from "../store/project-store.js";
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
    return this.store.withProjectLock(projectId, async () => {
      const current = await this.store.load(projectId);
      if (current.revision === 0) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Project has no committed transaction to undo",
          422,
        );
      }
      const prior = await this.store.loadRevision(
        projectId,
        current.revision - 1,
      );
      const history = await this.store.history(projectId);
      const priorRecord = history.at(-1);
      const operations: Operation[] = priorRecord?.inverseOperations ?? [];
      const restored: Project = {
        ...structuredClone(prior),
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      const request = transactionRequestSchema.parse({
        projectId,
        baseRevision: current.revision,
        idempotencyKey,
        mode: "commit",
        operations:
          operations.length > 0
            ? operations
            : [
                {
                  operationId: createId(),
                  type: "project.metadata.set",
                  preconditions: [],
                  provenance: { actorType: "system", actorId: "frameos.undo" },
                  arguments: {
                    values: { restoredFromRevision: prior.revision },
                  },
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
            operationId: request.operations[0]?.operationId ?? createId(),
            operationType: "project.undo",
            entityIds: [projectId],
            summary: `Restored revision ${prior.revision}`,
          },
        ],
        warnings:
          operations.length === 0
            ? [
                "Undo used a revision snapshot because inverse operations were unavailable",
              ]
            : [],
        unavailableCapabilities: [],
        affectedRanges: [],
        project: restored,
      });
      await this.store.commitUnsafe(restored, request, result, []);
      return result;
    });
  }

  public async redo(
    projectId: string,
    idempotencyKey: string,
  ): Promise<TransactionResult> {
    const [current, history] = await Promise.all([
      this.store.load(projectId),
      this.store.history(projectId),
    ]);
    const undoRecord = history.at(-1);
    const originalRecord = history.at(-2);
    if (
      undoRecord?.result.changes[0]?.operationType !== "project.undo" ||
      originalRecord === undefined
    ) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "The latest revision is not an undo that can be redone",
        422,
      );
    }
    return this.execute({
      projectId,
      baseRevision: current.revision,
      idempotencyKey,
      mode: "commit",
      operations: originalRecord.request.operations.map((operation) => ({
        ...structuredClone(operation),
        operationId: createId(),
        provenance: {
          actorType: "system",
          actorId: "frameos.redo",
          reason: `Redo ${originalRecord.transactionId}`,
        },
      })),
    });
  }
}
