import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  FrameOSError,
  analysisSearchRequestSchema,
  assetAnalysisRequestSchema,
  semanticFindRequestSchema,
  semanticMakeVerticalRequestSchema,
  semanticMatchCutsToMusicRequestSchema,
  semanticRemoveSilencesRequestSchema,
  assetImportRequestSchema,
  assetProxyRequestSchema,
  assetThumbnailRequestSchema,
  captionExportRequestSchema,
  captionImportRequestSchema,
  createId,
  executableOperationSchemas,
  operationSchema,
  otioDocumentSchema,
  previewSourceSchema,
  rationalTimeSchema,
  semanticAddDynamicCaptionsRequestSchema,
  semanticCreateHighlightRequestSchema,
  semanticSyncBrollRequestSchema,
  timeRangeSchema,
  transactionRequestSchema,
  type FrameOSErrorBody,
} from "@frameos/contracts";
import { z } from "zod";
import { createProject } from "../domain/project-factory.js";
import type { FrameOSServices } from "../services/services.js";

const toolOutputSchema = z
  .object({
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.array(z.unknown()).optional(),
      })
      .optional(),
  })
  .strict();

function toolSuccess(result: unknown) {
  const structuredContent = { result };
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(structuredContent) },
    ],
    structuredContent,
  };
}

function toolFailure(error: unknown) {
  const body: FrameOSErrorBody =
    error instanceof FrameOSError
      ? {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        }
      : { code: "INTERNAL_ERROR", message: "FrameOS tool failed unexpectedly" };
  const structuredContent = { error: body };
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(structuredContent) },
    ],
    structuredContent,
    isError: true,
  };
}

async function guarded<T>(action: () => Promise<T>) {
  try {
    return toolSuccess(await action());
  } catch (error) {
    return toolFailure(error);
  }
}

