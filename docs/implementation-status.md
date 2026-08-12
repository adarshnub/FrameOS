# Implementation status

FrameOS is pre-alpha. This table distinguishes working code from a public contract or planned implementation.

| Area                                                          | Current state                                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Canonical project IR and rational time                        | Implemented                                                                                                   |
| Schema artifacts and operation taxonomy                       | Implemented                                                                                                   |
| Atomic validate/preview/commit, idempotency, revisions, undo  | Implemented core                                                                                              |
| REST, WebSocket events, MCP stdio/HTTP, CLI                   | Implemented core                                                                                              |
| Worker isolation and deterministic MLT XML compiler           | Clips, transforms, clip audio/channel strips, primary color, transitions, generators, titles, captions mapped |
| Runtime MLT service discovery                                 | Implemented with normalized agent-facing adapter capabilities                                                 |
| Native rendering                                              | Capability-gated; requires audited MLT build                                                                  |
| Frame/region/contact-sheet preview and artifact delivery      | Implemented; visual timeline generation requires audited MLT build                                            |
| Waveform preview and artifact delivery                        | Native deterministic SVG for PCM16 WAV; broader formats remain FFmpeg-gated                                   |
| Provider-neutral agent sessions and structured planning       | Implemented core                                                                                              |
| Agent operation execution and approval policy                 | Implemented draft/commit core                                                                                 |
| Deterministic agent evaluation and three-cycle revision loop  | Implemented; records previews when MLT is available; model review gated                                       |
| Complete 100+ operation editor surface                        | 150 low-level operations executable; remaining families capability-gated                                      |
| Titles and SRT/WebVTT caption surface                         | Atomic interchange plus audited qtext mapping for normalized static/typewriter text; word highlight gated     |
| Normalized color pipeline operations                          | Full state; primary exposure/contrast/saturation/temperature/curves/full LUT mapped, advanced controls gated  |
| Normalized audio processing operations                        | Full state surface; static denoise/EQ/compressor/limiter/integrated normalization plus clip pan/gain mapped   |
| Normalized generators                                         | Solid color + opacity mapped to audited MLT color producer                                                    |
| Nested sequences and logical item groups                      | Transactional/cycle-safe; matching-format neutral nesting compiles recursively                                |
| Asset analysis/search/vector index                            | Metadata/subtitles + hash-pinned whisper.cpp and FFmpeg silence/scene/beat workers + FTS5; binaries gated     |
| Semantic find, silence removal, vertical, beat cuts, captions | Non-mutating plans of ordinary low-level operations implemented                                               |
| Managed/external asset ingestion and probing                  | SHA-256 identity and managed copies implemented; audited native A/V probe gated                               |
| Managed proxies and source thumbnails                         | Async, idempotent, revision-pinned derivatives; audited MLT/codec runtime gated                               |
| Render-profile selection and output provenance manifests      | Implemented core; advanced codec/color fields gated                                                           |
| OTIO import/export                                            | Implemented editorial subset + FrameOS metadata                                                               |
| Native archives, SBOM, and cross-platform worker smoke tests  | Implemented in CI; signed installers and media golden conformance remain planned                              |

An unavailable feature returns `CAPABILITY_UNAVAILABLE`; it is never silently ignored.
