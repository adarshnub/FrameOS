// Generated-client surface derived from packages/contracts/openapi/frameos.openapi.json.
import type {
  AgentBudget,
  AgentExecutionResult,
  AgentEvaluation,
  AgentProviderKind,
  AgentRevisionResult,
  AgentRun,
  AgentSession,
  AnalysisArtifact,
  AnalysisSearchRequest,
  AnalysisSearchResult,
  AnalyzerDescriptor,
  ApprovalMode,
  Approval,
  ApprovalDecision,
  AssetAnalysisRequest,
  AssetImportRequest,
  AssetImportResult,
  AssetProxyRequest,
  AssetThumbnailRequest,
  CaptionExportRequest,
  CaptionExportResult,
  CaptionImportRequest,
  CaptionImportResult,
  JobRecord,
  Operation,
  OtioDocument,
  OtioExportResult,
  OtioImportResult,
  Project,
  PreviewRequest,
  SemanticAddDynamicCaptionsRequest,
  SemanticEditPlan,
  SemanticFindRequest,
  SemanticFindResult,
  SemanticMakeVerticalRequest,
  SemanticMatchCutsToMusicRequest,
  SemanticRemoveSilencesRequest,
  TransactionRequest,
  TransactionResult,
} from "@frameos/contracts";

export interface ApiEnvelope<T> {
  data: T | null;
  error: { code: string; message: string; details?: unknown[] } | null;
  meta: Record<string, unknown>;
}

export interface CreateAgentSessionInput {
  projectId: string;
  provider: AgentProviderKind;
  model: string;
  approvalMode?: ApprovalMode;
  budgets?: Partial<AgentBudget>;
  allowedOperationFamilies?: string[];
}

export class FrameOSApiError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown[],
  ) {
    super(message);
    this.name = "FrameOSApiError";
  }
}

