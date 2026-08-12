# FrameOS

FrameOS is an API-first, agent-native video editing platform. Its product surface is a deterministic JSON editing document and a transaction API; MLT, FFmpeg, OpenFX, user interfaces, and AI models are adapters around that core.

This repository currently implements the contract-first editing kernel:

- Frame-accurate canonical project IR using rational time
- Persistent project bundles with append-only history and crash recovery
- Atomic validate/preview/commit transactions with optimistic concurrency
- A typed 200+ operation taxonomy with 150 executable operations
- Authenticated REST, WebSocket events, MCP stdio/HTTP, and a CLI
- Atomic SRT/WebVTT caption import and revision-pinned export with explicit loss warnings
- Provider-neutral agent sessions and schema-validated planning
- Persisted three-cycle draft evaluation/revision with approval supersession
- Typed frame/region/contact-sheet and PCM waveform preview jobs with authenticated artifact delivery
- Reproducible analysis jobs with FTS5 search, isolated hash-pinned analyzer workers, and manifest-gated whisper.cpp transcription plus FFmpeg silence, scene, and beat/onset adapters
- Semantic search plus non-mutating silence removal, beat-synchronized cuts, dynamic captions, and vertical-edit plans compiled into ordinary transactions
- Non-mutating vertical-format plans compiled into reversible sequence and transform operations
- Hash-based external/managed asset ingestion with portable project-bundle URIs
- Revision-safe, idempotent managed proxy generation through the isolated worker
- Revision-pinned source thumbnails with authenticated PNG/provenance artifacts
- An isolated C++20 engine-worker boundary with MLT runtime capability discovery
- OTIO editorial interchange with explicit loss reports and lossless FrameOS metadata

## Quick start

Requirements: Node.js 24+ and npm 11+.

```bash
npm install
npm run check
npm run dev
```

On first launch, the daemon writes a random bearer token to `.frameos-data/auth-token`. The local API listens on `http://127.0.0.1:31415` by default. Use `Authorization: Bearer <token>` for `/api/v1/*` requests.

```bash
curl http://127.0.0.1:31415/health
curl -H "Authorization: Bearer $FRAMEOS_TOKEN" http://127.0.0.1:31415/api/v1/capabilities
```

The native MLT worker is capability-gated. If the audited worker/runtime is absent, editing state and transaction APIs remain usable while render calls report `CAPABILITY_UNAVAILABLE`; FrameOS never silently invokes an unapproved system codec build. When present, frame, region, and evenly sampled contact-sheet previews use the same compiled graph as final output and expose artifacts through authenticated job URLs rather than local paths.

## Repository layout

- `packages/contracts` — canonical schemas, operation catalog, OpenAPI, MCP definitions, and worker protocol
- `apps/daemon` — project store, transaction engine, REST/WebSocket/MCP server, and agent abstractions
- `apps/cli` — command-line client over the same authenticated REST contract
- `native/engine-worker` — isolated C++20 MLT/FFmpeg process boundary
- `docs` — architecture decisions, security posture, capability and licensing policy

## Status

FrameOS is pre-alpha. The deterministic editing kernel, API contract, initial OTIO adapter, isolated analyzer protocol, semantic silence-removal and vertical-edit compilers, and deterministic agent evaluation/revision loop are implemented. Advanced visual intelligence, MLT-enabled cross-platform render conformance, and signed native installers remain explicit capability gates instead of being reported as already available.

See [implementation status](docs/implementation-status.md), [API integration](docs/api.md), and [development](docs/development.md) for the exact implemented surface and next capability gates.
