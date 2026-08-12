import {
  FrameOSError,
  createId,
  fromSeconds,
  semanticAddDynamicCaptionsRequestSchema,
  semanticEditPlanSchema,
  semanticFindRequestSchema,
  semanticFindResultSchema,
  semanticMakeVerticalRequestSchema,
  semanticMatchCutsToMusicRequestSchema,
  semanticRemoveSilencesRequestSchema,
  timeRangeSchema,
  toSeconds,
  type AnalysisSearchResult,
  type Operation,
  type Project,
  type SemanticEditPlan,
  type SemanticAddDynamicCaptionsRequest,
  type SemanticFindRequest,
  type SemanticFindResult,
  type SemanticMakeVerticalRequest,
  type SemanticMatchCutsToMusicRequest,
  type SemanticRemoveSilencesRequest,
  type TimeRange,
} from "@frameos/contracts";
import type { AnalysisService } from "../analysis/analysis-service.js";
import type { ProjectStore } from "../store/project-store.js";

interface FrameInterval {
  start: number;
  end: number;
  artifactId: string;
}

const semanticTypes: Record<SemanticFindRequest["kind"], string[]> = {
  speaker: ["transcript", "words"],
  quote: ["transcript", "words"],
  scene: ["scenes", "shots"],
  object: ["objects", "ocr"],
  silence: ["silence"],
  best_take: ["quality"],
};

