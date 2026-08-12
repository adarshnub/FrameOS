import { createHash } from "node:crypto";
import {
  FrameOSError,
  addTime,
  compareTime,
  createId,
  frameTime,
  normalizeRate,
  projectSchema,
  rescaleTime,
  type Asset,
  type InterchangeIssue,
  type InterchangeReport,
  type OtioDocument,
  type OtioExportResult,
  type OtioImportResult,
  type Project,
  type RationalRate,
  type RationalTime,
  type Sequence,
  type TimeRange,
  type TimelineItem,
  type Track,
} from "@frameos/contracts";
import { createProject } from "../domain/project-factory.js";
import { validateProject } from "../domain/invariants.js";
import type { ProjectStore } from "../store/project-store.js";
import type { MediaPolicy } from "../security/media-policy.js";

type JsonObject = Record<string, unknown>;

const OTIO_TIMELINE_SCHEMA = "Timeline.1";
const FRAMEOS_METADATA_VERSION = "1.0.0";
const MAX_OTIO_CHILDREN = 100_000;

function object(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `${path} must be a JSON object`,
      422,
    );
  }
  return value as JsonObject;
}

function children(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new FrameOSError("VALIDATION_ERROR", `${path} must be an array`, 422);
  }
  if (value.length > MAX_OTIO_CHILDREN) {
    throw new FrameOSError(
      "RESOURCE_LIMIT",
      `${path} exceeds ${MAX_OTIO_CHILDREN.toString()} children`,
      413,
    );
  }
  return value;
}

function schemaName(value: JsonObject): string {
  return typeof value.OTIO_SCHEMA === "string" ? value.OTIO_SCHEMA : "";
}

function name(value: JsonObject, fallback: string): string {
  return typeof value.name === "string" && value.name.length > 0
    ? value.name.slice(0, 1_024)
    : fallback;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a || 1;
}

function rateFromNumber(value: unknown, path: string): RationalRate {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `${path}.rate must be a positive finite number`,
      422,
    );
  }
  const broadcastRates: Array<[number, RationalRate]> = [
    [23.976, { numerator: 24_000, denominator: 1_001 }],
    [29.97, { numerator: 30_000, denominator: 1_001 }],
    [59.94, { numerator: 60_000, denominator: 1_001 }],
    [119.88, { numerator: 120_000, denominator: 1_001 }],
  ];
  const broadcast = broadcastRates.find(
    ([candidate]) => Math.abs(candidate - value) < 0.000_01,
  );
  if (broadcast !== undefined) return broadcast[1];
  if (Number.isInteger(value) && value <= 1_000_000) {
    return { numerator: value, denominator: 1 };
  }
  const scale = 100_000;
  const numerator = Math.round(value * scale);
  const divisor = greatestCommonDivisor(numerator, scale);
  return normalizeRate({
    numerator: numerator / divisor,
    denominator: scale / divisor,
  });
}

function rationalTime(value: unknown, path: string): RationalTime {
  const input = object(value, path);
  if (
    typeof input.value !== "number" ||
    !Number.isSafeInteger(input.value) ||
    input.value < 0
  ) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `${path}.value must be a non-negative safe integer`,
      422,
    );
  }
  return frameTime(input.value, rateFromNumber(input.rate, path));
}

function timeRange(value: unknown, path: string): TimeRange {
  const input = object(value, path);
  return {
    start: rationalTime(input.start_time, `${path}.start_time`),
    duration: rationalTime(input.duration, `${path}.duration`),
  };
}

function otioTime(value: RationalTime): JsonObject {
  return {
    OTIO_SCHEMA: "RationalTime.1",
    value: value.value,
    rate: value.rate.numerator / value.rate.denominator,
  };
}

function otioRange(value: TimeRange): JsonObject {
  return {
    OTIO_SCHEMA: "TimeRange.1",
    start_time: otioTime(value.start),
    duration: otioTime(value.duration),
  };
}

function report(
  direction: "import" | "export",
  exact: number,
  issues: InterchangeIssue[],
): InterchangeReport {
  return {
    format: "otio",
    direction,
    exact,
    approximated: issues.filter((issue) => issue.status === "approximated")
      .length,
    dropped: issues.filter((issue) => issue.status === "dropped").length,
    unsupported: issues.filter((issue) => issue.status === "unsupported")
      .length,
    issues,
  };
}

