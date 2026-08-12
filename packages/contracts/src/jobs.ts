import { z } from "zod";
import { entityIdSchema, metadataSchema } from "./project.js";

export const jobKindSchema = z.enum([
  "render",
  "preview",
  "analysis",
  "proxy",
  "thumbnail",
]);
export const jobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const jobRecordSchema = z
  .object({
    id: entityIdSchema,
    projectId: entityIdSchema,
    projectRevision: z.int().nonnegative(),
    kind: jobKindSchema,
    status: jobStatusSchema,
    progress: z.number().finite().min(0).max(1),
    input: metadataSchema,
    output: metadataSchema.optional(),
    error: z
      .object({
        code: z.string().min(1).max(128),
        message: z.string().min(1).max(8_192),
      })
      .strict()
      .optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type JobKind = z.infer<typeof jobKindSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type JobRecord = z.infer<typeof jobRecordSchema>;
