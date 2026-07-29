# Plan — PDF 输入节点与阅读标注

Architecture Intent Block:
- `pdfInput` 进入现有 NodeFlow 类型、默认值、序列化、项目包和 Foundation 媒体分类。
- PDF 二进制走现有项目私有对象存储；高亮与关联关系保留在项目 JSON 数据。
- PDF 节点保留 BaseNode 的连接端口语义，但视觉层移除通用 Card 外壳，采用轻量 PDF 文稿页缩略体。
- 聚焦阅读视图是 Flow 的临时画布层，通过节点 ID 读取 Store，不建立新的产品模块或导航层级；覆盖层保持半透明，让当前画布底纹与空间关系继续作为背景。
- `PdfPageSurface` 使用 PDF.js Canvas + Text Layer；文本 Range 转换为页内归一化逐行矩形并用 `updateNodeData` 原子更新。
- 文本笔记关系完全复用可见 Flow 连线，不建立第二套关联索引。
- 批注通过 Store 的 `addNode` 与 `connectNodes` 创建真实文本节点，关闭聚焦视图后仍存在于原画布。
- `PdfReaderOverlay` 由 `React.lazy` 按双击加载；PDF.js Worker 与文档实例随视图生命周期创建和销毁。

Work Breakdown (≤1 day each):
1. 扩展 PDF 节点领域类型、默认值、句柄和资源打包契约。
2. 将 PDF 节点改为无 Card 的文稿页缩略体，并实现选中属性 label、上传替换和清理状态。
3. 用 PDF.js 实现按需文档加载、可见页 Canvas/Text Layer 渲染、连续滚动和页码/缩放悬浮控件，并将聚焦态设计为当前画布上的节点放大而非独立页面。
4. 实现文本选区工具条、文本锚点高亮、Agent 询问与批注节点创建。
5. 将关联文本节点作为右侧可编辑节点列表呈现，并保留普通 Flow 连线。
6. 接入所有创建入口和 Agent 基础节点契约。
7. 补充自动化测试、类型检查、构建、浏览器视觉验证与验证记录。

Verification Plan (by AC):
- AC1/AC3/AC4：组件/CSS 契约测试与浏览器视觉检查。
- AC2：存储引用收集与 PDF 节点上传代码路径测试。
- AC5/AC6：PDF.js Worker、Text Layer、Range 归一化和可见页生命周期测试。
- AC7：Store 文本节点创建、连接和右侧 Markdown 编辑契约测试。
- AC8：真实最小 PDF Blob 的项目包往返测试。
- AC9：默认值、句柄、Foundation 和 NodeFlow model 单测。
- AC10：`npm run typecheck`、全量测试、`npm run build`。

Rollback Points:
- 移除 `pdfjs-dist` 与聚焦视图即可回退为纯资源节点；存储层不受影响。
- PDF 节点缩略体和属性 rail 可独立回退，不影响数据契约。
- 项目包 `pdfInput: ["pdf"]` 是增量映射；移除后旧项目 JSON 中该节点会被类型边界拒绝，不影响其他媒体。
- PDF 高亮与批注关联仅存在节点/连线数据中，回退不会修改或损坏原始 PDF。
