import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import {
  FrameOSError,
  capabilityDescriptorSchema,
  mediaProbeResultSchema,
  type CapabilityDescriptor,
  type MediaProbeResult,
  type RenderProfile,
} from "@frameos/contracts";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const engineUnavailable: CapabilityDescriptor =
  capabilityDescriptorSchema.parse({
    id: "engine.mlt",
    kind: "producer",
    name: "MLT editing engine",
    description: "FrameOS native MLT 7.40 editing and render worker",
    available: false,
    baseline: true,
    provider: "mlt",
    providerVersion: "7.40",
    license: "LGPL-2.1",
    reasonUnavailable: "An audited FrameOS engine worker was not configured",
    alternatives: [],
    metadata: { rawMltPropertiesExposed: false },
  });

const probeUnavailable: CapabilityDescriptor = capabilityDescriptorSchema.parse(
  {
    id: "media.probe",
    kind: "analyzer",
    name: "MLT/FFmpeg media probe",
    description:
      "Normalized stream and duration discovery through the audited avformat module",
    available: false,
    baseline: true,
    provider: "mlt-avformat",
    providerVersion: "7.40",
    license: "audit-required",
    reasonUnavailable: "An audited FrameOS engine worker was not configured",
    alternatives: [],
    metadata: {},
  },
);

const previewUnavailable: CapabilityDescriptor[] = ["frame", "region"].map(
  (kind) =>
    capabilityDescriptorSchema.parse({
      id: `preview.${kind}`,
      kind: "consumer",
      name: `${kind} preview renderer`,
      description: `Frame-accurate ${kind} preview generation through the audited MLT worker`,
      available: false,
      baseline: true,
      provider: "frameos-mlt",
      providerVersion: "0.1.0",
      license: "LGPL-2.1",
      reasonUnavailable: "An audited FrameOS engine worker was not configured",
      alternatives: [],
      metadata: {},
    }),
);

const waveformUnavailable: CapabilityDescriptor =
  capabilityDescriptorSchema.parse({
    id: "preview.waveform",
    kind: "consumer",
    name: "PCM waveform renderer",
    description:
      "Deterministic SVG waveform generation through the native worker",
    available: false,
    baseline: true,
    provider: "frameos-native",
    providerVersion: "0.1.0",
    license: "MIT",
    reasonUnavailable: "A FrameOS native worker was not configured",
    alternatives: [],
    metadata: { formats: ["wav-pcm16-le"] },
  });

const waveformResultSchema = z
  .object({
    status: z.literal("completed"),
    sampleRate: z.int().positive(),
    channels: z.int().positive().max(64),
    channel: z.int().nonnegative().max(63).nullable(),
    sampleFrames: z.int().nonnegative(),
    startMs: z.int().nonnegative(),
    endMs: z.int().nonnegative(),
  })
  .strict();

export type WaveformWorkerResult = z.infer<typeof waveformResultSchema>;

const proxyUnavailable: CapabilityDescriptor = capabilityDescriptorSchema.parse(
  {
    id: "asset.proxy.create",
    kind: "consumer",
    name: "Managed editing proxy transcoder",
    description:
      "Aspect-preserving MP4 editing proxies through the audited MLT avformat adapter",
    available: false,
    baseline: true,
    provider: "frameos-mlt",
    providerVersion: "0.1.0",
    license: "audit-required",
    reasonUnavailable: "An audited FrameOS MLT worker was not configured",
    alternatives: [],
    metadata: { managed: true, rawPropertiesExposed: false },
  },
);

const proxyResultSchema = z
  .object({
    status: z.literal("completed"),
    width: z.int().positive(),
    height: z.int().positive(),
    container: z.literal("mp4"),
    videoCodec: z.string().min(1).max(128),
    audioCodec: z.string().min(1).max(128),
  })
  .strict();

export type ProxyWorkerResult = z.infer<typeof proxyResultSchema>;

const thumbnailUnavailable: CapabilityDescriptor =
  capabilityDescriptorSchema.parse({
    id: "asset.thumbnail.create",
    kind: "consumer",
    name: "Source-time thumbnail renderer",
    description:
      "Frame-accurate bounded PNG thumbnails through the audited MLT avformat adapter",
    available: false,
    baseline: true,
    provider: "frameos-mlt",
    providerVersion: "0.1.0",
    license: "audit-required",
    reasonUnavailable: "An audited FrameOS MLT worker was not configured",
    alternatives: [],
    metadata: { rawPropertiesExposed: false },
  });

