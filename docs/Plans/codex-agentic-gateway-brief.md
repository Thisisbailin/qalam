# Mission Brief — Codex Agentic Gateway

## Objective

- 让外部 Codex 与 Stylo 内置 Agent 处于并列的 Agent Host 位置。
- 两个 Host 复用同一份 Stylo 工具定义、参数契约、项目 Bridge 与能力策略。
- 首期通过 MCP 向 Codex 开放 `project_read` 能力，并从现有实时云项目投影读取权威状态。
- 保留后续开放 `project_write`、`operate` 与 `approval` 的同一扩展通道。

## Out of scope

- 不复用或改造内部 Agent 的 LLM Runner、token/tracing、消息渲染、会话记忆、stream projection。
- 不让 Codex 调用一个嵌套的 Stylo Agent。
- 首期不允许外部 Host 修改项目或执行生成工作流。
- 首期不实现 Codex Plugin 的分发包装和 OAuth 安装流程。

## Inputs / Outputs (contracts)

- 输入：已认证的 Stylo 用户、显式 `projectId`、共享工具名、符合该工具 JSON Schema 的结构化参数。
- 状态：调用前刷新实时项目投影，并通过现有 `loadAgentProjectState` 与 `createNodeFlowBridgeState` 创建只属于本次调用的 Bridge。
- 输出：共享工具定义产生的结构化结果、摘要、项目修订和云投影更新时间。
- MCP Host：负责列项目、选择当前项目、发现共享读取工具，并将工具调用转发到能力端点；不运行 LLM。

## Acceptance Criteria (AC)

- AC1：内部 `runStyloAgentCore`、消息、记忆、token 与 tracing 路径不被 MCP Host 引用。
- AC2：共享 Registry 中的工具定义只有一个事实来源，Agents SDK 与外部能力端点均从该 Registry 取工具。
- AC3：外部端点只暴露 `project_read` 工具，并拒绝所有写入、操作、审批及未知工具。
- AC4：每次外部工具调用在执行前刷新实时云投影，并验证用户对指定项目的访问权。
- AC5：Codex MCP Host 可以列出项目、选择项目，并以原始工具 schema 调用至少 `find_documents`、`read_document`、`list_project_resources`、`read_project_resource`、`search_project_resource`。
- AC6：无认证令牌、未选项目、跨项目、超大请求与过量请求均以可恢复的结构化错误失败。
- AC7：新增契约测试证明 Registry 过滤、外部执行边界和 MCP manifest 与内部工具名一致。
- AC8：现有 typecheck、测试和生产构建无新增失败。
- AC9：MCP 初始化只提供精简工具元数据；项目、资源和正文均由 Agent 按 identity/detail/slice/full 渐进查阅。

## Constraints

- 不记录或持久化 Clerk bearer token；MCP Host 只从进程环境读取。
- 不把项目正文写入调试日志。
- 外部调用只读取云端实时投影，不直接解析浏览器 localStorage/IndexedDB。
- MCP Transport 与 Stylo 内部 Agents SDK Runtime 保持完全独立。
- 保持当前工具参数和返回结构，避免形成内外两套能力语义。

## Dependencies & Risks

- `@modelcontextprotocol/sdk` 已由 `@openai/agents` 安装且由根 `overrides` 固定为 `1.30.0`；首期不联网安装新依赖。
- Clerk session token 会过期；首期通过环境变量注入，后续插件化时再接 OAuth/短期授权交换。
- 云投影虽为实时同步，调用仍必须返回 revision/updatedAt，后续写能力用它做并发保护。
- 若部署端尚未包含新增 `/api/agent-tools`，MCP Host 应明确报告端点不可用。

## Platform Differences

- MCP Host 是 Node stdio 进程，在 macOS、Windows、Linux 使用相同协议。
- 数据能力位于现有云端 Pages Functions，不依赖 Electron 窗口或平台 UI。
- 认证令牌注入方式属于 Codex Host 配置，不进入 Stylo 内部 Agent Runtime。
