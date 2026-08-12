#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface CliContext {
  baseUrl: string;
  token: string;
}

interface ApiEnvelope {
  data: unknown;
  error: { code: string; message: string; details?: unknown[] } | null;
  meta: Record<string, unknown>;
}

function usage(): never {
  process.stderr.write(`FrameOS CLI

Usage:
  frameos projects list
  frameos projects create <name>
  frameos project inspect <project-id> [revision]
  frameos capabilities [search]
  frameos operations [search]
  frameos analyzers
  frameos asset import <project-id> <path-or-file-uri> [managed]
  frameos analyze <project-id> <asset-id> <analyzer-id> [analyzer-id...]
  frameos search <project-id> <query>
  frameos transaction <request.json>
  frameos otio import <timeline.otio> [project-name]
  frameos otio export <project-id> [sequence-id] [revision]
  frameos render <project-id> <output-name> [sequence-id]
  frameos preview <request.json>
  frameos job <job-id>

Environment:
  FRAMEOS_URL         daemon URL (default http://127.0.0.1:31415)
  FRAMEOS_AUTH_TOKEN  bearer token (otherwise read .frameos-data/auth-token)
  FRAMEOS_DATA_DIR    local data directory containing auth-token
`);
  process.exit(2);
}

async function context(): Promise<CliContext> {
  const dataDirectory = resolve(
    process.env.FRAMEOS_DATA_DIR ?? ".frameos-data",
  );
  const configuredToken = process.env.FRAMEOS_AUTH_TOKEN;
  const token: string =
    configuredToken === undefined
      ? (await readFile(resolve(dataDirectory, "auth-token"), "utf8")).trim()
      : configuredToken;
  return {
    baseUrl: (process.env.FRAMEOS_URL ?? "http://127.0.0.1:31415").replace(
      /\/$/,
      "",
    ),
    token,
  };
}

async function request(
  ctx: CliContext,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${ctx.token}`,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const envelope = (await response.json()) as ApiEnvelope;
  if (!response.ok || envelope.error !== null) {
    const error = envelope.error ?? {
      code: `HTTP_${response.status}`,
      message: response.statusText,
    };
    throw new Error(`${error.code}: ${error.message}`);
  }
  return envelope.data;
}

async function main(args: string[]): Promise<void> {
  const [group, action, ...rest] = args;
  if (
    group === undefined ||
    group === "help" ||
    group === "--help" ||
    group === "-h"
  )
    usage();
  const ctx = await context();
  let result: unknown;

  if (group === "projects" && action === "list") {
    result = await request(ctx, "GET", "/api/v1/projects");
  } else if (group === "projects" && action === "create") {
    const name = rest.join(" ").trim();
    if (name.length === 0) usage();
    result = await request(ctx, "POST", "/api/v1/projects", { name });
  } else if (group === "project" && action === "inspect") {
    const [projectId, revision] = rest;
    if (projectId === undefined) usage();
    const path =
      revision === undefined
        ? `/api/v1/projects/${encodeURIComponent(projectId)}`
        : `/api/v1/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revision)}`;
    result = await request(ctx, "GET", path);
  } else if (group === "capabilities") {
    const search = [action, ...rest]
      .filter((value): value is string => value !== undefined)
      .join(" ");
    result = await request(
      ctx,
      "GET",
      `/api/v1/capabilities${search === "" ? "" : `?search=${encodeURIComponent(search)}`}`,
    );
  } else if (group === "operations") {
    const search = [action, ...rest]
      .filter((value): value is string => value !== undefined)
      .join(" ");
    result = await request(
      ctx,
      "GET",
      `/api/v1/operations${search === "" ? "" : `?search=${encodeURIComponent(search)}`}`,
    );
  } else if (group === "analyzers") {
    if (action !== undefined) usage();
    result = await request(ctx, "GET", "/api/v1/analysis/analyzers");
  } else if (group === "asset" && action === "import") {
    const [projectId, uri, managedValue] = rest;
    if (
      projectId === undefined ||
      uri === undefined ||
      (managedValue !== undefined && managedValue !== "managed")
    )
      usage();
    const project = (await request(
      ctx,
      "GET",
      `/api/v1/projects/${encodeURIComponent(projectId)}`,
    )) as { revision: number };
    result = await request(ctx, "POST", "/api/v1/assets/imports", {
      projectId,
      baseRevision: project.revision,
      idempotencyKey: `cli-import-${randomUUID()}`,
      uri,
      managed: managedValue === "managed",
    });
  } else if (group === "analyze") {
    const projectId = action;
    const [assetId, ...analyzers] = rest;
    if (
      projectId === undefined ||
      assetId === undefined ||
      analyzers.length === 0
    )
      usage();
    result = await request(
      ctx,
      "POST",
      `/api/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/analysis`,
      { projectId, assetId, analyzers, parameters: {}, force: false },
    );
  } else if (group === "search") {
    const projectId = action;
    const query = rest.join(" ").trim();
    if (projectId === undefined || query === "") usage();
    result = await request(ctx, "POST", "/api/v1/assets/search", {
      projectId,
      query,
      mode: "lexical",
      limit: 50,
    });
  } else if (group === "transaction") {
    const path = action;
    if (path === undefined || rest.length > 0) usage();
    result = await request(
      ctx,
      "POST",
      "/api/v1/transactions",
      JSON.parse(await readFile(resolve(path), "utf8")),
    );
  } else if (group === "otio" && action === "import") {
    const [path, ...projectNameParts] = rest;
    if (path === undefined) usage();
    const projectName = projectNameParts.join(" ").trim();
    result = await request(ctx, "POST", "/api/v1/imports/otio", {
      document: JSON.parse(await readFile(resolve(path), "utf8")),
      ...(projectName === "" ? {} : { projectName }),
    });
  } else if (group === "otio" && action === "export") {
    const [projectId, sequenceId, revisionValue] = rest;
    if (projectId === undefined) usage();
    const revision =
      revisionValue === undefined ? undefined : Number(revisionValue);
    if (revision !== undefined && !Number.isSafeInteger(revision)) usage();
    result = await request(ctx, "POST", "/api/v1/exports/otio", {
      projectId,
      ...(sequenceId === undefined ? {} : { sequenceId }),
      ...(revision === undefined ? {} : { revision }),
    });
  } else if (group === "render") {
    const projectId = action;
    const [outputName, sequenceId] = rest;
    if (projectId === undefined || outputName === undefined) usage();
    result = await request(ctx, "POST", "/api/v1/renders", {
      projectId,
      outputName,
      ...(sequenceId === undefined ? {} : { sequenceId }),
    });
  } else if (group === "preview") {
    const path = action;
    if (path === undefined || rest.length > 0) usage();
    result = await request(
      ctx,
      "POST",
      "/api/v1/previews",
      JSON.parse(await readFile(resolve(path), "utf8")),
    );
  } else if (group === "job") {
    const jobId = action;
    if (jobId === undefined || rest.length > 0) usage();
    result = await request(
      ctx,
      "GET",
      `/api/v1/jobs/${encodeURIComponent(jobId)}`,
    );
  } else {
    usage();
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`frameos: ${message}\n`);
  process.exitCode = 1;
});
