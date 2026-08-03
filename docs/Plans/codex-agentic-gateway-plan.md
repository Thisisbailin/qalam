# Plan — Codex Agentic Gateway

## Architecture Intent Block

Stylo 内置 Agent 与 Codex 各自拥有独立 Runtime。二者只在 Runtime 下方汇合到共享 Tool Registry、Capability Executor 和 Project Bridge。MCP 是外部 Host Adapter；Agents SDK `tool()` 是内部 Host Adapter。实时云投影是两个 Host 的权威项目状态来源。

## Work Breakdown

1. 将现有 `TOOL_DEFS` 提升为可导出的共享 Registry，并增加按 capability 查询与协议无关执行函数。
2. 保持 `createStyloTools` 的 Agents SDK 行为不变，但让它从共享 Registry 取定义并经过共享执行入口。
3. 新增认证的 `/api/agent-tools`：GET 返回只读工具 manifest，POST 刷新投影并执行一个共享工具。
4. 新增独立 stdio MCP Host：提供项目上下文工具，并把共享只读工具转发到 `/api/agent-tools`。
5. 新增单元/契约测试与最小 MCP 协议 smoke test。
6. 增加项目级 Codex MCP 配置示例和使用说明，不写入真实 token。

## Verification Plan

- AC1：静态测试确认 MCP 文件不引用内部 Agent core、memory、message、tracing 模块。
- AC2/AC3：Registry 单测确认唯一工具名、capability 过滤及拒绝写工具。
- AC4/AC6：API handler mock D1、认证与投影依赖，验证调用顺序和错误响应。
- AC5：向 stdio Host 发送 MCP `initialize`、`tools/list` 与无认证状态调用。
- AC7/AC8：运行 `npm run typecheck`、目标测试、`npm test`、`npm run build`。

## Rollback Points

- Registry 拆分可回退到原 `createStyloTools` 私有数组，不影响内部 Agent 数据。
- `/api/agent-tools` 与 MCP Host 均为新增入口，删除即可停止外部接入。
- 首期不写项目数据，因此失败不会造成项目状态回滚。

