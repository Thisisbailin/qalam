# Evidence Block

- Motivation: eliminate Agent reply-time renderer freezes/crashes and replace fragile full-snapshot, duplicated-stream, synchronous-persistence behavior with bounded, observable, authoritative execution.
- Impact: Agent React controller/UI, SSE protocol/client/server writer, OpenAI Agents runtime adapter, external tools, Edge API, realtime Agent commit adapter, D1 schema, Electron recovery, and focused architecture tests. Existing unrelated realtime/screenplay worktree edits were preserved.
- Plan: phase 1 bounded delta-only transport/cancellation/recovery; phase 2 conversation-scoped async persistence and cheap streaming render; phase 3 single-writer server-authoritative project commits with review-gated script proposals. Rollback points are documented in the Plan.
- Verify: focused Agent tests 46/46; repository tests 300/300; Vite production build passed; diff check passed. Repository-wide typecheck reports only unrelated screenplay/service diagnostics and no changed Agent file.
- Rollback: disable Agent mutation capabilities while retaining read-only turns; keep protocol-v2 parser compatibility; relax centralized thresholds if telemetry proves them too strict; roll back the handler before removing migration `0014`.
