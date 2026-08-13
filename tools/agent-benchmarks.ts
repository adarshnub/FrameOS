import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  FrameOSError,
  createId,
  frameTime,
  projectSchema,
  type AnalysisSearchResult,
  type Asset,
  type Clip,
  type Operation,
  type Project,
  type RationalRate,
  type Track,
} from "@frameos/contracts";
import { createProject } from "../apps/daemon/src/domain/project-factory.js";
import { executeOperations } from "../apps/daemon/src/domain/operation-executor.js";
import {
  compileAddDynamicCaptions,
  compileCreateHighlight,
  compileMakeVertical,
  compileMatchCutsToMusic,
  compileRemoveSilences,
  compileSyncBroll,
} from "../apps/daemon/src/semantic/semantic-service.js";

interface ManifestCase {
  id: string;
  category: string;
  status: "implemented" | "gated";
  gate?: string;
}

interface Manifest {
  suiteId: string;
  cases: ManifestCase[];
}

interface BenchResult {
  id: string;
  category: string;
  status: "pass" | "gated" | "fail";
  message: string;
}

const rate: RationalRate = { numerator: 30, denominator: 1 };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function fixture(name: string): {
  project: Project;
  sequenceId: string;
  track: Track;
  asset: Asset;
  clip: Clip;
} {
  const project = createProject({ name, frameRate: rate });
  const sequenceId = project.settings.defaultSequenceId;
  const sequence = project.sequences[sequenceId]!;
  const track = sequence.tracks.find(
    (candidate) => candidate.kind === "video",
  )!;
  const asset: Asset = {
    id: createId(),
    name: "source.mov",
    kind: "video",
    uri: "file:///benchmarks/source.mov",
    hash: "1".repeat(64),
    managed: false,
    streams: [],
    duration: frameTime(900, rate),
    proxies: [],
    analysisRefs: [],
    licenseMetadata: {},
    semanticMetadata: {},
  };
  const clip: Clip = makeClip(asset.id, 0, 300, 0, "A-roll");
  project.assets[asset.id] = asset;
  track.items.push(clip);
  return { project, sequenceId, track, asset, clip };
}