function standardItem(
  item: TimelineItem,
  asset?: Asset,
): JsonObject | undefined {
  const base = {
    name: item.name,
    metadata: { frameos: { item } },
    source_range: otioRange(
      item.type === "clip" ? item.sourceRange : item.timelineRange,
    ),
    effects: [],
    markers: [],
    enabled: item.enabled,
  };
  if (item.type === "clip" && asset !== undefined) {
    return {
      OTIO_SCHEMA: "Clip.2",
      ...base,
      media_references: {
        DEFAULT_MEDIA: {
          OTIO_SCHEMA: "ExternalReference.1",
          name: asset.name,
          target_url: asset.uri,
          available_range:
            asset.duration === undefined
              ? null
              : otioRange({
                  start: frameTime(0, asset.duration.rate),
                  duration: asset.duration,
                }),
          metadata: {
            frameos: {
              assetId: asset.id,
              hash: asset.hash,
              kind: asset.kind,
            },
          },
        },
      },
      active_media_reference_key: "DEFAULT_MEDIA",
    };
  }
  if (item.type === "gap") return { OTIO_SCHEMA: "Gap.1", ...base };
  return undefined;
}

function hasAdvancedState(item: TimelineItem): boolean {
  if (item.type === "clip") {
    return (
      item.effects.length > 0 ||
      item.timeMap.length > 0 ||
      item.links.length > 0 ||
      item.audio.gainDb !== 0 ||
      item.audio.pan !== 0 ||
      item.audio.muted ||
      item.audio.channelMap.length > 0 ||
      JSON.stringify(item.transform) !==
        JSON.stringify({
          positionX: 0,
          positionY: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          opacity: 1,
          cropTop: 0,
          cropRight: 0,
          cropBottom: 0,
          cropLeft: 0,
          blendMode: "normal",
        })
    );
  }
  return item.type !== "gap";
}

export function exportOtio(
  project: Project,
  sequenceId = project.settings.defaultSequenceId,
): OtioExportResult {
  const sequence = project.sequences[sequenceId];
  if (sequence === undefined) {
    throw new FrameOSError(
      "NOT_FOUND",
      `Sequence ${sequenceId} was not found`,
      404,
    );
  }
  const issues: InterchangeIssue[] = [];
  let exact = 1;
  const tracks = sequence.tracks.map((track, trackIndex) => {
    const timelineChildren: JsonObject[] = [];
    const items = track.items
      .filter((item) => item.type !== "transition")
      .toSorted(
        (left, right) =>
          left.timelineRange.start.value - right.timelineRange.start.value,
      );
    let cursor = frameTime(0, sequence.format.frameRate);
    for (const [itemIndex, item] of items.entries()) {
      const start = rescaleTime(
        item.timelineRange.start,
        sequence.format.frameRate,
      );
      const duration = rescaleTime(
        item.timelineRange.duration,
        sequence.format.frameRate,
      );
      if (start.rounded || duration.rounded) {
        issues.push({
          path: `sequences.${sequence.id}.tracks.${track.id}.items.${item.id}`,
          status: "unsupported",
          message: "Item timing is not aligned to the sequence rate",
        });
        continue;
      }
      if (start.time.value > cursor.value) {
        timelineChildren.push({
          OTIO_SCHEMA: "Gap.1",
          name: "FrameOS implicit gap",
          source_range: otioRange({
            start: frameTime(0, sequence.format.frameRate),
            duration: frameTime(
              start.time.value - cursor.value,
              sequence.format.frameRate,
            ),
          }),
          effects: [],
          markers: [],
          enabled: true,
          metadata: { frameos: { implicit: true } },
        });
      }
      const mapped = standardItem(
        item,
        item.type === "clip" ? project.assets[item.assetId] : undefined,
      );
      if (mapped === undefined) {
        timelineChildren.push({
          OTIO_SCHEMA: "Gap.1",
          name: `${item.name} (FrameOS-only placeholder)`,
          source_range: otioRange({
            start: frameTime(0, sequence.format.frameRate),
            duration: duration.time,
          }),
          effects: [],
          markers: [],
          enabled: item.enabled,
          metadata: { frameos: { item } },
        });
        issues.push({
          path: `tracks.${trackIndex.toString()}.children.${itemIndex.toString()}`,
          status: "approximated",
          message: `${item.type} is preserved in FrameOS metadata and represented as a gap for standard OTIO clients`,
        });
      } else {
        timelineChildren.push(mapped);
        exact += 1;
        if (hasAdvancedState(item)) {
          issues.push({
            path: `tracks.${trackIndex.toString()}.children.${itemIndex.toString()}`,
            status: "approximated",
            message:
              "Advanced FrameOS properties are preserved in metadata but are not represented by the standard OTIO editorial object",
          });
        }
      }
      cursor = frameTime(
        start.time.value + duration.time.value,
        sequence.format.frameRate,
      );
    }

    const transitions = track.items.filter(
      (item) => item.type === "transition",
    );
    for (const transition of transitions) {
      issues.push({
        path: `sequences.${sequence.id}.tracks.${track.id}.items.${transition.id}`,
        status: "approximated",
        message:
          "Transition is preserved in FrameOS metadata; standard OTIO transition placement may differ",
      });
    }
    exact += 1;
    return {
      OTIO_SCHEMA: "Track.1",
      name: track.name,
      kind: track.kind === "audio" ? "Audio" : "Video",
      children: timelineChildren,
      source_range: null,
      effects: [],
      markers: [],
      enabled: track.enabled,
      metadata: { frameos: { track } },
    };
  });

  if (
    sequence.captions.length > 0 ||
    sequence.buses.length > 0 ||
    sequence.outputEffects.length > 0 ||
    Object.keys(project.analyses).length > 0 ||
    Object.keys(project.renderProfiles).length > 0 ||
    Object.keys(project.masks).length > 0 ||
    Object.keys(project.trackedObjects).length > 0 ||
    Object.keys(project.multicamGroups).length > 0
  ) {
    issues.push({
      path: "metadata.frameos.project",
      status: "approximated",
      message:
        "Captions, buses, analyses, effects, masks, tracking, multicam groups, and render profiles are preserved only in FrameOS metadata",
    });
  }

  return {
    document: {
      OTIO_SCHEMA: OTIO_TIMELINE_SCHEMA,
      name: sequence.name,
      global_start_time: null,
      tracks: {
        OTIO_SCHEMA: "Stack.1",
        name: "tracks",
        children: tracks,
        source_range: null,
        effects: [],
        markers: [],
        enabled: true,
        metadata: {
          frameos: {
            sequenceFormat: sequence.format,
          },
        },
      },
      metadata: {
        frameos: {
          version: FRAMEOS_METADATA_VERSION,
          project,
          exportedSequenceId: sequence.id,
        },
      },
    },
    report: report("export", exact, issues),
  };
}

