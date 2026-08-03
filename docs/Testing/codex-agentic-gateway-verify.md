# Codex Agentic Gateway Verification

Date: 2026-08-03

## Result

- Shared Registry and read-only capability boundary: pass.
- Internal Agents SDK adapter compatibility: pass in existing Agent test suite.
- MCP stdio initialize/tools-list smoke: pass.
- Progressive disclosure: pass.
- Production client build: pass.
- Production Pages deployment and unauthenticated fail-closed check: pass.
- Authenticated live project call: pending user-granted short-lived token.

## Regression Evidence

```text
Codex gateway tests: 4 passed, 0 failed
Full repository tests: 239 passed, 1 unrelated existing assertion failed
Vite production build: passed
Codex MCP discovery: stylo enabled
Pages deployment: d986ea6a-e876-45b7-a506-e7837da29eeb
Immutable URL: https://d986ea6a.node-qalam.pages.dev -> HTTP 200
Production alias: https://node-qalam.pages.dev -> HTTP 200
/api/agent-tools without token -> HTTP 401 on both hosts
Remote D1 migrations: none pending
```

The failing repository assertion expects the removed string `Foundation 只保留当前项目内部的时间与空间结构` in `FlowSurface.tsx`; gateway files do not touch that surface.
