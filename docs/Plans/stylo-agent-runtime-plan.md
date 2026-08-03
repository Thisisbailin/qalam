# Plan — Stylo Agent Runtime

## Architecture Intent Block

```text
UI message components
        ↑ normalized timeline
React event reducer
        ↑ Turn / AgentThreadItem lifecycle
run orchestrator
  ├─ provider runtime (OpenAI-compatible / DeepSeek profile)
  ├─ SDK stream projector
  ├─ context/session policy
  └─ tool registry + policy + budget
        ↓
project bridge / D1 session / HTTP SSE
```

依赖方向保持为：领域协议 → Provider/Session/Tool 适配器 → 运行用例 → React/UI。运行核心不得反向依赖消息组件或项目设置界面。

## Work Breakdown

1. 建立 Provider runtime 与 SDK stream projector，移除全局 SDK 状态写入。
2. 建立声明式工具目录，统一能力、预算、缓存和副作用分类。
3. 提取共享 Session item 投影与限额策略，应用到 LocalStorage、Memory、Edge 与 D1。
4. 将 React 事件状态机提取为纯 reducer，将消息时间线投影提取为 O(n) 纯函数。
5. 拆分/收敛消息渲染边界，修复链接协议与状态呈现。
6. 增加架构、DeepSeek、上下文、工具预算、事件 reducer 与时间线测试。
7. 将公开协议收敛为 `turn_started -> item_* -> turn_completed|turn_failed`，
   移除重复 result 终包与 Edge wrapper 的第二套 run/trace 流。

当前协议和开发约束以 `docs/agent-runtime-architecture.md` 为准。

## Verification Plan

- AC1–AC4：静态架构测试与纯函数单测。
- AC5–AC6：事件序列/消息时间线测试，生产构建验证。
- AC7：`npm run typecheck`、`npm test`、`npm run build`、离线高危审计。

## Rollback Points

- Provider runtime 可回退到现有 `OpenAIProvider` 构造，不影响协议。
- 新工具目录仅提供元数据，单个工具定义保持原实现，可逐层回退。
- UI reducer 保持现有 `Message[]` 外部契约，可独立回退。