function intersectingIntervals(
  clip: Extract<
    Project["sequences"][string]["tracks"][number]["items"][number],
    { type: "clip" }
  >,
  results: readonly AnalysisSearchResult[],
  request: SemanticRemoveSilencesRequest,
  warnings: string[],
): FrameInterval[] {
  if (clip.timeMap.length > 0) {
    warnings.push(
      `Skipped retimed clip ${clip.id}; semantic source mapping is not linear`,
    );
    return [];
  }
  const sourceStartSeconds = toSeconds(clip.sourceRange.start);
  const sourceEndSeconds =
    sourceStartSeconds + toSeconds(clip.sourceRange.duration);
  const rate = clip.timelineRange.start.rate;
  const paddingSeconds = request.edgePaddingMs / 1_000;
  const intervals: FrameInterval[] = [];
  for (const result of results) {
    if (result.assetId !== clip.assetId || result.range === undefined) continue;
    const detectedStart = toSeconds(result.range.start);
    const detectedEnd = detectedStart + toSeconds(result.range.duration);
    if ((detectedEnd - detectedStart) * 1_000 < request.minDurationMs) continue;
    const startSeconds = Math.max(
      sourceStartSeconds,
      detectedStart + paddingSeconds,
    );
    const endSeconds = Math.min(sourceEndSeconds, detectedEnd - paddingSeconds);
    if (endSeconds <= startSeconds) continue;
    const startOffset = fromSeconds(startSeconds - sourceStartSeconds, rate);
    const endOffset = fromSeconds(endSeconds - sourceStartSeconds, rate);
    if (startOffset.rounded || endOffset.rounded) {
      warnings.push(
        `Silence boundaries for clip ${clip.id} were rounded to sequence frames`,
      );
    }
    const clipStart = clip.timelineRange.start.value;
    const clipEnd = clipStart + clip.timelineRange.duration.value;
    const start = Math.max(clipStart, clipStart + startOffset.time.value);
    const end = Math.min(clipEnd, clipStart + endOffset.time.value);
    if (end > start)
      intervals.push({ start, end, artifactId: result.artifactId });
  }
  intervals.sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const merged: FrameInterval[] = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous !== undefined && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
      if (previous.artifactId !== interval.artifactId) {
        previous.artifactId = `${previous.artifactId},${interval.artifactId}`;
      }
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

export function compileRemoveSilences(
  project: Project,
  input: SemanticRemoveSilencesRequest,
  silenceResults: readonly AnalysisSearchResult[],
): SemanticEditPlan {
  const request = semanticRemoveSilencesRequestSchema.parse(input);
  if (request.projectId !== project.projectId) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Semantic edit project id does not match the supplied project state",
      422,
    );
  }
  if (
    request.baseRevision !== undefined &&
    request.baseRevision !== project.revision
  ) {
    throw new FrameOSError(
      "REVISION_CONFLICT",
      `Expected revision ${request.baseRevision.toString()}, found ${project.revision.toString()}`,
      409,
    );
  }
  const sequenceId = request.sequenceId ?? project.settings.defaultSequenceId;
  const sequence = project.sequences[sequenceId];
  if (sequence === undefined) {
    throw new FrameOSError(
      "NOT_FOUND",
      `Sequence ${sequenceId} was not found`,
      404,
    );
  }
  const selectedTrackIds = new Set(request.trackIds);
  const unknownTracks = request.trackIds.filter(
    (trackId) => !sequence.tracks.some((track) => track.id === trackId),
  );
  if (unknownTracks.length > 0) {
    throw new FrameOSError(
      "NOT_FOUND",
      `Tracks were not found in sequence ${sequenceId}: ${unknownTracks.join(", ")}`,
      404,
    );
  }
  const selectedAssets =
    request.assetIds === undefined ? undefined : new Set(request.assetIds);
  const warnings: string[] = [];
  const operations: Operation[] = [];
  const affectedRanges: TimeRange[] = [];
  const sourceArtifactIds = new Set<string>();

  for (const track of sequence.tracks) {
    if (!selectedTrackIds.has(track.id)) continue;
    if (track.locked) {
      warnings.push(`Skipped locked track ${track.id}`);
      continue;
    }
    for (const item of track.items) {
      if (
        item.type !== "clip" ||
        (selectedAssets !== undefined && !selectedAssets.has(item.assetId))
      ) {
        continue;
      }
      const intervals = intersectingIntervals(
        item,
        silenceResults,
        request,
        warnings,
      );
      let currentEnd =
        item.timelineRange.start.value + item.timelineRange.duration.value;
      const currentStart = item.timelineRange.start.value;
      for (const interval of intervals.toReversed()) {
        const end = Math.min(interval.end, currentEnd);
        const start = Math.max(interval.start, currentStart);
        if (end <= start) continue;
        const sharedArguments = { sequenceId, trackId: track.id };
        if (end < currentEnd) {
          operations.push({
            operationId: createId(),
            type: "clip.split",
            targetId: item.id,
            preconditions: [{ kind: "entity_exists", entityId: item.id }],
            provenance: {
              actorType: "system",
              actorId: "semantic.remove_silences",
              reason: `Preserve media after silence detected by ${interval.artifactId}`,
            },
            arguments: {
              ...sharedArguments,
              at: { value: end, rate: item.timelineRange.start.rate },
              rightClipId: createId(),
            },
          });
        }
        if (start > currentStart) {
          const silenceClipId = createId();
          operations.push(
            {
              operationId: createId(),
              type: "clip.split",
              targetId: item.id,
              preconditions: [{ kind: "entity_exists", entityId: item.id }],
              provenance: {
                actorType: "system",
                actorId: "semantic.remove_silences",
                reason: `Isolate silence detected by ${interval.artifactId}`,
              },
              arguments: {
                ...sharedArguments,
                at: { value: start, rate: item.timelineRange.start.rate },
                rightClipId: silenceClipId,
              },
            },
            {
              operationId: createId(),
              type: "clip.ripple_delete",
              targetId: silenceClipId,
              preconditions: [
                { kind: "entity_exists", entityId: silenceClipId },
              ],
              provenance: {
                actorType: "system",
                actorId: "semantic.remove_silences",
                reason: `Remove silence detected by ${interval.artifactId}`,
              },
              arguments: sharedArguments,
            },
          );
          currentEnd = start;
        } else {
          operations.push({
            operationId: createId(),
            type: "clip.ripple_delete",
            targetId: item.id,
            preconditions: [{ kind: "entity_exists", entityId: item.id }],
            provenance: {
              actorType: "system",
              actorId: "semantic.remove_silences",
              reason: `Remove silence detected by ${interval.artifactId}`,
            },
            arguments: sharedArguments,
          });
          currentEnd = currentStart;
        }
        affectedRanges.push({
          start: { value: start, rate: item.timelineRange.start.rate },
          duration: {
            value: end - start,
            rate: item.timelineRange.start.rate,
          },
        });
        for (const artifactId of interval.artifactId.split(",")) {
          sourceArtifactIds.add(artifactId);
        }
        if (operations.length > request.maximumOperations) {
          throw new FrameOSError(
            "RESOURCE_LIMIT",
            `Removing detected silences requires more than ${request.maximumOperations.toString()} operations; narrow the tracks, assets, or analysis range`,
            413,
          );
        }
      }
      if (item.links.length > 0) {
        warnings.push(
          `Clip ${item.id} has linked items; validate A/V synchronization before commit`,
        );
      }
    }
  }

  return semanticEditPlanSchema.parse({
    projectId: project.projectId,
    baseRevision: project.revision,
    semanticOperation: "semantic.remove_silences",
    operations,
    sourceArtifactIds: [...sourceArtifactIds].sort(),
    affectedRanges,
    warnings: [
      ...new Set([
        ...warnings,
        ...(silenceResults.length === 500
          ? [
              "Silence search reached its 500-segment planning limit; narrow the selected assets",
            ]
          : []),
      ]),
    ],
  });
}

