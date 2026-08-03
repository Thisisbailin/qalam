# Verify — Codex Device Pairing

## AC → Evidence Mapping

- AC1：`CodexConnectDialog` 只提交人类配对码；静态契约测试确认不访问 Cookie、localStorage、IndexedDB 或 Clerk token。
- AC2：服务端 pairing request 使用高熵 device secret、10 分钟 TTL、单账户批准与一次性 consumed 状态；配对 `WERB-G75M` 已成功消费一次。
- AC3：Agent token scope 固定为 `project_read`，TTL 为 8 小时，D1 只写入 SHA-256 哈希。
- AC4：`/api/agent-tools` 与 `/api/agent-projects` 通过共享 `authenticateAgentRequest` 接受 Clerk JWT 或有效 Agent token。
- AC5：真实 stdio MCP 进程从系统临时文件自动加载凭证；报告 `authenticated=true`、`authSource=temporary_file`。
- AC6：本机文件权限实测为 `-rw-------`；connect 脚本输出不含 token。
- AC7：`npm run mcp:stylo:disconnect` 可调用 `/api/agent-access` 撤销当前 token 并删除临时文件。
- AC8：静态测试确认配对、认证、MCP Adapter 不引用内部 Agent runtime、memory、messages 或 tracing。
- AC9：Codex 网关目标测试 6/6；Vite 生产构建通过；Cloudflare Pages 生产部署 `e23edfce-2a53-4264-9da2-52d9ff2a83b9` 成功；D1 无待应用迁移。

## Live End-to-End Evidence

```text
credential mode: -rw-------
authenticated: true
authSource: temporary_file
sharedToolsAvailable: 5
progressiveReadToolPresent: true
projectCount: 1
projectSelectionSucceeded: true
readCapabilitySucceeded: true
readResultItems: 1
```

验证输出仅记录布尔值和数量；未打印 token、项目标题或正文。

## Build / Test Notes

- `npm run build`: pass（7278 modules transformed）。
- Codex gateway compiled test: 6 pass / 0 fail。
- 仓库全量 `npm run typecheck` 仍被既有 `ScreenplayBlockEditor` 与多家模型 service 的严格类型错误阻断；这些文件不在本次变更中，未越界修改。
- 当前 Codex 任务的工具表在任务启动时已冻结；新任务会从项目 `.codex/config.toml` 启动已认证 Stylo MCP。

## Rollback

- 立即撤销：`npm run mcp:stylo:disconnect`。
- 服务端代码回滚后，新表可保留为空，不影响现有项目数据。
- 删除系统临时凭证只会要求重新配对，不会修改 Stylo 项目。