function embeddedProject(document: JsonObject): Project | undefined {
  const metadata = object(document.metadata ?? {}, "metadata");
  const frameos = object(metadata.frameos ?? {}, "metadata.frameos");
  const parsed = projectSchema.safeParse(frameos.project);
  return parsed.success ? parsed.data : undefined;
}

function importedAsset(
  mediaReference: JsonObject,
  trackKind: Track["kind"],
): Asset {
  const uri =
    typeof mediaReference.target_url === "string" &&
    mediaReference.target_url.length > 0
      ? mediaReference.target_url
      : `frameos:offline/otio/${createId()}`;
  const availableRange =
    mediaReference.available_range === null ||
    mediaReference.available_range === undefined
      ? undefined
      : timeRange(
          mediaReference.available_range,
          "media_reference.available_range",
        );
  return {
    id: createId(),
    name: name(mediaReference, uri.split(/[\\/]/u).at(-1) ?? "OTIO media"),
    kind: trackKind === "audio" ? "audio" : "video",
    uri,
    hash: createHash("sha256").update(uri).digest("hex"),
    managed: false,
    streams: [],
    ...(availableRange === undefined
      ? {}
      : { duration: addTime(availableRange.start, availableRange.duration) }),
    proxies: [],
    analysisRefs: [],
    licenseMetadata: {},
    semanticMetadata: { importedFrom: "otio" },
  };
}

