import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  FrameOSError,
  analysisArtifactSchema,
  analysisDocumentSchema,
  agentEvaluationSchema,
  approvalSchema,
  agentRunSchema,
  agentSessionSchema,
  createId,
  type AgentBudget,
  type AgentEvaluation,
  type AgentEvaluationCheck,
  type AnalysisArtifact,
  type AnalysisDocument,
  type AgentProviderKind,
  type AgentRun,
  type AgentRunState,
  type AgentSession,
  type ApprovalMode,
  type Approval,
  type ApprovalDecision,
  type EditPlan,
  type JobKind,
  type JobRecord,
  type JobStatus,
} from "@frameos/contracts";

export type { JobKind, JobRecord, JobStatus } from "@frameos/contracts";

interface JobRow {
  id: string;
  project_id: string;
  project_revision: number;
  kind: string;
  status: string;
  progress: number;
  input_json: string;
  idempotency_key: string | null;
  output_json: string | null;
  error_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderUsageRecord {
  id: string;
  sessionId: string;
  runId: string;
  projectId: string;
  provider: AgentProviderKind;
  model: string;
  operation: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  pricingSource?: string;
  providerResponseId?: string;
  createdAt: string;
}

export interface ProviderUsageSummary {
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  unpricedRequests: number;
}

export interface AnalysisUsageRecord {
  id: string;
  projectId: string;
  provider: "gemini";
  model: string;
  operation: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  pricingSource?: string;
  providerResponseId?: string;
  createdAt: string;
}

export interface AnalysisIndexRow {
  segmentId: string;
  projectId: string;
  assetId: string;
  artifactId: string;
  type: string;
  range?: unknown;
  text?: string;
  labels: string[];
  speaker?: string;
  confidence?: number;
  metadata: Record<string, unknown>;
  embedding?: number[];
  rank?: number;
}

interface AnalysisSegmentRow {
  segment_id: string;
  project_id: string;
  asset_id: string;
  artifact_id: string;
  type: string;
  range_json: string | null;
  text_value: string | null;
  labels_json: string;
  speaker: string | null;
  confidence: number | null;
  metadata_json: string;
  embedding_json: string | null;
  rank?: number;
}

function rowToAnalysisIndex(row: AnalysisSegmentRow): AnalysisIndexRow {
  return {
    segmentId: row.segment_id,
    projectId: row.project_id,
    assetId: row.asset_id,
    artifactId: row.artifact_id,
    type: row.type,
    ...(row.range_json === null
      ? {}
      : { range: JSON.parse(row.range_json) as unknown }),
    ...(row.text_value === null ? {} : { text: row.text_value }),
    labels: JSON.parse(row.labels_json) as string[],
    ...(row.speaker === null ? {} : { speaker: row.speaker }),
    ...(row.confidence === null ? {} : { confidence: row.confidence }),
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    ...(row.embedding_json === null
      ? {}
      : { embedding: JSON.parse(row.embedding_json) as number[] }),
    ...(row.rank === undefined ? {} : { rank: row.rank }),
  };
}

function rowToJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    projectRevision: row.project_revision,
    kind: row.kind as JobKind,
    status: row.status as JobStatus,
    progress: row.progress,
    input: JSON.parse(row.input_json) as Record<string, unknown>,
    ...(row.output_json === null
      ? {}
      : { output: JSON.parse(row.output_json) as Record<string, unknown> }),
    ...(row.error_json === null
      ? {}
      : {
          error: JSON.parse(row.error_json) as {
            code: string;
            message: string;
          },
        }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class RuntimeDatabase {
  private database: DatabaseSync | undefined;
  private analysisFtsAvailable = false;

  public constructor(private readonly path: string) {}

  public async initialize(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    this.database = new DatabaseSync(this.path);
    this.database.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        project_revision INTEGER NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        progress REAL NOT NULL,
        input_json TEXT NOT NULL,
        idempotency_key TEXT,
        output_json TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jobs_project_updated_idx ON jobs(project_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        approval_mode TEXT NOT NULL,
        budgets_json TEXT NOT NULL,
        allowed_families_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_sessions_project_idx ON agent_sessions(project_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id),
        project_id TEXT NOT NULL,
        project_revision INTEGER NOT NULL,
        request TEXT NOT NULL,
        state TEXT NOT NULL,
        plan_json TEXT,
        provider_response_id TEXT,
        draft_id TEXT,
        transaction_id TEXT,
        approval_id TEXT,
        resulting_revision INTEGER,
        preview_cycles INTEGER NOT NULL DEFAULT 0,
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_runs_session_idx ON agent_runs(session_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES agent_runs(id),
        session_id TEXT NOT NULL REFERENCES agent_sessions(id),
        project_id TEXT NOT NULL,
        draft_id TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        decided_at TEXT,
        decided_by TEXT,
        note TEXT
      );
      CREATE INDEX IF NOT EXISTS approvals_project_status_idx ON approvals(project_id, status, requested_at DESC);
      CREATE TABLE IF NOT EXISTS agent_evaluations (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES agent_runs(id),
        project_id TEXT NOT NULL,
        draft_id TEXT NOT NULL,
        cycle INTEGER NOT NULL,
        passed INTEGER NOT NULL,
        checks_json TEXT NOT NULL,
        previews_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        UNIQUE(run_id, cycle)
      );
      CREATE INDEX IF NOT EXISTS agent_evaluations_run_idx ON agent_evaluations(run_id, cycle);
      CREATE TABLE IF NOT EXISTS provider_usage (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id),
        run_id TEXT NOT NULL REFERENCES agent_runs(id),
        project_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        operation TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        cached_input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        estimated_cost_usd REAL,
        pricing_source TEXT,
        provider_response_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS provider_usage_created_idx ON provider_usage(created_at DESC);
      CREATE INDEX IF NOT EXISTS provider_usage_session_idx ON provider_usage(session_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS analysis_usage (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        operation TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        cached_input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        estimated_cost_usd REAL,
        pricing_source TEXT,
        provider_response_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS analysis_usage_created_idx ON analysis_usage(created_at DESC);
      CREATE INDEX IF NOT EXISTS analysis_usage_project_idx ON analysis_usage(project_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS analysis_cache (
        cache_key TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        artifact_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS analysis_cache_project_asset_idx ON analysis_cache(project_id, asset_id);
      CREATE TABLE IF NOT EXISTS analysis_segments (
        segment_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        type TEXT NOT NULL,
        range_json TEXT,
        text_value TEXT,
        labels_json TEXT NOT NULL,
        speaker TEXT,
        confidence REAL,
        metadata_json TEXT NOT NULL,
        embedding_json TEXT
      );
      CREATE INDEX IF NOT EXISTS analysis_segments_project_asset_idx ON analysis_segments(project_id, asset_id);
      CREATE INDEX IF NOT EXISTS analysis_segments_artifact_idx ON analysis_segments(artifact_id);
    `);
    const jobColumns = new Set(
      (
        this.database
          .prepare("PRAGMA table_info(jobs)")
          .all() as unknown as Array<{
          name: string;
        }>
      ).map((column) => column.name),
    );
    if (!jobColumns.has("idempotency_key")) {
      this.database.exec("ALTER TABLE jobs ADD COLUMN idempotency_key TEXT");
    }
    this.database.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS jobs_idempotency_idx ON jobs(project_id, kind, idempotency_key) WHERE idempotency_key IS NOT NULL",
    );
    try {
      this.database.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS analysis_segments_fts USING fts5(
          segment_id UNINDEXED,
          project_id UNINDEXED,
          asset_id UNINDEXED,
          artifact_id UNINDEXED,
          text_value,
          labels
        );
      `);
      this.analysisFtsAvailable = true;
    } catch {
      this.analysisFtsAvailable = false;
    }
    const runColumns = new Set(
      (
        this.database
          .prepare("PRAGMA table_info(agent_runs)")
          .all() as unknown as Array<{ name: string }>
      ).map((column) => column.name),
    );
    for (const [column, type] of [
      ["draft_id", "TEXT"],
      ["transaction_id", "TEXT"],
      ["approval_id", "TEXT"],
      ["resulting_revision", "INTEGER"],
      ["preview_cycles", "INTEGER NOT NULL DEFAULT 0"],
    ] as const) {
      if (!runColumns.has(column))
        this.database.exec(
          `ALTER TABLE agent_runs ADD COLUMN ${column} ${type}`,
        );
    }
    const evaluationColumns = new Set(
      (
        this.database
          .prepare("PRAGMA table_info(agent_evaluations)")
          .all() as unknown as Array<{ name: string }>
      ).map((column) => column.name),
    );
    if (!evaluationColumns.has("previews_json")) {
      this.database.exec(
        "ALTER TABLE agent_evaluations ADD COLUMN previews_json TEXT NOT NULL DEFAULT '[]'",
      );
    }
  }

  private db(): DatabaseSync {
    if (this.database === undefined) {
      throw new Error("Runtime database was not initialized");
    }
    return this.database;
  }

  public createJob(
    projectId: string,
    projectRevision: number,
    kind: JobKind,
    input: Record<string, unknown>,
    idempotencyKey?: string,
  ): JobRecord {
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: createId(),
      projectId,
      projectRevision,
      kind,
      status: "queued",
      progress: 0,
      input,
      createdAt: now,
      updatedAt: now,
    };
    this.db()
      .prepare(
        "INSERT INTO jobs (id, project_id, project_revision, kind, status, progress, input_json, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        job.id,
        job.projectId,
        job.projectRevision,
        job.kind,
        job.status,
        job.progress,
        JSON.stringify(job.input),
        idempotencyKey ?? null,
        job.createdAt,
        job.updatedAt,
      );
    return job;
  }

  public findIdempotentJob(
    projectId: string,
    kind: JobKind,
    idempotencyKey: string,
  ): JobRecord | undefined {
    const row = this.db()
      .prepare(
        "SELECT * FROM jobs WHERE project_id = ? AND kind = ? AND idempotency_key = ?",
      )
      .get(projectId, kind, idempotencyKey) as unknown as JobRow | undefined;
    return row === undefined ? undefined : rowToJob(row);
  }

  public getJob(id: string): JobRecord {
    const row = this.db()
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .get(id) as unknown as JobRow | undefined;
    if (row === undefined) {
      throw new FrameOSError("NOT_FOUND", `Job ${id} was not found`, 404);
    }
    return rowToJob(row);
  }

  public listJobs(projectId?: string): JobRecord[] {
    const rows = (projectId === undefined
      ? this.db()
          .prepare("SELECT * FROM jobs ORDER BY updated_at DESC LIMIT 500")
          .all()
      : this.db()
          .prepare(
            "SELECT * FROM jobs WHERE project_id = ? ORDER BY updated_at DESC LIMIT 500",
          )
          .all(projectId)) as unknown as JobRow[];
    return rows.map(rowToJob);
  }

  public updateJob(
    id: string,
    values: {
      status?: JobStatus;
      progress?: number;
      output?: Record<string, unknown> | null;
      error?: { code: string; message: string } | null;
    },
  ): JobRecord {
    const current = this.getJob(id);
    const next: JobRecord = {
      ...current,
      status: values.status ?? current.status,
      progress: values.progress ?? current.progress,
      ...(values.output === undefined
        ? current.output === undefined
          ? {}
          : { output: current.output }
        : values.output === null
          ? {}
          : { output: values.output }),
      ...(values.error === undefined
        ? current.error === undefined
          ? {}
          : { error: current.error }
        : values.error === null
          ? {}
          : { error: values.error }),
      updatedAt: new Date().toISOString(),
    };
    this.db()
      .prepare(
        "UPDATE jobs SET status = ?, progress = ?, output_json = ?, error_json = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        next.status,
        next.progress,
        next.output === undefined ? null : JSON.stringify(next.output),
        next.error === undefined ? null : JSON.stringify(next.error),
        next.updatedAt,
        id,
      );
    return next;
  }

  public analysisSearchBackend(): "fts5+flat-cosine" | "like+flat-cosine" {
    return this.analysisFtsAvailable ? "fts5+flat-cosine" : "like+flat-cosine";
  }

  public getCachedAnalysis(cacheKey: string): AnalysisArtifact | undefined {
    const row = this.db()
      .prepare("SELECT artifact_json FROM analysis_cache WHERE cache_key = ?")
      .get(cacheKey) as { artifact_json: string } | undefined;
    return row === undefined
      ? undefined
      : analysisArtifactSchema.parse(JSON.parse(row.artifact_json));
  }

  public putCachedAnalysis(
    cacheKey: string,
    projectId: string,
    assetId: string,
    artifact: AnalysisArtifact,
  ): void {
    const parsed = analysisArtifactSchema.parse(artifact);
    this.db()
      .prepare(
        "INSERT INTO analysis_cache (cache_key, project_id, asset_id, artifact_id, artifact_json, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET artifact_id = excluded.artifact_id, artifact_json = excluded.artifact_json, created_at = excluded.created_at",
      )
      .run(
        cacheKey,
        projectId,
        assetId,
        parsed.id,
        JSON.stringify(parsed),
        new Date().toISOString(),
      );
  }

  public indexAnalysisDocument(document: AnalysisDocument): void {
    const parsed = analysisDocumentSchema.parse(document);
    const database = this.db();
    database.exec("BEGIN IMMEDIATE");
    try {
      database
        .prepare("DELETE FROM analysis_segments WHERE artifact_id = ?")
        .run(parsed.artifactId);
      if (this.analysisFtsAvailable) {
        database
          .prepare("DELETE FROM analysis_segments_fts WHERE artifact_id = ?")
          .run(parsed.artifactId);
      }
      const insert = database.prepare(
        "INSERT INTO analysis_segments (segment_id, project_id, asset_id, artifact_id, type, range_json, text_value, labels_json, speaker, confidence, metadata_json, embedding_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      const insertFts = this.analysisFtsAvailable
        ? database.prepare(
            "INSERT INTO analysis_segments_fts (segment_id, project_id, asset_id, artifact_id, text_value, labels) VALUES (?, ?, ?, ?, ?, ?)",
          )
        : undefined;
      for (const segment of parsed.segments) {
        insert.run(
          segment.id,
          parsed.projectId,
          parsed.assetId,
          parsed.artifactId,
          parsed.type,
          segment.range === undefined ? null : JSON.stringify(segment.range),
          segment.text ?? null,
          JSON.stringify(segment.labels),
          segment.speaker ?? null,
          segment.confidence ?? null,
          JSON.stringify(segment.metadata),
          segment.embedding === undefined
            ? null
            : JSON.stringify(segment.embedding),
        );
        insertFts?.run(
          segment.id,
          parsed.projectId,
          parsed.assetId,
          parsed.artifactId,
          segment.text ?? "",
          segment.labels.join(" "),
        );
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  public removeAnalysisIndex(artifactId: string): void {
    this.db()
      .prepare("DELETE FROM analysis_segments WHERE artifact_id = ?")
      .run(artifactId);
    if (this.analysisFtsAvailable) {
      this.db()
        .prepare("DELETE FROM analysis_segments_fts WHERE artifact_id = ?")
        .run(artifactId);
    }
  }

  public searchAnalysisText(
    projectId: string,
    query: string,
    limit: number,
  ): AnalysisIndexRow[] {
    const tokens = query
      .normalize("NFKC")
      .split(/\s+/u)
      .map((token) => token.replaceAll('"', "").trim())
      .filter(Boolean)
      .slice(0, 32);
    if (tokens.length === 0) {
      const rows = this.db()
        .prepare(
          "SELECT * FROM analysis_segments WHERE project_id = ? ORDER BY rowid DESC LIMIT ?",
        )
        .all(projectId, limit) as unknown as AnalysisSegmentRow[];
      return rows.map(rowToAnalysisIndex);
    }
    if (this.analysisFtsAvailable) {
      const match = tokens.map((token) => `"${token}"`).join(" OR ");
      const rows = this.db()
        .prepare(
          "SELECT s.*, bm25(analysis_segments_fts) AS rank FROM analysis_segments_fts JOIN analysis_segments s ON s.segment_id = analysis_segments_fts.segment_id WHERE analysis_segments_fts MATCH ? AND analysis_segments_fts.project_id = ? ORDER BY rank LIMIT ?",
        )
        .all(match, projectId, limit) as unknown as AnalysisSegmentRow[];
      return rows.map(rowToAnalysisIndex);
    }
    const pattern = `%${tokens.join(" ").toLowerCase()}%`;
    const rows = this.db()
      .prepare(
        "SELECT * FROM analysis_segments WHERE project_id = ? AND lower(coalesce(text_value, '') || ' ' || labels_json) LIKE ? ORDER BY rowid DESC LIMIT ?",
      )
      .all(projectId, pattern, limit) as unknown as AnalysisSegmentRow[];
    return rows.map(rowToAnalysisIndex);
  }

  public listAnalysisVectors(
    projectId: string,
    limit = 100_000,
  ): AnalysisIndexRow[] {
    const rows = this.db()
      .prepare(
        "SELECT * FROM analysis_segments WHERE project_id = ? AND embedding_json IS NOT NULL ORDER BY rowid DESC LIMIT ?",
      )
      .all(projectId, limit) as unknown as AnalysisSegmentRow[];
    return rows.map(rowToAnalysisIndex);
  }

  public createAgentSession(input: {
    projectId: string;
    provider: AgentProviderKind;
    model: string;
    approvalMode: ApprovalMode;
    budgets: AgentBudget;
    allowedOperationFamilies: string[];
  }): AgentSession {
    const now = new Date().toISOString();
    const session = agentSessionSchema.parse({
      id: createId(),
      ...input,
      createdAt: now,
      updatedAt: now,
    });
    this.db()
      .prepare(
        "INSERT INTO agent_sessions (id, project_id, provider, model, approval_mode, budgets_json, allowed_families_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        session.id,
        session.projectId,
        session.provider,
        session.model,
        session.approvalMode,
        JSON.stringify(session.budgets),
        JSON.stringify(session.allowedOperationFamilies),
        session.createdAt,
        session.updatedAt,
      );
    return session;
  }

  public recordProviderUsage(
    input: Omit<ProviderUsageRecord, "id" | "createdAt">,
  ): ProviderUsageRecord {
    const record: ProviderUsageRecord = {
      id: createId(),
      ...input,
      createdAt: new Date().toISOString(),
    };
    this.db()
      .prepare(
        "INSERT INTO provider_usage (id, session_id, run_id, project_id, provider, model, operation, input_tokens, cached_input_tokens, output_tokens, total_tokens, estimated_cost_usd, pricing_source, provider_response_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.id,
        record.sessionId,
        record.runId,
        record.projectId,
        record.provider,
        record.model,
        record.operation,
        record.inputTokens,
        record.cachedInputTokens,
        record.outputTokens,
        record.totalTokens,
        record.estimatedCostUsd ?? null,
        record.pricingSource ?? null,
        record.providerResponseId ?? null,
        record.createdAt,
      );
    return record;
  }

  public recordAnalysisUsage(
    input: Omit<AnalysisUsageRecord, "id" | "createdAt">,
  ): AnalysisUsageRecord {
    const record: AnalysisUsageRecord = {
      id: createId(),
      ...input,
      createdAt: new Date().toISOString(),
    };
    this.db()
      .prepare(
        "INSERT INTO analysis_usage (id, project_id, provider, model, operation, input_tokens, cached_input_tokens, output_tokens, total_tokens, estimated_cost_usd, pricing_source, provider_response_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.id,
        record.projectId,
        record.provider,
        record.model,
        record.operation,
        record.inputTokens,
        record.cachedInputTokens,
        record.outputTokens,
        record.totalTokens,
        record.estimatedCostUsd ?? null,
        record.pricingSource ?? null,
        record.providerResponseId ?? null,
        record.createdAt,
      );
    return record;
  }

  public listAnalysisUsage(
    input: { projectId?: string; limit?: number } = {},
  ): AnalysisUsageRecord[] {
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];
    if (input.projectId !== undefined) {
      clauses.push("project_id = ?");
      parameters.push(input.projectId);
    }
    const where = clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`;
    parameters.push(Math.min(Math.max(input.limit ?? 200, 1), 2_000));
    const rows = this.db()
      .prepare(
        `SELECT * FROM analysis_usage${where} ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...parameters) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      projectId: String(row.project_id),
      provider: "gemini",
      model: String(row.model),
      operation: String(row.operation),
      inputTokens: Number(row.input_tokens),
      cachedInputTokens: Number(row.cached_input_tokens),
      outputTokens: Number(row.output_tokens),
      totalTokens: Number(row.total_tokens),
      ...(row.estimated_cost_usd === null
        ? {}
        : { estimatedCostUsd: Number(row.estimated_cost_usd) }),
      ...(row.pricing_source === null
        ? {}
        : { pricingSource: String(row.pricing_source) }),
      ...(row.provider_response_id === null
        ? {}
        : { providerResponseId: String(row.provider_response_id) }),
      createdAt: String(row.created_at),
    }));
  }

  public summarizeAnalysisUsage(
    input: { projectId?: string } = {},
  ): ProviderUsageSummary {
    const clauses: string[] = [];
    const parameters: string[] = [];
    if (input.projectId !== undefined) {
      clauses.push("project_id = ?");
      parameters.push(input.projectId);
    }
    const where = clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`;
    const row = this.db()
      .prepare(
        `SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd, COALESCE(SUM(CASE WHEN estimated_cost_usd IS NULL THEN 1 ELSE 0 END), 0) AS unpriced_requests FROM analysis_usage${where}`,
      )
      .get(...parameters) as Record<string, unknown>;
    return {
      requests: Number(row.requests),
      inputTokens: Number(row.input_tokens),
      cachedInputTokens: Number(row.cached_input_tokens),
      outputTokens: Number(row.output_tokens),
      totalTokens: Number(row.total_tokens),
      estimatedCostUsd: Number(row.estimated_cost_usd),
      unpricedRequests: Number(row.unpriced_requests),
    };
  }

  public listProviderUsage(
    input: {
      projectId?: string;
      sessionId?: string;
      limit?: number;
    } = {},
  ): ProviderUsageRecord[] {
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];
    if (input.projectId !== undefined) {
      clauses.push("project_id = ?");
      parameters.push(input.projectId);
    }
    if (input.sessionId !== undefined) {
      clauses.push("session_id = ?");
      parameters.push(input.sessionId);
    }
    const where = clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`;
    parameters.push(Math.min(Math.max(input.limit ?? 200, 1), 2_000));
    const rows = this.db()
      .prepare(
        `SELECT * FROM provider_usage${where} ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...parameters) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      runId: String(row.run_id),
      projectId: String(row.project_id),
      provider: row.provider as AgentProviderKind,
      model: String(row.model),
      operation: String(row.operation),
      inputTokens: Number(row.input_tokens),
      cachedInputTokens: Number(row.cached_input_tokens),
      outputTokens: Number(row.output_tokens),
      totalTokens: Number(row.total_tokens),
      ...(row.estimated_cost_usd === null
        ? {}
        : { estimatedCostUsd: Number(row.estimated_cost_usd) }),
      ...(row.pricing_source === null
        ? {}
        : { pricingSource: String(row.pricing_source) }),
      ...(row.provider_response_id === null
        ? {}
        : { providerResponseId: String(row.provider_response_id) }),
      createdAt: String(row.created_at),
    }));
  }

  public summarizeProviderUsage(
    input: {
      projectId?: string;
      sessionId?: string;
    } = {},
  ): ProviderUsageSummary {
    const clauses: string[] = [];
    const parameters: string[] = [];
    if (input.projectId !== undefined) {
      clauses.push("project_id = ?");
      parameters.push(input.projectId);
    }
    if (input.sessionId !== undefined) {
      clauses.push("session_id = ?");
      parameters.push(input.sessionId);
    }
    const where = clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`;
    const row = this.db()
      .prepare(
        `SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd, COALESCE(SUM(CASE WHEN estimated_cost_usd IS NULL THEN 1 ELSE 0 END), 0) AS unpriced_requests FROM provider_usage${where}`,
      )
      .get(...parameters) as Record<string, unknown>;
    return {
      requests: Number(row.requests),
      inputTokens: Number(row.input_tokens),
      cachedInputTokens: Number(row.cached_input_tokens),
      outputTokens: Number(row.output_tokens),
      totalTokens: Number(row.total_tokens),
      estimatedCostUsd: Number(row.estimated_cost_usd),
      unpricedRequests: Number(row.unpriced_requests),
    };
  }

  public getAgentSession(id: string): AgentSession {
    const row = this.db()
      .prepare("SELECT * FROM agent_sessions WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (row === undefined)
      throw new FrameOSError(
        "NOT_FOUND",
        `Agent session ${id} was not found`,
        404,
      );
    return agentSessionSchema.parse({
      id: row.id,
      projectId: row.project_id,
      provider: row.provider,
      model: row.model,
      approvalMode: row.approval_mode,
      budgets: JSON.parse(String(row.budgets_json)),
      allowedOperationFamilies: JSON.parse(String(row.allowed_families_json)),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  public listAgentSessions(projectId?: string): AgentSession[] {
    const rows = (projectId === undefined
      ? this.db()
          .prepare(
            "SELECT id FROM agent_sessions ORDER BY updated_at DESC LIMIT 500",
          )
          .all()
      : this.db()
          .prepare(
            "SELECT id FROM agent_sessions WHERE project_id = ? ORDER BY updated_at DESC LIMIT 500",
          )
          .all(projectId)) as unknown as { id: string }[];
    return rows.map((row) => this.getAgentSession(row.id));
  }

  public createAgentRun(
    session: AgentSession,
    projectRevision: number,
    request: string,
  ): AgentRun {
    const now = new Date().toISOString();
    const run = agentRunSchema.parse({
      id: createId(),
      sessionId: session.id,
      projectId: session.projectId,
      projectRevision,
      request,
      state: "interpreting",
      createdAt: now,
      updatedAt: now,
    });
    this.db()
      .prepare(
        "INSERT INTO agent_runs (id, session_id, project_id, project_revision, request, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        run.id,
        run.sessionId,
        run.projectId,
        run.projectRevision,
        run.request,
        run.state,
        run.createdAt,
        run.updatedAt,
      );
    return run;
  }

  public getAgentRun(id: string): AgentRun {
    const row = this.db()
      .prepare("SELECT * FROM agent_runs WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (row === undefined)
      throw new FrameOSError("NOT_FOUND", `Agent run ${id} was not found`, 404);
    return agentRunSchema.parse({
      id: row.id,
      sessionId: row.session_id,
      projectId: row.project_id,
      projectRevision: row.project_revision,
      request: row.request,
      state: row.state,
      ...(row.plan_json === null
        ? {}
        : { plan: JSON.parse(String(row.plan_json)) }),
      ...(row.provider_response_id === null
        ? {}
        : { providerResponseId: row.provider_response_id }),
      ...(row.draft_id === null ? {} : { draftId: row.draft_id }),
      ...(row.transaction_id === null
        ? {}
        : { transactionId: row.transaction_id }),
      ...(row.approval_id === null ? {} : { approvalId: row.approval_id }),
      ...(row.resulting_revision === null
        ? {}
        : { resultingRevision: row.resulting_revision }),
      previewCycles: row.preview_cycles ?? 0,
      ...(row.error_json === null
        ? {}
        : { error: JSON.parse(String(row.error_json)) }),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  public updateAgentRun(
    id: string,
    values: {
      state: AgentRunState;
      plan?: EditPlan;
      providerResponseId?: string;
      draftId?: string;
      transactionId?: string;
      approvalId?: string;
      resultingRevision?: number;
      previewCycles?: number;
      error?: { code: string; message: string };
    },
  ): AgentRun {
    const current = this.getAgentRun(id);
    const updatedAt = new Date().toISOString();
    this.db()
      .prepare(
        "UPDATE agent_runs SET state = ?, plan_json = ?, provider_response_id = ?, draft_id = ?, transaction_id = ?, approval_id = ?, resulting_revision = ?, preview_cycles = ?, error_json = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        values.state,
        values.plan === undefined
          ? current.plan === undefined
            ? null
            : JSON.stringify(current.plan)
          : JSON.stringify(values.plan),
        values.providerResponseId ?? current.providerResponseId ?? null,
        values.draftId ?? current.draftId ?? null,
        values.transactionId ?? current.transactionId ?? null,
        values.approvalId ?? current.approvalId ?? null,
        values.resultingRevision ?? current.resultingRevision ?? null,
        values.previewCycles ?? current.previewCycles,
        values.error === undefined
          ? current.error === undefined
            ? null
            : JSON.stringify(current.error)
          : JSON.stringify(values.error),
        updatedAt,
        id,
      );
    return this.getAgentRun(id);
  }

  public createAgentEvaluation(input: {
    runId: string;
    projectId: string;
    draftId: string;
    cycle: number;
    checks: AgentEvaluationCheck[];
    previews?: AgentEvaluation["previews"];
  }): AgentEvaluation {
    const evaluation = agentEvaluationSchema.parse({
      id: createId(),
      ...input,
      passed: !input.checks.some((check) => check.status === "fail"),
      createdAt: new Date().toISOString(),
    });
    this.db()
      .prepare(
        "INSERT INTO agent_evaluations (id, run_id, project_id, draft_id, cycle, passed, checks_json, previews_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        evaluation.id,
        evaluation.runId,
        evaluation.projectId,
        evaluation.draftId,
        evaluation.cycle,
        evaluation.passed ? 1 : 0,
        JSON.stringify(evaluation.checks),
        JSON.stringify(evaluation.previews),
        evaluation.createdAt,
      );
    return evaluation;
  }

  public listAgentEvaluations(runId: string): AgentEvaluation[] {
    const rows = this.db()
      .prepare(
        "SELECT id, run_id, project_id, draft_id, cycle, passed, checks_json, previews_json, created_at FROM agent_evaluations WHERE run_id = ? ORDER BY cycle",
      )
      .all(runId) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) =>
      agentEvaluationSchema.parse({
        id: row.id,
        runId: row.run_id,
        projectId: row.project_id,
        draftId: row.draft_id,
        cycle: row.cycle,
        passed: Number(row.passed) === 1,
        checks: JSON.parse(String(row.checks_json)),
        previews: JSON.parse(String(row.previews_json ?? "[]")),
        createdAt: row.created_at,
      }),
    );
  }

  public createApproval(input: {
    runId: string;
    sessionId: string;
    projectId: string;
    draftId: string;
  }): Approval {
    const approval = approvalSchema.parse({
      id: createId(),
      ...input,
      status: "pending",
      requestedAt: new Date().toISOString(),
    });
    this.db()
      .prepare(
        "INSERT INTO approvals (id, run_id, session_id, project_id, draft_id, status, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        approval.id,
        approval.runId,
        approval.sessionId,
        approval.projectId,
        approval.draftId,
        approval.status,
        approval.requestedAt,
      );
    return approval;
  }

  public getApproval(id: string): Approval {
    const row = this.db()
      .prepare("SELECT * FROM approvals WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (row === undefined)
      throw new FrameOSError("NOT_FOUND", `Approval ${id} was not found`, 404);
    return approvalSchema.parse({
      id: row.id,
      runId: row.run_id,
      sessionId: row.session_id,
      projectId: row.project_id,
      draftId: row.draft_id,
      status: row.status,
      requestedAt: row.requested_at,
      ...(row.decided_at === null ? {} : { decidedAt: row.decided_at }),
      ...(row.decided_by === null ? {} : { decidedBy: row.decided_by }),
      ...(row.note === null ? {} : { note: row.note }),
    });
  }

  public listApprovals(
    projectId?: string,
    status?: Approval["status"],
  ): Approval[] {
    const clauses: string[] = [];
    const parameters: string[] = [];
    if (projectId !== undefined) {
      clauses.push("project_id = ?");
      parameters.push(projectId);
    }
    if (status !== undefined) {
      clauses.push("status = ?");
      parameters.push(status);
    }
    const where = clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`;
    const rows = this.db()
      .prepare(
        `SELECT id FROM approvals${where} ORDER BY requested_at DESC LIMIT 500`,
      )
      .all(...parameters) as unknown as Array<{ id: string }>;
    return rows.map((row) => this.getApproval(row.id));
  }

  public decideApproval(id: string, decision: ApprovalDecision): Approval {
    const current = this.getApproval(id);
    if (current.status !== "pending") {
      throw new FrameOSError(
        "REVISION_CONFLICT",
        `Approval ${id} was already ${current.status}`,
        409,
      );
    }
    this.db()
      .prepare(
        "UPDATE approvals SET status = ?, decided_at = ?, decided_by = ?, note = ? WHERE id = ? AND status = 'pending'",
      )
      .run(
        decision.decision === "approve" ? "approved" : "rejected",
        new Date().toISOString(),
        decision.decidedBy,
        decision.note ?? null,
        id,
      );
    return this.getApproval(id);
  }

  public close(): void {
    this.database?.close();
    this.database = undefined;
  }
}
