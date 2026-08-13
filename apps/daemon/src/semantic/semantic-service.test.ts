import {
  createId,
  frameTime,
  type AnalysisSearchResult,
  type Asset,
  type Clip,
  type Track,
} from "@frameos/contracts";
import { describe, expect, it } from "vitest";
import { createProject } from "../domain/project-factory.js";
import { executeOperations } from "../domain/operation-executor.js";
import {
  compileAddDynamicCaptions,
  compileCreateHighlight,
  compileMakeVertical,
  compileMatchCutsToMusic,
  compileRemoveSilences,
  compileSyncBroll,
} from "./semantic-service.js";

function fixture() {
  const project = createProject({
    name: "Semantic edit",
    frameRate: { numerator: 30, denominator: 1 },
  });
  const sequence = project.sequences[project.settings.defaultSequenceId]!;
  const track = sequence.tracks.find(
    (candidate) => candidate.kind === "video",
  )!;
  const asset: Asset = {
    id: createId(),
    name: "interview.wav",
    kind: "audio",
    uri: "file:///fixture/interview.wav",
    hash: "a".repeat(64),
    managed: false,
    streams: [],
    duration: frameTime(300, sequence.format.frameRate),
    proxies: [],
    analysisRefs: [],
    licenseMetadata: {},
    semanticMetadata: {},
  };
  const clip: Clip = {
    id: createId(),
    type: "clip",
    name: "Interview",
    assetId: asset.id,
    sourceRange: {
      start: frameTime(0, sequence.format.frameRate),
      duration: frameTime(300, sequence.format.frameRate),
    },
    timelineRange: {
      start: frameTime(0, sequence.format.frameRate),
      duration: frameTime(300, sequence.format.frameRate),
    },
    enabled: true,
    locked: false,
    metadata: {},
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
    semanticMetadata: {},
  };
  project.assets[asset.id] = asset;
  track.items.push(clip);
  const silence = (start: number, duration: number): AnalysisSearchResult => ({
    segmentId: createId(),
    artifactId: createId(),
    assetId: asset.id,
    type: "silence",
    score: 1,
    lexicalScore: 1,
    range: {
      start: { value: start, rate: { numerator: 1_000, denominator: 1 } },
      duration: {
        value: duration,
        rate: { numerator: 1_000, denominator: 1 },
      },
    },
    labels: ["silence"],
    confidence: 1,
    metadata: {},
  });
  return {
    project,
    sequence,
    track,
    asset,
    clip,
    results: [silence(2_000, 2_000), silence(7_000, 1_000)],
  };
}

