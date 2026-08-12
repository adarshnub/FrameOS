import {
  FrameOSError,
  agentExecutionRequestSchema,
  agentRevisionRequestSchema,
  agentBudgetSchema,
  agentProviderKindSchema,
  approvalModeSchema,
  approvalDecisionSchema,
  addTime,
  compareTime,
  rescaleTime,
  type AgentEvaluation,
  type AgentEvaluationCheck,
  type AgentExecutionResult,
  type AgentBudget,
  type AgentProviderKind,
  type AgentRun,
  type AgentRevisionResult,
  type AgentSession,
  type ApprovalMode,
  type Approval,
} from "@frameos/contracts";
import type { EventBus } from "../events/event-bus.js";
import type { ProjectStore } from "../store/project-store.js";
import type { RuntimeDatabase } from "../store/runtime-database.js";
import type { CapabilityService } from "../services/capability-service.js";
import type { ProviderRegistry } from "./provider.js";
import type { TransactionEngine } from "../domain/transaction-engine.js";
import type { AnalysisService } from "../analysis/analysis-service.js";
import type { JobManager } from "../jobs/job-manager.js";

type InputBudget = {
  [Key in keyof AgentBudget]?: AgentBudget[Key] | undefined;
};

export class AgentService {
  public constructor(
    private readonly database: RuntimeDatabase,
    private readonly projects: ProjectStore,
    private readonly capabilities: CapabilityService,
    private readonly providers: ProviderRegistry,
    private readonly events: EventBus,
    private readonly transactions: TransactionEngine,
    private readonly analysis: AnalysisService,
    private readonly jobs: JobManager,
  ) {}

  public async createSession(input: {
    projectId: string;
    provider: AgentProviderKind;
    model: string;
    approvalMode?: ApprovalMode;
    budgets?: InputBudget;
    allowedOperationFamilies?: string[];
  }): Promise<AgentSession> {
    await this.projects.load(input.projectId);
    const provider = agentProviderKindSchema.parse(input.provider);
    const approvalMode = approvalModeSchema.parse(
      input.approvalMode ?? "supervised",
    );
    const budgets = agentBudgetSchema.parse(input.budgets ?? {});
    const session = this.database.createAgentSession({
      projectId: input.projectId,
      provider,
      model: input.model,
      approvalMode,
      budgets,
      allowedOperationFamilies: input.allowedOperationFamilies ?? [],
    });
    this.events.publish(
      "agent.session.created",
      { sessionId: session.id, approvalMode },
      session.projectId,
    );
    return session;
  }

  public listSessions(projectId?: string): AgentSession[] {
    return this.database.listAgentSessions(projectId);
  }

  public getSession(id: string): AgentSession {
    return this.database.getAgentSession(id);
  }

  public getRun(id: string): AgentRun {
    return this.database.getAgentRun(id);
  }

  public listProviders(): Array<{ kind: AgentProviderKind; model: string }> {
    return this.providers.list();
  }

  public listEvaluations(runId: string): AgentEvaluation[] {
    this.database.getAgentRun(runId);
    return this.database.listAgentEvaluations(runId);
  }

