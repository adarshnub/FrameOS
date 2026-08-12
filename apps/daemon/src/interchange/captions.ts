import {
  FrameOSError,
  captionExportRequestSchema,
  captionExportResultSchema,
  captionImportRequestSchema,
  captionImportResultSchema,
  compareTime,
  createId,
  projectSchema,
  rescaleTime,
  type CaptionCue,
  type CaptionExportRequest,
  type CaptionExportResult,
  type CaptionImportRequest,
  type CaptionImportResult,
  type CaptionInterchangeFormat,
  type CaptionInterchangeWarning,
  type CaptionTrack,
  type Operation,
  type RationalTime,
} from "@frameos/contracts";
import type { TransactionEngine } from "../domain/transaction-engine.js";
import type { ProjectStore } from "../store/project-store.js";

const MILLISECOND_RATE = { numerator: 1_000, denominator: 1 } as const;
const INTERCHANGE_STYLE_KEY = "frameos:caption-interchange";
const MAX_CUES = 100_000;

interface ParsedTimestamp {
  milliseconds: number;
}

function timestamp(
  value: string,
  format: CaptionInterchangeFormat,
): ParsedTimestamp | undefined {
  const match =
    format === "srt"
      ? /^(\d{1,6}):([0-5]\d):([0-5]\d),(\d{3})$/u.exec(value)
      : /^(?:(\d{1,6}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/u.exec(value);
  if (match === null) return undefined;
  const hours = format === "srt" ? Number(match[1]) : Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4]);
  const valueInMilliseconds =
    ((hours * 60 + minutes) * 60 + seconds) * 1_000 + millis;
  return Number.isSafeInteger(valueInMilliseconds)
    ? { milliseconds: valueInMilliseconds }
    : undefined;
}

function timingParts(
  line: string,
  format: CaptionInterchangeFormat,
): { start: number; end: number; settings?: string } | undefined {
  const match = /^(\S+)\s+-->\s+(\S+)(?:\s+(.+))?$/u.exec(line.trim());
  if (match === null) return undefined;
  const start = timestamp(match[1]!, format);
  const end = timestamp(match[2]!, format);
  if (start === undefined || end === undefined) return undefined;
  return {
    start: start.milliseconds,
    end: end.milliseconds,
    ...(match[3] === undefined ? {} : { settings: match[3].trim() }),
  };
}

function captionError(message: string, blockIndex: number): FrameOSError {
  return new FrameOSError("VALIDATION_ERROR", message, 422, [
    {
      field: `content.blocks.${blockIndex}`,
      message,
    },
  ]);
}

