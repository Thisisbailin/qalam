# Verify — PDF Input Reader And Notes

Date: 2026-07-29

AC -> Evidence Mapping:
- AC1：`pdfInput` 已接入节点类型、默认值、尺寸、Foundation 媒体分类、创建菜单、操作栏与 Agent 节点契约；PDF 专项测试覆盖默认值、句柄和媒体归类。
- AC2：`PdfInputNode` 仅接受 64 MB 以内 PDF，沿用当前项目私有存储、签名 URL、替换和清除生命周期。
- AC3：节点视觉为固定 PDF 文稿页比例且不解析首页；BaseNode 仅保留连接语义，通用 Card 表头与壳层隐藏；选中后显示可编辑 label 属性面板。
- AC4：双击入口按节点 ID 打开聚焦层；聚焦层保持半透明并保留当前 Canvas 底纹，PDF 文稿页、关联文本节点和悬浮控制仍表现为同一画布上的放大对象。
- AC5：`PdfReaderOverlay` 通过 `React.lazy` 动态加载；PDF.js 使用独立 Worker、Canvas 与 Text Layer，并通过 IntersectionObserver 只渲染可见/预加载页。
- AC6：真实 Text Layer Range 生成逐行页内归一化矩形和文本锚点；选区工具提供复制、颜色、高亮、询问和批注，没有只读 PDF 不成立的剪切操作。
- AC7：批注调用 Store 的 `addNode("text")` 与 `connectNodes`，在右侧以可滚动、可编辑的真实 Markdown 文本节点显示。
- AC8：项目包往返测试恢复 PDF 二进制、高亮文本数据、批注节点和 `text -> pdfInput` 连接。
- AC9：Schema 验证文本范围、引用、批注节点 ID 和归一化矩形；旧版单矩形高亮仍可显示。
- AC10：PDF 专项编译与测试、生产构建及浏览器交互验证通过；当前脏工作区的全仓 TypeScript/测试门禁另有与 PDF 无关的失败，见下方记录。

Verification Results:
- `./node_modules/.bin/tsc --project tsconfig.tests.json --noEmitOnError false --pretty false`：通过。
- PDF 专项测试：5/5 通过。
- `npm test`：PDF 5 项全部通过；全量 202/203，通过项中包含 PDF。唯一失败为正在修改的 `wrapperProjection` 剧本包装器测试，与 PDF 路径无关。
- `npm run typecheck`：当前工作区未通过；错误集中在现有 GitHub/API 返回值的 `unknown` 类型、Storage API 返回值、Flow 边选择的 `ReadonlySet` 等非 PDF 文件；PDF 新增文件没有报错。
- `npm run build`：通过。`PdfReaderOverlay` 13.61 kB，PDF vendor 432.83 kB，Worker 1,262.40 kB；PDF 代码保持独立懒加载 chunk。
- `git diff --check`（PDF 变更范围）：通过。
- Poppler 检查：生成并渲染 2 页 A4 可选文本 PDF，页面输出正常。

Browser Interaction Evidence:
- PDF.js 成功渲染 2/2 页，浏览器日志无 error/warn。
- 聚焦层下可见 Canvas 点阵底纹；右侧批注区域无整栏背景，关联文本以单独悬浮节点呈现。
- 文本 Range 建立后出现复制、三种颜色、高亮、询问和新增批注命令。
- 创建高亮后高亮计数由 1 增至 2。
- 页面滚动 320 px 前后，高亮相对页面顶部偏移均为 `198.296875 px`。
- 缩放到 110% 后，页面高度与高亮偏移同步扩大，高亮相对偏移为 `218.03125 px`。
- 新增批注后，右侧文本节点由 1 增至 2，高亮由 2 增至 3；新节点内容为所选 PDF 原文的 Markdown 引用。
- 已有批注文本可直接在右侧 textarea 编辑。

Known Non-blocking Observations:
- 扫描型 PDF 没有文本层时可以阅读，但不提供伪 OCR 选区。
- 高亮与批注保存在项目数据和 Flow 节点中，不改写 PDF 二进制。
- Vite 仍报告仓库既有的超 500 kB chunk 警告；PDF vendor 自身低于该阈值。
- `npm install` 报告当前依赖树有 14 个 audit 项，未执行可能引入破坏性升级的自动修复。

Build Matrix:
- Web production bundle：通过。
- macOS Electron renderer：复用同一 Chromium/Vite/PDF.js 路径，生产构建通过。
- 浏览器端：不依赖 Electron API，PDF.js Worker/Canvas/Text Layer 本地实测通过。

# Evidence Block
- Motivation：把 PDF 作为一等项目资源，同时保持 Flow Canvas 的单一空间模型。
- Impact：NodeFlow 类型/Schema、私有媒体生命周期、项目包、PDF 页面节点、聚焦阅读层、文本高亮、Agent 询问与 Markdown 批注连接。
- Plan：缩略节点不解析首页；双击懒加载 PDF.js；真实 Text Layer Range 生成高亮和真实文本节点。
- Verify：PDF 专项 5/5、生产构建、项目包往返、Poppler 页面渲染和浏览器交互证据均通过。
- Rollback：移除 PDF.js 依赖和聚焦视图即可退回纯资源节点；PDF 二进制及其他媒体路径不会被改写。