export function compileMakeVertical(
  project: Project,
  input: SemanticMakeVerticalRequest,
): SemanticEditPlan {
  const request = semanticMakeVerticalRequestSchema.parse(input);
  if (request.projectId !== project.projectId) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Semantic edit project id does not match the supplied project state",
      422,
    );
  }
  if (
    request.baseRevision !== undefined &&
    request.baseRevision !== project.revision
  ) {
    throw new FrameOSError(
      "REVISION_CONFLICT",
      `Expected revision ${request.baseRevision.toString()}, found ${project.revision.toString()}`,
      409,
    );
  }
  const sequenceId = request.sequenceId ?? project.settings.defaultSequenceId;
  const sequence = project.sequences[sequenceId];
  if (sequence === undefined) {
    throw new FrameOSError(
      "NOT_FOUND",
      `Sequence ${sequenceId} was not found`,
      404,
    );
  }
  const selectedTrackIds =
    request.trackIds === undefined
      ? new Set(
          sequence.tracks
            .filter((track) => track.kind === "video")
            .map((track) => track.id),
        )
      : new Set(request.trackIds);
  const unknownTracks = [...selectedTrackIds].filter(
    (trackId) => !sequence.tracks.some((track) => track.id === trackId),
  );
  if (unknownTracks.length > 0) {
    throw new FrameOSError(
      "NOT_FOUND",
      `Tracks were not found in sequence ${sequenceId}: ${unknownTracks.join(", ")}`,
      404,
    );
  }
  const inputAspect = sequence.format.width / sequence.format.height;
  const outputAspect = request.outputWidth / request.outputHeight;
  const horizontalFactor =
    request.fit === "cover"
      ? Math.max(1, inputAspect / outputAspect)
      : Math.min(1, inputAspect / outputAspect);
  const verticalFactor =
    request.fit === "cover"
      ? Math.max(1, outputAspect / inputAspect)
      : Math.min(1, outputAspect / inputAspect);
  const operations: Operation[] = [
    {
      operationId: createId(),
      type: "sequence.format.set",
      targetId: sequence.id,
      preconditions: [{ kind: "entity_exists", entityId: sequence.id }],
      provenance: {
        actorType: "system",
        actorId: "semantic.make_vertical",
        reason: `${request.fit} ${request.outputWidth.toString()}x${request.outputHeight.toString()} aspect conversion`,
      },
      arguments: {
        format: {
          ...sequence.format,
          width: request.outputWidth,
          height: request.outputHeight,
        },
      },
    },
  ];
  const affectedRanges: TimeRange[] = [];
  const warnings: string[] = [
    "Vertical framing uses a deterministic center-frame heuristic; evaluate faces, text, and focal subjects in preview before commit",
  ];
  for (const track of sequence.tracks) {
    if (!selectedTrackIds.has(track.id)) continue;
    if (track.kind !== "video") {
      warnings.push(`Skipped non-video track ${track.id}`);
      continue;
    }
    if (track.locked) {
      warnings.push(`Skipped locked track ${track.id}`);
      continue;
    }
    for (const item of track.items) {
      if (item.type !== "clip") {
        if (item.type !== "gap" && item.type !== "transition") {
          warnings.push(
            `Visual item ${item.id} (${item.type}) requires manual vertical framing`,
          );
        }
        continue;
      }
      operations.push({
        operationId: createId(),
        type: "video.scale.set",
        targetId: item.id,
        preconditions: [{ kind: "entity_exists", entityId: item.id }],
        provenance: {
          actorType: "system",
          actorId: "semantic.make_vertical",
          reason: `Apply deterministic ${request.fit} framing`,
        },
        arguments: {
          sequenceId: sequence.id,
          trackId: track.id,
          x: item.transform.scaleX * horizontalFactor,
          y: item.transform.scaleY * verticalFactor,
        },
      });
      affectedRanges.push(item.timelineRange);
      if (operations.length > request.maximumOperations) {
        throw new FrameOSError(
          "RESOURCE_LIMIT",
          `Vertical conversion requires more than ${request.maximumOperations.toString()} operations; narrow the selected tracks`,
          413,
        );
      }
    }
  }
  return semanticEditPlanSchema.parse({
    projectId: project.projectId,
    baseRevision: project.revision,
    semanticOperation: "semantic.make_vertical",
    operations,
    sourceArtifactIds: [],
    affectedRanges,
    warnings: [...new Set(warnings)],
  });
}

