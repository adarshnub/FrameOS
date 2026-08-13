import {
  FrameOSError,
  createId,
  fromSeconds,
  semanticAddDynamicCaptionsRequestSchema,
  semanticCreateHighlightRequestSchema,
  semanticEditPlanSchema,
  semanticFindRequestSchema,
  semanticFindResultSchema,
  semanticMakeVerticalRequestSchema,
  semanticMatchCutsToMusicRequestSchema,
  semanticRemoveSilencesRequestSchema,
  semanticSyncBrollRequestSchema,
  timeRangeSchema,
  toSeconds,
  type AnalysisSearchResult,
  type Operation,
  type Project,
  type SemanticEditPlan,
  type SemanticAddDynamicCaptionsRequest,
  type SemanticCreateHighlightRequest,
  type SemanticFindRequest,
  type SemanticFindResult,
  type SemanticMakeVerticalRequest,
  type SemanticMatchCutsToMusicRequest,
  type SemanticRemoveSilencesRequest,
  type SemanticSyncBrollRequest,
  type TimeRange,
} from "@frameos/contracts";
import type { AnalysisService } from "../analysis/analysis-service.js";
import type { ProjectStore } from "../store/project-store.js";

interface FrameInterval {
  start: number;
  end: number;
  artifactId: string;
}

type ProjectClip = Extract<
  Project["sequences"][string]["tracks"][number]["items"][number],
  { type: "clip" }
>;

type ProjectTrack = Project["sequences"][string]["tracks"][number];

function clipTimelineStartFrame(
  clip: ProjectClip,
  rate: Project["sequences"][string]["format"]["frameRate"],
  warnings: string[],
): number {
  const start = fromSeconds(toSeconds(clip.timelineRange.start), rate);
  if (start.rounded) {
    warnings.push(`Timeline start for clip ${clip.id} was rounded to frames`);
  }
  return start.time.value;
}

function sourceSecondsToClipValue(clip: ProjectClip, seconds: number): number {
  return (
    (seconds * clip.sourceRange.start.rate.numerator) /
    clip.sourceRange.start.rate.denominator
  );
}

function mapSourceSecondsToTimelineFrame(
  clip: ProjectClip,
  sourceSeconds: number,
  rate: Project["sequences"][string]["format"]["frameRate"],
  warnings: string[],
): number | undefined {
  const clipSourceStart = toSeconds(clip.sourceRange.start);
  const clipSourceEnd = clipSourceStart + toSeconds(clip.sourceRange.duration);
  if (sourceSeconds < clipSourceStart || sourceSeconds > clipSourceEnd) {
    return undefined;
  }
  if (clip.timeMap.length === 0) {
    const offset = fromSeconds(sourceSeconds - clipSourceStart, rate);
    if (offset.rounded) {
      warnings.push(
        `Source mapping for clip ${clip.id} was rounded to sequence frames`,
      );
    }
    return clipTimelineStartFrame(clip, rate, warnings) + offset.time.value;
  }
  const mapped = clip.timeMap.map((keyframe) => {
    if (
      typeof keyframe.value !== "number" ||
      !Number.isFinite(keyframe.value)
    ) {
      warnings.push(
        `Skipped retimed clip ${clip.id}; time-map value is not numeric`,
      );
      return undefined;
    }
    const frame = fromSeconds(toSeconds(keyframe.time), rate);
    if (frame.rounded) {
      warnings.push(
        `Time-map keyframe for clip ${clip.id} was rounded to sequence frames`,
      );
    }
    return {
      frame: frame.time.value,
      interpolation: keyframe.interpolation,
      value: keyframe.value,
    };
  });
  if (mapped.some((keyframe) => keyframe === undefined)) return undefined;
  const keyframes = mapped as Array<{
    frame: number;
    interpolation: ProjectClip["timeMap"][number]["interpolation"];
    value: number;
  }>;
  for (let index = 1; index < keyframes.length; index += 1) {
    if (keyframes[index]!.value < keyframes[index - 1]!.value) {
      warnings.push(
        `Skipped retimed clip ${clip.id}; reverse source mapping is not supported by this semantic planner`,
      );
      return undefined;
    }
  }
  const sourceValue = sourceSecondsToClipValue(clip, sourceSeconds);
  const exact = keyframes.find(
    (keyframe) => Math.abs(keyframe.value - sourceValue) < Number.EPSILON,
  );
  if (exact !== undefined) {
    return clipTimelineStartFrame(clip, rate, warnings) + exact.frame;
  }
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const left = keyframes[index]!;
    const right = keyframes[index + 1]!;
    if (sourceValue < left.value || sourceValue > right.value) continue;
    if (left.interpolation !== "linear" || right.value === left.value) {
      warnings.push(
        `Skipped retimed clip ${clip.id}; ${left.interpolation} source mapping is not supported by this semantic planner`,
      );
      return undefined;
    }
    const progress = (sourceValue - left.value) / (right.value - left.value);
    const localFrame = left.frame + progress * (right.frame - left.frame);
    const rounded = Math.round(localFrame);
    if (Math.abs(localFrame - rounded) > Number.EPSILON) {
      warnings.push(
        `Retimed source mapping for clip ${clip.id} was rounded to sequence frames`,
      );
    }
    return clipTimelineStartFrame(clip, rate, warnings) + rounded;
  }
  return undefined;
}

