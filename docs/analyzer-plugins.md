# Isolated analyzer plugins

FrameOS model-backed analysis runs outside the daemon. Configure one or more manifests with `FRAMEOS_ANALYZER_MANIFESTS`, using semicolon-separated JSON file paths. A valid manifest makes its analyzer available through the existing capability, REST, job, MCP, cache, and search contracts; it does not create a second analysis system.

Each manifest pins:

- the protocol, analyzer, and executable versions;
- the executable SHA-256 and license;
- the optional model SHA-256, version, and license;
- every adapter script, vocabulary, label map, or other executable input as a hash-pinned resource;
- accepted asset kinds, declared output types, JSON Schema parameters, timeout, output-byte, and segment limits.

Relative paths resolve from the manifest directory. Files referenced by executable arguments must also be declared as a resource. Missing files, hash mismatches, and unpinned script arguments leave the analyzer discoverable but unavailable. FrameOS verifies every executable, model, and resource again immediately before execution.

The executable receives one `AnalyzerWorkerRequest` JSON object followed by a newline on standard input. The request contains canonical paths for the verified model and named resources, so a worker does not need ambient path configuration. It writes newline-delimited `progress`, `result`, or `error` events to standard output. The generated schemas are:

- `packages/contracts/schema/analyzer-plugin-manifest.schema.json`
- `packages/contracts/schema/analyzer-worker-request.schema.json`
- `packages/contracts/schema/analyzer-worker-event.schema.json`

The daemon starts the executable directly without a shell, passes only a small non-secret environment, enforces manifest limits, validates every event, assigns canonical UUIDv7 segment identifiers, and terminates the process on cancellation. Output types not declared in the manifest are rejected as `PLUGIN_FAILURE`.

## whisper.cpp adapter

`tools/analyzers/whisper-cpp-worker.mjs` is the production protocol adapter for the upstream `whisper-cli`. It maps segment offsets to millisecond rational times, averages token probabilities into segment confidence, and retains word ranges and probabilities in segment metadata. The adapter accepts `language`, `translate`, `threads`, `noGpu`, `prompt`, `maxLength`, `temperature`, and `splitOnWord` parameters.

The manifest must declare the CLI as the unique `whisper-cli` resource. The model uses the manifest's `model` field. For inputs other than FLAC, MP3, OGG, or WAV, declare an audited FFmpeg executable as the `ffmpeg` resource; the adapter extracts 16 kHz mono PCM before transcription. Every process is launched with an argument array and without a shell.

Generate a locally hash-pinned manifest with:

```powershell
npm run analyzer:whisper-manifest -- `
  --whisper C:\path\to\whisper-cli.exe `
  --whisper-version 1.8.5 `
  --model C:\path\to\ggml-base.bin `
  --model-version base `
  --model-license "reviewed model license" `
  --ffmpeg C:\path\to\ffmpeg.exe `
  --ffmpeg-version 8.0 `
  --ffmpeg-license "audited build license" `
  --output C:\path\to\whisper.frameos-analyzer.json
```

Omit the three FFmpeg arguments only if the analyzer will receive supported audio files exclusively. The generator deliberately labels the Node runtime for distribution review; generation is not license approval.

## FFmpeg silence analyzer

`tools/analyzers/ffmpeg-silence-worker.mjs` exposes the official `silencedetect` filter as `ffmpeg.silence.detect`. It returns millisecond rational ranges with the `silence` label and records the exact noise threshold and minimum duration in artifact metadata. Generate its manifest with:

```powershell
npm run analyzer:silence-manifest -- `
  --ffmpeg C:\path\to\ffmpeg.exe `
  --ffmpeg-version 8.0 `
  --ffmpeg-license "audited build license" `
  --output C:\path\to\silence.frameos-analyzer.json
```

Configure both generated manifests by separating their paths with a semicolon in `FRAMEOS_ANALYZER_MANIFESTS`.

## FFmpeg scene analyzer

`tools/analyzers/ffmpeg-scene-worker.mjs` exposes FFmpeg's `select` scene score and `showinfo` timestamps as `ffmpeg.scene.detect`. It requires a probed video duration and returns deterministic, contiguous millisecond ranges labeled `scene` and `shot`. `threshold` controls the scene-score cutoff and `minSceneDurationMs` suppresses boundaries that would create very short ranges.

Generate its hash-pinned manifest with:

```powershell
npm run analyzer:scenes-manifest -- `
  --ffmpeg C:\path\to\ffmpeg.exe `
  --ffmpeg-version 8.0 `
  --ffmpeg-license "audited build license" `
  --output C:\path\to\scenes.frameos-analyzer.json
```

The manifest pins the Node runtime, protocol adapter, and exact FFmpeg binary. Generation records the supplied license statement but does not constitute license approval. Add any combination of the transcription, silence, and scene manifest paths to `FRAMEOS_ANALYZER_MANIFESTS`, separated by semicolons.

## FFmpeg beat/onset analyzer

`tools/analyzers/ffmpeg-beat-worker.mjs` decodes 8 kHz mono float PCM with the audited FFmpeg binary, then runs FrameOS's deterministic energy-flux onset detector. It returns millisecond ranges labeled `beat` and `onset`, per-onset confidence, and a median-interval BPM estimate when at least two onsets are found. The `sensitivity`, `minIntervalMs`, and `windowMs` parameters control peak selection without changing the decoder contract.

Generate its hash-pinned manifest with:

```powershell
npm run analyzer:beats-manifest -- `
  --ffmpeg C:\path\to\ffmpeg.exe `
  --ffmpeg-version 8.0 `
  --ffmpeg-license "audited build license" `
  --output C:\path\to\beats.frameos-analyzer.json
```

The detector is designed to provide reproducible cut candidates, not musicological beat-grid guarantees. Consumers should inspect confidence and preview edits derived from the markers.

Example manifest outline:

```json
{
  "schemaVersion": "1.0.0",
  "protocolVersion": "1.0.0",
  "id": "whisper.cpp.transcribe",
  "version": "1.0.0",
  "capabilityId": "analysis.transcription.whisper",
  "name": "Local speech transcription",
  "description": "Word-timestamped transcription through an audited wrapper",
  "outputTypes": ["transcript", "words"],
  "assetKinds": ["video", "audio"],
  "deterministic": false,
  "parameterSchema": {
    "type": "object",
    "properties": {
      "language": { "type": "string" }
    },
    "additionalProperties": false
  },
  "executable": {
    "path": "bin/frameos-whisper-worker",
    "sha256": "<64 lowercase hex characters>",
    "version": "1.0.0",
    "license": "MIT",
    "arguments": []
  },
  "model": {
    "path": "models/ggml-model.bin",
    "sha256": "<64 lowercase hex characters>",
    "version": "model-release",
    "license": "<reviewed model license>"
  },
  "resources": [],
  "limits": {
    "timeoutMs": 1800000,
    "maxOutputBytes": 67108864,
    "maxSegments": 250000
  },
  "metadata": {}
}
```

The placeholders must be replaced with exact hashes before configuration. Runtime installation does not imply redistribution approval. Bundling a worker or model still requires addition to the distribution allowlist, SBOM coverage, and legal review.
