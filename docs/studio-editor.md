# Visual Studio

## Reference-guided editing (phase 1)

In **Edit assistant**, import a reference video or choose one from the imported
videos. Select separate source clips in **Your media**, enter a brief such as
"Match the reference's pacing and highlight structure using my selected clips",
then choose **Plan edits with AI**. Review the proposal and its warnings before
choosing **Approve & watch edits**.

Reference mode automatically analyzes the reference's shot boundaries, pacing,
shot roles, framing, highlights and observed transitions, then analyzes selected
footage for matching moments. Analysis uses the configured Vertex Gemini account
and existing duration/cost limits. Cached analysis is keyed by asset hash,
analyzer version and purpose; reference analysis is separate from source analysis.
The server requires persisted reference analysis and source ranges. The reference
is excluded from generated timeline clips even if accidentally selected as media.

Phase 1 supports hard cuts, variable shot lengths, highlight assembly, basic
titles/picture adjustments, and video dissolves. Dissolves are real timeline
transitions, with adjacent clip, source-handle, lock and overlap validation.
Browser playback composites the two video sources during a dissolve; audio switches
at the cut. Native dissolve export requires the MLT luma capability. Wipes,
complex speed ramps, grading and full audio mixing are not matched exactly;
the proposal must explain approximations or ask for clarification. Plans remain
limited to 60 actions and 20 selected assets. Model-derived timing/style is an
estimate, not a frame-exact reconstruction of an arbitrary reference.

### Visual checkpoints

**Visually review edits as they run** is enabled by default. After every ten
applied operations (up to two intermediate checks) and at completion, the browser
samples the edited timeline and, when selected, the reference video. A maximum
of three reviews is shared across a plan and its approved corrections. Frames
include browser-visible picture transforms, dissolve blends and approximate title
layout. The playhead is restored after capture. This uses the configured Gemini
account and incurs additional model usage.

Gemini receives actual JPEG images, their timestamps, the current timeline,
analysis and the original brief. It can propose a replacement for the remaining
steps, including corrections. Execution pauses for approval of that replacement;
no proposed correction is applied automatically. With no correction proposed,
the approved steps continue. Capture/provider errors stop execution and retain
applied edits. Stop discards an in-flight review result. Revision checks reject
evidence or proposals if the project changes.

`POST /api/v1/studio/ai/review` is bearer authenticated, limited to three requests
per minute and a 5 MiB body, and accepts at most twelve bounded JPEG frames.
Proposed changes use the existing action compiler and transaction validation.
This is sampled visual feedback, not continuous viewing or a rendered-output
quality guarantee. It cannot verify audio, continuous motion or native-only
effects; unsampled moments may contain problems. Connected-controller proposals
do not automatically opt into visual review.

Implementation has compilation/syntax verification only. Live provider, visual
matching, playback and rendered-output acceptance testing are deferred.

Open `http://127.0.0.1:31415/studio`. Connect using the daemon's bearer token.
The new workspace replaces the analysis-first page. The previous operation
workbench remains accessible through **All tools** (`/studio/legacy`); the
public REST, SDK and MCP contracts are unchanged.

## Manual editing

- Import multiple videos, audio files or images into Your media.
- Click media for source preview; double-click or use **+** to append it.
  Drag media into a timeline lane to choose an exact position.
- Click the ruler or empty lane to seek; drag the ruler to scrub.
  Left/Right move one frame; Space plays/pauses. Timeline returns from source preview.
- Select a timeline clip, drag its body to move it (including between tracks),
  or drag either edge to trim it. Invalid overlaps/source ranges are rejected
  by the daemon and the displayed timeline is restored.
- **S** splits at the playhead. Duplicate, Delete, Undo/Redo, track lock/mute/
  visibility, markers, title insertion and numeric clip properties use real
  transactions. Source-in and duration are seconds, snapped to sequence frames.

## AI editing: describe, review, watch

1. Check the videos to include in Your media.
2. Open Edit assistant, enter a brief and seconds per clip.
3. Select **Plan edits with AI**. A live Vertex Gemini model interprets the brief,
   selected media, selected timeline item, playhead and existing timeline. With
   **Analyze footage for highlights** enabled, missing video analysis runs first.
   Uncheck it for explicit source ranges, titles or picture edits. Both planning
   and analysis may incur GCP charges; existing indexed analysis is reused.
4. Review the model's summary, warnings and individual actions. Expand **Exact edit
   parameters** to see the actual tool-call arguments. The server compiles and
   validates every proposed action without modifying your project. Ambiguous or
   unsupported requests ask for clarification rather than claiming success.
5. Approve to watch real, sequential transactions. The visible pointer identifies
   the control/media associated with each operation; it does not synthesize OS
   mouse clicks. Human controls and the assistant share the same transaction API.
6. Stop prevents subsequent steps; an in-flight request may finish. Already applied
   steps remain and can be undone individually. A new plan is required to resume.