interface TimelineBeat {
  frame: number;
  artifactId: string;
  confidence: number;
}

export function compileMatchCutsToMusic(
  project: Project,
  input: SemanticMatchCutsToMusicRequest,
  beatResults: readonly AnalysisSearchResult[],
): SemanticEditPlan {
  const request = semanticMatchCutsToMusicRequestSchema.parse(input);
  if (request.projectId !== project.projectId) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Semantic edit project id does not match the supplied project state",
      422,
    );
  }
  if (
    request.baseRevision !== undefined &&
    request.baseRevision !== project.revision
  ) {
    throw new FrameOSError(
      "REVISION_CONFLICT",
      `Expected revision ${request.baseRevision.toString()}, found ${project.revision.toString()}`,
      409,
    );
  }
  const sequenceId = request.sequenceId ?? project.settings.defaultSequenceId;
  const sequence = project.sequences[sequenceId];
  if (sequence === undefined) {
    throw new FrameOSError(
      "NOT_FOUND",
      `Sequence ${sequenceId} was not found`,
      404,
    );
  }
  const musicClip = sequence.tracks
    .flatMap((track) => track.items)
    .find(
      (item): item is Extract<typeof item, { type: "clip" }> =>
        item.type === "clip" && item.id === request.musicClipId,
    );
  if (musicClip === undefined) {
    throw new FrameOSError(
      "NOT_FOUND",
      `Music clip ${request.musicClipId} was not found in sequence ${sequenceId}`,
      404,
    );
  }
  if (musicClip.timeMap.length > 0) {
    throw new FrameOSError(
      "CAPABILITY_UNAVAILABLE",
      "Beat-to-timeline mapping for a retimed music clip is unavailable",
      424,
    );
  }
  const selectedTrackIds =
    request.trackIds === undefined
      ? new Set(
          sequence.tracks
            .filter((track) => track.kind === "video")
            .map((track) => track.id),
        )
      : new Set(request.trackIds);
  const unknownTracks = [...selectedTrackIds].filter(
    (trackId) => !sequence.tracks.some((track) => track.id === trackId),
  );
  if (unknownTracks.length > 0) {
    throw new FrameOSError(
      "NOT_FOUND",
      `Tracks were not found in sequence ${sequenceId}: ${unknownTracks.join(", ")}`,
      404,
    );
  }

  const warnings: string[] = [
    "Beat matching inserts edit boundaries only; evaluate shot choice and pacing in preview before commit",
  ];
  const sourceStartSeconds = toSeconds(musicClip.sourceRange.start);
  const sourceEndSeconds =
    sourceStartSeconds + toSeconds(musicClip.sourceRange.duration);
  const timelineRate = sequence.format.frameRate;
  const timelineStart = fromSeconds(
    toSeconds(musicClip.timelineRange.start),
    timelineRate,
  ).time.value;
  const candidates: TimelineBeat[] = [];
  for (const result of beatResults) {
    if (
      result.assetId !== musicClip.assetId ||
      result.type !== "beats" ||
      result.range === undefined ||
      (result.confidence ?? 0) < request.minimumConfidence
    ) {
      continue;
    }
    const sourceSeconds = toSeconds(result.range.start);
    if (
      sourceSeconds <= sourceStartSeconds ||
      sourceSeconds >= sourceEndSeconds
    ) {
      continue;
    }
    const offset = fromSeconds(
      sourceSeconds - sourceStartSeconds,
      timelineRate,
    );
    if (offset.rounded) {
      warnings.push("Some beat positions were rounded to sequence frames");
    }
    candidates.push({
      frame: timelineStart + offset.time.value,
      artifactId: result.artifactId,
      confidence: result.confidence ?? 0,
    });
  }
  candidates.sort(
    (left, right) =>
      left.frame - right.frame || right.confidence - left.confidence,
  );
  const minimumSpacing = Math.max(
    1,
    fromSeconds(request.minimumSpacingMs / 1_000, timelineRate).time.value,
  );
  const beats: TimelineBeat[] = [];
  for (const candidate of candidates) {
    const previous = beats.at(-1);
    if (
      previous !== undefined &&
      candidate.frame - previous.frame < minimumSpacing
    ) {
      if (candidate.confidence > previous.confidence)
        beats[beats.length - 1] = candidate;
      continue;
    }
    beats.push(candidate);
  }

  const operations: Operation[] = [];
  const affectedRanges: TimeRange[] = [];
  const sourceArtifactIds = new Set<string>();
  for (const track of sequence.tracks) {
    if (!selectedTrackIds.has(track.id)) continue;
    if (track.locked) {
      warnings.push(`Skipped locked track ${track.id}`);
      continue;
    }
    if (track.kind !== "video") {
      warnings.push(
        `Selected non-video track ${track.id}; its clips will still be split`,
      );
    }
    for (const item of track.items) {
      if (item.type !== "clip" || !item.enabled) continue;
      if (item.locked) {
        warnings.push(`Skipped locked clip ${item.id}`);
        continue;
      }
      if (item.timeMap.length > 0) {
        warnings.push(`Skipped retimed clip ${item.id}`);
        continue;
      }
      const start = fromSeconds(
        toSeconds(item.timelineRange.start),
        timelineRate,
      ).time.value;
      const duration = fromSeconds(
        toSeconds(item.timelineRange.duration),
        timelineRate,
      ).time.value;
      const clipBeats = beats
        .filter((beat) => beat.frame > start && beat.frame < start + duration)
        .toReversed();
      for (const beat of clipBeats) {
        operations.push({
          operationId: createId(),
          type: "clip.split",
          targetId: item.id,
          preconditions: [{ kind: "entity_exists", entityId: item.id }],
          provenance: {
            actorType: "system",
            actorId: "semantic.match_cuts_to_music",
            reason: `Insert cut at beat detected by ${beat.artifactId}`,
          },
          arguments: {
            sequenceId,
            trackId: track.id,
            at: { value: beat.frame, rate: timelineRate },
            rightClipId: createId(),
          },
        });
        affectedRanges.push({
          start: { value: beat.frame, rate: timelineRate },
          duration: { value: 1, rate: timelineRate },
        });
        sourceArtifactIds.add(beat.artifactId);
        if (operations.length > request.maximumOperations) {
          throw new FrameOSError(
            "RESOURCE_LIMIT",
            `Beat matching requires more than ${request.maximumOperations.toString()} operations; narrow the tracks or increase spacing`,
            413,
          );
        }
      }
      if (item.links.length > 0 && clipBeats.length > 0) {
        warnings.push(
          `Clip ${item.id} has linked items; validate A/V synchronization before commit`,
        );
      }
    }
  }
  if (beatResults.length === 500) {
    warnings.push(
      "Beat search reached its 500-segment planning limit; increase minimum spacing or analyze a shorter music asset",
    );
  }
  return semanticEditPlanSchema.parse({
    projectId: project.projectId,
    baseRevision: project.revision,
    semanticOperation: "semantic.match_cuts_to_music",
    operations,
    sourceArtifactIds: [...sourceArtifactIds].sort(),
    affectedRanges,
    warnings: [...new Set(warnings)],
  });
}

