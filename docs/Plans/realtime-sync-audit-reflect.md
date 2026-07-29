# Reflection — Realtime sync production audit

## Architecture assessment

The core direction is sound: one Durable Object per `(user_id, project_id)` is
the strongly ordered multi-writer authority; Yjs updates are durably appended
before ACK; D1 is an eventually updated read projection; Agent and strong HTTP
readers explicitly flush that projection.

The defects were mainly at lifecycle boundaries rather than in the authority
choice itself:

- cold-start reconciliation mixed a local snapshot fallback with CRDT merging
  and could replay the whole local snapshot after receiving server state;
- the Agent barrier observed only the send created by the current call, not
  sends already waiting for ACK;
- retry lost the original operation id after a disconnect;
- pointer-frame state changes performed project normalization before they were
  coalesced;
- Durable Object and D1 row-size assumptions exceeded the actual platform
  limit;
- WebSocket fan-out treated a closing observer as part of authoritative write
  success;
- the account-settings side channel consumed a staged write on transport
  failure and had no bootstrap recovery path.

## Changes made

- Added deterministic startup reconciliation for visible state, local Yjs
  checkpoint, and server state.
- Removed the second full-snapshot replay after server sync.
- Added a 48 ms input coalescer before normalization/fingerprinting while
  retaining the existing 180 ms network merge.
- Added all-in-flight ACK tracking to the Agent acquisition barrier.
- Reused retry operation ids when the exact unacknowledged update is resent.
- Contained malformed server updates and state vectors with a controlled
  reconnect.
- Added shared materialized-project limits and client/server enforcement before
  a realtime write is accepted.
- Added versioned Durable Object schema migrations.
- Split checkpoints and oversized update blobs into 1.5 MB SQL chunks.
- Kept the D1 projection under 1.7 MB and stopped duplicating the full Yjs state
  in its row.
- Isolated peer send/close errors and enabled payload-free sampled Worker
  observability.
- Preserved and retried failed account-settings writes with bounded backoff;
  retries exist only while work is pending or bootstrap has failed.

## Residual risks

1. Yjs history can grow even when the materialized project remains small.
   Chunking removes the SQL row-limit failure, but a very old project could
   eventually produce a large initial WebSocket state. A future protocol epoch
   should rebase the document into a canonical fresh Yjs document and coordinate
   all clients onto that epoch.
2. The React-to-Yjs adapter still begins from a materialized project snapshot.
   It now coalesces pointer frames and emits fine-grained Yjs changes, but a
   future action-level adapter would avoid traversing the project at all for
   common operations such as moving one node.
3. D1 remains intentionally eventual after a realtime ACK. Strong Agent/project
   reads already call `/flush`; catalog/public reads can lag by the 450 ms
   projection debounce.
4. Worker behavior is covered by architecture assertions, strict standalone
   typecheck, and Wrangler bundle validation. A Miniflare/Workers Vitest suite
   should still be added for real alarm eviction, hibernation, and SQL migration
   execution.
5. Repository-wide strict typecheck currently fails in unrelated GitHub,
   media-service, media-node, and Flow selection code. The changed sync targets
   pass strict standalone typechecks.

## Platform references

- Cloudflare Durable Objects limits:
  https://developers.cloudflare.com/durable-objects/platform/limits/
- Cloudflare D1 limits:
  https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare Durable Objects rules:
  https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
