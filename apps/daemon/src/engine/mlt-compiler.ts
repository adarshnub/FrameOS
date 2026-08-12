import { extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FrameOSError,
  rationalTimeSchema,
  rescaleTime,
  type CaptionTrack,
  type Clip,
  type EffectInstance,
  type Generator,
  type NestedSequence,
  type Project,
  type RationalRate,
  type Sequence,
  type TimelineItem,
  type Title,
  type Track,
  type Transition,
} from "@frameos/contracts";

export interface MltCompilerOptions {
  resolveFrameosUri?: (uri: string) => string;
  mediaSelection?: "original" | "prefer_proxy";
  /** Capability IDs that are both present and distribution-allowlisted. */
  availableCapabilities?: ReadonlySet<string>;
}

const capabilityIds = {
  affine: "mlt.filter.affine",
  crop: "mlt.filter.crop",
  pan: "mlt.filter.panner",
  volume: "mlt.filter.avfilter.volume",
  colorExposure: "mlt.filter.avfilter.exposure",
  colorEq: "mlt.filter.avfilter.eq",
  colorTemperature: "mlt.filter.avfilter.colortemperature",
  colorCurves: "mlt.filter.avfilter.curves",
  colorLut3d: "mlt.filter.avfilter.lut3d",
  audioNormalize: "mlt.filter.avfilter.loudnorm",
  audioEqBell: "mlt.filter.avfilter.equalizer",
  audioEqLowCut: "mlt.filter.avfilter.highpass",
  audioEqHighCut: "mlt.filter.avfilter.lowpass",
  audioEqLowShelf: "mlt.filter.avfilter.lowshelf",
  audioEqHighShelf: "mlt.filter.avfilter.highshelf",
  audioCompressor: "mlt.filter.avfilter.acompressor",
  audioLimiter: "mlt.filter.avfilter.alimiter",
  audioDenoise: "mlt.filter.avfilter.afftdn",
  audioFade: "mlt.filter.avfilter.afade",
  luma: "mlt.transition.luma",
  mix: "mlt.transition.mix",
  solidGenerator: "frameos.generator.solid",
  dissolve: "frameos.transition.dissolve",
  audioCrossfade: "frameos.transition.audio_crossfade",
  text: "mlt.filter.qtext",
} as const;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatNumber(value: number): string {
  const rounded = Math.abs(value) < 0.0000005 ? 0 : Number(value.toFixed(6));
  return String(rounded);
}

function itemStartFrames(item: TimelineItem, rate: RationalRate): number {
  return rescaleTime(item.timelineRange.start, rate).time.value;
}

function itemDurationFrames(item: TimelineItem, rate: RationalRate): number {
  return Math.max(1, rescaleTime(item.timelineRange.duration, rate).time.value);
}

function capabilityUnavailable(
  message: string,
  field: string,
  value: unknown,
  alternatives: string[] = [],
): never {
  throw new FrameOSError("CAPABILITY_UNAVAILABLE", message, 424, [
    {
      field,
      message:
        alternatives.length === 0
          ? "Required render capability is unavailable"
          : `Required render capability is unavailable; alternatives: ${alternatives.join(", ")}`,
      value,
    },
  ]);
}

function requireCapability(
  options: MltCompilerOptions,
  capabilityId: string,
  context: string,
  alternatives: string[] = [],
): void {
  if (options.availableCapabilities?.has(capabilityId) !== true) {
    capabilityUnavailable(
      `${context} requires unavailable capability ${capabilityId}`,
      "capabilityId",
      capabilityId,
      alternatives,
    );
  }
}

function property(name: string, value: string | number): string {
  return `      <property name="${escapeXml(name)}">${escapeXml(String(value))}</property>`;
}

function compileFilter(
  id: string,
  service: string,
  properties: ReadonlyArray<readonly [string, string | number]>,
): string[] {
  return [
    `    <filter id="${escapeXml(id)}">`,
    property("mlt_service", service),
    ...properties.map(([name, value]) => property(name, value)),
    "    </filter>",
  ];
}

const textStyleKeys = new Set([
  "animation",
  "backgroundColor",
  "boxHeight",
  "dynamic",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "foregroundColor",
  "horizontalAlign",
  "opacity",
  "outlineColor",
  "outlineWidth",
  "padding",
  "placement",
  "preset",
  "safeArea",
  "sourceArtifactId",
  "sourceClipId",
  "sourceSettings",
  "strikethrough",
  "typewriterCursor",
  "typewriterStepFrames",
  "underline",
  "verticalAlign",
  "wordHighlight",
]);

function textStyleNumber(
  style: Record<string, unknown>,
  name: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const value = style[name] ?? fallback;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Text style ${name} must be between ${minimum.toString()} and ${maximum.toString()}`,
      422,
    );
  }
  return value;
}

function textStyleInteger(
  style: Record<string, unknown>,
  name: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const value = textStyleNumber(style, name, minimum, maximum, fallback);
  if (!Number.isInteger(value)) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Text style ${name} must be an integer`,
      422,
    );
  }
  return value;
}

function textStyleBoolean(
  style: Record<string, unknown>,
  name: string,
  fallback: boolean,
): boolean {
  const value = style[name] ?? fallback;
  if (typeof value !== "boolean") {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Text style ${name} must be boolean`,
      422,
    );
  }
  return value;
}

function textStyleString(
  style: Record<string, unknown>,
  name: string,
  fallback: string,
  allowed?: readonly string[],
): string {
  const value = style[name] ?? fallback;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    value.includes("\0") ||
    (allowed !== undefined && !allowed.includes(value))
  ) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Text style ${name} is invalid`,
      422,
    );
  }
  return value;
}

