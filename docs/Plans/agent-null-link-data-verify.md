# Verify — Agent Null Link Data Recovery

AC -> Evidence Mapping:
- AC1: `tests/nodeflowSchema.test.ts` passes a link with `data: null`; parsing succeeds and returns no `data` property — pass.
- AC2: the same schema test passes `data: []`; strict project validation still rejects it — pass.
- AC3: `tests/yProjectDocument.test.ts` verifies that undefined object fields are omitted on first write and delete a previously materialized key on the next normalized snapshot — pass.
- AC4: the Yjs test verifies that an explicit `sourceHandle: null` and an explicitly contaminated `data: null` remain representable — pass.
- AC5: `tests/agentRuntimeArchitecture.test.ts` reconstructs an Agent state from the reported eight-link D1 shape and confirms all null link-data fields are removed — pass.
- AC6:
  - `npm test`: pass, 222/222 tests.
  - `npm run build`: pass, 7,288 modules transformed; existing chunk-size warnings only.
  - `git diff --check`: pass.
  - `npm run typecheck`: blocked only by the existing `unknown` response typing errors in GitHub/media service files; no error points to this change.

Architecture / compatibility checks:
- The canonical `NodeFlowLink.data` type remains `Record<string, unknown> | undefined`; null is accepted only as legacy input and is removed at the parser boundary.
- Yjs object maps now follow JSON object semantics for undefined properties, while explicit null and undefined array slots retain their prior behavior.
- Canvas and runtime link normalization omit nullish data before persistence.
- Existing cloud rows need no destructive migration: Agent reads recover immediately, and the next normalized client sync removes the contaminated keys.

Build Matrix:
- Shared Vite browser/Electron bundle: pass.
- Native iOS/iPadOS/macOS compilation: not applicable to this shared web runtime.

Privacy / external effects:
- No remote project data was read or modified.
- No API request, deployment, database migration, or credential operation was performed.

Instruction Coverage:
- 6/6 acceptance criteria covered; IC = 1.0.

Rollback:
- Revert the Yjs codec change to restore prior undefined-to-null behavior.
- Revert parser/runtime normalization independently; no stored schema migration needs reversal.
