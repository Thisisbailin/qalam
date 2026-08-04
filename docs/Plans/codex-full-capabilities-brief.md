# Mission Brief — Codex Project Operator

## Objective

- 让本机 Codex 在用户显式授权后，使用 Stylo 内部 Agent 共用的项目读取、文档写入、Flow 操作、Foundation 操作与辅助读取工具。
- 所有项目变更进入 Yjs Durable Object 权威写入路径并实时广播给已打开的 Stylo 客户端。
- 保留只读配对；旧 `project_read` token 不会因部署而升级。

## Out of scope

- 不开放账户、凭证、项目删除、发布或跨项目批量管理能力。
- 不绕过 Codex MCP 的写工具审批。
- 不把客户端内存中的生成执行审批伪装成耐久能力；`generation_approval` 暂不进入外部完整授权。
- 不绕过 Fountain 剧本文本的 App 内人工复核边界。

## Contracts

- 配对 scope：`project_read` 或 `project_full`；请求、展示、批准和签发必须是同一个 scope。
- `project_full` 映射到 `project_read`、`project_write`、`runtime_read`、`external_read`，不含 `generation_approval`。
- 写调用在 HTTP 入口检查可选调用方 revision，并在 Durable Object 内再次原子检查当前 revision。
- 成功写入返回新 revision；冲突返回 HTTP 409、当前 revision 和可恢复指引。
- MCP 进程跟踪所选项目最近 revision，并在后续写调用携带它。

## Acceptance Criteria

- AC1：只读 token 的 manifest 与执行权限保持只读；完整 token 才能看到/调用完整能力集合。
- AC2：授权 UI 在确认前显示完整能力范围和 8 小时 TTL；旧客户端不能静默批准完整 scope。
- AC3：项目写入先持久化到实时 Durable Object，再返回成功，并广播给在线客户端。
- AC4：并发变更不会被快照覆盖；revision 不一致在权威边界返回 409。
- AC5：工具 annotations 准确区分 read-only、写入和潜在破坏性工具；项目 MCP 默认使用 `writes` 审批。
- AC6：Fountain 正文外部修改 fail closed；生成执行审批不出现在完整 manifest。
- AC7：专项测试、实时架构测试、Worker dry-run、Functions/应用构建通过。
- AC8：生产重新配对后完成一次可回滚的创建→读取→清理验证，或明确记录用户尚未完成最终授权。

## Risks

- 全量项目快照作为内部 DO 请求体可能较大；沿用现有项目大小上限，并在 DO 内以 Yjs 增量落盘。
- `operate_foundation` 与通用更新可覆盖或删除项目内容；标记为 destructive，并由 Codex 审批拦截。
- 在线客户端可能同时编辑；最终 revision 比较必须发生在 Durable Object 内而不是 D1 投影上。

