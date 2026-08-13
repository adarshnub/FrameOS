import { z } from "zod";
import {
  analysisArtifactSchema,
  audioBusSchema,
  assetSchema,
  captionCueSchema,
  captionTrackSchema,
  clipSchema,
  effectInstanceSchema,
  entityIdSchema,
  gapSchema,
  itemGroupSchema,
  markerSchema,
  keyframeSchema,
  maskPointSchema,
  maskSchema,
  metadataSchema,
  multicamGroupSchema,
  nestedSequenceSchema,
  projectSettingsSchema,
  renderProfileSchema,
  sequenceFormatSchema,
  sequenceSchema,
  timelineItemSchema,
  titleSchema,
  trackSchema,
  trackedObjectSchema,
  transitionSchema,
  transformSchema,
} from "./project.js";
import {
  rationalRateSchema,
  rationalTimeSchema,
  signedRationalTimeSchema,
  timeRangeSchema,
} from "./time.js";

export const agentProvenanceSchema = z
  .object({
    actorType: z.enum(["human", "agent", "system"]),
    actorId: z.string().min(1).max(512),
    provider: z.string().max(256).optional(),
    model: z.string().max(256).optional(),
    runId: entityIdSchema.optional(),
    reason: z.string().max(16_384).optional(),
  })
  .strict();

export const operationPreconditionSchema = z
  .object({
    kind: z.enum([
      "entity_exists",
      "entity_missing",
      "field_equals",
      "revision_equals",
    ]),
    entityId: entityIdSchema.optional(),
    path: z.string().max(2_048).optional(),
    expected: z.unknown().optional(),
  })
  .strict();

const operationBase = {
  operationId: entityIdSchema,
  targetId: entityIdSchema.optional(),
  preconditions: z.array(operationPreconditionSchema).max(100).default([]),
  provenance: agentProvenanceSchema.optional(),
};

export const projectMetadataSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("project.metadata.set"),
    arguments: z.object({ values: metadataSchema }).strict(),
  })
  .strict();

export const projectMetadataReplaceOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("project.metadata.replace"),
    arguments: z.object({ values: metadataSchema }).strict(),
  })
  .strict();

export const projectSettingsSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("project.settings.set"),
    arguments: z.object({ values: projectSettingsSchema.partial() }).strict(),
  })
  .strict();

export const assetAddOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("asset.add"),
    arguments: z.object({ asset: assetSchema }).strict(),
  })
  .strict();

export const assetRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("asset.remove"),
    targetId: entityIdSchema,
    arguments: z.object({ force: z.boolean().default(false) }).strict(),
  })
  .strict();

export const assetRelinkOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("asset.relink"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        uri: z.string().min(1).max(32_768),
        hash: z.string().min(16).max(256),
      })
      .strict(),
  })
  .strict();

export const assetReplaceOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("asset.replace"),
    targetId: entityIdSchema,
    arguments: z.object({ asset: assetSchema }).strict(),
  })
  .strict();

export const assetMetadataSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("asset.metadata.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({ values: metadataSchema, replace: z.boolean().default(false) })
      .strict(),
  })
  .strict();

export const assetLicenseSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("asset.license.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({ values: metadataSchema, replace: z.boolean().default(false) })
      .strict(),
  })
  .strict();

export const assetOfflineSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("asset.offline.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({ offline: z.boolean(), unset: z.boolean().default(false) })
      .strict(),
  })
  .strict();

export const assetProxyCreateOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("asset.proxy.create"),
    targetId: entityIdSchema,
    arguments: z.object({ uri: z.string().min(1).max(32_768) }).strict(),
  })
  .strict();

export const assetProxyRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("asset.proxy.remove"),
    targetId: entityIdSchema,
    arguments: z.object({ uri: z.string().min(1).max(32_768) }).strict(),
  })
  .strict();

export const sequenceAddOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("sequence.add"),
    arguments: z.object({ sequence: sequenceSchema }).strict(),
  })
  .strict();

export const sequenceRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("sequence.remove"),
    targetId: entityIdSchema,
    arguments: z.object({}).strict(),
  })
  .strict();

export const sequenceFormatSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("sequence.format.set"),
    targetId: entityIdSchema,
    arguments: z.object({ format: sequenceFormatSchema }).strict(),
  })
  .strict();

export const sequenceReplaceOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("sequence.replace"),
    targetId: entityIdSchema,
    arguments: z.object({ sequence: sequenceSchema }).strict(),
  })
  .strict();

export const sequenceDuplicateOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("sequence.duplicate"),
    targetId: entityIdSchema,
    arguments: z.object({ sequence: sequenceSchema }).strict(),
  })
  .strict();

export const sequenceNestOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("sequence.nest"),
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        item: nestedSequenceSchema,
        index: z.int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export const sequenceColorSpaceSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("sequence.color_space.set"),
    targetId: entityIdSchema,
    arguments: z.object({ colorSpace: z.string().min(1).max(256) }).strict(),
  })
  .strict();

export const sequenceAudioLayoutSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("sequence.audio_layout.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sampleRate: z.int().positive().max(768_000),
        channels: z.int().positive().max(128),
      })
      .strict(),
  })
  .strict();

export const trackAddOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("track.add"),
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        track: trackSchema,
        index: z.int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export const trackRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("track.remove"),
    targetId: entityIdSchema,
    arguments: z.object({ sequenceId: entityIdSchema }).strict(),
  })
  .strict();

export const trackUpdateOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("track.update"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        values: z
          .object({
            name: z.string().min(1).max(1_024).optional(),
            order: z.int().min(0).max(10_000).optional(),
            enabled: z.boolean().optional(),
            locked: z.boolean().optional(),
            muted: z.boolean().optional(),
            syncLocked: z.boolean().optional(),
            busId: entityIdSchema.nullable().optional(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const trackItemsReplaceOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("track.items.replace"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        items: z.array(timelineItemSchema).max(100_000),
      })
      .strict(),
  })
  .strict();

export const trackReorderOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("track.reorder"),
    targetId: entityIdSchema,
    arguments: z
      .object({ sequenceId: entityIdSchema, order: z.int().nonnegative() })
      .strict(),
  })
  .strict();