const thumbnailResultSchema = z
  .object({
    status: z.literal("completed"),
    width: z.int().positive(),
    height: z.int().positive(),
    timeMs: z.int().nonnegative(),
    frame: z.int().nonnegative(),
    format: z.literal("png"),
  })
  .strict();

export type ThumbnailWorkerResult = z.infer<typeof thumbnailResultSchema>;

const baselineServiceUnavailable: CapabilityDescriptor[] = [
  ["mlt.consumer.avformat", "consumer", "audit-required"],
  ["mlt.filter.affine", "filter", "LGPL-2.1-or-later"],
  ["mlt.filter.avfilter.acompressor", "filter", "audit-required"],
  ["mlt.filter.avfilter.afade", "filter", "audit-required"],
  ["mlt.filter.avfilter.afftdn", "filter", "audit-required"],
  ["mlt.filter.avfilter.alimiter", "filter", "audit-required"],
  ["mlt.filter.avfilter.colortemperature", "filter", "audit-required"],
  ["mlt.filter.avfilter.curves", "filter", "audit-required"],
  ["mlt.filter.avfilter.eq", "filter", "audit-required"],
  ["mlt.filter.avfilter.equalizer", "filter", "audit-required"],
  ["mlt.filter.avfilter.exposure", "filter", "audit-required"],
  ["mlt.filter.avfilter.highpass", "filter", "audit-required"],
  ["mlt.filter.avfilter.highshelf", "filter", "audit-required"],
  ["mlt.filter.avfilter.loudnorm", "filter", "audit-required"],
  ["mlt.filter.avfilter.lowpass", "filter", "audit-required"],
  ["mlt.filter.avfilter.lowshelf", "filter", "audit-required"],
  ["mlt.filter.avfilter.lut3d", "filter", "audit-required"],
  ["mlt.filter.avfilter.volume", "filter", "audit-required"],
  ["mlt.filter.crop", "filter", "LGPL-2.1-or-later"],
  ["mlt.filter.panner", "filter", "LGPL-2.1-or-later"],
  ["mlt.filter.qtext", "filter", "LGPL-2.1-or-later"],
  ["mlt.producer.avformat", "producer", "audit-required"],
  ["mlt.producer.avformat-novalidate", "producer", "audit-required"],
  ["mlt.producer.color", "producer", "LGPL-2.1-or-later"],
  ["mlt.producer.xml", "producer", "LGPL-2.1-or-later"],
  ["mlt.transition.luma", "transition", "LGPL-2.1-or-later"],
  ["mlt.transition.mix", "transition", "LGPL-2.1-or-later"],
].map(([id, kind, license]) =>
  capabilityDescriptorSchema.parse({
    id,
    kind,
    name: id,
    description: "Audited MLT baseline service",
    available: false,
    baseline: true,
    provider: "mlt",
    providerVersion: "7.40",
    license,
    reasonUnavailable: "An audited FrameOS engine worker was not configured",
    alternatives: [],
    metadata: { allowlisted: true },
  }),
);

export class EngineWorkerClient {
  public constructor(private readonly workerPath?: string) {}

  public async discoverCapabilities(): Promise<CapabilityDescriptor[]> {
    if (this.workerPath === undefined) {
      return [
        engineUnavailable,
        probeUnavailable,
        ...previewUnavailable,
        waveformUnavailable,
        proxyUnavailable,
        thumbnailUnavailable,
        ...baselineServiceUnavailable,
      ];
    }
    try {
      await access(this.workerPath);
      const { stdout } = await execFileAsync(
        this.workerPath,
        ["capabilities"],
        {
          encoding: "utf8",
          timeout: 10_000,
          windowsHide: true,
          maxBuffer: 4 * 1_024 * 1_024,
        },
      );
      const parsed = JSON.parse(stdout) as unknown;
      return capabilityDescriptorSchema.array().parse(parsed);
    } catch (error) {
      return [
        {
          ...engineUnavailable,
          reasonUnavailable: `Engine worker capability discovery failed: ${(error as Error).message}`,
        },
        {
          ...probeUnavailable,
          reasonUnavailable: `Media probe capability discovery failed: ${(error as Error).message}`,
        },
        ...previewUnavailable.map((capability) => ({
          ...capability,
          reasonUnavailable: `Preview capability discovery failed: ${(error as Error).message}`,
        })),
        {
          ...waveformUnavailable,
          reasonUnavailable: `Waveform capability discovery failed: ${(error as Error).message}`,
        },
        {
          ...proxyUnavailable,
          reasonUnavailable: `Proxy capability discovery failed: ${(error as Error).message}`,
        },
        {
          ...thumbnailUnavailable,
          reasonUnavailable: `Thumbnail capability discovery failed: ${(error as Error).message}`,
        },
        ...baselineServiceUnavailable.map((capability) => ({
          ...capability,
          reasonUnavailable: `Engine service discovery failed: ${(error as Error).message}`,
        })),
      ];
    }
  }

