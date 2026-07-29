# Mission Brief — PDF 输入节点与阅读标注

Objective:
- 在输入节点中新增 `pdfInput`，与图片、音频、视频一起作为项目媒体资源保存。
- PDF 节点支持上传、替换、清除与双击打开。
- 画布节点以无 Card 外壳的 PDF 文稿页缩略体显示，不解析首页；单击显示侧边属性 label。
- 双击后在原画布语境中聚焦显示 PDF 文稿页与关联文本节点，控件悬浮呈现。
- 提供基于 PDF 真实文本层的选择、复制、高亮、询问和批注。
- PDF 节点接受文本连接；连接的文本节点作为该 PDF 的 Markdown 批注列表显示。

Out-of-scope:
- 不修改 PDF 原文件内容，不把高亮写回 PDF 二进制。
- 不实现 OCR、全文检索、批注协作冲突合并或高级 PDF 编辑。
- PDF 原文只读，不提供语义错误的“剪切”操作。
- 画布缩略节点不渲染 PDF 首页。

Inputs / Outputs (contracts):
- 输入：`application/pdf` 文件或 PDF URL。
- 节点数据：`pdf`、`filename`、`mimeType`、`storageBucket`、`storagePath`、`fileSize`、`highlights`。
- 高亮数据：页码、引用文本、文本范围、逐行归一化选区矩形、颜色、关联批注节点 ID 与创建时间。
- 连接：文本节点 `text` 输出连接到 PDF 节点 `text` 输入。
- 项目包：PDF 二进制以 `media` 资源打包，导入后恢复为可阅读数据 URL。

Acceptance Criteria (AC):
- AC1：节点创建菜单和操作栏均可创建 PDF 输入节点。
- AC2：PDF 文件可上传至当前项目私有资源；替换和清除会更新节点数据。
- AC3：PDF 节点无通用 Card 外壳，以固定 PDF 文稿页比例显示名称；单击显示可编辑属性 label。
- AC4：双击已载入 PDF 的节点进入画布聚焦阅读；原画布底纹与空间语境保持可见，PDF 文稿页像节点在同一画布上放大展开，可连续滚动、定位页码、缩放和关闭。
- AC5：仅打开的 PDF 动态加载 PDF.js；Worker 解析且页面 Canvas/Text Layer 按可见性挂载。
- AC6：选择真实 PDF 文本后显示复制、高亮、询问和批注工具；高亮绑定所在页并随滚动、缩放保持对齐。
- AC7：批注操作创建一个文本节点与 `text -> pdfInput` 连线；聚焦视图右侧按节点列表滚动显示和编辑 Markdown。
- AC8：项目包导出/导入可完整往返 PDF 媒体、文本高亮和批注连接数据。
- AC9：节点类型、数据默认值、连接句柄、Foundation 媒体归类、Agent 基础节点契约保持一致。
- AC10：类型检查、测试和生产构建通过。

Constraints (perf/i18n/a11y/privacy):
- 单个 PDF 不超过 64 MB，与项目包单资源上限一致。
- PDF 使用项目私有存储；签名 URL 按项目范围刷新。
- 阅读器支持键盘关闭、按钮可访问名称和减少动态效果。
- PDF.js 与 Worker 只随聚焦视图加载；页面渲染按可见性控制，关闭时销毁文档任务。
- 高亮由真实文本 Range 产生，保存页内归一化逐行矩形与文本锚点，缩放时重投影。

Dependencies & Risks:
- 新增本地 `pdfjs-dist`，使用独立 Worker；主库和 Worker 必须保持同一锁定版本。
- 扫描型 PDF 没有文本层时仍可阅读，但不能选择文字；不静默伪造 OCR 结果。
- 高亮为项目侧文本锚点与视觉层，不写入 PDF 文件。
- 私有存储不可用时显示明确上传错误，不悄悄丢失到云端同步之外。

Platform Differences via Platform Layer:
- Web 与 Electron 共用 PDF.js Canvas/Text Layer/Worker 渲染路径。
- 不新增平台特有 API；文件选择和私有存储继续沿用现有媒体节点通道。
