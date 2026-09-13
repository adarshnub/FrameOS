# AI audio and timing edits

Studio's AI planner accepts the following typed actions. Plans are simulated and validated before approval. Execution uses reversible timeline operations; original media files are not rewritten.

| Task                          | Actions                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent sound and picture | `detach_audio`, `link`, existing `split`, `trim`, `move`, `delete`                                                                                |
| Levels and stereo placement   | `volume`, `mute`, `pan`                                                                                                                           |
| Audio processing              | `audio_fade`, `audio_eq`, `audio_compress`, `audio_limit`, `audio_normalize`, `audio_denoise`, `audio_enhance_voice`, `audio_duck`, `audio_reset` |
| Timing                        | `speed`, `speed_ramp`, `reverse`, `freeze`                                                                                                        |
| Transitions                   | `transition` with `dissolve` or `audio_crossfade`; duration controls transition pace                                                              |

## Example prompts

- “Detach this video's audio to a new audio track. Split the sound at timeline second 3 and lower the right half to -9 dB. Fade its last second out. Keep the picture unchanged, then relink the first audio segment to the video.”
- “Use half-speed video for this shot but keep its detached narration at normal speed. Move the next shot to the new end.”
- “Reduce noise gently, high-pass the voice at 80 Hz, add 2 dB at 3 kHz, compress at 3:1 above -18 dB, and normalize to -16 LUFS with a -1 dB true peak target.”
- “Lower the music by 12 dB during this voice clip, with a 0.1 second attack and 0.4 second release.”
- “Add a one-second dissolve between these adjacent video clips. Use a half-second crossfade between the adjacent audio clips.”
- “Ramp this clip from source second 2 at timeline offset 0 to source second 3 at offset 2, hold until offset 4, then reach source second 8 at offset 8.”

## Semantics and limits

- Detachment copies the clip to an audio track and mutes its video audio in one undoable operation. Audio processing and timing are preserved with fresh entity IDs. Video-only source files with known stream metadata are rejected.
- Relinking records a relationship and preserves independent edits and offsets. It does not align the clips, restore deleted material, or unmute the original video. Moving both linked clips requires explicit moves for both. Native export combines the tracks into the rendered output.
- Speed is an absolute source/timeline ratio, rounded to a whole output frame. A slower clip becomes longer. Subsequent clips must be moved explicitly. Speed ramps use ascending timeline offsets and non-descending absolute source timestamps. Repeated source timestamps make holds. Optical-flow interpolation is not implemented.
- Transitions require adjacent, unretimed clips and source handles of half the transition duration on both sides. Replace a transition by deleting its transition item and adding a new one with the requested duration.
- Speech enhancement is a denoise/EQ/compression preset, not generative restoration or voice/music separation. It replaces those processing stages.
- Ducking is an explicit envelope over the selected sidechain clip's timeline span, including silence. It is not signal-triggered sidechain compression. Reapply it after timing changes. `audio_reset` with `timelineDuck` removes this envelope.
- Browser monitoring mixes enabled video/audio tracks and previews gain, pan, fades, EQ, approximate compression/limiting and timeline ducking. Denosing and integrated loudness normalization require native rendering. Reverse and frozen picture playback are silent frame-seek approximations in the browser; native playback is authoritative.
- Export requires a configured native worker with the relevant MLT capabilities. Audio buses, arbitrary effect plugins, channel remapping, signal-triggered sidechains, wipes, and optical flow are not exposed by this planner. The AI must clarify unsupported exact requests rather than claim to execute them.
- Still-image visual checkpoints cannot evaluate sound or prove continuous-motion quality. Listening to an exported result remains necessary.

## Validation

Automated coverage includes detach/split/process/relink, atomic undo, audio effect compilation, retimed splits, speed changes after splits, ramp holds, audio crossfades, invalid ranges, browser source-time mapping and browser gain envelopes. A synthetic FFmpeg check verifies that the ducking expression produces a requested 12 dB reduction and restores baseline level after release. These checks do not constitute a live Gemini prompt evaluation or an end-to-end native MLT render.