const trackIdentityArgumentsSchema = z
  .object({ sequenceId: entityIdSchema })
  .strict();

export const trackLockOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("track.lock"),
    targetId: entityIdSchema,
    arguments: trackIdentityArgumentsSchema,
  })
  .strict();

export const trackUnlockOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("track.unlock"),
    targetId: entityIdSchema,
    arguments: trackIdentityArgumentsSchema,
  })
  .strict();

export const trackMuteOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("track.mute"),
    targetId: entityIdSchema,
    arguments: trackIdentityArgumentsSchema,
  })
  .strict();

export const trackUnmuteOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("track.unmute"),
    targetId: entityIdSchema,
    arguments: trackIdentityArgumentsSchema,
  })
  .strict();

export const trackEnableOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("track.enable"),
    targetId: entityIdSchema,
    arguments: trackIdentityArgumentsSchema,
  })
  .strict();

export const trackDisableOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("track.disable"),
    targetId: entityIdSchema,
    arguments: trackIdentityArgumentsSchema,
  })
  .strict();

export const trackSyncLockOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("track.sync_lock"),
    targetId: entityIdSchema,
    arguments: z
      .object({ sequenceId: entityIdSchema, enabled: z.boolean() })
      .strict(),
  })
  .strict();

export const trackBusAssignOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("track.bus.assign"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        busId: entityIdSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export const trackEffectAddOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("track.effect.add"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        effect: effectInstanceSchema,
        index: z.int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export const trackEffectRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("track.effect.remove"),
    targetId: entityIdSchema,
    arguments: z
      .object({ sequenceId: entityIdSchema, trackId: entityIdSchema })
      .strict(),
  })
  .strict();

export const itemAddOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("item.add"),
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        item: timelineItemSchema,
        index: z.int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export const itemDeleteOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("item.delete"),
    targetId: entityIdSchema,
    arguments: z
      .object({ sequenceId: entityIdSchema, trackId: entityIdSchema })
      .strict(),
  })
  .strict();

export const itemReplaceOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("item.replace"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        item: timelineItemSchema,
      })
      .strict(),
  })
  .strict();

export const gapAddOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("gap.add"),
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        gap: gapSchema,
        index: z.int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export const gapRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("gap.remove"),
    targetId: entityIdSchema,
    arguments: z
      .object({ sequenceId: entityIdSchema, trackId: entityIdSchema })
      .strict(),
  })
  .strict();

export const titleAddOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("title.add"),
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        title: titleSchema,
        index: z.int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export const titleUpdateOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("title.update"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        title: titleSchema,
      })
      .strict(),
  })
  .strict();

export const titleRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("title.remove"),
    targetId: entityIdSchema,
    arguments: z
      .object({ sequenceId: entityIdSchema, trackId: entityIdSchema })
      .strict(),
  })
  .strict();

export const titleTemplateApplyOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("title.template.apply"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        templateId: z.string().min(1).max(256),
        style: metadataSchema.default({}),
        replaceStyle: z.boolean().default(false),
      })
      .strict(),
  })
  .strict();

export const clipMoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.move"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        fromTrackId: entityIdSchema,
        toTrackId: entityIdSchema,
        timelineStart: rationalTimeSchema,
      })
      .strict(),
  })
  .strict();

export const clipTrimOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.trim"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        sourceRange: timeRangeSchema,
        retimeStartKeyframeId: entityIdSchema.optional(),
        retimeEndKeyframeId: entityIdSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const clipSplitOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.split"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        at: rationalTimeSchema,
        rightClipId: entityIdSchema,
        leftEndKeyframeId: entityIdSchema.optional(),
        rightStartKeyframeId: entityIdSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const clipInsertOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.insert"),
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        clip: clipSchema,
      })
      .strict(),
  })
  .strict();

export const clipOverwriteOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.overwrite"),
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        clip: clipSchema,
        rightRemainderId: entityIdSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const clipAppendOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.append"),
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        clip: clipSchema,
      })
      .strict(),
  })
  .strict();

export const clipDuplicateOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.duplicate"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        newClipId: entityIdSchema,
        timelineStart: rationalTimeSchema,
      })
      .strict(),
  })
  .strict();

export const clipReplaceOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.replace"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        clip: clipSchema,
      })
      .strict(),
  })
  .strict();

export const clipLiftOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.lift"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        gapId: entityIdSchema,
      })
      .strict(),
  })
  .strict();

const clipRemovalArgumentsSchema = z
  .object({ sequenceId: entityIdSchema, trackId: entityIdSchema })
  .strict();

export const clipExtractOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.extract"),
    targetId: entityIdSchema,
    arguments: clipRemovalArgumentsSchema,
  })
  .strict();

export const clipRippleDeleteOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.ripple_delete"),
    targetId: entityIdSchema,
    arguments: clipRemovalArgumentsSchema,
  })
  .strict();

export const clipRollOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.roll"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        rightClipId: entityIdSchema,
        at: rationalTimeSchema,
      })
      .strict(),
  })
  .strict();

export const clipSlipOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.slip"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        sourceStart: rationalTimeSchema,
      })
      .strict(),
  })
  .strict();

export const clipSlideOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.slide"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        timelineStart: rationalTimeSchema,
      })
      .strict(),
  })
  .strict();

const clipLinkArgumentsSchema = z
  .object({
    sequenceId: entityIdSchema,
    trackId: entityIdSchema,
    otherTrackId: entityIdSchema,
    otherClipId: entityIdSchema,
  })
  .strict();

export const clipLinkOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.link"),
    targetId: entityIdSchema,
    arguments: clipLinkArgumentsSchema,
  })
  .strict();

export const clipUnlinkOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.unlink"),
    targetId: entityIdSchema,
    arguments: clipLinkArgumentsSchema,
  })
  .strict();

const timeMapIdentityArguments = {
  sequenceId: entityIdSchema,
  trackId: entityIdSchema,
  startKeyframeId: entityIdSchema,
  endKeyframeId: entityIdSchema,
};

export const clipFreezeFrameOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.freeze_frame"),
    targetId: entityIdSchema,
    arguments: z
      .object({ ...timeMapIdentityArguments, sourceTime: rationalTimeSchema })
      .strict(),
  })
  .strict();

