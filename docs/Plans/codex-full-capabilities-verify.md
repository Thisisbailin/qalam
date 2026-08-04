# Verify — Codex Project Operator

## AC → Evidence Mapping

- AC1：`tests/codexAgenticGateway.test.ts` 验证 read/full scope 映射、完整 manifest 与只读回归；通过。
- AC2：配对 API 记录 `requested_scope`，完整 scope 只有在 `inspect` 后携带相同 `expectedScope` 才可批准；授权 UI 在按钮前展示能力范围与 8 小时 TTL；源码契约测试通过。
- AC3：`realtime-worker/src/index.ts` 的内部 `/agent-apply` 先写 `room_operations`/`room_updates`，再应用 Yjs update、广播并 flush；实时架构与 Codex 契约测试通过。
- AC4：Pages 检查调用方 revision；Durable Object 原子比较 `expectedRevision` 与 `expectedServerSeq`；冲突返回 409；源码契约测试通过。
- AC5：`.codex/config.toml` 使用 `default_tools_approval_mode = "writes"`；manifest 单测验证只读与 destructive annotations；通过。
- AC6：完整 manifest 不含两项 `generation_approval` 工具；`APP_REVIEW_REQUIRED` 阻断 Fountain 正文持久化；通过。
- AC7：专项测试、Worker dry-run、Pages Functions build、生产应用 build 通过。严格全仓 typecheck 只有既有 screenplay/service 错误；全仓测试 244/245，通过项包含全部 Codex 与 realtime 测试，唯一失败来自用户进行中的 `publicAccountSquare`/FlowSurface 断言。
- AC8：生产 `project_full` 配对后，在 `flow-project-main` 创建 `Codex 接入临时验证` Foundation time block，读取确认后删除，再次读取确认不存在；revision `236476 → 236483 → 236485`，通过且无测试对象残留。

## Build Evidence

- `npm test`：244 pass / 1 unrelated fail；Codex 8 项全部通过。
- `npm run typecheck`：本次文件无错误；既有错误位于 `ScreenplayBlockEditor.tsx` 与 provider service 文件。
- `npx wrangler deploy --dry-run --config realtime-worker/wrangler.toml`：通过，Worker upload 291.73 KiB / gzip 56.86 KiB。
- `npx wrangler pages functions build`：通过；仅有现存 Agents SDK Node builtin compatibility warnings。
- `npm run build`：通过，7278 modules transformed。
- SQLite memory migration：0012 → 0013 后可同时插入 `project_read` 与 `project_full`，旧列结构保留并新增 `requested_scope`。
- D1 remote migration：`0013_codex_full_project_access.sql` 应用成功。
- Realtime Worker production：version `f2964090-560f-4d3e-b7e2-fda1e2116cb4`。
- Pages production：deployment `55565cd6-fd01-4ad4-8043-7d0dec6cdd27`，source `adac40f`。
- 生产 MCP manifest：scope `project_full`，15 个共享工具；临时 block 创建、读取、删除、缺失复读全部通过。

## Platform Difference Checks

- 配对 CLI 继续使用 macOS/Windows/Linux 标准打开方式；scope 协议一致。
- 凭证仍只写系统临时目录并保持 `0600`；未新增长期 credential store。
