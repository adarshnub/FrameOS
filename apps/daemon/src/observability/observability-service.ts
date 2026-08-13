import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createId } from "@frameos/contracts";
import type { FrameOSEvent } from "../events/event-bus.js";

export type LogLevel = "debug" | "info" | "success" | "warn" | "error";

export interface StructuredLogEntry {
  id: string;
  occurredAt: string;
  level: LogLevel;
  category: string;
  eventType: string;
  message: string;
  projectId?: string;
  correlationId?: string;
  durationMs?: number;
  data: unknown;
}

const sensitiveKey =
  /authorization|api[-_]?key|authToken|(^|[-_])(access|refresh|auth|bearer)[-_]?tokens?$|secret|credential|password|cookie/iu;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 10) return "[DEPTH_LIMIT]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : redact(item, depth + 1),
    ]),
  );
}

function levelForEvent(type: string): LogLevel {
  if (/failed|failure|error|crash/iu.test(type)) return "error";
  if (/cancelled|rejected|warning|unavailable/iu.test(type)) return "warn";
  if (/completed|committed|created|approved|ready|imported/iu.test(type))
    return "success";
  return "info";
}

function messageForEvent(event: FrameOSEvent): string {
  const readable = event.type.replaceAll(".", " ");
  return `${readable.charAt(0).toUpperCase()}${readable.slice(1)}`;
}

export class ObservabilityService {
  private readonly entries: StructuredLogEntry[] = [];
  private readonly listeners = new Set<(entry: StructuredLogEntry) => void>();
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly logPath: string;

  public constructor(
    dataDirectory: string,
    private readonly capacity = 5_000,
  ) {
    this.logPath = resolve(dataDirectory, "logs", "frameos.ndjson");
  }

  public async initialize(): Promise<void> {
    await mkdir(dirname(this.logPath), { recursive: true });
    try {
      const lines = (await readFile(this.logPath, "utf8"))
        .split(/\r?\n/u)
        .filter(Boolean)
        .slice(-this.capacity);
      for (const line of lines) {
        try {
          this.entries.push(JSON.parse(line) as StructuredLogEntry);
        } catch {
          // A partially written final line is ignored; prior records stay usable.
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  public record(
    input: Omit<StructuredLogEntry, "id" | "occurredAt" | "data"> & {
      occurredAt?: string;
      data?: unknown;
    },
  ): StructuredLogEntry {
    const entry: StructuredLogEntry = {
      id: createId(),
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      level: input.level,
      category: input.category,
      eventType: input.eventType,
      message: input.message,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.correlationId === undefined
        ? {}
        : { correlationId: input.correlationId }),
      ...(input.durationMs === undefined
        ? {}
        : { durationMs: input.durationMs }),
      data: redact(input.data ?? {}),
    };
    this.entries.push(entry);
    if (this.entries.length > this.capacity)
      this.entries.splice(0, this.entries.length - this.capacity);
    const serialized = `${JSON.stringify(entry)}\n`;
    this.writeQueue = this.writeQueue
      .then(() => appendFile(this.logPath, serialized, "utf8"))
      .catch(() => undefined);
    for (const listener of this.listeners) listener(entry);
    return entry;
  }

  public recordEvent(event: FrameOSEvent): StructuredLogEntry {
    return this.record({
      occurredAt: event.occurredAt,
      level: levelForEvent(event.type),
      category: event.type.split(".")[0] ?? "system",
      eventType: event.type,
      message: messageForEvent(event),
      ...(event.projectId === undefined ? {} : { projectId: event.projectId }),
      correlationId: event.id,
      data: event.payload,
    });
  }

  public list(
    input: {
      level?: LogLevel;
      category?: string;
      projectId?: string;
      search?: string;
      limit?: number;
    } = {},
  ): StructuredLogEntry[] {
    const query = input.search?.trim().toLowerCase();
    return this.entries
      .toReversed()
      .filter(
        (entry) =>
          (input.level === undefined || entry.level === input.level) &&
          (input.category === undefined || entry.category === input.category) &&
          (input.projectId === undefined ||
            entry.projectId === input.projectId) &&
          (query === undefined ||
            `${entry.eventType} ${entry.message} ${JSON.stringify(entry.data)}`
              .toLowerCase()
              .includes(query)),
      )
      .slice(0, Math.min(Math.max(input.limit ?? 500, 1), 2_000));
  }

  public subscribe(listener: (entry: StructuredLogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async close(): Promise<void> {
    await this.writeQueue;
    this.listeners.clear();
  }
}
