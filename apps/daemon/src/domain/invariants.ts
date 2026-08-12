import {
  FrameOSError,
  addTime,
  compareTime,
  projectSchema,
  rescaleTime,
  type Project,
  type Sequence,
  type TimelineItem,
  type Track,
} from "@frameos/contracts";

export interface LocatedItem {
  sequence: Sequence;
  track: Track;
  item: TimelineItem;
  index: number;
}

export function requireSequence(
  project: Project,
  sequenceId: string,
): Sequence {
  const sequence = project.sequences[sequenceId];
  if (sequence === undefined) {
    throw new FrameOSError(
      "NOT_FOUND",
      `Sequence ${sequenceId} was not found`,
      404,
    );
  }
  return sequence;
}

export function requireTrack(
  sequence: Sequence,
  trackId: string,
  allowLocked = false,
): Track {
  const track = sequence.tracks.find((candidate) => candidate.id === trackId);
  if (track === undefined) {
    throw new FrameOSError("NOT_FOUND", `Track ${trackId} was not found`, 404);
  }
  if (track.locked && !allowLocked) {
    throw new FrameOSError("FORBIDDEN", `Track ${trackId} is locked`, 403);
  }
  return track;
}

export function requireItem(
  project: Project,
  sequenceId: string,
  trackId: string,
  itemId: string,
): LocatedItem {
  const sequence = requireSequence(project, sequenceId);
  const track = requireTrack(sequence, trackId);
  const index = track.items.findIndex((candidate) => candidate.id === itemId);
  if (index < 0) {
    throw new FrameOSError(
      "NOT_FOUND",
      `Timeline item ${itemId} was not found`,
      404,
    );
  }
  const item = track.items[index];
  if (item === undefined) {
    throw new FrameOSError(
      "INTERNAL_ERROR",
      "Timeline item lookup failed",
      500,
    );
  }
  return { sequence, track, item, index };
}

