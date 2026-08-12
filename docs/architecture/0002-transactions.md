# ADR 0002: Atomic optimistic transactions

Status: accepted

All editing is expressed as typed operations inside one transaction with a `baseRevision`, idempotency key, and `validate`, `preview`, or `commit` mode.

- The daemon serializes commits per project and rejects stale revisions with `REVISION_CONFLICT`.
- Validation executes against a cloned snapshot and performs no persistent mutation.
- Preview writes an expiring draft based on an immutable revision.
- Commit atomically advances the canonical snapshot and appends a transaction record.
- A pending-commit marker lets startup recovery finish or discard an interrupted write.
- Render jobs capture a revision rather than following the moving project head.

Undo is represented by a new revision. Snapshot restoration guarantees exact state recovery even where an operation has no safe semantic inverse; inverse operations are recorded when available for history explanation and future selective undo.
