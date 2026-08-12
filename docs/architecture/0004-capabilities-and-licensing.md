# ADR 0004: Runtime capabilities are allowlisted

Status: accepted

MLT module, FFmpeg codec, OpenFX, hardware, model, and font availability varies by host and license. The running daemon's capability catalog is authoritative.

An MLT-enabled worker queries the service repository and metadata API at runtime. Discovered services outside the compiled distribution allowlist are reported as unavailable rather than loaded on an agent's request. Default packages must use the audited dependency manifest and must not call the GPL `melt` application.

A release is blocked until its SBOM and license report show that every distributed binary, linked library, service module, codec, plugin, font, and model weight is approved. Host extras remain opt-in and never silently expand the baseline.

The initial normalized compiler allowlists the LGPL MLT `affine`, `crop`, and `panner` filters and the `luma` and `mix` transitions. Clip gain and mute use `avfilter.volume` only when it comes from the reviewed MLT avformat module linked to the required `--disable-gpl --disable-nonfree` FFmpeg build. MLT's separate GPL `volume` filter is deliberately excluded. Every mapping checks the runtime capability snapshot before graph generation.