export const clipReverseOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.reverse"),
    targetId: entityIdSchema,
    arguments: z.object(timeMapIdentityArguments).strict(),
  })
  .strict();

export const clipSpeedSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.speed.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({ ...timeMapIdentityArguments, speed: rationalRateSchema })
      .strict(),
  })
  .strict();

export const clipSpeedRampSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.speed_ramp.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        timelineDuration: rationalTimeSchema,
        keyframes: z.array(keyframeSchema).min(2).max(100_000),
      })
      .strict(),
  })
  .strict();

export const clipSnapOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.snap"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        timelineStart: rationalTimeSchema,
      })
      .strict(),
  })
  .strict();

export const clipReorderOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.reorder"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        index: z.int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const clipGroupOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.group"),
    arguments: z.object({ group: itemGroupSchema }).strict(),
  })
  .strict();

export const clipUngroupOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("clip.ungroup"),
    targetId: entityIdSchema,
    arguments: z.object({}).strict(),
  })
  .strict();

export const itemTransformSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("item.transform.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        transform: transformSchema,
      })
      .strict(),
  })
  .strict();

const itemTransformTargetArguments = {
  sequenceId: entityIdSchema,
  trackId: entityIdSchema,
};

export const videoPositionSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("video.position.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...itemTransformTargetArguments,
        x: z.number().finite(),
        y: z.number().finite(),
      })
      .strict(),
  })
  .strict();

export const videoAnchorSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("video.anchor.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...itemTransformTargetArguments,
        x: z.number().finite(),
        y: z.number().finite(),
      })
      .strict(),
  })
  .strict();

export const videoScaleSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("video.scale.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...itemTransformTargetArguments,
        x: z.number().finite().min(-100).max(100),
        y: z.number().finite().min(-100).max(100),
      })
      .strict(),
  })
  .strict();

export const videoCropSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("video.crop.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...itemTransformTargetArguments,
        top: z.number().finite().min(0).max(1),
        right: z.number().finite().min(0).max(1),
        bottom: z.number().finite().min(0).max(1),
        left: z.number().finite().min(0).max(1),
      })
      .strict(),
  })
  .strict();

export const videoRotationSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("video.rotation.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({ ...itemTransformTargetArguments, degrees: z.number().finite() })
      .strict(),
  })
  .strict();

export const videoOpacitySetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("video.opacity.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...itemTransformTargetArguments,
        opacity: z.number().finite().min(0).max(1),
      })
      .strict(),
  })
  .strict();

export const videoBlendModeSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("video.blend_mode.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...itemTransformTargetArguments,
        blendMode: z.string().min(1).max(128),
      })
      .strict(),
  })
  .strict();

export const videoPictureInPictureApplyOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("video.picture_in_picture.apply"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...itemTransformTargetArguments,
        corner: z.enum([
          "top_left",
          "top_right",
          "bottom_left",
          "bottom_right",
        ]),
        scale: z.number().finite().min(0.05).max(1).default(0.33),
        marginPixels: z.int().nonnegative().max(65_535).default(32),
        opacity: z.number().finite().min(0).max(1).optional(),
      })
      .strict(),
  })
  .strict();

export const transitionAddOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("transition.add"),
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        transition: transitionSchema,
        index: z.int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export const transitionRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("transition.remove"),
    targetId: entityIdSchema,
    arguments: z
      .object({ sequenceId: entityIdSchema, trackId: entityIdSchema })
      .strict(),
  })
  .strict();

export const transitionDurationSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("transition.duration.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        duration: rationalTimeSchema,
      })
      .strict(),
  })
  .strict();

export const transitionParameterSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("transition.parameter.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        parameter: z.string().min(1).max(256),
        value: z.unknown().optional(),
        unset: z.boolean().default(false),
      })
      .strict(),
  })
  .strict();

const transitionKeyframeTargetArguments = {
  sequenceId: entityIdSchema,
  trackId: entityIdSchema,
  curveId: entityIdSchema,
};

export const transitionKeyframeAddOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("transition.keyframe.add"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...transitionKeyframeTargetArguments,
        keyframe: keyframeSchema,
      })
      .strict(),
  })
  .strict();

export const transitionKeyframeRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("transition.keyframe.remove"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...transitionKeyframeTargetArguments,
        keyframeId: entityIdSchema,
      })
      .strict(),
  })
  .strict();

export const effectAddOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("effect.add"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema.optional(),
        effect: effectInstanceSchema,
        index: z.int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export const effectRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("effect.remove"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema.optional(),
        effectId: entityIdSchema,
      })
      .strict(),
  })
  .strict();

export const effectParameterSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("effect.parameter.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema.optional(),
        effectId: entityIdSchema,
        parameter: z.string().min(1).max(256),
        value: z.unknown().optional(),
        unset: z.boolean().default(false),
      })
      .strict(),
  })
  .strict();

const effectTargetArguments = {
  sequenceId: entityIdSchema,
  trackId: entityIdSchema.optional(),
  effectId: entityIdSchema,
};

export const effectEnableOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("effect.enable"),
    targetId: entityIdSchema,
    arguments: z.object(effectTargetArguments).strict(),
  })
  .strict();

export const effectDisableOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("effect.disable"),
    targetId: entityIdSchema,
    arguments: z.object(effectTargetArguments).strict(),
  })
  .strict();

export const effectReorderOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("effect.reorder"),
    targetId: entityIdSchema,
    arguments: z
      .object({ ...effectTargetArguments, index: z.int().nonnegative() })
      .strict(),
  })
  .strict();

export const effectRangeSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("effect.range.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({ ...effectTargetArguments, range: timeRangeSchema.nullable() })
      .strict(),
  })
  .strict();

export const effectPresetApplyOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("effect.preset.apply"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...effectTargetArguments,
        parameters: metadataSchema,
        replace: z.boolean().default(true),
      })
      .strict(),
  })
  .strict();

const keyframeTargetArguments = {
  ...effectTargetArguments,
  curveId: entityIdSchema,
};

