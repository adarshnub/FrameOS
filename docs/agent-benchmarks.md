# Agent benchmarks

FrameOS keeps the v1 agent benchmark inventory in `benchmarks/agent/v1/manifest.json`.

Run it locally with:

```bash
npm run bench:agent
```

The runner executes implemented deterministic cases against the real project factory, operation executor, and semantic planners. It fails on any implemented case that cannot execute or cannot undo back to schema-normalized project JSON.

Cases that still require external analyzers, media conformance fixtures, visual oracles, or provider-driven clarification are listed as `gated` in the manifest. Gated cases are not counted as passes; they make the remaining acceptance work explicit.

Current v1 categories:

- micro edits: trim, split, move, gain, caption correction, keyframe insertion
- intermediate edits: silence removal, B-roll replacement, vertical conversion, caption styling, plus gated audio sync and color match
- complex edits: highlight/trailer and music-synchronized montage, plus gated podcast, multicam, tracking, and nested-sequence oracles
- failure cases: missing media, unavailable effect, conflicting revision, insufficient analysis, rejected approval, plus gated ambiguous-request handling