  private async evaluateDraft(
    run: AgentRun,
    session: AgentSession,
  ): Promise<AgentEvaluation> {
    if (run.draftId === undefined) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Agent run ${run.id} has no draft to evaluate`,
        422,
      );
    }
    const cycle = run.previewCycles + 1;
    if (cycle > session.budgets.maxPreviewCycles) {
      throw new FrameOSError(
        "RESOURCE_LIMIT",
        `Agent preview-cycle budget is ${session.budgets.maxPreviewCycles.toString()}`,
        422,
      );
    }
    const draft = await this.projects.loadDraft(run.projectId, run.draftId);
    const project = draft.project;
    const checks: AgentEvaluationCheck[] = [
      {
        id: "timeline.invariants",
        category: "timeline",
        status: "pass",
        message: "Canonical timeline and reference invariants passed",
        entityIds: [project.projectId],
        ranges: [],
        metadata: { revision: project.revision },
      },
    ];

    const referencedAssetIds = new Set(
      Object.values(project.sequences).flatMap((sequence) =>
        sequence.tracks.flatMap((track) =>
          track.items.flatMap((item) =>
            item.type === "clip" ? [item.assetId] : [],
          ),
        ),
      ),
    );
    const offlineAssets = [...referencedAssetIds].filter((assetId) => {
      const asset = project.assets[assetId];
      return (
        asset === undefined ||
        asset.semanticMetadata.offline === true ||
        asset.uri.startsWith("frameos:offline")
      );
    });
    checks.push({
      id: "media.online",
      category: "media",
      status: offlineAssets.length === 0 ? "pass" : "fail",
      message:
        offlineAssets.length === 0
          ? "All timeline media references are online"
          : `${offlineAssets.length.toString()} referenced assets are offline`,
      entityIds: offlineAssets,
      ranges: [],
      metadata: {},
    });

    const captionCollisions: Array<{
      ids: string[];
      ranges: AgentEvaluationCheck["ranges"];
    }> = [];
    for (const sequence of Object.values(project.sequences)) {
      for (const captionTrack of sequence.captions) {
        const cues = captionTrack.cues.toSorted((left, right) =>
          compareTime(left.range.start, right.range.start),
        );
        for (let index = 1; index < cues.length; index += 1) {
          const previous = cues[index - 1];
          const current = cues[index];
          if (
            previous !== undefined &&
            current !== undefined &&
            compareTime(
              addTime(previous.range.start, previous.range.duration),
              current.range.start,
            ) > 0
          ) {
            captionCollisions.push({
              ids: [previous.id, current.id],
              ranges: [previous.range, current.range],
            });
          }
        }
      }
    }
    checks.push({
      id: "captions.collisions",
      category: "captions",
      status: captionCollisions.length === 0 ? "pass" : "warning",
      message:
        captionCollisions.length === 0
          ? "No overlapping caption cues were detected"
          : `${captionCollisions.length.toString()} overlapping caption pairs require review`,
      entityIds: captionCollisions.flatMap((collision) => collision.ids),
      ranges: captionCollisions.flatMap((collision) => collision.ranges),
      metadata: {},
    });

    const highGainEntities: string[] = [];
    const highGainRanges: AgentEvaluationCheck["ranges"] = [];
    for (const sequence of Object.values(project.sequences)) {
      for (const bus of sequence.buses) {
        if (!bus.muted && bus.gainDb > 12) highGainEntities.push(bus.id);
      }
      for (const track of sequence.tracks) {
        for (const item of track.items) {
          if (
            item.type === "clip" &&
            !item.audio.muted &&
            item.audio.gainDb > 12
          ) {
            highGainEntities.push(item.id);
            highGainRanges.push(item.timelineRange);
          }
        }
      }
    }
    checks.push({
      id: "audio.gain_headroom",
      category: "audio",
      status: highGainEntities.length === 0 ? "pass" : "warning",
      message:
        highGainEntities.length === 0
          ? "No extreme positive gain values were detected"
          : "Positive gain above 12 dB may clip and requires a rendered loudness check",
      entityIds: highGainEntities,
      ranges: highGainRanges,
      metadata: { thresholdDb: 12 },
    });

    const nativeCapabilities = await this.capabilities.listCapabilities();
    const mltAvailable = nativeCapabilities.some(
      (capability) => capability.id === "engine.mlt" && capability.available,
    );
    const contactSheetAvailable = nativeCapabilities.some(
      (capability) =>
        capability.id === "preview.contact_sheet" && capability.available,
    );
    const previews: AgentEvaluation["previews"] = [];
    let visualStatus: AgentEvaluationCheck["status"] = "unavailable";
    let visualMessage = mltAvailable
      ? "Native rendering is available, but no preview artifact was produced"
      : "Visual composition checks require the audited MLT preview worker";
    let visualMetadata: Record<string, unknown> = {
      engineAvailable: mltAvailable,
    };
    if (mltAvailable) {
      const sequence = project.sequences[project.settings.defaultSequenceId];
      if (sequence === undefined) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Default sequence is unavailable for preview evaluation",
          422,
        );
      }
      const affectedRange = draft.result.affectedRanges[0];
      const at =
        affectedRange?.start ??
        ({ value: 0, rate: sequence.format.frameRate } as const);
      const affectedFrames =
        affectedRange === undefined
          ? 0
          : rescaleTime(affectedRange.duration, sequence.format.frameRate).time
              .value;
      const useContactSheet = contactSheetAvailable && affectedFrames >= 2;
      const previewKind = useContactSheet ? "contact_sheet" : "frame";
      const previewJob = useContactSheet
        ? await this.jobs.startPreview({
            projectId: project.projectId,
            source: { type: "draft", draftId: run.draftId },
            sequenceId: sequence.id,
            kind: "contact_sheet",
            range: affectedRange!,
            frameCount: Math.min(8, affectedFrames),
            columns: Math.min(4, affectedFrames),
            maxWidth: 960,
            maxHeight: 540,
          })
        : await this.jobs.startPreview({
            projectId: project.projectId,
            source: { type: "draft", draftId: run.draftId },
            sequenceId: sequence.id,
            kind: "frame",
            at,
            maxWidth: 960,
            maxHeight: 540,
          });
      let completedPreview = previewJob;
      for (let attempt = 0; attempt < 4_800; attempt += 1) {
        completedPreview = this.jobs.getJob(previewJob.id);
        if (
          ["completed", "failed", "cancelled"].includes(completedPreview.status)
        )
          break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      }
      const artifactUris = Array.isArray(completedPreview.output?.artifacts)
        ? completedPreview.output.artifacts.flatMap((artifact) =>
            typeof artifact === "object" &&
            artifact !== null &&
            "uri" in artifact &&
            typeof artifact.uri === "string"
              ? [artifact.uri]
              : [],
          )
        : [];
      previews.push({
        jobId: completedPreview.id,
        kind: previewKind,
        status: completedPreview.status,
        artifactUris,
        ...(completedPreview.error === undefined
          ? {}
          : { error: completedPreview.error }),
      });
      if (completedPreview.status === "completed") {
        visualStatus = "warning";
        visualMessage = `${useContactSheet ? "Contact-sheet" : "Representative frame"} preview rendered; composition still requires model or human review`;
      } else {
        visualStatus = "fail";
        visualMessage = `Representative preview ${completedPreview.status}: ${completedPreview.error?.message ?? "no artifact was produced"}`;
      }
      visualMetadata = {
        engineAvailable: true,
        previewJobId: completedPreview.id,
        previewKind,
        artifactUris,
      };
    }
    checks.push({
      id: "composition.visual_preview",
      category: "composition",
      status: visualStatus,
      message: visualMessage,
      entityIds: [],
      ranges: draft.result.affectedRanges,
      metadata: visualMetadata,
    });
    checks.push({
      id: "continuity.model_review",
      category: "continuity",
      status: "unavailable",
      message:
        "Continuity and pacing model review is not configured; affected ranges remain available for external evaluation",
      entityIds: [],
      ranges: draft.result.affectedRanges,
      metadata: {},
    });

    const evaluation = this.database.createAgentEvaluation({
      runId: run.id,
      projectId: run.projectId,
      draftId: run.draftId,
      cycle,
      checks,
      previews,
    });
    this.database.updateAgentRun(run.id, {
      state: "evaluating",
      previewCycles: cycle,
    });
    this.events.publish(
      "agent.run.evaluated",
      {
        runId: run.id,
        evaluationId: evaluation.id,
        cycle,
        passed: evaluation.passed,
      },
      run.projectId,
    );
    return evaluation;
  }

  public async evaluate(runId: string): Promise<AgentEvaluation> {
    let run = this.database.getAgentRun(runId);
    const previousState = run.state;
    if (
      run.draftId === undefined ||
      run.resultingRevision !== undefined ||
      !["awaiting_approval", "completed"].includes(run.state)
    ) {
      throw new FrameOSError(
        "REVISION_CONFLICT",
        `Agent run ${run.id} cannot be evaluated from state ${run.state}`,
        409,
      );
    }
    const session = this.database.getAgentSession(run.sessionId);
    run = this.database.updateAgentRun(run.id, { state: "evaluating" });
    try {
      const evaluation = await this.evaluateDraft(run, session);
      this.database.updateAgentRun(run.id, { state: previousState });
      return evaluation;
    } catch (error) {
      this.database.updateAgentRun(run.id, { state: previousState });
      throw error;
    }
  }

  public async revise(
    runId: string,
    input: unknown,
  ): Promise<AgentRevisionResult> {
    let run = this.database.getAgentRun(runId);
    const session = this.database.getAgentSession(run.sessionId);
    if (
      run.draftId === undefined ||
      run.resultingRevision !== undefined ||
      !["awaiting_approval", "completed", "planned"].includes(run.state)
    ) {
      throw new FrameOSError(
        "REVISION_CONFLICT",
        `Agent run ${run.id} cannot be revised from state ${run.state}`,
        409,
      );
    }
    if (run.previewCycles >= session.budgets.maxPreviewCycles) {
      throw new FrameOSError(
        "RESOURCE_LIMIT",
        `Agent preview-cycle budget is ${session.budgets.maxPreviewCycles.toString()}`,
        422,
      );
    }
    const request = agentRevisionRequestSchema.parse(input);
    if (
      request.operations.length > session.budgets.maxOperationsPerTransaction
    ) {
      throw new FrameOSError(
        "RESOURCE_LIMIT",
        `Agent operation budget is ${session.budgets.maxOperationsPerTransaction.toString()}`,
        422,
      );
    }
    const allowedFamilies = new Set(session.allowedOperationFamilies);
    for (const operation of request.operations) {
      const descriptor = this.capabilities.getOperation(operation.type);
      if (descriptor === undefined || descriptor.maturity !== "implemented") {
        throw new FrameOSError(
          "CAPABILITY_UNAVAILABLE",
          `Operation ${operation.type} is not executable`,
          424,
        );
      }
      if (allowedFamilies.size > 0 && !allowedFamilies.has(descriptor.family)) {
        throw new FrameOSError(
          "FORBIDDEN",
          `Agent session does not allow the ${descriptor.family} operation family`,
          403,
        );
      }
    }
    const operations = request.operations.map((operation) => ({
      ...operation,
      provenance: {
        actorType: "agent" as const,
        actorId: session.id,
        provider: session.provider,
        model: session.model,
        runId: run.id,
        reason:
          `Revision cycle ${(run.previewCycles + 1).toString()}: ${run.request}`.slice(
            0,
            16_384,
          ),
      },
    }));
    const idempotencyKey = `agent-run-${run.id}-revision-${(
      run.previewCycles + 1
    ).toString()}`;
    await this.transactions.execute({
      projectId: run.projectId,
      baseRevision: run.projectRevision,
      idempotencyKey: `${idempotencyKey}-validate`,
      mode: "validate",
      operations,
    });
    if (run.approvalId !== undefined) {
      const approval = this.database.getApproval(run.approvalId);
      if (approval.status === "pending") {
        this.database.decideApproval(approval.id, {
          decision: "reject",
          decidedBy: "frameos.agent.revise",
          note: "Superseded by a revised draft",
        });
      }
    }
    await this.transactions.rollbackDraft(run.projectId, run.draftId);
    const transaction = await this.transactions.execute({
      projectId: run.projectId,
      baseRevision: run.projectRevision,
      idempotencyKey,
      mode: "preview",
      operations,
    });
    if (transaction.draftId === undefined) {
      throw new FrameOSError(
        "INTERNAL_ERROR",
        "Agent revision did not produce a draft",
        500,
      );
    }
    run = this.database.updateAgentRun(run.id, {
      state: "evaluating",
      draftId: transaction.draftId,
      transactionId: transaction.transactionId,
    });
    const evaluation = await this.evaluateDraft(run, session);
    if (evaluation.passed && session.approvalMode === "autonomous") {
      run = this.database.updateAgentRun(run.id, { state: "committing" });
      const committed = await this.transactions.commitDraft(
        run.projectId,
        transaction.draftId,
      );
      run = this.database.updateAgentRun(run.id, {
        state: "completed",
        resultingRevision: committed.resultingRevision,
      });
      this.events.publish(
        "agent.run.committed",
        {
          runId: run.id,
          revision: committed.resultingRevision,
          revisionCycle: evaluation.cycle,
        },
        run.projectId,
      );
      return { run, transaction: committed, evaluation };
    }
    let approval: Approval | undefined;
    if (evaluation.passed && session.approvalMode === "supervised") {
      approval = this.database.createApproval({
        runId: run.id,
        sessionId: session.id,
        projectId: run.projectId,
        draftId: transaction.draftId,
      });
    }
    run = this.database.updateAgentRun(run.id, {
      state: evaluation.passed
        ? session.approvalMode === "supervised"
          ? "awaiting_approval"
          : "completed"
        : "planned",
      ...(approval === undefined ? {} : { approvalId: approval.id }),
    });
    this.events.publish(
      "agent.run.revised",
      {
        runId: run.id,
        cycle: evaluation.cycle,
        draftId: transaction.draftId,
        passed: evaluation.passed,
        ...(approval === undefined ? {} : { approvalId: approval.id }),
      },
      run.projectId,
    );
    return {
      run,
      transaction,
      evaluation,
      ...(approval === undefined ? {} : { approval }),
    };
  }

  public async plan(sessionId: string, request: string): Promise<AgentRun> {
    const session = this.database.getAgentSession(sessionId);
    const project = await this.projects.load(session.projectId);
    let run = this.database.createAgentRun(session, project.revision, request);
    this.events.publish(
      "agent.run.started",
      { runId: run.id, state: run.state },
      run.projectId,
    );
    run = this.database.updateAgentRun(run.id, { state: "planning" });
    try {
      const provider = this.providers.get(session.provider, session.model);
      const [capabilities, operationCatalog, analysisResults] =
        await Promise.all([
          this.capabilities.listCapabilities(),
          Promise.resolve(
            this.capabilities.listOperations({ maturity: "implemented" }),
          ),
          this.analysis.search({
            projectId: project.projectId,
            query: request,
            mode: "lexical",
            limit: 20,
          }),
        ]);
      const result = await provider.createPlan({
        request,
        project,
        operationCatalog,
        capabilityIds: capabilities
          .filter((capability) => capability.available)
          .map((capability) => capability.id),
        allowedOperationFamilies: session.allowedOperationFamilies,
        analysisContext: analysisResults.map((result) => ({
          artifactId: result.artifactId,
          assetId: result.assetId,
          type: result.type,
          score: result.score,
          ...(result.range === undefined ? {} : { range: result.range }),
          ...(result.text === undefined
            ? {}
            : { text: result.text.slice(0, 2_000) }),
          labels: result.labels,
        })),
      });
      const state = result.plan.clarificationRequired
        ? "awaiting_clarification"
        : "planned";
      run = this.database.updateAgentRun(run.id, {
        state,
        plan: result.plan,
        ...(result.responseId === undefined
          ? {}
          : { providerResponseId: result.responseId }),
      });
      this.events.publish(
        "agent.run.planned",
        { runId: run.id, state },
        run.projectId,
      );
      return run;
    } catch (error) {
      const code =
        error instanceof Error && "code" in error
          ? String(error.code)
          : "INTERNAL_ERROR";
      const message = error instanceof Error ? error.message : String(error);
      this.database.updateAgentRun(run.id, {
        state: "failed",
        error: { code, message },
      });
      this.events.publish(
        "agent.run.failed",
        { runId: run.id, code, message },
        run.projectId,
      );
      throw error;
    }
  }

  public listApprovals(
    projectId?: string,
    status?: Approval["status"],
  ): Approval[] {
    return this.database.listApprovals(projectId, status);
  }

  public getApproval(id: string): Approval {
    return this.database.getApproval(id);
  }

  public async execute(
    runId: string,
    input: unknown,
  ): Promise<AgentExecutionResult> {
    let run = this.database.getAgentRun(runId);
    const session = this.database.getAgentSession(run.sessionId);
    if (run.state !== "planned") {
      throw new FrameOSError(
        "REVISION_CONFLICT",
        `Agent run ${run.id} cannot execute from state ${run.state}`,
        409,
      );
    }
    if (run.plan?.clarificationRequired === true) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "The run requires clarification before operations can execute",
        422,
      );
    }
    const request = agentExecutionRequestSchema.parse(input);
    if (
      request.operations.length > session.budgets.maxOperationsPerTransaction
    ) {
      throw new FrameOSError(
        "RESOURCE_LIMIT",
        `Agent operation budget is ${session.budgets.maxOperationsPerTransaction.toString()}`,
        422,
      );
    }
    const allowedFamilies = new Set(session.allowedOperationFamilies);
    for (const operation of request.operations) {
      const descriptor = this.capabilities.getOperation(operation.type);
      if (descriptor === undefined || descriptor.maturity !== "implemented") {
        throw new FrameOSError(
          "CAPABILITY_UNAVAILABLE",
          `Operation ${operation.type} is not executable`,
          424,
        );
      }
      if (allowedFamilies.size > 0 && !allowedFamilies.has(descriptor.family)) {
        throw new FrameOSError(
          "FORBIDDEN",
          `Agent session does not allow the ${descriptor.family} operation family`,
          403,
        );
      }
    }

    run = this.database.updateAgentRun(run.id, { state: "validating" });
    this.events.publish(
      "agent.run.validating",
      { runId: run.id, operationCount: request.operations.length },
      run.projectId,
    );
    try {
      const operations = request.operations.map((operation) => ({
        ...operation,
        provenance: {
          actorType: "agent" as const,
          actorId: session.id,
          provider: session.provider,
          model: session.model,
          runId: run.id,
          reason: run.request.slice(0, 16_384),
        },
      }));
      const transaction = await this.transactions.execute({
        projectId: run.projectId,
        baseRevision: run.projectRevision,
        idempotencyKey: `agent-run-${run.id}`,
        mode: "preview",
        operations,
      });
      if (transaction.draftId === undefined) {
        throw new FrameOSError(
          "INTERNAL_ERROR",
          "Agent preview did not produce a draft",
          500,
        );
      }
      const maximumAffectedFrames = session.budgets.maxAffectedDurationFrames;
      if (maximumAffectedFrames !== undefined) {
        const project = await this.projects.load(run.projectId);
        const sequence = project.sequences[project.settings.defaultSequenceId];
        if (sequence === undefined)
          throw new Error("Default sequence is missing");
        let affectedFrames = 0;
        for (const range of transaction.affectedRanges) {
          affectedFrames += rescaleTime(
            range.duration,
            sequence.format.frameRate,
          ).time.value;
        }
        if (affectedFrames > maximumAffectedFrames) {
          await this.transactions.rollbackDraft(
            run.projectId,
            transaction.draftId,
          );
          throw new FrameOSError(
            "RESOURCE_LIMIT",
            `Agent edit affects ${affectedFrames.toString()} frames; budget is ${maximumAffectedFrames.toString()}`,
            422,
          );
        }
      }

      let evaluation: AgentEvaluation | undefined;
      if (session.budgets.maxPreviewCycles > 0) {
        run = this.database.updateAgentRun(run.id, {
          state: "previewing",
          draftId: transaction.draftId,
          transactionId: transaction.transactionId,
        });
        run = this.database.updateAgentRun(run.id, { state: "evaluating" });
        evaluation = await this.evaluateDraft(run, session);
        run = this.database.getAgentRun(run.id);
        if (!evaluation.passed) {
          await this.transactions.rollbackDraft(
            run.projectId,
            transaction.draftId,
          );
          throw new FrameOSError(
            "VALIDATION_ERROR",
            "Agent draft failed deterministic evaluation",
            422,
          );
        }
      }

      let approval: Approval | undefined;
      if (session.approvalMode === "autonomous") {
        run = this.database.updateAgentRun(run.id, {
          state: "committing",
          draftId: transaction.draftId,
          transactionId: transaction.transactionId,
        });
        const committed = await this.transactions.commitDraft(
          run.projectId,
          transaction.draftId,
        );
        run = this.database.updateAgentRun(run.id, {
          state: "completed",
          resultingRevision: committed.resultingRevision,
        });
        this.events.publish(
          "agent.run.committed",
          { runId: run.id, revision: committed.resultingRevision },
          run.projectId,
        );
        return {
          run,
          transaction: committed,
          ...(evaluation === undefined ? {} : { evaluation }),
        };
      }
      if (session.approvalMode === "supervised") {
        approval = this.database.createApproval({
          runId: run.id,
          sessionId: session.id,
          projectId: run.projectId,
          draftId: transaction.draftId,
        });
      }
      run = this.database.updateAgentRun(run.id, {
        state:
          session.approvalMode === "supervised"
            ? "awaiting_approval"
            : "completed",
        draftId: transaction.draftId,
        transactionId: transaction.transactionId,
        ...(approval === undefined ? {} : { approvalId: approval.id }),
      });
      this.events.publish(
        approval === undefined
          ? "agent.run.proposed"
          : "agent.approval.requested",
        {
          runId: run.id,
          draftId: transaction.draftId,
          ...(approval === undefined ? {} : { approvalId: approval.id }),
        },
        run.projectId,
      );
      return {
        run,
        transaction,
        ...(approval === undefined ? {} : { approval }),
        ...(evaluation === undefined ? {} : { evaluation }),
      };
    } catch (error) {
      const code =
        error instanceof Error && "code" in error
          ? String(error.code)
          : "INTERNAL_ERROR";
      const message = error instanceof Error ? error.message : String(error);
      this.database.updateAgentRun(run.id, {
        state: "failed",
        error: { code, message },
      });
      this.events.publish(
        "agent.run.failed",
        { runId: run.id, code, message },
        run.projectId,
      );
      throw error;
    }
  }

  public async decideApproval(
    approvalId: string,
    input: unknown,
  ): Promise<{ approval: Approval; run: AgentRun; transaction?: unknown }> {
    const decision = approvalDecisionSchema.parse(input);
    const current = this.database.getApproval(approvalId);
    const run = this.database.getAgentRun(current.runId);
    if (run.state !== "awaiting_approval") {
      throw new FrameOSError(
        "REVISION_CONFLICT",
        `Agent run ${run.id} is not awaiting approval`,
        409,
      );
    }
    if (decision.decision === "reject") {
      await this.transactions.rollbackDraft(current.projectId, current.draftId);
      const approval = this.database.decideApproval(approvalId, decision);
      const updatedRun = this.database.updateAgentRun(run.id, {
        state: "cancelled",
      });
      this.events.publish(
        "agent.approval.rejected",
        { approvalId, runId: run.id, decidedBy: decision.decidedBy },
        run.projectId,
      );
      return { approval, run: updatedRun };
    }
    const transaction = await this.transactions.commitDraft(
      current.projectId,
      current.draftId,
    );
    const approval = this.database.decideApproval(approvalId, decision);
    const updatedRun = this.database.updateAgentRun(run.id, {
      state: "completed",
      resultingRevision: transaction.resultingRevision,
    });
    this.events.publish(
      "agent.approval.approved",
      {
        approvalId,
        runId: run.id,
        decidedBy: decision.decidedBy,
        revision: transaction.resultingRevision,
      },
      run.projectId,
    );
    return { approval, run: updatedRun, transaction };
  }
}
