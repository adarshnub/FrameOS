import {
  operationCatalog,
  type AnalyzerDescriptor,
  type CapabilityDescriptor,
  type OperationDescriptor,
} from "@frameos/contracts";
import type { EngineWorkerClient } from "../engine/worker-client.js";
import { analyzerDescriptors } from "../analysis/analysis-service.js";

interface AdapterCapabilityDefinition {
  id: string;
  kind: CapabilityDescriptor["kind"];
  name: string;
  description: string;
  dependencies: string[];
  parameters: Record<string, unknown>;
}

const adapterCapabilityDefinitions: AdapterCapabilityDefinition[] = [
  {
    id: "preview.contact_sheet",
    kind: "consumer",
    name: "Contact-sheet preview renderer",
    description:
      "Sample multiple frame-accurate PNG previews through one immutable compiled graph.",
    dependencies: ["engine.mlt", "preview.frame"],
    parameters: {
      frameCount: { type: "integer", minimum: 2, maximum: 64 },
      columns: { type: "integer", minimum: 1, maximum: 16 },
    },
  },
  {
    id: "frameos.generator.solid",
    kind: "producer",
    name: "Solid color generator",
    description: "Generate a full-frame solid color with normalized opacity.",
    dependencies: ["engine.mlt", "mlt.producer.color"],
    parameters: {
      type: "object",
      properties: {
        color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
        opacity: { type: "number", minimum: 0, maximum: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    id: "frameos.video.transform",
    kind: "filter",
    name: "Clip transform",
    description:
      "Position, anchor, positive scale, center-anchor rotation, and opacity using FrameOS coordinates.",
    dependencies: ["engine.mlt", "mlt.filter.affine"],
    parameters: { contract: "Transform" },
  },
  {
    id: "frameos.video.crop",
    kind: "filter",
    name: "Clip crop",
    description: "Crop clip edges using normalized FrameOS fractions.",
    dependencies: ["engine.mlt", "mlt.filter.crop"],
    parameters: { unit: "normalized", minimum: 0, maximum: 1 },
  },
  {
    id: "frameos.audio.pan",
    kind: "filter",
    name: "Clip audio pan",
    description: "Pan or balance clip audio from -1 (left) to 1 (right).",
    dependencies: ["engine.mlt", "mlt.filter.panner"],
    parameters: { pan: { type: "number", minimum: -1, maximum: 1 } },
  },
  {
    id: "frameos.audio.gain",
    kind: "filter",
    name: "Clip audio gain and mute",
    description: "Apply normalized decibel gain or mute to clip audio.",
    dependencies: ["engine.mlt", "mlt.filter.avfilter.volume"],
    parameters: {
      gainDb: { type: "number", minimum: -120, maximum: 48 },
      muted: { type: "boolean" },
    },
  },
  {
    id: "frameos.color.primary",
    kind: "filter",
    name: "Primary color correction",
    description:
      "Apply static exposure, contrast, and saturation through normalized FrameOS controls.",
    dependencies: [
      "engine.mlt",
      "mlt.filter.avfilter.exposure",
      "mlt.filter.avfilter.eq",
      "mlt.filter.avfilter.colortemperature",
      "mlt.filter.avfilter.curves",
      "mlt.filter.avfilter.lut3d",
    ],
    parameters: {
      type: "object",
      properties: {
        exposureStops: { type: "number", minimum: -3, maximum: 3 },
        contrast: { type: "number", minimum: 0, maximum: 4 },
        saturation: { type: "number", minimum: 0, maximum: 3 },
        whiteBalance: {
          temperatureKelvin: { type: "number", minimum: 1000, maximum: 40000 },
          tint: { const: 0 },
        },
        curves: {
          channels: ["rgb", "red", "green", "blue", "luma"],
          interpolation: "pchip",
        },
        lut: {
          uri: { type: "string", suffix: ".cube" },
          intensity: { enum: [0, 1] },
          interpolation: { enum: ["trilinear", "tetrahedral"] },
        },
      },
      additionalProperties: false,
      restrictions: ["static", "unmasked", "full clip range"],
    },
  },
  {
    id: "frameos.audio.channel-strip",
    kind: "filter",
    name: "Static audio channel strip",
    description:
      "Apply a deterministic denoise, EQ, compressor, limiter, and integrated-loudness chain at clip, track, or sequence output scope.",
    dependencies: [
      "engine.mlt",
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
    ],
    parameters: {
      contract: "frameos.audio.channel-strip@1.0.0",
      processingOrder: [
        "denoise",
        "eq",
        "compressor",
        "limiter",
        "normalization",
        "fades",
      ],
      restrictions: [
        "static",
        "unmasked",
        "full target range",
        "integrated normalization mode",
      ],
    },
  },
  {
    id: "frameos.transition.dissolve",
    kind: "transition",
    name: "Video dissolve",
    description:
      "Dissolve video across a same-track edit while retaining the audio cut.",
    dependencies: ["engine.mlt", "mlt.transition.luma"],
    parameters: {
      softness: { type: "number", minimum: 0, maximum: 1 },
      reverse: { type: "boolean" },
      alphaOver: { type: "boolean" },
      fixBackgroundAlpha: { type: "boolean" },
    },
  },
  {
    id: "frameos.transition.audio_crossfade",
    kind: "transition",
    name: "Audio crossfade",
    description:
      "Crossfade audio across a same-track edit while retaining the picture cut.",
    dependencies: ["engine.mlt", "mlt.transition.mix"],
    parameters: {
      curve: { enum: ["linear", "equal_power"] },
      reverse: { type: "boolean" },
    },
  },
  {
    id: "frameos.sequence.nested",
    kind: "producer",
    name: "Nested sequence",
    description:
      "Render an adapter-neutral sequence inside another matching-format sequence.",
    dependencies: ["engine.mlt", "mlt.producer.xml"],
    parameters: {
      sourceRange: { contract: "TimeRange", optional: true },
      restrictions: [
        "matching sequence format",
        "neutral instance transform/effects/audio",
      ],
    },
  },
];

function buildAdapterCapabilities(
  native: readonly CapabilityDescriptor[],
): CapabilityDescriptor[] {
  const byId = new Map(native.map((capability) => [capability.id, capability]));
  return adapterCapabilityDefinitions.map((definition) => {
    const missing = definition.dependencies.filter(
      (id) => byId.get(id)?.available !== true,
    );
    return {
      id: definition.id,
      kind: definition.kind,
      name: definition.name,
      description: definition.description,
      available: missing.length === 0,
      baseline: true,
      provider: "frameos-mlt-adapter",
      providerVersion: "0.1.0",
      license: "MIT",
      ...(missing.length === 0
        ? {}
        : {
            reasonUnavailable: `Missing audited engine capabilities: ${missing.join(", ")}`,
          }),
      alternatives: [],
      parameters: definition.parameters,
      metadata: { underlyingCapabilities: definition.dependencies },
    };
  });
}

export class CapabilityService {
  private analyzerDescriptorProvider: () => readonly AnalyzerDescriptor[] =
    () => analyzerDescriptors;

  public constructor(private readonly worker: EngineWorkerClient) {}

  public setAnalyzerDescriptorProvider(
    provider: () => readonly AnalyzerDescriptor[],
  ): void {
    this.analyzerDescriptorProvider = provider;
  }

  public async listCapabilities(
    search?: string,
  ): Promise<CapabilityDescriptor[]> {
    const native = await this.worker.discoverCapabilities();
    const installedAnalyzers = this.analyzerDescriptorProvider();
    const analyzerCapabilities: CapabilityDescriptor[] = installedAnalyzers.map(
      (analyzer) => ({
        id: analyzer.capabilityId,
        kind: "analyzer",
        name: analyzer.name,
        description: analyzer.description,
        available: analyzer.available,
        baseline: analyzer.available,
        provider: analyzer.id,
        providerVersion: analyzer.version,
        license: analyzer.binaryLicense ?? "MIT",
        ...(analyzer.reasonUnavailable === undefined
          ? {}
          : { reasonUnavailable: analyzer.reasonUnavailable }),
        alternatives: analyzer.available
          ? []
          : installedAnalyzers
              .filter((candidate) => candidate.available)
              .map((candidate) => candidate.capabilityId),
        parameters: analyzer.parameterSchema,
        metadata: {
          analyzerId: analyzer.id,
          outputTypes: analyzer.outputTypes,
          assetKinds: analyzer.assetKinds,
          deterministic: analyzer.deterministic,
          ...(analyzer.binaryHash === undefined
            ? {}
            : { binaryHash: analyzer.binaryHash }),
          ...(analyzer.bundleHash === undefined
            ? {}
            : { bundleHash: analyzer.bundleHash }),
          ...(analyzer.modelHash === undefined
            ? {}
            : { modelHash: analyzer.modelHash }),
          ...(analyzer.modelLicense === undefined
            ? {}
            : { modelLicense: analyzer.modelLicense }),
        },
      }),
    );
    const adapterCapabilities = buildAdapterCapabilities(native);
    const runtimeCapabilities = [
      ...native,
      ...adapterCapabilities,
      ...analyzerCapabilities,
    ];
    const runtimeById = new Map(
      runtimeCapabilities.map((capability) => [capability.id, capability]),
    );
    const operationCapabilities: CapabilityDescriptor[] = operationCatalog.map(
      (operation) => {
        const surfaceImplemented = ["implemented", "service"].includes(
          operation.maturity,
        );
        const missingCapabilities = operation.requiredCapabilities.filter(
          (capabilityId) => runtimeById.get(capabilityId)?.available !== true,
        );
        const available =
          surfaceImplemented && missingCapabilities.length === 0;
        return {
          id: `operation.${operation.name}`,
          kind: "operation",
          name: operation.name,
          description: operation.description,
          available,
          baseline: available,
          provider: "frameos",
          providerVersion: "0.1.0",
          license: "MIT",
          ...(available
            ? {}
            : {
                reasonUnavailable: !surfaceImplemented
                  ? `Operation is ${operation.maturity}-only in this implementation wave`
                  : `Missing runtime capabilities: ${missingCapabilities.join(", ")}`,
              }),
          alternatives: [],
          metadata: {
            family: operation.family,
            maturity: operation.maturity,
            reversible: operation.reversible,
            requiredCapabilities: operation.requiredCapabilities,
          },
        };
      },
    );
    const capabilities = [
      ...native,
      ...adapterCapabilities,
      ...analyzerCapabilities,
      ...operationCapabilities,
    ];
    const query = search?.trim().toLowerCase();
    if (query === undefined || query === "") return capabilities;
    return capabilities.filter(
      (capability) =>
        capability.id.toLowerCase().includes(query) ||
        capability.name.toLowerCase().includes(query) ||
        capability.description.toLowerCase().includes(query),
    );
  }

  public listOperations(filters?: {
    search?: string;
    family?: string;
    maturity?: OperationDescriptor["maturity"];
  }): OperationDescriptor[] {
    const search = filters?.search?.trim().toLowerCase();
    return operationCatalog.filter(
      (operation) =>
        (filters?.family === undefined ||
          operation.family === filters.family) &&
        (filters?.maturity === undefined ||
          operation.maturity === filters.maturity) &&
        (search === undefined ||
          operation.name.toLowerCase().includes(search) ||
          operation.description.toLowerCase().includes(search)),
    );
  }

  public getOperation(name: string): OperationDescriptor | undefined {
    return operationCatalog.find((operation) => operation.name === name);
  }
}
