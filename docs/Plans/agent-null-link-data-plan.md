# Plan — Agent Null Link Data Recovery

Architecture Intent Block:
- Treat project snapshots as JSON-like data: undefined object fields are absence, while explicit null remains a real value.
- Maintain a strict canonical NodeFlow model and place legacy compatibility at the parser boundary.
- Normalize canvas/runtime link output before it can re-enter persistence.

Work Breakdown (<=1 day each):
1. Reproduce the Agent failure through `buildAgentProjectStateFromRealtimeDocument` and trace the cloud serialization source.
2. Correct Yjs object-field encoding/deletion semantics without altering array null behavior.
3. Add null-to-absence migration for link data and normalize runtime/canvas links.
4. Add schema, Yjs, and Agent regression tests; run release gates.

Verification Plan (by AC):
- AC1/AC2: `tests/nodeflowSchema.test.ts`.
- AC3/AC4: `tests/yProjectDocument.test.ts`.
- AC5: `tests/agentRuntimeArchitecture.test.ts`.
- AC6: targeted tests, `npm test`, `npm run build`, `npm run typecheck`, and `git diff --check`.

Rollback Points:
- Yjs codec change can be reverted independently; parser compatibility still keeps existing Agent reads operational.
- Parser/runtime normalization can be reverted independently without changing persisted schema or database state.
