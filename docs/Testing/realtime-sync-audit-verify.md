# Verification — Realtime sync production audit

## Automated results

- `npm test`: **208/208 passed**
- Realtime client fault matrix: **9/9 passed**
- Account-settings recovery matrix: **2/2 passed**
- Realtime architecture assertions: **8/8 passed**
- Realtime Worker strict standalone TypeScript check: **passed**
- Client sync targets strict standalone TypeScript check: **passed**
- `wrangler deploy --dry-run --config realtime-worker/wrangler.toml`:
  **passed**, Durable Object and D1 bindings resolved
- `npm run build`: **passed**
- `git diff --check`: **passed**

## Faults exercised

- stale local Yjs checkpoint versus newer visible project;
- concurrent cold-start local and remote edits on different fields;
- absent local Yjs checkpoint with newer visible state;
- update already awaiting ACK when Agent acquires a project snapshot;
- materialized project beyond the D1 projection limit;
- 30 pointer-frame project updates in one burst;
- synchronous WebSocket send failure;
- malformed remote update;
- disconnect and retry after an ACK is lost;
- account-settings PUT transport failure;
- account-settings bootstrap transport failure.

## Known repository-wide gates

- `npm run typecheck` is not green because of pre-existing errors outside this
  sync change, including `agents/tools/accessGithubRepository.ts`,
  media-node/service response typing, and two Flow selection setters.
- `npm audit --omit=dev --audit-level=high` reports one high and three lower
  production dependency findings; the full dependency tree reports one
  critical and ten high findings. No dependency versions were changed during
  this audit because the worktree already contains unrelated dependency work.