function variable(value: string | string[] | undefined, name: string): string {
  if (typeof value !== "string") {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Resource variable ${name} is invalid`,
      422,
    );
  }
  return value;
}

export function createMcpServer(services: FrameOSServices): McpServer {
  const server = new McpServer(
    { name: "frameos", version: "0.1.0" },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true, subscribe: true },
      },
    },
  );

  server.registerTool(
    "project.create",
    {
      title: "Create FrameOS project",
      description:
        "Create a deterministic FrameOS project with default video and audio tracks.",
      inputSchema: z.object({
        name: z.string().min(1).max(1_024),
        width: z.int().positive().max(65_535).optional(),
        height: z.int().positive().max(65_535).optional(),
        frameRateNumerator: z.int().positive().max(1_000_000).optional(),
        frameRateDenominator: z.int().positive().max(1_000_000).optional(),
      }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    (input) =>
      guarded(async () => {
        const project = createProject({
          name: input.name,
          ...(input.width === undefined ? {} : { width: input.width }),
          ...(input.height === undefined ? {} : { height: input.height }),
          ...(input.frameRateNumerator === undefined
            ? {}
            : {
                frameRate: {
                  numerator: input.frameRateNumerator,
                  denominator: input.frameRateDenominator ?? 1,
                },
              }),
        });
        await services.projects.create(project);
        services.events.publish(
          "project.created",
          { revision: project.revision },
          project.projectId,
        );
        return project;
      }),
  );

  server.registerTool(
    "project.inspect",
    {
      title: "Inspect project",
      description: "Read the authoritative FrameOS JSON project document.",
      inputSchema: z.object({
        projectId: z.string().uuid(),
        revision: z.int().nonnegative().optional(),
      }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (input) =>
      guarded(() =>
        input.revision === undefined
          ? services.projects.load(input.projectId)
          : services.projects.loadRevision(input.projectId, input.revision),
      ),
  );

  server.registerTool(
    "project.open",
    {
      title: "Open project",
      description:
        "Open the current or an immutable historical project revision.",
      inputSchema: z.object({
        projectId: z.string().uuid(),
        revision: z.int().nonnegative().optional(),
      }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (input) =>
      guarded(() =>
        input.revision === undefined
          ? services.projects.load(input.projectId)
          : services.projects.loadRevision(input.projectId, input.revision),
      ),
  );

  server.registerTool(
    "project.history",
    {
      title: "Project history",
      description:
        "List committed FrameOS transactions and their inverse operations.",
      inputSchema: z.object({ projectId: z.string().uuid() }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (input) => guarded(() => services.projects.history(input.projectId)),
  );

  server.registerTool(
    "capabilities.search",
    {
      title: "Search capabilities",
      description:
        "Discover editing, engine, plugin, codec, and analyzer capabilities available on this host.",
      inputSchema: z.object({ query: z.string().max(512).optional() }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (input) =>
      guarded(() => services.capabilities.listCapabilities(input.query)),
  );

  server.registerTool(
    "operations.search",
    {
      title: "Search operation catalog",
      description:
        "Search the complete advanced-editor operation taxonomy and implementation maturity.",
      inputSchema: z.object({
        query: z.string().max(512).optional(),
        family: z.string().max(128).optional(),
        maturity: z
          .enum(["implemented", "service", "contract", "planned"])
          .optional(),
      }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (input) =>
      guarded(async () =>
        services.capabilities.listOperations({
          ...(input.query === undefined ? {} : { search: input.query }),
          ...(input.family === undefined ? {} : { family: input.family }),
          ...(input.maturity === undefined ? {} : { maturity: input.maturity }),
        }),
      ),
  );

  server.registerTool(
    "operations.describe",
    {
      title: "Describe operation",
      description:
        "Return an operation descriptor and its exact JSON Schema when executable.",
      inputSchema: z.object({ name: z.string().min(1).max(512) }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (input) =>
      guarded(async () => {
        const descriptor = services.capabilities.getOperation(input.name);
        if (descriptor === undefined) {
          throw new FrameOSError(
            "NOT_FOUND",
            `Operation ${input.name} was not found`,
            404,
          );
        }
        const schema =
          executableOperationSchemas[
            input.name as keyof typeof executableOperationSchemas
          ];
        return {
          descriptor,
          ...(schema === undefined
            ? {}
            : { inputSchema: z.toJSONSchema(schema) }),
        };
      }),
  );

  server.registerTool(
    "asset.import",
    {
      title: "Import registered asset",
      description:
        "Hash and register an approved local file, optionally copying it into the project bundle.",
      inputSchema: assetImportRequestSchema,
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    (input) => guarded(() => services.assets.import(input)),
  );

  server.registerTool(
    "asset.inspect",
    {
      title: "Inspect asset",
      description:
        "Read a registered asset and its stream, proxy, and analysis references.",
      inputSchema: z.object({
        projectId: z.string().uuid(),
        assetId: z.string().uuid(),
      }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (input) =>
      guarded(async () => {
        const project = await services.projects.load(input.projectId);
        const asset = project.assets[input.assetId];
        if (asset === undefined)
          throw new FrameOSError(
            "NOT_FOUND",
            `Asset ${input.assetId} was not found`,
            404,
          );
        return asset;
      }),
  );

  server.registerTool(
    "asset.proxy.create",
    {
      title: "Create managed editing proxy",
      description:
        "Start a capability-gated native proxy transcode and register its managed URI only after successful generation.",
      inputSchema: assetProxyRequestSchema,
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (input) => guarded(() => services.assets.createProxy(input)),
  );

  server.registerTool(
    "asset.thumbnail.create",
    {
      title: "Create source-time thumbnail",
      description:
        "Render a bounded PNG from an immutable asset revision and expose it as an authenticated job artifact.",
      inputSchema: assetThumbnailRequestSchema,
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (input) => guarded(() => services.assets.createThumbnail(input)),
  );

  server.registerTool(
    "asset.search",
    {
      title: "Search assets",
      description:
        "Search registered asset metadata and indexed transcript/visual analysis segments.",
      inputSchema: z.object({
        projectId: z.string().uuid(),
        query: z.string().max(1_024).default(""),
        mode: z.enum(["lexical", "semantic", "hybrid"]).default("lexical"),
        queryEmbedding: z
          .array(z.number().finite())
          .min(1)
          .max(4_096)
          .optional(),
        assetIds: z.array(z.string().uuid()).max(10_000).optional(),
        types: z.array(z.string().min(1).max(128)).max(128).optional(),
        limit: z.int().positive().max(500).default(50),
      }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (input) =>
      guarded(async () => {
        const project = await services.projects.load(input.projectId);
        const query = input.query.toLowerCase();
        const assets = Object.values(project.assets)
          .filter(
            (asset) =>
              (input.assetIds === undefined ||
                input.assetIds.includes(asset.id)) &&
              JSON.stringify(asset).toLowerCase().includes(query),
          )
          .slice(0, input.limit);
        const analysis = await services.analysis.search(
          analysisSearchRequestSchema.parse(input),
        );
        return {
          assets,
          analysis,
          searchBackend: services.database.analysisSearchBackend(),
        };
      }),
  );

  server.registerTool(
    "asset.analyze",
    {
      title: "Analyze asset",
      description:
        "Start reproducible analysis with installed analyzers; unavailable model-backed analyzers return their exact missing capability.",
      inputSchema: assetAnalysisRequestSchema,
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (input) => guarded(() => services.analysis.start(input)),
  );

  server.registerTool(
    "semantic.find",
    {
      title: "Find semantic media ranges",
      description:
        "Find speakers, quotes, scenes, objects, silence, or quality-ranked takes in reproducible analysis artifacts.",
      inputSchema: semanticFindRequestSchema,
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (input) => guarded(() => services.semantic.find(input)),
  );

  server.registerTool(
    "semantic.remove_silences.plan",
    {
      title: "Plan silence removal",
      description:
        "Compile indexed silence ranges into ordinary split and ripple-delete operations without mutating the project.",
      inputSchema: semanticRemoveSilencesRequestSchema,
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    (input) => guarded(() => services.semantic.planRemoveSilences(input)),
  );

  server.registerTool(
    "semantic.make_vertical.plan",
    {
      title: "Plan vertical reframing",
      description:
        "Compile deterministic center-framed portrait conversion into ordinary sequence-format and clip-scale operations without mutating the project.",
      inputSchema: semanticMakeVerticalRequestSchema,
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (input) => guarded(() => services.semantic.planMakeVertical(input)),
  );

  server.registerTool(
    "semantic.match_cuts_to_music.plan",
    {
      title: "Plan cuts on music beats",
      description:
        "Map indexed beat/onset markers through a music clip and compile matching timeline cuts into ordinary split operations without mutating the project.",
      inputSchema: semanticMatchCutsToMusicRequestSchema,
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    (input) => guarded(() => services.semantic.planMatchCutsToMusic(input)),
  );

  server.registerTool(
    "semantic.add_dynamic_captions.plan",
    {
      title: "Plan dynamic captions",
      description:
        "Map indexed transcript and word timestamps through selected source clips into an ordinary caption track and cue operations without mutating the project.",
      inputSchema: semanticAddDynamicCaptionsRequestSchema,
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    (input) => guarded(() => services.semantic.planAddDynamicCaptions(input)),
  );

  server.registerTool(
    "semantic.create_highlight.plan",
    {
      title: "Plan highlight assembly",
      description:
        "Rank indexed scene, shot, or quality ranges and compile a non-mutating highlight assembly into ordinary track and clip operations.",
      inputSchema: semanticCreateHighlightRequestSchema,
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    (input) => guarded(() => services.semantic.planCreateHighlight(input)),
  );

  server.registerTool(
    "semantic.sync_broll.plan",
    {
      title: "Plan synchronized B-roll",
      description:
        "Pair target transcript/scene ranges with ranked B-roll source ranges and compile non-mutating overlay operations.",
      inputSchema: semanticSyncBrollRequestSchema,
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    (input) => guarded(() => services.semantic.planSyncBroll(input)),
  );

  server.registerTool(
    "transaction.create",
    {
      title: "Create transaction request",
      description:
        "Validate and normalize an unexecuted transaction request without touching project state.",
      inputSchema: transactionRequestSchema,
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (input) => guarded(async () => transactionRequestSchema.parse(input)),
  );

  server.registerTool(
    "transaction.apply",
    {
      title: "Apply transaction",
      description:
        "Apply a transaction in its requested validate, preview, or commit mode.",
      inputSchema: transactionRequestSchema,
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    (input) => guarded(() => services.transactions.execute(input)),
  );

  for (const [name, mode] of [
    ["transaction.validate", "validate"],
    ["transaction.preview", "preview"],
    ["transaction.commit", "commit"],
  ] as const) {
    server.registerTool(
      name,
      {
        title: name,
        description: `${mode} an atomic list of deterministic editing operations.`,
        inputSchema: transactionRequestSchema.omit({ mode: true }),
        outputSchema: toolOutputSchema,
        annotations: {
          readOnlyHint: mode === "validate",
          destructiveHint: mode === "commit",
          idempotentHint: true,
        },
      },
      (input) =>
        guarded(() => services.transactions.execute({ ...input, mode })),
    );
  }

  server.registerTool(
    "transaction.commit_draft",
    {
      title: "Commit preview draft",
      description:
        "Commit an unexpired preview draft if its base revision is still current.",
      inputSchema: z.object({
        projectId: z.string().uuid(),
        draftId: z.string().uuid(),
      }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    (input) =>
      guarded(() =>
        services.transactions.commitDraft(input.projectId, input.draftId),
      ),
  );

  server.registerTool(
    "transaction.rollback",
    {
      title: "Rollback preview draft",
      description: "Delete an uncommitted transaction draft.",
      inputSchema: z.object({
        projectId: z.string().uuid(),
        draftId: z.string().uuid(),
      }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    (input) =>
      guarded(async () => {
        await services.transactions.rollbackDraft(
          input.projectId,
          input.draftId,
        );
        return { rolledBack: true };
      }),
  );

  server.registerTool(
    "render.start",
    {
      title: "Start render",
      description:
        "Render an immutable project revision through the isolated MLT worker.",
      inputSchema: z.object({
        projectId: z.string().uuid(),
        sequenceId: z.string().uuid().optional(),
        revision: z.int().nonnegative().optional(),
        renderProfileId: z.string().uuid().optional(),
        outputName: z.string().min(1).max(255),
      }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    (input) =>
      guarded(() =>
        services.jobs.startRender({
          projectId: input.projectId,
          outputName: input.outputName,
          ...(input.sequenceId === undefined
            ? {}
            : { sequenceId: input.sequenceId }),
          ...(input.revision === undefined ? {} : { revision: input.revision }),
          ...(input.renderProfileId === undefined
            ? {}
            : { renderProfileId: input.renderProfileId }),
        }),
      ),
  );

  server.registerTool(
    "preview.frame",
    {
      title: "Preview exact frame",
      description:
        "Render one frame from an isolated draft or immutable revision for visual verification.",
      inputSchema: z.object({
        projectId: z.string().uuid(),
        source: previewSourceSchema,
        sequenceId: z.string().uuid().optional(),
        at: rationalTimeSchema,
        maxWidth: z.int().positive().max(3_840).optional(),
        maxHeight: z.int().positive().max(2_160).optional(),
      }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    (input) =>
      guarded(() =>
        services.jobs.startPreview({
          projectId: input.projectId,
          source: input.source,
          kind: "frame",
          at: input.at,
          maxWidth: input.maxWidth ?? 960,
          maxHeight: input.maxHeight ?? 540,
          ...(input.sequenceId === undefined
            ? {}
            : { sequenceId: input.sequenceId }),
        }),
      ),
  );

  server.registerTool(
    "preview.region",
    {
      title: "Preview draft region",
      description:
        "Render an isolated draft revision at preview resolution through the same graph compiler as final output.",
      inputSchema: z.object({
        projectId: z.string().uuid(),
        source: previewSourceSchema,
        sequenceId: z.string().uuid().optional(),
        range: timeRangeSchema.optional(),
        maxWidth: z.int().positive().max(3_840).optional(),
        maxHeight: z.int().positive().max(2_160).optional(),
      }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    (input) =>
      guarded(() =>
        services.jobs.startPreview({
          projectId: input.projectId,
          source: input.source,
          kind: "region",
          maxWidth: input.maxWidth ?? 960,
          maxHeight: input.maxHeight ?? 540,
          ...(input.sequenceId === undefined
            ? {}
            : { sequenceId: input.sequenceId }),
          ...(input.range === undefined ? {} : { range: input.range }),
        }),
      ),
  );

  server.registerTool(
    "preview.contact_sheet",
    {
      title: "Preview contact sheet",
      description:
        "Sample frame-accurate PNGs across a draft or revision range for agent composition, continuity, and pacing checks.",
      inputSchema: z.object({
        projectId: z.string().uuid(),
        source: previewSourceSchema,
        sequenceId: z.string().uuid().optional(),
        range: timeRangeSchema,
        frameCount: z.int().min(2).max(64).optional(),
        columns: z.int().min(1).max(16).optional(),
        maxWidth: z.int().positive().max(3_840).optional(),
        maxHeight: z.int().positive().max(2_160).optional(),
      }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    (input) =>
      guarded(() =>
        services.jobs.startPreview({
          projectId: input.projectId,
          source: input.source,
          kind: "contact_sheet",
          range: input.range,
          frameCount: input.frameCount ?? 12,
          columns: input.columns ?? 4,
          maxWidth: input.maxWidth ?? 960,
          maxHeight: input.maxHeight ?? 540,
          ...(input.sequenceId === undefined
            ? {}
            : { sequenceId: input.sequenceId }),
        }),
      ),
  );

  server.registerTool(
    "preview.waveform",
    {
      title: "Preview audio waveform",
      description:
        "Generate a deterministic SVG waveform for a registered audio asset and immutable revision or draft.",
      inputSchema: z.object({
        projectId: z.string().uuid(),
        source: previewSourceSchema,
        assetId: z.string().uuid(),
        range: timeRangeSchema.optional(),
        channel: z.int().nonnegative().max(63).optional(),
        maxWidth: z.int().positive().max(3_840).optional(),
        maxHeight: z.int().positive().max(2_160).optional(),
      }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    (input) =>
      guarded(() =>
        services.jobs.startPreview({
          projectId: input.projectId,
          source: input.source,
          kind: "waveform",
          assetId: input.assetId,
          maxWidth: input.maxWidth ?? 960,
          maxHeight: input.maxHeight ?? 240,
          ...(input.range === undefined ? {} : { range: input.range }),
          ...(input.channel === undefined ? {} : { channel: input.channel }),
        }),
      ),
  );

  server.registerTool(
    "render.status",
    {
      title: "Render status",
      description: "Read render job progress and structured failure details.",
      inputSchema: z.object({ jobId: z.string().uuid() }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (input) => guarded(async () => services.jobs.getJob(input.jobId)),
  );

  server.registerTool(
    "render.cancel",
    {
      title: "Cancel render",
      description: "Cancel a running native render worker.",
      inputSchema: z.object({ jobId: z.string().uuid() }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    (input) => guarded(async () => services.jobs.cancel(input.jobId)),
  );

  server.registerTool(
    "edit.plan",
    {
      title: "Plan an edit",
      description:
        "Use the configured provider-neutral planning stage to create a structured, non-mutating edit plan.",
      inputSchema: z.object({
        sessionId: z.string().uuid(),
        request: z.string().min(1).max(100_000),
      }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    (input) =>
      guarded(() => services.agents.plan(input.sessionId, input.request)),
  );

  server.registerTool(
    "edit.execute",
    {
      title: "Execute planned edit",
      description:
        "Validate low-level operations from a planned agent run, create an isolated draft, and enforce the session approval policy.",
      inputSchema: z.object({
        runId: z.string().uuid(),
        operations: z.array(operationSchema).min(1).max(200),
      }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    (input) =>
      guarded(() =>
        services.agents.execute(input.runId, {
          operations: input.operations,
        }),
      ),
  );

  server.registerTool(
    "edit.evaluate",
    {
      title: "Evaluate draft edit",
      description:
        "Run persisted deterministic media, caption, audio, and timeline checks on an agent draft; unavailable visual checks are explicit.",
      inputSchema: z.object({ runId: z.string().uuid() }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    (input) => guarded(() => services.agents.evaluate(input.runId)),
  );

  server.registerTool(
    "edit.revise",
    {
      title: "Revise draft edit",
      description:
        "Replace the current agent draft with a newly validated operation set, evaluate it, and supersede any pending approval within the three-cycle budget.",
      inputSchema: z.object({
        runId: z.string().uuid(),
        operations: z.array(operationSchema).min(1).max(200),
      }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    (input) =>
      guarded(() =>
        services.agents.revise(input.runId, { operations: input.operations }),
      ),
  );

  server.registerTool(
    "project.import_otio",
    {
      title: "Import OpenTimelineIO",
      description:
        "Import an OTIO Timeline into a new FrameOS project and return an exact loss report.",
      inputSchema: z.object({
        document: otioDocumentSchema,
        projectName: z.string().min(1).max(1_024).optional(),
      }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    (input) =>
      guarded(async () => {
        const result = await services.interchange.import(
          input.document,
          input.projectName,
        );
        services.events.publish(
          "project.imported",
          { format: "otio", report: result.report },
          result.project.projectId,
        );
        return result;
      }),
  );

  server.registerTool(
    "project.export_otio",
    {
      title: "Export OpenTimelineIO",
      description:
        "Export a project revision as standard OTIO plus lossless FrameOS metadata and an exact loss report.",
      inputSchema: z.object({
        projectId: z.string().uuid(),
        sequenceId: z.string().uuid().optional(),
        revision: z.int().nonnegative().optional(),
      }),
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (input) =>
      guarded(() =>
        services.interchange.export(
          input.projectId,
          input.sequenceId,
          input.revision,
        ),
      ),
  );

  server.registerTool(
    "caption.import",
    {
      title: "Import SRT or WebVTT captions",
      description:
        "Parse caption text and apply it as one atomic, previewable caption.track.add transaction.",
      inputSchema: captionImportRequestSchema,
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (input) =>
      guarded(async () => {
        const result = await services.captions.import(input, {
          actorType: "agent",
          actorId: "mcp.caption.import",
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
        return result;
      }),
  );

  server.registerTool(
    "caption.export",
    {
      title: "Export SRT or WebVTT captions",
      description:
        "Serialize one caption track from an immutable project revision with explicit timing and style-loss warnings.",
      inputSchema: captionExportRequestSchema,
      outputSchema: toolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    (input) => guarded(() => services.captions.export(input)),
  );

  server.registerResource(
    "project-state",
    new ResourceTemplate("frameos://projects/{projectId}/state", {
      list: undefined,
    }),
    {
      title: "FrameOS project state",
      description: "Authoritative project JSON",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const project = await services.projects.load(
        variable(variables.projectId, "projectId"),
      );
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(project),
          },
        ],
      };
    },
  );

  server.registerResource(
    "operation-schema",
    new ResourceTemplate("frameos://operations/{operationName}", {
      list: undefined,
    }),
    {
      title: "FrameOS operation schema",
      description: "Operation descriptor and JSON Schema",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const name = variable(variables.operationName, "operationName");
      const descriptor = services.capabilities.getOperation(name);
      if (descriptor === undefined)
        throw new FrameOSError(
          "NOT_FOUND",
          `Operation ${name} was not found`,
          404,
        );
      const schema =
        executableOperationSchemas[
          name as keyof typeof executableOperationSchemas
        ];
      const value = {
        descriptor,
        ...(schema === undefined
          ? {}
          : { inputSchema: z.toJSONSchema(schema) }),
      };
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(value),
          },
        ],
      };
    },
  );

  server.registerResource(
    "project-timeline-map",
    new ResourceTemplate("frameos://projects/{projectId}/timeline-map", {
      list: undefined,
    }),
    {
      title: "FrameOS timeline map",
      description: "Compact sequence/track/item map for agent inspection",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const project = await services.projects.load(
        variable(variables.projectId, "projectId"),
      );
      const value = {
        projectId: project.projectId,
        revision: project.revision,
        sequences: Object.values(project.sequences).map((sequence) => ({
          id: sequence.id,
          name: sequence.name,
          format: sequence.format,
          tracks: sequence.tracks.map((track) => ({
            id: track.id,
            name: track.name,
            kind: track.kind,
            order: track.order,
            enabled: track.enabled,
            locked: track.locked,
            muted: track.muted,
            items: track.items.map((item) => ({
              id: item.id,
              type: item.type,
              name: item.name,
              timelineRange: item.timelineRange,
              ...(item.type === "clip"
                ? { assetId: item.assetId, sourceRange: item.sourceRange }
                : {}),
            })),
          })),
        })),
      };
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(value),
          },
        ],
      };
    },
  );

  server.registerResource(
    "capability-descriptor",
    new ResourceTemplate("frameos://capabilities/{capabilityId}", {
      list: undefined,
    }),
    {
      title: "FrameOS capability",
      description: "Normalized host capability descriptor",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const capabilityId = variable(variables.capabilityId, "capabilityId");
      const capability = (await services.capabilities.listCapabilities()).find(
        (item) => item.id === capabilityId,
      );
      if (capability === undefined)
        throw new FrameOSError(
          "NOT_FOUND",
          `Capability ${capabilityId} was not found`,
          404,
        );
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(capability),
          },
        ],
      };
    },
  );

  server.registerResource(
    "job-state",
    new ResourceTemplate("frameos://jobs/{jobId}", { list: undefined }),
    {
      title: "FrameOS job state",
      description: "Persistent render/analysis job state",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const job = services.jobs.getJob(variable(variables.jobId, "jobId"));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(job),
          },
        ],
      };
    },
  );

  server.registerResource(
    "preview-state",
    new ResourceTemplate("frameos://previews/{previewId}", { list: undefined }),
    {
      title: "FrameOS preview",
      description: "Preview job state and output reference",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const previewId = variable(variables.previewId, "previewId");
      const job = services.jobs.getJob(previewId);
      if (job.kind !== "preview")
        throw new FrameOSError(
          "NOT_FOUND",
          `Preview ${previewId} was not found`,
          404,
        );
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(job),
          },
        ],
      };
    },
  );

  return server;
}
