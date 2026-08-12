import {
  FrameOSError,
  addTime,
  compareTime,
  createId,
  frameTime,
  rescaleTime,
  sameRate,
  type Change,
  type EffectInstance,
  type Operation,
  type Project,
  type RationalRate,
  type TimeRange,
  type TimelineItem,
  type Track,
} from "@frameos/contracts";
import {
  requireItem,
  requireSequence,
  requireTrack,
  validateProject,
} from "./invariants.js";

export interface OperationExecution {
  project: Project;
  changes: Change[];
  warnings: string[];
  affectedRanges: TimeRange[];
  inverseOperations: Operation[];
}

function entityExists(project: Project, entityId: string): boolean {
  if (
    project.projectId === entityId ||
    project.assets[entityId] !== undefined ||
    project.sequences[entityId] !== undefined ||
    project.analyses[entityId] !== undefined ||
    project.renderProfiles[entityId] !== undefined ||
    project.masks[entityId] !== undefined ||
    project.trackedObjects[entityId] !== undefined ||
    project.multicamGroups[entityId] !== undefined ||
    project.itemGroups[entityId] !== undefined
  ) {
    return true;
  }
  const effectContains = (effect: EffectInstance): boolean =>
    effect.id === entityId ||
    effect.automationCurves.some(
      (curve) =>
        curve.id === entityId ||
        curve.keyframes.some((keyframe) => keyframe.id === entityId),
    );
  return (
    Object.values(project.masks).some((mask) =>
      mask.keyframes.some((keyframe) => keyframe.id === entityId),
    ) ||
    Object.values(project.trackedObjects).some((trackedObject) =>
      trackedObject.samples.some((sample) => sample.id === entityId),
    ) ||
    Object.values(project.multicamGroups).some(
      (group) =>
        group.angles.some((angle) => angle.id === entityId) ||
        group.activeAngleAutomation.some(
          (keyframe) => keyframe.id === entityId,
        ),
    ) ||
    Object.values(project.sequences).some(
      (sequence) =>
        sequence.tracks.some(
          (track) =>
            track.id === entityId ||
            track.items.some(
              (item) =>
                item.id === entityId ||
                (item.type === "clip" &&
                  item.timeMap.some((keyframe) => keyframe.id === entityId)) ||
                (item.type === "transition" &&
                  item.automationCurves.some(
                    (curve) =>
                      curve.id === entityId ||
                      curve.keyframes.some(
                        (keyframe) => keyframe.id === entityId,
                      ),
                  )) ||
                ("effects" in item && item.effects.some(effectContains)),
            ) ||
            track.effects.some(effectContains),
        ) ||
        sequence.markers.some((marker) => marker.id === entityId) ||
        sequence.buses.some(
          (bus) => bus.id === entityId || bus.effects.some(effectContains),
        ) ||
        sequence.outputEffects.some(effectContains) ||
        sequence.captions.some(
          (captionTrack) =>
            captionTrack.id === entityId ||
            captionTrack.cues.some((cue) => cue.id === entityId),
        ),
    )
  );
}

function allEffects(project: Project): EffectInstance[] {
  return Object.values(project.sequences).flatMap((sequence) => [
    ...sequence.outputEffects,
    ...sequence.buses.flatMap((bus) => bus.effects),
    ...sequence.tracks.flatMap((track) => [
      ...track.effects,
      ...track.items.flatMap((item) => ("effects" in item ? item.effects : [])),
    ]),
  ]);
}

function safeReadPath(project: Project, path: string): unknown {
  const segments = path.split(".").filter(Boolean);
  if (segments.length === 0 || segments.length > 32) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Invalid precondition path",
      422,
    );
  }
  let current: unknown = project;
  for (const segment of segments) {
    if (["__proto__", "prototype", "constructor"].includes(segment)) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Unsafe precondition path",
        422,
      );
    }
    if (
      typeof current !== "object" ||
      current === null ||
      !(segment in current)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function checkPreconditions(project: Project, operation: Operation): void {
  for (const precondition of operation.preconditions) {
    if (
      precondition.kind === "revision_equals" &&
      precondition.expected !== project.revision
    ) {
      throw new FrameOSError(
        "REVISION_CONFLICT",
        "Operation revision precondition failed",
        409,
      );
    }
    if (precondition.kind === "entity_exists") {
      if (
        precondition.entityId === undefined ||
        !entityExists(project, precondition.entityId)
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Required entity does not exist",
          422,
        );
      }
    }
    if (precondition.kind === "entity_missing") {
      if (
        precondition.entityId === undefined ||
        entityExists(project, precondition.entityId)
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Entity-missing precondition failed",
          422,
        );
      }
    }
    if (precondition.kind === "field_equals") {
      if (precondition.path === undefined) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "field_equals requires a path",
          422,
        );
      }
      const actual = safeReadPath(project, precondition.path);
      if (JSON.stringify(actual) !== JSON.stringify(precondition.expected)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Precondition failed at ${precondition.path}`,
          422,
        );
      }
    }
  }
}

function makeChange(
  operation: Operation,
  entityIds: string[],
  summary: string,
): Change {
  return {
    operationId: operation.operationId,
    operationType: operation.type,
    entityIds,
    summary,
  };
}

function cloneOperation<T extends Operation>(operation: T): T {
  return structuredClone(operation);
}

function findEffectCollection(
  project: Project,
  sequenceId: string,
  targetId: string,
  trackId?: string,
): EffectInstance[] {
  const sequence = requireSequence(project, sequenceId);
  if (trackId === undefined) {
    if (targetId !== sequence.id) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Sequence effect target must equal sequence id",
        422,
      );
    }
    return sequence.outputEffects;
  }
  const track = requireTrack(sequence, trackId);
  if (targetId === track.id) {
    return track.effects;
  }
  const located = requireItem(project, sequenceId, trackId, targetId);
  if (!("effects" in located.item)) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Item ${targetId} cannot contain effects`,
      422,
    );
  }
  return located.item.effects;
}

function findEffect(
  project: Project,
  sequenceId: string,
  targetId: string,
  effectId: string,
  trackId?: string,
): { effects: EffectInstance[]; effect: EffectInstance; index: number } {
  const effects = findEffectCollection(project, sequenceId, targetId, trackId);
  const index = effects.findIndex((effect) => effect.id === effectId);
  const effect = effects[index];
  if (effect === undefined) {
    throw new FrameOSError(
      "NOT_FOUND",
      `Effect ${effectId} was not found`,
      404,
    );
  }
  return { effects, effect, index };
}

function requireColorEffect(
  project: Project,
  target: {
    sequenceId: string;
    targetId: string;
    effectId: string;
    trackId?: string;
  },
): EffectInstance {
  const { effect } = findEffect(
    project,
    target.sequenceId,
    target.targetId,
    target.effectId,
    target.trackId,
  );
  if (!effect.capabilityId.startsWith("frameos.color.")) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Effect ${effect.id} is not a normalized FrameOS color effect`,
      422,
    );
  }
  return effect;
}

function requireAudioEffect(
  project: Project,
  target: {
    sequenceId: string;
    targetId: string;
    effectId: string;
    trackId?: string;
  },
): EffectInstance {
  const { effect } = findEffect(
    project,
    target.sequenceId,
    target.targetId,
    target.effectId,
    target.trackId,
  );
  if (!effect.capabilityId.startsWith("frameos.audio.")) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Effect ${effect.id} is not a normalized FrameOS audio effect`,
      422,
    );
  }
  return effect;
}

function findAutomationCurve(
  project: Project,
  operation: Extract<
    Operation,
    {
      type:
        | "keyframe.add"
        | "keyframe.remove"
        | "keyframe.move"
        | "keyframe.value.set"
        | "keyframe.interpolation.set";
    }
  >,
) {
  const { effect } = findEffect(
    project,
    operation.arguments.sequenceId,
    operation.targetId,
    operation.arguments.effectId,
    operation.arguments.trackId,
  );
  const curve = effect.automationCurves.find(
    (candidate) => candidate.id === operation.arguments.curveId,
  );
  if (curve === undefined) {
    throw new FrameOSError(
      "NOT_FOUND",
      `Automation curve ${operation.arguments.curveId} was not found`,
      404,
    );
  }
  return { effect, curve };
}

function ensureTrackAcceptsItem(track: Track, item: TimelineItem): void {
  if (
    track.kind === "audio" &&
    ["title", "generator", "transition"].includes(item.type)
  ) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Audio track ${track.id} cannot contain ${item.type}`,
      422,
    );
  }
  if (track.kind === "caption" && !["title", "gap"].includes(item.type)) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Caption track ${track.id} cannot contain ${item.type}`,
      422,
    );
  }
}

function trackItemsInverse(
  operation: Operation,
  sequenceId: string,
  track: Track,
): Operation {
  return {
    operationId: createId(),
    type: "track.items.replace",
    targetId: track.id,
    preconditions: [],
    provenance: operation.provenance,
    arguments: {
      sequenceId,
      items: structuredClone(track.items),
    },
  };
}

function sequenceInverse(
  operation: Operation,
  sequence: Project["sequences"][string],
): Operation {
  return {
    operationId: createId(),
    type: "sequence.replace",
    targetId: sequence.id,
    preconditions: [],
    arguments: { sequence: structuredClone(sequence) },
  };
}

function effectParametersInverse(
  operation: Operation,
  input: {
    sequenceId: string;
    targetId: string;
    effectId: string;
    trackId?: string;
    parameters: Record<string, unknown>;
  },
): Operation {
  return {
    operationId: createId(),
    type: "effect.preset.apply",
    targetId: input.targetId,
    preconditions: [],
    ...(operation.provenance === undefined
      ? {}
      : { provenance: operation.provenance }),
    arguments: {
      sequenceId: input.sequenceId,
      ...(input.trackId === undefined ? {} : { trackId: input.trackId }),
      effectId: input.effectId,
      parameters: structuredClone(input.parameters),
      replace: true,
    },
  };
}

function removeLinksTo(
  sequence: Project["sequences"][string],
  removedIds: ReadonlySet<string>,
): void {
  for (const item of sequence.tracks.flatMap((track) => track.items)) {
    if (item.type === "clip") {
      item.links = item.links.filter((id) => !removedIds.has(id));
    }
  }
}

function signedRescaleFrames(
  value: number,
  sourceRate: RationalRate,
  targetRate: RationalRate,
): number {
  const result = rescaleTime(
    frameTime(Math.abs(value), sourceRate),
    targetRate,
  );
  if (result.rounded) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Edit boundary cannot be represented exactly at the target media rate",
      422,
    );
  }
  return value < 0 ? -result.time.value : result.time.value;
}

function itemFrames(
  item: TimelineItem,
  rate: RationalRate,
): {
  start: number;
  duration: number;
  end: number;
} {
  const start = rescaleTime(item.timelineRange.start, rate);
  const duration = rescaleTime(item.timelineRange.duration, rate);
  if (start.rounded || duration.rounded) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Item ${item.id} is not aligned to the sequence rate`,
      422,
    );
  }
  return {
    start: start.time.value,
    duration: duration.time.value,
    end: start.time.value + duration.time.value,
  };
}

function setEditorialRange(
  item: TimelineItem,
  start: number,
  duration: number,
  rate: RationalRate,
  previousStart: number,
): void {
  if (start < 0 || duration <= 0) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Editorial operations must leave positive, non-negative ranges",
      422,
    );
  }
  if (item.type !== "clip" && item.type !== "gap") {
    throw new FrameOSError(
      "CAPABILITY_UNAVAILABLE",
      `${item.type} trimming is not implemented by this editorial operation`,
      424,
    );
  }
  if (item.type === "clip") {
    if (item.timeMap.length > 0) {
      throw new FrameOSError(
        "CAPABILITY_UNAVAILABLE",
        "This edit cannot trim a retimed clip",
        424,
      );
    }
    const sourceDelta = signedRescaleFrames(
      start - previousStart,
      rate,
      item.sourceRange.start.rate,
    );
    const nextSourceStart = item.sourceRange.start.value + sourceDelta;
    if (nextSourceStart < 0) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Edit would move the clip before the start of its source",
        422,
      );
    }
    const sourceDuration = rescaleTime(
      frameTime(duration, rate),
      item.sourceRange.duration.rate,
    );
    if (sourceDuration.rounded) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Edited duration cannot be represented at the source rate",
        422,
      );
    }
    item.sourceRange.start = frameTime(
      nextSourceStart,
      item.sourceRange.start.rate,
    );
    item.sourceRange.duration = sourceDuration.time;
  }
  item.timelineRange = {
    start: frameTime(start, rate),
    duration: frameTime(duration, rate),
  };
}

function shiftItemStart(
  item: TimelineItem,
  delta: number,
  rate: RationalRate,
): void {
  const frames = itemFrames(item, rate);
  if (frames.start + delta < 0) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Ripple edit would move an item before timeline zero",
      422,
    );
  }
  item.timelineRange.start = frameTime(frames.start + delta, rate);
}

function requireClipItem(
  project: Project,
  sequenceId: string,
  trackId: string,
  itemId: string,
) {
  const located = requireItem(project, sequenceId, trackId, itemId);
  if (located.item.type !== "clip") {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Item ${located.item.id} is not a clip`,
      422,
    );
  }
  return { ...located, item: located.item };
}

