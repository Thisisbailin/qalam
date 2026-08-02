# Mission Brief — Agent Null Link Data Recovery

Objective:
- Restore Agent message handling when realtime project documents contain legacy `links[].data: null` values.
- Stop cloud/Yjs synchronization from converting omitted object properties (`undefined`) into explicit `null` values.
- Keep the canonical NodeFlow contract unchanged: link `data` is either a record or absent.

Out-of-scope:
- No remote database rewrite or destructive migration.
- No changes to Agent model/provider behavior.
- No broad relaxation of NodeFlow validation for arrays, primitives, or malformed records.

Inputs / Outputs (contracts):
- Input: realtime/Yjs project snapshots that may contain `links[].data: null`.
- Output: Agent project state with null link data omitted; future Yjs snapshots omit undefined object fields while preserving explicit null fields.

Acceptance Criteria (AC):
- AC1: `parseNodeFlowFile` accepts `links[].data: null` and returns the field as absent.
- AC2: invalid non-record link data remains rejected.
- AC3: Yjs object encoding omits undefined properties and removes previously stored values when the next snapshot marks them undefined.
- AC4: explicit null values remain representable in Yjs where null is part of the domain contract.
- AC5: Agent realtime state reconstruction succeeds for a cloud document containing null link data.
- AC6: targeted tests, full test suite, build, and diff hygiene checks complete successfully or record an existing baseline failure.

Constraints (perf/i18n/a11y/privacy):
- Preserve incremental Yjs update behavior and ID-array merge semantics.
- Do not transmit project data or invoke external services during verification.
- Keep compatibility repair at serialization/validation boundaries rather than weakening internal types.

Dependencies & Risks:
- Yjs maps distinguish a missing key from a key with null; changing undefined handling can emit key-deletion updates. This is intended and covered by tests.
- Existing cloud documents are repaired lazily when read by Agent and cleaned on the next normalized project sync; no bulk migration is required.

Platform Differences via Platform Layer:
- None. Browser and Electron share the same TypeScript/Yjs pipeline.
