# Manual editor acceptance

Target: **1080p, up to 10 source clips, each up to five minutes**. A sequential assembly can therefore reach 50 minutes. This is the initial testing workload, not an unlimited-duration guarantee.

## Fixes in this revision

- Media playback uses authenticated HTTP byte ranges instead of downloading every source into browser memory. Seeking supports closed, open-ended and suffix ranges, with correct HEAD responses.
- Project-scoped playback cookies grant only media/artifact access. Downloads verify that the job belongs to the project. Media requests do not exhaust the control API's rate limit.
- Batch uploads continue past individual failures. A preview decoding failure cannot discard saved imports or prevent remaining uploads.
- Timeline fitting and ruler spacing support a 50-minute assembly. Frame stepping uses a sub-frame seek threshold. Image playback releases hidden video/audio resources.
- Repeated undo/redo reconstructs the editing cursor from persisted history. New edits discard the old redo branch; retries remain idempotent.
- Native source loading obtains the real duration before building playlists. The previous lazy loader reduced each playlist entry to one frame.
- Exports wait for every frame. Requested regions beyond the loaded timeline fail explicitly.
- Native video layers composite and audio tracks mix explicitly. Affine transforms preserve opacity. Headless Linux workers initialize Qt's offscreen backend so titles remain visible.
- Selecting a video layer in Studio Properties now exposes an editable native effect stack: chroma key, Gaussian blur, vignette and primary color. Effects can be parameterized, bypassed, removed and reordered. Selecting a title exposes text, font size/weight, color, background and placement. Video layers and titles can receive position, scale, rotation and opacity keyframes at the playhead. These controls write canonical transactions and remain undoable. Browser preview does not establish final effect or animation quality; export a native MP4 to review it.
- Adding a video with a probed audio stream places a muted picture clip and an audible clip from the same source on a separate audio track in one undoable transaction. The audio clip can be selected, trimmed, split, moved, deleted, muted and gain-adjusted independently. The pair carries reciprocal source links, but manual edits to one item do not automatically change the other; check sync after independent trims or moves. Existing audio tracks are reused when the new clip does not overlap their contents.
- The native worker now exits after a completed render without invoking the crashing MLT 7.12 graph teardown path. Three or more visible layers use pairwise compositing so a keyed foreground does not erase a middle title. An explicit audio mix keeps a lower audio lane audible beneath muted picture clips. Pairwise compositing duplicates source readers for visual processing, so export cost rises with layer count.
- Native exports and contact sheets queue behind the active render to avoid competing for memory. Queued cancellation does not start a worker or let later jobs overtake an active export.
- AI planning has a configurable ten-minute deadline and one cancellable retry for temporary HTTP 429/503 errors. Planning still requires approval before edits are applied.

## Reproducible native checks

Build the daemon and native worker, make `ffmpeg` and `ffprobe` available, then run:

```sh
FRAMEOS_ENGINE_WORKER=/path/to/frameos-engine-worker node tools/manual-editing-qa.mjs --long-render
FRAMEOS_ENGINE_WORKER=/path/to/frameos-engine-worker node tools/compositing-qa.mjs
FRAMEOS_ENGINE_WORKER=/path/to/frameos-engine-worker node tools/ai-effects-qa.mjs
```

Use `FRAMEOS_QA_DIR` to choose an isolated output directory. The default is `.frameos-data/qa/native`. These scripts use generated media and do not call an AI provider or change an existing project.

The manual check imports ten real five-minute files, constructs the 50-minute timeline, splits a clip, applies gain, exercises repeated undo/redo, and verifies that an invalid overlap leaves the revision unchanged. It renders seven 1080p regions from the beginning through the last two seconds, decodes their pictures and audio, checks the split's −9 dB gain change, and optionally exports the entire 50 minutes.

The compositing check decodes half-opacity footage, visible text over footage, and a two-tone audio mix. The AI effects check also renders a three-layer keyed/title composite and verifies that a detached source soundtrack can begin later than its picture. JSON reports record the actual outcome. Synthetic solid-colour sources establish timing and basic rendering behaviour; they do not establish performance or fidelity for every camera codec, variable frame rate, effect stack or real-world recording.

`cloudbuild.manual-qa.yaml` runs both scripts on a temporary GCP build worker, collects private artifacts in the configured bucket, and publishes a candidate image only if both reports pass. It never deploys the live editor. The build has a two-hour timeout.

## Acceptance result: September 24, 2026

