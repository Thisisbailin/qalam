# Verify — Stylo Agent Reliability Architecture

## AC -> Evidence Mapping

- AC1 — delta-only protocol: `tests/agentReliabilityArchitecture.test.ts` verifies 4,000 one-character frames have constant size and contain no `accumulatedText`; stream buffer tests verify ordered concatenation. Result: pass.
- AC2 — bounded minimal request: HTTP runtime tests verify no local project snapshot is sent and a request over 256 KiB is rejected before `fetch`. Result: pass.
- AC3 — bounded stream: protocol/runtime tests cover frame, event, stream, sequence, lifecycle, terminal compaction, backpressure coalescing, and oversized-terminal conversion to `turn_failed`. Result: pass.
- AC4 — cancellation/deadlines: request, stream, model, and tool limits are centralized in `agents/runtime/limits.ts`; tool timeout actively aborts its linked signal; response bodies are byte-bounded. Result: pass by compilation, static architecture checks, and bounded-body test.
- AC5 — conversation isolation: run scope captures both conversation and session identity; all stream, preflight, abort, and failure writes address that captured conversation. Pure state tests verify a background run cannot mutate the active conversation. Result: pass.
- AC6 — single writer: migration `0014_agent_turn_leases.sql` plus `_agentTurnCoordinator.ts`; unit test verifies live-session conflict, wrong-turn release protection, lease expiry, and idempotency replay rejection. Result: pass.
- AC7 — server authority: project ownership and expected revision are checked before execution; durable mutations commit through realtime `agent-apply` compare-and-set; client-side snapshot reconciliation is absent. Script content is separated into review proposals and restored before authoritative commit. Result: pass.
- AC8 — recoverability/observability: React root is wrapped by `AppErrorBoundary`; Electron records redacted renderer/main/child-process diagnostics, aborts cancelled response streams, and reloads after renderer loss. Result: pass by static tests and production build.
- AC9 — verification matrix: focused Agent tests pass; repository test suite passes; Vite production build passes; changed Agent sources compile. Repository-wide app typecheck remains blocked only by unrelated screenplay/service errors listed below. Result: no new failure attributable to this implementation.

## Verification Commands

- Focused Agent compile and tests: 46/46 passed.
- `npm test`: 300/300 passed.
- `npm run build`: passed; 7,289 modules transformed. Existing large-chunk warnings remain.
- `git diff --check`: passed.
- `npm run typecheck`: blocked by pre-existing/non-Agent errors in `ScreenplayBlockEditor.tsx` and multiple provider service response typings; no error references an Agent file changed here.

## Build Matrix

- Web production bundle: pass.
- Electron renderer bundle: pass through the shared Vite production build.
- Electron packaged smoke test: not run in this local verification cycle.
- iOS/iPadOS: not applicable to this TypeScript web/Electron repository.

## Platform Difference Checks

- Browser: IndexedDB persistence, BroadcastChannel sync, error boundary, and bounded SSE client are included in the production bundle.
- Electron: renderer unresponsive/gone, child-process-gone, main exceptions, redacted diagnostic log, and renderer reload handlers are installed in the main process.
- Edge: protocol version, authorization, rate limit, turn lease, backpressure writer, cancellation, and authoritative realtime commit are enforced server-side.

## Deployment Prerequisite

- Apply `migrations/0014_agent_turn_leases.sql` before deploying the new `/api/agent` handler. Without the table, turn admission fails closed.
