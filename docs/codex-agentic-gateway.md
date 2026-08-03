# Stylo Codex Agentic Gateway

Stylo Codex Gateway 是独立的 MCP Agent Host Adapter。它不运行 Stylo 内置 Agent，不读取其消息、记忆、token 或 tracing 数据；它从实时云项目投影调用同一份 Stylo Tool Registry 与 Project Bridge。

## 渐进式上下文

连接时只提供精简工具元数据，不注入项目正文。推荐探索顺序：

1. `stylo_list_projects` 获取少量项目身份。
2. `stylo_select_project` 绑定本次 MCP 进程的项目上下文。
3. `find_documents` 或 `list_project_resources` 获取稳定引用与 identity。
4. `read_document` 或 `read_project_resource` 按 `identity`、`detail`、`slice`、`full` 逐步展开。
5. 使用 `max_items`、`max_chars` 控制每次读取范围。

## 推荐连接方式（本地 Stylo 客户端）

本机 Codex 使用一次性设备配对，不需要复制 Clerk session token：

```bash
npm run mcp:stylo:connect
```

脚本会显示一个 8 位配对码并唤起 Stylo。打开本地客户端右上角 `Account → 连接 Codex`，核对并输入该码后确认。后端签发的凭证：

- 只允许 `project_read`；
- 最长 8 小时；
- 服务端只保存哈希；
- 本机只写入权限为 `0600` 的系统临时文件；
- 不进入仓库、Codex 配置或日志。

撤销当前连接：

```bash
npm run mcp:stylo:disconnect
```

MCP Host 会自动发现临时凭证。已启动的 Codex Host 可以通过连接状态检查刷新；若当前任务尚未加载 Stylo 工具，开启一个新任务即可。

## 兼容的环境变量启动方式

开发和自动化环境仍可从进程环境读取配置：

```bash
export STYLO_AUTH_TOKEN="<short-lived Clerk session token>"
export STYLO_API_BASE_URL="https://node-qalam.pages.dev"
# 可选；未设置时由 Agent 通过项目工具选择
export STYLO_PROJECT_ID="<project id>"
npm run mcp:stylo
```

开发环境可将 `STYLO_API_BASE_URL` 指向本地 Pages Functions 地址。

Codex 配置示例：

```toml
[mcp_servers.stylo]
command = "node"
args = ["/absolute/path/to/Qalam/scripts/stylo-mcp-server.mjs"]
required = true
```

环境变量优先于设备配对产生的临时凭证。不要使用 `codex mcp add --env STYLO_AUTH_TOKEN=...`，因为该方式会把值写入配置文件；也不要把真实 token 写进 `.codex/config.toml`、仓库或日志。

## 当前能力边界

首期只开放 Tool Catalog 中 capability 为 `project_read` 的工具。MCP Host 和服务端都会执行该 allowlist，写入、操作和审批工具不会出现在 manifest 中，即使客户端伪造工具调用也会被拒绝。

后续开放写能力时继续复用同一 Registry 与 Bridge，但必须先补齐 revision 冲突、实时操作持久化、审批回传和审计证据。