function textStyleColor(
  style: Record<string, unknown>,
  name: string,
  fallback: string,
): string {
  const value = textStyleString(style, name, fallback);
  if (
    !/^(?:#[\dA-Fa-f]{6}|#[\dA-Fa-f]{8}|0x[\dA-Fa-f]{8}|white|black|red|green|blue)$/u.test(
      value,
    )
  ) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Text style ${name} must be a supported literal color`,
      422,
    );
  }
  return value;
}

function assertKnownTextStyle(style: Record<string, unknown>): void {
  const unknown = Object.keys(style).find((name) => !textStyleKeys.has(name));
  if (unknown !== undefined) {
    capabilityUnavailable(
      `Text style ${unknown} has no normalized MLT mapping`,
      `style.${unknown}`,
      style[unknown],
    );
  }
  if (
    style.preset !== undefined &&
    style.preset !== "frameos.dynamic-caption-v1"
  ) {
    capabilityUnavailable(
      `Text preset ${String(style.preset)} has no audited MLT mapping`,
      "style.preset",
      style.preset,
      ["frameos.dynamic-caption-v1"],
    );
  }
}

function compileTextOverlayProducer(
  id: string,
  text: string,
  style: Record<string, unknown>,
  options: MltCompilerOptions,
  kind: "caption" | "title",
  hasWordTiming: boolean,
): string {
  requireCapability(options, "mlt.producer.color", `${kind} backing`);
  requireCapability(options, capabilityIds.text, `${kind} text rendering`);
  assertKnownTextStyle(style);
  const wordHighlight = textStyleBoolean(style, "wordHighlight", false);
  if (wordHighlight && hasWordTiming) {
    capabilityUnavailable(
      "The audited qtext mapping cannot animate word-level highlighting yet",
      "style.wordHighlight",
      true,
      ["wordHighlight=false", "static timed captions"],
    );
  }
  const safeArea = textStyleNumber(style, "safeArea", 0.1, 1, 0.9);
  const boxHeight = textStyleNumber(
    style,
    "boxHeight",
    0.05,
    1,
    kind === "caption" ? 0.22 : 0.5,
  );
  const placement = textStyleString(
    style,
    "placement",
    kind === "caption" ? "bottom-center" : "center",
    ["top-center", "center", "bottom-center"],
  );
  const margin = ((1 - safeArea) / 2) * 100;
  const height = boxHeight * 100;
  const y =
    placement === "top-center"
      ? margin
      : placement === "bottom-center"
        ? 100 - margin - height
        : (100 - height) / 2;
  const geometry = `${formatNumber(margin)}%/${formatNumber(y)}%:${formatNumber(safeArea * 100)}%x${formatNumber(height)}%:100`;
  const animation = textStyleString(style, "animation", "none", [
    "none",
    "typewriter",
  ]);
  const properties: Array<readonly [string, string | number]> = [
    ["argument", text],
    ["geometry", geometry],
    ["family", textStyleString(style, "fontFamily", "Sans")],
    [
      "size",
      textStyleInteger(style, "fontSize", 8, 512, kind === "caption" ? 64 : 96),
    ],
    ["style", textStyleString(style, "fontStyle", "normal")],
    ["weight", textStyleInteger(style, "fontWeight", 100, 1_000, 700)],
    ["fgcolour", textStyleColor(style, "foregroundColor", "0xffffffff")],
    [
      "bgcolour",
      textStyleColor(
        style,
        "backgroundColor",
        kind === "caption" ? "0x00000080" : "0x00000000",
      ),
    ],
    ["olcolour", textStyleColor(style, "outlineColor", "0x000000ff")],
    [
      "outline",
      textStyleInteger(style, "outlineWidth", 0, 3, kind === "caption" ? 2 : 0),
    ],
    ["underline", textStyleBoolean(style, "underline", false) ? 1 : 0],
    ["strikethrough", textStyleBoolean(style, "strikethrough", false) ? 1 : 0],
    [
      "pad",
      textStyleInteger(style, "padding", 0, 1_000, kind === "caption" ? 16 : 0),
    ],
    [
      "halign",
      textStyleString(style, "horizontalAlign", "center", [
        "left",
        "center",
        "right",
      ]),
    ],
    [
      "valign",
      textStyleString(style, "verticalAlign", "middle", [
        "top",
        "middle",
        "bottom",
      ]),
    ],
    ["opacity", formatNumber(textStyleNumber(style, "opacity", 0, 1, 1))],
    ["typewriter", animation === "typewriter" ? 1 : 0],
  ];
  if (animation === "typewriter") {
    properties.push(
      [
        "typewriter.step_length",
        textStyleInteger(style, "typewriterStepFrames", 1, 100_000, 3),
      ],
      [
        "typewriter.cursor",
        textStyleInteger(style, "typewriterCursor", 0, 2, 0),
      ],
      ["typewriter.random_seed", 0],
      ["typewriter.step_sigma", 0],
    );
  }
  return [
    `  <producer id="producer_text_${escapeXml(id)}">`,
    property("mlt_service", "color"),
    property("resource", "0x00000000"),
    ...compileFilter(`filter_text_${id}`, "qtext", properties),
    "  </producer>",
  ].join("\n");
}

function compileTitleProducer(
  title: Title,
  options: MltCompilerOptions,
): string {
  const transform = title.transform;
  if (
    transform.positionX !== 0 ||
    transform.positionY !== 0 ||
    transform.anchorX !== 0.5 ||
    transform.anchorY !== 0.5 ||
    transform.scaleX !== 1 ||
    transform.scaleY !== 1 ||
    transform.rotation !== 0 ||
    transform.cropTop !== 0 ||
    transform.cropRight !== 0 ||
    transform.cropBottom !== 0 ||
    transform.cropLeft !== 0 ||
    transform.blendMode !== "normal"
  ) {
    capabilityUnavailable(
      "The audited qtext title mapping currently requires the neutral transform",
      "title.transform",
      transform,
    );
  }
  if (title.templateId !== undefined) {
    capabilityUnavailable(
      `Title template ${title.templateId} has no audited render mapping`,
      "title.templateId",
      title.templateId,
    );
  }
  const enabledEffect = title.effects.find((effect) => effect.enabled);
  if (enabledEffect !== undefined) {
    capabilityUnavailable(
      `Title effect ${enabledEffect.capabilityId} has no normalized mapping`,
      "title.effects.capabilityId",
      enabledEffect.capabilityId,
    );
  }
  return compileTextOverlayProducer(
    title.id,
    title.text,
    { ...title.style, opacity: title.transform.opacity },
    options,
    "title",
    false,
  );
}

function compileCaptionTrack(
  track: CaptionTrack,
  sequence: Sequence,
  options: MltCompilerOptions,
): CompiledTrack {
  const playlistId = `caption_playlist_${track.id}`;
  if (!track.enabled) {
    return {
      supportGraphs: [],
      playlist: `  <playlist id="${escapeXml(playlistId)}">\n  </playlist>`,
    };
  }
  const cues = track.cues
    .map((cue) => {
      const start = rescaleTime(cue.range.start, sequence.format.frameRate).time
        .value;
      const duration = rescaleTime(
        cue.range.duration,
        sequence.format.frameRate,
      ).time.value;
      if (duration <= 0) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Caption cue ${cue.id} must occupy at least one sequence frame`,
          422,
        );
      }
      return { cue, start, end: start + duration, duration };
    })
    .sort((left, right) => left.start - right.start);
  for (let index = 1; index < cues.length; index += 1) {
    const previous = cues[index - 1];
    const current = cues[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      previous.end > current.start
    ) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Caption cues ${previous.cue.id} and ${current.cue.id} overlap on track ${track.id}`,
        422,
      );
    }
  }
  const supportGraphs = cues.map(({ cue }) =>
    compileTextOverlayProducer(
      `caption_${track.id}_${cue.id}`,
      cue.text,
      { ...track.style, ...cue.style },
      options,
      "caption",
      cue.words.length > 0,
    ),
  );
  const lines = [`  <playlist id="${escapeXml(playlistId)}">`];
  let cursor = 0;
  for (const { cue, start, end, duration } of cues) {
    if (start > cursor) lines.push(`    <blank length="${start - cursor}"/>`);
    lines.push(
      playlistEntry(`producer_text_caption_${track.id}_${cue.id}`, 0, duration),
    );
    cursor = end;
  }
  lines.push("  </playlist>");
  return { supportGraphs, playlist: lines.join("\n") };
}

function assertNormalizedClipSupport(clip: Clip): void {
  if (clip.timeMap.length > 0) {
    capabilityUnavailable(
      "The MLT adapter cannot compile retimed clips yet",
      "timeMap",
      "retime",
    );
  }
  if (clip.audio.channelMap.length > 0) {
    capabilityUnavailable(
      "The MLT adapter cannot compile clip channel remapping yet",
      "audio.channelMap",
      clip.audio.channelMap,
    );
  }
  if (clip.transform.blendMode !== "normal") {
    capabilityUnavailable(
      `The MLT adapter cannot compile blend mode ${clip.transform.blendMode}`,
      "transform.blendMode",
      clip.transform.blendMode,
      ["normal"],
    );
  }
  if (clip.transform.scaleX <= 0 || clip.transform.scaleY <= 0) {
    capabilityUnavailable(
      "The audited affine mapping does not support zero or mirrored scale",
      "transform.scale",
      { scaleX: clip.transform.scaleX, scaleY: clip.transform.scaleY },
    );
  }
  if (
    clip.transform.rotation !== 0 &&
    (clip.transform.anchorX !== 0.5 || clip.transform.anchorY !== 0.5)
  ) {
    capabilityUnavailable(
      "Rotation around a non-center anchor has no exact audited MLT mapping",
      "transform.anchor",
      { anchorX: clip.transform.anchorX, anchorY: clip.transform.anchorY },
      ["center anchor (0.5, 0.5)"],
    );
  }
  if (
    clip.transform.cropLeft + clip.transform.cropRight >= 1 ||
    clip.transform.cropTop + clip.transform.cropBottom >= 1
  ) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Clip crop must retain a positive image area",
      422,
    );
  }
}

const primaryColorParameterNames = new Set([
  "exposureStops",
  "contrast",
  "saturation",
  "whiteBalance",
  "curves",
  "lut",
]);

function readColorNumber(
  effect: EffectInstance,
  parameter: string,
): number | undefined {
  const value = effect.parameters[parameter];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Color parameter ${parameter} must be a finite number`,
      422,
      [
        {
          field: `effects.${effect.id}.parameters.${parameter}`,
          message: "Expected a finite numeric color parameter",
          value,
        },
      ],
    );
  }
  return value;
}

function assertColorRange(
  effect: EffectInstance,
  parameter: string,
  value: number,
  minimum: number,
  maximum: number,
): void {
  if (value < minimum || value > maximum) {
    capabilityUnavailable(
      `The audited MLT mapping for ${parameter} supports ${minimum} through ${maximum}`,
      `effects.${effect.id}.parameters.${parameter}`,
      value,
      [`use a value from ${minimum} through ${maximum}`],
    );
  }
}

function compilePrimaryColorEffect(
  targetId: string,
  effect: EffectInstance,
  options: MltCompilerOptions,
): string[] {
  if (effect.version !== "1.0.0") {
    capabilityUnavailable(
      `Primary color effect version ${effect.version} has no audited MLT mapping`,
      `effects.${effect.id}.version`,
      effect.version,
      ["1.0.0"],
    );
  }
  if (effect.range !== undefined) {
    capabilityUnavailable(
      "Ranged primary color effects have no audited MLT mapping",
      `effects.${effect.id}.range`,
      effect.range,
    );
  }
  if (effect.automationCurves.length > 0) {
    capabilityUnavailable(
      "Animated primary color controls have no audited MLT mapping",
      `effects.${effect.id}.automationCurves`,
      effect.automationCurves.map((curve) => curve.parameter),
    );
  }
  if (effect.maskRef !== undefined) {
    capabilityUnavailable(
      "Masked primary color effects have no audited MLT mapping",
      `effects.${effect.id}.maskRef`,
      effect.maskRef,
    );
  }
  const unknownParameter = Object.keys(effect.parameters).find(
    (parameter) => !primaryColorParameterNames.has(parameter),
  );
  if (unknownParameter !== undefined) {
    capabilityUnavailable(
      `Primary color parameter ${unknownParameter} has no audited MLT mapping`,
      `effects.${effect.id}.parameters.${unknownParameter}`,
      effect.parameters[unknownParameter],
      [...primaryColorParameterNames],
    );
  }

  const exposure = readColorNumber(effect, "exposureStops") ?? 0;
  const contrast = readColorNumber(effect, "contrast") ?? 1;
  const saturation = readColorNumber(effect, "saturation") ?? 1;
  assertColorRange(effect, "exposureStops", exposure, -3, 3);
  assertColorRange(effect, "contrast", contrast, 0, 4);
  assertColorRange(effect, "saturation", saturation, 0, 3);

  const lines: string[] = [];
  if (exposure !== 0) {
    requireCapability(
      options,
      capabilityIds.colorExposure,
      "Primary color exposure",
    );
    lines.push(
      ...compileFilter(
        `filter_color_exposure_${targetId}_${effect.id}`,
        "avfilter.exposure",
        [["av.exposure", formatNumber(exposure)]],
      ),
    );
  }
  if (contrast !== 1 || saturation !== 1) {
    requireCapability(
      options,
      capabilityIds.colorEq,
      "Primary color contrast and saturation",
    );
    lines.push(
      ...compileFilter(
        `filter_color_eq_${targetId}_${effect.id}`,
        "avfilter.eq",
        [
          ["av.contrast", formatNumber(contrast)],
          ["av.saturation", formatNumber(saturation)],
          ["av.eval", "init"],
        ],
      ),
    );
  }
  lines.push(...compileColorWhiteBalance(targetId, effect, options));
  lines.push(...compileColorCurves(targetId, effect, options));
  lines.push(...compileColorLut(targetId, effect, options));
  return lines;
}

