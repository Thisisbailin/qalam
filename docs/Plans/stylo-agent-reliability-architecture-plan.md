# Plan — Stylo Agent Reliability Architecture

Architecture Intent Block:
- Treat the server project projection as the authoritative workspace.
- Treat one Agent turn as an explicitly identified state machine with a single writer per session.
- Keep transport events append-only and delta-only; materialize display state outside the wire protocol.
- Isolate UI, turn orchestration, persistence, project commands, and tool execution behind narrow contracts.

Work Breakdown (<=1 day each):
1. Protocol and transport guardrails
   - Add protocol version/limits, delta-only packets, bounded decoder, single parse, and terminal compaction.
   - Rollback: accept legacy accumulated packets behind the parser while emitting only the new format.
2. Runtime cancellation and observability
   - Add overall/idle/model/tool deadlines, bounded tool I/O, stream backpressure policy, and Electron renderer diagnostics.
   - Rollback: retain abort plumbing and relax configured thresholds.
3. Conversation isolation and persistence
   - Capture conversation identity per run, make projections run-scoped, and move bulk conversation persistence behind an asynchronous repository with localStorage migration.
   - Rollback: repository adapter can fall back to the legacy storage implementation.
4. Server-authoritative workspace and turn coordination
   - Remove local snapshots, authorize project access, acquire a session lease, load the flushed server projection, and commit mutations with revision checks.
   - Rollback: disable Agent mutations while retaining authoritative read-only turns; do not restore full-snapshot transport.
5. UI/runtime boundary reduction
   - Extract request/workspace preparation and conversation mutation helpers from the God component without visual behavior changes.
   - Rollback: helpers are pure and can be inlined without changing storage/protocol contracts.

Verification Plan (by AC):
- AC1/AC3: protocol unit tests with one-character chunks, malformed/oversized frames, missing terminal, duplicate sequence, and stalled streams.
- AC2: request-body test asserts absence of `localSnapshot` and 256 KiB rejection.
- AC4: abort/timeout tests for runtime and representative external tools.
- AC5: controller test switches active conversation during a stream and verifies original-conversation routing.
- AC6/AC7: API/coordinator tests for concurrent lease conflict, ownership failure, stale revision, and successful commit.
- AC8: static Electron architecture test plus manual event-handler inspection.
- AC9: focused tests, `npm run typecheck`, `npm test`, and `npm run build`; record unrelated baseline failures explicitly.

Rollback Points:
- R1: protocol parser remains able to read legacy packets during one migration window.
- R2: all new limits are centralized constants and can be tuned without reverting architecture.
- R3: project mutation can be disabled independently from conversational read-only Agent operation.
- R4: the turn lease is isolated in migration `0014`; rollback disables Agent turn admission before removing the lease table. No dependency addition is required.