export const keyframeAddOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("keyframe.add"),
    targetId: entityIdSchema,
    arguments: z
      .object({ ...keyframeTargetArguments, keyframe: keyframeSchema })
      .strict(),
  })
  .strict();

export const keyframeRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("keyframe.remove"),
    targetId: entityIdSchema,
    arguments: z
      .object({ ...keyframeTargetArguments, keyframeId: entityIdSchema })
      .strict(),
  })
  .strict();

export const keyframeMoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("keyframe.move"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...keyframeTargetArguments,
        keyframeId: entityIdSchema,
        time: rationalTimeSchema,
      })
      .strict(),
  })
  .strict();

export const keyframeValueSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("keyframe.value.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...keyframeTargetArguments,
        keyframeId: entityIdSchema,
        value: keyframeSchema.shape.value,
      })
      .strict(),
  })
  .strict();

export const keyframeInterpolationSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("keyframe.interpolation.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...keyframeTargetArguments,
        keyframeId: entityIdSchema,
        interpolation: keyframeSchema.shape.interpolation,
      })
      .strict(),
  })
  .strict();

export const maskAddOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("mask.add"),
    arguments: z.object({ mask: maskSchema }).strict(),
  })
  .strict();

export const maskRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("mask.remove"),
    targetId: entityIdSchema,
    arguments: z.object({}).strict(),
  })
  .strict();

export const maskPathSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("mask.path.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({ points: z.array(maskPointSchema).min(1).max(100_000) })
      .strict(),
  })
  .strict();

export const maskFeatherSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("mask.feather.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({ feather: z.number().finite().nonnegative() })
      .strict(),
  })
  .strict();

export const maskInvertSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("mask.invert.set"),
    targetId: entityIdSchema,
    arguments: z.object({ inverted: z.boolean() }).strict(),
  })
  .strict();

export const maskTrackAttachOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("mask.track.attach"),
    targetId: entityIdSchema,
    arguments: z
      .object({ trackedObjectId: entityIdSchema.nullable() })
      .strict(),
  })
  .strict();

export const effectMaskAttachOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("effect.mask.attach"),
    targetId: entityIdSchema,
    arguments: z
      .object({ ...effectTargetArguments, maskId: entityIdSchema })
      .strict(),
  })
  .strict();

export const effectMaskDetachOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("effect.mask.detach"),
    targetId: entityIdSchema,
    arguments: z.object(effectTargetArguments).strict(),
  })
  .strict();

export const videoTrackObjectOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("video.track_object"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        trackedObject: trackedObjectSchema,
        referenceIndex: z.int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export const trackedObjectRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("tracked_object.remove"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        itemId: entityIdSchema,
        removeReferenceFieldWhenEmpty: z.boolean().default(false),
      })
      .strict(),
  })
  .strict();

export const multicamCreateOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("multicam.create"),
    arguments: z.object({ group: multicamGroupSchema }).strict(),
  })
  .strict();

export const multicamRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("multicam.remove"),
    targetId: entityIdSchema,
    arguments: z.object({}).strict(),
  })
  .strict();

export const multicamReplaceOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("multicam.replace"),
    targetId: entityIdSchema,
    arguments: z.object({ group: multicamGroupSchema }).strict(),
  })
  .strict();

export const multicamAngleSwitchOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("multicam.angle.switch"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        angleId: entityIdSchema,
        at: rationalTimeSchema,
        keyframeId: entityIdSchema,
      })
      .strict(),
  })
  .strict();

export const multicamSyncOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("multicam.sync"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        angleId: entityIdSchema,
        syncOffset: signedRationalTimeSchema,
        syncMethod: z.enum(["timecode", "audio", "marker", "manual"]),
      })
      .strict(),
  })
  .strict();

const colorEffectTargetArguments = {
  sequenceId: entityIdSchema,
  trackId: entityIdSchema.optional(),
  effectId: entityIdSchema,
};

export const colorExposureSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("color.exposure.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...colorEffectTargetArguments,
        stops: z.number().finite().min(-20).max(20),
      })
      .strict(),
  })
  .strict();

export const colorContrastSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("color.contrast.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...colorEffectTargetArguments,
        contrast: z.number().finite().min(0).max(4),
      })
      .strict(),
  })
  .strict();

export const colorSaturationSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("color.saturation.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...colorEffectTargetArguments,
        saturation: z.number().finite().min(0).max(4),
      })
      .strict(),
  })
  .strict();

export const colorWhiteBalanceSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("color.white_balance.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...colorEffectTargetArguments,
        temperatureKelvin: z.number().finite().min(1_000).max(40_000),
        tint: z.number().finite().min(-2).max(2),
      })
      .strict(),
  })
  .strict();

const colorCurvePointSchema = z
  .object({
    input: z.number().finite().min(0).max(1),
    output: z.number().finite().min(0).max(1),
  })
  .strict();

export const colorCurvesSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("color.curves.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...colorEffectTargetArguments,
        channel: z.enum(["rgb", "red", "green", "blue", "luma"]),
        points: z.array(colorCurvePointSchema).min(2).max(256),
      })
      .strict(),
  })
  .strict();

const colorTripletSchema = z.tuple([
  z.number().finite().min(-16).max(16),
  z.number().finite().min(-16).max(16),
  z.number().finite().min(-16).max(16),
]);

export const colorLiftGammaGainSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("color.lift_gamma_gain.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...colorEffectTargetArguments,
        lift: colorTripletSchema,
        gamma: colorTripletSchema,
        gain: colorTripletSchema,
      })
      .strict(),
  })
  .strict();

export const colorLutApplyOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("color.lut.apply"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...colorEffectTargetArguments,
        uri: z.string().min(1).max(8_192),
        intensity: z.number().finite().min(0).max(1).default(1),
        interpolation: z
          .enum(["trilinear", "tetrahedral"])
          .default("tetrahedral"),
      })
      .strict(),
  })
  .strict();

export const colorLutRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("color.lut.remove"),
    targetId: entityIdSchema,
    arguments: z.object(colorEffectTargetArguments).strict(),
  })
  .strict();

export const colorSpaceSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("color.space.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        colorSpace: z.string().min(1).max(256),
      })
      .strict(),
  })
  .strict();