type ParameterObject = Record<string, unknown>;

function effectParameterObject(
  effect: EffectInstance,
  parameter: string,
): ParameterObject | undefined {
  const value = effect.parameters[parameter];
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Effect parameter ${parameter} must be an object`,
      422,
      [
        {
          field: `effects.${effect.id}.parameters.${parameter}`,
          message: "Expected an object",
          value,
        },
      ],
    );
  }
  return value as ParameterObject;
}

function assertParameterKeys(
  effect: EffectInstance,
  parameter: string,
  value: ParameterObject,
  allowed: readonly string[],
): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) {
    capabilityUnavailable(
      `Audio ${parameter} property ${unknown} has no audited MLT mapping`,
      `effects.${effect.id}.parameters.${parameter}.${unknown}`,
      value[unknown],
      [...allowed],
    );
  }
}

function colorNestedNumber(
  effect: EffectInstance,
  group: string,
  value: ParameterObject,
  parameter: string,
  minimum: number,
  maximum: number,
): number {
  const result = value[parameter];
  if (
    typeof result !== "number" ||
    !Number.isFinite(result) ||
    result < minimum ||
    result > maximum
  ) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Color ${group}.${parameter} must be a finite number from ${minimum} through ${maximum}`,
      422,
      [
        {
          field: `effects.${effect.id}.parameters.${group}.${parameter}`,
          message: `Expected a number from ${minimum} through ${maximum}`,
          value: result,
        },
      ],
    );
  }
  return result;
}

function compileColorWhiteBalance(
  targetId: string,
  effect: EffectInstance,
  options: MltCompilerOptions,
): string[] {
  const whiteBalance = effectParameterObject(effect, "whiteBalance");
  if (whiteBalance === undefined) return [];
  assertParameterKeys(effect, "whiteBalance", whiteBalance, [
    "temperatureKelvin",
    "tint",
  ]);
  const temperature = colorNestedNumber(
    effect,
    "whiteBalance",
    whiteBalance,
    "temperatureKelvin",
    1_000,
    40_000,
  );
  const tint = colorNestedNumber(
    effect,
    "whiteBalance",
    whiteBalance,
    "tint",
    -2,
    2,
  );
  if (tint !== 0) {
    capabilityUnavailable(
      "White-balance tint has no exact mapping in the audited MLT color-temperature link",
      `effects.${effect.id}.parameters.whiteBalance.tint`,
      tint,
      ["0"],
    );
  }
  if (temperature === 6_500) return [];
  requireCapability(
    options,
    capabilityIds.colorTemperature,
    "White-balance temperature",
  );
  return compileFilter(
    `filter_color_temperature_${targetId}_${effect.id}`,
    "avfilter.colortemperature",
    [
      ["av.temperature", formatNumber(temperature)],
      ["av.mix", 1],
      ["av.pl", 1],
    ],
  );
}

function compileColorCurves(
  targetId: string,
  effect: EffectInstance,
  options: MltCompilerOptions,
): string[] {
  const curves = effectParameterObject(effect, "curves");
  if (curves === undefined) return [];
  const channelProperties = [
    ["rgb", "av.all"],
    ["red", "av.red"],
    ["green", "av.green"],
    ["blue", "av.blue"],
    ["luma", "av.master"],
  ] as const;
  assertParameterKeys(
    effect,
    "curves",
    curves,
    channelProperties.map(([channel]) => channel),
  );
  const properties: Array<readonly [string, string | number]> = [];
  for (const [channel, nativeProperty] of channelProperties) {
    const candidate = curves[channel];
    if (candidate === undefined) continue;
    if (
      !Array.isArray(candidate) ||
      candidate.length < 2 ||
      candidate.length > 256
    ) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Color curve ${channel} must contain 2 through 256 points`,
        422,
      );
    }
    let previousInput = -1;
    const points = candidate.map((point, index) => {
      if (typeof point !== "object" || point === null || Array.isArray(point)) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Color curve ${channel} point ${index} must be an object`,
          422,
        );
      }
      const value = point as ParameterObject;
      assertParameterKeys(effect, `curves.${channel}.${index}`, value, [
        "input",
        "output",
      ]);
      const input = colorNestedNumber(
        effect,
        `curves.${channel}.${index}`,
        value,
        "input",
        0,
        1,
      );
      const output = colorNestedNumber(
        effect,
        `curves.${channel}.${index}`,
        value,
        "output",
        0,
        1,
      );
      if (input <= previousInput) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Color curve ${channel} inputs must be strictly increasing`,
          422,
        );
      }
      previousInput = input;
      return `${formatNumber(input)}/${formatNumber(output)}`;
    });
    properties.push([nativeProperty, points.join(" ")]);
  }
  if (properties.length === 0) return [];
  requireCapability(options, capabilityIds.colorCurves, "Color curves");
  properties.push(["av.interp", "pchip"]);
  return compileFilter(
    `filter_color_curves_${targetId}_${effect.id}`,
    "avfilter.curves",
    properties,
  );
}

function compileColorLut(
  targetId: string,
  effect: EffectInstance,
  options: MltCompilerOptions,
): string[] {
  const lut = effectParameterObject(effect, "lut");
  if (lut === undefined) return [];
  assertParameterKeys(effect, "lut", lut, [
    "uri",
    "intensity",
    "interpolation",
  ]);
  if (typeof lut.uri !== "string" || lut.uri.length === 0) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Color LUT uri must be a non-empty string",
      422,
    );
  }
  const intensity = colorNestedNumber(effect, "lut", lut, "intensity", 0, 1);
  if (
    lut.interpolation !== "trilinear" &&
    lut.interpolation !== "tetrahedral"
  ) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Color LUT interpolation must be trilinear or tetrahedral",
      422,
    );
  }
  if (intensity === 0) return [];
  if (intensity !== 1) {
    capabilityUnavailable(
      "Partial 3D LUT intensity requires an unavailable normalized blend graph",
      `effects.${effect.id}.parameters.lut.intensity`,
      intensity,
      ["0", "1"],
    );
  }
  if (!lut.uri.startsWith("frameos:")) {
    capabilityUnavailable(
      "The audited 3D LUT mapping requires a project-managed LUT URI",
      `effects.${effect.id}.parameters.lut.uri`,
      lut.uri,
      ["import the LUT into the project bundle"],
    );
  }
  const resource = resolveAssetResource(lut.uri, options);
  if (extname(resource).toLowerCase() !== ".cube") {
    capabilityUnavailable(
      "The audited 3D LUT mapping currently accepts Adobe .cube files only",
      `effects.${effect.id}.parameters.lut.uri`,
      lut.uri,
      [".cube"],
    );
  }
  requireCapability(options, capabilityIds.colorLut3d, "3D color LUT");
  return compileFilter(
    `filter_color_lut_${targetId}_${effect.id}`,
    "avfilter.lut3d",
    [
      ["av.file", resource],
      ["av.clut", "first"],
      ["av.interp", lut.interpolation],
    ],
  );
}

function audioNumber(
  effect: EffectInstance,
  group: string,
  value: ParameterObject,
  parameter: string,
  minimum: number,
  maximum: number,
): number {
  const result = value[parameter];
  if (
    typeof result !== "number" ||
    !Number.isFinite(result) ||
    result < minimum ||
    result > maximum
  ) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Audio ${group}.${parameter} must be a finite number from ${minimum} through ${maximum}`,
      422,
      [
        {
          field: `effects.${effect.id}.parameters.${group}.${parameter}`,
          message: `Expected a number from ${minimum} through ${maximum}`,
          value: result,
        },
      ],
    );
  }
  return result;
}

function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}

interface AudioSampleSpan {
  start: number;
  duration: number;
}

function sampleSpan(
  start: { value: number; rate: RationalRate },
  duration: { value: number; rate: RationalRate },
  sampleRate: number,
): AudioSampleSpan {
  const rate = { numerator: sampleRate, denominator: 1 };
  return {
    start: rescaleTime(start, rate).time.value,
    duration: rescaleTime(duration, rate).time.value,
  };
}

