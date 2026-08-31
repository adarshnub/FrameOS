import { timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import {
  errorEnvelope,
  analysisSearchRequestSchema,
  assetAnalysisRequestSchema,
  assetImportRequestSchema,
  assetProxyRequestSchema,
  assetThumbnailRequestSchema,
  assetSchema,
  captionExportRequestSchema,
  captionImportRequestSchema,
  createId,
  executableOperationSchemas,
  FrameOSError,
  otioExportRequestSchema,
  otioImportRequestSchema,
  previewRequestSchema,
  semanticAddDynamicCaptionsRequestSchema,
  semanticCreateHighlightRequestSchema,
  semanticFindRequestSchema,
  semanticMakeVerticalRequestSchema,
  semanticMatchCutsToMusicRequestSchema,
  semanticRemoveSilencesRequestSchema,
  semanticSyncBrollRequestSchema,
  successEnvelope,
} from "@frameos/contracts";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { StreamableHTTPServerTransportOptions } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { createProject } from "../domain/project-factory.js";
import { createMcpServer } from "../mcp/server.js";
import type { FrameOSServices } from "../services/services.js";
import type {
  BearerTokenScope,
  DaemonConfig,
  ScopedBearerToken,
} from "../config.js";
import {
  inspectorCss,
  inspectorHtml,
  inspectorJavaScript,
} from "../inspector/page.js";
import { landingCss, landingHtml, landingJavaScript } from "../site/page.js";
import type { LogLevel } from "../observability/observability-service.js";

const createProjectInputSchema = z
  .object({
    name: z.string().min(1).max(1_024),
    width: z.int().positive().max(65_535).optional(),
    height: z.int().positive().max(65_535).optional(),
    frameRate: z
      .object({
        numerator: z.int().positive().max(1_000_000),
        denominator: z.int().positive().max(1_000_000),
      })
      .strict()
      .optional(),
    sampleRate: z.int().positive().max(768_000).optional(),
    channels: z.int().positive().max(128).optional(),
  })
  .strict();

const projectParamsSchema = z.object({ projectId: z.string().uuid() }).strict();
const revisionParamsSchema = projectParamsSchema
  .extend({ revision: z.coerce.number().int().nonnegative() })
  .strict();
const draftParamsSchema = projectParamsSchema
  .extend({ draftId: z.string().uuid() })
  .strict();
const jobParamsSchema = z.object({ jobId: z.string().uuid() }).strict();

function tokenMatches(
  header: string | undefined,
  expectedToken: string,
): boolean {
  if (header === undefined || !header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

function requestAuthorization(request: {
  headers: Record<string, string | string[] | undefined>;
}): string | undefined {
  if (typeof request.headers.authorization === "string")
    return request.headers.authorization;
  const protocols = request.headers["sec-websocket-protocol"];
  const values = Array.isArray(protocols)
    ? protocols
    : typeof protocols === "string"
      ? protocols.split(",")
      : [];
  const tokenProtocol = values
    .map((value) => value.trim())
    .find((value) => value.startsWith("frameos-token."));
  if (tokenProtocol === undefined) return undefined;
  try {
    return `Bearer ${Buffer.from(
      tokenProtocol.slice("frameos-token.".length),
      "base64url",
    ).toString("utf8")}`;
  } catch {
    return undefined;
  }
}

function requiredScope(url: string, method: string): BearerTokenScope {
  if (url.startsWith("/api/v1/admin")) return "admin";
  if (url.startsWith("/mcp")) return "mcp";
  if (url.startsWith("/api/v1/exports/")) return "project:read";
  if (
    url.startsWith("/api/v1/semantic/") ||
    url.startsWith("/api/v1/assets/search")
  )
    return "project:read";
  if (
    (url.startsWith("/api/v1/agents") || url.startsWith("/api/v1/approvals")) &&
    method !== "GET"
  )
    return "agent:run";
  if (
    url.startsWith("/api/v1/renders") ||
    url.startsWith("/api/v1/previews") ||
    url.includes("/thumbnails") ||
    (url.startsWith("/api/v1/jobs") && method === "DELETE")
  ) {
    return "render:write";
  }
  return method === "GET" ? "project:read" : "project:write";
}

function authorize(
  header: string | undefined,
  config: DaemonConfig,
  scope: BearerTokenScope,
): { id: string; scope: BearerTokenScope } {
  if (!config.remoteMode && tokenMatches(header, config.authToken))
    return { id: "local-install", scope };
  const matchingToken: ScopedBearerToken | undefined =
    config.scopedTokens?.find((candidate) =>
      tokenMatches(header, candidate.token),
    );
  if (matchingToken === undefined) {
    throw new FrameOSError(
      "UNAUTHORIZED",
      "A valid FrameOS bearer token is required",
      401,
    );
  }
  if (
    !matchingToken.scopes.includes("admin") &&
    !matchingToken.scopes.includes(scope)
  ) {
    throw new FrameOSError(
      "FORBIDDEN",
      `Bearer token does not grant ${scope}`,
      403,
    );
  }
  return { id: matchingToken.id, scope };
}

function isProtectedPath(url: string): boolean {
  return url.startsWith("/api/v1") || url.startsWith("/mcp");
}

function parseQueryString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export async function buildHttpServer(
  services: FrameOSServices,
): Promise<FastifyInstance> {
  const https =
    services.config.tlsCertificatePath === undefined ||
    services.config.tlsKeyPath === undefined
      ? undefined
      : {
          cert: await readFile(services.config.tlsCertificatePath),
          key: await readFile(services.config.tlsKeyPath),
          minVersion: "TLSv1.3" as const,
        };
  const app = Fastify({
    logger:
      process.env.NODE_ENV === "test"
        ? false
        : {
            level: process.env.FRAMEOS_LOG_LEVEL ?? "info",
            redact: [
              "req.headers.authorization",
              "req.headers.sec-websocket-protocol",
            ],
          },
    bodyLimit: 8 * 1_024 * 1_024,
    trustProxy: false,
    ...(https === undefined ? {} : { https }),
  });

  await app.register(rateLimit, {
    global: true,
    max: 240,
    timeWindow: "1 minute",
  });
  await app.register(websocket, { options: { maxPayload: 1 * 1_024 * 1_024 } });
  await app.register(multipart, {
    limits: { files: 1, fields: 0, fileSize: 20 * 1_024 * 1_024 * 1_024 },
  });

  const requestStartedAt = new WeakMap<object, bigint>();

  app.addHook("onRequest", async (request) => {
    requestStartedAt.set(request, process.hrtime.bigint());
    if (!isProtectedPath(request.url)) return;
    const grant = authorize(
      requestAuthorization(request),
      services.config,
      requiredScope(request.url, request.method),
    );
    if (services.config.remoteMode) {
      request.log.info(
        { tokenId: grant.id, scope: grant.scope },
        "authorized remote request",
      );
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestStartedAt.get(request);
    const durationMs =
      startedAt === undefined
        ? undefined
        : Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    services.observability.record({
      level: reply.statusCode >= 400 ? "error" : "success",
      category: "http",
      eventType: "http.request.completed",
      message: `${request.method} ${request.routeOptions.url} ${reply.statusCode.toString()}`,
      correlationId: request.id,
      ...(durationMs === undefined ? {} : { durationMs }),
      data: {
        method: request.method,
        route: request.routeOptions.url,
        statusCode: reply.statusCode,
      },
    });
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      void reply.status(422).send(
        errorEnvelope({
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        }),
      );
      return;
    }
    if (error instanceof FrameOSError) {
      void reply.status(error.statusCode).send(
        errorEnvelope({
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        }),
      );
      return;
    }
    requestLog(reply, error);
    void reply.status(500).send(
      errorEnvelope({
        code: "INTERNAL_ERROR",
        message: "FrameOS request failed",
      }),
    );
  });

  app.get("/health", async () =>
    successEnvelope({ status: "ok", version: "0.1.0" }),
  );

  app.get("/", async (_request, reply) => {
    void reply
      .header(
        "content-security-policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      )
      .type("text/html; charset=utf-8");
    return landingHtml;
  });
  app.get("/site/app.css", async (_request, reply) => {
    void reply.type("text/css; charset=utf-8");
    return landingCss;
  });
  app.get("/site/app.js", async (_request, reply) => {
    void reply.type("text/javascript; charset=utf-8");
    return landingJavaScript;
  });

  app.get("/inspector", async (_request, reply) => {
    void reply
      .header(
        "content-security-policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:* https:; img-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      )
      .type("text/html; charset=utf-8");
    return inspectorHtml;
  });
  app.get("/inspector/app.css", async (_request, reply) => {
    void reply.type("text/css; charset=utf-8");
    return inspectorCss;
  });
  app.get("/inspector/app.js", async (_request, reply) => {
    void reply.type("text/javascript; charset=utf-8");
    return inspectorJavaScript;
  });

  app.get("/api/v1/projects", async () => {
    const projects = await services.projects.list();
    return successEnvelope(projects, { total: projects.length });
  });

  app.post("/api/v1/projects", async (request, reply) => {
    const input = createProjectInputSchema.parse(request.body);
    const project = createProject({
      name: input.name,
      ...(input.width === undefined ? {} : { width: input.width }),
      ...(input.height === undefined ? {} : { height: input.height }),
      ...(input.frameRate === undefined ? {} : { frameRate: input.frameRate }),
      ...(input.sampleRate === undefined
        ? {}
        : { sampleRate: input.sampleRate }),
      ...(input.channels === undefined ? {} : { channels: input.channels }),
    });
    await services.projects.create(project);
    services.events.publish(
      "project.created",
      { revision: project.revision },
      project.projectId,
    );
    void reply.status(201).header("etag", `"${project.revision}"`);
    return successEnvelope(project);
  });

  app.get("/api/v1/projects/:projectId", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const project = await services.projects.load(projectId);
    void reply.header("etag", `"${project.revision}"`);
    return successEnvelope(project);
  });

  app.get(
    "/api/v1/projects/:projectId/revisions/:revision",
    async (request, reply) => {
      const { projectId, revision } = revisionParamsSchema.parse(
        request.params,
      );
      const project = await services.projects.loadRevision(projectId, revision);
      void reply.header("etag", `"${project.revision}"`);
      return successEnvelope(project);
    },
  );

  app.get("/api/v1/projects/:projectId/revisions", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const history = await services.projects.history(projectId);
    return successEnvelope(history, { total: history.length });
  });

  app.post("/api/v1/projects/:projectId/forks", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const body = z
      .object({
        revision: z.int().nonnegative(),
        name: z.string().min(1).max(1_024),
      })
      .strict()
      .parse(request.body);
    const project = await services.projects.fork(
      projectId,
      body.revision,
      body.name,
    );
    services.events.publish(
      "project.forked",
      { sourceProjectId: projectId, sourceRevision: body.revision },
      project.projectId,
    );
    void reply.status(201);
    return successEnvelope(project);
  });

  app.get("/api/v1/projects/:projectId/assets", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const project = await services.projects.load(projectId);
    const query = parseQueryString(
      (request.query as Record<string, unknown>).search,
    )
      ?.trim()
      .toLowerCase();
    const assets = Object.values(project.assets).filter(
      (asset) =>
        query === undefined ||
        query === "" ||
        JSON.stringify(asset).toLowerCase().includes(query),
    );
    return successEnvelope(assets, {
      total: assets.length,
      revision: project.revision,
    });
  });

  app.post("/api/v1/assets/imports", async (request, reply) => {
    const input = assetImportRequestSchema.parse(request.body);
    const result = await services.assets.import(input);
    void reply
      .status(result.cached ? 200 : 201)
      .header(
        "location",
        `/api/v1/projects/${input.projectId}/assets/${result.asset.id}`,
      );
    return successEnvelope(result);
  });

  app.post("/api/v1/assets/uploads", async (request, reply) => {
    const query = z
      .object({
        projectId: z.string().uuid(),
        baseRevision: z.coerce.number().int().nonnegative(),
        kind: z
          .enum(["video", "audio", "image", "subtitle", "font"])
          .optional(),
      })
      .strict()
      .parse(request.query);
    const part = await request.file();
    if (part === undefined) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Select one media file to upload",
        422,
      );
    }
    const originalName = basename(part.filename).slice(0, 255);
    const extension = extname(originalName).toLowerCase();
    const safeExtension = /^[.][a-z0-9]{1,12}$/u.test(extension)
      ? extension
      : ".upload";
    const uploadDirectory = resolve(services.config.dataDirectory, "uploads");
    await mkdir(uploadDirectory, { recursive: true });
    const temporaryPath = resolve(
      uploadDirectory,
      `${createId()}${safeExtension}`,
    );
    try {
      await pipeline(
        part.file,
        createWriteStream(temporaryPath, { flags: "wx" }),
      );
      if (part.file.truncated) {
        throw new FrameOSError(
          "RESOURCE_LIMIT",
          "Selected media exceeds the 20 GiB local upload limit",
          413,
        );
      }
      const result = await services.assets.import({
        projectId: query.projectId,
        baseRevision: query.baseRevision,
        idempotencyKey: `browser-upload-${createId()}`,
        uri: temporaryPath,
        name: originalName || "Uploaded media",
        managed: true,
        ...(query.kind === undefined ? {} : { kind: query.kind }),
        licenseMetadata: {},
      });
      void reply.status(201);
      return successEnvelope(result);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  });

  app.post(
    "/api/v1/projects/:projectId/assets/:assetId/proxies",
    async (request, reply) => {
      const params = projectParamsSchema
        .extend({ assetId: z.string().uuid() })
        .strict()
        .parse(request.params);
      const input = assetProxyRequestSchema.parse(request.body);
      if (
        input.projectId !== params.projectId ||
        input.assetId !== params.assetId
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Proxy request ids must match the resource path",
          422,
        );
      }
      const job = await services.assets.createProxy(input);
      void reply.status(202).header("location", `/api/v1/jobs/${job.id}`);
      return successEnvelope(job);
    },
  );

  app.post(
    "/api/v1/projects/:projectId/assets/:assetId/thumbnails",
    async (request, reply) => {
      const params = projectParamsSchema
        .extend({ assetId: z.string().uuid() })
        .strict()
        .parse(request.params);
      const input = assetThumbnailRequestSchema.parse(request.body);
      if (
        input.projectId !== params.projectId ||
        input.assetId !== params.assetId
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Thumbnail request ids must match the resource path",
          422,
        );
      }
      const job = await services.assets.createThumbnail(input);
      void reply.status(202).header("location", `/api/v1/jobs/${job.id}`);
      return successEnvelope(job);
    },
  );

  app.post("/api/v1/projects/:projectId/assets", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const input = z
      .object({
        baseRevision: z.int().nonnegative(),
        idempotencyKey: z.string().min(8).max(512),
        asset: assetSchema,
      })
      .strict()
      .parse(request.body);
    const result = await services.transactions.execute({
      projectId,
      baseRevision: input.baseRevision,
      idempotencyKey: input.idempotencyKey,
      mode: "commit",
      operations: [
        {
          operationId: createId(),
          type: "asset.add",
          preconditions: [],
          provenance: {
            actorType: "human",
            actorId: "rest.asset.import",
          },
          arguments: { asset: input.asset },
        },
      ],
    });
    services.events.publish("asset.imported", result, projectId);
    void reply.status(201);
    return successEnvelope(result);
  });

  app.get("/api/v1/projects/:projectId/assets/:assetId", async (request) => {
    const params = projectParamsSchema
      .extend({ assetId: z.string().uuid() })
      .parse(request.params);
    const project = await services.projects.load(params.projectId);
    const asset = project.assets[params.assetId];
    if (asset === undefined)
      throw new FrameOSError(
        "NOT_FOUND",
        `Asset ${params.assetId} was not found`,
        404,
      );
    return successEnvelope(asset, { revision: project.revision });
  });

  app.get("/api/v1/analysis/analyzers", async () =>
    successEnvelope(services.analysis.listAnalyzers()),
  );

  app.get(
    "/api/v1/projects/:projectId/assets/:assetId/analysis",
    async (request) => {
      const params = projectParamsSchema
        .extend({ assetId: z.string().uuid() })
        .parse(request.params);
      const artifacts = await services.analysis.listAssetArtifacts(
        params.projectId,
        params.assetId,
      );
      return successEnvelope(artifacts, { total: artifacts.length });
    },
  );

  app.post(
    "/api/v1/projects/:projectId/assets/:assetId/analysis",
    async (request, reply) => {
      const params = projectParamsSchema
        .extend({ assetId: z.string().uuid() })
        .parse(request.params);
      const input = assetAnalysisRequestSchema.parse(request.body);
      if (
        input.projectId !== params.projectId ||
        input.assetId !== params.assetId
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Analysis request ids must match the resource path",
          422,
        );
      }
      const job = await services.analysis.start(input);
      void reply.status(202).header("location", `/api/v1/jobs/${job.id}`);
      return successEnvelope(job);
    },
  );

  app.post("/api/v1/assets/search", async (request) => {
    const input = analysisSearchRequestSchema.parse(request.body);
    const results = await services.analysis.search(input);
    return successEnvelope(results, {
      total: results.length,
      searchBackend: services.database.analysisSearchBackend(),
    });
  });

  app.post("/api/v1/semantic/find", async (request) => {
    const input = semanticFindRequestSchema.parse(request.body);
    return successEnvelope(await services.semantic.find(input));
  });

  app.post("/api/v1/semantic/remove-silences/plan", async (request) => {
    const input = semanticRemoveSilencesRequestSchema.parse(request.body);
    return successEnvelope(await services.semantic.planRemoveSilences(input));
  });

  app.post("/api/v1/semantic/make-vertical/plan", async (request) => {
    const input = semanticMakeVerticalRequestSchema.parse(request.body);
    return successEnvelope(await services.semantic.planMakeVertical(input));
  });

  app.post("/api/v1/semantic/match-cuts-to-music/plan", async (request) => {
    const input = semanticMatchCutsToMusicRequestSchema.parse(request.body);
    return successEnvelope(await services.semantic.planMatchCutsToMusic(input));
  });

  app.post("/api/v1/semantic/add-dynamic-captions/plan", async (request) => {
    const input = semanticAddDynamicCaptionsRequestSchema.parse(request.body);
    return successEnvelope(
      await services.semantic.planAddDynamicCaptions(input),
    );
  });

  app.post("/api/v1/semantic/create-highlight/plan", async (request) => {
    const input = semanticCreateHighlightRequestSchema.parse(request.body);
    return successEnvelope(await services.semantic.planCreateHighlight(input));
  });

  app.post("/api/v1/semantic/sync-broll/plan", async (request) => {
    const input = semanticSyncBrollRequestSchema.parse(request.body);
    return successEnvelope(await services.semantic.planSyncBroll(input));
  });

  app.post("/api/v1/transactions", async (request, reply) => {
    const result = await services.transactions.execute(request.body);
    services.events.publish(
      `transaction.${result.mode}`,
      result,
      result.projectId,
    );
    if (result.mode === "preview") void reply.status(202);
    return successEnvelope(result);
  });

  app.post("/api/v1/imports/otio", async (request, reply) => {
    const input = otioImportRequestSchema.parse(request.body);
    const result = await services.interchange.import(
      input.document,
      input.projectName,
    );
    services.events.publish(
      "project.imported",
      { format: "otio", report: result.report },
      result.project.projectId,
    );
    void reply
      .status(201)
      .header("location", `/api/v1/projects/${result.project.projectId}`);
    return successEnvelope(result);
  });

  app.post("/api/v1/exports/otio", async (request) => {
    const input = otioExportRequestSchema.parse(request.body);
    return successEnvelope(
      await services.interchange.export(
        input.projectId,
        input.sequenceId,
        input.revision,
      ),
    );
  });

  app.post("/api/v1/imports/captions", async (request, reply) => {
    const input = captionImportRequestSchema.parse(request.body);
    const result = await services.captions.import(input, {
      actorType: "human",
      actorId: "rest.caption.import",
    });
    services.events.publish(
      `caption.imported.${result.transaction.mode}`,
      {
        captionTrackId: result.captionTrackId,
        cueCount: result.cueCount,
        transactionId: result.transaction.transactionId,
      },
      input.projectId,
    );
    if (result.transaction.mode === "preview") void reply.status(202);
    return successEnvelope(result);
  });

  app.post("/api/v1/exports/captions", async (request) => {
    const input = captionExportRequestSchema.parse(request.body);
    const result = await services.captions.export(input);
    services.events.publish(
      "caption.exported",
      {
        captionTrackId: result.captionTrackId,
        format: result.format,
        revision: result.revision,
      },
      input.projectId,
    );
    return successEnvelope(result);
  });

  app.post(
    "/api/v1/projects/:projectId/drafts/:draftId/commit",
    async (request) => {
      const { projectId, draftId } = draftParamsSchema.parse(request.params);
      const result = await services.transactions.commitDraft(
        projectId,
        draftId,
      );
      services.events.publish("transaction.committed", result, projectId);
      return successEnvelope(result);
    },
  );

  app.delete(
    "/api/v1/projects/:projectId/drafts/:draftId",
    async (request, reply) => {
      const { projectId, draftId } = draftParamsSchema.parse(request.params);
      await services.transactions.rollbackDraft(projectId, draftId);
      services.events.publish(
        "transaction.rolled_back",
        { draftId },
        projectId,
      );
      void reply.status(204).send();
    },
  );

  app.post("/api/v1/projects/:projectId/undo", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const body = z
      .object({ idempotencyKey: z.string().min(8).max(512) })
      .strict()
      .parse(request.body);
    const result = await services.transactions.undo(
      projectId,
      body.idempotencyKey,
    );
    services.events.publish("project.undo", result, projectId);
    return successEnvelope(result);
  });

  app.post("/api/v1/projects/:projectId/redo", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const body = z
      .object({ idempotencyKey: z.string().min(8).max(512) })
      .strict()
      .parse(request.body);
    const result = await services.transactions.redo(
      projectId,
      body.idempotencyKey,
    );
    services.events.publish("project.redo", result, projectId);
    return successEnvelope(result);
  });

  app.get("/api/v1/capabilities", async (request) => {
    const query = request.query as Record<string, unknown>;
    const capabilities = await services.capabilities.listCapabilities(
      parseQueryString(query.search),
    );
    return successEnvelope(capabilities, { total: capabilities.length });
  });

  app.get("/api/v1/operations", async (request) => {
    const query = request.query as Record<string, unknown>;
    const maturity = parseQueryString(query.maturity);
    const search = parseQueryString(query.search);
    const family = parseQueryString(query.family);
    const operations = services.capabilities.listOperations({
      ...(search === undefined ? {} : { search }),
      ...(family === undefined ? {} : { family }),
      ...(maturity === "implemented" ||
      maturity === "service" ||
      maturity === "contract" ||
      maturity === "planned"
        ? { maturity }
        : {}),
    });
    return successEnvelope(operations, { total: operations.length });
  });

  app.get("/api/v1/operations/:name", async (request) => {
    const { name } = z
      .object({ name: z.string().min(1).max(512) })
      .strict()
      .parse(request.params);
    const operation = services.capabilities.getOperation(name);
    if (operation === undefined)
      throw new FrameOSError(
        "NOT_FOUND",
        `Operation ${name} was not found`,
        404,
      );
    const schema =
      executableOperationSchemas[
        name as keyof typeof executableOperationSchemas
      ];
    return successEnvelope({
      ...operation,
      ...(schema === undefined ? {} : { inputSchema: z.toJSONSchema(schema) }),
    });
  });

  app.get("/api/v1/agents/providers", async () =>
    successEnvelope(services.agents.listProviders()),
  );

  app.get("/api/v1/admin/logs", async (request) => {
    const query = request.query as Record<string, unknown>;
    const level = z
      .enum(["debug", "info", "success", "warn", "error"])
      .optional()
      .parse(parseQueryString(query.level)) as LogLevel | undefined;
    const limitValue = parseQueryString(query.limit);
    const category = parseQueryString(query.category);
    const projectId = parseQueryString(query.projectId);
    const search = parseQueryString(query.search);
    const logs = services.observability.list({
      ...(level === undefined ? {} : { level }),
      ...(category === undefined ? {} : { category }),
      ...(projectId === undefined ? {} : { projectId }),
      ...(search === undefined ? {} : { search }),
      ...(limitValue === undefined
        ? {}
        : {
            limit: z.coerce
              .number()
              .int()
              .positive()
              .max(2_000)
              .parse(limitValue),
          }),
    });
    return successEnvelope(logs, { total: logs.length });
  });

  app.get("/api/v1/admin/usage", async (request) => {
    const query = request.query as Record<string, unknown>;
    const projectId = parseQueryString(query.projectId);
    const sessionId = parseQueryString(query.sessionId);
    const filter = {
      ...(projectId === undefined ? {} : { projectId }),
      ...(sessionId === undefined ? {} : { sessionId }),
    };
    const agentRecords = services.database.listProviderUsage(filter);
    const analysisRecords =
      sessionId === undefined
        ? services.database.listAnalysisUsage(
            projectId === undefined ? {} : { projectId },
          )
        : [];
    const records = [...agentRecords, ...analysisRecords]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 2_000);
    const agentSummary = services.database.summarizeProviderUsage(filter);
    const analysisSummary =
      sessionId === undefined
        ? services.database.summarizeAnalysisUsage(
            projectId === undefined ? {} : { projectId },
          )
        : {
            requests: 0,
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            estimatedCostUsd: 0,
            unpricedRequests: 0,
          };
    const summary = {
      requests: agentSummary.requests + analysisSummary.requests,
      inputTokens: agentSummary.inputTokens + analysisSummary.inputTokens,
      cachedInputTokens:
        agentSummary.cachedInputTokens + analysisSummary.cachedInputTokens,
      outputTokens: agentSummary.outputTokens + analysisSummary.outputTokens,
      totalTokens: agentSummary.totalTokens + analysisSummary.totalTokens,
      estimatedCostUsd:
        agentSummary.estimatedCostUsd + analysisSummary.estimatedCostUsd,
      unpricedRequests:
        agentSummary.unpricedRequests + analysisSummary.unpricedRequests,
    };
    return successEnvelope({ summary, records }, { total: records.length });
  });

  app.get("/api/v1/admin/logs/stream", { websocket: true }, (socket) => {
    const unsubscribe = services.observability.subscribe((entry) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(entry));
    });
    socket.on("close", unsubscribe);
    socket.on("error", unsubscribe);
  });

  app.get("/api/v1/agents/sessions", async (request) => {
    const query = request.query as Record<string, unknown>;
    const sessions = services.agents.listSessions(
      parseQueryString(query.projectId),
    );
    return successEnvelope(sessions, { total: sessions.length });
  });

  app.post("/api/v1/agents/sessions", async (request, reply) => {
    const body = z
      .object({
        projectId: z.string().uuid(),
        provider: z.enum([
          "openai-compatible",
          "anthropic",
          "gemini",
          "local",
          "external",
        ]),
        model: z.string().min(1).max(256),
        approvalMode: z
          .enum(["propose", "supervised", "autonomous"])
          .optional(),
        budgets: z
          .object({
            maxOperationsPerTransaction: z.int().positive().max(200).optional(),
            maxPreviewCycles: z.int().nonnegative().max(3).optional(),
            maxAffectedDurationFrames: z.int().positive().optional(),
            maxProviderCostUsd: z.number().nonnegative().optional(),
            maxRenderSeconds: z.int().positive().optional(),
          })
          .strict()
          .optional(),
        allowedOperationFamilies: z
          .array(z.string().min(1).max(128))
          .max(100)
          .optional(),
      })
      .strict()
      .parse(request.body);
    const session = await services.agents.createSession({
      projectId: body.projectId,
      provider: body.provider,
      model: body.model,
      ...(body.approvalMode === undefined
        ? {}
        : { approvalMode: body.approvalMode }),
      ...(body.budgets === undefined ? {} : { budgets: body.budgets }),
      ...(body.allowedOperationFamilies === undefined
        ? {}
        : { allowedOperationFamilies: body.allowedOperationFamilies }),
    });
    void reply.status(201);
    return successEnvelope(session);
  });

  app.get("/api/v1/agents/sessions/:sessionId", async (request) => {
    const { sessionId } = z
      .object({ sessionId: z.string().uuid() })
      .strict()
      .parse(request.params);
    return successEnvelope(services.agents.getSession(sessionId));
  });

  app.post("/api/v1/agents/runs", async (request) => {
    const body = z
      .object({
        sessionId: z.string().uuid(),
        request: z.string().min(1).max(100_000),
      })
      .strict()
      .parse(request.body);
    return successEnvelope(
      await services.agents.plan(body.sessionId, body.request),
    );
  });

  app.get("/api/v1/agents/runs/:runId", async (request) => {
    const { runId } = z
      .object({ runId: z.string().uuid() })
      .strict()
      .parse(request.params);
    return successEnvelope(services.agents.getRun(runId));
  });

  app.post("/api/v1/agents/runs/:runId/execute", async (request) => {
    const { runId } = z
      .object({ runId: z.string().uuid() })
      .strict()
      .parse(request.params);
    return successEnvelope(await services.agents.execute(runId, request.body));
  });

  app.get("/api/v1/agents/runs/:runId/evaluations", async (request) => {
    const { runId } = z
      .object({ runId: z.string().uuid() })
      .strict()
      .parse(request.params);
    const evaluations = services.agents.listEvaluations(runId);
    return successEnvelope(evaluations, { total: evaluations.length });
  });

  app.post("/api/v1/agents/runs/:runId/evaluate", async (request) => {
    const { runId } = z
      .object({ runId: z.string().uuid() })
      .strict()
      .parse(request.params);
    return successEnvelope(await services.agents.evaluate(runId));
  });

  app.post("/api/v1/agents/runs/:runId/revise", async (request) => {
    const { runId } = z
      .object({ runId: z.string().uuid() })
      .strict()
      .parse(request.params);
    return successEnvelope(await services.agents.revise(runId, request.body));
  });

  app.get("/api/v1/approvals", async (request) => {
    const query = request.query as Record<string, unknown>;
    const status = z
      .enum(["pending", "approved", "rejected"])
      .optional()
      .parse(parseQueryString(query.status));
    const approvals = services.agents.listApprovals(
      parseQueryString(query.projectId),
      status,
    );
    return successEnvelope(approvals, { total: approvals.length });
  });

  app.get("/api/v1/approvals/:approvalId", async (request) => {
    const { approvalId } = z
      .object({ approvalId: z.string().uuid() })
      .strict()
      .parse(request.params);
    return successEnvelope(services.agents.getApproval(approvalId));
  });

  app.post("/api/v1/approvals/:approvalId/decision", async (request) => {
    const { approvalId } = z
      .object({ approvalId: z.string().uuid() })
      .strict()
      .parse(request.params);
    return successEnvelope(
      await services.agents.decideApproval(approvalId, request.body),
    );
  });

  app.post("/api/v1/renders", async (request, reply) => {
    const body = z
      .object({
        projectId: z.string().uuid(),
        sequenceId: z.string().uuid().optional(),
        revision: z.int().nonnegative().optional(),
        renderProfileId: z.string().uuid().optional(),
        outputName: z.string().min(1).max(255),
      })
      .strict()
      .parse(request.body);
    const job = await services.jobs.startRender({
      projectId: body.projectId,
      outputName: body.outputName,
      ...(body.sequenceId === undefined ? {} : { sequenceId: body.sequenceId }),
      ...(body.revision === undefined ? {} : { revision: body.revision }),
      ...(body.renderProfileId === undefined
        ? {}
        : { renderProfileId: body.renderProfileId }),
    });
    void reply.status(202).header("location", `/api/v1/jobs/${job.id}`);
    return successEnvelope(job);
  });

  app.post("/api/v1/previews", async (request, reply) => {
    const body = previewRequestSchema.parse(request.body);
    const job = await services.jobs.startPreview(body);
    void reply.status(202).header("location", `/api/v1/jobs/${job.id}`);
    return successEnvelope(job);
  });

  app.get("/api/v1/jobs", async (request) => {
    const query = request.query as Record<string, unknown>;
    const jobs = services.jobs.listJobs(parseQueryString(query.projectId));
    return successEnvelope(jobs, { total: jobs.length });
  });

  app.get("/api/v1/jobs/:jobId", async (request) => {
    const { jobId } = jobParamsSchema.parse(request.params);
    return successEnvelope(services.jobs.getJob(jobId));
  });

  app.get(
    "/api/v1/jobs/:jobId/artifacts/:artifactName",
    async (request, reply) => {
      const { jobId, artifactName } = z
        .object({
          jobId: z.string().uuid(),
          artifactName: z.string().min(1).max(255),
        })
        .strict()
        .parse(request.params);
      const artifact = await services.jobs.resolveArtifact(jobId, artifactName);
      void reply
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "sandbox; default-src 'none'")
        .type(artifact.mimeType);
      return reply.send(createReadStream(artifact.path));
    },
  );

  app.delete("/api/v1/jobs/:jobId", async (request) => {
    const { jobId } = jobParamsSchema.parse(request.params);
    return successEnvelope(services.jobs.cancel(jobId));
  });

  app.get("/api/v1/events", { websocket: true }, (socket) => {
    const unsubscribe = services.events.subscribe((event) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
    });
    socket.on("close", unsubscribe);
    socket.on("error", unsubscribe);
  });

  const mcpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  } as unknown as StreamableHTTPServerTransportOptions);
  const mcpServer = createMcpServer(services);
  await mcpServer.connect(mcpTransport as unknown as Transport);
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp",
    handler: async (request, reply) => {
      reply.hijack();
      await mcpTransport.handleRequest(request.raw, reply.raw, request.body);
    },
  });

  app.addHook("onClose", async () => {
    await mcpServer.close();
    await services.close();
  });
  return app;
}

function requestLog(
  reply: { log: { error(value: unknown): void } },
  error: unknown,
): void {
  reply.log.error(error);
}