function ensureUniqueId(seen: Set<string>, id: string, kind: string): void {
  if (seen.has(id)) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Duplicate ${kind} id ${id}`,
      422,
    );
  }
  seen.add(id);
}

function validateItemReferences(
  project: Project,
  sequence: Sequence,
  track: Track,
  item: TimelineItem,
): void {
  if (
    compareTime(item.timelineRange.duration, {
      value: 0,
      rate: item.timelineRange.duration.rate,
    }) <= 0
  ) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Timeline item ${item.id} must have positive duration`,
      422,
    );
  }
  if (item.type === "clip" && project.assets[item.assetId] === undefined) {
    throw new FrameOSError(
      "MEDIA_OFFLINE",
      `Clip ${item.id} references missing asset ${item.assetId}`,
      422,
    );
  }
  if (
    rescaleTime(item.timelineRange.start, sequence.format.frameRate).rounded ||
    rescaleTime(item.timelineRange.duration, sequence.format.frameRate).rounded
  ) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Timeline item ${item.id} is not aligned to the sequence frame rate`,
      422,
    );
  }
  if (
    item.type === "nested_sequence" &&
    project.sequences[item.sequenceId] === undefined
  ) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Item ${item.id} references missing nested sequence ${item.sequenceId}`,
      422,
    );
  }
  if (item.type === "transition") {
    const from = track.items.find(
      (candidate) => candidate.id === item.fromItemId,
    );
    const to = track.items.find((candidate) => candidate.id === item.toItemId);
    if (from === undefined || to === undefined) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Transition ${item.id} references missing items`,
        422,
      );
    }
    if (
      from.id === to.id ||
      from.type === "transition" ||
      to.type === "transition"
    ) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Transition ${item.id} requires two distinct editorial endpoints`,
        422,
      );
    }
    const editPoint = addTime(
      from.timelineRange.start,
      from.timelineRange.duration,
    );
    const transitionEnd = addTime(
      item.timelineRange.start,
      item.timelineRange.duration,
    );
    const toEnd = addTime(to.timelineRange.start, to.timelineRange.duration);
    if (
      compareTime(editPoint, to.timelineRange.start) !== 0 ||
      compareTime(item.timelineRange.start, editPoint) >= 0 ||
      compareTime(transitionEnd, editPoint) <= 0 ||
      compareTime(item.timelineRange.start, from.timelineRange.start) < 0 ||
      compareTime(transitionEnd, toEnd) > 0
    ) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Transition ${item.id} must straddle the edit point between adjacent endpoints`,
        422,
      );
    }
    for (const curve of item.automationCurves) {
      for (const keyframe of curve.keyframes) {
        if (
          compareTime(keyframe.time, {
            value: 0,
            rate: keyframe.time.rate,
          }) < 0 ||
          compareTime(keyframe.time, item.timelineRange.duration) > 0
        ) {
          throw new FrameOSError(
            "VALIDATION_ERROR",
            `Transition keyframe ${keyframe.id} is outside transition ${item.id}`,
            422,
          );
        }
      }
    }
  }
  if (
    item.type === "clip" &&
    compareTime(item.sourceRange.duration, {
      value: 0,
      rate: item.sourceRange.duration.rate,
    }) <= 0
  ) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Clip ${item.id} source range must have positive duration`,
      422,
    );
  }
  if (item.type === "clip") {
    const asset = project.assets[item.assetId];
    if (asset?.duration !== undefined) {
      const start = rescaleTime(item.sourceRange.start, asset.duration.rate);
      const duration = rescaleTime(
        item.sourceRange.duration,
        asset.duration.rate,
      );
      if (
        start.rounded ||
        duration.rounded ||
        start.time.value + duration.time.value > asset.duration.value
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Clip ${item.id} source range exceeds or misaligns with its asset`,
          422,
        );
      }
    }
  }
  if (
    track.kind === "caption" &&
    item.type !== "title" &&
    item.type !== "gap"
  ) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Caption track ${track.id} cannot contain ${item.type}`,
      422,
    );
  }
  if (sequence.id === item.id) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Item ${item.id} cannot reuse its sequence id`,
      422,
    );
  }
}

export function validateProject(project: Project): Project {
  const parsed = projectSchema.parse(project);
  if (parsed.sequences[parsed.settings.defaultSequenceId] === undefined) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Default sequence does not exist",
      422,
    );
  }

  const seen = new Set<string>();
  const validateAutomationCurveIds = (
    curves: Project["sequences"][string]["outputEffects"][number]["automationCurves"],
  ): void => {
    for (const curve of curves) {
      ensureUniqueId(seen, curve.id, "automation curve");
      let previousTime = curve.keyframes[0]?.time;
      for (const [index, keyframe] of curve.keyframes.entries()) {
        ensureUniqueId(seen, keyframe.id, "keyframe");
        if (
          index > 0 &&
          previousTime !== undefined &&
          compareTime(previousTime, keyframe.time) >= 0
        ) {
          throw new FrameOSError(
            "VALIDATION_ERROR",
            `Automation curve ${curve.id} keyframes must be strictly ordered`,
            422,
          );
        }
        previousTime = keyframe.time;
      }
    }
  };
  const validateEffectIds = (
    effects: Project["sequences"][string]["outputEffects"],
  ): void => {
    for (const effect of effects) {
      ensureUniqueId(seen, effect.id, "effect");
      if (
        effect.maskRef !== undefined &&
        parsed.masks[effect.maskRef] === undefined
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Effect ${effect.id} references a missing mask`,
          422,
        );
      }
      validateAutomationCurveIds(effect.automationCurves);
    }
  };
  ensureUniqueId(seen, parsed.projectId, "project");
  const analysisReferenceCounts = new Map<string, number>();
  for (const asset of Object.values(parsed.assets)) {
    ensureUniqueId(seen, asset.id, "asset");
    const assetAnalysisRefs = new Set<string>();
    for (const analysisId of asset.analysisRefs) {
      if (assetAnalysisRefs.has(analysisId)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Asset ${asset.id} contains a duplicate analysis reference`,
          422,
        );
      }
      assetAnalysisRefs.add(analysisId);
      const analysis = parsed.analyses[analysisId];
      if (analysis === undefined || analysis.assetHash !== asset.hash) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Asset ${asset.id} references missing or mismatched analysis ${analysisId}`,
          422,
        );
      }
      analysisReferenceCounts.set(
        analysisId,
        (analysisReferenceCounts.get(analysisId) ?? 0) + 1,
      );
    }
  }
  for (const analysis of Object.values(parsed.analyses)) {
    ensureUniqueId(seen, analysis.id, "analysis artifact");
    if (
      !Object.values(parsed.assets).some(
        (asset) => asset.hash === analysis.assetHash,
      )
    ) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Analysis ${analysis.id} does not match a project asset hash`,
        422,
      );
    }
    if (analysisReferenceCounts.get(analysis.id) !== 1) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Analysis ${analysis.id} must be referenced by exactly one asset`,
        422,
      );
    }
  }
  for (const profile of Object.values(parsed.renderProfiles)) {
    ensureUniqueId(seen, profile.id, "render profile");
  }
  for (const trackedObject of Object.values(parsed.trackedObjects)) {
    ensureUniqueId(seen, trackedObject.id, "tracked object");
    if (
      trackedObject.assetId !== undefined &&
      parsed.assets[trackedObject.assetId] === undefined
    ) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Tracked object ${trackedObject.id} references a missing asset`,
        422,
      );
    }
    if (
      trackedObject.sequenceId !== undefined &&
      parsed.sequences[trackedObject.sequenceId] === undefined
    ) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Tracked object ${trackedObject.id} references a missing sequence`,
        422,
      );
    }
    if (trackedObject.itemId !== undefined) {
      const itemExists = Object.values(parsed.sequences).some((sequence) =>
        sequence.tracks.some((track) =>
          track.items.some((item) => item.id === trackedObject.itemId),
        ),
      );
      if (!itemExists) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Tracked object ${trackedObject.id} references a missing item`,
          422,
        );
      }
    }
    let previousSampleTime = trackedObject.samples[0]?.time;
    for (const [index, sample] of trackedObject.samples.entries()) {
      ensureUniqueId(seen, sample.id, "tracking sample");
      if (
        compareTime(sample.time, trackedObject.range.start) < 0 ||
        compareTime(
          sample.time,
          addTime(trackedObject.range.start, trackedObject.range.duration),
        ) > 0
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Tracking sample ${sample.id} is outside its tracked range`,
          422,
        );
      }
      if (
        index > 0 &&
        previousSampleTime !== undefined &&
        compareTime(previousSampleTime, sample.time) >= 0
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Tracked object ${trackedObject.id} samples must be strictly ordered`,
          422,
        );
      }
      previousSampleTime = sample.time;
    }
  }
  for (const mask of Object.values(parsed.masks)) {
    ensureUniqueId(seen, mask.id, "mask");
    if (
      mask.trackedObjectId !== undefined &&
      parsed.trackedObjects[mask.trackedObjectId] === undefined
    ) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Mask ${mask.id} references a missing tracked object`,
        422,
      );
    }
    let previousMaskTime = mask.keyframes[0]?.time;
    for (const [index, keyframe] of mask.keyframes.entries()) {
      ensureUniqueId(seen, keyframe.id, "mask keyframe");
      if (
        index > 0 &&
        previousMaskTime !== undefined &&
        compareTime(previousMaskTime, keyframe.time) >= 0
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Mask ${mask.id} keyframes must be strictly ordered`,
          422,
        );
      }
      previousMaskTime = keyframe.time;
    }
  }
  for (const group of Object.values(parsed.multicamGroups)) {
    ensureUniqueId(seen, group.id, "multicam group");
    if (
      group.sequenceId !== undefined &&
      parsed.sequences[group.sequenceId] === undefined
    ) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Multicam group ${group.id} references a missing sequence`,
        422,
      );
    }
    const angleIds = new Set(group.angles.map((angle) => angle.id));
    for (const angle of group.angles) {
      ensureUniqueId(seen, angle.id, "multicam angle");
      const asset = parsed.assets[angle.assetId];
      if (asset === undefined) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Multicam angle ${angle.id} references a missing asset`,
          422,
        );
      }
      if (
        asset.duration !== undefined &&
        compareTime(
          addTime(angle.sourceRange.start, angle.sourceRange.duration),
          asset.duration,
        ) > 0
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Multicam angle ${angle.id} exceeds its source asset`,
          422,
        );
      }
    }
    let previousSwitchTime = group.activeAngleAutomation[0]?.time;
    for (const [index, keyframe] of group.activeAngleAutomation.entries()) {
      ensureUniqueId(seen, keyframe.id, "multicam switch keyframe");
      if (typeof keyframe.value !== "string" || !angleIds.has(keyframe.value)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Multicam switch ${keyframe.id} references a missing angle`,
          422,
        );
      }
      if (
        index > 0 &&
        previousSwitchTime !== undefined &&
        compareTime(previousSwitchTime, keyframe.time) >= 0
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Multicam group ${group.id} switches must be strictly ordered`,
          422,
        );
      }
      previousSwitchTime = keyframe.time;
    }
  }
  const groupedItems = new Map<string, string>();
  for (const group of Object.values(parsed.itemGroups)) {
    ensureUniqueId(seen, group.id, "item group");
    const sequence = parsed.sequences[group.sequenceId];
    if (sequence === undefined) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Item group ${group.id} references a missing sequence`,
        422,
      );
    }
    const sequenceItemIds = new Set(
      sequence.tracks.flatMap((track) => track.items.map((item) => item.id)),
    );
    const localItems = new Set<string>();
    for (const itemId of group.itemIds) {
      if (localItems.has(itemId)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Item group ${group.id} contains duplicate member ${itemId}`,
          422,
        );
      }
      localItems.add(itemId);
      if (!sequenceItemIds.has(itemId)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Item group ${group.id} references item ${itemId} outside its sequence`,
          422,
        );
      }
      const existingGroupId = groupedItems.get(itemId);
      if (existingGroupId !== undefined) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Timeline item ${itemId} belongs to multiple groups ${existingGroupId} and ${group.id}`,
          422,
        );
      }
      groupedItems.set(itemId, group.id);
    }
  }
  for (const sequence of Object.values(parsed.sequences)) {
    ensureUniqueId(seen, sequence.id, "sequence");
    const busIds = new Set(sequence.buses.map((bus) => bus.id));
    for (const bus of sequence.buses) {
      ensureUniqueId(seen, bus.id, "audio bus");
      validateEffectIds(bus.effects);
      if (bus.outputBusId !== undefined && !busIds.has(bus.outputBusId)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Audio bus ${bus.id} routes to a missing bus`,
          422,
        );
      }
      if (bus.outputBusId === bus.id) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Audio bus ${bus.id} cannot route to itself`,
          422,
        );
      }
    }
    const visitedBuses = new Set<string>();
    const visitingBuses = new Set<string>();
    const visitBus = (busId: string): void => {
      if (visitingBuses.has(busId)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Audio bus routing contains a cycle at ${busId}`,
          422,
        );
      }
      if (visitedBuses.has(busId)) return;
      visitingBuses.add(busId);
      const outputBusId = sequence.buses.find(
        (bus) => bus.id === busId,
      )?.outputBusId;
      if (outputBusId !== undefined) visitBus(outputBusId);
      visitingBuses.delete(busId);
      visitedBuses.add(busId);
    };
    for (const bus of sequence.buses) visitBus(bus.id);
    const orders = new Set<number>();
    for (const track of sequence.tracks) {
      ensureUniqueId(seen, track.id, "track");
      if (track.busId !== undefined && !busIds.has(track.busId)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Track ${track.id} references a missing audio bus`,
          422,
        );
      }
      if (orders.has(track.order)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Sequence ${sequence.id} has duplicate track order`,
          422,
        );
      }
      orders.add(track.order);
      for (const item of track.items) {
        ensureUniqueId(seen, item.id, "timeline item");
        validateItemReferences(parsed, sequence, track, item);
        if ("effects" in item) {
          validateEffectIds(item.effects);
        }
        if (item.type === "clip") {
          let previousTime = item.timeMap[0]?.time;
          for (const [index, keyframe] of item.timeMap.entries()) {
            ensureUniqueId(seen, keyframe.id, "time-map keyframe");
            if (
              compareTime(keyframe.time, {
                value: 0,
                rate: keyframe.time.rate,
              }) < 0 ||
              compareTime(keyframe.time, item.timelineRange.duration) > 0
            ) {
              throw new FrameOSError(
                "VALIDATION_ERROR",
                `Clip ${item.id} time-map keyframe is outside its duration`,
                422,
              );
            }
            if (
              index > 0 &&
              previousTime !== undefined &&
              compareTime(previousTime, keyframe.time) >= 0
            ) {
              throw new FrameOSError(
                "VALIDATION_ERROR",
                `Clip ${item.id} time-map keyframes must be strictly ordered`,
                422,
              );
            }
            previousTime = keyframe.time;
          }
        }
        if (item.type === "transition") {
          validateAutomationCurveIds(item.automationCurves);
        }
      }
      validateEffectIds(track.effects);
      const editorialItems = track.items
        .filter((item) => item.type !== "transition")
        .toSorted((left, right) =>
          compareTime(left.timelineRange.start, right.timelineRange.start),
        );
      for (let index = 1; index < editorialItems.length; index += 1) {
        const previous = editorialItems[index - 1];
        const current = editorialItems[index];
        if (
          previous !== undefined &&
          current !== undefined &&
          compareTime(
            addTime(
              previous.timelineRange.start,
              previous.timelineRange.duration,
            ),
            current.timelineRange.start,
          ) > 0
        ) {
          throw new FrameOSError(
            "VALIDATION_ERROR",
            `Timeline items ${previous.id} and ${current.id} overlap`,
            422,
          );
        }
      }
      const transitions = track.items
        .filter((item) => item.type === "transition")
        .toSorted((left, right) =>
          compareTime(left.timelineRange.start, right.timelineRange.start),
        );
      for (let index = 1; index < transitions.length; index += 1) {
        const previous = transitions[index - 1];
        const current = transitions[index];
        if (
          previous !== undefined &&
          current !== undefined &&
          compareTime(
            addTime(
              previous.timelineRange.start,
              previous.timelineRange.duration,
            ),
            current.timelineRange.start,
          ) > 0
        ) {
          throw new FrameOSError(
            "VALIDATION_ERROR",
            `Transitions ${previous.id} and ${current.id} overlap`,
            422,
          );
        }
      }
    }
    validateEffectIds(sequence.outputEffects);
    for (const marker of sequence.markers) {
      ensureUniqueId(seen, marker.id, "marker");
    }
    for (const captionTrack of sequence.captions) {
      ensureUniqueId(seen, captionTrack.id, "caption track");
      for (const cue of captionTrack.cues) {
        ensureUniqueId(seen, cue.id, "caption cue");
      }
    }
  }
  for (const sequence of Object.values(parsed.sequences)) {
    for (const track of sequence.tracks) {
      for (const item of track.items) {
        if (item.type === "clip") {
          for (const linkedId of item.links) {
            if (!seen.has(linkedId)) {
              throw new FrameOSError(
                "VALIDATION_ERROR",
                `Clip ${item.id} links to missing entity ${linkedId}`,
                422,
              );
            }
          }
        }
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visitSequence = (sequenceId: string): void => {
    if (visiting.has(sequenceId))
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Nested sequences contain a cycle",
        422,
      );
    if (visited.has(sequenceId)) return;
    visiting.add(sequenceId);
    const sequence = parsed.sequences[sequenceId];
    for (const nestedId of sequence?.tracks.flatMap((track) =>
      track.items
        .filter((item) => item.type === "nested_sequence")
        .map((item) => item.sequenceId),
    ) ?? []) {
      visitSequence(nestedId);
    }
    visiting.delete(sequenceId);
    visited.add(sequenceId);
  };
  for (const sequenceId of Object.keys(parsed.sequences))
    visitSequence(sequenceId);
  return parsed;
}
