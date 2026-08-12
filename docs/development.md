# Development and verification

Requirements for the control plane are Node.js 24+ and npm 11+. The native stub requires CMake 3.24+ and a C++20 compiler. An MLT-enabled build additionally requires MLT/MLT++ 7.40 development packages discoverable as `mlt++-7` through pkg-config.

```powershell
npm install
npm run check
npm run build

cmake -S native/engine-worker -B build/engine-worker -DFRAMEOS_WITH_MLT=OFF
cmake --build build/engine-worker --config Release
ctest --test-dir build/engine-worker -C Release --output-on-failure
npm run sbom
cpack --config build/engine-worker/CPackConfig.cmake -C Release -B build/packages
```

The SBOM command hashes the exact native worker binary and appends it to npm's CycloneDX dependency graph. The generated `build/frameos.cdx.json` and native portable archive remain release candidates only: `third-party/distribution-allowlist.yml` still requires module inspection and legal approval for every MLT/FFmpeg-enabled build. CI emits these files separately for Windows, macOS, and Ubuntu.

For a local end-to-end run, set `FRAMEOS_ENGINE_WORKER` to the absolute worker executable path. A worker built without MLT deliberately reports `engine.mlt` unavailable; this tests capability gating and worker-failure isolation without using the machine's unaudited FFmpeg installation. That worker still exposes the MIT-licensed deterministic PCM16 WAV-to-SVG waveform path, which has no codec dependency.

Important environment variables:

- `FRAMEOS_DATA_DIR`, `FRAMEOS_HOST`, `FRAMEOS_PORT`, `FRAMEOS_AUTH_TOKEN`
- `FRAMEOS_MEDIA_ROOTS` as semicolon-separated absolute roots
- `FRAMEOS_TLS_CERT` and `FRAMEOS_TLS_KEY`, required outside loopback
- `FRAMEOS_SCOPED_TOKENS`, required outside loopback; JSON entries contain `id`, `token`, and least-privilege `scopes`
- `FRAMEOS_ENGINE_WORKER`
- `FRAMEOS_ANALYZER_MANIFESTS` as semicolon-separated, explicitly trusted analyzer manifest paths; see `docs/analyzer-plugins.md`
- `FRAMEOS_OPENAI_API_KEY`, `FRAMEOS_OPENAI_MODEL`, and optional `FRAMEOS_OPENAI_BASE_URL`

Never commit `.frameos-data`, provider credentials, media files, render outputs, or unreviewed native binaries.