function applyOne(
  project: Project,
  operation: Operation,
): {
  change: Change;
  ranges: TimeRange[];
  inverse?: Operation;
} {
  checkPreconditions(project, operation);

  switch (operation.type) {
    case "project.metadata.set": {
      const previous = structuredClone(project.metadata);
      Object.assign(project.metadata, operation.arguments.values);
      return {
        change: makeChange(
          operation,
          [project.projectId],
          "Updated project metadata",
        ),
        ranges: [],
        inverse: {
          operationId: createId(),
          type: "project.metadata.replace",
          preconditions: [],
          arguments: { values: previous },
        },
      };
    }
    case "project.metadata.replace": {
      const previous = structuredClone(project.metadata);
      project.metadata = structuredClone(operation.arguments.values);
      return {
        change: makeChange(
          operation,
          [project.projectId],
          "Replaced project metadata",
        ),
        ranges: [],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { values: previous },
        },
      };
    }
    case "project.settings.set": {
      const previous = structuredClone(project.settings);
      const values = operation.arguments.values;
      if (values.name !== undefined) project.settings.name = values.name;
      if (values.defaultSequenceId !== undefined) {
        project.settings.defaultSequenceId = values.defaultSequenceId;
      }
      if (values.timeDisplay !== undefined)
        project.settings.timeDisplay = values.timeDisplay;
      return {
        change: makeChange(
          operation,
          [project.projectId],
          "Updated project settings",
        ),
        ranges: [],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { values: previous },
        },
      };
    }
    case "asset.add": {
      const asset = operation.arguments.asset;
      if (project.assets[asset.id] !== undefined) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Asset ${asset.id} already exists`,
          422,
        );
      }
      project.assets[asset.id] = asset;
      return {
        change: makeChange(operation, [asset.id], `Added asset ${asset.name}`),
        ranges: [],
        inverse: {
          operationId: createId(),
          type: "asset.remove",
          targetId: asset.id,
          preconditions: [],
          arguments: { force: false },
        },
      };
    }
    case "asset.remove": {
      const asset = project.assets[operation.targetId];
      if (asset === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Asset ${operation.targetId} was not found`,
          404,
        );
      }
      const references = Object.values(project.sequences).flatMap((sequence) =>
        sequence.tracks.flatMap((track) =>
          track.items.filter(
            (item) => item.type === "clip" && item.assetId === asset.id,
          ),
        ),
      );
      if (references.length > 0 && !operation.arguments.force) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Asset ${asset.id} is still used by timeline clips`,
          422,
        );
      }
      if (asset.analysisRefs.length > 0) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Asset ${asset.id} still owns analysis artifacts; remove them first`,
          422,
        );
      }
      if (references.length > 0) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Forced asset removal is reserved for a future offline-media operation",
          422,
        );
      }
      delete project.assets[asset.id];
      return {
        change: makeChange(
          operation,
          [asset.id],
          `Removed asset ${asset.name}`,
        ),
        ranges: [],
        inverse: {
          operationId: createId(),
          type: "asset.add",
          preconditions: [],
          arguments: { asset },
        },
      };
    }
    case "asset.relink": {
      const asset = project.assets[operation.targetId];
      if (asset === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Asset ${operation.targetId} was not found`,
          404,
        );
      }
      if (asset.analysisRefs.length > 0) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Remove cached analysis artifacts before relinking an asset",
          422,
        );
      }
      const previous = { uri: asset.uri, hash: asset.hash };
      asset.uri = operation.arguments.uri;
      asset.hash = operation.arguments.hash;
      return {
        change: makeChange(
          operation,
          [asset.id],
          `Relinked asset ${asset.name}`,
        ),
        ranges: [],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: previous,
        },
      };
    }
    case "asset.replace": {
      const previous = project.assets[operation.targetId];
      if (previous === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Asset ${operation.targetId} was not found`,
          404,
        );
      }
      if (operation.arguments.asset.id !== operation.targetId) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Replacement asset id must match target id",
          422,
        );
      }
      project.assets[operation.targetId] = structuredClone(
        operation.arguments.asset,
      );
      return {
        change: makeChange(
          operation,
          [operation.targetId],
          `Replaced asset ${previous.name}`,
        ),
        ranges: [],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { asset: previous },
        },
      };
    }
    case "asset.metadata.set":
    case "asset.license.set": {
      const asset = project.assets[operation.targetId];
      if (asset === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Asset ${operation.targetId} was not found`,
          404,
        );
      }
      const field =
        operation.type === "asset.metadata.set"
          ? "semanticMetadata"
          : "licenseMetadata";
      const previous = structuredClone(asset[field]);
      asset[field] = operation.arguments.replace
        ? structuredClone(operation.arguments.values)
        : { ...asset[field], ...structuredClone(operation.arguments.values) };
      return {
        change: makeChange(
          operation,
          [asset.id],
          `Updated ${field} for ${asset.name}`,
        ),
        ranges: [],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { values: previous, replace: true },
        },
      };
    }
    case "asset.offline.set": {
      const asset = project.assets[operation.targetId];
      if (asset === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Asset ${operation.targetId} was not found`,
          404,
        );
      }
      const hadPrevious = Object.hasOwn(asset.semanticMetadata, "offline");
      const previous = asset.semanticMetadata.offline === true;
      if (operation.arguments.unset) delete asset.semanticMetadata.offline;
      else asset.semanticMetadata.offline = operation.arguments.offline;
      return {
        change: makeChange(
          operation,
          [asset.id],
          `${operation.arguments.offline ? "Marked" : "Restored"} asset ${asset.name} ${operation.arguments.offline ? "offline" : "online"}`,
        ),
        ranges: [],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { offline: previous, unset: !hadPrevious },
        },
      };
    }
    case "asset.proxy.create": {
      const asset = project.assets[operation.targetId];
      if (asset === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Asset ${operation.targetId} was not found`,
          404,
        );
      }
      if (asset.proxies.includes(operation.arguments.uri)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Asset proxy URI is already registered",
          422,
        );
      }
      asset.proxies.push(operation.arguments.uri);
      return {
        change: makeChange(
          operation,
          [asset.id],
          `Registered proxy for ${asset.name}`,
        ),
        ranges: [],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          type: "asset.proxy.remove",
        },
      };
    }
    case "asset.proxy.remove": {
      const asset = project.assets[operation.targetId];
      if (asset === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Asset ${operation.targetId} was not found`,
          404,
        );
      }
      const index = asset.proxies.indexOf(operation.arguments.uri);
      if (index < 0) {
        throw new FrameOSError(
          "NOT_FOUND",
          "Asset proxy URI is not registered",
          404,
        );
      }
      asset.proxies.splice(index, 1);
      return {
        change: makeChange(
          operation,
          [asset.id],
          `Removed proxy for ${asset.name}`,
        ),
        ranges: [],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          type: "asset.proxy.create",
        },
      };
    }
    case "sequence.add": {
      const sequence = operation.arguments.sequence;
      if (project.sequences[sequence.id] !== undefined) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Sequence ${sequence.id} already exists`,
          422,
        );
      }
      project.sequences[sequence.id] = sequence;
      return {
        change: makeChange(
          operation,
          [sequence.id],
          `Added sequence ${sequence.name}`,
        ),
        ranges: [],
        inverse: {
          operationId: createId(),
          type: "sequence.remove",
          targetId: sequence.id,
          preconditions: [],
          arguments: {},
        },
      };
    }
    case "sequence.remove": {
      if (operation.targetId === project.settings.defaultSequenceId) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "The default sequence cannot be removed",
          422,
        );
      }
      const sequence = project.sequences[operation.targetId];
      if (sequence === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Sequence ${operation.targetId} was not found`,
          404,
        );
      }
      delete project.sequences[sequence.id];
      return {
        change: makeChange(
          operation,
          [sequence.id],
          `Removed sequence ${sequence.name}`,
        ),
        ranges: [],
        inverse: {
          operationId: createId(),
          type: "sequence.add",
          preconditions: [],
          arguments: { sequence },
        },
      };
    }
    case "sequence.format.set": {
      const sequence = requireSequence(project, operation.targetId);
      const previous = structuredClone(sequence.format);
      sequence.format = operation.arguments.format;
      return {
        change: makeChange(
          operation,
          [sequence.id],
          `Updated sequence format for ${sequence.name}`,
        ),
        ranges: [],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { format: previous },
        },
      };
    }
    case "sequence.replace": {
      const previous = requireSequence(project, operation.targetId);
      if (operation.arguments.sequence.id !== operation.targetId) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Replacement sequence id must match target id",
          422,
        );
      }
      project.sequences[operation.targetId] = structuredClone(
        operation.arguments.sequence,
      );
      return {
        change: makeChange(
          operation,
          [operation.targetId],
          `Replaced sequence ${previous.name}`,
        ),
        ranges: [],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { sequence: previous },
        },
      };
    }
    case "sequence.duplicate": {
      const source = requireSequence(project, operation.targetId);
      const duplicate = structuredClone(operation.arguments.sequence);
      if (duplicate.id === source.id) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Duplicated sequence must use a new sequence id",
          422,
        );
      }
      if (project.sequences[duplicate.id] !== undefined) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Sequence ${duplicate.id} already exists`,
          422,
        );
      }
      project.sequences[duplicate.id] = duplicate;
      return {
        change: makeChange(
          operation,
          [source.id, duplicate.id],
          `Duplicated sequence ${source.name} as ${duplicate.name}`,
        ),
        ranges: duplicate.tracks.flatMap((track) =>
          track.items.map((item) => item.timelineRange),
        ),
        inverse: {
          operationId: createId(),
          type: "sequence.remove",
          targetId: duplicate.id,
          preconditions: [],
          arguments: {},
        },
      };
    }
    case "sequence.nest": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const track = requireTrack(sequence, operation.arguments.trackId);
      const item = structuredClone(operation.arguments.item);
      ensureTrackAcceptsItem(track, item);
      if (item.sequenceId === sequence.id) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "A sequence cannot directly nest itself",
          422,
        );
      }
      if (project.sequences[item.sequenceId] === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Nested sequence ${item.sequenceId} was not found`,
          404,
        );
      }
      if (entityExists(project, item.id)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Entity ${item.id} already exists`,
          422,
        );
      }
      const index = operation.arguments.index ?? track.items.length;
      if (index > track.items.length) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Nested-sequence item index is outside the track item list",
          422,
        );
      }
      track.items.splice(index, 0, item);
      return {
        change: makeChange(
          operation,
          [sequence.id, track.id, item.id, item.sequenceId],
          `Nested sequence ${project.sequences[item.sequenceId]!.name}`,
        ),
        ranges: [item.timelineRange],
        inverse: {
          operationId: createId(),
          type: "item.delete",
          targetId: item.id,
          preconditions: [],
          arguments: { sequenceId: sequence.id, trackId: track.id },
        },
      };
    }
    case "sequence.color_space.set": {
      const sequence = requireSequence(project, operation.targetId);
      const previous = sequence.format.colorSpace;
      sequence.format.colorSpace = operation.arguments.colorSpace;
      return {
        change: makeChange(
          operation,
          [sequence.id],
          `Set sequence color space to ${operation.arguments.colorSpace}`,
        ),
        ranges: [],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { colorSpace: previous },
        },
      };
    }
    case "sequence.audio_layout.set": {
      const sequence = requireSequence(project, operation.targetId);
      const previous = {
        sampleRate: sequence.format.sampleRate,
        channels: sequence.format.channels,
      };
      sequence.format.sampleRate = operation.arguments.sampleRate;
      sequence.format.channels = operation.arguments.channels;
      return {
        change: makeChange(
          operation,
          [sequence.id],
          `Set sequence audio layout to ${operation.arguments.channels} channels at ${operation.arguments.sampleRate} Hz`,
        ),
        ranges: [],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: previous,
        },
      };
    }
    case "track.add": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      if (
        sequence.tracks.some(
          (track) => track.id === operation.arguments.track.id,
        )
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Track ${operation.arguments.track.id} already exists`,
          422,
        );
      }
      const index = operation.arguments.index ?? sequence.tracks.length;
      if (index > sequence.tracks.length) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Track index is outside the sequence track list",
          422,
        );
      }
      sequence.tracks.splice(index, 0, operation.arguments.track);
      return {
        change: makeChange(
          operation,
          [sequence.id, operation.arguments.track.id],
          `Added track ${operation.arguments.track.name}`,
        ),
        ranges: [],
        inverse: {
          operationId: createId(),
          type: "track.remove",
          targetId: operation.arguments.track.id,
          preconditions: [],
          arguments: { sequenceId: sequence.id },
        },
      };
    }
    case "track.remove": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const index = sequence.tracks.findIndex(
        (track) => track.id === operation.targetId,
      );
      if (index < 0) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Track ${operation.targetId} was not found`,
          404,
        );
      }
      const track = sequence.tracks[index];
      if (track === undefined) {
        throw new FrameOSError("INTERNAL_ERROR", "Track lookup failed", 500);
      }
      if (track.locked) {
        throw new FrameOSError("FORBIDDEN", `Track ${track.id} is locked`, 403);
      }
      sequence.tracks.splice(index, 1);
      return {
        change: makeChange(
          operation,
          [sequence.id, track.id],
          `Removed track ${track.name}`,
        ),
        ranges: track.items.map((item) => item.timelineRange),
        inverse: {
          operationId: createId(),
          type: "track.add",
          preconditions: [],
          arguments: { sequenceId: sequence.id, track, index },
        },
      };
    }
    case "track.update": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const track = requireTrack(sequence, operation.targetId, true);
      const previous: typeof operation.arguments.values = {};
      for (const [key, value] of Object.entries(operation.arguments.values)) {
        const typedKey = key as keyof typeof operation.arguments.values;
        previous[typedKey] = (track as unknown as Record<string, unknown>)[
          key
        ] as never;
        if (key === "busId" && value === null) {
          delete track.busId;
        } else {
          (track as unknown as Record<string, unknown>)[key] = value;
        }
      }
      return {
        change: makeChange(
          operation,
          [sequence.id, track.id],
          `Updated track ${track.name}`,
        ),
        ranges: track.items.map((item) => item.timelineRange),
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { sequenceId: sequence.id, values: previous },
        },
      };
    }
    case "track.items.replace": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const track = requireTrack(sequence, operation.targetId);
      const inverse = sequenceInverse(operation, sequence);
      for (const item of operation.arguments.items)
        ensureTrackAcceptsItem(track, item);
      const previousRanges = track.items.map((item) => item.timelineRange);
      track.items = structuredClone(operation.arguments.items);
      return {
        change: makeChange(
          operation,
          [sequence.id, track.id, ...track.items.map((item) => item.id)],
          `Replaced timeline items on ${track.name}`,
        ),
        ranges: [
          ...previousRanges,
          ...track.items.map((item) => item.timelineRange),
        ],
        inverse,
      };
    }
    case "track.reorder": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const track = requireTrack(sequence, operation.targetId, true);
      if (operation.arguments.order >= sequence.tracks.length) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Track order is outside the sequence track list",
          422,
        );
      }
      const inverse = sequenceInverse(operation, sequence);
      const ordered = sequence.tracks.toSorted(
        (left, right) => left.order - right.order,
      );
      const currentIndex = ordered.findIndex(
        (candidate) => candidate.id === track.id,
      );
      ordered.splice(currentIndex, 1);
      ordered.splice(operation.arguments.order, 0, track);
      ordered.forEach((candidate, index) => {
        candidate.order = index;
      });
      sequence.tracks = ordered;
      return {
        change: makeChange(
          operation,
          [sequence.id, track.id],
          `Reordered track ${track.name}`,
        ),
        ranges: track.items.map((item) => item.timelineRange),
        inverse,
      };
    }
    case "track.lock":
    case "track.unlock":
    case "track.mute":
    case "track.unmute":
    case "track.enable":
    case "track.disable": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const track = requireTrack(sequence, operation.targetId, true);
      const field =
        operation.type === "track.lock" || operation.type === "track.unlock"
          ? "locked"
          : operation.type === "track.mute" || operation.type === "track.unmute"
            ? "muted"
            : "enabled";
      const value =
        operation.type === "track.lock" ||
        operation.type === "track.mute" ||
        operation.type === "track.enable";
      const previous = track[field];
      track[field] = value;
      return {
        change: makeChange(
          operation,
          [sequence.id, track.id],
          `${value ? "Enabled" : "Disabled"} ${field} on ${track.name}`,
        ),
        ranges: track.items.map((item) => item.timelineRange),
        inverse: {
          operationId: createId(),
          type: "track.update",
          targetId: track.id,
          preconditions: [],
          arguments: {
            sequenceId: sequence.id,
            values: { [field]: previous },
          },
        },
      };
    }
    case "track.sync_lock": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const track = requireTrack(sequence, operation.targetId, true);
      const previous = track.syncLocked;
      track.syncLocked = operation.arguments.enabled;
      return {
        change: makeChange(
          operation,
          [sequence.id, track.id],
          `Set sync lock on ${track.name}`,
        ),
        ranges: track.items.map((item) => item.timelineRange),
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { sequenceId: sequence.id, enabled: previous },
        },
      };
    }
    case "track.bus.assign": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const track = requireTrack(sequence, operation.targetId, true);
      if (
        operation.arguments.busId !== null &&
        !sequence.buses.some((bus) => bus.id === operation.arguments.busId)
      ) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Audio bus ${operation.arguments.busId} was not found`,
          404,
        );
      }
      const previous = track.busId ?? null;
      if (operation.arguments.busId === null) delete track.busId;
      else track.busId = operation.arguments.busId;
      return {
        change: makeChange(
          operation,
          [sequence.id, track.id],
          `Assigned audio bus on ${track.name}`,
        ),
        ranges: track.items.map((item) => item.timelineRange),
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { sequenceId: sequence.id, busId: previous },
        },
      };
    }
    case "track.effect.add": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const track = requireTrack(sequence, operation.targetId);
      const effect = structuredClone(operation.arguments.effect);
      if (entityExists(project, effect.id)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Entity ${effect.id} already exists`,
          422,
        );
      }
      const index = operation.arguments.index ?? track.effects.length;
      if (index > track.effects.length) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Track effect index is outside the effect stack",
          422,
        );
      }
      track.effects.splice(index, 0, effect);
      return {
        change: makeChange(
          operation,
          [sequence.id, track.id, effect.id],
          `Added track effect ${effect.capabilityId}`,
        ),
        ranges: effect.range === undefined ? [] : [effect.range],
        inverse: {
          operationId: createId(),
          type: "track.effect.remove",
          targetId: effect.id,
          preconditions: [],
          arguments: { sequenceId: sequence.id, trackId: track.id },
        },
      };
    }
    case "track.effect.remove": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const track = requireTrack(sequence, operation.arguments.trackId);
      const index = track.effects.findIndex(
        (effect) => effect.id === operation.targetId,
      );
      const effect = track.effects[index];
      if (effect === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Track effect ${operation.targetId} was not found`,
          404,
        );
      }
      track.effects.splice(index, 1);
      return {
        change: makeChange(
          operation,
          [sequence.id, track.id, effect.id],
          `Removed track effect ${effect.capabilityId}`,
        ),
        ranges: effect.range === undefined ? [] : [effect.range],
        inverse: {
          operationId: createId(),
          type: "track.effect.add",
          targetId: track.id,
          preconditions: [],
          arguments: { sequenceId: sequence.id, effect, index },
        },
      };
    }
    case "item.add": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const track = requireTrack(sequence, operation.arguments.trackId);
      ensureTrackAcceptsItem(track, operation.arguments.item);
      if (entityExists(project, operation.arguments.item.id)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Entity ${operation.arguments.item.id} already exists`,
          422,
        );
      }
      const index = operation.arguments.index ?? track.items.length;
      if (index > track.items.length) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Item index is outside the track item list",
          422,
        );
      }
      track.items.splice(index, 0, operation.arguments.item);
      return {
        change: makeChange(
          operation,
          [sequence.id, track.id, operation.arguments.item.id],
          `Added ${operation.arguments.item.type}`,
        ),
        ranges: [operation.arguments.item.timelineRange],
        inverse: {
          operationId: createId(),
          type: "item.delete",
          targetId: operation.arguments.item.id,
          preconditions: [],
          arguments: { sequenceId: sequence.id, trackId: track.id },
        },
      };
    }
    case "item.delete": {
      const located = requireItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      located.track.items.splice(located.index, 1);
      return {
        change: makeChange(
          operation,
          [located.sequence.id, located.track.id, located.item.id],
          `Deleted ${located.item.type}`,
        ),
        ranges: [located.item.timelineRange],
        inverse: {
          operationId: createId(),
          type: "item.add",
          preconditions: [],
          arguments: {
            sequenceId: located.sequence.id,
            trackId: located.track.id,
            item: located.item,
            index: located.index,
          },
        },
      };
    }
    case "item.replace": {
      const located = requireItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      if (operation.arguments.item.id !== operation.targetId) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Replacement item id must match target id",
          422,
        );
      }
      ensureTrackAcceptsItem(located.track, operation.arguments.item);
      const previous = structuredClone(located.item);
      located.track.items[located.index] = structuredClone(
        operation.arguments.item,
      );
      return {
        change: makeChange(
          operation,
          [operation.targetId],
          `Replaced timeline item ${previous.name}`,
        ),
        ranges: [
          previous.timelineRange,
          operation.arguments.item.timelineRange,
        ],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { ...operation.arguments, item: previous },
        },
      };
    }
    case "gap.add":
    case "title.add": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const track = requireTrack(sequence, operation.arguments.trackId);
      const item =
        operation.type === "gap.add"
          ? operation.arguments.gap
          : operation.arguments.title;
      ensureTrackAcceptsItem(track, item);
      if (entityExists(project, item.id)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Entity ${item.id} already exists`,
          422,
        );
      }
      const index = operation.arguments.index ?? track.items.length;
      if (index > track.items.length) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Timeline item index is outside the track item list",
          422,
        );
      }
      track.items.splice(index, 0, structuredClone(item));
      return {
        change: makeChange(
          operation,
          [sequence.id, track.id, item.id],
          `Added ${item.type} ${item.name}`,
        ),
        ranges: [item.timelineRange],
        inverse:
          operation.type === "gap.add"
            ? {
                operationId: createId(),
                type: "gap.remove",
                targetId: item.id,
                preconditions: [],
                arguments: { sequenceId: sequence.id, trackId: track.id },
              }
            : {
                operationId: createId(),
                type: "title.remove",
                targetId: item.id,
                preconditions: [],
                arguments: { sequenceId: sequence.id, trackId: track.id },
              },
      };
    }
    case "gap.remove":
    case "title.remove": {
      const located = requireItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      const expectedType = operation.type === "gap.remove" ? "gap" : "title";
      if (located.item.type !== expectedType) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Item ${located.item.id} is not a ${expectedType}`,
          422,
        );
      }
      located.track.items.splice(located.index, 1);
      return {
        change: makeChange(
          operation,
          [located.sequence.id, located.track.id, located.item.id],
          `Removed ${expectedType} ${located.item.name}`,
        ),
        ranges: [located.item.timelineRange],
        inverse:
          located.item.type === "gap"
            ? {
                operationId: createId(),
                type: "gap.add",
                preconditions: [],
                arguments: {
                  sequenceId: located.sequence.id,
                  trackId: located.track.id,
                  gap: located.item,
                  index: located.index,
                },
              }
            : {
                operationId: createId(),
                type: "title.add",
                preconditions: [],
                arguments: {
                  sequenceId: located.sequence.id,
                  trackId: located.track.id,
                  title: located.item,
                  index: located.index,
                },
              },
      };
    }
    case "title.update": {
      const located = requireItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      if (
        located.item.type !== "title" ||
        operation.arguments.title.id !== operation.targetId
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Title replacement must target a title with the same id",
          422,
        );
      }
      ensureTrackAcceptsItem(located.track, operation.arguments.title);
      const previous = structuredClone(located.item);
      located.track.items[located.index] = structuredClone(
        operation.arguments.title,
      );
      return {
        change: makeChange(
          operation,
          [located.sequence.id, located.track.id, located.item.id],
          `Updated title ${located.item.name}`,
        ),
        ranges: [
          previous.timelineRange,
          operation.arguments.title.timelineRange,
        ],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { ...operation.arguments, title: previous },
        },
      };
    }
    case "title.template.apply": {
      const located = requireItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      if (located.item.type !== "title") {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Item ${located.item.id} is not a title`,
          422,
        );
      }
      const previous = structuredClone(located.item);
      located.item.templateId = operation.arguments.templateId;
      located.item.style = operation.arguments.replaceStyle
        ? structuredClone(operation.arguments.style)
        : {
            ...located.item.style,
            ...structuredClone(operation.arguments.style),
          };
      return {
        change: makeChange(
          operation,
          [located.sequence.id, located.track.id, located.item.id],
          `Applied title template ${operation.arguments.templateId}`,
        ),
        ranges: [located.item.timelineRange],
        inverse: {
          operationId: createId(),
          type: "title.update",
          targetId: located.item.id,
          preconditions: [],
          arguments: {
            sequenceId: located.sequence.id,
            trackId: located.track.id,
            title: previous,
          },
        },
      };
    }
    case "clip.move": {
      const located = requireItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.fromTrackId,
        operation.targetId,
      );
      if (located.item.type !== "clip") {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Item ${located.item.id} is not a clip`,
          422,
        );
      }
      const destination = requireTrack(
        located.sequence,
        operation.arguments.toTrackId,
      );
      ensureTrackAcceptsItem(destination, located.item);
      const previousStart = located.item.timelineRange.start;
      located.track.items.splice(located.index, 1);
      located.item.timelineRange.start = operation.arguments.timelineStart;
      destination.items.push(located.item);
      return {
        change: makeChange(
          operation,
          [located.item.id, located.track.id, destination.id],
          `Moved clip ${located.item.name}`,
        ),
        ranges: [
          {
            start: previousStart,
            duration: located.item.timelineRange.duration,
          },
          located.item.timelineRange,
        ],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: {
            sequenceId: located.sequence.id,
            fromTrackId: destination.id,
            toTrackId: located.track.id,
            timelineStart: previousStart,
          },
        },
      };
    }
    case "clip.snap": {
      const located = requireClipItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      const previousStart = structuredClone(located.item.timelineRange.start);
      located.item.timelineRange.start = structuredClone(
        operation.arguments.timelineStart,
      );
      return {
        change: makeChange(
          operation,
          [located.item.id, located.track.id],
          `Snapped clip ${located.item.name} to the requested frame`,
        ),
        ranges: [
          {
            start: previousStart,
            duration: located.item.timelineRange.duration,
          },
          located.item.timelineRange,
        ],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: {
            ...operation.arguments,
            timelineStart: previousStart,
          },
        },
      };
    }
    case "clip.reorder": {
      const located = requireClipItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      if (operation.arguments.index >= located.track.items.length) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Clip order index is outside the track item list",
          422,
        );
      }
      located.track.items.splice(located.index, 1);
      located.track.items.splice(operation.arguments.index, 0, located.item);
      return {
        change: makeChange(
          operation,
          [located.item.id, located.track.id],
          `Reordered clip ${located.item.name}`,
        ),
        ranges: [located.item.timelineRange],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { ...operation.arguments, index: located.index },
        },
      };
    }
    case "clip.group": {
      const group = structuredClone(operation.arguments.group);
      if (entityExists(project, group.id)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Entity ${group.id} already exists`,
          422,
        );
      }
      const sequence = requireSequence(project, group.sequenceId);
      const sequenceItemIds = new Set(
        sequence.tracks.flatMap((track) => track.items.map((item) => item.id)),
      );
      if (group.itemIds.some((itemId) => !sequenceItemIds.has(itemId))) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Item group ${group.id} contains an item outside sequence ${sequence.id}`,
          422,
        );
      }
      project.itemGroups[group.id] = group;
      return {
        change: makeChange(
          operation,
          [group.id, sequence.id, ...group.itemIds],
          `Grouped ${group.itemIds.length} timeline items as ${group.name}`,
        ),
        ranges: sequence.tracks.flatMap((track) =>
          track.items
            .filter((item) => group.itemIds.includes(item.id))
            .map((item) => item.timelineRange),
        ),
        inverse: {
          operationId: createId(),
          type: "clip.ungroup",
          targetId: group.id,
          preconditions: [],
          arguments: {},
        },
      };
    }
    case "clip.ungroup": {
      const group = project.itemGroups[operation.targetId];
      if (group === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Item group ${operation.targetId} was not found`,
          404,
        );
      }
      const sequence = requireSequence(project, group.sequenceId);
      delete project.itemGroups[group.id];
      return {
        change: makeChange(
          operation,
          [group.id, sequence.id, ...group.itemIds],
          `Ungrouped ${group.name}`,
        ),
        ranges: sequence.tracks.flatMap((track) =>
          track.items
            .filter((item) => group.itemIds.includes(item.id))
            .map((item) => item.timelineRange),
        ),
        inverse: {
          operationId: createId(),
          type: "clip.group",
          preconditions: [],
          arguments: { group },
        },
      };
    }
    case "clip.trim": {
      const located = requireItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      if (located.item.type !== "clip") {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Item ${located.item.id} is not a clip`,
          422,
        );
      }
      if (located.item.timeMap.length > 0) {
        throw new FrameOSError(
          "CAPABILITY_UNAVAILABLE",
          "Trim of a retimed clip is not implemented",
          424,
        );
      }
      const previous = structuredClone(located.item.sourceRange);
      const previousTimeline = structuredClone(located.item.timelineRange);
      located.item.sourceRange = operation.arguments.sourceRange;
      located.item.timelineRange.duration = rescaleTime(
        operation.arguments.sourceRange.duration,
        located.item.timelineRange.duration.rate,
      ).time;
      return {
        change: makeChange(
          operation,
          [located.item.id],
          `Trimmed clip ${located.item.name}`,
        ),
        ranges: [previousTimeline, located.item.timelineRange],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { ...operation.arguments, sourceRange: previous },
        },
      };
    }
    case "clip.split": {
      const located = requireItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      if (located.item.type !== "clip") {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Item ${located.item.id} is not a clip`,
          422,
        );
      }
      if (!sameRate(operation.arguments.at, located.item.timelineRange.start)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Split time must use the clip timeline rate",
          422,
        );
      }
      const offset =
        operation.arguments.at.value - located.item.timelineRange.start.value;
      if (offset <= 0 || offset >= located.item.timelineRange.duration.value) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Split must fall inside the clip",
          422,
        );
      }
      if (located.item.timeMap.length > 0) {
        throw new FrameOSError(
          "CAPABILITY_UNAVAILABLE",
          "Split of a retimed clip is not implemented",
          424,
        );
      }
      if (entityExists(project, operation.arguments.rightClipId)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Entity ${operation.arguments.rightClipId} already exists`,
          422,
        );
      }
      const original = structuredClone(located.item);
      const right = structuredClone(located.item);
      right.id = operation.arguments.rightClipId;
      right.name = `${right.name} (right)`;
      right.timelineRange.start = operation.arguments.at;
      right.timelineRange.duration.value -= offset;
      const sourceOffset = rescaleTime(
        { value: offset, rate: located.item.timelineRange.start.rate },
        right.sourceRange.start.rate,
      ).time;
      right.sourceRange.start = addTime(right.sourceRange.start, sourceOffset);
      right.sourceRange.duration = rescaleTime(
        right.timelineRange.duration,
        right.sourceRange.duration.rate,
      ).time;
      located.item.timelineRange.duration.value = offset;
      located.item.sourceRange.duration = rescaleTime(
        located.item.timelineRange.duration,
        located.item.sourceRange.duration.rate,
      ).time;
      located.track.items.splice(located.index + 1, 0, right);
      return {
        change: makeChange(
          operation,
          [located.item.id, right.id],
          `Split clip ${located.item.name}`,
        ),
        ranges: [original.timelineRange],
        inverse: trackItemsInverse(operation, located.sequence.id, {
          ...located.track,
          items: [
            ...located.track.items.slice(0, located.index),
            original,
            ...located.track.items.slice(located.index + 2),
          ],
        }),
      };
    }
    case "clip.insert": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const track = requireTrack(sequence, operation.arguments.trackId);
      ensureTrackAcceptsItem(track, operation.arguments.clip);
      if (entityExists(project, operation.arguments.clip.id)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Entity ${operation.arguments.clip.id} already exists`,
          422,
        );
      }
      const inverse = trackItemsInverse(operation, sequence.id, track);
      const clip = structuredClone(operation.arguments.clip);
      const inserted = itemFrames(clip, sequence.format.frameRate);
      for (const item of track.items) {
        const frames = itemFrames(item, sequence.format.frameRate);
        if (
          item.type !== "transition" &&
          frames.start < inserted.start &&
          frames.end > inserted.start
        ) {
          throw new FrameOSError(
            "VALIDATION_ERROR",
            "Insert point falls inside an existing item; split it first",
            422,
          );
        }
      }
      for (const item of track.items) {
        if (itemFrames(item, sequence.format.frameRate).start >= inserted.start)
          shiftItemStart(item, inserted.duration, sequence.format.frameRate);
      }
      track.items.push(clip);
      return {
        change: makeChange(
          operation,
          [sequence.id, track.id, clip.id],
          `Inserted clip ${clip.name}`,
        ),
        ranges: [clip.timelineRange],
        inverse,
      };
    }
    case "clip.append": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const track = requireTrack(sequence, operation.arguments.trackId);
      ensureTrackAcceptsItem(track, operation.arguments.clip);
      if (entityExists(project, operation.arguments.clip.id)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Entity ${operation.arguments.clip.id} already exists`,
          422,
        );
      }
      const inverse = trackItemsInverse(operation, sequence.id, track);
      const clip = structuredClone(operation.arguments.clip);
      const end = track.items
        .filter((item) => item.type !== "transition")
        .reduce(
          (maximum, item) =>
            Math.max(maximum, itemFrames(item, sequence.format.frameRate).end),
          0,
        );
      clip.timelineRange.start = frameTime(end, sequence.format.frameRate);
      track.items.push(clip);
      return {
        change: makeChange(
          operation,
          [sequence.id, track.id, clip.id],
          `Appended clip ${clip.name}`,
        ),
        ranges: [clip.timelineRange],
        inverse,
      };
    }
    case "clip.overwrite": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const track = requireTrack(sequence, operation.arguments.trackId);
      ensureTrackAcceptsItem(track, operation.arguments.clip);
      if (entityExists(project, operation.arguments.clip.id)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Entity ${operation.arguments.clip.id} already exists`,
          422,
        );
      }
      if (
        operation.arguments.rightRemainderId !== undefined &&
        entityExists(project, operation.arguments.rightRemainderId)
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Entity ${operation.arguments.rightRemainderId} already exists`,
          422,
        );
      }
      const inverse = sequenceInverse(operation, sequence);
      const clip = structuredClone(operation.arguments.clip);
      const overwrite = itemFrames(clip, sequence.format.frameRate);
      const nextItems: TimelineItem[] = [];
      const removedIds = new Set<string>();
      let usedRightRemainder = false;
      for (const originalItem of track.items) {
        const item = structuredClone(originalItem);
        const frames = itemFrames(item, sequence.format.frameRate);
        const overlaps =
          frames.start < overwrite.end && frames.end > overwrite.start;
        if (!overlaps) {
          nextItems.push(item);
          continue;
        }
        if (item.type === "transition") {
          removedIds.add(item.id);
          continue;
        }
        if (item.type !== "clip" && item.type !== "gap") {
          throw new FrameOSError(
            "CAPABILITY_UNAVAILABLE",
            `Overwrite cannot trim ${item.type} items yet`,
            424,
          );
        }
        if (frames.start < overwrite.start && frames.end > overwrite.end) {
          const rightRemainderId = operation.arguments.rightRemainderId;
          if (rightRemainderId === undefined) {
            throw new FrameOSError(
              "VALIDATION_ERROR",
              "Overwrite requires rightRemainderId when it splits an existing item",
              422,
            );
          }
          const right = structuredClone(item);
          right.id = rightRemainderId;
          right.name = `${right.name} (right)`;
          setEditorialRange(
            item,
            frames.start,
            overwrite.start - frames.start,
            sequence.format.frameRate,
            frames.start,
          );
          setEditorialRange(
            right,
            overwrite.end,
            frames.end - overwrite.end,
            sequence.format.frameRate,
            frames.start,
          );
          nextItems.push(item, right);
          usedRightRemainder = true;
          continue;
        }
        if (frames.start < overwrite.start) {
          setEditorialRange(
            item,
            frames.start,
            overwrite.start - frames.start,
            sequence.format.frameRate,
            frames.start,
          );
          nextItems.push(item);
          continue;
        }
        if (frames.end > overwrite.end) {
          setEditorialRange(
            item,
            overwrite.end,
            frames.end - overwrite.end,
            sequence.format.frameRate,
            frames.start,
          );
          nextItems.push(item);
        } else {
          removedIds.add(item.id);
        }
      }
      if (
        operation.arguments.rightRemainderId !== undefined &&
        !usedRightRemainder
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "rightRemainderId was supplied but no item required a split",
          422,
        );
      }
      nextItems.push(clip);
      track.items = nextItems;
      removeLinksTo(sequence, removedIds);
      return {
        change: makeChange(
          operation,
          [sequence.id, track.id, clip.id],
          `Overwrote timeline with ${clip.name}`,
        ),
        ranges: [clip.timelineRange],
        inverse,
      };
    }
    case "clip.duplicate": {
      const located = requireClipItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      if (entityExists(project, operation.arguments.newClipId)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Entity ${operation.arguments.newClipId} already exists`,
          422,
        );
      }
      const inverse = trackItemsInverse(
        operation,
        located.sequence.id,
        located.track,
      );
      const duplicate = structuredClone(located.item);
      duplicate.id = operation.arguments.newClipId;
      duplicate.name = `${duplicate.name} (copy)`;
      duplicate.timelineRange.start = operation.arguments.timelineStart;
      duplicate.links = [];
      located.track.items.push(duplicate);
      return {
        change: makeChange(
          operation,
          [located.item.id, duplicate.id],
          `Duplicated clip ${located.item.name}`,
        ),
        ranges: [duplicate.timelineRange],
        inverse,
      };
    }
    case "clip.replace": {
      const located = requireClipItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      if (operation.arguments.clip.id !== operation.targetId) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Replacement clip id must match target id",
          422,
        );
      }
      const previous = structuredClone(located.item);
      located.track.items[located.index] = structuredClone(
        operation.arguments.clip,
      );
      return {
        change: makeChange(
          operation,
          [located.item.id],
          `Replaced clip ${located.item.name}`,
        ),
        ranges: [
          previous.timelineRange,
          operation.arguments.clip.timelineRange,
        ],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { ...operation.arguments, clip: previous },
        },
      };
    }
    case "clip.lift": {
      const located = requireClipItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      if (entityExists(project, operation.arguments.gapId)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Entity ${operation.arguments.gapId} already exists`,
          422,
        );
      }
      const inverse = sequenceInverse(operation, located.sequence);
      removeLinksTo(located.sequence, new Set([located.item.id]));
      located.track.items[located.index] = {
        id: operation.arguments.gapId,
        type: "gap",
        name: `Lifted ${located.item.name}`,
        timelineRange: structuredClone(located.item.timelineRange),
        enabled: true,
        locked: false,
        metadata: { liftedClipId: located.item.id },
      };
      return {
        change: makeChange(
          operation,
          [located.item.id, operation.arguments.gapId],
          `Lifted clip ${located.item.name}`,
        ),
        ranges: [located.item.timelineRange],
        inverse,
      };
    }
    case "clip.extract":
    case "clip.ripple_delete": {
      const located = requireClipItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      const inverse = sequenceInverse(operation, located.sequence);
      const removed = itemFrames(
        located.item,
        located.sequence.format.frameRate,
      );
      located.track.items = located.track.items.filter((item) => {
        if (item.id === located.item.id) return false;
        if (item.type !== "transition") return true;
        const transitionFrames = itemFrames(
          item,
          located.sequence.format.frameRate,
        );
        return !(
          item.fromItemId === located.item.id ||
          item.toItemId === located.item.id ||
          (transitionFrames.start < removed.end &&
            transitionFrames.end > removed.start)
        );
      });
      removeLinksTo(located.sequence, new Set([located.item.id]));
      for (const item of located.track.items) {
        if (
          itemFrames(item, located.sequence.format.frameRate).start >=
          removed.end
        ) {
          shiftItemStart(
            item,
            -removed.duration,
            located.sequence.format.frameRate,
          );
        }
      }
      return {
        change: makeChange(
          operation,
          [located.sequence.id, located.track.id, located.item.id],
          `${operation.type === "clip.extract" ? "Extracted" : "Ripple-deleted"} clip ${located.item.name}`,
        ),
        ranges: [located.item.timelineRange],
        inverse,
      };
    }
    case "clip.roll": {
      const left = requireClipItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      const right = requireClipItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.arguments.rightClipId,
      );
      if (left.item.timeMap.length > 0 || right.item.timeMap.length > 0) {
        throw new FrameOSError(
          "CAPABILITY_UNAVAILABLE",
          "Roll edit of retimed clips is not implemented",
          424,
        );
      }
      const rate = left.sequence.format.frameRate;
      const leftFrames = itemFrames(left.item, rate);
      const rightFrames = itemFrames(right.item, rate);
      if (leftFrames.end !== rightFrames.start) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Roll edit requires contiguous left and right clips",
          422,
        );
      }
      const at = rescaleTime(operation.arguments.at, rate);
      if (
        at.rounded ||
        at.time.value <= leftFrames.start ||
        at.time.value >= rightFrames.end
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Roll boundary must fall inside the combined clips",
          422,
        );
      }
      const inverse = trackItemsInverse(
        operation,
        left.sequence.id,
        left.track,
      );
      setEditorialRange(
        left.item,
        leftFrames.start,
        at.time.value - leftFrames.start,
        rate,
        leftFrames.start,
      );
      setEditorialRange(
        right.item,
        at.time.value,
        rightFrames.end - at.time.value,
        rate,
        rightFrames.start,
      );
      return {
        change: makeChange(
          operation,
          [left.item.id, right.item.id],
          "Rolled edit boundary",
        ),
        ranges: [
          frameTime(leftFrames.start, rate).value === leftFrames.start
            ? {
                start: frameTime(leftFrames.start, rate),
                duration: frameTime(rightFrames.end - leftFrames.start, rate),
              }
            : left.item.timelineRange,
        ],
        inverse,
      };
    }
    case "clip.slip": {
      const located = requireClipItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      if (located.item.timeMap.length > 0) {
        throw new FrameOSError(
          "CAPABILITY_UNAVAILABLE",
          "Slip edit of a retimed clip is not implemented",
          424,
        );
      }
      const previous = structuredClone(located.item);
      located.item.sourceRange.start = operation.arguments.sourceStart;
      return {
        change: makeChange(
          operation,
          [located.item.id],
          `Slipped source for ${located.item.name}`,
        ),
        ranges: [located.item.timelineRange],
        inverse: {
          operationId: createId(),
          type: "item.replace",
          targetId: located.item.id,
          preconditions: [],
          arguments: {
            sequenceId: located.sequence.id,
            trackId: located.track.id,
            item: previous,
          },
        },
      };
    }
    case "clip.slide": {
      const located = requireClipItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      const rate = located.sequence.format.frameRate;
      const editorial = located.track.items
        .filter((item) => item.type !== "transition")
        .toSorted(
          (left, right) =>
            itemFrames(left, rate).start - itemFrames(right, rate).start,
        );
      const position = editorial.findIndex(
        (item) => item.id === located.item.id,
      );
      const previous = editorial[position - 1];
      const next = editorial[position + 1];
      if (previous === undefined || next === undefined) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Slide edit requires adjacent items on both sides",
          422,
        );
      }
      const targetFrames = itemFrames(located.item, rate);
      const previousFrames = itemFrames(previous, rate);
      const nextFrames = itemFrames(next, rate);
      if (
        previousFrames.end !== targetFrames.start ||
        targetFrames.end !== nextFrames.start
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Slide edit requires three contiguous items",
          422,
        );
      }
      const requested = rescaleTime(operation.arguments.timelineStart, rate);
      if (requested.rounded) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Slide start is not frame aligned",
          422,
        );
      }
      const delta = requested.time.value - targetFrames.start;
      if (
        previousFrames.duration + delta <= 0 ||
        nextFrames.duration - delta <= 0
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Slide would consume an adjacent item",
          422,
        );
      }
      const inverse = trackItemsInverse(
        operation,
        located.sequence.id,
        located.track,
      );
      setEditorialRange(
        previous,
        previousFrames.start,
        previousFrames.duration + delta,
        rate,
        previousFrames.start,
      );
      located.item.timelineRange.start = requested.time;
      setEditorialRange(
        next,
        nextFrames.start + delta,
        nextFrames.duration - delta,
        rate,
        nextFrames.start,
      );
      return {
        change: makeChange(
          operation,
          [previous.id, located.item.id, next.id],
          `Slid clip ${located.item.name}`,
        ),
        ranges: [
          {
            start: frameTime(previousFrames.start, rate),
            duration: frameTime(nextFrames.end - previousFrames.start, rate),
          },
        ],
        inverse,
      };
    }
    case "clip.link":
    case "clip.unlink": {
      const sequenceBefore = structuredClone(
        requireSequence(project, operation.arguments.sequenceId),
      );
      const first = requireClipItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      const second = requireClipItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.otherTrackId,
        operation.arguments.otherClipId,
      );
      if (first.item.id === second.item.id) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "A clip cannot link to itself",
          422,
        );
      }
      const linking = operation.type === "clip.link";
      const alreadyLinked =
        first.item.links.includes(second.item.id) &&
        second.item.links.includes(first.item.id);
      if (linking === alreadyLinked) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          linking ? "Clips are already linked" : "Clips are not linked",
          422,
        );
      }
      if (linking) {
        first.item.links.push(second.item.id);
        second.item.links.push(first.item.id);
      } else {
        first.item.links = first.item.links.filter(
          (id) => id !== second.item.id,
        );
        second.item.links = second.item.links.filter(
          (id) => id !== first.item.id,
        );
      }
      return {
        change: makeChange(
          operation,
          [first.item.id, second.item.id],
          `${linking ? "Linked" : "Unlinked"} clips`,
        ),
        ranges: [first.item.timelineRange, second.item.timelineRange],
        inverse: {
          operationId: createId(),
          type: "sequence.replace",
          targetId: sequenceBefore.id,
          preconditions: [],
          arguments: { sequence: sequenceBefore },
        },
      };
    }
    case "clip.freeze_frame": {
      const located = requireClipItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      const sourceTime = rescaleTime(
        operation.arguments.sourceTime,
        located.item.sourceRange.start.rate,
      );
      const sourceEnd = addTime(
        located.item.sourceRange.start,
        located.item.sourceRange.duration,
      );
      if (
        sourceTime.rounded ||
        compareTime(sourceTime.time, located.item.sourceRange.start) < 0 ||
        compareTime(sourceTime.time, sourceEnd) >= 0
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Freeze-frame source time is outside the clip source range",
          422,
        );
      }
      const previous = structuredClone(located.item);
      located.item.timeMap = [
        {
          id: operation.arguments.startKeyframeId,
          time: frameTime(0, located.item.timelineRange.duration.rate),
          value: sourceTime.time.value,
          interpolation: "hold",
        },
        {
          id: operation.arguments.endKeyframeId,
          time: structuredClone(located.item.timelineRange.duration),
          value: sourceTime.time.value,
          interpolation: "hold",
        },
      ];
      return {
        change: makeChange(
          operation,
          [located.item.id],
          `Froze frame in ${located.item.name}`,
        ),
        ranges: [located.item.timelineRange],
        inverse: {
          operationId: createId(),
          type: "item.replace",
          targetId: located.item.id,
          preconditions: [],
          arguments: {
            sequenceId: located.sequence.id,
            trackId: located.track.id,
            item: previous,
          },
        },
      };
    }
    case "clip.reverse":
    case "clip.speed.set": {
      const located = requireClipItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      const previous = structuredClone(located.item);
      if (operation.type === "clip.speed.set") {
        const normalDuration = rescaleTime(
          located.item.sourceRange.duration,
          located.sequence.format.frameRate,
        );
        const numerator =
          BigInt(normalDuration.time.value) *
          BigInt(operation.arguments.speed.denominator);
        const denominator = BigInt(operation.arguments.speed.numerator);
        if (normalDuration.rounded || numerator % denominator !== 0n) {
          throw new FrameOSError(
            "VALIDATION_ERROR",
            "Speed produces a non-frame-aligned timeline duration",
            422,
          );
        }
        const duration = Number(numerator / denominator);
        if (duration <= 0 || !Number.isSafeInteger(duration)) {
          throw new FrameOSError(
            "VALIDATION_ERROR",
            "Speed produces an invalid timeline duration",
            422,
          );
        }
        located.item.timelineRange.duration = frameTime(
          duration,
          located.sequence.format.frameRate,
        );
      }
      const sourceStart = located.item.sourceRange.start.value;
      const sourceEnd = addTime(
        located.item.sourceRange.start,
        located.item.sourceRange.duration,
      ).value;
      const reversed = operation.type === "clip.reverse";
      located.item.timeMap = [
        {
          id: operation.arguments.startKeyframeId,
          time: frameTime(0, located.item.timelineRange.duration.rate),
          value: reversed ? sourceEnd : sourceStart,
          interpolation: "linear",
        },
        {
          id: operation.arguments.endKeyframeId,
          time: structuredClone(located.item.timelineRange.duration),
          value: reversed ? sourceStart : sourceEnd,
          interpolation: "linear",
        },
      ];
      return {
        change: makeChange(
          operation,
          [located.item.id],
          `${reversed ? "Reversed" : "Retimed"} clip ${located.item.name}`,
        ),
        ranges: [previous.timelineRange, located.item.timelineRange],
        inverse: {
          operationId: createId(),
          type: "item.replace",
          targetId: located.item.id,
          preconditions: [],
          arguments: {
            sequenceId: located.sequence.id,
            trackId: located.track.id,
            item: previous,
          },
        },
      };
    }
    case "clip.speed_ramp.set": {
      const located = requireClipItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      const duration = rescaleTime(
        operation.arguments.timelineDuration,
        located.sequence.format.frameRate,
      );
      const keyframes = structuredClone(operation.arguments.keyframes);
      if (
        duration.rounded ||
        duration.time.value <= 0 ||
        compareTime(
          keyframes[0]!.time,
          frameTime(0, located.sequence.format.frameRate),
        ) !== 0 ||
        compareTime(keyframes.at(-1)!.time, duration.time) !== 0 ||
        keyframes.some((keyframe) => typeof keyframe.value !== "number")
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Speed-ramp keyframes must span the new duration and use numeric source positions",
          422,
        );
      }
      for (let index = 1; index < keyframes.length; index += 1) {
        if (
          compareTime(keyframes[index - 1]!.time, keyframes[index]!.time) >= 0
        ) {
          throw new FrameOSError(
            "VALIDATION_ERROR",
            "Speed-ramp keyframes must be strictly ordered",
            422,
          );
        }
      }
      const previous = structuredClone(located.item);
      located.item.timelineRange.duration = duration.time;
      located.item.timeMap = keyframes;
      return {
        change: makeChange(
          operation,
          [located.item.id, ...keyframes.map((keyframe) => keyframe.id)],
          `Set speed ramp for ${located.item.name}`,
        ),
        ranges: [previous.timelineRange, located.item.timelineRange],
        inverse: {
          operationId: createId(),
          type: "item.replace",
          targetId: located.item.id,
          preconditions: [],
          arguments: {
            sequenceId: located.sequence.id,
            trackId: located.track.id,
            item: previous,
          },
        },
      };
    }
    case "item.transform.set": {
      const located = requireItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      if (!("transform" in located.item)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Item ${located.item.id} has no transform`,
          422,
        );
      }
      const previous = structuredClone(located.item.transform);
      located.item.transform = operation.arguments.transform;
      return {
        change: makeChange(
          operation,
          [located.item.id],
          `Updated transform for ${located.item.name}`,
        ),
        ranges: [located.item.timelineRange],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { ...operation.arguments, transform: previous },
        },
      };
    }
    case "video.position.set":
    case "video.anchor.set":
    case "video.scale.set":
    case "video.crop.set":
    case "video.rotation.set":
    case "video.opacity.set":
    case "video.blend_mode.set": {
      const located = requireItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      if (!("transform" in located.item)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Item ${located.item.id} has no transform`,
          422,
        );
      }
      const previous = structuredClone(located.item.transform);
      if (operation.type === "video.position.set") {
        located.item.transform.positionX = operation.arguments.x;
        located.item.transform.positionY = operation.arguments.y;
      } else if (operation.type === "video.anchor.set") {
        located.item.transform.anchorX = operation.arguments.x;
        located.item.transform.anchorY = operation.arguments.y;
      } else if (operation.type === "video.scale.set") {
        located.item.transform.scaleX = operation.arguments.x;
        located.item.transform.scaleY = operation.arguments.y;
      } else if (operation.type === "video.crop.set") {
        located.item.transform.cropTop = operation.arguments.top;
        located.item.transform.cropRight = operation.arguments.right;
        located.item.transform.cropBottom = operation.arguments.bottom;
        located.item.transform.cropLeft = operation.arguments.left;
      } else if (operation.type === "video.rotation.set") {
        located.item.transform.rotation = operation.arguments.degrees;
      } else if (operation.type === "video.opacity.set") {
        located.item.transform.opacity = operation.arguments.opacity;
      } else {
        located.item.transform.blendMode = operation.arguments.blendMode;
      }
      return {
        change: makeChange(
          operation,
          [located.item.id],
          `Updated ${operation.type} for ${located.item.name}`,
        ),
        ranges: [located.item.timelineRange],
        inverse: {
          operationId: createId(),
          type: "item.transform.set",
          targetId: located.item.id,
          preconditions: [],
          arguments: {
            sequenceId: located.sequence.id,
            trackId: located.track.id,
            transform: previous,
          },
        },
      };
    }
    case "video.picture_in_picture.apply": {
      const located = requireItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      if (!("transform" in located.item)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Item ${located.item.id} has no transform`,
          422,
        );
      }
      const { width, height } = located.sequence.format;
      const { scale, marginPixels, corner } = operation.arguments;
      if (
        marginPixels * 2 + width * scale > width ||
        marginPixels * 2 + height * scale > height
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Picture-in-picture scale and margin do not fit inside the sequence frame",
          422,
        );
      }
      const previous = structuredClone(located.item.transform);
      const left = corner.endsWith("left");
      const top = corner.startsWith("top");
      located.item.transform.anchorX = 0.5;
      located.item.transform.anchorY = 0.5;
      located.item.transform.scaleX = scale;
      located.item.transform.scaleY = scale;
      located.item.transform.positionX = left
        ? marginPixels + (width * scale) / 2 - width / 2
        : width / 2 - marginPixels - (width * scale) / 2;
      located.item.transform.positionY = top
        ? marginPixels + (height * scale) / 2 - height / 2
        : height / 2 - marginPixels - (height * scale) / 2;
      if (operation.arguments.opacity !== undefined) {
        located.item.transform.opacity = operation.arguments.opacity;
      }
      return {
        change: makeChange(
          operation,
          [located.item.id],
          `Applied ${corner} picture-in-picture layout to ${located.item.name}`,
        ),
        ranges: [located.item.timelineRange],
        inverse: {
          operationId: createId(),
          type: "item.transform.set",
          targetId: located.item.id,
          preconditions: [],
          arguments: {
            sequenceId: located.sequence.id,
            trackId: located.track.id,
            transform: previous,
          },
        },
      };
    }
    case "transition.add": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const track = requireTrack(sequence, operation.arguments.trackId);
      const transition = structuredClone(operation.arguments.transition);
      ensureTrackAcceptsItem(track, transition);
      if (entityExists(project, transition.id)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Transition ${transition.id} already exists`,
          422,
        );
      }
      const itemIds = new Set(track.items.map((item) => item.id));
      if (
        !itemIds.has(transition.fromItemId) ||
        !itemIds.has(transition.toItemId)
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Transition endpoints must exist on the target track",
          422,
        );
      }
      const index = operation.arguments.index ?? track.items.length;
      if (index > track.items.length) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Transition index is outside the track item list",
          422,
        );
      }
      track.items.splice(index, 0, transition);
      return {
        change: makeChange(
          operation,
          [sequence.id, track.id, transition.id],
          `Added transition ${transition.name}`,
        ),
        ranges: [transition.timelineRange],
        inverse: {
          operationId: createId(),
          type: "transition.remove",
          targetId: transition.id,
          preconditions: [],
          arguments: { sequenceId: sequence.id, trackId: track.id },
        },
      };
    }
    case "transition.remove": {
      const located = requireItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      if (located.item.type !== "transition") {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Item ${located.item.id} is not a transition`,
          422,
        );
      }
      located.track.items.splice(located.index, 1);
      return {
        change: makeChange(
          operation,
          [located.sequence.id, located.track.id, located.item.id],
          `Removed transition ${located.item.name}`,
        ),
        ranges: [located.item.timelineRange],
        inverse: {
          operationId: createId(),
          type: "transition.add",
          preconditions: [],
          arguments: {
            sequenceId: located.sequence.id,
            trackId: located.track.id,
            transition: located.item,
            index: located.index,
          },
        },
      };
    }
    case "transition.duration.set": {
      const located = requireItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      if (located.item.type !== "transition") {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Item ${located.item.id} is not a transition`,
          422,
        );
      }
      const previous = structuredClone(located.item.timelineRange.duration);
      located.item.timelineRange.duration = operation.arguments.duration;
      return {
        change: makeChange(
          operation,
          [located.item.id],
          `Updated transition duration for ${located.item.name}`,
        ),
        ranges: [located.item.timelineRange],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { ...operation.arguments, duration: previous },
        },
      };
    }
    case "transition.parameter.set": {
      const located = requireItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      if (located.item.type !== "transition") {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Item ${located.item.id} is not a transition`,
          422,
        );
      }
      const hadPrevious = Object.hasOwn(
        located.item.parameters,
        operation.arguments.parameter,
      );
      const previous = located.item.parameters[operation.arguments.parameter];
      if (
        !operation.arguments.unset &&
        !Object.hasOwn(operation.arguments, "value")
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "transition.parameter.set requires value unless unset is true",
          422,
        );
      }
      if (operation.arguments.unset) {
        delete located.item.parameters[operation.arguments.parameter];
      } else {
        located.item.parameters[operation.arguments.parameter] =
          operation.arguments.value;
      }
      return {
        change: makeChange(
          operation,
          [located.item.id],
          `Updated transition parameter ${operation.arguments.parameter}`,
        ),
        ranges: [located.item.timelineRange],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: {
            ...operation.arguments,
            value: previous,
            unset: !hadPrevious,
          },
        },
      };
    }
    case "transition.keyframe.add": {
      const located = requireItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      if (located.item.type !== "transition") {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Item ${located.item.id} is not a transition`,
          422,
        );
      }
      const curve = located.item.automationCurves.find(
        (candidate) => candidate.id === operation.arguments.curveId,
      );
      if (curve === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Transition automation curve ${operation.arguments.curveId} was not found`,
          404,
        );
      }
      if (entityExists(project, operation.arguments.keyframe.id)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Keyframe ${operation.arguments.keyframe.id} already exists`,
          422,
        );
      }
      curve.keyframes.push(structuredClone(operation.arguments.keyframe));
      curve.keyframes.sort((left, right) => compareTime(left.time, right.time));
      return {
        change: makeChange(
          operation,
          [located.item.id, curve.id, operation.arguments.keyframe.id],
          `Added transition keyframe to ${curve.parameter}`,
        ),
        ranges: [located.item.timelineRange],
        inverse: {
          operationId: createId(),
          type: "transition.keyframe.remove",
          targetId: located.item.id,
          preconditions: [],
          arguments: {
            sequenceId: located.sequence.id,
            trackId: located.track.id,
            curveId: curve.id,
            keyframeId: operation.arguments.keyframe.id,
          },
        },
      };
    }
    case "transition.keyframe.remove": {
      const located = requireItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      if (located.item.type !== "transition") {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Item ${located.item.id} is not a transition`,
          422,
        );
      }
      const curve = located.item.automationCurves.find(
        (candidate) => candidate.id === operation.arguments.curveId,
      );
      if (curve === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Transition automation curve ${operation.arguments.curveId} was not found`,
          404,
        );
      }
      const index = curve.keyframes.findIndex(
        (keyframe) => keyframe.id === operation.arguments.keyframeId,
      );
      const keyframe = curve.keyframes[index];
      if (keyframe === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Transition keyframe ${operation.arguments.keyframeId} was not found`,
          404,
        );
      }
      curve.keyframes.splice(index, 1);
      return {
        change: makeChange(
          operation,
          [located.item.id, curve.id, keyframe.id],
          `Removed transition keyframe from ${curve.parameter}`,
        ),
        ranges: [located.item.timelineRange],
        inverse: {
          operationId: createId(),
          type: "transition.keyframe.add",
          targetId: located.item.id,
          preconditions: [],
          arguments: {
            sequenceId: located.sequence.id,
            trackId: located.track.id,
            curveId: curve.id,
            keyframe,
          },
        },
      };
    }
    case "effect.add": {
      const effects = findEffectCollection(
        project,
        operation.arguments.sequenceId,
        operation.targetId,
        operation.arguments.trackId,
      );
      if (
        effects.some((effect) => effect.id === operation.arguments.effect.id)
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Effect ${operation.arguments.effect.id} already exists`,
          422,
        );
      }
      const index = operation.arguments.index ?? effects.length;
      if (index > effects.length) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Effect index is outside the effect stack",
          422,
        );
      }
      effects.splice(index, 0, operation.arguments.effect);
      return {
        change: makeChange(
          operation,
          [operation.targetId, operation.arguments.effect.id],
          `Added effect ${operation.arguments.effect.capabilityId}`,
        ),
        ranges:
          operation.arguments.effect.range === undefined
            ? []
            : [operation.arguments.effect.range],
        inverse: {
          operationId: createId(),
          type: "effect.remove",
          targetId: operation.targetId,
          preconditions: [],
          arguments: {
            sequenceId: operation.arguments.sequenceId,
            ...(operation.arguments.trackId === undefined
              ? {}
              : { trackId: operation.arguments.trackId }),
            effectId: operation.arguments.effect.id,
          },
        },
      };
    }
    case "effect.remove": {
      const effects = findEffectCollection(
        project,
        operation.arguments.sequenceId,
        operation.targetId,
        operation.arguments.trackId,
      );
      const index = effects.findIndex(
        (effect) => effect.id === operation.arguments.effectId,
      );
      if (index < 0) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Effect ${operation.arguments.effectId} was not found`,
          404,
        );
      }
      const effect = effects[index];
      if (effect === undefined) {
        throw new FrameOSError("INTERNAL_ERROR", "Effect lookup failed", 500);
      }
      effects.splice(index, 1);
      return {
        change: makeChange(
          operation,
          [operation.targetId, effect.id],
          `Removed effect ${effect.capabilityId}`,
        ),
        ranges: effect.range === undefined ? [] : [effect.range],
        inverse: {
          operationId: createId(),
          type: "effect.add",
          targetId: operation.targetId,
          preconditions: [],
          arguments: {
            sequenceId: operation.arguments.sequenceId,
            ...(operation.arguments.trackId === undefined
              ? {}
              : { trackId: operation.arguments.trackId }),
            effect,
            index,
          },
        },
      };
    }
    case "effect.parameter.set": {
      const { effect } = findEffect(
        project,
        operation.arguments.sequenceId,
        operation.targetId,
        operation.arguments.effectId,
        operation.arguments.trackId,
      );
      const hadPrevious = Object.hasOwn(
        effect.parameters,
        operation.arguments.parameter,
      );
      const previous = effect.parameters[operation.arguments.parameter];
      if (
        !operation.arguments.unset &&
        !Object.hasOwn(operation.arguments, "value")
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "effect.parameter.set requires value unless unset is true",
          422,
        );
      }
      if (operation.arguments.unset) {
        delete effect.parameters[operation.arguments.parameter];
      } else {
        effect.parameters[operation.arguments.parameter] =
          operation.arguments.value;
      }
      return {
        change: makeChange(
          operation,
          [operation.targetId, effect.id],
          `Updated effect parameter ${operation.arguments.parameter}`,
        ),
        ranges: effect.range === undefined ? [] : [effect.range],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: {
            ...operation.arguments,
            value: previous,
            unset: !hadPrevious,
          },
        },
      };
    }
    case "effect.preset.apply": {
      const { effect } = findEffect(
        project,
        operation.arguments.sequenceId,
        operation.targetId,
        operation.arguments.effectId,
        operation.arguments.trackId,
      );
      const previous = structuredClone(effect.parameters);
      effect.parameters = operation.arguments.replace
        ? structuredClone(operation.arguments.parameters)
        : {
            ...effect.parameters,
            ...structuredClone(operation.arguments.parameters),
          };
      return {
        change: makeChange(
          operation,
          [operation.targetId, effect.id],
          `Applied parameter preset to ${effect.capabilityId}`,
        ),
        ranges: effect.range === undefined ? [] : [effect.range],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: {
            ...operation.arguments,
            parameters: previous,
            replace: true,
          },
        },
      };
    }
    case "effect.enable":
    case "effect.disable": {
      const { effect } = findEffect(
        project,
        operation.arguments.sequenceId,
        operation.targetId,
        operation.arguments.effectId,
        operation.arguments.trackId,
      );
      const previous = effect.enabled;
      effect.enabled = operation.type === "effect.enable";
      return {
        change: makeChange(
          operation,
          [operation.targetId, effect.id],
          `${effect.enabled ? "Enabled" : "Disabled"} effect ${effect.capabilityId}`,
        ),
        ranges: effect.range === undefined ? [] : [effect.range],
        inverse: {
          operationId: createId(),
          type: previous ? "effect.enable" : "effect.disable",
          targetId: operation.targetId,
          preconditions: [],
          arguments: structuredClone(operation.arguments),
        },
      };
    }
    case "effect.reorder": {
      const { effects, effect, index } = findEffect(
        project,
        operation.arguments.sequenceId,
        operation.targetId,
        operation.arguments.effectId,
        operation.arguments.trackId,
      );
      if (operation.arguments.index >= effects.length) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Effect index is outside the effect stack",
          422,
        );
      }
      effects.splice(index, 1);
      effects.splice(operation.arguments.index, 0, effect);
      return {
        change: makeChange(
          operation,
          [operation.targetId, effect.id],
          `Reordered effect ${effect.capabilityId}`,
        ),
        ranges: effect.range === undefined ? [] : [effect.range],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { ...operation.arguments, index },
        },
      };
    }
    case "effect.range.set": {
      const { effect } = findEffect(
        project,
        operation.arguments.sequenceId,
        operation.targetId,
        operation.arguments.effectId,
        operation.arguments.trackId,
      );
      const previous =
        effect.range === undefined ? null : structuredClone(effect.range);
      if (operation.arguments.range === null) delete effect.range;
      else effect.range = operation.arguments.range;
      return {
        change: makeChange(
          operation,
          [operation.targetId, effect.id],
          `Updated effect range for ${effect.capabilityId}`,
        ),
        ranges: [
          ...(previous === null ? [] : [previous]),
          ...(effect.range === undefined ? [] : [effect.range]),
        ],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { ...operation.arguments, range: previous },
        },
      };
    }
    case "keyframe.add": {
      const { effect, curve } = findAutomationCurve(project, operation);
      if (entityExists(project, operation.arguments.keyframe.id)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Keyframe ${operation.arguments.keyframe.id} already exists`,
          422,
        );
      }
      curve.keyframes.push(structuredClone(operation.arguments.keyframe));
      curve.keyframes.sort((left, right) => compareTime(left.time, right.time));
      return {
        change: makeChange(
          operation,
          [effect.id, curve.id, operation.arguments.keyframe.id],
          `Added keyframe to ${curve.parameter}`,
        ),
        ranges: effect.range === undefined ? [] : [effect.range],
        inverse: {
          operationId: createId(),
          type: "keyframe.remove",
          targetId: operation.targetId,
          preconditions: [],
          arguments: {
            sequenceId: operation.arguments.sequenceId,
            ...(operation.arguments.trackId === undefined
              ? {}
              : { trackId: operation.arguments.trackId }),
            effectId: effect.id,
            curveId: curve.id,
            keyframeId: operation.arguments.keyframe.id,
          },
        },
      };
    }
    case "keyframe.remove": {
      const { effect, curve } = findAutomationCurve(project, operation);
      const index = curve.keyframes.findIndex(
        (keyframe) => keyframe.id === operation.arguments.keyframeId,
      );
      const keyframe = curve.keyframes[index];
      if (keyframe === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Keyframe ${operation.arguments.keyframeId} was not found`,
          404,
        );
      }
      curve.keyframes.splice(index, 1);
      return {
        change: makeChange(
          operation,
          [effect.id, curve.id, keyframe.id],
          `Removed keyframe from ${curve.parameter}`,
        ),
        ranges: effect.range === undefined ? [] : [effect.range],
        inverse: {
          operationId: createId(),
          type: "keyframe.add",
          targetId: operation.targetId,
          preconditions: [],
          arguments: {
            sequenceId: operation.arguments.sequenceId,
            ...(operation.arguments.trackId === undefined
              ? {}
              : { trackId: operation.arguments.trackId }),
            effectId: effect.id,
            curveId: curve.id,
            keyframe,
          },
        },
      };
    }
    case "keyframe.move":
    case "keyframe.value.set":
    case "keyframe.interpolation.set": {
      const { effect, curve } = findAutomationCurve(project, operation);
      const keyframe = curve.keyframes.find(
        (candidate) => candidate.id === operation.arguments.keyframeId,
      );
      if (keyframe === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Keyframe ${operation.arguments.keyframeId} was not found`,
          404,
        );
      }
      let inverse: Operation;
      if (operation.type === "keyframe.move") {
        inverse = {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: {
            ...operation.arguments,
            time: structuredClone(keyframe.time),
          },
        };
        keyframe.time = operation.arguments.time;
        curve.keyframes.sort((left, right) =>
          compareTime(left.time, right.time),
        );
      } else if (operation.type === "keyframe.value.set") {
        inverse = {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: {
            ...operation.arguments,
            value: structuredClone(keyframe.value),
          },
        };
        keyframe.value = operation.arguments.value;
      } else {
        inverse = {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: {
            ...operation.arguments,
            interpolation: keyframe.interpolation,
          },
        };
        keyframe.interpolation = operation.arguments.interpolation;
      }
      return {
        change: makeChange(
          operation,
          [effect.id, curve.id, keyframe.id],
          `Updated keyframe on ${curve.parameter}`,
        ),
        ranges: effect.range === undefined ? [] : [effect.range],
        inverse,
      };
    }
    case "mask.add": {
      const mask = structuredClone(operation.arguments.mask);
      if (entityExists(project, mask.id)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Mask ${mask.id} already exists`,
          422,
        );
      }
      project.masks[mask.id] = mask;
      return {
        change: makeChange(operation, [mask.id], `Added mask ${mask.name}`),
        ranges: mask.keyframes.map((keyframe) => ({
          start: keyframe.time,
          duration: frameTime(0, keyframe.time.rate),
        })),
        inverse: {
          operationId: createId(),
          type: "mask.remove",
          targetId: mask.id,
          preconditions: [],
          arguments: {},
        },
      };
    }
    case "mask.remove": {
      const mask = project.masks[operation.targetId];
      if (mask === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Mask ${operation.targetId} was not found`,
          404,
        );
      }
      if (allEffects(project).some((effect) => effect.maskRef === mask.id)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Mask ${mask.id} is attached to an effect`,
          422,
        );
      }
      delete project.masks[mask.id];
      return {
        change: makeChange(operation, [mask.id], `Removed mask ${mask.name}`),
        ranges: [],
        inverse: {
          operationId: createId(),
          type: "mask.add",
          preconditions: [],
          arguments: { mask },
        },
      };
    }
    case "mask.path.set":
    case "mask.feather.set":
    case "mask.invert.set":
    case "mask.track.attach": {
      const mask = project.masks[operation.targetId];
      if (mask === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Mask ${operation.targetId} was not found`,
          404,
        );
      }
      if (
        operation.type === "mask.track.attach" &&
        operation.arguments.trackedObjectId !== null &&
        project.trackedObjects[operation.arguments.trackedObjectId] ===
          undefined
      ) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Tracked object ${operation.arguments.trackedObjectId} was not found`,
          404,
        );
      }
      let inverse: Operation;
      if (operation.type === "mask.path.set") {
        inverse = {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { points: structuredClone(mask.points) },
        };
        mask.points = structuredClone(operation.arguments.points);
      } else if (operation.type === "mask.feather.set") {
        inverse = {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { feather: mask.feather },
        };
        mask.feather = operation.arguments.feather;
      } else if (operation.type === "mask.invert.set") {
        inverse = {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { inverted: mask.inverted },
        };
        mask.inverted = operation.arguments.inverted;
      } else {
        inverse = {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { trackedObjectId: mask.trackedObjectId ?? null },
        };
        if (operation.arguments.trackedObjectId === null)
          delete mask.trackedObjectId;
        else mask.trackedObjectId = operation.arguments.trackedObjectId;
      }
      return {
        change: makeChange(
          operation,
          [mask.id],
          `Updated ${operation.type} for ${mask.name}`,
        ),
        ranges: [],
        inverse,
      };
    }
    case "effect.mask.attach":
    case "effect.mask.detach": {
      const { effect } = findEffect(
        project,
        operation.arguments.sequenceId,
        operation.targetId,
        operation.arguments.effectId,
        operation.arguments.trackId,
      );
      const previous = effect.maskRef;
      if (operation.type === "effect.mask.attach") {
        if (project.masks[operation.arguments.maskId] === undefined) {
          throw new FrameOSError(
            "NOT_FOUND",
            `Mask ${operation.arguments.maskId} was not found`,
            404,
          );
        }
        effect.maskRef = operation.arguments.maskId;
      } else {
        if (previous === undefined) {
          throw new FrameOSError(
            "VALIDATION_ERROR",
            `Effect ${effect.id} has no attached mask`,
            422,
          );
        }
        delete effect.maskRef;
      }
      const commonArguments = {
        sequenceId: operation.arguments.sequenceId,
        ...(operation.arguments.trackId === undefined
          ? {}
          : { trackId: operation.arguments.trackId }),
        effectId: effect.id,
      };
      const inverse: Operation =
        previous === undefined
          ? {
              operationId: createId(),
              type: "effect.mask.detach",
              targetId: operation.targetId,
              preconditions: [],
              arguments: commonArguments,
            }
          : {
              operationId: createId(),
              type: "effect.mask.attach",
              targetId: operation.targetId,
              preconditions: [],
              arguments: { ...commonArguments, maskId: previous },
            };
      return {
        change: makeChange(
          operation,
          [
            operation.targetId,
            effect.id,
            ...(effect.maskRef === undefined ? [] : [effect.maskRef]),
          ],
          `${operation.type === "effect.mask.attach" ? "Attached" : "Detached"} effect mask`,
        ),
        ranges: effect.range === undefined ? [] : [effect.range],
        inverse,
      };
    }
    case "video.track_object": {
      const located = requireClipItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      const trackedObject = structuredClone(operation.arguments.trackedObject);
      if (entityExists(project, trackedObject.id)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Tracked object ${trackedObject.id} already exists`,
          422,
        );
      }
      if (
        trackedObject.itemId !== undefined &&
        trackedObject.itemId !== located.item.id
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Tracked object itemId must match the target clip",
          422,
        );
      }
      trackedObject.itemId = located.item.id;
      trackedObject.sequenceId ??= located.sequence.id;
      project.trackedObjects[trackedObject.id] = trackedObject;
      const referenceFieldWasAbsent = !Object.hasOwn(
        located.item.semanticMetadata,
        "trackedObjectIds",
      );
      const currentReferences = located.item.semanticMetadata.trackedObjectIds;
      const references = Array.isArray(currentReferences)
        ? currentReferences.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      if (references.includes(trackedObject.id)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Clip ${located.item.id} already references tracked object ${trackedObject.id}`,
          422,
        );
      }
      const referenceIndex =
        operation.arguments.referenceIndex ?? references.length;
      if (referenceIndex > references.length) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Tracked-object reference index is outside the clip reference list",
          422,
        );
      }
      references.splice(referenceIndex, 0, trackedObject.id);
      located.item.semanticMetadata.trackedObjectIds = references;
      return {
        change: makeChange(
          operation,
          [located.item.id, trackedObject.id],
          `Attached tracked object ${trackedObject.name}`,
        ),
        ranges: [trackedObject.range],
        inverse: {
          operationId: createId(),
          type: "tracked_object.remove",
          targetId: trackedObject.id,
          preconditions: [],
          arguments: {
            sequenceId: located.sequence.id,
            trackId: located.track.id,
            itemId: located.item.id,
            removeReferenceFieldWhenEmpty: referenceFieldWasAbsent,
          },
        },
      };
    }
    case "tracked_object.remove": {
      const trackedObject = project.trackedObjects[operation.targetId];
      if (trackedObject === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Tracked object ${operation.targetId} was not found`,
          404,
        );
      }
      if (
        Object.values(project.masks).some(
          (mask) => mask.trackedObjectId === trackedObject.id,
        )
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Tracked object ${trackedObject.id} is attached to a mask`,
          422,
        );
      }
      const located = requireClipItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.arguments.itemId,
      );
      const currentReferences = located.item.semanticMetadata.trackedObjectIds;
      const references = Array.isArray(currentReferences)
        ? currentReferences.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      const referenceIndex = references.indexOf(trackedObject.id);
      if (referenceIndex < 0) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Clip ${located.item.id} does not reference tracked object ${trackedObject.id}`,
          422,
        );
      }
      references.splice(referenceIndex, 1);
      if (
        references.length === 0 &&
        operation.arguments.removeReferenceFieldWhenEmpty
      ) {
        delete located.item.semanticMetadata.trackedObjectIds;
      } else {
        located.item.semanticMetadata.trackedObjectIds = references;
      }
      delete project.trackedObjects[trackedObject.id];
      return {
        change: makeChange(
          operation,
          [located.item.id, trackedObject.id],
          `Removed tracked object ${trackedObject.name}`,
        ),
        ranges: [trackedObject.range],
        inverse: {
          operationId: createId(),
          type: "video.track_object",
          targetId: located.item.id,
          preconditions: [],
          arguments: {
            sequenceId: located.sequence.id,
            trackId: located.track.id,
            trackedObject,
            referenceIndex,
          },
        },
      };
    }
    case "multicam.create": {
      const group = structuredClone(operation.arguments.group);
      if (entityExists(project, group.id)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Multicam group ${group.id} already exists`,
          422,
        );
      }
      project.multicamGroups[group.id] = group;
      return {
        change: makeChange(
          operation,
          [group.id, ...group.angles.map((angle) => angle.id)],
          `Created multicam group ${group.name}`,
        ),
        ranges: group.angles.map((angle) => angle.sourceRange),
        inverse: {
          operationId: createId(),
          type: "multicam.remove",
          targetId: group.id,
          preconditions: [],
          arguments: {},
        },
      };
    }
    case "multicam.remove": {
      const group = project.multicamGroups[operation.targetId];
      if (group === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Multicam group ${operation.targetId} was not found`,
          404,
        );
      }
      delete project.multicamGroups[group.id];
      return {
        change: makeChange(
          operation,
          [group.id],
          `Removed multicam group ${group.name}`,
        ),
        ranges: group.angles.map((angle) => angle.sourceRange),
        inverse: {
          operationId: createId(),
          type: "multicam.create",
          preconditions: [],
          arguments: { group },
        },
      };
    }
    case "multicam.replace": {
      const previous = project.multicamGroups[operation.targetId];
      if (previous === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Multicam group ${operation.targetId} was not found`,
          404,
        );
      }
      if (operation.arguments.group.id !== operation.targetId) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Replacement multicam group id must match target id",
          422,
        );
      }
      project.multicamGroups[operation.targetId] = structuredClone(
        operation.arguments.group,
      );
      return {
        change: makeChange(
          operation,
          [operation.targetId],
          `Replaced multicam group ${previous.name}`,
        ),
        ranges: [
          ...previous.angles.map((angle) => angle.sourceRange),
          ...operation.arguments.group.angles.map((angle) => angle.sourceRange),
        ],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { group: previous },
        },
      };
    }
    case "multicam.angle.switch": {
      const group = project.multicamGroups[operation.targetId];
      if (group === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Multicam group ${operation.targetId} was not found`,
          404,
        );
      }
      if (
        !group.angles.some((angle) => angle.id === operation.arguments.angleId)
      ) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Multicam angle ${operation.arguments.angleId} was not found`,
          404,
        );
      }
      if (entityExists(project, operation.arguments.keyframeId)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Entity ${operation.arguments.keyframeId} already exists`,
          422,
        );
      }
      const previous = structuredClone(group);
      group.activeAngleAutomation.push({
        id: operation.arguments.keyframeId,
        time: operation.arguments.at,
        value: operation.arguments.angleId,
        interpolation: "hold",
      });
      group.activeAngleAutomation.sort((left, right) =>
        compareTime(left.time, right.time),
      );
      return {
        change: makeChange(
          operation,
          [
            group.id,
            operation.arguments.angleId,
            operation.arguments.keyframeId,
          ],
          `Switched multicam angle in ${group.name}`,
        ),
        ranges: [],
        inverse: {
          operationId: createId(),
          type: "multicam.replace",
          targetId: group.id,
          preconditions: [],
          arguments: { group: previous },
        },
      };
    }
    case "multicam.sync": {
      const group = project.multicamGroups[operation.targetId];
      if (group === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Multicam group ${operation.targetId} was not found`,
          404,
        );
      }
      const angle = group.angles.find(
        (candidate) => candidate.id === operation.arguments.angleId,
      );
      if (angle === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Multicam angle ${operation.arguments.angleId} was not found`,
          404,
        );
      }
      const previous = structuredClone(group);
      angle.syncOffset = operation.arguments.syncOffset;
      group.syncMethod = operation.arguments.syncMethod;
      return {
        change: makeChange(
          operation,
          [group.id, angle.id],
          `Synchronized multicam angle ${angle.name}`,
        ),
        ranges: [angle.sourceRange],
        inverse: {
          operationId: createId(),
          type: "multicam.replace",
          targetId: group.id,
          preconditions: [],
          arguments: { group: previous },
        },
      };
    }
    case "color.exposure.set":
    case "color.contrast.set":
    case "color.saturation.set": {
      const effect = requireColorEffect(project, {
        sequenceId: operation.arguments.sequenceId,
        targetId: operation.targetId,
        effectId: operation.arguments.effectId,
        ...(operation.arguments.trackId === undefined
          ? {}
          : { trackId: operation.arguments.trackId }),
      });
      const parameter =
        operation.type === "color.exposure.set"
          ? "exposureStops"
          : operation.type === "color.contrast.set"
            ? "contrast"
            : "saturation";
      const value =
        operation.type === "color.exposure.set"
          ? operation.arguments.stops
          : operation.type === "color.contrast.set"
            ? operation.arguments.contrast
            : operation.arguments.saturation;
      const hadPrevious = Object.hasOwn(effect.parameters, parameter);
      const previous = effect.parameters[parameter];
      effect.parameters[parameter] = value;
      return {
        change: makeChange(
          operation,
          [operation.targetId, effect.id],
          `Set color ${parameter}`,
        ),
        ranges: effect.range === undefined ? [] : [effect.range],
        inverse: {
          operationId: createId(),
          type: "effect.parameter.set",
          targetId: operation.targetId,
          preconditions: [],
          ...(operation.provenance === undefined
            ? {}
            : { provenance: operation.provenance }),
          arguments: {
            sequenceId: operation.arguments.sequenceId,
            ...(operation.arguments.trackId === undefined
              ? {}
              : { trackId: operation.arguments.trackId }),
            effectId: effect.id,
            parameter,
            value: previous,
            unset: !hadPrevious,
          },
        },
      };
    }
    case "color.white_balance.set":
    case "color.curves.set":
    case "color.lift_gamma_gain.set":
    case "color.lut.apply":
    case "color.lut.remove":
    case "color.ocio_transform.set": {
      const effect = requireColorEffect(project, {
        sequenceId: operation.arguments.sequenceId,
        targetId: operation.targetId,
        effectId: operation.arguments.effectId,
        ...(operation.arguments.trackId === undefined
          ? {}
          : { trackId: operation.arguments.trackId }),
      });
      const previous = structuredClone(effect.parameters);
      if (operation.type === "color.white_balance.set") {
        effect.parameters.whiteBalance = {
          temperatureKelvin: operation.arguments.temperatureKelvin,
          tint: operation.arguments.tint,
        };
      } else if (operation.type === "color.curves.set") {
        const existing =
          typeof effect.parameters.curves === "object" &&
          effect.parameters.curves !== null &&
          !Array.isArray(effect.parameters.curves)
            ? structuredClone(
                effect.parameters.curves as Record<string, unknown>,
              )
            : {};
        effect.parameters.curves = {
          ...existing,
          [operation.arguments.channel]: structuredClone(
            operation.arguments.points,
          ),
        };
      } else if (operation.type === "color.lift_gamma_gain.set") {
        effect.parameters.liftGammaGain = {
          lift: structuredClone(operation.arguments.lift),
          gamma: structuredClone(operation.arguments.gamma),
          gain: structuredClone(operation.arguments.gain),
        };
      } else if (operation.type === "color.lut.apply") {
        effect.parameters.lut = {
          uri: operation.arguments.uri,
          intensity: operation.arguments.intensity,
          interpolation: operation.arguments.interpolation,
        };
      } else if (operation.type === "color.lut.remove") {
        delete effect.parameters.lut;
      } else {
        effect.parameters.ocioTransform = {
          ...(operation.arguments.configUri === undefined
            ? {}
            : { configUri: operation.arguments.configUri }),
          sourceSpace: operation.arguments.sourceSpace,
          destinationSpace: operation.arguments.destinationSpace,
          ...(operation.arguments.display === undefined
            ? {}
            : { display: operation.arguments.display }),
          ...(operation.arguments.view === undefined
            ? {}
            : { view: operation.arguments.view }),
        };
      }
      return {
        change: makeChange(
          operation,
          [operation.targetId, effect.id],
          `Updated normalized color pipeline with ${operation.type}`,
        ),
        ranges: effect.range === undefined ? [] : [effect.range],
        inverse: effectParametersInverse(operation, {
          sequenceId: operation.arguments.sequenceId,
          targetId: operation.targetId,
          effectId: effect.id,
          ...(operation.arguments.trackId === undefined
            ? {}
            : { trackId: operation.arguments.trackId }),
          parameters: previous,
        }),
      };
    }
    case "color.space.set": {
      const sequence = requireSequence(project, operation.targetId);
      const previous = structuredClone(sequence);
      sequence.format.colorSpace = operation.arguments.colorSpace;
      return {
        change: makeChange(
          operation,
          [sequence.id],
          `Set sequence color space to ${operation.arguments.colorSpace}`,
        ),
        ranges: [],
        inverse: sequenceInverse(operation, previous),
      };
    }
    case "color.hdr_metadata.set": {
      const sequence = requireSequence(project, operation.targetId);
      const previous = structuredClone(sequence);
      sequence.metadata.hdr = structuredClone(operation.arguments.metadata);
      return {
        change: makeChange(
          operation,
          [sequence.id],
          "Updated sequence HDR mastering metadata",
        ),
        ranges: [],
        inverse: sequenceInverse(operation, previous),
      };
    }
    case "audio.fade.add":
    case "audio.fade.remove":
    case "audio.normalize":
    case "audio.eq.set":
    case "audio.compress":
    case "audio.limit":
    case "audio.denoise":
    case "audio.duck":
    case "audio.enhance_voice": {
      const effect = requireAudioEffect(project, {
        sequenceId: operation.arguments.sequenceId,
        targetId: operation.targetId,
        effectId: operation.arguments.effectId,
        ...(operation.arguments.trackId === undefined
          ? {}
          : { trackId: operation.arguments.trackId }),
      });
      const previous = structuredClone(effect.parameters);
      if (operation.type === "audio.fade.add") {
        const fades = Array.isArray(effect.parameters.fades)
          ? structuredClone(effect.parameters.fades)
          : [];
        if (
          fades.some(
            (fade) =>
              typeof fade === "object" &&
              fade !== null &&
              "id" in fade &&
              fade.id === operation.arguments.fade.id,
          )
        ) {
          throw new FrameOSError(
            "VALIDATION_ERROR",
            `Audio fade ${operation.arguments.fade.id} already exists`,
            422,
          );
        }
        fades.push(structuredClone(operation.arguments.fade));
        effect.parameters.fades = fades;
      } else if (operation.type === "audio.fade.remove") {
        const fades = Array.isArray(effect.parameters.fades)
          ? structuredClone(effect.parameters.fades)
          : [];
        const index = fades.findIndex(
          (fade) =>
            typeof fade === "object" &&
            fade !== null &&
            "id" in fade &&
            fade.id === operation.arguments.fadeId,
        );
        if (index < 0) {
          throw new FrameOSError(
            "NOT_FOUND",
            `Audio fade ${operation.arguments.fadeId} was not found`,
            404,
          );
        }
        fades.splice(index, 1);
        effect.parameters.fades = fades;
      } else if (operation.type === "audio.normalize") {
        effect.parameters.normalization = {
          targetLufs: operation.arguments.targetLufs,
          truePeakDb: operation.arguments.truePeakDb,
          mode: operation.arguments.mode,
        };
      } else if (operation.type === "audio.eq.set") {
        effect.parameters.eq = {
          bands: structuredClone(operation.arguments.bands),
        };
      } else if (operation.type === "audio.compress") {
        effect.parameters.compressor = {
          thresholdDb: operation.arguments.thresholdDb,
          ratio: operation.arguments.ratio,
          attackMs: operation.arguments.attackMs,
          releaseMs: operation.arguments.releaseMs,
          kneeDb: operation.arguments.kneeDb,
          makeupGainDb: operation.arguments.makeupGainDb,
        };
      } else if (operation.type === "audio.limit") {
        effect.parameters.limiter = {
          ceilingDb: operation.arguments.ceilingDb,
          releaseMs: operation.arguments.releaseMs,
          lookaheadMs: operation.arguments.lookaheadMs,
        };
      } else if (operation.type === "audio.denoise") {
        effect.parameters.denoise = {
          amount: operation.arguments.amount,
          ...(operation.arguments.noiseProfileUri === undefined
            ? {}
            : { noiseProfileUri: operation.arguments.noiseProfileUri }),
        };
      } else if (operation.type === "audio.duck") {
        if (!entityExists(project, operation.arguments.sidechainId)) {
          throw new FrameOSError(
            "NOT_FOUND",
            `Audio ducking sidechain ${operation.arguments.sidechainId} was not found`,
            404,
          );
        }
        effect.parameters.ducking = {
          sidechainId: operation.arguments.sidechainId,
          reductionDb: operation.arguments.reductionDb,
          thresholdDb: operation.arguments.thresholdDb,
          attackMs: operation.arguments.attackMs,
          releaseMs: operation.arguments.releaseMs,
        };
      } else {
        effect.parameters.voiceEnhancement = {
          amount: operation.arguments.amount,
          preserveAmbience: operation.arguments.preserveAmbience,
        };
      }
      return {
        change: makeChange(
          operation,
          [operation.targetId, effect.id],
          `Updated normalized audio pipeline with ${operation.type}`,
        ),
        ranges: effect.range === undefined ? [] : [effect.range],
        inverse: effectParametersInverse(operation, {
          sequenceId: operation.arguments.sequenceId,
          targetId: operation.targetId,
          effectId: effect.id,
          ...(operation.arguments.trackId === undefined
            ? {}
            : { trackId: operation.arguments.trackId }),
          parameters: previous,
        }),
      };
    }
    case "audio.bus.add": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const bus = structuredClone(operation.arguments.bus);
      if (entityExists(project, bus.id)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Entity ${bus.id} already exists`,
          422,
        );
      }
      if (
        bus.outputBusId !== undefined &&
        !sequence.buses.some((candidate) => candidate.id === bus.outputBusId)
      ) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Output bus ${bus.outputBusId} was not found`,
          404,
        );
      }
      const index = operation.arguments.index ?? sequence.buses.length;
      if (index > sequence.buses.length) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Audio bus index is outside the sequence bus list",
          422,
        );
      }
      sequence.buses.splice(index, 0, bus);
      return {
        change: makeChange(
          operation,
          [sequence.id, bus.id],
          `Added audio bus ${bus.name}`,
        ),
        ranges: [],
        inverse: {
          operationId: createId(),
          type: "audio.bus.remove",
          targetId: bus.id,
          preconditions: [],
          arguments: { sequenceId: sequence.id },
        },
      };
    }
    case "audio.bus.remove": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const index = sequence.buses.findIndex(
        (bus) => bus.id === operation.targetId,
      );
      const bus = sequence.buses[index];
      if (bus === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Audio bus ${operation.targetId} was not found`,
          404,
        );
      }
      if (
        sequence.tracks.some((track) => track.busId === bus.id) ||
        sequence.buses.some((candidate) => candidate.outputBusId === bus.id)
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Audio bus ${bus.id} is still referenced`,
          422,
        );
      }
      sequence.buses.splice(index, 1);
      return {
        change: makeChange(
          operation,
          [sequence.id, bus.id],
          `Removed audio bus ${bus.name}`,
        ),
        ranges: [],
        inverse: {
          operationId: createId(),
          type: "audio.bus.add",
          preconditions: [],
          arguments: { sequenceId: sequence.id, bus, index },
        },
      };
    }
    case "audio.bus.route": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const bus = sequence.buses.find(
        (candidate) => candidate.id === operation.targetId,
      );
      if (bus === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Audio bus ${operation.targetId} was not found`,
          404,
        );
      }
      if (
        operation.arguments.outputBusId !== null &&
        !sequence.buses.some(
          (candidate) => candidate.id === operation.arguments.outputBusId,
        )
      ) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Output bus ${operation.arguments.outputBusId} was not found`,
          404,
        );
      }
      if (operation.arguments.outputBusId === bus.id) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "An audio bus cannot route to itself",
          422,
        );
      }
      const previous = bus.outputBusId ?? null;
      if (operation.arguments.outputBusId === null) delete bus.outputBusId;
      else bus.outputBusId = operation.arguments.outputBusId;
      return {
        change: makeChange(
          operation,
          [
            sequence.id,
            bus.id,
            ...(bus.outputBusId === undefined ? [] : [bus.outputBusId]),
          ],
          `Updated route for audio bus ${bus.name}`,
        ),
        ranges: [],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { sequenceId: sequence.id, outputBusId: previous },
        },
      };
    }
    case "audio.gain.set": {
      const located = requireItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      if (
        located.item.type !== "clip" &&
        located.item.type !== "nested_sequence"
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Item ${located.item.id} has no audio properties`,
          422,
        );
      }
      const previous = located.item.audio.gainDb;
      located.item.audio.gainDb = operation.arguments.gainDb;
      return {
        change: makeChange(
          operation,
          [located.item.id],
          `Set audio gain to ${operation.arguments.gainDb} dB`,
        ),
        ranges: [located.item.timelineRange],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { ...operation.arguments, gainDb: previous },
        },
      };
    }
    case "audio.pan.set":
    case "audio.channel_map.set": {
      const located = requireItem(
        project,
        operation.arguments.sequenceId,
        operation.arguments.trackId,
        operation.targetId,
      );
      if (
        located.item.type !== "clip" &&
        located.item.type !== "nested_sequence"
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Item ${located.item.id} has no audio properties`,
          422,
        );
      }
      if (operation.type === "audio.pan.set") {
        const previous = located.item.audio.pan;
        located.item.audio.pan = operation.arguments.pan;
        return {
          change: makeChange(
            operation,
            [located.item.id],
            `Set audio pan on ${located.item.name}`,
          ),
          ranges: [located.item.timelineRange],
          inverse: {
            ...cloneOperation(operation),
            operationId: createId(),
            arguments: { ...operation.arguments, pan: previous },
          },
        };
      }
      const previous = structuredClone(located.item.audio.channelMap);
      located.item.audio.channelMap = structuredClone(
        operation.arguments.channelMap,
      );
      return {
        change: makeChange(
          operation,
          [located.item.id],
          `Set audio channel map on ${located.item.name}`,
        ),
        ranges: [located.item.timelineRange],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { ...operation.arguments, channelMap: previous },
        },
      };
    }
    case "marker.add": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      if (
        sequence.markers.some(
          (marker) => marker.id === operation.arguments.marker.id,
        )
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Marker ${operation.arguments.marker.id} already exists`,
          422,
        );
      }
      const index = operation.arguments.index ?? sequence.markers.length;
      if (index > sequence.markers.length) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Marker index is outside the marker list",
          422,
        );
      }
      sequence.markers.splice(index, 0, operation.arguments.marker);
      return {
        change: makeChange(
          operation,
          [sequence.id, operation.arguments.marker.id],
          `Added marker ${operation.arguments.marker.name}`,
        ),
        ranges: [operation.arguments.marker.range],
        inverse: {
          operationId: createId(),
          type: "marker.remove",
          targetId: operation.arguments.marker.id,
          preconditions: [],
          arguments: { sequenceId: sequence.id },
        },
      };
    }
    case "marker.remove": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const index = sequence.markers.findIndex(
        (marker) => marker.id === operation.targetId,
      );
      if (index < 0) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Marker ${operation.targetId} was not found`,
          404,
        );
      }
      const marker = sequence.markers[index];
      if (marker === undefined) {
        throw new FrameOSError("INTERNAL_ERROR", "Marker lookup failed", 500);
      }
      sequence.markers.splice(index, 1);
      return {
        change: makeChange(
          operation,
          [sequence.id, marker.id],
          `Removed marker ${marker.name}`,
        ),
        ranges: [marker.range],
        inverse: {
          operationId: createId(),
          type: "marker.add",
          preconditions: [],
          arguments: { sequenceId: sequence.id, marker, index },
        },
      };
    }
    case "marker.update": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const index = sequence.markers.findIndex(
        (marker) => marker.id === operation.targetId,
      );
      const previous = sequence.markers[index];
      if (previous === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Marker ${operation.targetId} was not found`,
          404,
        );
      }
      if (operation.arguments.marker.id !== operation.targetId) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Replacement marker id must match target id",
          422,
        );
      }
      sequence.markers[index] = structuredClone(operation.arguments.marker);
      return {
        change: makeChange(
          operation,
          [sequence.id, previous.id],
          `Updated marker ${previous.name}`,
        ),
        ranges: [previous.range, operation.arguments.marker.range],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { sequenceId: sequence.id, marker: previous },
        },
      };
    }
    case "marker.move": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const marker = sequence.markers.find(
        (candidate) => candidate.id === operation.targetId,
      );
      if (marker === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Marker ${operation.targetId} was not found`,
          404,
        );
      }
      const previous = structuredClone(marker.range);
      marker.range = operation.arguments.range;
      return {
        change: makeChange(
          operation,
          [sequence.id, marker.id],
          `Moved marker ${marker.name}`,
        ),
        ranges: [previous, marker.range],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { sequenceId: sequence.id, range: previous },
        },
      };
    }
    case "caption.track.add": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      if (
        sequence.captions.some(
          (track) => track.id === operation.arguments.track.id,
        )
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Caption track ${operation.arguments.track.id} already exists`,
          422,
        );
      }
      const index = operation.arguments.index ?? sequence.captions.length;
      if (index > sequence.captions.length) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Caption-track index is outside the caption list",
          422,
        );
      }
      sequence.captions.splice(index, 0, operation.arguments.track);
      return {
        change: makeChange(
          operation,
          [sequence.id, operation.arguments.track.id],
          `Added caption track ${operation.arguments.track.name}`,
        ),
        ranges: operation.arguments.track.cues.map((cue) => cue.range),
        inverse: {
          operationId: createId(),
          type: "caption.track.remove",
          targetId: operation.arguments.track.id,
          preconditions: [],
          arguments: { sequenceId: sequence.id },
        },
      };
    }
    case "caption.track.remove": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const index = sequence.captions.findIndex(
        (track) => track.id === operation.targetId,
      );
      const track = sequence.captions[index];
      if (track === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Caption track ${operation.targetId} was not found`,
          404,
        );
      }
      sequence.captions.splice(index, 1);
      return {
        change: makeChange(
          operation,
          [sequence.id, track.id],
          `Removed caption track ${track.name}`,
        ),
        ranges: track.cues.map((cue) => cue.range),
        inverse: {
          operationId: createId(),
          type: "caption.track.add",
          preconditions: [],
          arguments: { sequenceId: sequence.id, track, index },
        },
      };
    }
    case "caption.style.set": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const track = sequence.captions.find(
        (candidate) => candidate.id === operation.targetId,
      );
      if (track === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Caption track ${operation.targetId} was not found`,
          404,
        );
      }
      const previous = structuredClone(track.style);
      track.style = structuredClone(operation.arguments.style);
      return {
        change: makeChange(
          operation,
          [sequence.id, track.id],
          `Updated caption style for ${track.name}`,
        ),
        ranges: track.cues.map((cue) => cue.range),
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { sequenceId: sequence.id, style: previous },
        },
      };
    }
    case "caption.cue.add": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const track = sequence.captions.find(
        (candidate) => candidate.id === operation.arguments.captionTrackId,
      );
      if (track === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Caption track ${operation.arguments.captionTrackId} was not found`,
          404,
        );
      }
      if (track.cues.some((cue) => cue.id === operation.arguments.cue.id)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Caption cue ${operation.arguments.cue.id} already exists`,
          422,
        );
      }
      const index = operation.arguments.index ?? track.cues.length;
      if (index > track.cues.length) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Caption cue index is outside the cue list",
          422,
        );
      }
      track.cues.splice(index, 0, operation.arguments.cue);
      return {
        change: makeChange(
          operation,
          [sequence.id, track.id, operation.arguments.cue.id],
          "Added caption cue",
        ),
        ranges: [operation.arguments.cue.range],
        inverse: {
          operationId: createId(),
          type: "caption.cue.remove",
          targetId: operation.arguments.cue.id,
          preconditions: [],
          arguments: { sequenceId: sequence.id, captionTrackId: track.id },
        },
      };
    }
    case "caption.cue.update": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const track = sequence.captions.find(
        (candidate) => candidate.id === operation.arguments.captionTrackId,
      );
      const cue = track?.cues.find(
        (candidate) => candidate.id === operation.targetId,
      );
      if (track === undefined || cue === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Caption cue ${operation.targetId} was not found`,
          404,
        );
      }
      const previous: typeof operation.arguments = {
        sequenceId: sequence.id,
        captionTrackId: track.id,
        text: cue.text,
        range: structuredClone(cue.range),
        style: structuredClone(cue.style),
      };
      if (operation.arguments.text !== undefined)
        cue.text = operation.arguments.text;
      if (operation.arguments.range !== undefined)
        cue.range = operation.arguments.range;
      if (operation.arguments.style !== undefined)
        cue.style = operation.arguments.style;
      return {
        change: makeChange(
          operation,
          [sequence.id, track.id, cue.id],
          "Updated caption cue",
        ),
        ranges: [previous.range as TimeRange, cue.range],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: previous,
        },
      };
    }
    case "caption.cue.remove": {
      const sequence = requireSequence(project, operation.arguments.sequenceId);
      const track = sequence.captions.find(
        (candidate) => candidate.id === operation.arguments.captionTrackId,
      );
      const index =
        track?.cues.findIndex(
          (candidate) => candidate.id === operation.targetId,
        ) ?? -1;
      if (track === undefined || index < 0) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Caption cue ${operation.targetId} was not found`,
          404,
        );
      }
      const cue = track.cues[index];
      if (cue === undefined) {
        throw new FrameOSError(
          "INTERNAL_ERROR",
          "Caption cue lookup failed",
          500,
        );
      }
      track.cues.splice(index, 1);
      return {
        change: makeChange(
          operation,
          [sequence.id, track.id, cue.id],
          "Removed caption cue",
        ),
        ranges: [cue.range],
        inverse: {
          operationId: createId(),
          type: "caption.cue.add",
          preconditions: [],
          arguments: {
            sequenceId: sequence.id,
            captionTrackId: track.id,
            cue,
            index,
          },
        },
      };
    }
    case "analysis.attach": {
      const artifact = operation.arguments.artifact;
      const asset = project.assets[operation.arguments.assetId];
      if (asset === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Asset ${operation.arguments.assetId} was not found`,
          404,
        );
      }
      if (project.analyses[artifact.id] !== undefined) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Analysis ${artifact.id} already exists`,
          422,
        );
      }
      if (asset.hash !== artifact.assetHash) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Analysis artifact does not match a project asset hash",
          422,
        );
      }
      if (asset.analysisRefs.includes(artifact.id)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Asset ${asset.id} already references analysis ${artifact.id}`,
          422,
        );
      }
      const referenceIndex =
        operation.arguments.referenceIndex ?? asset.analysisRefs.length;
      if (referenceIndex > asset.analysisRefs.length) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Analysis reference index is outside the asset reference list",
          422,
        );
      }
      asset.analysisRefs.splice(referenceIndex, 0, artifact.id);
      project.analyses[artifact.id] = structuredClone(artifact);
      return {
        change: makeChange(
          operation,
          [artifact.id],
          `Attached analysis ${artifact.type}`,
        ),
        ranges: artifact.timeRanges,
        inverse: {
          operationId: createId(),
          type: "analysis.remove",
          targetId: artifact.id,
          preconditions: [],
          arguments: { assetId: asset.id },
        },
      };
    }
    case "analysis.remove": {
      const artifact = project.analyses[operation.targetId];
      if (artifact === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Analysis ${operation.targetId} was not found`,
          404,
        );
      }
      const asset = project.assets[operation.arguments.assetId];
      if (asset === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Asset ${operation.arguments.assetId} was not found`,
          404,
        );
      }
      const referenceIndex = asset.analysisRefs.indexOf(artifact.id);
      if (referenceIndex < 0) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Asset ${asset.id} does not reference analysis ${artifact.id}`,
          422,
        );
      }
      asset.analysisRefs.splice(referenceIndex, 1);
      delete project.analyses[operation.targetId];
      return {
        change: makeChange(
          operation,
          [artifact.id],
          `Removed analysis ${artifact.type}`,
        ),
        ranges: artifact.timeRanges,
        inverse: {
          operationId: createId(),
          type: "analysis.attach",
          preconditions: [],
          arguments: { assetId: asset.id, artifact, referenceIndex },
        },
      };
    }
    case "render.profile.add": {
      const profile = operation.arguments.profile;
      if (project.renderProfiles[profile.id] !== undefined) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Render profile ${profile.id} already exists`,
          422,
        );
      }
      project.renderProfiles[profile.id] = structuredClone(profile);
      return {
        change: makeChange(
          operation,
          [profile.id],
          `Added render profile ${profile.name}`,
        ),
        ranges: [],
        inverse: {
          operationId: createId(),
          type: "render.profile.remove",
          targetId: profile.id,
          preconditions: [],
          arguments: {},
        },
      };
    }
    case "render.profile.update": {
      const previous = project.renderProfiles[operation.targetId];
      if (previous === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Render profile ${operation.targetId} was not found`,
          404,
        );
      }
      if (operation.arguments.profile.id !== operation.targetId) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          "Replacement render profile id must match target id",
          422,
        );
      }
      project.renderProfiles[operation.targetId] = structuredClone(
        operation.arguments.profile,
      );
      return {
        change: makeChange(
          operation,
          [operation.targetId],
          `Updated render profile ${previous.name}`,
        ),
        ranges: [],
        inverse: {
          ...cloneOperation(operation),
          operationId: createId(),
          arguments: { profile: previous },
        },
      };
    }
    case "render.profile.remove": {
      const profile = project.renderProfiles[operation.targetId];
      if (profile === undefined) {
        throw new FrameOSError(
          "NOT_FOUND",
          `Render profile ${operation.targetId} was not found`,
          404,
        );
      }
      delete project.renderProfiles[operation.targetId];
      return {
        change: makeChange(
          operation,
          [profile.id],
          `Removed render profile ${profile.name}`,
        ),
        ranges: [],
        inverse: {
          operationId: createId(),
          type: "render.profile.add",
          preconditions: [],
          arguments: { profile },
        },
      };
    }
  }
}

export function executeOperations(
  source: Project,
  operations: Operation[],
): OperationExecution {
  const project = structuredClone(source);
  const changes: Change[] = [];
  const warnings: string[] = [];
  const affectedRanges: TimeRange[] = [];
  const inverseOperations: Operation[] = [];

  for (const operation of operations) {
    const result = applyOne(project, operation);
    changes.push(result.change);
    affectedRanges.push(...result.ranges);
    if (result.inverse !== undefined) {
      inverseOperations.unshift(result.inverse);
    } else {
      warnings.push(
        `${operation.type} does not yet expose an inverse operation; revision restore remains available`,
      );
    }
  }

  return {
    project: validateProject(project),
    changes,
    warnings,
    affectedRanges,
    inverseOperations,
  };
}
