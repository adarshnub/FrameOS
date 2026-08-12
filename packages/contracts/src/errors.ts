export const errorCodes = [
  "VALIDATION_ERROR",
  "REVISION_CONFLICT",
  "CAPABILITY_UNAVAILABLE",
  "MEDIA_OFFLINE",
  "UNSUPPORTED_FORMAT",
  "PLUGIN_FAILURE",
  "JOB_CANCELLED",
  "RESOURCE_LIMIT",
  "INTERCHANGE_LOSS",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "INTERNAL_ERROR",
] as const;

export type FrameOSErrorCode = (typeof errorCodes)[number];

export interface ErrorDetail {
  field?: string;
  message: string;
  value?: unknown;
}

export interface FrameOSErrorBody {
  code: FrameOSErrorCode;
  message: string;
  details?: ErrorDetail[];
}

export class FrameOSError extends Error {
  public constructor(
    public readonly code: FrameOSErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = "FrameOSError";
  }
}

export interface ApiEnvelope<T> {
  data: T | null;
  error: FrameOSErrorBody | null;
  meta: Record<string, unknown>;
}

export function successEnvelope<T>(
  data: T,
  meta: Record<string, unknown> = {},
): ApiEnvelope<T> {
  return { data, error: null, meta };
}

export function errorEnvelope(error: FrameOSErrorBody): ApiEnvelope<never> {
  return { data: null, error, meta: {} };
}