Supported AI actions: create tracks, assemble clips from source ranges, trim, move,
split, remove timeline items, change rotation/scale/opacity, change clip volume,
add basic titles and enable/disable tracks. Existing-item requests modify the item
instead of forcing a new montage. New montages preserve original tracks and may
disable them as explicitly listed in the plan. Revision checks reject stale plans.

Example: “Use seconds 2–6 of clip 1, then seconds 12–16 of clip 2. Rotate the second
shot 10 degrees and scale it to 80%. Add ‘Made by FrameOS AI’ for the first two seconds.”

The typed planning endpoint is `POST /api/v1/studio/ai/plan` (bearer authenticated,
five requests/minute). It returns a proposal, not a commit. It reuses the existing
Vertex/GCP configuration; `FRAMEOS_GEMINI_EDITOR_MODEL` optionally overrides the
analysis model for editing. Credentials never enter the browser. Plans accept only
an allowlisted action schema: no model-generated shell commands or arbitrary APIs.
This is an LLM planner plus a deterministic editor executor, not an OS-level mouse
agent. AI-chosen highlights still need human review. Transitions, color grading,
captions, complex retiming, multitrack audio mixing and rendered export are not
implemented in this AI workflow.

## Connected agents

The existing MCP/REST editing APIs continue to work; the UI refreshes external
changes when idle. This does **not** replay external edits as pointer clicks.

A same-origin controller attached to the Studio browser can offer a reviewed
proposal using:

```js
await window.frameosEditor.propose({
  summary: "Trim the opening and assemble the selected moments",
  operations: [/* public FrameOS typed operation objects */],
});
window.frameosEditor.getState();
```

Proposals are cloned and server-validated, shown with their arguments, and always
require the user's Approve action. The bridge does not expose the bearer token.
This is a browser integration point, not a new remote agent transport or an
implementation of Codex's Chrome-control runtime.

## Preview and feature boundaries

This is a first visual-editor implementation, **not full Clipchamp parity**.
The browser previews sequential source cuts, source in-points, simple titles,
scale/rotation/opacity and the active video's audio. It does not reproduce the
native compositor: layered video, multitrack audio mixing, transition/effect chains,
full title styling, masks, keyframes, reverse/freeze/complex retiming and caption
rendering require additional preview integration. Positive gain is capped at browser
volume 1 in this monitor. Audio-only tracks are editable but not mixed in this preview.

The running container currently lacks the native MLT worker. MP4 export is disabled
with an explanation when `engine.mlt` is unavailable. OTIO downloads edit decisions,
not a finished video. Remaining advanced operations can still be inspected and used
through the old workbench, but they do not yet have dedicated visual controls here.
Uploaded video blobs are fetched with authentication and cached for the open project;
this is not yet optimized for very large media libraries or streaming proxies.

## Verification

### Live Chrome / Gemini check — 2026-09-13

Test project: `Studio browser QA 2026-09-13T03:30:08.860Z`.
The real `gemini-2.5-flash` planner generated an eight-operation proposal:
two consecutive four-second source cuts, second-shot rotation 10° / scale 0.8,
a two-second title, and disabling both old nonempty tracks without deleting them.
Approval executed the operations with the visible assistant cursor. Title and
transformed footage were checked during playback; edits persisted after reload.

A second natural-language request split the second shot at timeline 6 seconds
and moved its right half to 7 seconds. Stop was verified with zero operations
applied; a regenerated plan then completed both operations (revision 26).
The resulting active timeline is 9 seconds, with a 6–7 second gap.

Provider fixes use JSON output with exact action definitions in the prompt,
bounded Gemini 2.5 thinking, strict local schema validation, and transaction
dry runs before approval. Invalid output diagnostics record issue paths/codes,
not model output or credentials. Completion/Stop counts now replace the stale
"no edits applied yet" label; timeline gaps no longer display the import welcome.

These were explicit-range editing tests, not a new visual-analysis/highlight
quality test or rendered MP4 export test. The first valid montage proposal omitted
one old track; naming both tracks in the revised brief resolved it. Human plan
review remains necessary to check intent, beyond structural validation.

```sh
npm run test --workspace @frameos/daemon -- src/studio/editor.test.ts src/http/server.test.ts
npm run build --workspace @frameos/daemon
node tools/studio-e2e.mjs
```

The browser test uses a fresh headless Edge profile (override
`FRAMEOS_TEST_BROWSER` for another installed Playwright browser channel). It obtains
the Docker token without logging it, reuses an existing sample video, and creates a
named QA project with three imported copies. Projects are retained for inspection.
The test checks the real Docker editing APIs; analysis results and AI plans are
fixture-backed to avoid GCP charges. It is not a live GCP integration test. `studio-qa.png` is a local,
git-ignored screenshot. No personal browser profile is used.

Set `FRAMEOS_TEST_DEPLOYED=1` to test the served Docker frontend instead of routing
the browser to the locally built candidate assets.