export function parseCaptionDocument(
  content: string,
  format: CaptionInterchangeFormat,
): { cues: CaptionCue[]; warnings: CaptionInterchangeWarning[] } {
  const normalized = content
    .replace(/^\uFEFF/u, "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .trim();
  if (format === "vtt" && !/^WEBVTT(?:[ \t].*)?(?:\n|$)/u.test(normalized)) {
    throw new FrameOSError(
      "UNSUPPORTED_FORMAT",
      "WebVTT input must begin with a WEBVTT header",
      415,
    );
  }

  const warnings: CaptionInterchangeWarning[] = [];
  const cues: CaptionCue[] = [];
  const blocks = normalized.split(/\n{2,}/u);
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex]!.trim();
    if (block === "") continue;
    const lines = block.split("\n");
    if (
      format === "vtt" &&
      blockIndex === 0 &&
      lines[0]!.startsWith("WEBVTT")
    ) {
      if (lines.length > 1) {
        warnings.push({
          code: "IGNORED_BLOCK",
          message: "WebVTT header metadata is not represented in caption state",
        });
      }
      continue;
    }
    if (
      format === "vtt" &&
      /^(?:NOTE(?:[ \t]|$)|STYLE$|REGION$)/u.test(lines[0]!.trim())
    ) {
      warnings.push({
        code: "IGNORED_BLOCK",
        message: `Ignored unsupported WebVTT ${lines[0]!.trim().split(/\s+/u)[0]} block`,
      });
      continue;
    }

    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) {
      warnings.push({
        code: "IGNORED_BLOCK",
        message: `Ignored block ${blockIndex + 1} because it has no cue timing`,
      });
      continue;
    }
    if (timingIndex > 1) {
      throw captionError(
        "A caption cue may contain at most one identifier before its timing line",
        blockIndex,
      );
    }
    const timing = timingParts(lines[timingIndex]!, format);
    if (timing === undefined) {
      throw captionError(
        `Invalid ${format.toUpperCase()} cue timestamp`,
        blockIndex,
      );
    }
    if (timing.end <= timing.start) {
      throw captionError("Caption cue end must be after its start", blockIndex);
    }
    const text = lines
      .slice(timingIndex + 1)
      .join("\n")
      .trim();
    if (text === "") {
      warnings.push({
        code: "EMPTY_CUE",
        cueIndex: cues.length,
        message: `Ignored empty cue in block ${blockIndex + 1}`,
      });
      continue;
    }
    if (text.length > 100_000) {
      throw captionError(
        "Caption cue text exceeds 100,000 characters",
        blockIndex,
      );
    }
    if (cues.length >= MAX_CUES) {
      throw new FrameOSError(
        "RESOURCE_LIMIT",
        `Caption import is limited to ${MAX_CUES.toLocaleString("en-US")} cues`,
        413,
      );
    }

    const identifier = timingIndex === 1 ? lines[0]!.trim() : undefined;
    const interchangeStyle = {
      ...(identifier === undefined || identifier === "" ? {} : { identifier }),
      ...(timing.settings === undefined ? {} : { settings: timing.settings }),
      sourceFormat: format,
    };
    if (timing.settings !== undefined) {
      warnings.push({
        code: "CUE_SETTING_PRESERVED",
        cueIndex: cues.length,
        message: "Cue settings were preserved as namespaced caption metadata",
      });
    }
    cues.push({
      id: createId(),
      range: {
        start: { value: timing.start, rate: MILLISECOND_RATE },
        duration: {
          value: timing.end - timing.start,
          rate: MILLISECOND_RATE,
        },
      },
      text,
      words: [],
      style: { [INTERCHANGE_STYLE_KEY]: interchangeStyle },
    });
  }
  if (cues.length === 0) {
    throw new FrameOSError(
      "UNSUPPORTED_FORMAT",
      `No valid ${format.toUpperCase()} caption cues were found`,
      415,
    );
  }
  return { cues, warnings };
}