function compileAudioFades(
  targetId: string,
  effect: EffectInstance,
  targetSpan: AudioSampleSpan,
  sampleRate: number,
  options: MltCompilerOptions,
): string[] {
  const fades = effect.parameters.fades;
  if (fades === undefined) return [];
  if (!Array.isArray(fades)) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Audio fades must be an array",
      422,
    );
  }
  const curveMap = {
    linear: "tri",
    equal_power: "qsin",
    s_curve: "desi",
    logarithmic: "log",
  } as const;
  const ids = new Set<string>();
  const lines: string[] = [];
  for (const [index, candidate] of fades.entries()) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    ) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Audio fade ${index} must be an object`,
        422,
      );
    }
    const fade = candidate as ParameterObject;
    assertParameterKeys(effect, `fades.${index}`, fade, [
      "id",
      "kind",
      "duration",
      "curve",
    ]);
    if (typeof fade.id !== "string" || fade.id.length === 0) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Audio fade ${index} requires an id`,
        422,
      );
    }
    if (ids.has(fade.id)) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Audio fade id ${fade.id} is duplicated`,
        422,
      );
    }
    ids.add(fade.id);
    if (fade.kind !== "in" && fade.kind !== "out") {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Audio fade ${fade.id} requires kind in or out`,
        422,
      );
    }
    if (
      typeof fade.curve !== "string" ||
      !Object.hasOwn(curveMap, fade.curve)
    ) {
      capabilityUnavailable(
        `Audio fade curve ${String(fade.curve)} has no audited MLT mapping`,
        `effects.${effect.id}.parameters.fades.${index}.curve`,
        fade.curve,
        Object.keys(curveMap),
      );
    }
    const parsedDuration = rationalTimeSchema.safeParse(fade.duration);
    if (!parsedDuration.success) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Audio fade ${fade.id} has an invalid rational duration`,
        422,
      );
    }
    const duration = rescaleTime(parsedDuration.data, {
      numerator: sampleRate,
      denominator: 1,
    }).time.value;
    if (duration < 1 || duration > targetSpan.duration) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Audio fade ${fade.id} must occupy between one sample and the target duration`,
        422,
      );
    }
    const start =
      fade.kind === "in"
        ? targetSpan.start
        : targetSpan.start + targetSpan.duration - duration;
    const curve = curveMap[fade.curve as keyof typeof curveMap];
    requireCapability(
      options,
      capabilityIds.audioFade,
      `Audio fade ${fade.id}`,
    );
    lines.push(
      ...compileFilter(
        `filter_audio_fade_${targetId}_${effect.id}_${fade.id}`,
        "avfilter.afade",
        [
          ["av.type", fade.kind],
          ["av.start_sample", start],
          ["av.nb_samples", duration],
          ["av.curve", curve],
          ["av.silence", 0],
          ["av.unity", 1],
        ],
      ),
    );
  }
  return lines;
}

function assertAudioAdapterRange(
  effect: EffectInstance,
  group: string,
  parameter: string,
  value: number,
  minimum: number,
  maximum: number,
): void {
  if (value < minimum || value > maximum) {
    capabilityUnavailable(
      `The audited MLT mapping for audio ${group}.${parameter} supports ${minimum} through ${maximum}`,
      `effects.${effect.id}.parameters.${group}.${parameter}`,
      value,
      [`use a value from ${minimum} through ${maximum}`],
    );
  }
}

function compileAudioDenoise(
  targetId: string,
  effect: EffectInstance,
  options: MltCompilerOptions,
): string[] {
  const denoise = effectParameterObject(effect, "denoise");
  if (denoise === undefined) return [];
  assertParameterKeys(effect, "denoise", denoise, [
    "amount",
    "noiseProfileUri",
  ]);
  const amount = audioNumber(effect, "denoise", denoise, "amount", 0, 1);
  if (denoise.noiseProfileUri !== undefined) {
    capabilityUnavailable(
      "Profile-guided denoise has no audited MLT mapping",
      `effects.${effect.id}.parameters.denoise.noiseProfileUri`,
      denoise.noiseProfileUri,
    );
  }
  if (amount === 0) return [];
  requireCapability(options, capabilityIds.audioDenoise, "Audio denoise");
  const reductionDb = 0.01 + amount * 96.99;
  return compileFilter(
    `filter_audio_denoise_${targetId}_${effect.id}`,
    "avfilter.afftdn",
    [
      ["av.noise_reduction", formatNumber(reductionDb)],
      ["av.noise_type", "white"],
      ["av.track_noise", 1],
      ["av.output_mode", "output"],
    ],
  );
}

