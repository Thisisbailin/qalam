# Plan — Codex Device Pairing

## Architecture Intent Block

Stylo 本地客户端只负责确认当前账户愿意授权；本机 Codex 持有不可猜测的 device secret 并领取短期外部凭证。外部凭证只在认证边界映射到 `userId + project_read`，之后继续进入既有 Agentic Capability Gateway。内部 Stylo Agent runtime 完全不参与。

## Work Breakdown

1. 增加 D1 配对请求与外部 Agent token 哈希表。
2. 实现配对 start/approve/poll 与 token authenticate/revoke API。
3. 在 Stylo 本地客户端账户菜单增加精简授权入口，复用现有 Clerk 会话；Web 保留兼容入口。
4. 增加本机 connect/disconnect 与临时凭证存储脚本。
5. 让 stdio MCP 动态读取临时凭证，并将项目列表切到外部 Agent 专用端点。
6. 增加契约/安全测试、构建证据并部署。
7. 在 Safari 完成一次授权并验证真实只读项目调用。

## Verification Plan

- AC1/AC8：静态测试检查授权 UI 与外部 Adapter 不引用浏览器存储和内部 Agent runtime。
- AC2/AC3：测试配对码规范、token 前缀、TTL 上限与哈希存储契约。
- AC4/AC5：MCP stdio smoke test覆盖无凭证与临时凭证发现；API 源码契约检查专用认证入口。
- AC6/AC7：临时目录读写/过期/清理测试，不输出凭证值。
- AC9：目标测试、Functions build、`npm run build`、远端 401/配对 start smoke。

## Rollback Points

- 新 API、UI gate 和脚本均为旁路入口，删除即可恢复环境变量注入模式。
- 新表不改现有项目表；回滚应用代码后保留空表无行为影响。
- 外部 token 失效或本机文件删除只需要重新配对，不影响项目数据。
