# Reflect — Agent Null Link Data Recovery

What failed / nearly failed:
- A generic synchronization codec collapsed two distinct JSON-object states—missing and null—so optional React Flow fields became persistent schema violations downstream.
- The Agent project loader correctly used strict validation, but its compatibility boundary did not account for already contaminated realtime documents.
- Unit coverage previously tested Yjs convergence and schema rejection independently, but not optional-field semantics across Yjs -> D1 materialization -> Agent reconstruction.

Three concrete improvements next time:
1. Add serialization-contract tests whenever a new sync codec maps `undefined`, `null`, arrays, or optional record fields.
2. Include at least one end-to-end fixture from the persistence authority through every strict consumer, especially Agent preflight.
3. Keep canonical types strict and isolate legacy repair in named boundary tests so compatibility does not silently broaden validation.

Lessons appended to context memory:
- For JSON-like project snapshots, undefined object properties must be omitted; using null as a generic fallback changes domain meaning.
- Defensive read compatibility and corrected future writes are both required for a non-destructive cloud-data repair.
