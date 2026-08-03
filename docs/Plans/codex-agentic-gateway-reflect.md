# Reflect — Codex Agentic Gateway

## What failed / nearly failed

- 全局 typecheck 和完整测试受到当前脏工作树中无关变更影响；没有为通过闸门而修改或回退用户文件。
- 初版 capability 过滤把空 allowlist 解释为“全部允许”；专项安全检查后已改为 fail closed，并增加回归断言。
- 真实认证端到端验证依赖部署和短期用户授权，本轮没有扩大权限范围代为执行。

## Three concrete improvements next time

1. 在高并发脏工作树中，实施前同时记录全局 typecheck 与完整测试基线，使既存失败的归因更直接。
2. 为 Pages Functions 增加可注入认证和投影依赖的 handler core，下一阶段可在不伪造 Clerk token 的情况下覆盖完整 API 调用顺序。
3. 插件化阶段优先实现短期 OAuth/授权交换，替代人工环境变量 token，并用自动过期和 scope 约束降低凭据风险。