export const colorHdrMetadataSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("color.hdr_metadata.set"),
    targetId: entityIdSchema,
    arguments: z.object({ metadata: metadataSchema }).strict(),
  })
  .strict();

export const colorOcioTransformSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("color.ocio_transform.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...colorEffectTargetArguments,
        configUri: z.string().min(1).max(8_192).optional(),
        sourceSpace: z.string().min(1).max(256),
        destinationSpace: z.string().min(1).max(256),
        display: z.string().min(1).max(256).optional(),
        view: z.string().min(1).max(256).optional(),
      })
      .strict(),
  })
  .strict();

export const audioGainSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("audio.gain.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        gainDb: z.number().finite().min(-120).max(48),
      })
      .strict(),
  })
  .strict();

export const audioPanSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("audio.pan.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        pan: z.number().finite().min(-1).max(1),
      })
      .strict(),
  })
  .strict();

export const audioChannelMapSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("audio.channel_map.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        trackId: entityIdSchema,
        channelMap: z.array(z.int().nonnegative()).max(128),
      })
      .strict(),
  })
  .strict();

const audioEffectTargetArguments = {
  sequenceId: entityIdSchema,
  trackId: entityIdSchema.optional(),
  effectId: entityIdSchema,
};

export const audioFadeAddOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("audio.fade.add"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...audioEffectTargetArguments,
        fade: z
          .object({
            id: entityIdSchema,
            kind: z.enum(["in", "out"]),
            duration: rationalTimeSchema,
            curve: z.enum(["linear", "equal_power", "s_curve", "logarithmic"]),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const audioFadeRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("audio.fade.remove"),
    targetId: entityIdSchema,
    arguments: z
      .object({ ...audioEffectTargetArguments, fadeId: entityIdSchema })
      .strict(),
  })
  .strict();

export const audioNormalizeOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("audio.normalize"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...audioEffectTargetArguments,
        targetLufs: z.number().finite().min(-36).max(-5),
        truePeakDb: z.number().finite().min(-12).max(0),
        mode: z.enum(["integrated", "dialogue", "peak"]).default("integrated"),
      })
      .strict(),
  })
  .strict();

const eqBandSchema = z
  .object({
    id: entityIdSchema,
    kind: z.enum(["low_cut", "low_shelf", "bell", "high_shelf", "high_cut"]),
    frequencyHz: z.number().finite().min(10).max(48_000),
    gainDb: z.number().finite().min(-36).max(36).default(0),
    q: z.number().finite().min(0.05).max(40).default(0.707),
    enabled: z.boolean().default(true),
  })
  .strict();

export const audioEqSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("audio.eq.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...audioEffectTargetArguments,
        bands: z.array(eqBandSchema).max(64),
      })
      .strict(),
  })
  .strict();

export const audioCompressOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("audio.compress"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...audioEffectTargetArguments,
        thresholdDb: z.number().finite().min(-120).max(0),
        ratio: z.number().finite().min(1).max(100),
        attackMs: z.number().finite().min(0.01).max(10_000),
        releaseMs: z.number().finite().min(1).max(60_000),
        kneeDb: z.number().finite().min(0).max(48).default(6),
        makeupGainDb: z.number().finite().min(-24).max(48).default(0),
      })
      .strict(),
  })
  .strict();

export const audioLimitOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("audio.limit"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...audioEffectTargetArguments,
        ceilingDb: z.number().finite().min(-24).max(0),
        releaseMs: z.number().finite().min(1).max(60_000),
        lookaheadMs: z.number().finite().min(0).max(1_000).default(5),
      })
      .strict(),
  })
  .strict();

export const audioDenoiseOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("audio.denoise"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...audioEffectTargetArguments,
        amount: z.number().finite().min(0).max(1),
        noiseProfileUri: z.string().min(1).max(8_192).optional(),
      })
      .strict(),
  })
  .strict();

export const audioDuckOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("audio.duck"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...audioEffectTargetArguments,
        sidechainId: entityIdSchema,
        reductionDb: z.number().finite().min(0).max(60),
        thresholdDb: z.number().finite().min(-120).max(0),
        attackMs: z.number().finite().min(0.01).max(10_000),
        releaseMs: z.number().finite().min(1).max(60_000),
      })
      .strict(),
  })
  .strict();

export const audioEnhanceVoiceOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("audio.enhance_voice"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        ...audioEffectTargetArguments,
        amount: z.number().finite().min(0).max(1),
        preserveAmbience: z.boolean().default(true),
      })
      .strict(),
  })
  .strict();

export const audioBusAddOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("audio.bus.add"),
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        bus: audioBusSchema,
        index: z.int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export const audioBusRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("audio.bus.remove"),
    targetId: entityIdSchema,
    arguments: z.object({ sequenceId: entityIdSchema }).strict(),
  })
  .strict();

export const audioBusRouteOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("audio.bus.route"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        outputBusId: entityIdSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export const markerAddOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("marker.add"),
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        marker: markerSchema,
        index: z.int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export const markerRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("marker.remove"),
    targetId: entityIdSchema,
    arguments: z.object({ sequenceId: entityIdSchema }).strict(),
  })
  .strict();

export const markerUpdateOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("marker.update"),
    targetId: entityIdSchema,
    arguments: z
      .object({ sequenceId: entityIdSchema, marker: markerSchema })
      .strict(),
  })
  .strict();

export const markerMoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("marker.move"),
    targetId: entityIdSchema,
    arguments: z
      .object({ sequenceId: entityIdSchema, range: timeRangeSchema })
      .strict(),
  })
  .strict();

export const captionTrackAddOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("caption.track.add"),
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        track: captionTrackSchema,
        index: z.int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export const captionTrackRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("caption.track.remove"),
    targetId: entityIdSchema,
    arguments: z.object({ sequenceId: entityIdSchema }).strict(),
  })
  .strict();

export const captionStyleSetOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("caption.style.set"),
    targetId: entityIdSchema,
    arguments: z
      .object({ sequenceId: entityIdSchema, style: metadataSchema })
      .strict(),
  })
  .strict();