function retimedSplitArguments(
  clip: ProjectClip,
  atFrame: number,
  rate: Project["sequences"][string]["format"]["frameRate"],
  rightClipId: string,
):
  | {
      at: {
        value: number;
        rate: Project["sequences"][string]["format"]["frameRate"];
      };
      rightClipId: string;
      leftEndKeyframeId?: string;
      rightStartKeyframeId?: string;
    }
  | undefined {
  const base = { at: { value: atFrame, rate }, rightClipId };
  if (clip.timeMap.length === 0) return base;
  const clipStart = fromSeconds(toSeconds(clip.timelineRange.start), rate);
  if (clipStart.rounded) return undefined;
  const localFrame = atFrame - clipStart.time.value;
  const exact = clip.timeMap.some((keyframe) => {
    const frame = fromSeconds(toSeconds(keyframe.time), rate);
    return !frame.rounded && frame.time.value === localFrame;
  });
  return {
    ...base,
    ...(exact ? {} : { leftEndKeyframeId: createId() }),
    rightStartKeyframeId: createId(),
  };
}

function trackEndFrame(
  track: ProjectTrack,
  rate: Project["sequences"][string]["format"]["frameRate"],
  warnings: string[],
): number {
  let end = 0;
  for (const item of track.items) {
    if (item.type === "transition") continue;
    const start = fromSeconds(toSeconds(item.timelineRange.start), rate);
    const duration = fromSeconds(toSeconds(item.timelineRange.duration), rate);
    if (start.rounded || duration.rounded) {
      warnings.push(
        `Timeline range for item ${item.id} was rounded while planning highlight placement`,
      );
    }
    end = Math.max(end, start.time.value + duration.time.value);
  }
  return end;
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
  clip: ProjectClip,
  results: readonly AnalysisSearchResult[],
  request: SemanticRemoveSilencesRequest,
  warnings: string[],
): FrameInterval[] {
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
    const mappedStart = mapSourceSecondsToTimelineFrame(
      clip,
      startSeconds,
      rate,
      warnings,
    );
    const mappedEnd = mapSourceSecondsToTimelineFrame(
      clip,
      endSeconds,
      rate,
      warnings,
    );
    if (mappedStart === undefined || mappedEnd === undefined) continue;
    const clipStart = clipTimelineStartFrame(clip, rate, warnings);
    const clipEnd = clipStart + clip.timelineRange.duration.value;
    const start = Math.max(clipStart, mappedStart);
    const end = Math.min(clipEnd, mappedEnd);
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
          const splitArguments = retimedSplitArguments(
            item,
            end,
            item.timelineRange.start.rate,
            createId(),
          );
          if (splitArguments === undefined) {
            warnings.push(
              `Skipped split after retimed silence in clip ${item.id}`,
            );
            continue;
          }
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
              ...splitArguments,
            },
          });
        }
        if (start > currentStart) {
          const silenceClipId = createId();
          const splitArguments = retimedSplitArguments(
            item,
            start,
            item.timelineRange.start.rate,
            silenceClipId,
          );
          if (splitArguments === undefined) {
            warnings.push(
              `Skipped split before retimed silence in clip ${item.id}`,
            );
            continue;
          }
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
                ...splitArguments,
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
    const mappedFrame = mapSourceSecondsToTimelineFrame(
      musicClip,
      sourceSeconds,
      timelineRate,
      warnings,
    );
    if (mappedFrame === undefined) continue;
    candidates.push({
      frame: mappedFrame,
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
        const splitArguments = retimedSplitArguments(
          item,
          beat.frame,
          timelineRate,
          createId(),
        );
        if (splitArguments === undefined) {
          warnings.push(`Skipped retimed split for clip ${item.id}`);
          continue;
        }
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
            ...splitArguments,
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
  const start = mapSourceSecondsToTimelineFrame(
    clip,
    sourceStart,
    projectRate,
    warnings,
  );
  const end = mapSourceSecondsToTimelineFrame(
    clip,
    sourceEnd,
    projectRate,
    warnings,
  );
  if (start === undefined || end === undefined || end <= start)
    return undefined;
  return {
    start: { value: start, rate: projectRate },
    duration: { value: end - start, rate: projectRate },
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

interface HighlightCandidate {
  clip: ProjectClip;
  trackId: string;
  sourceRange: TimeRange;
  timelineDurationFrames: number;
  score: number;
  artifactId: string;
  sourceStartSeconds: number;
}

interface SyncBrollTarget {
  range: TimeRange;
  artifactId: string;
  startFrame: number;
  durationFrames: number;
}

interface SyncBrollCandidate {
  clip: ProjectClip;
  trackId: string;
  sourceRange: TimeRange;
  timelineDurationFrames: number;
  score: number;
  artifactId: string;
  sourceStartSeconds: number;
}

function trackHasOverlap(
  track: ProjectTrack,
  startFrame: number,
  durationFrames: number,
  rate: Project["sequences"][string]["format"]["frameRate"],
  warnings: string[],
): boolean {
  const endFrame = startFrame + durationFrames;
  for (const item of track.items) {
    if (item.type === "transition") continue;
    const start = fromSeconds(toSeconds(item.timelineRange.start), rate);
    const duration = fromSeconds(toSeconds(item.timelineRange.duration), rate);
    if (start.rounded || duration.rounded) {
      warnings.push(
        `Destination item ${item.id} was rounded while checking B-roll overlap`,
      );
    }
    if (
      start.time.value < endFrame &&
      start.time.value + duration.time.value > startFrame
    ) {
      return true;
    }
  }
  return false;
}

export function compileSyncBroll(
  project: Project,
  input: SemanticSyncBrollRequest,
  analysisResults: readonly AnalysisSearchResult[],
): SemanticEditPlan {
  const request = semanticSyncBrollRequestSchema.parse(input);
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
  const requestedTargetIds = new Set(request.targetClipIds);
  const targetClips = sequence.tracks.flatMap((track) =>
    track.items.flatMap((item) =>
      item.type === "clip" && requestedTargetIds.has(item.id) ? [item] : [],
    ),
  );
  const foundTargetIds = new Set(targetClips.map((clip) => clip.id));
  const missingTargetIds = request.targetClipIds.filter(
    (id) => !foundTargetIds.has(id),
  );
  if (missingTargetIds.length > 0) {
    throw new FrameOSError(
      "NOT_FOUND",
      `Target clips were not found in sequence ${sequenceId}: ${missingTargetIds.join(", ")}`,
      404,
    );
  }

  const brollTrackIds =
    request.brollTrackIds === undefined
      ? new Set(
          sequence.tracks
            .filter((track) => track.kind === "video")
            .map((track) => track.id),
        )
      : new Set(request.brollTrackIds);
  const unknownBrollTracks = [...brollTrackIds].filter(
    (trackId) => !sequence.tracks.some((track) => track.id === trackId),
  );
  if (unknownBrollTracks.length > 0) {
    throw new FrameOSError(
      "NOT_FOUND",
      `B-roll tracks were not found in sequence ${sequenceId}: ${unknownBrollTracks.join(", ")}`,
      404,
    );
  }

  const warnings: string[] = [
    "B-roll sync pairs analysis ranges deterministically; preview visual relevance, continuity, and occlusion before commit",
  ];
  const targetTypes = new Set(request.targetTypes);
  const brollTypes = new Set(request.brollTypes);
  const selectedTargetArtifacts =
    request.targetArtifactIds === undefined
      ? undefined
      : new Set(request.targetArtifactIds);
  const selectedBrollArtifacts =
    request.brollArtifactIds === undefined
      ? undefined
      : new Set(request.brollArtifactIds);
  const selectedBrollAssets =
    request.brollAssetIds === undefined
      ? undefined
      : new Set(request.brollAssetIds);
  const targets: SyncBrollTarget[] = [];
  for (const clip of targetClips) {
    for (const result of analysisResults) {
      if (
        result.range === undefined ||
        result.assetId !== clip.assetId ||
        !targetTypes.has(result.type) ||
        (result.confidence ?? result.score) < request.minimumTargetConfidence ||
        (selectedTargetArtifacts !== undefined &&
          !selectedTargetArtifacts.has(result.artifactId))
      ) {
        continue;
      }
      const paddedRange: TimeRange = {
        start: fromSeconds(
          toSeconds(result.range.start) + request.edgePaddingMs / 1_000,
          result.range.start.rate,
        ).time,
        duration: fromSeconds(
          Math.max(
            0,
            toSeconds(result.range.duration) -
              (request.edgePaddingMs * 2) / 1_000,
          ),
          result.range.duration.rate,
        ).time,
      };
      const mapped = mapSourceRangeToTimeline(
        clip,
        paddedRange,
        sequence.format.frameRate,
        warnings,
      );
      if (mapped === undefined) continue;
      targets.push({
        range: mapped,
        artifactId: result.artifactId,
        startFrame: mapped.start.value,
        durationFrames: mapped.duration.value,
      });
    }
  }
  targets.sort(
    (left, right) =>
      left.startFrame - right.startFrame ||
      left.artifactId.localeCompare(right.artifactId),
  );

  const candidates: SyncBrollCandidate[] = [];
  for (const result of analysisResults) {
    if (
      result.range === undefined ||
      !brollTypes.has(result.type) ||
      (selectedBrollArtifacts !== undefined &&
        !selectedBrollArtifacts.has(result.artifactId)) ||
      (selectedBrollAssets !== undefined &&
        !selectedBrollAssets.has(result.assetId))
    ) {
      continue;
    }
    const score = Math.max(
      result.score,
      result.confidence ?? 0,
      result.semanticScore ?? 0,
      result.lexicalScore ?? 0,
    );
    if (score < request.minimumBrollScore) continue;
    const detectedStart = toSeconds(result.range.start);
    const detectedEnd = detectedStart + toSeconds(result.range.duration);
    const sourceStartSeconds = detectedStart + request.edgePaddingMs / 1_000;
    const sourceEndSeconds = detectedEnd - request.edgePaddingMs / 1_000;
    if (sourceEndSeconds <= sourceStartSeconds) continue;
    for (const track of sequence.tracks) {
      if (!brollTrackIds.has(track.id)) continue;
      if (track.kind !== "video") {
        warnings.push(`Skipped non-video B-roll track ${track.id}`);
        continue;
      }
      if (track.locked) {
        warnings.push(`Skipped locked B-roll track ${track.id}`);
        continue;
      }
      for (const clip of track.items) {
        if (
          clip.type !== "clip" ||
          !clip.enabled ||
          clip.assetId !== result.assetId ||
          requestedTargetIds.has(clip.id)
        ) {
          continue;
        }
        if (clip.locked) {
          warnings.push(`Skipped locked B-roll clip ${clip.id}`);
          continue;
        }
        if (clip.timeMap.length > 0) {
          warnings.push(
            `Skipped retimed B-roll clip ${clip.id}; sync_broll subclip extraction requires an exact retime adapter`,
          );
          continue;
        }
        const clipSourceStart = toSeconds(clip.sourceRange.start);
        const clipSourceEnd =
          clipSourceStart + toSeconds(clip.sourceRange.duration);
        const sourceStart = Math.max(clipSourceStart, sourceStartSeconds);
        const sourceEnd = Math.min(clipSourceEnd, sourceEndSeconds);
        const durationSeconds = Math.min(
          sourceEnd - sourceStart,
          request.maximumOverlayDurationMs / 1_000,
        );
        if (durationSeconds <= 0) continue;
        const sourceStartTime = fromSeconds(
          sourceStart,
          clip.sourceRange.start.rate,
        );
        const sourceDurationTime = fromSeconds(
          durationSeconds,
          clip.sourceRange.duration.rate,
        );
        const timelineDuration = fromSeconds(
          durationSeconds,
          sequence.format.frameRate,
        );
        if (
          sourceStartTime.rounded ||
          sourceDurationTime.rounded ||
          timelineDuration.rounded
        ) {
          warnings.push(
            `B-roll range for clip ${clip.id} was rounded to frame boundaries`,
          );
        }
        if (timelineDuration.time.value <= 0) continue;
        candidates.push({
          clip,
          trackId: track.id,
          sourceRange: {
            start: sourceStartTime.time,
            duration: sourceDurationTime.time,
          },
          timelineDurationFrames: timelineDuration.time.value,
          score,
          artifactId: result.artifactId,
          sourceStartSeconds: sourceStart,
        });
      }
    }
  }
  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.sourceStartSeconds - right.sourceStartSeconds ||
      left.clip.id.localeCompare(right.clip.id),
  );
  if (targets.length === 0 || candidates.length === 0) {
    warnings.push(
      targets.length === 0
        ? "No eligible target ranges were found for the selected target clips and analysis artifacts"
        : "No eligible B-roll source ranges were found for the selected tracks, assets, artifacts, and score threshold",
    );
    return semanticEditPlanSchema.parse({
      projectId: project.projectId,
      baseRevision: project.revision,
      semanticOperation: "semantic.sync_broll",
      operations: [],
      sourceArtifactIds: [],
      affectedRanges: [],
      warnings: [...new Set(warnings)],
    });
  }

  let destinationTrack = request.destinationTrackId
    ? sequence.tracks.find((track) => track.id === request.destinationTrackId)
    : undefined;
  if (
    request.destinationTrackId !== undefined &&
    destinationTrack === undefined
  ) {
    throw new FrameOSError(
      "NOT_FOUND",
      `Destination track ${request.destinationTrackId} was not found in sequence ${sequenceId}`,
      404,
    );
  }
  if (destinationTrack !== undefined) {
    if (destinationTrack.kind !== "video") {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Destination track ${destinationTrack.id} must be a video track`,
        422,
      );
    }
    if (destinationTrack.locked) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Destination track ${destinationTrack.id} is locked`,
        422,
      );
    }
  }
  const destinationTrackId = destinationTrack?.id ?? createId();
  const operations: Operation[] = [];
  if (destinationTrack === undefined) {
    const order =
      sequence.tracks.reduce(
        (maximum, track) => Math.max(maximum, track.order),
        -1,
      ) + 1;
    destinationTrack = {
      id: destinationTrackId,
      name: request.destinationTrackName,
      kind: "video",
      order,
      enabled: true,
      locked: false,
      muted: false,
      syncLocked: true,
      items: [],
      effects: [],
      metadata: { semanticOperation: "semantic.sync_broll" },
    };
    operations.push({
      operationId: createId(),
      type: "track.add",
      preconditions: [{ kind: "entity_exists", entityId: sequence.id }],
      provenance: {
        actorType: "system",
        actorId: "semantic.sync_broll",
        reason: "Create a destination track for synchronized B-roll overlays",
      },
      arguments: {
        sequenceId,
        track: destinationTrack,
      },
    });
  }

  const affectedRanges: TimeRange[] = [];
  const sourceArtifactIds = new Set<string>();
  const plannedOverlayRanges: Array<{ start: number; end: number }> = [];
  let candidateIndex = 0;
  for (const target of targets) {
    if (candidateIndex >= candidates.length) break;
    const candidate = candidates[candidateIndex]!;
    candidateIndex += 1;
    const clipFrames = Math.min(
      target.durationFrames,
      candidate.timelineDurationFrames,
      fromSeconds(
        request.maximumOverlayDurationMs / 1_000,
        sequence.format.frameRate,
      ).time.value,
    );
    if (clipFrames <= 0) continue;
    const overlayEndFrame = target.startFrame + clipFrames;
    if (
      plannedOverlayRanges.some(
        (range) =>
          range.start < overlayEndFrame && range.end > target.startFrame,
      )
    ) {
      warnings.push(
        `Skipped B-roll overlay at frame ${target.startFrame.toString()} because another planned overlay already covers that range`,
      );
      continue;
    }
    if (
      trackHasOverlap(
        destinationTrack,
        target.startFrame,
        clipFrames,
        sequence.format.frameRate,
        warnings,
      )
    ) {
      warnings.push(
        `Skipped B-roll overlay at frame ${target.startFrame.toString()} because destination track ${destinationTrack.id} already has media in that range`,
      );
      continue;
    }
    const durationSeconds =
      (clipFrames * sequence.format.frameRate.denominator) /
      sequence.format.frameRate.numerator;
    const sourceDuration = fromSeconds(
      durationSeconds,
      candidate.sourceRange.duration.rate,
    );
    if (sourceDuration.time.value <= 0) continue;
    const timelineRange = {
      start: { value: target.startFrame, rate: sequence.format.frameRate },
      duration: { value: clipFrames, rate: sequence.format.frameRate },
    };
    operations.push({
      operationId: createId(),
      type: "clip.overwrite",
      preconditions: [{ kind: "entity_exists", entityId: destinationTrackId }],
      provenance: {
        actorType: "system",
        actorId: "semantic.sync_broll",
        reason: `Align B-roll artifact ${candidate.artifactId} to target artifact ${target.artifactId}`,
      },
      arguments: {
        sequenceId,
        trackId: destinationTrackId,
        clip: {
          ...structuredClone(candidate.clip),
          id: createId(),
          name: `${candidate.clip.name} B-roll`,
          sourceRange: {
            start: candidate.sourceRange.start,
            duration: sourceDuration.time,
          },
          timelineRange,
          timeMap: [],
          links: [],
          semanticMetadata: {
            ...candidate.clip.semanticMetadata,
            semanticOperation: "semantic.sync_broll",
            sourceClipId: candidate.clip.id,
            sourceTrackId: candidate.trackId,
            sourceArtifactId: candidate.artifactId,
            targetArtifactId: target.artifactId,
            score: candidate.score,
          },
        },
      },
    });
    affectedRanges.push(timelineRange);
    plannedOverlayRanges.push({
      start: target.startFrame,
      end: overlayEndFrame,
    });
    sourceArtifactIds.add(candidate.artifactId);
    sourceArtifactIds.add(target.artifactId);
    if (operations.length > request.maximumOperations) {
      throw new FrameOSError(
        "RESOURCE_LIMIT",
        `B-roll sync requires more than ${request.maximumOperations.toString()} operations; reduce target clips, analysis ranges, or duration`,
        413,
      );
    }
  }
  if (affectedRanges.length === 0) {
    warnings.push(
      "No B-roll overlays were planned after destination overlap and duration checks",
    );
  }
  if (analysisResults.length === 500) {
    warnings.push(
      "B-roll sync reached its 500-segment search limit; narrow clips, tracks, assets, or analysis types",
    );
  }
  return semanticEditPlanSchema.parse({
    projectId: project.projectId,
    baseRevision: project.revision,
    semanticOperation: "semantic.sync_broll",
    operations,
    sourceArtifactIds: [...sourceArtifactIds].sort(),
    affectedRanges,
    warnings: [...new Set(warnings)],
  });
}

export function compileCreateHighlight(
  project: Project,
  input: SemanticCreateHighlightRequest,
  analysisResults: readonly AnalysisSearchResult[],
): SemanticEditPlan {
  const request = semanticCreateHighlightRequestSchema.parse(input);
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
  const sourceTrackIds =
    request.sourceTrackIds === undefined
      ? new Set(
          sequence.tracks
            .filter((track) => track.kind === "video")
            .map((track) => track.id),
        )
      : new Set(request.sourceTrackIds);
  const unknownSourceTracks = [...sourceTrackIds].filter(
    (trackId) => !sequence.tracks.some((track) => track.id === trackId),
  );
  if (unknownSourceTracks.length > 0) {
    throw new FrameOSError(
      "NOT_FOUND",
      `Source tracks were not found in sequence ${sequenceId}: ${unknownSourceTracks.join(", ")}`,
      404,
    );
  }
  const warnings: string[] = [
    "Highlight creation uses deterministic score and timeline ordering; preview pacing and story continuity before commit",
  ];
  const selectedAssets =
    request.assetIds === undefined ? undefined : new Set(request.assetIds);
  const selectedArtifacts =
    request.artifactIds === undefined
      ? undefined
      : new Set(request.artifactIds);
  const selectedTypes = new Set(request.types);
  const candidates: HighlightCandidate[] = [];
  for (const result of analysisResults) {
    if (
      result.range === undefined ||
      !selectedTypes.has(result.type) ||
      (selectedArtifacts !== undefined &&
        !selectedArtifacts.has(result.artifactId)) ||
      (selectedAssets !== undefined && !selectedAssets.has(result.assetId))
    ) {
      continue;
    }
    const score = Math.max(
      result.score,
      result.confidence ?? 0,
      result.semanticScore ?? 0,
      result.lexicalScore ?? 0,
    );
    if (score < request.minimumScore) continue;
    const detectedStart = toSeconds(result.range.start);
    const detectedEnd = detectedStart + toSeconds(result.range.duration);
    const paddedStart = detectedStart + request.edgePaddingMs / 1_000;
    const paddedEnd = detectedEnd - request.edgePaddingMs / 1_000;
    if (paddedEnd <= paddedStart) continue;
    for (const track of sequence.tracks) {
      if (!sourceTrackIds.has(track.id)) continue;
      if (track.kind !== "video") {
        warnings.push(`Skipped non-video source track ${track.id}`);
        continue;
      }
      if (track.locked) {
        warnings.push(`Skipped locked source track ${track.id}`);
        continue;
      }
      for (const clip of track.items) {
        if (
          clip.type !== "clip" ||
          clip.assetId !== result.assetId ||
          !clip.enabled
        ) {
          continue;
        }
        if (clip.locked) {
          warnings.push(`Skipped locked source clip ${clip.id}`);
          continue;
        }
        if (clip.timeMap.length > 0) {
          warnings.push(
            `Skipped retimed source clip ${clip.id}; highlight subclip extraction requires an exact retime adapter`,
          );
          continue;
        }
        const clipSourceStart = toSeconds(clip.sourceRange.start);
        const clipSourceEnd =
          clipSourceStart + toSeconds(clip.sourceRange.duration);
        const sourceStart = Math.max(clipSourceStart, paddedStart);
        const sourceEnd = Math.min(clipSourceEnd, paddedEnd);
        const durationSeconds = Math.min(
          sourceEnd - sourceStart,
          request.maximumClipDurationMs / 1_000,
        );
        if (durationSeconds <= 0) continue;
        const sourceStartTime = fromSeconds(
          sourceStart,
          clip.sourceRange.start.rate,
        );
        const sourceDurationTime = fromSeconds(
          durationSeconds,
          clip.sourceRange.duration.rate,
        );
        const timelineDuration = fromSeconds(
          durationSeconds,
          sequence.format.frameRate,
        );
        if (
          sourceStartTime.rounded ||
          sourceDurationTime.rounded ||
          timelineDuration.rounded
        ) {
          warnings.push(
            `Highlight range for clip ${clip.id} was rounded to frame boundaries`,
          );
        }
        if (timelineDuration.time.value <= 0) continue;
        candidates.push({
          clip,
          trackId: track.id,
          sourceRange: {
            start: sourceStartTime.time,
            duration: sourceDurationTime.time,
          },
          timelineDurationFrames: timelineDuration.time.value,
          score,
          artifactId: result.artifactId,
          sourceStartSeconds: sourceStart,
        });
      }
    }
  }
  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.sourceStartSeconds - right.sourceStartSeconds ||
      left.clip.id.localeCompare(right.clip.id),
  );
  if (candidates.length === 0) {
    warnings.push(
      "No eligible highlight segments were found for the selected tracks, assets, analysis types, and score threshold",
    );
    return semanticEditPlanSchema.parse({
      projectId: project.projectId,
      baseRevision: project.revision,
      semanticOperation: "semantic.create_highlight",
      operations: [],
      sourceArtifactIds: [],
      affectedRanges: [],
      warnings: [...new Set(warnings)],
    });
  }

  let destinationTrack = request.destinationTrackId
    ? sequence.tracks.find((track) => track.id === request.destinationTrackId)
    : undefined;
  if (
    request.destinationTrackId !== undefined &&
    destinationTrack === undefined
  ) {
    throw new FrameOSError(
      "NOT_FOUND",
      `Destination track ${request.destinationTrackId} was not found in sequence ${sequenceId}`,
      404,
    );
  }
  if (destinationTrack !== undefined) {
    if (destinationTrack.kind !== "video") {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Destination track ${destinationTrack.id} must be a video track`,
        422,
      );
    }
    if (destinationTrack.locked) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Destination track ${destinationTrack.id} is locked`,
        422,
      );
    }
  }
  const destinationTrackId = destinationTrack?.id ?? createId();
  const operations: Operation[] = [];
  if (destinationTrack === undefined) {
    const order =
      sequence.tracks.reduce(
        (maximum, track) => Math.max(maximum, track.order),
        -1,
      ) + 1;
    destinationTrack = {
      id: destinationTrackId,
      name: request.destinationTrackName,
      kind: "video",
      order,
      enabled: true,
      locked: false,
      muted: false,
      syncLocked: true,
      items: [],
      effects: [],
      metadata: {
        semanticOperation: "semantic.create_highlight",
      },
    };
    operations.push({
      operationId: createId(),
      type: "track.add",
      preconditions: [{ kind: "entity_exists", entityId: sequence.id }],
      provenance: {
        actorType: "system",
        actorId: "semantic.create_highlight",
        reason:
          "Create a destination track for the generated highlight assembly",
      },
      arguments: {
        sequenceId,
        track: destinationTrack,
      },
    });
  }

  const totalDurationFrames = fromSeconds(
    request.totalDurationMs / 1_000,
    sequence.format.frameRate,
  ).time.value;
  let assembledFrames = trackEndFrame(
    destinationTrack,
    sequence.format.frameRate,
    warnings,
  );
  const targetEndFrame = assembledFrames + totalDurationFrames;
  const affectedRanges: TimeRange[] = [];
  const sourceArtifactIds = new Set<string>();
  for (const candidate of candidates) {
    const remainingFrames = targetEndFrame - assembledFrames;
    if (remainingFrames <= 0) break;
    const clipFrames = Math.min(
      candidate.timelineDurationFrames,
      remainingFrames,
    );
    if (clipFrames <= 0) continue;
    const durationSeconds =
      (clipFrames * sequence.format.frameRate.denominator) /
      sequence.format.frameRate.numerator;
    const sourceDuration = fromSeconds(
      durationSeconds,
      candidate.sourceRange.duration.rate,
    );
    if (sourceDuration.time.value <= 0) continue;
    if (sourceDuration.rounded) {
      warnings.push(
        `Highlight tail for clip ${candidate.clip.id} was rounded to source frames`,
      );
    }
    const timelineRange = {
      start: { value: assembledFrames, rate: sequence.format.frameRate },
      duration: { value: clipFrames, rate: sequence.format.frameRate },
    };
    operations.push({
      operationId: createId(),
      type: "clip.append",
      preconditions: [{ kind: "entity_exists", entityId: destinationTrackId }],
      provenance: {
        actorType: "system",
        actorId: "semantic.create_highlight",
        reason: `Append highlight segment selected from analysis artifact ${candidate.artifactId}`,
      },
      arguments: {
        sequenceId,
        trackId: destinationTrackId,
        clip: {
          ...structuredClone(candidate.clip),
          id: createId(),
          name: `${candidate.clip.name} highlight`,
          sourceRange: {
            start: candidate.sourceRange.start,
            duration: sourceDuration.time,
          },
          timelineRange,
          timeMap: [],
          links: [],
          semanticMetadata: {
            ...candidate.clip.semanticMetadata,
            semanticOperation: "semantic.create_highlight",
            sourceClipId: candidate.clip.id,
            sourceTrackId: candidate.trackId,
            sourceArtifactId: candidate.artifactId,
            score: candidate.score,
          },
        },
      },
    });
    affectedRanges.push(timelineRange);
    sourceArtifactIds.add(candidate.artifactId);
    assembledFrames += clipFrames;
    if (operations.length > request.maximumOperations) {
      throw new FrameOSError(
        "RESOURCE_LIMIT",
        `Highlight creation requires more than ${request.maximumOperations.toString()} operations; reduce duration, tracks, or analysis types`,
        413,
      );
    }
  }
  if (affectedRanges.length === 0) {
    warnings.push(
      "No eligible highlight segments were found for the selected tracks, assets, analysis types, and score threshold",
    );
  }
  if (analysisResults.length === 500) {
    warnings.push(
      "Highlight planning reached its 500-segment search limit; narrow assets, tracks, or analysis types",
    );
  }
  return semanticEditPlanSchema.parse({
    projectId: project.projectId,
    baseRevision: project.revision,
    semanticOperation: "semantic.create_highlight",
    operations,
    sourceArtifactIds: [...sourceArtifactIds].sort(),
    affectedRanges,
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

  public async planCreateHighlight(
    input: SemanticCreateHighlightRequest,
  ): Promise<SemanticEditPlan> {
    const request = semanticCreateHighlightRequestSchema.parse(input);
    const project = await this.projects.load(request.projectId);
    const results = await this.analysis.search({
      projectId: request.projectId,
      query: request.query,
      mode: "lexical",
      ...(request.assetIds === undefined ? {} : { assetIds: request.assetIds }),
      types: request.types,
      limit: 500,
    });
    return compileCreateHighlight(project, request, results);
  }

  public async planSyncBroll(
    input: SemanticSyncBrollRequest,
  ): Promise<SemanticEditPlan> {
    const request = semanticSyncBrollRequestSchema.parse(input);
    const project = await this.projects.load(request.projectId);
    const types = [...new Set([...request.targetTypes, ...request.brollTypes])];
    const results = await this.analysis.search({
      projectId: request.projectId,
      query: request.query,
      mode: "lexical",
      types,
      limit: 500,
    });
    return compileSyncBroll(project, request, results);
  }
}