describe("semantic edit compiler", () => {
  it("compiles vertical reframing into reversible low-level operations", () => {
    const context = fixture();
    const plan = compileMakeVertical(context.project, {
      projectId: context.project.projectId,
      baseRevision: 0,
      sequenceId: context.sequence.id,
      trackIds: [context.track.id],
      outputWidth: 1_080,
      outputHeight: 1_920,
      fit: "cover",
      maximumOperations: 200,
    });
    expect(plan.semanticOperation).toBe("semantic.make_vertical");
    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "sequence.format.set",
      "video.scale.set",
    ]);
    expect(plan.warnings[0]).toMatch(/center-frame heuristic/u);

    const executed = executeOperations(context.project, plan.operations);
    const changedSequence = executed.project.sequences[context.sequence.id]!;
    const changedClip = changedSequence.tracks
      .flatMap((track) => track.items)
      .find((item): item is Clip => item.id === context.clip.id)!;
    expect(changedSequence.format).toMatchObject({
      width: 1_080,
      height: 1_920,
    });
    expect(changedClip.transform.scaleX).toBeCloseTo(256 / 81, 8);
    expect(changedClip.transform.scaleY).toBe(1);
    expect(
      executeOperations(executed.project, executed.inverseOperations).project,
    ).toEqual(context.project);
  });

  it("compiles silence artifacts into ordinary reversible edit operations", () => {
    const context = fixture();
    const plan = compileRemoveSilences(
      context.project,
      {
        projectId: context.project.projectId,
        baseRevision: 0,
        sequenceId: context.sequence.id,
        trackIds: [context.track.id],
        minDurationMs: 500,
        edgePaddingMs: 0,
        maximumOperations: 200,
      },
      context.results,
    );
    expect(plan.operations).toHaveLength(6);
    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "clip.split",
      "clip.split",
      "clip.ripple_delete",
      "clip.split",
      "clip.split",
      "clip.ripple_delete",
    ]);
    expect(plan.sourceArtifactIds).toHaveLength(2);

    const executed = executeOperations(context.project, plan.operations);
    const items = executed.project.sequences[context.sequence.id]!.tracks.find(
      (candidate) => candidate.id === context.track.id,
    )!.items;
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.timelineRange.duration.value)).toEqual([
      60, 90, 60,
    ]);
    expect(items.map((item) => item.timelineRange.start.value)).toEqual([
      0, 60, 150,
    ]);
    expect(
      executeOperations(executed.project, executed.inverseOperations).project,
    ).toEqual(context.project);
  });

  it("maps source beat markers into reversible timeline split operations", () => {
    const context = fixture();
    const beat = (start: number, confidence = 0.9): AnalysisSearchResult => ({
      segmentId: createId(),
      artifactId: createId(),
      assetId: context.asset.id,
      type: "beats",
      score: 1,
      lexicalScore: 1,
      range: {
        start: { value: start, rate: { numerator: 1_000, denominator: 1 } },
        duration: {
          value: 100,
          rate: { numerator: 1_000, denominator: 1 },
        },
      },
      labels: ["beat", "onset"],
      confidence,
      metadata: {},
    });
    const results = [beat(1_000), beat(2_000), beat(2_050, 0.3), beat(3_000)];
    const plan = compileMatchCutsToMusic(
      context.project,
      {
        projectId: context.project.projectId,
        baseRevision: 0,
        sequenceId: context.sequence.id,
        musicClipId: context.clip.id,
        trackIds: [context.track.id],
        minimumConfidence: 0.5,
        minimumSpacingMs: 500,
        maximumOperations: 200,
      },
      results,
    );
    expect(plan.semanticOperation).toBe("semantic.match_cuts_to_music");
    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "clip.split",
      "clip.split",
      "clip.split",
    ]);
    expect(
      plan.operations.map((operation) =>
        operation.type === "clip.split" ? operation.arguments.at.value : -1,
      ),
    ).toEqual([90, 60, 30]);
    expect(plan.sourceArtifactIds).toHaveLength(3);

    const executed = executeOperations(context.project, plan.operations);
    const items = executed.project.sequences[context.sequence.id]!.tracks.find(
      (candidate) => candidate.id === context.track.id,
    )!.items;
    expect(items.map((item) => item.timelineRange.duration.value)).toEqual([
      30, 30, 30, 210,
    ]);
    expect(
      executeOperations(executed.project, executed.inverseOperations).project,
    ).toEqual(context.project);
  });

  it("maps transcript and word ranges into a reversible dynamic caption track", () => {
    const context = fixture();
    const artifactId = createId();
    const transcript: AnalysisSearchResult = {
      segmentId: createId(),
      artifactId,
      assetId: context.asset.id,
      type: "transcript",
      score: 1,
      lexicalScore: 1,
      range: {
        start: { value: 1_000, rate: { numerator: 1_000, denominator: 1 } },
        duration: {
          value: 1_000,
          rate: { numerator: 1_000, denominator: 1 },
        },
      },
      text: "Build it deterministically",
      labels: ["speech"],
      confidence: 0.95,
      speaker: "Ada",
      metadata: {
        words: [
          {
            text: "Build",
            range: {
              start: {
                value: 1_000,
                rate: { numerator: 1_000, denominator: 1 },
              },
              duration: {
                value: 400,
                rate: { numerator: 1_000, denominator: 1 },
              },
            },
            confidence: 0.97,
          },
        ],
      },
    };
    const captionTrackId = createId();
    const plan = compileAddDynamicCaptions(
      context.project,
      {
        projectId: context.project.projectId,
        baseRevision: 0,
        sequenceId: context.sequence.id,
        sourceClipIds: [context.clip.id],
        artifactIds: [artifactId],
        captionTrackId,
        name: "Agent captions",
        language: "en",
        style: { fontFamily: "Inter" },
        minimumConfidence: 0.5,
        wordHighlight: true,
        maximumOperations: 200,
      },
      [transcript],
    );
    expect(plan.semanticOperation).toBe("semantic.add_dynamic_captions");
    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "caption.track.add",
      "caption.cue.add",
    ]);
    expect(plan.sourceArtifactIds).toEqual([artifactId]);

    const executed = executeOperations(context.project, plan.operations);
    const captionTrack =
      executed.project.sequences[context.sequence.id]!.captions[0]!;
    expect(captionTrack).toMatchObject({
      id: captionTrackId,
      language: "en",
      style: {
        preset: "frameos.dynamic-caption-v1",
        wordHighlight: true,
        fontFamily: "Inter",
      },
      cues: [
        {
          text: "Build it deterministically",
          speaker: "Ada",
          range: { start: { value: 30 }, duration: { value: 30 } },
          words: [
            {
              text: "Build",
              range: { start: { value: 30 }, duration: { value: 12 } },
            },
          ],
        },
      ],
    });
    expect(
      executeOperations(executed.project, executed.inverseOperations).project,
    ).toEqual(context.project);
  });

  it("maps semantic plans through forward linear retime maps", () => {
    const context = fixture();
    context.clip.timelineRange.duration = frameTime(150, {
      numerator: 30,
      denominator: 1,
    });
    context.clip.timeMap = [
      {
        id: createId(),
        time: frameTime(0, { numerator: 30, denominator: 1 }),
        value: 0,
        interpolation: "linear",
      },
      {
        id: createId(),
        time: frameTime(150, { numerator: 30, denominator: 1 }),
        value: 300,
        interpolation: "linear",
      },
    ];

    const silencePlan = compileRemoveSilences(
      context.project,
      {
        projectId: context.project.projectId,
        baseRevision: 0,
        sequenceId: context.sequence.id,
        trackIds: [context.track.id],
        minDurationMs: 500,
        edgePaddingMs: 0,
        maximumOperations: 200,
      },
      context.results,
    );
    expect(silencePlan.warnings.join("\n")).not.toMatch(/Skipped retimed/u);
    const silenceExecuted = executeOperations(
      context.project,
      silencePlan.operations,
    );
    const silenceItems = silenceExecuted.project.sequences[
      context.sequence.id
    ]!.tracks.find((candidate) => candidate.id === context.track.id)!.items;
    expect(
      silenceItems.map((item) => item.timelineRange.duration.value),
    ).toEqual([30, 45, 30]);
    expect(
      executeOperations(
        silenceExecuted.project,
        silenceExecuted.inverseOperations,
      ).project,
    ).toEqual(context.project);

    const beat = (start: number): AnalysisSearchResult => ({
      segmentId: createId(),
      artifactId: createId(),
      assetId: context.asset.id,
      type: "beats",
      score: 1,
      lexicalScore: 1,
      range: {
        start: { value: start, rate: { numerator: 1_000, denominator: 1 } },
        duration: {
          value: 100,
          rate: { numerator: 1_000, denominator: 1 },
        },
      },
      labels: ["beat"],
      confidence: 0.9,
      metadata: {},
    });
    const beatPlan = compileMatchCutsToMusic(
      context.project,
      {
        projectId: context.project.projectId,
        baseRevision: 0,
        sequenceId: context.sequence.id,
        musicClipId: context.clip.id,
        trackIds: [context.track.id],
        minimumConfidence: 0.5,
        minimumSpacingMs: 250,
        maximumOperations: 200,
      },
      [beat(1_000), beat(2_000), beat(3_000)],
    );
    expect(
      beatPlan.operations.map((operation) =>
        operation.type === "clip.split" ? operation.arguments.at.value : -1,
      ),
    ).toEqual([45, 30, 15]);
    expect(
      beatPlan.operations.every(
        (operation) =>
          operation.type === "clip.split" &&
          operation.arguments.rightStartKeyframeId !== undefined,
      ),
    ).toBe(true);
    const beatExecuted = executeOperations(
      context.project,
      beatPlan.operations,
    );
    const beatItems = beatExecuted.project.sequences[
      context.sequence.id
    ]!.tracks.find((candidate) => candidate.id === context.track.id)!.items;
    expect(beatItems.map((item) => item.timelineRange.duration.value)).toEqual([
      15, 15, 15, 105,
    ]);

    const artifactId = createId();
    const captionPlan = compileAddDynamicCaptions(
      context.project,
      {
        projectId: context.project.projectId,
        baseRevision: 0,
        sequenceId: context.sequence.id,
        sourceClipIds: [context.clip.id],
        artifactIds: [artifactId],
        captionTrackId: createId(),
        name: "Retimed captions",
        language: "en",
        style: {},
        minimumConfidence: 0.5,
        wordHighlight: true,
        maximumOperations: 200,
      },
      [
        {
          segmentId: createId(),
          artifactId,
          assetId: context.asset.id,
          type: "transcript",
          score: 1,
          lexicalScore: 1,
          range: {
            start: {
              value: 1_000,
              rate: { numerator: 1_000, denominator: 1 },
            },
            duration: {
              value: 1_000,
              rate: { numerator: 1_000, denominator: 1 },
            },
          },
          text: "Retimed caption",
          labels: ["speech"],
          confidence: 0.95,
          metadata: {
            words: [
              {
                text: "Retimed",
                range: {
                  start: {
                    value: 1_000,
                    rate: { numerator: 1_000, denominator: 1 },
                  },
                  duration: {
                    value: 400,
                    rate: { numerator: 1_000, denominator: 1 },
                  },
                },
              },
            ],
          },
        },
      ],
    );
    const captionCue =
      captionPlan.operations[1]?.type === "caption.cue.add"
        ? captionPlan.operations[1].arguments.cue
        : undefined;
    expect(captionCue?.range).toMatchObject({
      start: { value: 15 },
      duration: { value: 15 },
    });
    expect(captionCue?.words[0]).toMatchObject({
      range: { start: { value: 15 }, duration: { value: 6 } },
    });
  });

  it("compiles ranked analysis ranges into a reversible highlight assembly", () => {
    const context = fixture();
    const quality = (
      start: number,
      duration: number,
      score: number,
    ): AnalysisSearchResult => ({
      segmentId: createId(),
      artifactId: createId(),
      assetId: context.asset.id,
      type: "quality",
      score,
      lexicalScore: score,
      range: {
        start: { value: start, rate: { numerator: 1_000, denominator: 1 } },
        duration: {
          value: duration,
          rate: { numerator: 1_000, denominator: 1 },
        },
      },
      labels: ["best-take"],
      confidence: score,
      metadata: {},
    });
    const plan = compileCreateHighlight(
      context.project,
      {
        projectId: context.project.projectId,
        baseRevision: 0,
        sequenceId: context.sequence.id,
        sourceTrackIds: [context.track.id],
        destinationTrackName: "Best moments",
        query: "quality highlight",
        types: ["quality"],
        minimumScore: 0.5,
        maximumClipDurationMs: 2_000,
        totalDurationMs: 3_000,
        edgePaddingMs: 0,
        maximumOperations: 200,
      },
      [quality(1_000, 2_000, 0.7), quality(5_000, 4_000, 0.95)],
    );
    expect(plan.semanticOperation).toBe("semantic.create_highlight");
    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "track.add",
      "clip.append",
      "clip.append",
    ]);
    expect(plan.sourceArtifactIds).toHaveLength(2);
    const appendedClips = plan.operations.flatMap((operation) =>
      operation.type === "clip.append" ? [operation.arguments.clip] : [],
    );
    expect(appendedClips.map((clip) => clip.sourceRange.start.value)).toEqual([
      150, 30,
    ]);
    expect(
      appendedClips.map((clip) => clip.timelineRange.duration.value),
    ).toEqual([60, 30]);
    expect(appendedClips[0]?.semanticMetadata).toMatchObject({
      semanticOperation: "semantic.create_highlight",
      sourceClipId: context.clip.id,
      sourceTrackId: context.track.id,
      score: 0.95,
    });

    const executed = executeOperations(context.project, plan.operations);
    const highlightTrack = executed.project.sequences[
      context.sequence.id
    ]!.tracks.find((track) => track.name === "Best moments")!;
    expect(
      highlightTrack.items.map((item) => item.timelineRange.start.value),
    ).toEqual([0, 60]);
    expect(
      highlightTrack.items.map((item) => item.timelineRange.duration.value),
    ).toEqual([60, 30]);
    expect(
      executeOperations(executed.project, executed.inverseOperations).project,
    ).toEqual(context.project);
  });

  it("compiles target ranges and ranked source ranges into reversible B-roll overlays", () => {
    const context = fixture();
    const brollAsset: Asset = {
      ...context.asset,
      id: createId(),
      name: "product-broll.mp4",
      kind: "video",
      uri: "file:///fixture/product-broll.mp4",
      hash: "b".repeat(64),
    };
    const brollClip: Clip = {
      ...structuredClone(context.clip),
      id: createId(),
      name: "Product B-roll",
      assetId: brollAsset.id,
      links: [],
    };
    const brollTrack: Track = {
      id: createId(),
      name: "B-roll sources",
      kind: "video",
      order: 10,
      enabled: true,
      locked: false,
      muted: false,
      syncLocked: true,
      items: [brollClip],
      effects: [],
      metadata: {},
    };
    context.project.assets[brollAsset.id] = brollAsset;
    context.sequence.tracks.push(brollTrack);
    const transcriptArtifactId = createId();
    const objectArtifactId = createId();
    const plan = compileSyncBroll(
      context.project,
      {
        projectId: context.project.projectId,
        baseRevision: 0,
        sequenceId: context.sequence.id,
        targetClipIds: [context.clip.id],
        brollTrackIds: [brollTrack.id],
        destinationTrackName: "Synced B-roll",
        query: "product",
        targetTypes: ["transcript"],
        brollTypes: ["objects"],
        minimumTargetConfidence: 0.5,
        minimumBrollScore: 0.5,
        maximumOverlayDurationMs: 2_000,
        edgePaddingMs: 0,
        maximumOperations: 200,
      },
      [
        {
          segmentId: createId(),
          artifactId: transcriptArtifactId,
          assetId: context.asset.id,
          type: "transcript",
          score: 1,
          lexicalScore: 1,
          range: {
            start: {
              value: 2_000,
              rate: { numerator: 1_000, denominator: 1 },
            },
            duration: {
              value: 3_000,
              rate: { numerator: 1_000, denominator: 1 },
            },
          },
          text: "Show the product here",
          labels: ["speech"],
          confidence: 0.9,
          metadata: {},
        },
        {
          segmentId: createId(),
          artifactId: objectArtifactId,
          assetId: brollAsset.id,
          type: "objects",
          score: 0.95,
          lexicalScore: 0.95,
          range: {
            start: {
              value: 5_000,
              rate: { numerator: 1_000, denominator: 1 },
            },
            duration: {
              value: 4_000,
              rate: { numerator: 1_000, denominator: 1 },
            },
          },
          labels: ["product"],
          confidence: 0.95,
          metadata: {},
        },
      ],
    );
    expect(plan.semanticOperation).toBe("semantic.sync_broll");
    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "track.add",
      "clip.overwrite",
    ]);
    expect(plan.sourceArtifactIds.sort()).toEqual(
      [objectArtifactId, transcriptArtifactId].sort(),
    );
    const overlay =
      plan.operations[1]?.type === "clip.overwrite"
        ? plan.operations[1].arguments.clip
        : undefined;
    expect(overlay?.timelineRange).toMatchObject({
      start: { value: 60 },
      duration: { value: 60 },
    });
    expect(overlay?.sourceRange).toMatchObject({
      start: { value: 150 },
      duration: { value: 60 },
    });
    expect(overlay?.semanticMetadata).toMatchObject({
      semanticOperation: "semantic.sync_broll",
      sourceClipId: brollClip.id,
      sourceTrackId: brollTrack.id,
      sourceArtifactId: objectArtifactId,
      targetArtifactId: transcriptArtifactId,
      score: 0.95,
    });

    const executed = executeOperations(context.project, plan.operations);
    const syncedTrack = executed.project.sequences[
      context.sequence.id
    ]!.tracks.find((track) => track.name === "Synced B-roll")!;
    expect(
      syncedTrack.items.map((item) => item.timelineRange.start.value),
    ).toEqual([60]);
    expect(
      executeOperations(executed.project, executed.inverseOperations).project,
    ).toEqual(context.project);
  });

  it("enforces the agent-sized operation budget before returning a plan", () => {
    const context = fixture();
    expect(() =>
      compileRemoveSilences(
        context.project,
        {
          projectId: context.project.projectId,
          trackIds: [context.track.id],
          maximumOperations: 2,
          minDurationMs: 500,
          edgePaddingMs: 0,
        },
        context.results,
      ),
    ).toThrow(/more than 2 operations/u);
  });
});