export const captionCueAddOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("caption.cue.add"),
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        captionTrackId: entityIdSchema,
        cue: captionCueSchema,
        index: z.int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export const captionCueUpdateOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("caption.cue.update"),
    targetId: entityIdSchema,
    arguments: z
      .object({
        sequenceId: entityIdSchema,
        captionTrackId: entityIdSchema,
        text: z.string().max(100_000).optional(),
        range: timeRangeSchema.optional(),
        style: metadataSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const captionCueRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("caption.cue.remove"),
    targetId: entityIdSchema,
    arguments: z
      .object({ sequenceId: entityIdSchema, captionTrackId: entityIdSchema })
      .strict(),
  })
  .strict();

export const analysisAttachOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("analysis.attach"),
    arguments: z
      .object({
        assetId: entityIdSchema,
        artifact: analysisArtifactSchema,
        referenceIndex: z.int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

export const analysisRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("analysis.remove"),
    targetId: entityIdSchema,
    arguments: z.object({ assetId: entityIdSchema }).strict(),
  })
  .strict();

export const renderProfileAddOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("render.profile.add"),
    arguments: z.object({ profile: renderProfileSchema }).strict(),
  })
  .strict();

export const renderProfileUpdateOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("render.profile.update"),
    targetId: entityIdSchema,
    arguments: z.object({ profile: renderProfileSchema }).strict(),
  })
  .strict();

export const renderProfileRemoveOperationSchema = z
  .object({
    ...operationBase,
    type: z.literal("render.profile.remove"),
    targetId: entityIdSchema,
    arguments: z.object({}).strict(),
  })
  .strict();

export const operationSchema = z.discriminatedUnion("type", [
  projectMetadataSetOperationSchema,
  projectMetadataReplaceOperationSchema,
  projectSettingsSetOperationSchema,
  assetAddOperationSchema,
  assetRemoveOperationSchema,
  assetRelinkOperationSchema,
  assetReplaceOperationSchema,
  assetMetadataSetOperationSchema,
  assetLicenseSetOperationSchema,
  assetOfflineSetOperationSchema,
  assetProxyCreateOperationSchema,
  assetProxyRemoveOperationSchema,
  sequenceAddOperationSchema,
  sequenceRemoveOperationSchema,
  sequenceFormatSetOperationSchema,
  sequenceReplaceOperationSchema,
  sequenceDuplicateOperationSchema,
  sequenceNestOperationSchema,
  sequenceColorSpaceSetOperationSchema,
  sequenceAudioLayoutSetOperationSchema,
  trackAddOperationSchema,
  trackRemoveOperationSchema,
  trackUpdateOperationSchema,
  trackItemsReplaceOperationSchema,
  trackReorderOperationSchema,
  trackLockOperationSchema,
  trackUnlockOperationSchema,
  trackMuteOperationSchema,
  trackUnmuteOperationSchema,
  trackEnableOperationSchema,
  trackDisableOperationSchema,
  trackSyncLockOperationSchema,
  trackBusAssignOperationSchema,
  trackEffectAddOperationSchema,
  trackEffectRemoveOperationSchema,
  itemAddOperationSchema,
  itemDeleteOperationSchema,
  itemReplaceOperationSchema,
  gapAddOperationSchema,
  gapRemoveOperationSchema,
  titleAddOperationSchema,
  titleUpdateOperationSchema,
  titleRemoveOperationSchema,
  titleTemplateApplyOperationSchema,
  clipMoveOperationSchema,
  clipTrimOperationSchema,
  clipSplitOperationSchema,
  clipInsertOperationSchema,
  clipOverwriteOperationSchema,
  clipAppendOperationSchema,
  clipDuplicateOperationSchema,
  clipReplaceOperationSchema,
  clipLiftOperationSchema,
  clipExtractOperationSchema,
  clipRippleDeleteOperationSchema,
  clipRollOperationSchema,
  clipSlipOperationSchema,
  clipSlideOperationSchema,
  clipLinkOperationSchema,
  clipUnlinkOperationSchema,
  clipFreezeFrameOperationSchema,
  clipReverseOperationSchema,
  clipSpeedSetOperationSchema,
  clipSpeedRampSetOperationSchema,
  clipSnapOperationSchema,
  clipReorderOperationSchema,
  clipGroupOperationSchema,
  clipUngroupOperationSchema,
  itemTransformSetOperationSchema,
  videoPositionSetOperationSchema,
  videoAnchorSetOperationSchema,
  videoScaleSetOperationSchema,
  videoCropSetOperationSchema,
  videoRotationSetOperationSchema,
  videoOpacitySetOperationSchema,
  videoBlendModeSetOperationSchema,
  videoPictureInPictureApplyOperationSchema,
  transitionAddOperationSchema,
  transitionRemoveOperationSchema,
  transitionDurationSetOperationSchema,
  transitionParameterSetOperationSchema,
  transitionKeyframeAddOperationSchema,
  transitionKeyframeRemoveOperationSchema,
  effectAddOperationSchema,
  effectRemoveOperationSchema,
  effectParameterSetOperationSchema,
  effectEnableOperationSchema,
  effectDisableOperationSchema,
  effectReorderOperationSchema,
  effectRangeSetOperationSchema,
  effectPresetApplyOperationSchema,
  keyframeAddOperationSchema,
  keyframeRemoveOperationSchema,
  keyframeMoveOperationSchema,
  keyframeValueSetOperationSchema,
  keyframeInterpolationSetOperationSchema,
  maskAddOperationSchema,
  maskRemoveOperationSchema,
  maskPathSetOperationSchema,
  maskFeatherSetOperationSchema,
  maskInvertSetOperationSchema,
  maskTrackAttachOperationSchema,
  effectMaskAttachOperationSchema,
  effectMaskDetachOperationSchema,
  videoTrackObjectOperationSchema,
  trackedObjectRemoveOperationSchema,
  multicamCreateOperationSchema,
  multicamRemoveOperationSchema,
  multicamReplaceOperationSchema,
  multicamAngleSwitchOperationSchema,
  multicamSyncOperationSchema,
  colorExposureSetOperationSchema,
  colorContrastSetOperationSchema,
  colorSaturationSetOperationSchema,
  colorWhiteBalanceSetOperationSchema,
  colorCurvesSetOperationSchema,
  colorLiftGammaGainSetOperationSchema,
  colorLutApplyOperationSchema,
  colorLutRemoveOperationSchema,
  colorSpaceSetOperationSchema,
  colorHdrMetadataSetOperationSchema,
  colorOcioTransformSetOperationSchema,
  audioGainSetOperationSchema,
  audioPanSetOperationSchema,
  audioChannelMapSetOperationSchema,
  audioFadeAddOperationSchema,
  audioFadeRemoveOperationSchema,
  audioNormalizeOperationSchema,
  audioEqSetOperationSchema,
  audioCompressOperationSchema,
  audioLimitOperationSchema,
  audioDenoiseOperationSchema,
  audioDuckOperationSchema,
  audioEnhanceVoiceOperationSchema,
  audioBusAddOperationSchema,
  audioBusRemoveOperationSchema,
  audioBusRouteOperationSchema,
  markerAddOperationSchema,
  markerRemoveOperationSchema,
  markerUpdateOperationSchema,
  markerMoveOperationSchema,
  captionTrackAddOperationSchema,
  captionTrackRemoveOperationSchema,
  captionStyleSetOperationSchema,
  captionCueAddOperationSchema,
  captionCueUpdateOperationSchema,
  captionCueRemoveOperationSchema,
  analysisAttachOperationSchema,
  analysisRemoveOperationSchema,
  renderProfileAddOperationSchema,
  renderProfileUpdateOperationSchema,
  renderProfileRemoveOperationSchema,
]);