function importPlainOtio(
  document: JsonObject,
  projectName?: string,
): OtioImportResult {
  if (!schemaName(document).startsWith("Timeline.")) {
    throw new FrameOSError(
      "UNSUPPORTED_FORMAT",
      "OTIO import currently requires a Timeline root object",
      415,
    );
  }
  const tracksStack = object(document.tracks, "tracks");
  const trackObjects = children(tracksStack.children, "tracks.children").map(
    (value, index) => object(value, `tracks.children.${index.toString()}`),
  );
  const stackMetadata = object(tracksStack.metadata ?? {}, "tracks.metadata");
  const frameosMetadata = object(
    stackMetadata.frameos ?? {},
    "tracks.metadata.frameos",
  );
  const formatCandidate = frameosMetadata.sequenceFormat;
  const format =
    typeof formatCandidate === "object" && formatCandidate !== null
      ? (formatCandidate as JsonObject)
      : undefined;
  let sequenceRate: RationalRate | undefined;
  if (format !== undefined) {
    const parsed =
      projectSchema.shape.sequences.valueType.shape.format.safeParse(format);
    if (parsed.success) sequenceRate = parsed.data.frameRate;
  }
  if (sequenceRate === undefined) {
    outer: for (const track of trackObjects) {
      for (const child of children(track.children ?? [], "track.children")) {
        const candidate = object(child, "track.child");
        if (
          candidate.source_range !== null &&
          candidate.source_range !== undefined
        ) {
          sequenceRate = timeRange(
            candidate.source_range,
            "track.child.source_range",
          ).duration.rate;
          break outer;
        }
      }
    }
  }
  sequenceRate ??= { numerator: 30, denominator: 1 };
  const project = createProject({
    name: projectName ?? name(document, "Imported OTIO"),
    ...(format !== undefined && typeof format.width === "number"
      ? { width: format.width }
      : {}),
    ...(format !== undefined && typeof format.height === "number"
      ? { height: format.height }
      : {}),
    frameRate: sequenceRate,
    ...(format !== undefined && typeof format.sampleRate === "number"
      ? { sampleRate: format.sampleRate }
      : {}),
    ...(format !== undefined && typeof format.channels === "number"
      ? { channels: format.channels }
      : {}),
  });
  const sequence = project.sequences[project.settings.defaultSequenceId];
  if (sequence === undefined) throw new Error("Default sequence is missing");
  sequence.name = name(document, "Imported OTIO");
  sequence.tracks = [];
  const issues: InterchangeIssue[] = [];
  let exact = 1;
  const assetsByUri = new Map<string, Asset>();

  for (const [trackIndex, inputTrack] of trackObjects.entries()) {
    if (!schemaName(inputTrack).startsWith("Track.")) {
      issues.push({
        path: `tracks.children.${trackIndex.toString()}`,
        status: "unsupported",
        message: `Unsupported OTIO object ${schemaName(inputTrack) || "without schema"}`,
      });
      continue;
    }
    const kind: Track["kind"] = inputTrack.kind === "Audio" ? "audio" : "video";
    const track: Track = {
      id: createId(),
      name: name(
        inputTrack,
        `${kind === "audio" ? "A" : "V"}${(trackIndex + 1).toString()}`,
      ),
      kind,
      order: trackIndex,
      enabled: inputTrack.enabled !== false,
      locked: false,
      muted: false,
      syncLocked: true,
      items: [],
      effects: [],
      metadata: { importedFrom: "otio" },
    };
    let cursor = frameTime(0, sequenceRate);
    const inputChildren = children(
      inputTrack.children ?? [],
      `tracks.children.${trackIndex.toString()}.children`,
    );
    for (const [itemIndex, childValue] of inputChildren.entries()) {
      const child = object(
        childValue,
        `tracks.children.${trackIndex.toString()}.children.${itemIndex.toString()}`,
      );
      const childSchema = schemaName(child);
      const path = `tracks.children.${trackIndex.toString()}.children.${itemIndex.toString()}`;
      if (childSchema.startsWith("Transition.")) {
        issues.push({
          path,
          status: "approximated",
          message:
            "Standard OTIO transitions require neighbor-offset interpretation; the transition was retained in track metadata only",
        });
        track.metadata[`otioTransition:${itemIndex.toString()}`] = child;
        continue;
      }
      let range: TimeRange | undefined;
      if (child.source_range !== null && child.source_range !== undefined) {
        range = timeRange(child.source_range, `${path}.source_range`);
      }
      if (range === undefined || range.duration.value === 0) {
        range = {
          start: frameTime(0, sequenceRate),
          duration: frameTime(1, sequenceRate),
        };
        issues.push({
          path,
          status: "approximated",
          message:
            "Missing or zero duration was replaced with one sequence frame",
        });
      }
      const timelineDuration = rescaleTime(range.duration, sequenceRate);
      if (timelineDuration.rounded) {
        issues.push({
          path,
          status: "approximated",
          message: "Duration was rounded to the nearest sequence frame",
        });
      }
      if (childSchema.startsWith("Gap.")) {
        track.items.push({
          id: createId(),
          type: "gap",
          name: name(child, "Gap"),
          timelineRange: { start: cursor, duration: timelineDuration.time },
          enabled: child.enabled !== false,
          locked: false,
          metadata: { importedFrom: "otio" },
        });
        cursor = addTime(cursor, timelineDuration.time);
        exact += 1;
        continue;
      }
      if (!childSchema.startsWith("Clip.")) {
        issues.push({
          path,
          status: "dropped",
          message: `Unsupported OTIO child ${childSchema || "without schema"}`,
        });
        continue;
      }
      const references = object(
        child.media_references ?? {},
        `${path}.media_references`,
      );
      const activeKey =
        typeof child.active_media_reference_key === "string"
          ? child.active_media_reference_key
          : "DEFAULT_MEDIA";
      const reference = object(
        references[activeKey] ?? {},
        `${path}.media_reference`,
      );
      let asset = importedAsset(reference, kind);
      const existing = assetsByUri.get(asset.uri);
      if (existing !== undefined) asset = existing;
      else {
        assetsByUri.set(asset.uri, asset);
        project.assets[asset.id] = asset;
      }
      const requiredDuration = addTime(range.start, range.duration);
      if (
        asset.duration === undefined ||
        compareTime(asset.duration, requiredDuration) < 0
      ) {
        asset.duration = requiredDuration;
      }
      track.items.push({
        id: createId(),
        type: "clip",
        name: name(child, asset.name),
        assetId: asset.id,
        sourceRange: range,
        timelineRange: { start: cursor, duration: timelineDuration.time },
        enabled: child.enabled !== false,
        locked: false,
        transform: {
          positionX: 0,
          positionY: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          opacity: 1,
          cropTop: 0,
          cropRight: 0,
          cropBottom: 0,
          cropLeft: 0,
          blendMode: "normal",
        },
        timeMap: [],
        effects: [],
        audio: { gainDb: 0, pan: 0, muted: false, channelMap: [] },
        links: [],
        metadata: { importedFrom: "otio" },
        semanticMetadata: {},
      });
      cursor = addTime(cursor, timelineDuration.time);
      exact += 1;
      if (Array.isArray(child.effects) && child.effects.length > 0) {
        issues.push({
          path: `${path}.effects`,
          status: "unsupported",
          message:
            "Generic OTIO effects are not mapped to FrameOS capabilities",
        });
      }
    }
    sequence.tracks.push(track);
    exact += 1;
  }

  if (sequence.tracks.length === 0) {
    throw new FrameOSError(
      "INTERCHANGE_LOSS",
      "OTIO timeline contained no importable tracks",
      422,
      issues,
    );
  }
  return {
    project: validateProject(project),
    report: report("import", exact, issues),
  };
}