function compileAudioEq(
  targetId: string,
  effect: EffectInstance,
  sampleRate: number,
  options: MltCompilerOptions,
): string[] {
  const equalizer = effectParameterObject(effect, "eq");
  if (equalizer === undefined) return [];
  assertParameterKeys(effect, "eq", equalizer, ["bands"]);
  if (!Array.isArray(equalizer.bands)) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Audio eq.bands must be an array",
      422,
    );
  }
  const serviceByKind = {
    low_cut: ["avfilter.highpass", capabilityIds.audioEqLowCut],
    low_shelf: ["avfilter.lowshelf", capabilityIds.audioEqLowShelf],
    bell: ["avfilter.equalizer", capabilityIds.audioEqBell],
    high_shelf: ["avfilter.highshelf", capabilityIds.audioEqHighShelf],
    high_cut: ["avfilter.lowpass", capabilityIds.audioEqHighCut],
  } as const;
  const lines: string[] = [];
  for (const [index, candidate] of equalizer.bands.entries()) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    ) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Audio EQ band ${index} must be an object`,
        422,
      );
    }
    const band = candidate as ParameterObject;
    assertParameterKeys(effect, `eq.bands.${index}`, band, [
      "id",
      "kind",
      "frequencyHz",
      "gainDb",
      "q",
      "enabled",
    ]);
    if (typeof band.id !== "string" || band.id.length === 0) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Audio EQ band ${index} requires an id`,
        422,
      );
    }
    if (typeof band.enabled !== "boolean") {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Audio EQ band ${band.id} requires a boolean enabled value`,
        422,
      );
    }
    if (!band.enabled) continue;
    if (
      typeof band.kind !== "string" ||
      !Object.hasOwn(serviceByKind, band.kind)
    ) {
      capabilityUnavailable(
        `Audio EQ kind ${String(band.kind)} has no audited MLT mapping`,
        `effects.${effect.id}.parameters.eq.bands.${index}.kind`,
        band.kind,
        Object.keys(serviceByKind),
      );
    }
    const frequency = audioNumber(
      effect,
      `eq.bands.${index}`,
      band,
      "frequencyHz",
      10,
      48_000,
    );
    const gain = audioNumber(
      effect,
      `eq.bands.${index}`,
      band,
      "gainDb",
      -36,
      36,
    );
    const q = audioNumber(effect, `eq.bands.${index}`, band, "q", 0.05, 40);
    if (frequency >= sampleRate / 2) {
      capabilityUnavailable(
        `Audio EQ frequency ${frequency} Hz must be below the ${sampleRate / 2} Hz Nyquist frequency`,
        `effects.${effect.id}.parameters.eq.bands.${index}.frequencyHz`,
        frequency,
      );
    }
    if ((band.kind === "low_cut" || band.kind === "high_cut") && gain !== 0) {
      capabilityUnavailable(
        `Audio EQ ${band.kind} does not use gain`,
        `effects.${effect.id}.parameters.eq.bands.${index}.gainDb`,
        gain,
        ["0"],
      );
    }
    const kind = band.kind as keyof typeof serviceByKind;
    const [service, capabilityId] = serviceByKind[kind];
    requireCapability(options, capabilityId, `Audio EQ ${band.kind}`);
    const properties: Array<readonly [string, string | number]> = [
      ["av.frequency", formatNumber(frequency)],
      ["av.width_type", "q"],
      ["av.width", formatNumber(q)],
      ["av.mix", 1],
      ["av.precision", "f64"],
    ];
    if (band.kind === "low_cut" || band.kind === "high_cut") {
      properties.push(["av.poles", 2]);
    } else {
      properties.push(["av.gain", formatNumber(gain)]);
    }
    lines.push(
      ...compileFilter(
        `filter_audio_eq_${targetId}_${effect.id}_${band.id}`,
        service,
        properties,
      ),
    );
  }
  return lines;
}

function compileAudioCompressor(
  targetId: string,
  effect: EffectInstance,
  options: MltCompilerOptions,
): string[] {
  const compressor = effectParameterObject(effect, "compressor");
  if (compressor === undefined) return [];
  assertParameterKeys(effect, "compressor", compressor, [
    "thresholdDb",
    "ratio",
    "attackMs",
    "releaseMs",
    "kneeDb",
    "makeupGainDb",
  ]);
  const threshold = audioNumber(
    effect,
    "compressor",
    compressor,
    "thresholdDb",
    -120,
    0,
  );
  const ratio = audioNumber(effect, "compressor", compressor, "ratio", 1, 100);
  const attack = audioNumber(
    effect,
    "compressor",
    compressor,
    "attackMs",
    0.01,
    10_000,
  );
  const release = audioNumber(
    effect,
    "compressor",
    compressor,
    "releaseMs",
    1,
    60_000,
  );
  const knee = audioNumber(effect, "compressor", compressor, "kneeDb", 0, 48);
  const makeup = audioNumber(
    effect,
    "compressor",
    compressor,
    "makeupGainDb",
    -24,
    48,
  );
  assertAudioAdapterRange(
    effect,
    "compressor",
    "thresholdDb",
    threshold,
    -60,
    0,
  );
  assertAudioAdapterRange(effect, "compressor", "ratio", ratio, 1, 20);
  assertAudioAdapterRange(
    effect,
    "compressor",
    "attackMs",
    attack,
    0.01,
    2_000,
  );
  assertAudioAdapterRange(effect, "compressor", "releaseMs", release, 1, 9_000);
  assertAudioAdapterRange(effect, "compressor", "kneeDb", knee, 0, 18);
  assertAudioAdapterRange(effect, "compressor", "makeupGainDb", makeup, 0, 36);
  requireCapability(options, capabilityIds.audioCompressor, "Audio compressor");
  return compileFilter(
    `filter_audio_compressor_${targetId}_${effect.id}`,
    "avfilter.acompressor",
    [
      ["av.mode", "downward"],
      ["av.threshold", formatNumber(dbToLinear(threshold))],
      ["av.ratio", formatNumber(ratio)],
      ["av.attack", formatNumber(attack)],
      ["av.release", formatNumber(release)],
      ["av.knee", formatNumber(dbToLinear(knee))],
      ["av.makeup", formatNumber(dbToLinear(makeup))],
      ["av.link", "maximum"],
      ["av.detection", "rms"],
      ["av.mix", 1],
    ],
  );
}

function compileAudioLimiter(
  targetId: string,
  effect: EffectInstance,
  options: MltCompilerOptions,
): string[] {
  const limiter = effectParameterObject(effect, "limiter");
  if (limiter === undefined) return [];
  assertParameterKeys(effect, "limiter", limiter, [
    "ceilingDb",
    "releaseMs",
    "lookaheadMs",
  ]);
  const ceiling = audioNumber(effect, "limiter", limiter, "ceilingDb", -24, 0);
  const release = audioNumber(
    effect,
    "limiter",
    limiter,
    "releaseMs",
    1,
    60_000,
  );
  const lookahead = audioNumber(
    effect,
    "limiter",
    limiter,
    "lookaheadMs",
    0,
    1_000,
  );
  assertAudioAdapterRange(effect, "limiter", "releaseMs", release, 1, 8_000);
  assertAudioAdapterRange(effect, "limiter", "lookaheadMs", lookahead, 0.1, 80);
  requireCapability(options, capabilityIds.audioLimiter, "Audio limiter");
  return compileFilter(
    `filter_audio_limiter_${targetId}_${effect.id}`,
    "avfilter.alimiter",
    [
      ["av.limit", formatNumber(dbToLinear(ceiling))],
      ["av.attack", formatNumber(lookahead)],
      ["av.release", formatNumber(release)],
      ["av.level", 0],
      ["av.latency", 1],
    ],
  );
}

function compileAudioNormalization(
  targetId: string,
  effect: EffectInstance,
  options: MltCompilerOptions,
): string[] {
  const normalization = effectParameterObject(effect, "normalization");
  if (normalization === undefined) return [];
  assertParameterKeys(effect, "normalization", normalization, [
    "targetLufs",
    "truePeakDb",
    "mode",
  ]);
  const target = audioNumber(
    effect,
    "normalization",
    normalization,
    "targetLufs",
    -36,
    -5,
  );
  const truePeak = audioNumber(
    effect,
    "normalization",
    normalization,
    "truePeakDb",
    -12,
    0,
  );
  if (normalization.mode !== "integrated") {
    capabilityUnavailable(
      `Audio normalization mode ${String(normalization.mode)} has no audited MLT mapping`,
      `effects.${effect.id}.parameters.normalization.mode`,
      normalization.mode,
      ["integrated"],
    );
  }
  assertAudioAdapterRange(
    effect,
    "normalization",
    "truePeakDb",
    truePeak,
    -9,
    0,
  );
  requireCapability(
    options,
    capabilityIds.audioNormalize,
    "Integrated loudness normalization",
  );
  return compileFilter(
    `filter_audio_normalize_${targetId}_${effect.id}`,
    "avfilter.loudnorm",
    [
      ["av.I", formatNumber(target)],
      ["av.TP", formatNumber(truePeak)],
      ["av.LRA", 7],
      ["av.linear", 0],
      ["av.print_format", "none"],
    ],
  );
}

const audioChannelStripParameterNames = new Set([
  "fades",
  "denoise",
  "eq",
  "compressor",
  "limiter",
  "normalization",
]);

function compileAudioChannelStrip(
  targetId: string,
  effect: EffectInstance,
  sequence: Sequence,
  targetSpan: AudioSampleSpan,
  options: MltCompilerOptions,
): string[] {
  if (effect.version !== "1.0.0") {
    capabilityUnavailable(
      `Audio channel-strip version ${effect.version} has no audited MLT mapping`,
      `effects.${effect.id}.version`,
      effect.version,
      ["1.0.0"],
    );
  }
  if (effect.range !== undefined) {
    capabilityUnavailable(
      "Ranged audio channel-strip effects have no audited MLT mapping",
      `effects.${effect.id}.range`,
      effect.range,
    );
  }
  if (effect.automationCurves.length > 0) {
    capabilityUnavailable(
      "Animated audio channel-strip effects have no audited MLT mapping",
      `effects.${effect.id}.automationCurves`,
      effect.automationCurves.map((curve) => curve.parameter),
    );
  }
  if (effect.maskRef !== undefined) {
    capabilityUnavailable(
      "Masked audio channel-strip effects are invalid",
      `effects.${effect.id}.maskRef`,
      effect.maskRef,
    );
  }
  const unknown = Object.keys(effect.parameters).find(
    (parameter) => !audioChannelStripParameterNames.has(parameter),
  );
  if (unknown !== undefined) {
    capabilityUnavailable(
      `Audio channel-strip parameter ${unknown} has no audited MLT mapping`,
      `effects.${effect.id}.parameters.${unknown}`,
      effect.parameters[unknown],
      [...audioChannelStripParameterNames],
    );
  }

  return [
    ...compileAudioDenoise(targetId, effect, options),
    ...compileAudioEq(targetId, effect, sequence.format.sampleRate, options),
    ...compileAudioCompressor(targetId, effect, options),
    ...compileAudioLimiter(targetId, effect, options),
    ...compileAudioNormalization(targetId, effect, options),
    ...compileAudioFades(
      targetId,
      effect,
      targetSpan,
      sequence.format.sampleRate,
      options,
    ),
  ];
}

function compileClipEffects(
  clip: Clip,
  sequence: Sequence,
  options: MltCompilerOptions,
): string[] {
  const lines: string[] = [];
  for (const effect of clip.effects) {
    if (!effect.enabled) continue;
    if (effect.capabilityId === "frameos.color.primary") {
      lines.push(...compilePrimaryColorEffect(clip.id, effect, options));
      continue;
    }
    if (effect.capabilityId === "frameos.audio.channel-strip") {
      lines.push(
        ...compileAudioChannelStrip(
          clip.id,
          effect,
          sequence,
          sampleSpan(
            clip.sourceRange.start,
            clip.sourceRange.duration,
            sequence.format.sampleRate,
          ),
          options,
        ),
      );
      continue;
    }
    capabilityUnavailable(
      `The MLT adapter has no normalized mapping for effect ${effect.capabilityId}`,
      `effects.${effect.id}.capabilityId`,
      effect.capabilityId,
      ["frameos.color.primary", "frameos.audio.channel-strip"],
    );
  }
  return lines;
}

function compileClipFilters(
  clip: Clip,
  sequence: Sequence,
  options: MltCompilerOptions,
): string[] {
  assertNormalizedClipSupport(clip);
  const lines: string[] = compileClipEffects(clip, sequence, options);
  const transform = clip.transform;
  const hasCrop =
    transform.cropTop !== 0 ||
    transform.cropRight !== 0 ||
    transform.cropBottom !== 0 ||
    transform.cropLeft !== 0;
  if (hasCrop) {
    requireCapability(options, capabilityIds.crop, "Clip cropping");
    const left = Math.round(transform.cropLeft * sequence.format.width);
    const right = Math.round(transform.cropRight * sequence.format.width);
    const top = Math.round(transform.cropTop * sequence.format.height);
    const bottom = Math.round(transform.cropBottom * sequence.format.height);
    if (
      left + right >= sequence.format.width ||
      top + bottom >= sequence.format.height
    ) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Rounded clip crop must retain at least one output pixel",
        422,
      );
    }
    lines.push(
      ...compileFilter(`filter_crop_${clip.id}`, "crop", [
        ["active", 1],
        ["use_profile", 1],
        ["left", left],
        ["right", right],
        ["top", top],
        ["bottom", bottom],
      ]),
    );
  }

  const hasAffine =
    transform.positionX !== 0 ||
    transform.positionY !== 0 ||
    transform.anchorX !== 0.5 ||
    transform.anchorY !== 0.5 ||
    transform.scaleX !== 1 ||
    transform.scaleY !== 1 ||
    transform.rotation !== 0 ||
    transform.opacity !== 1;
  if (hasAffine) {
    requireCapability(options, capabilityIds.affine, "Clip transformation");
    const widthPercent = transform.scaleX * 100;
    const heightPercent = transform.scaleY * 100;
    const xPercent =
      50 +
      (transform.positionX / sequence.format.width) * 100 -
      widthPercent * transform.anchorX;
    const yPercent =
      50 +
      (transform.positionY / sequence.format.height) * 100 -
      heightPercent * transform.anchorY;
    const rectangle = `${formatNumber(xPercent)}%/${formatNumber(yPercent)}%:${formatNumber(widthPercent)}%x${formatNumber(heightPercent)}%:${formatNumber(transform.opacity * 100)}%`;
    lines.push(
      ...compileFilter(`filter_affine_${clip.id}`, "affine", [
        ["use_normalized", 1],
        ["transition.rect", rectangle],
        ["transition.fix_rotate_z", formatNumber(transform.rotation)],
        ["transition.fill", 1],
        ["transition.distort", 1],
      ]),
    );
  }

  if (clip.audio.pan !== 0) {
    if (sequence.format.channels > 6) {
      capabilityUnavailable(
        "The MLT panner baseline supports at most six channels",
        "sequence.format.channels",
        sequence.format.channels,
      );
    }
    requireCapability(options, capabilityIds.pan, "Clip audio pan");
    lines.push(
      ...compileFilter(`filter_pan_${clip.id}`, "panner", [
        ["channel", -1],
        ["split", formatNumber((clip.audio.pan + 1) / 2)],
      ]),
    );
  }

  if (clip.audio.gainDb !== 0 || clip.audio.muted) {
    requireCapability(
      options,
      capabilityIds.volume,
      clip.audio.muted ? "Clip audio mute" : "Clip audio gain",
    );
    lines.push(
      ...compileFilter(`filter_volume_${clip.id}`, "avfilter.volume", [
        [
          "av.volume",
          `${formatNumber(clip.audio.muted ? -120 : clip.audio.gainDb)}dB`,
        ],
        ["av.eval", "once"],
      ]),
    );
  }
  return lines;
}

function resolveAssetResource(
  assetUri: string,
  options: MltCompilerOptions,
): string {
  if (assetUri.startsWith("frameos:")) {
    if (options.resolveFrameosUri === undefined) {
      capabilityUnavailable(
        "Managed asset resolution is unavailable in this compiler context",
        "asset.uri",
        assetUri,
      );
    }
    return options.resolveFrameosUri(assetUri);
  }
  if (assetUri.startsWith("file:")) return fileURLToPath(assetUri);
  if (isAbsolute(assetUri)) return assetUri;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(assetUri)) {
    throw new FrameOSError(
      "UNSUPPORTED_FORMAT",
      `MLT adapter cannot open URI ${assetUri}`,
      422,
    );
  }
  return resolve(assetUri);
}

function compileProducer(
  clip: Clip,
  project: Project,
  sequence: Sequence,
  options: MltCompilerOptions,
): string {
  const asset = project.assets[clip.assetId];
  if (asset === undefined) {
    throw new FrameOSError(
      "MEDIA_OFFLINE",
      `Asset ${clip.assetId} is offline`,
      422,
    );
  }
  if (
    asset.semanticMetadata.offline === true ||
    asset.uri.startsWith("frameos:offline")
  ) {
    throw new FrameOSError(
      "MEDIA_OFFLINE",
      `Asset ${asset.id} is offline and must be relinked before rendering`,
      422,
    );
  }
  const selectedUri =
    options.mediaSelection === "prefer_proxy" && asset.proxies.length > 0
      ? asset.proxies[0]!
      : asset.uri;
  const resource = resolveAssetResource(selectedUri, options);
  const filters = compileClipFilters(clip, sequence, options);
  return [
    `  <producer id="producer_${escapeXml(clip.id)}">`,
    `    <property name="mlt_service">avformat-novalidate</property>`,
    `    <property name="resource">${escapeXml(resource)}</property>`,
    ...filters,
    "  </producer>",
  ].join("\n");
}

function compileGenerator(
  generator: Generator,
  options: MltCompilerOptions,
): string {
  if (generator.capabilityId !== capabilityIds.solidGenerator) {
    capabilityUnavailable(
      `Generator ${generator.capabilityId} has no normalized MLT mapping`,
      "generator.capabilityId",
      generator.capabilityId,
      [capabilityIds.solidGenerator],
    );
  }
  requireCapability(options, "mlt.producer.color", "Solid color generator");
  const enabledEffect = generator.effects.find((effect) => effect.enabled);
  if (enabledEffect !== undefined) {
    capabilityUnavailable(
      `The solid generator cannot compile effect ${enabledEffect.capabilityId} yet`,
      "generator.effects.capabilityId",
      enabledEffect.capabilityId,
    );
  }
  const unknownParameter = Object.keys(generator.parameters).find(
    (name) => name !== "color" && name !== "opacity",
  );
  if (unknownParameter !== undefined) {
    capabilityUnavailable(
      `Generator parameter ${unknownParameter} has no normalized MLT mapping`,
      `generator.parameters.${unknownParameter}`,
      generator.parameters[unknownParameter],
      ["color", "opacity"],
    );
  }
  const color = generator.parameters.color ?? "#000000";
  const opacity = generator.parameters.opacity ?? 1;
  if (typeof color !== "string" || !/^#[\dA-Fa-f]{6}$/u.test(color)) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Solid generator color must use #RRGGBB syntax",
      422,
    );
  }
  if (
    typeof opacity !== "number" ||
    !Number.isFinite(opacity) ||
    opacity < 0 ||
    opacity > 1
  ) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Solid generator opacity must be between 0 and 1",
      422,
    );
  }
  const alpha = Math.round(opacity * 255)
    .toString(16)
    .padStart(2, "0");
  const resource = `0x${color.slice(1).toLowerCase()}${alpha}`;
  return [
    `  <producer id="producer_generator_${escapeXml(generator.id)}">`,
    `    <property name="mlt_service">color</property>`,
    `    <property name="resource">${resource}</property>`,
    "  </producer>",
  ].join("\n");
}

function assertNestedSequenceSupport(item: NestedSequence): void {
  const transform = item.transform;
  const defaultTransform =
    transform.positionX === 0 &&
    transform.positionY === 0 &&
    transform.anchorX === 0.5 &&
    transform.anchorY === 0.5 &&
    transform.scaleX === 1 &&
    transform.scaleY === 1 &&
    transform.rotation === 0 &&
    transform.opacity === 1 &&
    transform.cropTop === 0 &&
    transform.cropRight === 0 &&
    transform.cropBottom === 0 &&
    transform.cropLeft === 0 &&
    transform.blendMode === "normal";
  if (!defaultTransform) {
    capabilityUnavailable(
      "Per-instance nested-sequence transforms are not mapped yet",
      "nestedSequence.transform",
      item.transform,
    );
  }
  const enabledEffect = item.effects.find((effect) => effect.enabled);
  if (enabledEffect !== undefined) {
    capabilityUnavailable(
      `Nested-sequence effect ${enabledEffect.capabilityId} is not mapped yet`,
      "nestedSequence.effects.capabilityId",
      enabledEffect.capabilityId,
    );
  }
  if (
    item.audio.gainDb !== 0 ||
    item.audio.pan !== 0 ||
    item.audio.muted ||
    item.audio.channelMap.length > 0
  ) {
    capabilityUnavailable(
      "Per-instance nested-sequence audio processing is not mapped yet",
      "nestedSequence.audio",
      item.audio,
    );
  }
}

function sequenceDurationFrames(sequence: Sequence): number {
  return Math.max(
    0,
    ...sequence.tracks.flatMap((track) =>
      track.items
        .filter((item) => item.type !== "transition")
        .map((item) => itemSpan(item, sequence.format.frameRate).end),
    ),
  );
}

interface FrameSpan {
  start: number;
  end: number;
}

interface CompiledTrack {
  supportGraphs: string[];
  playlist: string;
}

function itemSpan(item: TimelineItem, rate: RationalRate): FrameSpan {
  const start = itemStartFrames(item, rate);
  return { start, end: start + itemDurationFrames(item, rate) };
}

function sourceFrameAt(
  clip: Clip,
  timelineFrame: number,
  rate: RationalRate,
): number {
  return (
    rescaleTime(clip.sourceRange.start, rate).time.value +
    timelineFrame -
    itemStartFrames(clip, rate)
  );
}

function assertSourceSpan(
  clip: Clip,
  project: Project,
  sequence: Sequence,
  sourceStart: number,
  duration: number,
  context: string,
): void {
  if (sourceStart < 0) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `${context} requires ${Math.abs(sourceStart)} incoming source-handle frames before the asset starts`,
      422,
    );
  }
  const asset = project.assets[clip.assetId];
  if (asset?.duration === undefined) return;
  const assetDuration = rescaleTime(asset.duration, sequence.format.frameRate)
    .time.value;
  if (sourceStart + duration > assetDuration) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `${context} requires source-handle frames beyond asset ${asset.id}`,
      422,
    );
  }
}

function booleanParameter(
  transition: Transition,
  name: string,
  defaultValue = false,
): boolean {
  const value = transition.parameters[name];
  if (value === undefined) return defaultValue;
  if (typeof value !== "boolean") {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Transition parameter ${name} must be boolean`,
      422,
    );
  }
  return value;
}