type ProjectClip = Extract<
  Project["sequences"][string]["tracks"][number]["items"][number],
  { type: "clip" }
>;

function mapSourceRangeToTimeline(
  clip: ProjectClip,
  sourceRange: TimeRange,
  projectRate: Project["sequences"][string]["format"]["frameRate"],
  warnings: string[],
): TimeRange | undefined {
  const clipSourceStart = toSeconds(clip.sourceRange.start);
  const clipSourceEnd = clipSourceStart + toSeconds(clip.sourceRange.duration);
  const sourceStart = Math.max(clipSourceStart, toSeconds(sourceRange.start));
  const sourceEnd = Math.min(
    clipSourceEnd,
    toSeconds(sourceRange.start) + toSeconds(sourceRange.duration),
  );
  if (sourceEnd <= sourceStart) return undefined;
  const startOffset = fromSeconds(sourceStart - clipSourceStart, projectRate);
  const duration = fromSeconds(sourceEnd - sourceStart, projectRate);
  const clipTimelineStart = fromSeconds(
    toSeconds(clip.timelineRange.start),
    projectRate,
  );
  if (startOffset.rounded || duration.rounded || clipTimelineStart.rounded) {
    warnings.push("Some transcript positions were rounded to sequence frames");
  }
  if (duration.time.value <= 0) return undefined;
  return {
    start: {
      value: clipTimelineStart.time.value + startOffset.time.value,
      rate: projectRate,
    },
    duration: duration.time,
  };
}