function milliseconds(
  time: RationalTime,
  cueIndex: number,
  warnings: CaptionInterchangeWarning[],
  field: "start" | "duration",
): number {
  const result = rescaleTime(time, MILLISECOND_RATE);
  if (result.rounded) {
    warnings.push({
      code: "TIMING_ROUNDED",
      cueIndex,
      message: `Caption cue ${field} was rounded to the nearest millisecond`,
    });
  }
  return result.time.value;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

function formatTimestamp(
  value: number,
  format: CaptionInterchangeFormat,
): string {
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1_000);
  const millisecondsPart = value % 1_000;
  const separator = format === "srt" ? "," : ".";
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}${separator}${pad(millisecondsPart, 3)}`;
}

function interchangeMetadata(cue: CaptionCue): {
  identifier?: string;
  settings?: string;
} {
  const value = cue.style[INTERCHANGE_STYLE_KEY];
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  const metadata = value as Record<string, unknown>;
  return {
    ...(typeof metadata.identifier === "string"
      ? { identifier: metadata.identifier }
      : {}),
    ...(typeof metadata.settings === "string"
      ? { settings: metadata.settings }
      : {}),
  };
}

function hasUnexportedStyle(cue: CaptionCue): boolean {
  return Object.keys(cue.style).some((key) => key !== INTERCHANGE_STYLE_KEY);
}

export function serializeCaptionTrack(
  track: CaptionTrack,
  format: CaptionInterchangeFormat,
): { content: string; warnings: CaptionInterchangeWarning[] } {
  const warnings: CaptionInterchangeWarning[] = [];
  if (Object.keys(track.style).length > 0) {
    warnings.push({
      code: "STYLE_NOT_EXPORTED",
      message: "Caption-track styling is not representable in SRT or WebVTT",
    });
  }
  const sorted = [...track.cues].sort((left, right) =>
    compareTime(left.range.start, right.range.start),
  );
  const blocks = sorted.map((cue, cueIndex) => {
    const start = milliseconds(cue.range.start, cueIndex, warnings, "start");
    let duration = milliseconds(
      cue.range.duration,
      cueIndex,
      warnings,
      "duration",
    );
    if (duration === 0) {
      duration = 1;
      warnings.push({
        code: "TIMING_ROUNDED",
        cueIndex,
        message:
          "Sub-millisecond caption duration was clamped to one millisecond",
      });
    }
    const metadata = interchangeMetadata(cue);
    const settings = metadata.settings;
    if (hasUnexportedStyle(cue)) {
      warnings.push({
        code: "STYLE_NOT_EXPORTED",
        cueIndex,
        message: "Caption cue styling is not representable in SRT or WebVTT",
      });
    }
    const timing = `${formatTimestamp(start, format)} --> ${formatTimestamp(start + duration, format)}${settings === undefined ? "" : ` ${settings}`}`;
    if (format === "srt") return `${cueIndex + 1}\n${timing}\n${cue.text}`;
    return `${metadata.identifier === undefined ? "" : `${metadata.identifier}\n`}${timing}\n${cue.text}`;
  });
  return {
    content:
      format === "vtt"
        ? `WEBVTT\n\n${blocks.join("\n\n")}\n`
        : `${blocks.join("\n\n")}\n`,
    warnings,
  };
}

function safeFilename(name: string): string {
  let value = name
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, "_")
    .replace(/[. ]+$/u, "")
    .trim()
    .slice(0, 200);
  if (value === "") value = "captions";
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/iu.test(value))
    value = `_${value}`;
  return value;
}

export class CaptionInterchangeService {
  public constructor(
    private readonly projects: ProjectStore,
    private readonly transactions: TransactionEngine,
  ) {}

  public async import(
    input: CaptionImportRequest,
    provenance: NonNullable<Operation["provenance"]> = {
      actorType: "human",
      actorId: "caption.import",
    },
  ): Promise<CaptionImportResult> {
    const request = captionImportRequestSchema.parse(input);
    const parsed = parseCaptionDocument(request.content, request.format);
    const trackId = request.trackId ?? createId();
    const transaction = await this.transactions.execute({
      projectId: request.projectId,
      baseRevision: request.baseRevision,
      idempotencyKey: request.idempotencyKey,
      mode: request.mode,
      operations: [
        {
          operationId: createId(),
          type: "caption.track.add",
          targetId: trackId,
          preconditions: [],
          provenance,
          arguments: {
            sequenceId: request.sequenceId,
            track: {
              id: trackId,
              name: request.name,
              language: request.language,
              enabled: request.enabled,
              cues: parsed.cues,
              style: request.style,
            },
          },
        },
      ],
    });
    const change = transaction.changes.find(
      (candidate) => candidate.operationType === "caption.track.add",
    );
    const resultingTrackId = change?.entityIds.at(-1);
    if (resultingTrackId === undefined) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "The idempotency key was previously used for a different transaction",
        409,
      );
    }
    const resultingProject = projectSchema.parse(transaction.project);
    const resultingTrack = Object.values(resultingProject.sequences)
      .flatMap((sequence) => sequence.captions)
      .find((track) => track.id === resultingTrackId);
    if (resultingTrack === undefined) {
      throw new FrameOSError(
        "INTERNAL_ERROR",
        "Caption import transaction did not contain its resulting track",
        500,
      );
    }
    return captionImportResultSchema.parse({
      captionTrackId: resultingTrackId,
      cueCount: resultingTrack.cues.length,
      warnings: parsed.warnings,
      transaction,
    });
  }

  public async export(
    input: CaptionExportRequest,
  ): Promise<CaptionExportResult> {
    const request = captionExportRequestSchema.parse(input);
    const project =
      request.revision === undefined
        ? await this.projects.load(request.projectId)
        : await this.projects.loadRevision(request.projectId, request.revision);
    const sequence = project.sequences[request.sequenceId];
    if (sequence === undefined) {
      throw new FrameOSError(
        "NOT_FOUND",
        `Sequence ${request.sequenceId} was not found`,
        404,
      );
    }
    const track = sequence.captions.find(
      (candidate) => candidate.id === request.captionTrackId,
    );
    if (track === undefined) {
      throw new FrameOSError(
        "NOT_FOUND",
        `Caption track ${request.captionTrackId} was not found`,
        404,
      );
    }
    const serialized = serializeCaptionTrack(track, request.format);
    return captionExportResultSchema.parse({
      format: request.format,
      content: serialized.content,
      filename: `${safeFilename(track.name)}.${request.format}`,
      mimeType: request.format === "vtt" ? "text/vtt" : "application/x-subrip",
      captionTrackId: track.id,
      cueCount: track.cues.length,
      revision: project.revision,
      warnings: serialized.warnings,
    });
  }
}
