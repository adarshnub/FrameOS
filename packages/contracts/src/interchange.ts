import { z } from "zod";
import { projectSchema } from "./project.js";

export const interchangeIssueSchema = z
  .object({
    path: z.string().min(1).max(4_096),
    status: z.enum(["exact", "approximated", "dropped", "unsupported"]),
    message: z.string().min(1).max(8_192),
  })
  .strict();

export const interchangeReportSchema = z
  .object({
    format: z.literal("otio"),
    direction: z.enum(["import", "export"]),
    exact: z.int().nonnegative(),
    approximated: z.int().nonnegative(),
    dropped: z.int().nonnegative(),
    unsupported: z.int().nonnegative(),
    issues: z.array(interchangeIssueSchema).max(100_000),
  })
  .strict();

export const otioDocumentSchema = z.record(z.string(), z.unknown());

export const otioImportRequestSchema = z
  .object({
    document: otioDocumentSchema,
    projectName: z.string().min(1).max(1_024).optional(),
  })
  .strict();

export const otioImportResultSchema = z
  .object({
    project: projectSchema,
    report: interchangeReportSchema,
  })
  .strict();

export const otioExportRequestSchema = z
  .object({
    projectId: z.string().uuid(),
    sequenceId: z.string().uuid().optional(),
    revision: z.int().nonnegative().optional(),
  })
  .strict();

export const otioExportResultSchema = z
  .object({
    document: otioDocumentSchema,
    report: interchangeReportSchema,
  })
  .strict();

export type InterchangeIssue = z.infer<typeof interchangeIssueSchema>;
export type InterchangeReport = z.infer<typeof interchangeReportSchema>;
export type OtioDocument = z.infer<typeof otioDocumentSchema>;
export type OtioImportRequest = z.infer<typeof otioImportRequestSchema>;
export type OtioImportResult = z.infer<typeof otioImportResultSchema>;
export type OtioExportRequest = z.infer<typeof otioExportRequestSchema>;
export type OtioExportResult = z.infer<typeof otioExportResultSchema>;