export const executableOperationSchemas = {
  "project.metadata.set": projectMetadataSetOperationSchema,
  "project.metadata.replace": projectMetadataReplaceOperationSchema,
  "project.settings.set": projectSettingsSetOperationSchema,
  "asset.add": assetAddOperationSchema,
  "asset.remove": assetRemoveOperationSchema,
  "asset.relink": assetRelinkOperationSchema,
  "asset.replace": assetReplaceOperationSchema,
  "asset.metadata.set": assetMetadataSetOperationSchema,
  "asset.license.set": assetLicenseSetOperationSchema,
  "asset.offline.set": assetOfflineSetOperationSchema,
  "asset.proxy.create": assetProxyCreateOperationSchema,
  "asset.proxy.remove": assetProxyRemoveOperationSchema,
  "sequence.add": sequenceAddOperationSchema,
  "sequence.remove": sequenceRemoveOperationSchema,
  "sequence.format.set": sequenceFormatSetOperationSchema,
  "sequence.replace": sequenceReplaceOperationSchema,
  "sequence.duplicate": sequenceDuplicateOperationSchema,
  "sequence.nest": sequenceNestOperationSchema,
  "sequence.color_space.set": sequenceColorSpaceSetOperationSchema,
  "sequence.audio_layout.set": sequenceAudioLayoutSetOperationSchema,
  "track.add": trackAddOperationSchema,
  "track.remove": trackRemoveOperationSchema,
  "track.update": trackUpdateOperationSchema,
  "track.items.replace": trackItemsReplaceOperationSchema,
  "track.reorder": trackReorderOperationSchema,
  "track.lock": trackLockOperationSchema,
  "track.unlock": trackUnlockOperationSchema,
  "track.mute": trackMuteOperationSchema,
  "track.unmute": trackUnmuteOperationSchema,
  "track.enable": trackEnableOperationSchema,
  "track.disable": trackDisableOperationSchema,
  "track.sync_lock": trackSyncLockOperationSchema,
  "track.bus.assign": trackBusAssignOperationSchema,
  "track.effect.add": trackEffectAddOperationSchema,
  "track.effect.remove": trackEffectRemoveOperationSchema,
  "item.add": itemAddOperationSchema,
  "item.delete": itemDeleteOperationSchema,
  "item.replace": itemReplaceOperationSchema,
  "gap.add": gapAddOperationSchema,
  "gap.remove": gapRemoveOperationSchema,
  "title.add": titleAddOperationSchema,
  "title.update": titleUpdateOperationSchema,
  "title.remove": titleRemoveOperationSchema,
  "title.template.apply": titleTemplateApplyOperationSchema,
  "clip.move": clipMoveOperationSchema,
  "clip.trim": clipTrimOperationSchema,
  "clip.split": clipSplitOperationSchema,
  "clip.insert": clipInsertOperationSchema,
  "clip.overwrite": clipOverwriteOperationSchema,
  "clip.append": clipAppendOperationSchema,
  "clip.duplicate": clipDuplicateOperationSchema,
  "clip.replace": clipReplaceOperationSchema,
  "clip.lift": clipLiftOperationSchema,
  "clip.extract": clipExtractOperationSchema,
  "clip.ripple_delete": clipRippleDeleteOperationSchema,
  "clip.roll": clipRollOperationSchema,
  "clip.slip": clipSlipOperationSchema,
  "clip.slide": clipSlideOperationSchema,
  "clip.link": clipLinkOperationSchema,
  "clip.unlink": clipUnlinkOperationSchema,
  "clip.freeze_frame": clipFreezeFrameOperationSchema,
  "clip.reverse": clipReverseOperationSchema,
  "clip.speed.set": clipSpeedSetOperationSchema,
  "clip.speed_ramp.set": clipSpeedRampSetOperationSchema,
  "clip.snap": clipSnapOperationSchema,
  "clip.reorder": clipReorderOperationSchema,
  "clip.group": clipGroupOperationSchema,
  "clip.ungroup": clipUngroupOperationSchema,
  "item.transform.set": itemTransformSetOperationSchema,
  "video.position.set": videoPositionSetOperationSchema,
  "video.anchor.set": videoAnchorSetOperationSchema,
  "video.scale.set": videoScaleSetOperationSchema,
  "video.crop.set": videoCropSetOperationSchema,
  "video.rotation.set": videoRotationSetOperationSchema,
  "video.opacity.set": videoOpacitySetOperationSchema,
  "video.blend_mode.set": videoBlendModeSetOperationSchema,
  "video.picture_in_picture.apply": videoPictureInPictureApplyOperationSchema,
  "transition.add": transitionAddOperationSchema,
  "transition.remove": transitionRemoveOperationSchema,
  "transition.duration.set": transitionDurationSetOperationSchema,
  "transition.parameter.set": transitionParameterSetOperationSchema,
  "transition.keyframe.add": transitionKeyframeAddOperationSchema,
  "transition.keyframe.remove": transitionKeyframeRemoveOperationSchema,
  "effect.add": effectAddOperationSchema,
  "effect.remove": effectRemoveOperationSchema,
  "effect.parameter.set": effectParameterSetOperationSchema,
  "effect.enable": effectEnableOperationSchema,
  "effect.disable": effectDisableOperationSchema,
  "effect.reorder": effectReorderOperationSchema,
  "effect.range.set": effectRangeSetOperationSchema,
  "effect.preset.apply": effectPresetApplyOperationSchema,
  "keyframe.add": keyframeAddOperationSchema,
  "keyframe.remove": keyframeRemoveOperationSchema,
  "keyframe.move": keyframeMoveOperationSchema,
  "keyframe.value.set": keyframeValueSetOperationSchema,
  "keyframe.interpolation.set": keyframeInterpolationSetOperationSchema,
  "mask.add": maskAddOperationSchema,
  "mask.remove": maskRemoveOperationSchema,
  "mask.path.set": maskPathSetOperationSchema,
  "mask.feather.set": maskFeatherSetOperationSchema,
  "mask.invert.set": maskInvertSetOperationSchema,
  "mask.track.attach": maskTrackAttachOperationSchema,
  "effect.mask.attach": effectMaskAttachOperationSchema,
  "effect.mask.detach": effectMaskDetachOperationSchema,
  "video.track_object": videoTrackObjectOperationSchema,
  "tracked_object.remove": trackedObjectRemoveOperationSchema,
  "multicam.create": multicamCreateOperationSchema,
  "multicam.remove": multicamRemoveOperationSchema,
  "multicam.replace": multicamReplaceOperationSchema,
  "multicam.angle.switch": multicamAngleSwitchOperationSchema,
  "multicam.sync": multicamSyncOperationSchema,
  "color.exposure.set": colorExposureSetOperationSchema,
  "color.contrast.set": colorContrastSetOperationSchema,
  "color.saturation.set": colorSaturationSetOperationSchema,
  "color.white_balance.set": colorWhiteBalanceSetOperationSchema,
  "color.curves.set": colorCurvesSetOperationSchema,
  "color.lift_gamma_gain.set": colorLiftGammaGainSetOperationSchema,
  "color.lut.apply": colorLutApplyOperationSchema,
  "color.lut.remove": colorLutRemoveOperationSchema,
  "color.space.set": colorSpaceSetOperationSchema,
  "color.hdr_metadata.set": colorHdrMetadataSetOperationSchema,
  "color.ocio_transform.set": colorOcioTransformSetOperationSchema,
  "audio.gain.set": audioGainSetOperationSchema,
  "audio.pan.set": audioPanSetOperationSchema,
  "audio.channel_map.set": audioChannelMapSetOperationSchema,
  "audio.fade.add": audioFadeAddOperationSchema,
  "audio.fade.remove": audioFadeRemoveOperationSchema,
  "audio.normalize": audioNormalizeOperationSchema,
  "audio.eq.set": audioEqSetOperationSchema,
  "audio.compress": audioCompressOperationSchema,
  "audio.limit": audioLimitOperationSchema,
  "audio.denoise": audioDenoiseOperationSchema,
  "audio.duck": audioDuckOperationSchema,
  "audio.enhance_voice": audioEnhanceVoiceOperationSchema,
  "audio.bus.add": audioBusAddOperationSchema,
  "audio.bus.remove": audioBusRemoveOperationSchema,
  "audio.bus.route": audioBusRouteOperationSchema,
  "marker.add": markerAddOperationSchema,
  "marker.remove": markerRemoveOperationSchema,
  "marker.update": markerUpdateOperationSchema,
  "marker.move": markerMoveOperationSchema,
  "caption.track.add": captionTrackAddOperationSchema,
  "caption.track.remove": captionTrackRemoveOperationSchema,
  "caption.style.set": captionStyleSetOperationSchema,
  "caption.cue.add": captionCueAddOperationSchema,
  "caption.cue.update": captionCueUpdateOperationSchema,
  "caption.cue.remove": captionCueRemoveOperationSchema,
  "analysis.attach": analysisAttachOperationSchema,
  "analysis.remove": analysisRemoveOperationSchema,
  "render.profile.add": renderProfileAddOperationSchema,
  "render.profile.update": renderProfileUpdateOperationSchema,
  "render.profile.remove": renderProfileRemoveOperationSchema,
} as const;