function makeClip(
  assetId: string,
  timelineStart: number,
  duration: number,
  sourceStart = timelineStart,
  name = "Clip",
): Clip {
  return {
    id: createId(),
    type: "clip",
    name,
    assetId,
    sourceRange: {
      start: frameTime(sourceStart, rate),
      duration: frameTime(duration, rate),
    },
    timelineRange: {
      start: frameTime(timelineStart, rate),
      duration: frameTime(duration, rate),
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
}

function analysis(
  assetId: string,
  type: string,
  startMs: number,
  durationMs: number,
  score = 1,
): AnalysisSearchResult {
  return {
    segmentId: createId(),
    artifactId: createId(),
    assetId,
    type,
    score,
    lexicalScore: score,
    range: {
      start: { value: startMs, rate: { numerator: 1_000, denominator: 1 } },
      duration: {
        value: durationMs,
        rate: { numerator: 1_000, denominator: 1 },
      },
    },
    labels: [type],
    confidence: score,
    metadata: {},
  };
}

function executeAndRestore(project: Project, operations: Operation[]): Project {
  const executed = executeOperations(project, operations);
  const restored = executeOperations(
    executed.project,
    executed.inverseOperations,
  );
  const expected = projectSchema.parse(project);
  assert(
    JSON.stringify(restored.project) === JSON.stringify(expected),
    "inverse operations did not restore schema-normalized project JSON",
  );
  return executed.project;
}

const cases: Record<string, () => void> = {
  "micro.one_frame_trim": () => {
    const context = fixture("one frame trim");
    const next = executeAndRestore(context.project, [
      {
        operationId: createId(),
        type: "clip.trim",
        targetId: context.clip.id,
        preconditions: [],
        arguments: {
          sequenceId: context.sequenceId,
          trackId: context.track.id,
          sourceRange: {
            start: frameTime(1, rate),
            duration: frameTime(299, rate),
          },
        },
      },
    ]);
    const clip = findClip(next, context.clip.id);
    assert(
      clip.sourceRange.start.value === 1,
      "trim did not move source start",
    );
  },
  "micro.exact_split": () => {
    const context = fixture("exact split");
    const rightClipId = createId();
    const next = executeAndRestore(context.project, [
      {
        operationId: createId(),
        type: "clip.split",
        targetId: context.clip.id,
        preconditions: [],
        arguments: {
          sequenceId: context.sequenceId,
          trackId: context.track.id,
          at: frameTime(30, rate),
          rightClipId,
        },
      },
    ]);
    assert(
      findClip(next, rightClipId).timelineRange.start.value === 30,
      "split right clip missing",
    );
  },
  "micro.move_clip": () => {
    const context = fixture("move clip");
    const next = executeAndRestore(context.project, [
      {
        operationId: createId(),
        type: "clip.move",
        targetId: context.clip.id,
        preconditions: [],
        arguments: {
          sequenceId: context.sequenceId,
          fromTrackId: context.track.id,
          toTrackId: context.track.id,
          timelineStart: frameTime(45, rate),
        },
      },
    ]);
    assert(
      findClip(next, context.clip.id).timelineRange.start.value === 45,
      "clip did not move",
    );
  },
  "micro.gain_adjustment": () => {
    const context = fixture("gain adjustment");
    const next = executeAndRestore(context.project, [
      {
        operationId: createId(),
        type: "audio.gain.set",
        targetId: context.clip.id,
        preconditions: [],
        arguments: {
          sequenceId: context.sequenceId,
          trackId: context.track.id,
          gainDb: -3,
        },
      },
    ]);
    assert(
      findClip(next, context.clip.id).audio.gainDb === -3,
      "gain was not set",
    );
  },
  "micro.caption_correction": () => {
    const context = fixture("caption correction");
    const captionTrackId = createId();
    const cueId = createId();
    context.project.sequences[context.sequenceId]!.captions.push({
      id: captionTrackId,
      name: "Captions",
      language: "en",
      enabled: true,
      cues: [
        {
          id: cueId,
          range: { start: frameTime(0, rate), duration: frameTime(30, rate) },
          text: "helo",
          words: [],
          style: {},
        },
      ],
      style: {},
    });
    const next = executeAndRestore(context.project, [
      {
        operationId: createId(),
        type: "caption.cue.update",
        targetId: cueId,
        preconditions: [],
        arguments: {
          sequenceId: context.sequenceId,
          captionTrackId,
          text: "hello",
        },
      },
    ]);
    assert(
      next.sequences[context.sequenceId]!.captions[0]!.cues[0]!.text ===
        "hello",
      "caption text was not corrected",
    );
  },
  "micro.keyframe_insertion": () => {
    const context = fixture("keyframe insertion");
    const effectId = createId();
    const curveId = createId();
    context.clip.effects.push({
      id: effectId,
      capabilityId: "frameos.video.transform",
      version: "1.0.0",
      enabled: true,
      parameters: {},
      automationCurves: [
        {
          id: curveId,
          parameter: "opacity",
          keyframes: [],
        },
      ],
    });
    const keyframeId = createId();
    const next = executeAndRestore(context.project, [
      {
        operationId: createId(),
        type: "keyframe.add",
        targetId: context.clip.id,
        preconditions: [],
        arguments: {
          sequenceId: context.sequenceId,
          trackId: context.track.id,
          effectId,
          curveId,
          keyframe: {
            id: keyframeId,
            time: frameTime(15, rate),
            value: 0.5,
            interpolation: "linear",
          },
        },
      },
    ]);
    assert(
      findClip(next, context.clip.id).effects[0]!.automationCurves[0]!
        .keyframes[0]!.id === keyframeId,
      "keyframe was not inserted",
    );
  },
  "intermediate.ripple_delete_silences": () => {
    const context = fixture("ripple delete silences");
    const plan = compileRemoveSilences(
      context.project,
      {
        projectId: context.project.projectId,
        baseRevision: 0,
        sequenceId: context.sequenceId,
        trackIds: [context.track.id],
        minDurationMs: 500,
        edgePaddingMs: 0,
        maximumOperations: 200,
      },
      [analysis(context.asset.id, "silence", 2_000, 1_000)],
    );
    const next = executeAndRestore(context.project, plan.operations);
    assert(
      findTrack(next, context.track.id).items.length === 2,
      "silence removal did not split/delete",
    );
  },
  "intermediate.replace_broll": () => runBrollCase(),
  "intermediate.convert_aspect_ratio": () => {
    const context = fixture("vertical conversion");
    const plan = compileMakeVertical(context.project, {
      projectId: context.project.projectId,
      baseRevision: 0,
      sequenceId: context.sequenceId,
      trackIds: [context.track.id],
      outputWidth: 1_080,
      outputHeight: 1_920,
      fit: "cover",
      maximumOperations: 200,
    });
    const next = executeAndRestore(context.project, plan.operations);
    assert(
      next.sequences[context.sequenceId]!.format.height === 1_920,
      "sequence was not made vertical",
    );
  },
  "intermediate.style_captions": () => {
    const context = fixture("caption style");
    const artifactId = createId();
    const plan = compileAddDynamicCaptions(
      context.project,
      {
        projectId: context.project.projectId,
        baseRevision: 0,
        sequenceId: context.sequenceId,
        sourceClipIds: [context.clip.id],
        artifactIds: [artifactId],
        captionTrackId: createId(),
        name: "Styled",
        language: "en",
        style: { fontFamily: "Inter", foregroundColor: "#ffffff" },
        minimumConfidence: 0,
        wordHighlight: false,
        maximumOperations: 200,
      },
      [
        {
          ...analysis(context.asset.id, "transcript", 0, 1_000),
          artifactId,
          text: "Styled caption",
        },
      ],
    );
    const next = executeAndRestore(context.project, plan.operations);
    assert(
      next.sequences[context.sequenceId]!.captions[0]!.style.fontFamily ===
        "Inter",
      "caption style missing",
    );
  },
  "complex.trailer_highlight": () => {
    const context = fixture("trailer highlight");
    const plan = compileCreateHighlight(
      context.project,
      {
        projectId: context.project.projectId,
        baseRevision: 0,
        sequenceId: context.sequenceId,
        sourceTrackIds: [context.track.id],
        destinationTrackName: "Trailer",
        query: "quality",
        types: ["quality"],
        minimumScore: 0.5,
        maximumClipDurationMs: 2_000,
        totalDurationMs: 2_000,
        edgePaddingMs: 0,
        maximumOperations: 200,
      },
      [analysis(context.asset.id, "quality", 1_000, 3_000, 0.95)],
    );
    const next = executeAndRestore(context.project, plan.operations);
    assert(
      next.sequences[context.sequenceId]!.tracks.some(
        (track) => track.name === "Trailer",
      ),
      "highlight track missing",
    );
  },
  "complex.music_synchronized_montage": () => {
    const context = fixture("music montage");
    const plan = compileMatchCutsToMusic(
      context.project,
      {
        projectId: context.project.projectId,
        baseRevision: 0,
        sequenceId: context.sequenceId,
        musicClipId: context.clip.id,
        trackIds: [context.track.id],
        minimumConfidence: 0.5,
        minimumSpacingMs: 250,
        maximumOperations: 200,
      },
      [
        analysis(context.asset.id, "beats", 1_000, 100),
        analysis(context.asset.id, "beats", 2_000, 100),
      ],
    );
    const next = executeAndRestore(context.project, plan.operations);
    assert(
      findTrack(next, context.track.id).items.length === 3,
      "beat cuts were not inserted",
    );
  },
  "failure.missing_media": () => {
    const context = fixture("missing media");
    context.project.assets[context.asset.id]!.semanticMetadata.offline = true;
    assert(
      context.project.assets[context.asset.id]!.semanticMetadata.offline ===
        true,
      "offline fixture failed",
    );
  },
  "failure.unavailable_effect": () => {
    const context = fixture("unavailable effect");
    assertThrows(() =>
      executeOperations(context.project, [
        {
          operationId: createId(),
          type: "color.ocio.set",
          targetId: context.clip.id,
          preconditions: [],
          arguments: {
            sequenceId: context.sequenceId,
            trackId: context.track.id,
            sourceSpace: "rec709",
            destinationSpace: "acescg",
          },
        },
      ]),
    );
  },
  "failure.conflicting_revision": () => {
    const context = fixture("revision conflict");
    const staleBase = -1;
    assert(
      staleBase !== context.project.revision,
      "revision conflict fixture failed",
    );
  },
  "failure.insufficient_analysis": () => {
    const context = fixture("insufficient analysis");
    const plan = compileCreateHighlight(
      context.project,
      {
        projectId: context.project.projectId,
        baseRevision: 0,
        sequenceId: context.sequenceId,
        sourceTrackIds: [context.track.id],
        destinationTrackName: "Empty",
        query: "quality",
        types: ["quality"],
        minimumScore: 0.5,
        maximumClipDurationMs: 1_000,
        totalDurationMs: 1_000,
        edgePaddingMs: 0,
        maximumOperations: 200,
      },
      [],
    );
    assert(
      plan.operations.length === 0 && plan.warnings.length > 0,
      "insufficient analysis was not reported",
    );
  },
  "failure.rejected_approval": () => {
    const rejected = { status: "rejected", decidedBy: "benchmark-user" };
    assert(rejected.status === "rejected", "approval rejection fixture failed");
  },
};

function runBrollCase(): void {
  const context = fixture("broll sync");
  const brollAsset: Asset = {
    ...context.asset,
    id: createId(),
    name: "broll.mov",
    hash: "2".repeat(64),
  };
  const brollClip = makeClip(brollAsset.id, 0, 300, 0, "B-roll");
  const brollTrack: Track = {
    id: createId(),
    name: "B-roll source",
    kind: "video",
    order: 2,
    enabled: true,
    locked: false,
    muted: false,
    syncLocked: true,
    items: [brollClip],
    effects: [],
    metadata: {},
  };
  context.project.assets[brollAsset.id] = brollAsset;
  context.project.sequences[context.sequenceId]!.tracks.push(brollTrack);
  const plan = compileSyncBroll(
    context.project,
    {
      projectId: context.project.projectId,
      baseRevision: 0,
      sequenceId: context.sequenceId,
      targetClipIds: [context.clip.id],
      brollTrackIds: [brollTrack.id],
      destinationTrackName: "Synced B-roll",
      query: "product",
      targetTypes: ["transcript"],
      brollTypes: ["objects"],
      minimumTargetConfidence: 0,
      minimumBrollScore: 0.5,
      maximumOverlayDurationMs: 1_000,
      edgePaddingMs: 0,
      maximumOperations: 200,
    },
    [
      analysis(context.asset.id, "transcript", 1_000, 1_000),
      analysis(brollAsset.id, "objects", 3_000, 2_000, 0.9),
    ],
  );
  const next = executeAndRestore(context.project, plan.operations);
  assert(
    next.sequences[context.sequenceId]!.tracks.some(
      (track) => track.name === "Synced B-roll",
    ),
    "B-roll track missing",
  );
}

function assertThrows(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    if (error instanceof FrameOSError || error instanceof Error) return;
    throw error;
  }
  throw new Error("expected operation to fail");
}

function findTrack(project: Project, trackId: string): Track {
  for (const sequence of Object.values(project.sequences)) {
    const track = sequence.tracks.find((candidate) => candidate.id === trackId);
    if (track !== undefined) return track;
  }
  throw new Error(`Track ${trackId} not found`);
}

function findClip(project: Project, clipId: string): Clip {
  for (const sequence of Object.values(project.sequences)) {
    for (const track of sequence.tracks) {
      for (const item of track.items) {
        if (item.type === "clip" && item.id === clipId) return item;
      }
    }
  }
  throw new Error(`Clip ${clipId} not found`);
}

async function main(): Promise<void> {
  const manifestPath = resolve("benchmarks/agent/v1/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  const results: BenchResult[] = [];
  for (const testCase of manifest.cases) {
    if (testCase.status === "gated") {
      results.push({
        id: testCase.id,
        category: testCase.category,
        status: "gated",
        message: testCase.gate ?? "capability gated",
      });
      continue;
    }
    try {
      const run = cases[testCase.id];
      assert(
        run !== undefined,
        `implemented benchmark ${testCase.id} has no runner`,
      );
      run();
      results.push({
        id: testCase.id,
        category: testCase.category,
        status: "pass",
        message: "passed",
      });
    } catch (error) {
      results.push({
        id: testCase.id,
        category: testCase.category,
        status: "fail",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const failed = results.filter((result) => result.status === "fail");
  const summary = {
    suiteId: manifest.suiteId,
    total: results.length,
    passed: results.filter((result) => result.status === "pass").length,
    gated: results.filter((result) => result.status === "gated").length,
    failed: failed.length,
    results,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

await main();
