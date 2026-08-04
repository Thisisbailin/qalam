# Mission Brief — Manus 连续流分页（Flow Pagination）

Objective:
- 按行业剧本软件（Final Draft 等）的通用方案处理稿纸分页：剧本是连续流，页只是按容量切分的视图；内容超出当前页容量时自动流到下一页，页内不滚动、不裁剪。
- 前一页未满时**不**自动回填：刻意分页（手动"从此行新建稿纸"/"新增稿纸"）必须保持；只有用户在后一页开头删除内容（手势合并），且前一页有回流空间时，后一页内容才回流到上一页。
- 正文不再被强制填充到固定行数，末尾空行可被清理；页边距收窄；胶卷视图整张稿纸自适应窗口高度完整显示。

Out-of-scope:
- 不做页内滚动条、不做纸张边界裁剪。
- 不合并整条序列的自动回填（无手势不回流）。
- 不改变 Fountain 文档格式、云同步协议或节点 schema。

Inputs / Outputs (contracts):
- Input: 连续稿纸序列（`scriptPage` 节点链）、容量模型（`SCREENPLAY_PAGE_LINE_COUNT` + `getLineCapacity`）、显式分页符（`===`）、手动分页标记（`pinnedBreak`）。
- Output: `reflowScreenplayPages`（纯函数重排）、`reflowConnectedScriptPages`（节点级重排，含手势合并选项）、编辑器重排触发、无滚动/裁剪样式、契约测试与文档。
- 重排方向：只下推（溢出流到下一页）；手势合并时把后一页开头内容并入前一页再重排。

Acceptance Criteria (AC):
- AC1: 内容超过一页容量后，溢出内容自动流入下一页（自动分页默认开启）。
- AC2: 前一页未满时，后一页内容不会自动回填；手动分页边界在重排后保持。
- AC3: 用户在后一页开头删除内容（页首行被删/清空）且前一页有空间时，后一页剩余内容回流；后一页变空则移除该页。
- AC4: 稿纸不出现页内滚动与边界裁剪（内容临时超出时纸张自适应高度，重排后回到容量页）。
- AC5: 胶卷视图整张稿纸按实际高度缩放完整适配窗口。
- AC6: 新增纯函数与节点级重排测试；`npm run typecheck`、`npm test`、`npm run build` 全部通过。

Constraints (perf/i18n/a11y/privacy):
- 不新增依赖；沿用 React、Framer Motion、Phosphor。
- 重排只在用户编辑后的空闲期（550ms）触发，且仅当结果变化时写回节点，避免无谓的同步噪声。
- 重排写回时保留 `manuscriptId`、`pageNumber`、位置与样式；新建节点补齐页间链与 manus 文件夹成员关系。
- 光标跟随内容流动：溢出时切到内容所在的下一页并把焦点带到对应行；手势合并时落到合并后的行。

Dependencies & Risks:
- 与自动保存的时序：重排（550ms）先于自动保存（650ms），确保手势检测读到编辑前的已提交正文。
- 重排会增删节点与页间链，属于正常数据变更；云同步按 projectData 状态整体收敛。
- 手动分页标记 `pinnedBreak` 存储于节点 data，不改变 schema 迁移。

Platform Differences via Platform Layer:
- 桌面/Web 共用渲染；触摸下重排触发同样走文本编辑后的空闲期。
