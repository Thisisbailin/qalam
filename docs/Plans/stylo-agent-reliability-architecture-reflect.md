# Reflect — Stylo Agent Reliability Architecture

## What failed / nearly failed

- Moving project writes to the server initially risked committing `scriptPage` body edits that are intentionally human-review-gated. The final design splits proposals, restores protected fields, and commits only unrelated durable changes.
- A project commit failure after model completion could enter fallback recovery, execute finalization twice, and end the stream without a terminal event. Finalization is now memoized, classified, and converted to exactly one failure terminal.
- Async persistence initially had a hydration race that could overwrite a message sent immediately after mount, and conversation projection initially depended on the currently active conversation. Local mutation versioning plus explicit run conversation/session scope closed both races.
- Repository verification was temporarily obscured by concurrent unrelated worktree edits and baseline typing failures. Focused compilation and tests were used until the full 299-test suite became runnable.

## Three concrete improvements next time

1. Write the terminal-state and review-gate contract tests before changing the transport/result types, including explicit fault injection at “model complete / commit failed / client cancelled”.
2. Introduce a reusable asynchronous scoped-state repository abstraction with hydration status and race tests before migrating another large localStorage-backed feature.
3. Capture a machine-readable baseline verification report at task start so concurrent worktree changes can be compared automatically by file and diagnostic code.

## Lessons appended to context memory

- A terminal event is a control-plane guarantee, not an ordinary queued payload; bounded writers must reserve a failure terminal path even under overflow.
- Cancellation must abort the underlying operation, not only reject a timeout race.
- Server authority is incomplete unless protected review semantics move with the mutation boundary.
- Run-scoped identity must include both conversation storage identity and model session identity.

