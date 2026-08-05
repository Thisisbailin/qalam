# Mission Brief — Stylo Agent Reliability Architecture

Objective:
- Eliminate renderer freezes/crashes caused by project snapshot serialization, quadratic stream amplification, synchronous persistence, and duplicated terminal payloads.
- Establish a single-writer turn lifecycle and a server-authoritative, revisioned project mutation path.
- Keep the existing user-visible Agent workflow and provider/tool capabilities behavior-compatible.

Out-of-scope:
- Model upgrades, prompt redesign, visual redesign, dependency upgrades, and unrelated realtime-sync refactors.
- Rewriting the OpenAI Agents SDK or changing provider credentials.

Inputs / Outputs (contracts):
- Turn input: project/session/conversation identity, user text, bounded UI context, expected project revision, and an idempotent turn identifier.
- Stream output: ordered lifecycle events and delta-only text events with bounded frames and a minimal terminal result.
- Project mutation output: committed revision plus a bounded project patch/change reference; no full client project snapshot in the request and no full NodeFlow in the terminal event.
- Persistence: conversation-addressed asynchronous repository writes; streaming text is checkpointed at a bounded cadence.

Acceptance Criteria (AC):
- AC1: Text delta packets never contain accumulated text; client coalescing preserves all text in order.
- AC2: Agent request payload no longer contains `localSnapshot` and is capped at 256 KiB.
- AC3: Stream decoding enforces frame, event, total-byte, idle, and overall limits and parses each packet once.
- AC4: Model and tool work receive a shared cancellation signal and bounded deadlines.
- AC5: A run continues writing only to the conversation captured when it started.
- AC6: Same-session concurrent turns are rejected or serialized by a server-side coordinator.
- AC7: Project access is authorized and mutations use expected-revision compare-and-set semantics.
- AC8: Electron records renderer crash/unresponsive events and provides a recoverable failure surface.
- AC9: Focused Agent tests, typecheck where repository baseline permits, and production build complete without a new failure attributable to this work.

Constraints (perf/i18n/a11y/privacy):
- No new dependency and no network/install action.
- Preserve existing Chinese UI/error language.
- Do not stream hidden chain-of-thought; reasoning UI remains bounded status/summary data.
- Do not log credentials, full prompts, full project documents, or tool response bodies.
- Preserve unrelated dirty realtime/sync worktree changes.

Dependencies & Risks:
- Existing realtime projection must be flushed before the authoritative Agent workspace is loaded.
- Protocol migration must update producer, parser, buffer, reducer, and tests atomically to avoid losing deltas.
- Current repository-wide typecheck baseline contains unrelated screenplay/service typing failures; verification must separate baseline failures from introduced failures.

Platform Differences via Platform Layer:
- Browser behavior remains unchanged except for bounded request/stream processing.
- Electron main process adds renderer failure telemetry and recovery; web builds ignore this platform adapter.
