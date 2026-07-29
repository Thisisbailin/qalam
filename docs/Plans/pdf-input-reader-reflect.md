# Reflect — PDF 输入节点与阅读标注

What failed / nearly failed:
- 当前共享脏工作区的仓库级 `npm run typecheck` 未通过，错误位于 GitHub/API 响应类型、Storage 返回值和 Flow 边选择等并行修改区域；PDF 新增文件没有出现在错误列表中。
- 全量 `npm test` 为 202/203，唯一失败是并行修改中的 `wrapperProjection` 剧本包装器断言；PDF 专项 5/5 通过。
- 浏览器自动化的坐标拖拽没有形成系统文本选区。为避免把工具限制误判为产品缺陷，验证夹具通过用户点击触发一个真实 DOM Range，再继续驱动生产选区处理、高亮和批注逻辑。

Three concrete improvements next time:
1. 在开始和结束验证时保存工作树基线与变更时间，区分本任务回归和共享工作区并行变更。
2. 为 `PdfReaderOverlay` 提取可直接挂载的选区命令转换函数，并增加 DOM 环境集成测试，减少对浏览器坐标拖拽能力的依赖。
3. 在合并前于干净分支重跑仓库级 TypeScript 和 203 项全量测试，要求 `typecheck` 与 `wrapperProjection` 均恢复通过后再关闭 AC10。

Lessons appended to context memory:
- PDF 高亮应由 Text Layer Range 和页内归一化逐行矩形驱动，不能再使用脱离页面坐标系的自由框选。
- “全屏”是同一 Canvas 上的聚焦尺度变化，不是新的页面或模块；背景底纹、悬浮节点和既有连接语义必须继续可感知。
- 共享脏工作区需要同时报告任务内验证结果和仓库全局门禁状态，不能用前者替代后者。