function numberParameter(
  transition: Transition,
  name: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const value = transition.parameters[name];
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      `Transition parameter ${name} must be between ${minimum} and ${maximum}`,
      422,
    );
  }
  return value;
}

function assertKnownTransitionParameters(
  transition: Transition,
  allowed: readonly string[],
): void {
  const unknown = Object.keys(transition.parameters).find(
    (name) => !allowed.includes(name),
  );
  if (unknown !== undefined) {
    capabilityUnavailable(
      `Transition parameter ${unknown} has no normalized MLT mapping`,
      `transition.parameters.${unknown}`,
      transition.parameters[unknown],
      [...allowed],
    );
  }
  if (transition.automationCurves.length > 0) {
    capabilityUnavailable(
      "Transition automation curves are not mapped by the current MLT adapter",
      "transition.automationCurves",
      transition.automationCurves.length,
    );
  }
}

function transitionProperties(
  transition: Transition,
  options: MltCompilerOptions,
): {
  service: "luma" | "mix";
  properties: ReadonlyArray<readonly [string, string | number]>;
} {
  if (
    transition.capabilityId === capabilityIds.dissolve ||
    transition.capabilityId === capabilityIds.luma
  ) {
    requireCapability(options, capabilityIds.luma, "Video transition");
    assertKnownTransitionParameters(transition, [
      "softness",
      "reverse",
      "alphaOver",
      "fixBackgroundAlpha",
    ]);
    const softness = numberParameter(transition, "softness", 0, 1);
    const properties: Array<readonly [string, string | number]> = [
      ["progressive", 1],
      ["reverse", booleanParameter(transition, "reverse") ? 1 : 0],
      ["alpha_over", booleanParameter(transition, "alphaOver") ? 1 : 0],
      [
        "fix_background_alpha",
        booleanParameter(transition, "fixBackgroundAlpha") ? 1 : 0,
      ],
    ];
    if (softness !== undefined) {
      properties.push(["softness", formatNumber(softness)]);
    }
    return { service: "luma", properties };
  }
  if (
    transition.capabilityId === capabilityIds.audioCrossfade ||
    transition.capabilityId === capabilityIds.mix
  ) {
    requireCapability(options, capabilityIds.mix, "Audio transition");
    assertKnownTransitionParameters(transition, ["curve", "reverse"]);
    const curve = transition.parameters.curve ?? "linear";
    if (curve !== "linear" && curve !== "equal_power") {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        "Audio transition curve must be linear or equal_power",
        422,
      );
    }
    return {
      service: "mix",
      properties: [
        ["start", curve === "equal_power" ? -2 : -1],
        ["reverse", booleanParameter(transition, "reverse") ? 1 : 0],
      ],
    };
  }
  capabilityUnavailable(
    `Transition ${transition.capabilityId} has no normalized MLT mapping`,
    "transition.capabilityId",
    transition.capabilityId,
    [capabilityIds.dissolve, capabilityIds.audioCrossfade],
  );
}

