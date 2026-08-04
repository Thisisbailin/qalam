# Codex project_full production verification — 2026-08-04

## Deployment

- Git source: `adac40f6d053e932c2f114c878f98a288d6d798e`
- D1 migration: `0013_codex_full_project_access.sql` applied to remote `stylo`.
- Realtime Worker: `stylo-project-realtime`, version `f2964090-560f-4d3e-b7e2-fda1e2116cb4`.
- Pages: `stylo`, production deployment `55565cd6-fd01-4ad4-8043-7d0dec6cdd27` at `node-qalam.pages.dev`.

## Pairing and manifest

- User approved the `project_full` scope in the Stylo client after the dialog displayed its project-write boundary.
- Token TTL: 8 hours; stored only in the existing `0600` system temporary credential file.
- Manifest result: `project_full`, 15 shared tools. The two client-memory `generation_approval` tools were absent as designed.

## Reversible production write

Target project: `flow-project-main`.

1. Read baseline revision: `236476`.
2. `operate_foundation.create_block` created the explicitly named `Codex 接入临时验证` time block (`folder-5`); committed revision `236483`.
3. `read_project_resource` found the committed block.
4. `operate_foundation.delete_block` removed that block and its archive; committed revision `236485`.
5. A final `read_project_resource` returned not found; rollback confirmed with no test artifact left behind.

## Local quality gates

- Codex gateway tests: pass.
- Realtime architecture tests: pass.
- Full suite: 244/245; the single failure is an unrelated assertion over user-in-progress FlowSurface/public-square UI work.
- Production app build, Pages Functions build, Worker dry-run, and SQLite migration smoke: pass.
- Strict typecheck: no errors in this change set; existing errors remain in screenplay/provider service files.
