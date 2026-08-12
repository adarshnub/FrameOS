import { z } from "zod";
import { entityIdSchema } from "./project.js";
import { operationSchema, transactionResultSchema } from "./operations.js";
import { jobStatusSchema } from "./jobs.js";
import { timeRangeSchema } from "./time.js";

export const approvalModeSchema = z.enum([
  "propose",
  "supervised",
  "autonomous",
]);
export const agentProviderKindSchema = z.enum([
  "openai-compatible",
  "anthropic",
  "gemini",
  "local",
  "external",
]);

export const agentBudgetSchema = z
  .object({
    maxOperationsPerTransaction: z.int().positive().max(200).default(200),
    maxPreviewCycles: z.int().nonnegative().max(3).default(3),
    maxAffectedDurationFrames: z.int().positive().optional(),
    maxProviderCostUsd: z.number().nonnegative().optional(),
    maxRenderSeconds: z.int().positive().optional(),
  })
  .strict();

export const agentSessionSchema = z
  .object({
    id: entityIdSchema,
    projectId: entityIdSchema,
    provider: agentProviderKindSchema,
    model: z.string().min(1).max(256),
    approvalMode: approvalModeSchema,
    budgets: agentBudgetSchema,
    allowedOperationFamilies: z.array(z.string().min(1).max(128)).max(100),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const editPlanStepSchema = z
  .object({
    id: z.string().min(1).max(128),
    description: z.string().min(1).max(8_192),
    operationFamilies: z.array(z.string().min(1).max(128)).max(50),
    expectedAffectedRanges: z.array(timeRangeSchema).max(1_000),
    verification: z.array(
      z.enum([
        "frame",
        "contact_sheet",
        "region",
        "waveform",
        "timeline_invariants",
      ]),
    ),
  })
  .strict();

export const editPlanSchema = z
  .object({
    goal: z.string().min(1).max(32_768),
    summary: z.string().min(1).max(32_768),
    assumptions: z.array(z.string().max(8_192)).max(100),
    clarificationRequired: z.boolean(),
    clarificationQuestion: z.string().max(8_192).optional(),
    steps: z.array(editPlanStepSchema).min(1).max(100),
    warnings: z.array(z.string().max(8_192)).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.clarificationRequired &&
      value.clarificationQuestion === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["clarificationQuestion"],
        message: "A clarification question is required",
      });
    }
  });

export const agentRunStateSchema = z.enum([
  "interpreting",
  "planning",
  "awaiting_clarification",
  "planned",
  "validating",
  "previewing",
  "evaluating",
  "awaiting_approval",
  "committing",
  "rendering",
  "completed",
  "failed",
  "cancelled",
]);

export const agentRunSchema = z
  .object({
    id: entityIdSchema,
    sessionId: entityIdSchema,
    projectId: entityIdSchema,
    projectRevision: z.int().nonnegative(),
    request: z.string().min(1).max(100_000),
    state: agentRunStateSchema,
    plan: editPlanSchema.optional(),
    providerResponseId: z.string().max(512).optional(),
    draftId: entityIdSchema.optional(),
    transactionId: entityIdSchema.optional(),
    approvalId: entityIdSchema.optional(),
    resultingRevision: z.int().nonnegative().optional(),
    previewCycles: z.int().nonnegative().max(3).default(0),
    error: z
      .object({ code: z.string(), message: z.string() })
      .strict()
      .optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const agentExecutionRequestSchema = z
  .object({
    operations: z.array(operationSchema).min(1).max(200),
  })
  .strict();

export const approvalStatusSchema = z.enum(["pending", "approved", "rejected"]);

export const approvalSchema = z
  .object({
    id: entityIdSchema,
    runId: entityIdSchema,
    sessionId: entityIdSchema,
    projectId: entityIdSchema,
    draftId: entityIdSchema,
    status: approvalStatusSchema,
    requestedAt: z.string().datetime(),
    decidedAt: z.string().datetime().optional(),
    decidedBy: z.string().min(1).max(512).optional(),
    note: z.string().max(8_192).optional(),
  })
  .strict();

export const approvalDecisionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    decidedBy: z.string().min(1).max(512),
    note: z.string().max(8_192).optional(),
  })
  .strict();

export const agentExecutionResultSchema = z
  .object({
    run: agentRunSchema,
    transaction: transactionResultSchema,
    approval: approvalSchema.optional(),
    evaluation: z.lazy(() => agentEvaluationSchema).optional(),
  })
  .strict();

export const agentEvaluationCheckSchema = z
  .object({
    id: z.string().min(1).max(256),
    category: z.enum([
      "timeline",
      "media",
      "composition",
      "captions",
      "audio",
      "continuity",
      "pacing",
      "sync",
      "capability",
    ]),
    status: z.enum(["pass", "warning", "fail", "unavailable"]),
    message: z.string().min(1).max(8_192),
    entityIds: z.array(entityIdSchema).max(10_000).default([]),
    ranges: z.array(timeRangeSchema).max(10_000).default([]),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const agentEvaluationSchema = z
  .object({
    id: entityIdSchema,
    runId: entityIdSchema,
    projectId: entityIdSchema,
    draftId: entityIdSchema,
    cycle: z.int().positive().max(3),
    passed: z.boolean(),
    checks: z.array(agentEvaluationCheckSchema).min(1).max(10_000),
    previews: z
      .array(
        z
          .object({
            jobId: entityIdSchema,
            kind: z.enum(["frame", "region", "contact_sheet", "waveform"]),
            status: jobStatusSchema,
            artifactUris: z.array(z.string().min(1).max(8_192)).max(65),
            error: z
              .object({
                code: z.string().min(1).max(128),
                message: z.string().min(1).max(8_192),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(16)
      .default([]),
    createdAt: z.string().datetime(),
  })
  .strict();

export const agentRevisionRequestSchema = z
  .object({
    operations: z.array(operationSchema).min(1).max(200),
  })
  .strict();

export const agentRevisionResultSchema = z
  .object({
    run: agentRunSchema,
    transaction: transactionResultSchema,
    evaluation: agentEvaluationSchema,
    approval: approvalSchema.optional(),
  })
  .strict();

export type ApprovalMode = z.infer<typeof approvalModeSchema>;
export type AgentProviderKind = z.infer<typeof agentProviderKindSchema>;
export type AgentBudget = z.infer<typeof agentBudgetSchema>;
export type AgentSession = z.infer<typeof agentSessionSchema>;
export type EditPlan = z.infer<typeof editPlanSchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
export type AgentRunState = z.infer<typeof agentRunStateSchema>;
export type AgentExecutionRequest = z.infer<typeof agentExecutionRequestSchema>;
export type AgentExecutionResult = z.infer<typeof agentExecutionResultSchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
export type AgentEvaluationCheck = z.infer<typeof agentEvaluationCheckSchema>;
export type AgentEvaluation = z.infer<typeof agentEvaluationSchema>;
export type AgentRevisionRequest = z.infer<typeof agentRevisionRequestSchema>;
export type AgentRevisionResult = z.infer<typeof agentRevisionResultSchema>;