function playlistEntry(
  producerId: string,
  sourceStart: number,
  duration: number,
  indentation = "    ",
): string {
  return `${indentation}<entry producer="${escapeXml(producerId)}" in="${sourceStart}" out="${sourceStart + duration - 1}"/>`;
}

function compileCutPlaylist(
  id: string,
  from: Clip,
  to: Clip,
  transitionSpan: FrameSpan,
  cut: number,
  rate: RationalRate,
): string {
  const lines = [`  <playlist id="${escapeXml(id)}">`];
  const beforeCut = cut - transitionSpan.start;
  const afterCut = transitionSpan.end - cut;
  if (beforeCut > 0) {
    lines.push(
      playlistEntry(
        `producer_${from.id}`,
        sourceFrameAt(from, transitionSpan.start, rate),
        beforeCut,
      ),
    );
  }
  if (afterCut > 0) {
    lines.push(
      playlistEntry(
        `producer_${to.id}`,
        sourceFrameAt(to, cut, rate),
        afterCut,
      ),
    );
  }
  lines.push("  </playlist>");
  return lines.join("\n");
}

function compileTransitionGraph(
  transition: Transition,
  track: Track,
  project: Project,
  sequence: Sequence,
  options: MltCompilerOptions,
): string[] {
  const rate = sequence.format.frameRate;
  const from = track.items.find(
    (item): item is Clip =>
      item.id === transition.fromItemId && item.type === "clip",
  );
  const to = track.items.find(
    (item): item is Clip =>
      item.id === transition.toItemId && item.type === "clip",
  );
  if (from === undefined || to === undefined || !from.enabled || !to.enabled) {
    capabilityUnavailable(
      "The current MLT transition adapter requires two enabled clip endpoints",
      "transition.endpoints",
      { fromItemId: transition.fromItemId, toItemId: transition.toItemId },
    );
  }
  const fromSpan = itemSpan(from, rate);
  const toSpan = itemSpan(to, rate);
  const span = itemSpan(transition, rate);
  if (fromSpan.end !== toSpan.start) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Transition endpoints must meet at one edit point",
      422,
    );
  }
  const cut = fromSpan.end;
  if (
    span.start >= cut ||
    span.end <= cut ||
    span.start < fromSpan.start ||
    span.end > toSpan.end
  ) {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "Transition range must straddle its endpoint edit point",
      422,
    );
  }
  const duration = span.end - span.start;
  const fromSourceStart = sourceFrameAt(from, span.start, rate);
  const toSourceStart = sourceFrameAt(to, span.start, rate);
  assertSourceSpan(
    from,
    project,
    sequence,
    fromSourceStart,
    duration,
    `Transition ${transition.id}`,
  );
  assertSourceSpan(
    to,
    project,
    sequence,
    toSourceStart,
    duration,
    `Transition ${transition.id}`,
  );

  const mapping = transitionProperties(transition, options);
  if (mapping.service === "luma" && track.kind === "audio") {
    throw new FrameOSError(
      "VALIDATION_ERROR",
      "A video transition cannot be placed on an audio track",
      422,
    );
  }
  const prefix = `transition_${transition.id}`;
  const fromPlaylistId = `${prefix}_from`;
  const toPlaylistId = `${prefix}_to`;
  const cutPlaylistId = `${prefix}_cut`;
  const fromPlaylist = [
    `  <playlist id="${escapeXml(fromPlaylistId)}">`,
    playlistEntry(`producer_${from.id}`, fromSourceStart, duration),
    "  </playlist>",
  ].join("\n");
  const toPlaylist = [
    `  <playlist id="${escapeXml(toPlaylistId)}">`,
    playlistEntry(`producer_${to.id}`, toSourceStart, duration),
    "  </playlist>",
  ].join("\n");
  const cutPlaylist = compileCutPlaylist(
    cutPlaylistId,
    from,
    to,
    span,
    cut,
    rate,
  );
  const videoTransition = mapping.service === "luma";
  const tracks = videoTransition
    ? [
        `      <track producer="${escapeXml(fromPlaylistId)}" hide="audio"/>`,
        `      <track producer="${escapeXml(toPlaylistId)}" hide="audio"/>`,
        `      <track producer="${escapeXml(cutPlaylistId)}" hide="video"/>`,
      ]
    : [
        `      <track producer="${escapeXml(cutPlaylistId)}" hide="audio"/>`,
        `      <track producer="${escapeXml(fromPlaylistId)}" hide="video"/>`,
        `      <track producer="${escapeXml(toPlaylistId)}" hide="video"/>`,
      ];
  const aTrack = videoTransition ? 0 : 1;
  const bTrack = videoTransition ? 1 : 2;
  const tractor = [
    `  <tractor id="${escapeXml(prefix)}" in="0" out="${duration - 1}">`,
    "    <multitrack>",
    ...tracks,
    "    </multitrack>",
    `    <transition id="${escapeXml(`${prefix}_service`)}" in="0" out="${duration - 1}">`,
    property("a_track", aTrack),
    property("b_track", bTrack),
    property("mlt_service", mapping.service),
    ...mapping.properties.map(([name, value]) => property(name, value)),
    "    </transition>",
    "  </tractor>",
  ].join("\n");
  return [fromPlaylist, toPlaylist, cutPlaylist, tractor];
}

function compileContainerEffects(
  targetId: string,
  effects: readonly EffectInstance[],
  sequence: Sequence,
  targetSpan: AudioSampleSpan,
  mediaKind: Track["kind"] | "output",
  options: MltCompilerOptions,
  scope: "track" | "output",
): string[] {
  const lines: string[] = [];
  for (const effect of effects) {
    if (!effect.enabled) continue;
    if (effect.capabilityId === "frameos.color.primary") {
      if (mediaKind !== "video" && mediaKind !== "output") {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Primary color effect ${effect.id} cannot be attached to a ${mediaKind} track`,
          422,
        );
      }
      lines.push(...compilePrimaryColorEffect(targetId, effect, options));
      continue;
    }
    if (effect.capabilityId === "frameos.audio.channel-strip") {
      if (mediaKind === "caption" || mediaKind === "data") {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Audio channel-strip effect ${effect.id} cannot be attached to a ${mediaKind} track`,
          422,
        );
      }
      lines.push(
        ...compileAudioChannelStrip(
          targetId,
          effect,
          sequence,
          targetSpan,
          options,
        ),
      );
      continue;
    }
    capabilityUnavailable(
      `${scope === "track" ? "Track" : "Sequence output"} effect ${effect.capabilityId} has no normalized MLT mapping`,
      `effects.${effect.id}.capabilityId`,
      effect.capabilityId,
      ["frameos.color.primary", "frameos.audio.channel-strip"],
    );
  }
  return lines;
}

