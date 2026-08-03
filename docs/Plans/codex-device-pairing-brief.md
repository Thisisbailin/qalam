# Mission Brief — Codex Device Pairing

## Objective

- 让已登录 Stylo 本地客户端的用户用一次显式授权，把本机 Codex 接入外部 Agent 通道。
- 不读取浏览器 Cookie、localStorage 或 Clerk session 存储，也不要求用户复制 bearer token。
- 为 Codex 签发仅含 `project_read` 的短期、可撤销外部 Agent 凭证。
- 继续复用现有 `/api/agent-tools`、共享 Tool Registry、Project Bridge 与实时云投影。

## Out of scope

- 不改 Stylo 内部 Agent runtime、消息、记忆、token/tracing 或渲染管线。
- 不实现通用 OAuth Provider、远程 Streamable HTTP MCP 或插件市场分发。
- 不开放项目写入、生成、操作或审批能力。
- 不把 Clerk JWT 或外部 Agent token 写入仓库、Codex 配置或日志。

## Inputs / Outputs (contracts)

- 配对开始：本机脚本请求一次性 `deviceCode` 与人类可核对的 `userCode`。
- 客户端批准：已登录用户在 Stylo 本地客户端的账户菜单确认 `userCode`，后端只记录账户绑定，不向客户端返回 Agent token；Web 页面保留为兼容入口。
- 配对轮询：持有高熵 `deviceCode` 的本机脚本一次性领取外部 Agent token。
- 本机存储：token 仅写入操作系统临时目录、权限 `0600`、最长 8 小时；MCP 可在后续进程中自动读取。
- 服务端存储：只保存 token 哈希、账户、scope、签发/过期/撤销时间。

## Acceptance Criteria (AC)

- AC1：客户端授权流程只通过现有认证请求调用后端，不导出或读取 Clerk token、Cookie、localStorage 或 IndexedDB。
- AC2：配对码 10 分钟过期，只能由一个已登录账户批准并被领取一次。
- AC3：外部 Agent token 只包含 `project_read`，最长 8 小时，服务端只存哈希。
- AC4：`/api/agent-tools` 与 Agent 项目列表同时接受 Clerk JWT 和有效外部 Agent token。
- AC5：MCP 在没有环境变量时自动读取临时凭证；凭证过期后 fail closed。
- AC6：本机脚本不打印 token，并以 `0600` 原子写入临时凭证文件。
- AC7：撤销脚本可在服务端撤销当前 token 并删除本机临时文件。
- AC8：配对与 MCP 适配层不引用内部 Agent runtime、memory、message 或 tracing。
- AC9：目标测试、Functions 构建和生产构建通过，生产端点在无凭证时保持 fail closed。

## Constraints

- 继续使用现有 Clerk 登录和 D1；不引入新依赖。
- 配对开始/轮询端点不依赖登录，但必须使用高熵 device secret、短 TTL 与速率限制。
- 用户必须在 Stylo 页面执行明确的“授权 Codex”动作。
- 项目正文仍按 identity/detail/slice/full 渐进查阅，不在连接时预载。

## Dependencies & Risks

- D1 新增配对请求与外部 token 表；部署前必须应用迁移。
- 临时目录可能被系统清理；清理后重新配对即可，不影响 Stylo 数据。
- 当前阶段是设备配对而非完整 OAuth；未来切换远程 MCP OAuth 时，能力层和 token scope 保持不变。

## Platform Differences

- Node 脚本与 MCP 协议跨平台；浏览器自动打开分别使用系统标准命令。
- 凭证文件位于各平台的系统临时目录，不进入项目目录。
