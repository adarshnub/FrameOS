# ADR 0001: FrameOS JSON is the canonical project document

Status: accepted

FrameOS stores each project as versioned `project.frameos.json`. The document uses UUIDv7 entity identifiers, integer rational time, explicit sequence formats, and typed timeline-item/effect unions. It contains no MLT service properties.

MLT graphs, MLT XML, thumbnails, waveforms, proxies, embeddings, and search indexes are derived artifacts. OTIO is an interchange representation and is not authoritative because it cannot preserve the complete render/effect state.

This makes edit operations deterministic, permits another render adapter later, and lets clients validate documents without loading native media libraries. Schema changes require migrations and compatibility fixtures.

## Transform and transition semantics

`positionX` and `positionY` are pixel offsets from the sequence-frame center. `anchorX` and `anchorY` are normalized coordinates within the transformed item, where `(0.5, 0.5)` is its center. Scale is relative to the sequence frame, opacity is normalized from zero to one, rotation is clockwise degrees, and crop values are normalized fractions of the uncropped sequence-profile dimensions. Engine adapters must either reproduce these semantics or return `CAPABILITY_UNAVAILABLE`; they must not reinterpret fields as native effect properties.

A transition is a same-track relationship between two editorial items that meet at one edit point. Its timeline range straddles that point and does not change sequence duration. During the transition interval, each endpoint's source time continues linearly, which can require incoming and outgoing source handles beyond the endpoints' visible `sourceRange`. Validation or graph compilation fails if known asset bounds do not contain those handles. A video-only transition retains a hard audio cut at the edit point; an audio-only transition retains a hard picture cut.

Logical timeline grouping is represented by project-level `ItemGroup` records scoped to one sequence; it is distinct from clip `links`, which represent synchronization relationships such as linked picture and sound. A timeline item may belong to at most one logical group. Nested sequences form a directed acyclic graph. Sequence duplication receives the fully materialized duplicate (including new entity IDs) in the operation payload so replay is deterministic and does not generate hidden IDs during execution.