function compileTrack(
  project: Project,
  sequence: Sequence,
  trackIndex: number,
  options: MltCompilerOptions,
): CompiledTrack {
  const track = sequence.tracks[trackIndex];
  if (track === undefined) {
    throw new FrameOSError("INTERNAL_ERROR", "Track index was invalid", 500);
  }
  if (!track.enabled) {
    return {
      supportGraphs: [],
      playlist: `  <playlist id="playlist_${escapeXml(track.id)}">\n  </playlist>`,
    };
  }
  const rate = sequence.format.frameRate;
  const transitions = track.items
    .filter(
      (item): item is Transition => item.type === "transition" && item.enabled,
    )
    .sort(
      (left, right) =>
        itemStartFrames(left, rate) - itemStartFrames(right, rate),
    );
  for (let index = 1; index < transitions.length; index += 1) {
    const previous = transitions[index - 1];
    const current = transitions[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      itemSpan(previous, rate).end > itemSpan(current, rate).start
    ) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Transitions ${previous.id} and ${current.id} overlap`,
        422,
      );
    }
  }
  const supportGraphs = transitions.flatMap((transition) =>
    compileTransitionGraph(transition, track, project, sequence, options),
  );
  supportGraphs.push(
    ...track.items
      .filter((item): item is Title => item.type === "title" && item.enabled)
      .map((title) => compileTitleProducer(title, options)),
  );
  const editorialItems = track.items
    .filter((item) => item.type !== "transition")
    .sort(
      (left, right) =>
        itemStartFrames(left, rate) - itemStartFrames(right, rate),
    );
  const lines = [`  <playlist id="playlist_${escapeXml(track.id)}">`];
  let cursor = 0;
  const timelineEnd = Math.max(
    0,
    ...editorialItems.map((item) => itemSpan(item, rate).end),
    ...transitions.map((item) => itemSpan(item, rate).end),
  );
  while (cursor < timelineEnd) {
    const transition = transitions.find(
      (candidate) => itemSpan(candidate, rate).start === cursor,
    );
    if (transition !== undefined) {
      const span = itemSpan(transition, rate);
      lines.push(
        playlistEntry(`transition_${transition.id}`, 0, span.end - span.start),
      );
      cursor = span.end;
      continue;
    }
    const item = editorialItems.find((candidate) => {
      const span = itemSpan(candidate, rate);
      return span.start <= cursor && span.end > cursor;
    });
    const nextTransitionStart = transitions
      .map((candidate) => itemSpan(candidate, rate).start)
      .filter((start) => start > cursor)
      .sort((left, right) => left - right)[0];
    if (item === undefined) {
      const nextItemStart = editorialItems
        .map((candidate) => itemSpan(candidate, rate).start)
        .filter((start) => start > cursor)
        .sort((left, right) => left - right)[0];
      const next = Math.min(
        nextItemStart ?? timelineEnd,
        nextTransitionStart ?? timelineEnd,
      );
      lines.push(`    <blank length="${next - cursor}"/>`);
      cursor = next;
      continue;
    }
    const span = itemSpan(item, rate);
    const end = Math.min(span.end, nextTransitionStart ?? span.end);
    const duration = end - cursor;
    if (!item.enabled) {
      lines.push(`    <blank length="${duration}"/>`);
    } else if (item.type === "clip") {
      lines.push(
        playlistEntry(
          `producer_${item.id}`,
          sourceFrameAt(item, cursor, rate),
          duration,
        ),
      );
    } else if (item.type === "generator") {
      lines.push(
        playlistEntry(
          `producer_generator_${item.id}`,
          cursor - span.start,
          duration,
        ),
      );
    } else if (item.type === "nested_sequence") {
      assertNestedSequenceSupport(item);
      requireCapability(options, "mlt.producer.xml", "Nested sequence");
      const nested = project.sequences[item.sequenceId];
      if (nested === undefined) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Nested sequence ${item.sequenceId} was not found`,
          422,
        );
      }
      const sourceRangeStart =
        item.sourceRange === undefined
          ? 0
          : rescaleTime(item.sourceRange.start, rate).time.value;
      const sourceRangeDuration =
        item.sourceRange === undefined
          ? sequenceDurationFrames(nested) - sourceRangeStart
          : rescaleTime(item.sourceRange.duration, rate).time.value;
      const sourceStart = sourceRangeStart + cursor - span.start;
      if (
        sourceStart < sourceRangeStart ||
        sourceStart + duration > sourceRangeStart + sourceRangeDuration ||
        sourceStart + duration > sequenceDurationFrames(nested)
      ) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Nested-sequence item ${item.id} exceeds its source range`,
          422,
        );
      }
      lines.push(
        playlistEntry(`sequence_${item.sequenceId}`, sourceStart, duration),
      );
    } else if (item.type === "title") {
      lines.push(
        playlistEntry(
          `producer_text_${item.id}`,
          cursor - span.start,
          duration,
        ),
      );
    } else if (item.type === "gap") {
      lines.push(`    <blank length="${duration}"/>`);
    } else {
      const unsupported = item as TimelineItem;
      capabilityUnavailable(
        `The MLT adapter cannot compile ${unsupported.type} items yet`,
        "timelineItem.type",
        unsupported.type,
      );
    }
    cursor = end;
  }
  lines.push(
    ...compileContainerEffects(
      track.id,
      track.effects,
      sequence,
      sampleSpan(
        { value: 0, rate },
        { value: timelineEnd, rate },
        sequence.format.sampleRate,
      ),
      track.kind,
      options,
      "track",
    ),
  );
  lines.push("  </playlist>");
  return { supportGraphs, playlist: lines.join("\n") };
}

function trackHide(track: Sequence["tracks"][number]): string | undefined {
  if (track.kind === "audio" && track.muted) return "both";
  if (track.kind === "audio") return "video";
  if (track.muted) return "audio";
  return undefined;
}

function assertSequenceRenderSupport(sequence: Sequence): void {
  if (sequence.buses.length > 0) {
    capabilityUnavailable(
      "The MLT adapter cannot compile audio buses yet",
      "buses",
      "audio-bus",
    );
  }
  if (!["rec709", "bt709", "709"].includes(sequence.format.colorSpace)) {
    capabilityUnavailable(
      `Sequence color space ${sequence.format.colorSpace} has no audited output mapping`,
      "sequence.format.colorSpace",
      sequence.format.colorSpace,
      ["rec709"],
    );
  }
}

function formatsMatch(left: Sequence, right: Sequence): boolean {
  return (
    left.format.width === right.format.width &&
    left.format.height === right.format.height &&
    left.format.frameRate.numerator === right.format.frameRate.numerator &&
    left.format.frameRate.denominator === right.format.frameRate.denominator &&
    left.format.sampleRate === right.format.sampleRate &&
    left.format.channels === right.format.channels &&
    left.format.pixelAspectRatio.numerator ===
      right.format.pixelAspectRatio.numerator &&
    left.format.pixelAspectRatio.denominator ===
      right.format.pixelAspectRatio.denominator &&
    left.format.colorSpace === right.format.colorSpace
  );
}

function collectRenderSequences(
  project: Project,
  selected: Sequence,
): Sequence[] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: Sequence[] = [];
  const visit = (sequence: Sequence): void => {
    if (visiting.has(sequence.id)) {
      throw new FrameOSError(
        "VALIDATION_ERROR",
        `Nested sequence graph contains a cycle at ${sequence.id}`,
        422,
      );
    }
    if (visited.has(sequence.id)) return;
    if (!formatsMatch(selected, sequence)) {
      capabilityUnavailable(
        "Nested sequences with a different format require an unavailable conform adapter",
        "nestedSequence.format",
        { parent: selected.format, nested: sequence.format },
      );
    }
    visiting.add(sequence.id);
    for (const item of sequence.tracks
      .filter((track) => track.enabled)
      .flatMap((track) => track.items)) {
      if (item.type !== "nested_sequence" || !item.enabled) continue;
      const nested = project.sequences[item.sequenceId];
      if (nested === undefined) {
        throw new FrameOSError(
          "VALIDATION_ERROR",
          `Nested sequence ${item.sequenceId} was not found`,
          422,
        );
      }
      visit(nested);
    }
    visiting.delete(sequence.id);
    visited.add(sequence.id);
    ordered.push(sequence);
  };
  visit(selected);
  return ordered;
}

function compileSequenceGraph(
  project: Project,
  sequence: Sequence,
  outputId: string,
  options: MltCompilerOptions,
): string[] {
  const compiledTracks = sequence.tracks.map((_, index) =>
    compileTrack(project, sequence, index, options),
  );
  const compiledCaptions = sequence.captions.map((track) =>
    compileCaptionTrack(track, sequence, options),
  );
  const trackElements = sequence.tracks
    .filter((track) => track.enabled)
    .toSorted((left, right) => left.order - right.order)
    .map((track) => {
      const hide = trackHide(track);
      return `      <track producer="playlist_${escapeXml(track.id)}"${hide === undefined ? "" : ` hide="${hide}"`}/>`;
    })
    .concat(
      sequence.captions
        .filter((track) => track.enabled)
        .map(
          (track) =>
            `      <track producer="caption_playlist_${escapeXml(track.id)}" hide="audio"/>`,
        ),
    );
  const outputFilters = compileContainerEffects(
    sequence.id,
    sequence.outputEffects,
    sequence,
    sampleSpan(
      { value: 0, rate: sequence.format.frameRate },
      {
        value: sequenceDurationFrames(sequence),
        rate: sequence.format.frameRate,
      },
      sequence.format.sampleRate,
    ),
    "output",
    options,
    "output",
  );
  return [
    ...compiledTracks.flatMap((track) => track.supportGraphs),
    ...compiledCaptions.flatMap((track) => track.supportGraphs),
    ...compiledTracks.map((track) => track.playlist),
    ...compiledCaptions.map((track) => track.playlist),
    `  <tractor id="${escapeXml(outputId)}">`,
    "    <multitrack>",
    ...trackElements,
    "    </multitrack>",
    ...outputFilters,
    "  </tractor>",
  ];
}

export function compileMltXml(
  project: Project,
  sequenceId?: string,
  options: MltCompilerOptions = {},
): string {
  const selectedId = sequenceId ?? project.settings.defaultSequenceId;
  const selected = project.sequences[selectedId];
  if (selected === undefined) {
    throw new FrameOSError(
      "NOT_FOUND",
      `Sequence ${selectedId} was not found`,
      404,
    );
  }
  const sequences = collectRenderSequences(project, selected);
  for (const sequence of sequences) assertSequenceRenderSupport(sequence);

  const clips = sequences.flatMap((sequence) =>
    sequence.tracks.flatMap((track) =>
      track.enabled
        ? track.items.filter(
            (item): item is Clip => item.type === "clip" && item.enabled,
          )
        : [],
    ),
  );
  const generators = sequences.flatMap((sequence) =>
    sequence.tracks.flatMap((track) =>
      track.enabled
        ? track.items.filter(
            (item): item is Generator =>
              item.type === "generator" && item.enabled,
          )
        : [],
    ),
  );
  const rate = selected.format.frameRate;
  const producers = sequences.flatMap((sequence) =>
    clips
      .filter((clip) =>
        sequence.tracks.some((track) =>
          track.items.some((item) => item.id === clip.id),
        ),
      )
      .map((clip) => compileProducer(clip, project, sequence, options)),
  );
  const generatorProducers = generators.map((generator) =>
    compileGenerator(generator, options),
  );
  const sequenceGraphs = sequences.flatMap((sequence) =>
    compileSequenceGraph(
      project,
      sequence,
      sequence.id === selected.id
        ? "frameos_output"
        : `sequence_${sequence.id}`,
      options,
    ),
  );

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<mlt LC_NUMERIC="C" version="7.40.0">',
    `  <profile width="${selected.format.width}" height="${selected.format.height}" frame_rate_num="${rate.numerator}" frame_rate_den="${rate.denominator}" sample_aspect_num="${selected.format.pixelAspectRatio.numerator}" sample_aspect_den="${selected.format.pixelAspectRatio.denominator}" progressive="1" colorspace="709"/>`,
    ...producers,
    ...generatorProducers,
    ...sequenceGraphs,
    "</mlt>",
    "",
  ].join("\n");
}