export function importOtio(
  document: OtioDocument,
  projectName?: string,
): OtioImportResult {
  const input = object(document, "document");
  const embedded = embeddedProject(input);
  if (embedded === undefined) return importPlainOtio(input, projectName);
  const now = new Date().toISOString();
  const project = validateProject({
    ...structuredClone(embedded),
    projectId: createId(),
    revision: 0,
    createdAt: now,
    updatedAt: now,
    settings: {
      ...embedded.settings,
      ...(projectName === undefined ? {} : { name: projectName }),
    },
    metadata: {
      ...embedded.metadata,
      importedFromProjectId: embedded.projectId,
      importedFrom: "otio-frameos-metadata",
    },
  });
  return {
    project,
    report: report("import", 1, [
      {
        path: "project.projectId",
        status: "approximated",
        message:
          "A new project identity and revision history were created while canonical timeline state was restored exactly",
      },
    ]),
  };
}

export class OtioInterchangeService {
  public constructor(
    private readonly projects: ProjectStore,
    private readonly mediaPolicy: MediaPolicy,
  ) {}

  public async import(
    document: OtioDocument,
    projectName?: string,
  ): Promise<OtioImportResult> {
    const result = importOtio(document, projectName);
    await this.mediaPolicy.validateUris(
      Object.values(result.project.assets).map((asset) => asset.uri),
    );
    await this.projects.create(result.project);
    return result;
  }

  public async export(
    projectId: string,
    sequenceId?: string,
    revision?: number,
  ): Promise<OtioExportResult> {
    const project =
      revision === undefined
        ? await this.projects.load(projectId)
        : await this.projects.loadRevision(projectId, revision);
    return exportOtio(project, sequenceId);
  }
}
