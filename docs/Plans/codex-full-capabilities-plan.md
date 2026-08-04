# Plan — Codex Project Operator

## Architecture Intent Block

外部 Codex 仍只调用协议中立 Tool Registry。Pages Function 负责认证、scope 与项目所有权；工具在隔离 Bridge 快照中执行；若产生变更，完整候选项目交给对应项目的 Durable Object。Durable Object 在单线程权威状态上比较 revision、生成 Yjs 增量、先记录操作再应用/广播，并刷新 D1 读取投影。

## Work Breakdown

1. 将配对 token 扩展为显式 `project_read` / `project_full`，增加授权前 scope inspect。
2. 建立 scope→capability 映射，并按认证结果生成 manifest/执行 allowlist。
3. 增加 Bridge 结果到项目文档的窄合并函数。
4. 增加 Durable Object 内部 agent snapshot apply 路径与 revision 冲突响应。
5. 让 MCP 跟踪 revision、携带预期 revision，并配置 `default_tools_approval_mode = "writes"`。
6. 更新连接 UI、CLI、临时凭证 metadata、文档和安全 annotations。
7. 增加单元/契约/架构测试，构建并部署 Worker、D1 migration 与 Pages。
8. 重新以完整 scope 配对，创建临时 note、读取验证并清理。

## Verification Plan

- scope 映射、manifest、annotations 与只读回归：`tests/codexAgenticGateway.test.ts`。
- Bridge 合并、script review fail-closed、revision contract：新增专项测试。
- DO 内部写入、operation log、broadcast、409：实时架构源码契约与 Worker dry-run。
- UI 不读取浏览器 credential store，完整 scope 必须 inspect/ack：静态契约测试。
- 构建：目标测试、`npm run build`、Pages Functions build、Worker dry-run。
- 生产：无凭证 401；完整配对后真实创建/读取/清理。

## Rollback Points

- scope migration 保留 `project_read`；应用回滚后完整 token 会 fail closed。
- `/agent-apply` 只通过内部 Durable Object binding 可达，可独立移除。
- `.codex/config.toml` 的 `writes` 审批可独立回滚，不改变服务端权限。
- 验证对象使用明确临时名称并在同一项目内清理。
