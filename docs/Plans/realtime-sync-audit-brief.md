# Mission Brief — Realtime sync production audit

## Objective

- Audit the complete local-to-cloud project synchronization path for data loss,
  stale reads, false sync status, excessive work, and recovery defects.
- Reproduce confirmed risks with executable tests before changing behavior.
- Fix confirmed defects without touching unrelated workspace changes.

## Scope

- React staging and account/project lifecycle.
- Local Yjs checkpoint persistence.
- WebSocket handshake, batching, ACK, timeout, and reconnect.
- Durable Object SQLite authority, schema migration, alarms, projection, reset,
  and broadcast.
- D1 read barriers used by project, public, and Agent routes.
- Sync status accuracy and aggregate diagnostics.

## Acceptance criteria

1. A stale IndexedDB checkpoint cannot overwrite a newer visible local project
   during startup.
2. Agent acquisition waits for every update that was already in flight at the
   acquisition boundary.
3. Pointer-frame project updates are coalesced before expensive cloud snapshot
   normalization and fingerprinting.
4. A synchronous WebSocket send failure requeues the update immediately rather
   than waiting for the ACK timeout.
5. Durable Object internal schema changes are versioned.
6. One closing viewer socket cannot fail the authoritative update or disrupt
   healthy peers.
7. Automated tests, strict typechecks for the changed sync targets, Worker
   dry-run bundle, and production build pass.
8. Cold-start merging preserves unrelated edits made by another device.
9. Missing local Yjs checkpoints do not silently discard a newer visible
   project.
10. Lost ACK retries preserve the original operation id when the update has not
    been merged with a newer operation.
11. Durable Object checkpoints and large incremental updates stay below the
    platform's 2 MB per-row/BLOB limit through chunking.
12. The client and server reject an oversized materialized project before
    acknowledging an update that D1 cannot project.
13. Account-setting writes survive transient transport failures and retry only
    while unsynced work exists.

## Constraints

- Preserve multi-writer Yjs convergence and offline editing.
- Preserve the current wire protocol where possible.
- Do not deploy or mutate remote data during the audit.
- Preserve unrelated Pinoard/PDF work already present in the worktree.