  public async requireMlt(
    discoveredCapabilities?: readonly CapabilityDescriptor[],
  ): Promise<void> {
    const capabilities =
      discoveredCapabilities ?? (await this.discoverCapabilities());
    if (
      !capabilities.some(
        (capability) => capability.id === "engine.mlt" && capability.available,
      )
    ) {
      throw new FrameOSError(
        "CAPABILITY_UNAVAILABLE",
        capabilities.find((capability) => capability.id === "engine.mlt")
          ?.reasonUnavailable ?? "MLT engine is unavailable",
        424,
      );
    }
  }

  private async requireCapability(
    id: string,
    discoveredCapabilities?: readonly CapabilityDescriptor[],
  ): Promise<void> {
    const capabilities =
      discoveredCapabilities ?? (await this.discoverCapabilities());
    const capability = capabilities.find((candidate) => candidate.id === id);
    if (capability?.available !== true) {
      throw new FrameOSError(
        "CAPABILITY_UNAVAILABLE",
        capability?.reasonUnavailable ?? `Capability ${id} is unavailable`,
        424,
      );
    }
  }

  public async waveform(
    inputPath: string,
    outputPath: string,
    options: {
      width: number;
      height: number;
      startMs?: number;
      endMs?: number;
      channel?: number;
    },
    signal?: AbortSignal,
    discoveredCapabilities?: readonly CapabilityDescriptor[],
  ): Promise<WaveformWorkerResult> {
    await this.requireCapability("preview.waveform", discoveredCapabilities);
    if (this.workerPath === undefined) {
      throw new FrameOSError(
        "CAPABILITY_UNAVAILABLE",
        "Native waveform generation is unavailable",
        424,
      );
    }
    try {
      const { stdout } = await execFileAsync(
        this.workerPath,
        [
          "waveform",
          inputPath,
          outputPath,
          String(options.width),
          String(options.height),
          String(options.startMs ?? 0),
          String(options.endMs ?? -1),
          String(options.channel ?? -1),
        ],
        {
          encoding: "utf8",
          timeout: 10 * 60 * 1_000,
          windowsHide: true,
          maxBuffer: 1 * 1_024 * 1_024,
          ...(signal === undefined ? {} : { signal }),
        },
      );
      return waveformResultSchema.parse(JSON.parse(stdout));
    } catch (error) {
      if (signal?.aborted === true) {
        throw new FrameOSError(
          "JOB_CANCELLED",
          "Waveform generation was cancelled",
          409,
        );
      }
      if (error instanceof FrameOSError) throw error;
      throw new FrameOSError(
        "UNSUPPORTED_FORMAT",
        `Native waveform generation failed: ${(error as Error).message}`,
        422,
      );
    }
  }

  public async createProxy(
    inputPath: string,
    outputPath: string,
    options: { maxWidth: number; maxHeight: number },
    signal?: AbortSignal,
    discoveredCapabilities?: readonly CapabilityDescriptor[],
  ): Promise<ProxyWorkerResult> {
    await this.requireCapability("asset.proxy.create", discoveredCapabilities);
    if (this.workerPath === undefined) {
      throw new FrameOSError(
        "CAPABILITY_UNAVAILABLE",
        "Native proxy generation is unavailable",
        424,
      );
    }
    try {
      const { stdout } = await execFileAsync(
        this.workerPath,
        [
          "proxy",
          inputPath,
          outputPath,
          String(options.maxWidth),
          String(options.maxHeight),
        ],
        {
          encoding: "utf8",
          timeout: 24 * 60 * 60 * 1_000,
          windowsHide: true,
          maxBuffer: 1 * 1_024 * 1_024,
          ...(signal === undefined ? {} : { signal }),
        },
      );
      return proxyResultSchema.parse(JSON.parse(stdout));
    } catch (error) {
      if (signal?.aborted === true) {
        throw new FrameOSError(
          "JOB_CANCELLED",
          "Proxy generation was cancelled",
          409,
        );
      }
      if (error instanceof FrameOSError) throw error;
      throw new FrameOSError(
        "PLUGIN_FAILURE",
        `Native proxy generation failed: ${(error as Error).message}`,
        500,
      );
    }
  }

