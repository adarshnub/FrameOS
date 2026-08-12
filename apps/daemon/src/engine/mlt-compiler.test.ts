import {
  createId,
  frameTime,
  type Asset,
  type Clip,
  type CaptionTrack,
  type Generator,
  type Title,
} from "@frameos/contracts";
import { describe, expect, it } from "vitest";
import { createProject } from "../domain/project-factory.js";
import { compileMltXml } from "./mlt-compiler.js";

describe("MLT compiler", () => {
  it("compiles the same snapshot deterministically without raw project metadata", () => {
    const project = createProject({
      name: "Compiler",
      frameRate: { numerator: 24, denominator: 1 },
    });
    const sequence = project.sequences[project.settings.defaultSequenceId]!;
    const track = sequence.tracks.find(
      (candidate) => candidate.kind === "video",
    )!;
    const asset: Asset = {
      id: createId(),
      name: "A&B.mp4",
      kind: "video",
      uri: "C:\\media\\A&B.mp4",
      hash: "0123456789abcdef0123456789abcdef",
      managed: false,
      streams: [],
      duration: frameTime(240, sequence.format.frameRate),
      proxies: [],
      analysisRefs: [],
      licenseMetadata: {},
      semanticMetadata: {},
    };
    const clip: Clip = {
      id: createId(),
      name: "Clip",
      type: "clip",
      assetId: asset.id,
      sourceRange: {
        start: frameTime(12, sequence.format.frameRate),
        duration: frameTime(48, sequence.format.frameRate),
      },
      timelineRange: {
        start: frameTime(10, sequence.format.frameRate),
        duration: frameTime(48, sequence.format.frameRate),
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
    const first = compileMltXml(project);
    expect(compileMltXml(project)).toBe(first);
    expect(first).toContain('<blank length="10"/>');
    expect(first).toContain(`producer_${clip.id}`);
    expect(first).toContain("A&amp;B.mp4");
    expect(first).not.toContain("rawMlt");
  });

  it("resolves managed project URIs and refuses explicitly offline assets", () => {
    const project = createProject({ name: "Managed compiler" });
    const sequence = project.sequences[project.settings.defaultSequenceId]!;
    const track = sequence.tracks.find(
      (candidate) => candidate.kind === "video",
    )!;
    const asset: Asset = {
      id: createId(),
      name: "Managed.mp4",
      kind: "video",
      uri: `frameos://projects/${project.projectId}/assets/managed.mp4`,
      hash: "abcdef0123456789abcdef0123456789",
      managed: true,
      streams: [],
      duration: frameTime(120, sequence.format.frameRate),
      proxies: [
        `frameos://projects/${project.projectId}/assets/${createId()}-proxy-0123456789abcdef.mp4`,
      ],
      analysisRefs: [],
      licenseMetadata: {},
      semanticMetadata: {},
    };
    const clip: Clip = {
      id: createId(),
      name: "Managed clip",
      type: "clip",
      assetId: asset.id,
      sourceRange: {
        start: frameTime(0, sequence.format.frameRate),
        duration: frameTime(30, sequence.format.frameRate),
      },
      timelineRange: {
        start: frameTime(0, sequence.format.frameRate),
        duration: frameTime(30, sequence.format.frameRate),
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
    const compiled = compileMltXml(project, undefined, {
      resolveFrameosUri: () => "C:\\bundle\\managed.mp4",
    });
    expect(compiled).toContain("C:\\bundle\\managed.mp4");

    const proxyCompiled = compileMltXml(project, undefined, {
      mediaSelection: "prefer_proxy",
      resolveFrameosUri: (uri) =>
        uri.includes("-proxy-")
          ? "C:\\bundle\\managed-proxy.mp4"
          : "C:\\bundle\\managed.mp4",
    });
    expect(proxyCompiled).toContain("C:\\bundle\\managed-proxy.mp4");
    expect(proxyCompiled).not.toContain(
      '<property name="resource">C:\\bundle\\managed.mp4</property>',
    );

    asset.semanticMetadata.offline = true;
    expect(() =>
      compileMltXml(project, undefined, {
        resolveFrameosUri: () => "C:\\bundle\\managed.mp4",
      }),
    ).toThrow(/offline/u);
  });

  it("maps normalized transforms and audio through audited capabilities", () => {
    const project = createProject({
      name: "Mapped compiler",
      width: 1920,
      height: 1080,
    });
    const sequence = project.sequences[project.settings.defaultSequenceId]!;
    const track = sequence.tracks.find(
      (candidate) => candidate.kind === "video",
    )!;
    const asset: Asset = {
      id: createId(),
      name: "Mapped.mp4",
      kind: "video",
      uri: "C:\\media\\Mapped.mp4",
      hash: "11111111111111111111111111111111",
      managed: false,
      streams: [],
      duration: frameTime(240, sequence.format.frameRate),
      proxies: [],
      analysisRefs: [],
      licenseMetadata: {},
      semanticMetadata: {},
    };
    const clip: Clip = {
      id: createId(),
      name: "Mapped clip",
      type: "clip",
      assetId: asset.id,
      sourceRange: {
        start: frameTime(0, sequence.format.frameRate),
        duration: frameTime(60, sequence.format.frameRate),
      },
      timelineRange: {
        start: frameTime(0, sequence.format.frameRate),
        duration: frameTime(60, sequence.format.frameRate),
      },
      enabled: true,
      locked: false,
      metadata: {},
      transform: {
        positionX: 192,
        positionY: -108,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: 0.5,
        scaleY: 0.5,
        rotation: 15,
        opacity: 0.75,
        cropTop: 0.1,
        cropRight: 0.2,
        cropBottom: 0.1,
        cropLeft: 0.2,
        blendMode: "normal",
      },
      timeMap: [],
      effects: [],
      audio: { gainDb: -3, pan: 0.25, muted: false, channelMap: [] },
      links: [],
      semanticMetadata: {},
    };
    project.assets[asset.id] = asset;
    track.items.push(clip);

    const compiled = compileMltXml(project, undefined, {
      availableCapabilities: new Set([
        "mlt.filter.affine",
        "mlt.filter.avfilter.volume",
        "mlt.filter.crop",
        "mlt.filter.panner",
      ]),
    });

    expect(compiled).toContain(
      '<property name="transition.rect">35%/15%:50%x50%:75%</property>',
    );
    expect(compiled).toContain(
      '<property name="transition.fix_rotate_z">15</property>',
    );
    expect(compiled).toContain('<property name="left">384</property>');
    expect(compiled).toContain('<property name="top">108</property>');
    expect(compiled).toContain(
      '<property name="mlt_service">panner</property>',
    );
    expect(compiled).toContain('<property name="split">0.625</property>');
    expect(compiled).toContain(
      '<property name="mlt_service">avfilter.volume</property>',
    );
    expect(compiled).toContain('<property name="av.volume">-3dB</property>');
    expect(compiled).not.toContain(
      '<property name="mlt_service">volume</property>',
    );
  });

  it("maps static primary color controls without exposing raw properties", () => {
    const project = createProject({ name: "Primary color compiler" });
    const sequence = project.sequences[project.settings.defaultSequenceId]!;
    const track = sequence.tracks.find(
      (candidate) => candidate.kind === "video",
    )!;
    const asset: Asset = {
      id: createId(),
      name: "Color.mov",
      kind: "video",
      uri: "C:\\media\\Color.mov",
      hash: "abababababababababababababababab",
      managed: false,
      streams: [],
      duration: frameTime(120, sequence.format.frameRate),
      proxies: [],
      analysisRefs: [],
      licenseMetadata: {},
      semanticMetadata: {},
    };
    const clip: Clip = {
      id: createId(),
      name: "Graded clip",
      type: "clip",
      assetId: asset.id,
      sourceRange: {
        start: frameTime(0, sequence.format.frameRate),
        duration: frameTime(60, sequence.format.frameRate),
      },
      timelineRange: {
        start: frameTime(0, sequence.format.frameRate),
        duration: frameTime(60, sequence.format.frameRate),
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
      effects: [
        {
          id: createId(),
          capabilityId: "frameos.color.primary",
          version: "1.0.0",
          enabled: true,
          parameters: {
            exposureStops: 1.25,
            contrast: 1.15,
            saturation: 0.9,
            whiteBalance: { temperatureKelvin: 5_600, tint: 0 },
            curves: {
              luma: [
                { input: 0, output: 0 },
                { input: 0.5, output: 0.55 },
                { input: 1, output: 1 },
              ],
            },
            lut: {
              uri: `frameos://projects/${project.projectId}/assets/film.cube`,
              intensity: 1,
              interpolation: "tetrahedral",
            },
          },
          automationCurves: [],
        },
      ],
      audio: { gainDb: 0, pan: 0, muted: false, channelMap: [] },
      links: [],
      semanticMetadata: {},
    };
    project.assets[asset.id] = asset;
    track.items.push(clip);

    const compiled = compileMltXml(project, undefined, {
      resolveFrameosUri: () => "C:\\bundle\\film.cube",
      availableCapabilities: new Set([
        "mlt.filter.avfilter.eq",
        "mlt.filter.avfilter.exposure",
        "mlt.filter.avfilter.colortemperature",
        "mlt.filter.avfilter.curves",
        "mlt.filter.avfilter.lut3d",
      ]),
    });
    expect(compiled).toContain(
      '<property name="mlt_service">avfilter.exposure</property>',
    );
    expect(compiled).toContain('<property name="av.exposure">1.25</property>');
    expect(compiled).toContain(
      '<property name="mlt_service">avfilter.eq</property>',
    );
    expect(compiled).toContain('<property name="av.contrast">1.15</property>');
    expect(compiled).toContain('<property name="av.saturation">0.9</property>');
    expect(compiled).toContain('<property name="av.eval">init</property>');
    expect(compiled).toContain(
      '<property name="mlt_service">avfilter.colortemperature</property>',
    );
    expect(compiled).toContain(
      '<property name="av.temperature">5600</property>',
    );
    expect(compiled).toContain(
      '<property name="mlt_service">avfilter.curves</property>',
    );
    expect(compiled).toContain(
      '<property name="av.master">0/0 0.5/0.55 1/1</property>',
    );
    expect(compiled).toContain('<property name="av.interp">pchip</property>');
    expect(compiled).toContain(
      '<property name="mlt_service">avfilter.lut3d</property>',
    );
    expect(compiled).toContain(
      '<property name="av.file">C:\\bundle\\film.cube</property>',
    );
    expect(compiled).toContain(
      '<property name="av.interp">tetrahedral</property>',
    );
    expect(compiled.indexOf("avfilter.exposure")).toBeLessThan(
      compiled.indexOf("avfilter.eq"),
    );
    expect(compiled.indexOf("avfilter.eq")).toBeLessThan(
      compiled.indexOf("avfilter.colortemperature"),
    );
    expect(compiled.indexOf("avfilter.colortemperature")).toBeLessThan(
      compiled.indexOf("avfilter.curves"),
    );
    expect(compiled.indexOf("avfilter.curves")).toBeLessThan(
      compiled.indexOf("avfilter.lut3d"),
    );

    (clip.effects[0]!.parameters.whiteBalance as Record<string, unknown>).tint =
      0.1;
    expect(() =>
      compileMltXml(project, undefined, {
        resolveFrameosUri: () => "C:\\bundle\\film.cube",
        availableCapabilities: new Set([
          "mlt.filter.avfilter.eq",
          "mlt.filter.avfilter.exposure",
          "mlt.filter.avfilter.colortemperature",
          "mlt.filter.avfilter.curves",
          "mlt.filter.avfilter.lut3d",
        ]),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CAPABILITY_UNAVAILABLE",
        message: expect.stringContaining("tint"),
      }),
    );
    (clip.effects[0]!.parameters.whiteBalance as Record<string, unknown>).tint =
      0;
    (clip.effects[0]!.parameters.lut as Record<string, unknown>).intensity =
      0.75;
    expect(() =>
      compileMltXml(project, undefined, {
        resolveFrameosUri: () => "C:\\bundle\\film.cube",
        availableCapabilities: new Set([
          "mlt.filter.avfilter.eq",
          "mlt.filter.avfilter.exposure",
          "mlt.filter.avfilter.colortemperature",
          "mlt.filter.avfilter.curves",
          "mlt.filter.avfilter.lut3d",
        ]),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CAPABILITY_UNAVAILABLE",
        message: expect.stringContaining("Partial 3D LUT intensity"),
      }),
    );
    (clip.effects[0]!.parameters.lut as Record<string, unknown>).intensity = 1;
    clip.effects[0]!.parameters.liftGammaGain = {
      lift: [0, 0, 0],
      gamma: [1, 1, 1],
      gain: [1, 1, 1],
    };
    expect(() =>
      compileMltXml(project, undefined, {
        resolveFrameosUri: () => "C:\\bundle\\film.cube",
        availableCapabilities: new Set([
          "mlt.filter.avfilter.eq",
          "mlt.filter.avfilter.exposure",
          "mlt.filter.avfilter.colortemperature",
          "mlt.filter.avfilter.curves",
          "mlt.filter.avfilter.lut3d",
        ]),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CAPABILITY_UNAVAILABLE",
        message: expect.stringContaining("liftGammaGain"),
      }),
    );
    delete clip.effects[0]!.parameters.liftGammaGain;
    clip.effects[0]!.parameters.saturation = 3.1;
    expect(() =>
      compileMltXml(project, undefined, {
        availableCapabilities: new Set([
          "mlt.filter.avfilter.eq",
          "mlt.filter.avfilter.exposure",
          "mlt.filter.avfilter.colortemperature",
          "mlt.filter.avfilter.curves",
          "mlt.filter.avfilter.lut3d",
        ]),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CAPABILITY_UNAVAILABLE",
        message: expect.stringContaining("0 through 3"),
      }),
    );
  });

  it("maps the normalized static audio channel strip at output scope", () => {
    const project = createProject({
      name: "Audio channel strip",
      frameRate: { numerator: 24, denominator: 1 },
    });
    const sequence = project.sequences[project.settings.defaultSequenceId]!;
    const audioTrack = sequence.tracks.find(
      (candidate) => candidate.kind === "audio",
    )!;
    audioTrack.items.push({
      id: createId(),
      name: "Program duration",
      type: "gap",
      timelineRange: {
        start: frameTime(0, sequence.format.frameRate),
        duration: frameTime(240, sequence.format.frameRate),
      },
      enabled: true,
      locked: false,
      metadata: {},
    });
    const effectId = createId();
    sequence.outputEffects.push({
      id: effectId,
      capabilityId: "frameos.audio.channel-strip",
      version: "1.0.0",
      enabled: true,
      parameters: {
        fades: [
          {
            id: createId(),
            kind: "in",
            duration: frameTime(24, sequence.format.frameRate),
            curve: "equal_power",
          },
          {
            id: createId(),
            kind: "out",
            duration: frameTime(48, sequence.format.frameRate),
            curve: "logarithmic",
          },
        ],
        denoise: { amount: 0.4 },
        eq: {
          bands: [
            {
              id: createId(),
              kind: "low_cut",
              frequencyHz: 80,
              gainDb: 0,
              q: 0.707,
              enabled: true,
            },
            {
              id: createId(),
              kind: "low_shelf",
              frequencyHz: 120,
              gainDb: 1.5,
              q: 0.8,
              enabled: true,
            },
            {
              id: createId(),
              kind: "bell",
              frequencyHz: 3_000,
              gainDb: 2.5,
              q: 1.2,
              enabled: true,
            },
            {
              id: createId(),
              kind: "high_shelf",
              frequencyHz: 8_000,
              gainDb: -1,
              q: 0.9,
              enabled: true,
            },
            {
              id: createId(),
              kind: "high_cut",
              frequencyHz: 18_000,
              gainDb: 0,
              q: 0.707,
              enabled: true,
            },
          ],
        },
        compressor: {
          thresholdDb: -18,
          ratio: 3,
          attackMs: 15,
          releaseMs: 120,
          kneeDb: 6,
          makeupGainDb: 2,
        },
        limiter: { ceilingDb: -1, releaseMs: 80, lookaheadMs: 5 },
        normalization: {
          targetLufs: -16,
          truePeakDb: -1,
          mode: "integrated",
        },
      },
      automationCurves: [],
    });
    const capabilities = new Set([
      "mlt.filter.avfilter.afade",
      "mlt.filter.avfilter.afftdn",
      "mlt.filter.avfilter.equalizer",
      "mlt.filter.avfilter.highpass",
      "mlt.filter.avfilter.highshelf",
      "mlt.filter.avfilter.lowpass",
      "mlt.filter.avfilter.lowshelf",
      "mlt.filter.avfilter.acompressor",
      "mlt.filter.avfilter.alimiter",
      "mlt.filter.avfilter.loudnorm",
    ]);

    const compiled = compileMltXml(project, undefined, {
      availableCapabilities: capabilities,
    });
    const orderedServices = [
      "avfilter.afftdn",
      "avfilter.highpass",
      "avfilter.lowshelf",
      "avfilter.equalizer",
      "avfilter.highshelf",
      "avfilter.lowpass",
      "avfilter.acompressor",
      "avfilter.alimiter",
      "avfilter.loudnorm",
      "avfilter.afade",
    ];
    let previous = -1;
    for (const service of orderedServices) {
      const position = compiled.indexOf(
        `<property name="mlt_service">${service}</property>`,
      );
      expect(position).toBeGreaterThan(previous);
      previous = position;
    }
    expect(compiled).toContain(
      '<property name="av.threshold">0.125893</property>',
    );
    expect(compiled).toContain('<property name="av.limit">0.891251</property>');
    expect(compiled).toContain('<property name="av.I">-16</property>');
    expect(compiled).toContain('<property name="av.TP">-1</property>');
    expect(compiled).toContain('<property name="av.start_sample">0</property>');
    expect(compiled).toContain(
      '<property name="av.start_sample">384000</property>',
    );
    expect(compiled).toContain(
      '<property name="av.nb_samples">48000</property>',
    );
    expect(compiled).toContain('<property name="av.curve">qsin</property>');
    expect(compiled).toContain('<property name="av.curve">log</property>');
    expect(compiled.indexOf("avfilter.loudnorm")).toBeGreaterThan(
      compiled.indexOf("</multitrack>"),
    );

    sequence.outputEffects[0]!.parameters.ducking = {
      sidechainId: createId(),
    };
    expect(() =>
      compileMltXml(project, undefined, {
        availableCapabilities: capabilities,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CAPABILITY_UNAVAILABLE",
        message: expect.stringContaining("ducking"),
      }),
    );
  });

  it("applies normalized color effects at track and output scopes", () => {
    const project = createProject({ name: "Scoped color" });
    const sequence = project.sequences[project.settings.defaultSequenceId]!;
    const videoTrack = sequence.tracks.find(
      (candidate) => candidate.kind === "video",
    )!;
    videoTrack.effects.push({
      id: createId(),
      capabilityId: "frameos.color.primary",
      version: "1.0.0",
      enabled: true,
      parameters: { contrast: 1.1 },
      automationCurves: [],
    });
    sequence.outputEffects.push({
      id: createId(),
      capabilityId: "frameos.color.primary",
      version: "1.0.0",
      enabled: true,
      parameters: { saturation: 0.95 },
      automationCurves: [],
    });

    const compiled = compileMltXml(project, undefined, {
      availableCapabilities: new Set(["mlt.filter.avfilter.eq"]),
    });
    expect(compiled.match(/avfilter\.eq/gu)).toHaveLength(2);
    expect(compiled.indexOf("avfilter.eq")).toBeLessThan(
      compiled.indexOf("</playlist>"),
    );
    expect(compiled.lastIndexOf("avfilter.eq")).toBeGreaterThan(
      compiled.indexOf("</multitrack>"),
    );

    const audioTrack = sequence.tracks.find(
      (candidate) => candidate.kind === "audio",
    )!;
    audioTrack.effects.push({
      id: createId(),
      capabilityId: "frameos.color.primary",
      version: "1.0.0",
      enabled: true,
      parameters: { contrast: 1.1 },
      automationCurves: [],
    });
    expect(() =>
      compileMltXml(project, undefined, {
        availableCapabilities: new Set(["mlt.filter.avfilter.eq"]),
      }),
    ).toThrow(/cannot be attached to a audio track/u);
  });

  it("fails with the exact missing capability instead of dropping an edit", () => {
    const project = createProject({ name: "Capability failure" });
    const sequence = project.sequences[project.settings.defaultSequenceId]!;
    const track = sequence.tracks.find(
      (candidate) => candidate.kind === "video",
    )!;
    const asset: Asset = {
      id: createId(),
      name: "Capability.mp4",
      kind: "video",
      uri: "C:\\media\\Capability.mp4",
      hash: "22222222222222222222222222222222",
      managed: false,
      streams: [],
      duration: frameTime(120, sequence.format.frameRate),
      proxies: [],
      analysisRefs: [],
      licenseMetadata: {},
      semanticMetadata: {},
    };
    const clip: Clip = {
      id: createId(),
      name: "Capability clip",
      type: "clip",
      assetId: asset.id,
      sourceRange: {
        start: frameTime(0, sequence.format.frameRate),
        duration: frameTime(30, sequence.format.frameRate),
      },
      timelineRange: {
        start: frameTime(0, sequence.format.frameRate),
        duration: frameTime(30, sequence.format.frameRate),
      },
      enabled: true,
      locked: false,
      metadata: {},
      transform: {
        positionX: 10,
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

    expect(() => compileMltXml(project)).toThrowError(
      expect.objectContaining({
        code: "CAPABILITY_UNAVAILABLE",
        details: [expect.objectContaining({ value: "mlt.filter.affine" })],
      }),
    );
  });

  it("compiles same-track transitions as timeline-preserving media subgraphs", () => {
    const project = createProject({
      name: "Transition compiler",
      frameRate: { numerator: 24, denominator: 1 },
    });
    const sequence = project.sequences[project.settings.defaultSequenceId]!;
    const track = sequence.tracks.find(
      (candidate) => candidate.kind === "video",
    )!;
    const asset: Asset = {
      id: createId(),
      name: "Transition.mp4",
      kind: "video",
      uri: "C:\\media\\Transition.mp4",
      hash: "33333333333333333333333333333333",
      managed: false,
      streams: [],
      duration: frameTime(240, sequence.format.frameRate),
      proxies: [],
      analysisRefs: [],
      licenseMetadata: {},
      semanticMetadata: {},
    };
    const left: Clip = {
      id: createId(),
      name: "Left",
      type: "clip",
      assetId: asset.id,
      sourceRange: {
        start: frameTime(20, sequence.format.frameRate),
        duration: frameTime(50, sequence.format.frameRate),
      },
      timelineRange: {
        start: frameTime(0, sequence.format.frameRate),
        duration: frameTime(50, sequence.format.frameRate),
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
    const right: Clip = structuredClone(left);
    right.id = createId();
    right.name = "Right";
    right.sourceRange.start = frameTime(100, sequence.format.frameRate);
    right.timelineRange.start = frameTime(50, sequence.format.frameRate);
    const transitionId = createId();
    project.assets[asset.id] = asset;
    track.items.push(left, right, {
      id: transitionId,
      name: "Dissolve",
      type: "transition",
      timelineRange: {
        start: frameTime(45, sequence.format.frameRate),
        duration: frameTime(10, sequence.format.frameRate),
      },
      enabled: true,
      locked: false,
      metadata: {},
      capabilityId: "frameos.transition.dissolve",
      fromItemId: left.id,
      toItemId: right.id,
      parameters: { softness: 0.2 },
      automationCurves: [],
    });

    const videoGraph = compileMltXml(project, undefined, {
      availableCapabilities: new Set(["mlt.transition.luma"]),
    });
    expect(videoGraph).toContain(
      `<entry producer="producer_${left.id}" in="65" out="74"/>`,
    );
    expect(videoGraph).toContain(
      `<entry producer="producer_${right.id}" in="95" out="104"/>`,
    );
    expect(videoGraph).toContain(
      `<entry producer="transition_${transitionId}" in="0" out="9"/>`,
    );
    expect(videoGraph).toContain(
      `<track producer="transition_${transitionId}_cut" hide="video"/>`,
    );
    expect(videoGraph).toContain(
      '<property name="mlt_service">luma</property>',
    );
    expect(videoGraph).toContain('<property name="softness">0.2</property>');

    const transition = track.items.find(
      (item) => item.id === transitionId && item.type === "transition",
    );
    expect(transition?.type).toBe("transition");
    if (transition?.type !== "transition") return;
    transition.capabilityId = "frameos.transition.audio_crossfade";
    transition.parameters = { curve: "equal_power" };
    const audioGraph = compileMltXml(project, undefined, {
      availableCapabilities: new Set(["mlt.transition.mix"]),
    });
    expect(audioGraph).toContain(
      `<track producer="transition_${transitionId}_cut" hide="audio"/>`,
    );
    expect(audioGraph).toContain('<property name="mlt_service">mix</property>');
    expect(audioGraph).toContain('<property name="a_track">1</property>');
    expect(audioGraph).toContain('<property name="b_track">2</property>');
    expect(audioGraph).toContain('<property name="start">-2</property>');
  });

  it("compiles the normalized solid generator without exposing MLT properties", () => {
    const project = createProject({ name: "Generator compiler" });
    const sequence = project.sequences[project.settings.defaultSequenceId]!;
    const track = sequence.tracks.find(
      (candidate) => candidate.kind === "video",
    )!;
    const generator: Generator = {
      id: createId(),
      name: "Brand background",
      type: "generator",
      timelineRange: {
        start: frameTime(12, sequence.format.frameRate),
        duration: frameTime(48, sequence.format.frameRate),
      },
      enabled: true,
      locked: false,
      metadata: {},
      capabilityId: "frameos.generator.solid",
      parameters: { color: "#ff00ff", opacity: 0.5 },
      effects: [],
    };
    track.items.push(generator);

    const compiled = compileMltXml(project, undefined, {
      availableCapabilities: new Set(["mlt.producer.color"]),
    });
    expect(compiled).toContain('<property name="mlt_service">color</property>');
    expect(compiled).toContain(
      '<property name="resource">0xff00ff80</property>',
    );
    expect(compiled).toContain('<blank length="12"/>');
    expect(compiled).toContain(
      `<entry producer="producer_generator_${generator.id}" in="0" out="47"/>`,
    );
    expect(compiled).not.toContain("frameos.generator.solid");
  });

  it("compiles normalized titles and caption cues through the audited qtext filter", () => {
    const project = createProject({
      name: "Text compiler",
      frameRate: { numerator: 24, denominator: 1 },
    });
    const sequence = project.sequences[project.settings.defaultSequenceId]!;
    const track = sequence.tracks.find(
      (candidate) => candidate.kind === "video",
    )!;
    const title: Title = {
      id: createId(),
      name: "Opening title",
      type: "title",
      text: "FrameOS <launch>",
      timelineRange: {
        start: frameTime(0, sequence.format.frameRate),
        duration: frameTime(24, sequence.format.frameRate),
      },
      enabled: true,
      locked: false,
      metadata: {},
      style: {
        placement: "center",
        fontFamily: "Inter",
        fontSize: 96,
        foregroundColor: "0xffffffff",
        animation: "typewriter",
        typewriterStepFrames: 2,
      },
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
      effects: [],
    };
    const captions: CaptionTrack = {
      id: createId(),
      name: "English",
      language: "en",
      enabled: true,
      style: {
        preset: "frameos.dynamic-caption-v1",
        placement: "bottom-center",
        safeArea: 0.8,
        fontSize: 56,
        wordHighlight: false,
      },
      cues: [
        {
          id: createId(),
          range: {
            start: frameTime(24, sequence.format.frameRate),
            duration: frameTime(48, sequence.format.frameRate),
          },
          text: "Agent-safe & deterministic",
          words: [],
          style: {},
        },
      ],
    };
    track.items.push(title);
    sequence.captions.push(captions);

    const compiled = compileMltXml(project, undefined, {
      availableCapabilities: new Set([
        "mlt.producer.color",
        "mlt.filter.qtext",
      ]),
    });
    expect(compiled).toContain('<property name="mlt_service">qtext</property>');
    expect(compiled).toContain(
      '<property name="argument">FrameOS &lt;launch&gt;</property>',
    );
    expect(compiled).toContain(
      '<property name="argument">Agent-safe &amp; deterministic</property>',
    );
    expect(compiled).toContain(
      '<property name="typewriter.step_length">2</property>',
    );
    expect(compiled).toContain(
      '<property name="geometry">10%/68%:80%x22%:100</property>',
    );
    expect(compiled).toContain(
      `<entry producer="producer_text_${title.id}" in="0" out="23"/>`,
    );
    expect(compiled).toContain(
      `<track producer="caption_playlist_${captions.id}" hide="audio"/>`,
    );
    expect(compiled).not.toContain("frameos.dynamic-caption-v1");
  });

  it("recursively compiles matching-format nested sequences", () => {
    const project = createProject({ name: "Nested compiler" });
    const parent = project.sequences[project.settings.defaultSequenceId]!;
    const parentTrack = parent.tracks.find((track) => track.kind === "video")!;
    const nested = structuredClone(parent);
    nested.id = createId();
    nested.name = "Nested scene";
    for (const track of nested.tracks) {
      track.id = createId();
      track.items = [];
    }
    const nestedTrack = nested.tracks.find((track) => track.kind === "video")!;
    const generatorId = createId();
    nestedTrack.items.push({
      id: generatorId,
      name: "Nested background",
      type: "generator",
      timelineRange: {
        start: frameTime(0, nested.format.frameRate),
        duration: frameTime(30, nested.format.frameRate),
      },
      enabled: true,
      locked: false,
      metadata: {},
      capabilityId: "frameos.generator.solid",
      parameters: { color: "#123456", opacity: 1 },
      effects: [],
    });
    project.sequences[nested.id] = nested;
    const nestedItemId = createId();
    parentTrack.items.push({
      id: nestedItemId,
      name: "Nested instance",
      type: "nested_sequence",
      sequenceId: nested.id,
      timelineRange: {
        start: frameTime(10, parent.format.frameRate),
        duration: frameTime(30, parent.format.frameRate),
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
      effects: [],
      audio: { gainDb: 0, pan: 0, muted: false, channelMap: [] },
    });

    const compiled = compileMltXml(project, undefined, {
      availableCapabilities: new Set([
        "mlt.producer.color",
        "mlt.producer.xml",
      ]),
    });
    expect(compiled).toContain(`<tractor id="sequence_${nested.id}">`);
    expect(compiled).toContain(
      `<entry producer="sequence_${nested.id}" in="0" out="29"/>`,
    );
    expect(
      compiled.indexOf(`<tractor id="sequence_${nested.id}">`),
    ).toBeLessThan(compiled.indexOf('<tractor id="frameos_output">'));
    expect(compiled).toContain(
      `<producer id="producer_generator_${generatorId}">`,
    );
    expect(compiled).toContain('<blank length="10"/>');
  });
});