export class FrameOSClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const envelope = (await response.json()) as ApiEnvelope<T>;
    if (!response.ok || envelope.error !== null || envelope.data === null) {
      const error = envelope.error ?? {
        code: `HTTP_${response.status}`,
        message: response.statusText,
      };
      throw new FrameOSApiError(
        error.code,
        error.message,
        response.status,
        error.details,
      );
    }
    return envelope.data;
  }

  public listProjects(): Promise<Project[]> {
    return this.request("GET", "/api/v1/projects");
  }

  public createProject(input: {
    name: string;
    width?: number;
    height?: number;
  }): Promise<Project> {
    return this.request("POST", "/api/v1/projects", input);
  }

  public getProject(projectId: string, revision?: number): Promise<Project> {
    const projectPath = `/api/v1/projects/${encodeURIComponent(projectId)}`;
    return this.request(
      "GET",
      revision === undefined
        ? projectPath
        : `${projectPath}/revisions/${revision}`,
    );
  }

  public executeTransaction(
    input: TransactionRequest,
  ): Promise<TransactionResult> {
    return this.request("POST", "/api/v1/transactions", input);
  }

  public importOtio(
    document: OtioDocument,
    projectName?: string,
  ): Promise<OtioImportResult> {
    return this.request("POST", "/api/v1/imports/otio", {
      document,
      ...(projectName === undefined ? {} : { projectName }),
    });
  }

  public exportOtio(input: {
    projectId: string;
    sequenceId?: string;
    revision?: number;
  }): Promise<OtioExportResult> {
    return this.request("POST", "/api/v1/exports/otio", input);
  }

  public importCaptions(
    input: CaptionImportRequest,
  ): Promise<CaptionImportResult> {
    return this.request("POST", "/api/v1/imports/captions", input);
  }

  public exportCaptions(
    input: CaptionExportRequest,
  ): Promise<CaptionExportResult> {
    return this.request("POST", "/api/v1/exports/captions", input);
  }

  public listCapabilities(search?: string): Promise<unknown[]> {
    const query =
      search === undefined ? "" : `?search=${encodeURIComponent(search)}`;
    return this.request("GET", `/api/v1/capabilities${query}`);
  }

  public listAnalyzers(): Promise<AnalyzerDescriptor[]> {
    return this.request("GET", "/api/v1/analysis/analyzers");
  }

  public importAsset(input: AssetImportRequest): Promise<AssetImportResult> {
    return this.request("POST", "/api/v1/assets/imports", input);
  }

  public createAssetProxy(input: AssetProxyRequest): Promise<JobRecord> {
    return this.request(
      "POST",
      `/api/v1/projects/${encodeURIComponent(input.projectId)}/assets/${encodeURIComponent(input.assetId)}/proxies`,
      input,
    );
  }

  public createAssetThumbnail(
    input: AssetThumbnailRequest,
  ): Promise<JobRecord> {
    return this.request(
      "POST",
      `/api/v1/projects/${encodeURIComponent(input.projectId)}/assets/${encodeURIComponent(input.assetId)}/thumbnails`,
      input,
    );
  }

  public analyzeAsset(input: AssetAnalysisRequest): Promise<JobRecord> {
    return this.request(
      "POST",
      `/api/v1/projects/${encodeURIComponent(input.projectId)}/assets/${encodeURIComponent(input.assetId)}/analysis`,
      input,
    );
  }

  public listAssetAnalysis(
    projectId: string,
    assetId: string,
  ): Promise<AnalysisArtifact[]> {
    return this.request(
      "GET",
      `/api/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/analysis`,
    );
  }

  public searchAnalysis(
    input: AnalysisSearchRequest,
  ): Promise<AnalysisSearchResult[]> {
    return this.request("POST", "/api/v1/assets/search", input);
  }

  public findSemanticRanges(
    input: SemanticFindRequest,
  ): Promise<SemanticFindResult> {
    return this.request("POST", "/api/v1/semantic/find", input);
  }

  public planSilenceRemoval(
    input: SemanticRemoveSilencesRequest,
  ): Promise<SemanticEditPlan> {
    return this.request("POST", "/api/v1/semantic/remove-silences/plan", input);
  }

  public planVerticalConversion(
    input: SemanticMakeVerticalRequest,
  ): Promise<SemanticEditPlan> {
    return this.request("POST", "/api/v1/semantic/make-vertical/plan", input);
  }

  public planCutsToMusic(
    input: SemanticMatchCutsToMusicRequest,
  ): Promise<SemanticEditPlan> {
    return this.request(
      "POST",
      "/api/v1/semantic/match-cuts-to-music/plan",
      input,
    );
  }

  public planDynamicCaptions(
    input: SemanticAddDynamicCaptionsRequest,
  ): Promise<SemanticEditPlan> {
    return this.request(
      "POST",
      "/api/v1/semantic/add-dynamic-captions/plan",
      input,
    );
  }

  public getJob(jobId: string): Promise<JobRecord> {
    return this.request("GET", `/api/v1/jobs/${encodeURIComponent(jobId)}`);
  }

  public startPreview(input: PreviewRequest): Promise<JobRecord> {
    return this.request("POST", "/api/v1/previews", input);
  }

  public async downloadJobArtifact(
    jobId: string,
    artifactName: string,
  ): Promise<Blob> {
    const response = await fetch(
      `${this.baseUrl.replace(/\/$/, "")}/api/v1/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactName)}`,
      {
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: "*/*",
        },
      },
    );
    if (!response.ok) {
      let error: { code: string; message: string; details?: unknown[] } = {
        code: `HTTP_${response.status}`,
        message: response.statusText,
      };
      try {
        const envelope = (await response.json()) as ApiEnvelope<never>;
        if (envelope.error !== null) error = envelope.error;
      } catch {
        // The artifact endpoint may fail before a JSON body is produced.
      }
      throw new FrameOSApiError(
        error.code,
        error.message,
        response.status,
        error.details,
      );
    }
    return response.blob();
  }

  public cancelJob(jobId: string): Promise<JobRecord> {
    return this.request("DELETE", `/api/v1/jobs/${encodeURIComponent(jobId)}`);
  }

  public createAgentSession(
    input: CreateAgentSessionInput,
  ): Promise<AgentSession> {
    return this.request("POST", "/api/v1/agents/sessions", input);
  }

  public planEdit(sessionId: string, request: string): Promise<AgentRun> {
    return this.request("POST", "/api/v1/agents/runs", { sessionId, request });
  }

  public executeAgentRun(
    runId: string,
    operations: Operation[],
  ): Promise<AgentExecutionResult> {
    return this.request(
      "POST",
      `/api/v1/agents/runs/${encodeURIComponent(runId)}/execute`,
      { operations },
    );
  }

  public evaluateAgentRun(runId: string): Promise<AgentEvaluation> {
    return this.request(
      "POST",
      `/api/v1/agents/runs/${encodeURIComponent(runId)}/evaluate`,
    );
  }

  public listAgentEvaluations(runId: string): Promise<AgentEvaluation[]> {
    return this.request(
      "GET",
      `/api/v1/agents/runs/${encodeURIComponent(runId)}/evaluations`,
    );
  }

  public reviseAgentRun(
    runId: string,
    operations: Operation[],
  ): Promise<AgentRevisionResult> {
    return this.request(
      "POST",
      `/api/v1/agents/runs/${encodeURIComponent(runId)}/revise`,
      { operations },
    );
  }

  public listApprovals(input?: {
    projectId?: string;
    status?: Approval["status"];
  }): Promise<Approval[]> {
    const query = new URLSearchParams();
    if (input?.projectId !== undefined) query.set("projectId", input.projectId);
    if (input?.status !== undefined) query.set("status", input.status);
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    return this.request("GET", `/api/v1/approvals${suffix}`);
  }

  public decideApproval(
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<{
    approval: Approval;
    run: AgentRun;
    transaction?: TransactionResult;
  }> {
    return this.request(
      "POST",
      `/api/v1/approvals/${encodeURIComponent(approvalId)}/decision`,
      decision,
    );
  }
}