export const transactionModeSchema = z.enum(["validate", "preview", "commit"]);

export const transactionRequestSchema = z
  .object({
    projectId: entityIdSchema,
    baseRevision: z.int().nonnegative(),
    idempotencyKey: z.string().min(8).max(512),
    mode: transactionModeSchema,
    operations: z.array(operationSchema).min(1).max(200),
  })
  .strict();

export const changeSchema = z
  .object({
    operationId: entityIdSchema,
    operationType: z.string().min(1),
    entityIds: z.array(entityIdSchema),
    summary: z.string().min(1).max(4_096),
  })
  .strict();

export const transactionResultSchema = z
  .object({
    transactionId: entityIdSchema,
    projectId: entityIdSchema,
    baseRevision: z.int().nonnegative(),
    resultingRevision: z.int().nonnegative(),
    mode: transactionModeSchema,
    draftId: entityIdSchema.optional(),
    changes: z.array(changeSchema),
    warnings: z.array(z.string().max(4_096)),
    unavailableCapabilities: z.array(z.string().max(512)),
    affectedRanges: z.array(timeRangeSchema),
    project: z.unknown().optional(),
  })
  .strict();

export type Operation = z.infer<typeof operationSchema>;
export type TransactionRequest = z.infer<typeof transactionRequestSchema>;
export type TransactionMode = z.infer<typeof transactionModeSchema>;
export type TransactionResult = z.infer<typeof transactionResultSchema>;
export type Change = z.infer<typeof changeSchema>;
