# Plan — Realtime sync production audit

1. Map authority and lifecycle boundaries.
2. Add dynamic client state-machine tests for startup, ACK barriers, reconnect,
   send failure, and staging coalescing.
3. Fix client startup reconciliation and all-in-flight acquisition.
4. Add a cheap input coalescer before full project normalization.
5. Version Durable Object SQLite schema and isolate peer-send failures.
6. Add structured, payload-free latency/error diagnostics and Worker
   observability configuration.
7. Run typecheck, all tests, Worker bundle dry run, production build, and
   document findings and residual risks.
8. Align realtime payload and projection limits with current Cloudflare limits,
   chunk Durable Object checkpoint/update rows, and reject oversize projects
   before the authoritative ACK.
9. Audit the account-settings side channel for consumed writes and bootstrap
   failure recovery.

## Rollback

- Client coalescing and startup reconciliation are isolated to
  `RealtimeProjectSyncEngine`.
- Durable Object internal schema versions 2 and 3 migrate monolithic
  checkpoints and large updates to chunk rows without deleting room data.
- Observability configuration is independently reversible.
