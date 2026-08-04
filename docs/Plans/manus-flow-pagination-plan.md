# Plan — Manus 连续流分页（Flow Pagination）

Architecture Intent Block:
- 稿纸序列 = 连续 Fountain 流的容量视图：每页正文只存真实内容，页边界由容量模型动态决定。
- 自动分页（默认开启）只做"下推"：溢出内容流到下一页；显式 `===` 与手动分页（`pinnedBreak`）是硬边界。
- 回流是显式手势：用户在后一页开头删除（`didDeletePageStart`），且上一页有空间，才把该页剩余内容并入上一页并重排。

## 一、纯函数重排（manusPages.ts）

`reflowScreenplayPages(pages, capacity)`：
- 逐页按容量拆分；每页内容留在本页，只有溢出部分作为 `pending` 流入下一页。
- `===` 显式分页符：结束当前页，后续内容从新页开始（`pinned=true`）。
- 手动分页页（`pinned`）：先落掉上一页遗留的溢出页，再独立处理本页，硬边界不被跨过。
- 空页合并；末尾空行不保留；至少保留一页。

`reflowConnectedScriptPages(projectData, anchorNodeId, options)`：
- 从锚点页（含前一页）开始重排尾序列，写回节点；页数减少时删除尾部节点并重建页间链，增加时新建节点（补齐位置、`manuscriptId`、`pageNumber`、manus 文件夹成员关系）。
- `options.mergeNextPageId`：手势合并——把该页开头删除后的剩余内容并入上一页（溶解硬边界）再重排。
- 返回 `{ projectData, changed, contentNodeIds, chunkBodies, cursor }`，光标映射到重排后内容所在的页与行。

## 二、编辑器触发（WritingPanel.tsx）

- 编辑器 `onChange` 标记 `userEditedRef`；切换页/首次打开不触发重排。
- 空闲 550ms 后执行 `reflowCurrentPage`：
  - 用 `didDeletePageStart(已提交正文, 当前正文)` 判断是否页首删除手势；是则带 `mergeNextPageId` 重排，否则普通下推重排。
  - 结果无变化则不写回；有变化则 `setProjectData` + 更新本地草稿/光标，必要时切到内容所在页并聚焦对应行，最后经 `onCommitScriptDocument` 持久化并同步 LookBook 身份。
- 自动分页开关控制是否重排（默认开启）；手动"从此行新建稿纸"/"新增稿纸"传 `pinned=true`。

## 三、样式（screenplay.css）

- 稿纸 `height: auto; min-height: 1056px`；`.screenplay-document__body` 与 `.screenplay-block-editor` `overflow: visible`——无页内滚动、无裁剪；内容临时超出时纸张自适应高度，重排后回到容量页。
- 页边距收窄（编辑区 `64/56px`、页眉 `64/56px`）。
- 胶卷视图按实际纸张高度缩放（`--screenplay-filmstrip-paper-height` + `--screenplay-filmstrip-scale`），整张稿纸完整适配窗口。

## 四、验证

- 纯函数测试：溢出下推、不满不回填、`===` 硬边界、pinned 保持、空页合并、手势合并、节点增删与链重建。
- 契约测试：编辑器触发、`pinned` 传递、样式无滚动/裁剪。
- 全量 `npm run typecheck` / `npm test` / `npm run build` / `git diff --check`。

## 五、回滚

- 重排逻辑集中在 `manusPages.ts` 两个函数；关闭自动分页即退化为纯手动分页。
- `pinnedBreak` 为新增可选 data 字段，不影响旧数据读取；样式改动可独立回退。