function dynamicCaptionWords(
  result: AnalysisSearchResult,
  clip: ProjectClip,
  rate: Project["sequences"][string]["format"]["frameRate"],
  warnings: string[],
): Record<string, unknown>[] {
  if (!Array.isArray(result.metadata.words)) return [];
  const words: Record<string, unknown>[] = [];
  for (const candidate of result.metadata.words.slice(0, 10_000)) {
    if (candidate === null || typeof candidate !== "object") continue;
    const word = candidate as Record<string, unknown>;
    const text = typeof word.text === "string" ? word.text.slice(0, 1_024) : "";
    const parsedRange = timeRangeSchema.safeParse(word.range);
    if (text === "" || !parsedRange.success) continue;
    const mapped = mapSourceRangeToTimeline(
      clip,
      parsedRange.data,
      rate,
      warnings,
    );
    if (mapped === undefined) continue;
    words.push({
      text,
      range: mapped,
      ...(typeof word.confidence === "number" &&
      Number.isFinite(word.confidence)
        ? { confidence: Math.max(0, Math.min(1, word.confidence)) }
        : {}),
    });
  }
  return words;
}

export function compileAddDynamicCaptions(
  project: Project,
  input: SemanticAddDynamicCaptionsRequest,
  transcriptResults: readonly AnalysisSearchResult[],
): SemanticEditPlan {
  const request = semanticAddDynamicCaptionsRequestSchema.parse(input);
  if (request.projectId !== project.projectId) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Semantic edit project id does not match the supplied project state",
      422,
    );
  }
  if (
    request.baseRevision !== undefined &&
    request.baseRevision !== project.revision
  ) {
    throw new FrameOSError(
      "REVISION_CONFLICT",
      `Expected revision ${request.baseRevision.toString()}, found ${project.revision.toString()}`,
      409,
    );
  }
  const sequenceId = request.sequenceId ?? project.settings.defaultSequenceId;
  const sequence = project.sequences[sequenceId];
  if (sequence === undefined) {
    throw new FrameOSError(
      "NOT_FOUND",
      `Sequence ${sequenceId} was not found`,
      404,
    );
  }
  const requestedClipIds = new Set(request.sourceClipIds);
  const clips = sequence.tracks
    .flatMap((track) => track.items)
    .filter(
      (item): item is ProjectClip =>
        item.type === "clip" && requestedClipIds.has(item.id),
    );
  const foundIds = new Set(clips.map((clip) => clip.id));
  const missingClipIds = request.sourceClipIds.filter(
    (id) => !foundIds.has(id),
  );
  if (missingClipIds.length > 0) {
    throw new FrameOSError(
      "NOT_FOUND",
      `Source clips were not found in sequence ${sequenceId}: ${missingClipIds.join(", ")}`,
      404,
    );
  }
  const trackId = request.captionTrackId ?? createId();
  if (sequence.captions.some((track) => track.id === trackId)) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Caption track ${trackId} already exists`,
      422,
    );
  }
  const selectedArtifacts =
    request.artifactIds === undefined
      ? undefined
      : new Set(request.artifactIds);
  const warnings: string[] = [];
  const cues: Array<{
    cue: {
      id: string;
      range: TimeRange;
      text: string;
      speaker?: string;
      words: Record<string, unknown>[];
      style: Record<string, unknown>;
    };
    artifactId: string;
  }> = [];
  for (const clip of clips) {
    if (clip.timeMap.length > 0) {
      warnings.push(`Skipped retimed source clip ${clip.id}`);
      continue;
    }
    for (const result of transcriptResults) {
      const text = result.text?.trim();
      if (
        result.assetId !== clip.assetId ||
        result.type !== "transcript" ||
        result.range === undefined ||
        text === undefined ||
        text === "" ||
        (result.confidence ?? 0) < request.minimumConfidence ||
        (selectedArtifacts !== undefined &&
          !selectedArtifacts.has(result.artifactId))
      ) {
        continue;
      }
      const range = mapSourceRangeToTimeline(
        clip,
        result.range,
        sequence.format.frameRate,
        warnings,
      );
      if (range === undefined) continue;
      const words = request.wordHighlight
        ? dynamicCaptionWords(result, clip, sequence.format.frameRate, warnings)
        : [];
      cues.push({
        cue: {
          id: createId(),
          range,
          text: text.slice(0, 100_000),
          ...(result.speaker === undefined
            ? {}
            : { speaker: result.speaker.slice(0, 512) }),
          words,
          style: {
            dynamic: true,
            wordHighlight: request.wordHighlight && words.length > 0,
            sourceArtifactId: result.artifactId,
            sourceClipId: clip.id,
          },
        },
        artifactId: result.artifactId,
      });
    }
  }
  cues.sort(
    (left, right) =>
      toSeconds(left.cue.range.start) - toSeconds(right.cue.range.start),
  );
  if (cues.length + 1 > request.maximumOperations) {
    throw new FrameOSError(
      "RESOURCE_LIMIT",
      `Dynamic captions require ${String(cues.length + 1)} operations, exceeding the ${request.maximumOperations.toString()}-operation limit; narrow the clips or artifacts`,
      413,
    );
  }
  const operations: Operation[] = [
    {
      operationId: createId(),
      type: "caption.track.add",
      preconditions: [{ kind: "entity_exists", entityId: sequence.id }],
      provenance: {
        actorType: "system",
        actorId: "semantic.add_dynamic_captions",
        reason: "Create a caption track from indexed transcript ranges",
      },
      arguments: {
        sequenceId,
        track: {
          id: trackId,
          name: request.name,
          language: request.language,
          enabled: true,
          cues: [],
          style: {
            preset: "frameos.dynamic-caption-v1",
            safeArea: 0.9,
            placement: "bottom-center",
            wordHighlight: request.wordHighlight,
            ...request.style,
          },
        },
      },
    },
    ...cues.map(({ cue, artifactId }): Operation => ({
      operationId: createId(),
      type: "caption.cue.add",
      preconditions: [{ kind: "entity_exists", entityId: trackId }],
      provenance: {
        actorType: "system",
        actorId: "semantic.add_dynamic_captions",
        reason: `Create caption cue from transcript artifact ${artifactId}`,
      },
      arguments: { sequenceId, captionTrackId: trackId, cue },
    })),
  ];
  if (transcriptResults.length === 500) {
    warnings.push(
      "Transcript search reached its 500-segment planning limit; narrow the source clips or artifacts",
    );
  }
  if (request.wordHighlight && cues.some(({ cue }) => cue.words.length === 0)) {
    warnings.push(
      "Some transcript segments have no word timestamps and cannot use word-level highlighting",
    );
  }
  return semanticEditPlanSchema.parse({
    projectId: project.projectId,
    baseRevision: project.revision,
    semanticOperation: "semantic.add_dynamic_captions",
    operations,
    sourceArtifactIds: [...new Set(cues.map((cue) => cue.artifactId))].sort(),
    affectedRanges: cues.map(({ cue }) => cue.range),
    warnings: [...new Set(warnings)],
  });
}

export class SemanticService {
  public constructor(
    private readonly projects: ProjectStore,
    private readonly analysis: AnalysisService,
  ) {}

  public async find(input: SemanticFindRequest): Promise<SemanticFindResult> {
    const request = semanticFindRequestSchema.parse(input);
    const searchQuery =
      request.kind === "silence"
        ? "silence"
        : request.kind === "best_take"
          ? request.query || "quality"
          : request.kind === "speaker"
            ? ""
            : request.query;
    let matches = await this.analysis.search({
      projectId: request.projectId,
      query: searchQuery,
      mode: "lexical",
      ...(request.assetIds === undefined ? {} : { assetIds: request.assetIds }),
      types: semanticTypes[request.kind],
      limit: request.kind === "speaker" ? 500 : request.limit,
    });
    if (request.kind === "speaker") {
      const query = request.query.toLocaleLowerCase();
      matches = matches
        .filter((match) => match.speaker?.toLocaleLowerCase().includes(query))
        .slice(0, request.limit);
    }
    return semanticFindResultSchema.parse({
      kind: request.kind,
      query: request.query,
      matches,
    });
  }

  public async planRemoveSilences(
    input: SemanticRemoveSilencesRequest,
  ): Promise<SemanticEditPlan> {
    const request = semanticRemoveSilencesRequestSchema.parse(input);
    const project = await this.projects.load(request.projectId);
    const silenceResults = await this.analysis.search({
      projectId: request.projectId,
      query: "silence",
      mode: "lexical",
      ...(request.assetIds === undefined ? {} : { assetIds: request.assetIds }),
      types: ["silence"],
      limit: 500,
    });
    return compileRemoveSilences(project, request, silenceResults);
  }

  public async planMakeVertical(
    input: SemanticMakeVerticalRequest,
  ): Promise<SemanticEditPlan> {
    const request = semanticMakeVerticalRequestSchema.parse(input);
    const project = await this.projects.load(request.projectId);
    return compileMakeVertical(project, request);
  }

  public async planMatchCutsToMusic(
    input: SemanticMatchCutsToMusicRequest,
  ): Promise<SemanticEditPlan> {
    const request = semanticMatchCutsToMusicRequestSchema.parse(input);
    const project = await this.projects.load(request.projectId);
    const sequenceId = request.sequenceId ?? project.settings.defaultSequenceId;
    const sequence = project.sequences[sequenceId];
    const musicClip = sequence?.tracks
      .flatMap((track) => track.items)
      .find((item) => item.type === "clip" && item.id === request.musicClipId);
    const beatResults = await this.analysis.search({
      projectId: request.projectId,
      query: "beat",
      mode: "lexical",
      ...(musicClip?.type === "clip" ? { assetIds: [musicClip.assetId] } : {}),
      types: ["beats"],
      limit: 500,
    });
    return compileMatchCutsToMusic(project, request, beatResults);
  }

  public async planAddDynamicCaptions(
    input: SemanticAddDynamicCaptionsRequest,
  ): Promise<SemanticEditPlan> {
    const request = semanticAddDynamicCaptionsRequestSchema.parse(input);
    const project = await this.projects.load(request.projectId);
    const sequenceId = request.sequenceId ?? project.settings.defaultSequenceId;
    const sequence = project.sequences[sequenceId];
    const selectedClipIds = new Set(request.sourceClipIds);
    const assetIds = sequence?.tracks
      .flatMap((track) => track.items)
      .filter(
        (item): item is ProjectClip =>
          item.type === "clip" && selectedClipIds.has(item.id),
      )
      .map((clip) => clip.assetId);
    const transcriptResults = await this.analysis.search({
      projectId: request.projectId,
      query: "speech",
      mode: "lexical",
      ...(assetIds === undefined ? {} : { assetIds: [...new Set(assetIds)] }),
      types: ["transcript"],
      limit: 500,
    });
    return compileAddDynamicCaptions(project, request, transcriptResults);
  }
}
