# AI editing and compositing acceptance

Use **Advanced AI editing & effects** in Studio. Select sources when assembling new footage, or select an existing timeline clip for an in-place edit. Describe timing, the intended result and any text. Review the proposed operations, then approve. The complete advanced plan commits as one transaction; one Undo restores the prior timeline. Retrying after an uncertain network response uses the same transaction key.

## Effects available to the advanced assistant

| Request                              | Normalized capability              | Controls and current boundary                                                                                                                      |
| ------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Green-screen compositing             | `frameos.video.chroma-key`         | Hex key colour and tolerance 0–1; foreground video/image over a lower video track. No spill suppression, matte refinement or tracking.             |
| Gaussian blur                        | `frameos.video.gaussian-blur`      | Sigma 0–100 pixels; static, whole clip, no mask.                                                                                                   |
| Vignette                             | `frameos.video.vignette`           | Strength 0–1; static, whole clip, no mask.                                                                                                         |
| Animated title                       | `title.add`, `item.automation.set` | Text over footage, with native position/scale/rotation/opacity transforms. Linear position and opacity keyframes are covered by native acceptance. |
| Existing colour and audio processing | Runtime capability catalog         | Installed, mapped controls only; the final graph must validate before approval.                                                                    |

The assistant receives effect IDs, parameter definitions and restrictions from the same definitions used by the renderer. It cannot request arbitrary FFmpeg expressions or load arbitrary plugins. Missing effects produce an unsupported-capability response. Newly created entity IDs are canonicalized and up to two bounded repairs cover malformed detailed output, timeline errors and unsupported render mappings; rejected drafts never reach the project.

Example briefs:

- “Put the green-screen clip above the blue background for four seconds. Key out #00ff00 with tolerance 0.15. Preserve the foreground and mute its audio.”
- “Add Gaussian blur with sigma 10 to the selected shot; keep its timing and other effects.”
- “Make a six-second montage from these two sources. Use three seconds each. Add FRAMEOS from seconds 1 to 3 on an overlay, fading in over half a second. Apply a vignette of 0.6 to the first shot and lower its sound to −6 dB.”

Export and review the native MP4 to assess these effects. Browser playback currently approximates effects and has limited layering/title animation parity.

## Reproducible checks

```sh
FRAMEOS_ENGINE_WORKER=/app/bin/frameos-engine-worker node tools/ai-effects-qa.mjs
# Also calls the configured Vertex Gemini provider and incurs provider usage:
FRAMEOS_ENGINE_WORKER=/app/bin/frameos-engine-worker node tools/ai-effects-qa.mjs --live
```

Use `FRAMEOS_QA_DIR` for isolated outputs. The script creates synthetic media and separate projects. Native checks decode keyed foreground/background pixels, vignette corners, blur edge energy and the title's fade-in. Live checks validate a two-clip effects/title/audio edit, one-step undo/redo, editing existing footage without reselecting assets, and a montage assembled from ten five-minute source files.

`cloudbuild.ai-effects.yaml` builds a candidate, runs native checks and saves private reports. It publishes only a passing image and does not deploy. Live-provider acceptance runs separately using the VM service identity before rollout.

On September 24, 2026, isolated VM acceptance passed all seven checks: four decoded native effect/title checks, an actual Gemini two-source montage with effect, animated title, audio change and one-step Undo, an in-place blur edit with no source re-selection, and a 20-second render assembled in order from ten separate five-minute 1080p sources. The machine-readable report is retained at `/opt/frameos/qa/ai-effects/report.json` on the VM. This test covers the requested source-count boundary and sampled output; it does not establish that every arbitrary edit or every 50-minute AI render succeeds.

## Remaining feature work

This is a bounded set of editing and compositing features. Object removal, camera/object tracking, roto/paint, particles, fire/smoke simulation, character rigs, general masks, advanced blending, OpenFX hosting and After Effects-compatible expressions are not implemented. Complex requests requiring these features must report the missing capability. No benchmark establishes that arbitrary creative requests will always succeed.

The native controls follow [MLT chroma](https://www.mltframework.org/plugins/FilterChroma/), [Gaussian blur](https://www.mltframework.org/plugins/FilterAvfilter-gblur/) and [vignette](https://www.mltframework.org/plugins/FilterAvfilter-vignette/). Pixel tests establish behaviour for the bundled worker; plugin documentation alone is not acceptance evidence.
