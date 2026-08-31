-- FrameOS runtime state. Project documents remain lossless JSON bundles on
-- disk; this schema stores jobs, agent state, usage, and derived search data.
-- The daemon connects with a server-only Postgres URL. No table is exposed via
-- the Supabase Data API and no browser receives database credentials.

create schema if not exists frameos;

revoke all on schema frameos from public, anon, authenticated;

create table if not exists frameos.jobs (
  id text primary key,
  project_id text not null,
  project_revision bigint not null check (project_revision >= 0),
  kind text not null,
  status text not null,
  progress double precision not null check (progress between 0 and 1),
  input_json jsonb not null,
  idempotency_key text,
  output_json jsonb,
  error_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_project_updated_idx on frameos.jobs (project_id, updated_at desc);
create unique index if not exists jobs_idempotency_idx on frameos.jobs (project_id, kind, idempotency_key) where idempotency_key is not null;

create table if not exists frameos.agent_sessions (
  id text primary key,
  project_id text not null,
  provider text not null,
  model text not null,
  approval_mode text not null,
  budgets_json jsonb not null,
  allowed_families_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_sessions_project_idx on frameos.agent_sessions (project_id, updated_at desc);

create table if not exists frameos.agent_runs (
  id text primary key,
  session_id text not null references frameos.agent_sessions(id) on delete restrict,
  project_id text not null,
  project_revision bigint not null check (project_revision >= 0),
  request text not null,
  state text not null,
  plan_json jsonb,
  provider_response_id text,
  draft_id text,
  transaction_id text,
  approval_id text,
  resulting_revision bigint check (resulting_revision is null or resulting_revision >= 0),
  preview_cycles integer not null default 0 check (preview_cycles >= 0),
  error_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_runs_session_idx on frameos.agent_runs (session_id, updated_at desc);

create table if not exists frameos.approvals (
  id text primary key,
  run_id text not null references frameos.agent_runs(id) on delete restrict,
  session_id text not null references frameos.agent_sessions(id) on delete restrict,
  project_id text not null,
  draft_id text not null,
  status text not null,
  requested_at timestamptz not null,
  decided_at timestamptz,
  decided_by text,
  note text
);
create index if not exists approvals_project_status_idx on frameos.approvals (project_id, status, requested_at desc);

create table if not exists frameos.agent_evaluations (
  id text primary key,
  run_id text not null references frameos.agent_runs(id) on delete restrict,
  project_id text not null,
  draft_id text not null,
  cycle integer not null check (cycle >= 0),
  passed boolean not null,
  checks_json jsonb not null,
  previews_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, cycle)
);
create index if not exists agent_evaluations_run_idx on frameos.agent_evaluations (run_id, cycle);

create table if not exists frameos.provider_usage (
  id text primary key,
  session_id text not null references frameos.agent_sessions(id) on delete restrict,
  run_id text not null references frameos.agent_runs(id) on delete restrict,
  project_id text not null,
  provider text not null,
  model text not null,
  operation text not null,
  input_tokens bigint not null check (input_tokens >= 0),
  cached_input_tokens bigint not null check (cached_input_tokens between 0 and input_tokens),
  output_tokens bigint not null check (output_tokens >= 0),
  total_tokens bigint not null check (total_tokens >= 0),
  estimated_cost_usd numeric(18, 9),
  pricing_source text,
  provider_response_id text,
  created_at timestamptz not null default now()
);
create index if not exists provider_usage_created_idx on frameos.provider_usage (created_at desc);
create index if not exists provider_usage_session_idx on frameos.provider_usage (session_id, created_at desc);

create table if not exists frameos.analysis_usage (
  id text primary key,
  project_id text not null,
  provider text not null,
  model text not null,
  operation text not null,
  input_tokens bigint not null check (input_tokens >= 0),
  cached_input_tokens bigint not null check (cached_input_tokens between 0 and input_tokens),
  output_tokens bigint not null check (output_tokens >= 0),
  total_tokens bigint not null check (total_tokens >= 0),
  estimated_cost_usd numeric(18, 9),
  pricing_source text,
  provider_response_id text,
  created_at timestamptz not null default now()
);
create index if not exists analysis_usage_created_idx on frameos.analysis_usage (created_at desc);
create index if not exists analysis_usage_project_idx on frameos.analysis_usage (project_id, created_at desc);

create table if not exists frameos.analysis_cache (
  cache_key text primary key,
  project_id text not null,
  asset_id text not null,
  artifact_id text not null,
  artifact_json jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists analysis_cache_project_asset_idx on frameos.analysis_cache (project_id, asset_id);

create table if not exists frameos.analysis_segments (
  segment_id text primary key,
  project_id text not null,
  asset_id text not null,
  artifact_id text not null,
  type text not null,
  range_json jsonb,
  text_value text,
  labels_json jsonb not null,
  speaker text,
  confidence double precision check (confidence between 0 and 1),
  metadata_json jsonb not null,
  embedding_json jsonb,
  search_document tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(text_value, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(labels_json::text, '')), 'B')
  ) stored
);
create index if not exists analysis_segments_project_asset_idx on frameos.analysis_segments (project_id, asset_id);
create index if not exists analysis_segments_artifact_idx on frameos.analysis_segments (artifact_id);
create index if not exists analysis_segments_search_idx on frameos.analysis_segments using gin (search_document);

comment on schema frameos is 'FrameOS daemon-private runtime and search data.';
