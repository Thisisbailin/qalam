# Reflect — Codex Device Pairing

## What failed / nearly failed

- Codex 内置浏览器与 Safari/Stylo 客户端不共享登录态，最初检查网页会话时发生超时；最终改用 Stylo 桌面客户端完成授权。
- 全量严格类型检查被任务外的既有错误阻断，因此验证证据拆分为目标编译测试、生产构建和真实线上 MCP 调用。
- 当前 Codex 任务不会热加载新出现的 MCP 工具；连接验证必须启动独立 stdio 客户端，新任务才能在原生工具表中看到 Stylo。

## Three concrete improvements next time

1. 设备配对默认把完整 verification URL 传给 Stylo 桌面客户端，而不是只唤起应用，减少手工输入。
2. 增加独立的 gateway-only TypeScript 配置，让目标类型验证不受仓库其它 service 错误影响。
3. 在 Codex 设置页增加“工具表在新任务生效”的明确状态提示，避免把成功配对误解为当前任务热更新。