  public async createThumbnail(
    inputPath: string,
    outputPath: string,
    options: { timeMs: number; maxWidth: number; maxHeight: number },
    signal?: AbortSignal,
    discoveredCapabilities?: readonly CapabilityDescriptor[],
  ): Promise<ThumbnailWorkerResult> {
    await this.requireCapability(
      "asset.thumbnail.create",
      discoveredCapabilities,
    );
    if (this.workerPath === undefined) {
      throw new FrameOSError(
        "CAPABILITY_UNAVAILABLE",
        "Native thumbnail generation is unavailable",
        424,
      );
    }
    try {
      const { stdout } = await execFileAsync(
        this.workerPath,
        [
          "thumbnail",
          inputPath,
          outputPath,
          String(options.timeMs),
          String(options.maxWidth),
          String(options.maxHeight),
        ],
        {
          encoding: "utf8",
          timeout: 10 * 60 * 1_000,
          windowsHide: true,
          maxBuffer: 1 * 1_024 * 1_024,
          ...(signal === undefined ? {} : { signal }),
        },
      );
      return thumbnailResultSchema.parse(JSON.parse(stdout));
    } catch (error) {
      if (signal?.aborted === true) {
        throw new FrameOSError(
          "JOB_CANCELLED",
          "Thumbnail generation was cancelled",
          409,
        );
      }
      if (error instanceof FrameOSError) throw error;
      throw new FrameOSError(
        "PLUGIN_FAILURE",
        `Native thumbnail generation failed: ${(error as Error).message}`,
        500,
      );
    }
  }

  public async render(
    mltXmlPath: string,
    outputPath: string,
    profile?: RenderProfile,
    signal?: AbortSignal,
    frameRange?: { start: number; end: number },
    discoveredCapabilities?: readonly CapabilityDescriptor[],
  ): Promise<string> {
    await this.requireMlt(discoveredCapabilities);
    if (this.workerPath === undefined) {
      throw new FrameOSError(
        "CAPABILITY_UNAVAILABLE",
        "MLT engine is unavailable",
        424,
      );
    }
    try {
      const argumentsList = [
        frameRange === undefined ? "render" : "render-region",
        mltXmlPath,
        outputPath,
      ];
      if (frameRange !== undefined) {
        argumentsList.push(String(frameRange.start), String(frameRange.end));
      }
      if (profile !== undefined) {
        argumentsList.push(
          profile.container,
          profile.videoCodec ?? "",
          profile.audioCodec ?? "",
          String(profile.sampleRate),
          String(profile.channels),
        );
      }
      const { stdout } = await execFileAsync(this.workerPath, argumentsList, {
        encoding: "utf8",
        timeout: 24 * 60 * 60 * 1_000,
        windowsHide: true,
        maxBuffer: 4 * 1_024 * 1_024,
        ...(signal === undefined ? {} : { signal }),
      });
      return stdout.trim();
    } catch (error) {
      if (signal?.aborted === true) {
        throw new FrameOSError("JOB_CANCELLED", "Render was cancelled", 409);
      }
      throw new FrameOSError(
        "PLUGIN_FAILURE",
        `Engine worker render failed: ${(error as Error).message}`,
        500,
      );
    }
  }

  public async probe(
    path: string,
    signal?: AbortSignal,
  ): Promise<MediaProbeResult> {
    await this.requireMlt();
    if (this.workerPath === undefined) {
      throw new FrameOSError(
        "CAPABILITY_UNAVAILABLE",
        "MLT/FFmpeg media probing is unavailable",
        424,
      );
    }
    try {
      const { stdout } = await execFileAsync(this.workerPath, ["probe", path], {
        encoding: "utf8",
        timeout: 2 * 60 * 1_000,
        windowsHide: true,
        maxBuffer: 4 * 1_024 * 1_024,
        ...(signal === undefined ? {} : { signal }),
      });
      return mediaProbeResultSchema.parse(JSON.parse(stdout));
    } catch (error) {
      if (signal?.aborted === true) {
        throw new FrameOSError(
          "JOB_CANCELLED",
          "Media probe was cancelled",
          409,
        );
      }
      if (error instanceof FrameOSError) throw error;
      throw new FrameOSError(
        "UNSUPPORTED_FORMAT",
        `Native media probing failed: ${(error as Error).message}`,
        422,
      );
    }
  }
}
