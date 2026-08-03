# Verify — Codex Agentic Gateway

## AC → Evidence Mapping

- AC1：`tests/codexAgenticGateway.test.ts` 静态验证 MCP Host 与能力端点不引用 `runStyloAgentCore`、memory、message projection 或 tracing。
- AC2：`STYLO_TOOL_DEFINITIONS` 是唯一 Registry；内部 `createStyloTools` 与外部 `executeStyloCapability` 共用定义和执行入口。
- AC3：`CODEX_INITIAL_CAPABILITIES = ["project_read"]`；manifest、执行入口和 API 端点三层过滤。专项测试验证 `create_document` 在 Bridge 前被拒绝。
- AC4：`/api/agent-tools` 先验证 catalog 所有权，再调用 `flushRealtimeProjectProjection`、`loadAgentProjectState` 与现有 Bridge builder。
- AC5：stdio MCP smoke test 完成 initialize 与 tools/list；共享 manifest 包含五个现有项目读取工具。真实认证调用等待端点部署和短期 token。
- AC6：API 限制 64 KiB、执行 rate limit、校验 project/tool identity；MCP 对无 token、未选项目与不可用工具返回结构化错误。
- AC7：新增 4 个专项测试，4/4 通过。
- AC8：生产构建通过；完整测试 239/240，通过的 4 个新增测试均包含在内。唯一失败是既存 `publicAccountSquare` 文案断言，与本变更文件无重叠。全局 typecheck 仍被既存 screenplay/multimodal service 类型错误阻断，新增文件没有 typecheck 错误。
- AC9：MCP instructions 不注入项目内容；项目列表是小页 identity；现有读取工具保留 `view`、`max_items` 与 `max_chars` 渐进披露契约。

## Commands and Results

- `npm run typecheck`：新增网关文件无错误；工作树既存错误位于 `ScreenplayBlockEditor.tsx` 和多个 service 文件。
- 专项 TypeScript 编译 + `node --test .../codexAgenticGateway.test.js`：4 passed, 0 failed。
- `npm test`：239 passed, 1 failed；失败为 `publicAccountSquare.test.ts` 期待已移除的 Foundation 文案。
- `npm run build`：通过，Vite 7277 modules transformed。
- `codex mcp list`：项目配置中的 `stylo` stdio server 显示 enabled。
- `npm ls @modelcontextprotocol/sdk --depth=1`：直接版本 `1.30.0` 已解析。
- `git diff --check`：通过。

## Live Integration Gate

2026-08-03 已完成生产部署：

- Cloudflare Pages project：`stylo`
- Deployment id：`d986ea6a-e876-45b7-a506-e7837da29eeb`
- Immutable URL：`https://d986ea6a.node-qalam.pages.dev`
- Production alias：`https://node-qalam.pages.dev`
- 远端 D1：无待处理 migration
- 不可变 URL 与生产别名主页均返回 HTTP 200
- 两个 URL 的 `/api/agent-tools` 在无 bearer token 时均返回 HTTP 401 和结构化 `Missing bearer token`，证明路由在线且认证 fail closed

真实 Codex 项目读取还需要：

1. 由用户授权一个短期 Clerk session token 给 Codex 启动环境。
2. 在新 Codex 任务中调用 `stylo_connection_status`、选择项目，并完成一个真实 `find_documents → read_document` 验证。

部署过程没有读取、记录或持久化用户 token。
