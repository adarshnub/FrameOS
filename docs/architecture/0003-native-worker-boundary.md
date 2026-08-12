# ADR 0003: Native media execution is process-isolated

Status: accepted

The TypeScript daemon never loads MLT, FFmpeg, or OpenFX into its process. It compiles an immutable FrameOS snapshot into an internal render graph and starts `frameos-engine-worker` without a shell.

The worker is killable, receives explicit input/output paths, emits machine-readable status, and may crash without terminating the daemon. Final render and analysis use separate worker lifetimes; interactive preview reuse is allowed only for one project revision.

Model-backed analyzers use a manifest-driven subprocess boundary. The daemon verifies the executable, model, and auxiliary-resource SHA-256 values at discovery and immediately before each execution. Analyzer parameters are checked against the manifest's JSON Schema. The child receives one bounded request over stdin, emits validated NDJSON events, inherits no provider credentials, and is terminated on cancellation or resource-limit failure. Artifact reproducibility keys include analyzer, executable bundle, model, asset, and parameter hashes.

The current subprocess protocols are deliberately small. Generated JSON Schemas are authoritative for the implemented local transport; `packages/contracts/proto/engine-worker.proto` reserves the stable future IPC contract for render and analysis. No raw MLT properties cross the public API unless a separately secured developer escape hatch is added.
