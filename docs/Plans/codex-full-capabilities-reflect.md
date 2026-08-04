# Reflect — Codex Project Operator

## What failed / nearly failed

- 直接开放现有写工具会产生“内存里成功、项目里消失”的假成功；必须先把外部调用接到实时 Durable Object 权威写入边界。
- 只比较 Flow revision 仍可能覆盖同一 Yjs 文档内未增加该 revision 的并发变化，因此最终提交同时比较 server sequence。
- 内部生成审批是客户端内存状态，不具备外部 Host 的耐久交接；完整能力不能等同于盲目暴露全部 catalog capability。
- 全仓测试被用户进行中的 UI 断言阻断；专项测试与失败归属必须分开记录，避免改动无关工作树。

## Three concrete improvements next time

1. 将 Durable Object 的 update durability/broadcast 逻辑抽成一个共享提交函数，让 WebSocket 与内部 Agent 写入复用同一实现而不是维护两段相似代码。
2. 为 MCP 工具调用增加客户端稳定 idempotency key，使网络在“已提交、响应丢失”时能安全返回原结果。
3. 把生成审批迁移到项目级耐久状态，并让 App 与外部 Host 共享同一个审批队列后再开放 `generation_approval`。

## Lessons appended to context memory

- “与内部 Agent 同能力”首先是共享真实状态与权限语义，不是共享工具名称。
- 外部写入的最终并发判断必须位于实时权威对象内部。
- 写工具 annotation、Host 审批与服务端 scope 是互补的三层边界，任何一层都不能替代另外两层。