Cloud Build `3fe52ea7-d4b1-4bd8-8f56-e72fc10b4126` passed both suites. The [manual report](qa/2026-09-24/manual-acceptance.json) records the complete **3,000-second, 1920×1080 H.264/AAC export**, seven native cut previews, repeated undo/redo and the measured gain change. The [compositing report](qa/2026-09-24/compositing.json) records opacity blending, visible titles and independent audio mixing without display environment overrides.

The manual suite took 8 minutes 42 seconds on the temporary build worker (container limited to six CPUs and 6 GB RAM). Sources were synthetic solid colours and tones; that timing is not a prediction for camera footage or complex effects. The production VM has four CPUs, so its timing will differ.

At that acceptance, all 182 unit/integration tests and workspace type checks passed. The agent benchmark recorded 17 passes, seven provider-dependent gates and zero failures. The later detached-audio and layered-render revision passed 184 daemon tests, 15 contract tests, the workspace checks, and the same benchmark counts.

`tools/http-editing-smoke.mjs /path/to/two-second-1080p-fixture.mp4` also passed against both the rebuilt local container and the public HTTPS deployment. It creates a clearly named QA project and exercises multipart upload, cookie-authenticated byte ranges, timeline commit, native export and cookie-authenticated artifact download. Run it with the daemon's token/data environment, `ffprobe`, and optional `FRAMEOS_QA_URL`. The hosted QA project is `01a0d17d-569b-716c-ac12-d0aa3789ef5e`; its two-second export is available in Activity.

## Production effects check: September 24, 2026

Build `5680fc24-37cf-4304-a340-5aabde54e63c` deployed commit `9e7fe42` successfully. In Chrome, the hosted session authenticated, a four-second video with source audio was added to the existing manual-effects QA project, and Studio created a separate A1 audio clip. Trimming that audio clip to three seconds through Properties left its picture clip at four seconds. The project's three-layer keyed foreground, animated title, blurred background and detached audio exported successfully as job `01a0d477-6959-750c-be7c-2c78468440fa`.

The output probes as an eight-second, 1920×1080 H.264/AAC MP4. A decoded frame at three seconds visibly contains the blue background, white title and red foreground. The audio measures −24.1 dB mean volume inside the trimmed clip and approximately −91 dB after its out-point. The local native effects suite also passed all six checks, including three-layer compositing and a separately delayed source soundtrack. This is a synthetic reference check, not real-footage or 50-minute effects acceptance.

## Human editor session

1. Import ten supported video files with a mix of short and five-minute durations. Confirm that each plays and has the expected duration.
2. Add them to a timeline, use Fit, scrub across cuts, and step individual frames. Repeat after opening another project and returning.
3. Trim the start/end, split, move, duplicate and delete clips. Undo several edits, redo them, then make a new edit after an undo.
4. Add a title and independent audio, adjust gain and opacity, mute/disable tracks, and inspect the native output.
5. Export, navigate away from Activity and return, then download the completed video. Verify duration, cuts, text, sync and audible levels at the start, middle and end.
6. Queue a second export, cancel it, and confirm that the first finishes. Attempt a bad import and an overlapping move; existing edits should remain intact.

Record the source codec/frame rate, action, project revision, job ID, expected result and actual result for each problem.

## Remaining gates

- Chrome click-to-add, audio selection, Properties trimming and export were tested on the live deployment. Dragging trim handles, playback seeking and a full human editor session remain to be accepted.
- Browser playback still approximates native effects and shows limited layering. Final compositing, typography, retiming and audio processing must be checked in native output.
- Live-provider AI editing and rendered audiovisual critique remain separate acceptance work.
- Full After Effects parity is not delivered. See [advanced editing status](advanced-editing-status.md) for the outstanding feature families.

## Cloud allowance

A project-scoped ₹10,000 monthly alert budget was created, excluding credits so credit consumption remains visible, with alerts at 50%, 80% and 100%. **This is an alert budget, not a spending cap.** Local and hosted per-analysis allowance is $2 and planning timeout is ten minutes.

The tested image was deployed to `frameos-studio` on September 24. The VM now has four CPUs, 16 GB RAM and a 100 GB balanced disk (67 GB free after deployment). Caddy handles public HTTPS; the daemon binds to host loopback. The former configuration incorrectly required TLS inside the container and restarted repeatedly. A stale proxy token also replaced clients' valid authorization headers; that override was removed. The corrected deployment passed health, native capability discovery, existing-project listing and the public HTTP editing smoke test. The public API still rejects unauthenticated project access. The previous container, proxy configuration and a consistent data backup were retained. See [deployment details](gcp-deployment.md).
