# Plan — Manus 翻译器（Translator Dock）

Architecture Intent Block:
- 把翻译器做成 Manus 稿纸的轻量侧栏工具：稿纸左侧自适应收缩、翻译器右侧停靠，与 agent dock 的“inset + 稿纸收缩”模式同源但更薄。
- 服务侧不走 agent 运行时（不建 session、不读 D1 会话、不注入工具/技能/项目快照），新增一个无状态 `POST /api/translate`，服务端用 env 里的 `DEEPSEEK_API_KEY` 直接调 DeepSeek chat，单次请求、无记忆。
- 模型锁定 `DEEPSEEK_DEFAULT_MODEL`（`deepseek-v4-flash`），常量单一来源，客户端与服务端共用同一 import。
- 互斥由 `CreativeWorkspace` 单一状态源协调：翻译器打开时收起 agent；agent 打开 / inspector 展开 / 进入专注模式时翻译器自动收起。
- 已核对 DeepSeek 官方 API 文档：chat completions 端点接受 `reasoning_effort`，`deepseek-v4-flash` 支持 `low / high / max` 三档（默认 `high`）；思考模式下 `temperature`/`top_p`/`presence_penalty`/`frequency_penalty` 不生效，请求体不发送。

## 一、UI 结构

### 1. 入口按钮（ScreenplayHeader）
- 在稿纸右侧垂直菜单（`.screenplay-header__actions`）新增一个按钮，位于“Manus 信息”之后：
  - 图标：`Translate`（Phosphor），`title`/`aria-label`：“翻译器”。
  - 激活态沿用 `is-active`（与现有按钮一致），表示面板已打开。
- `ScreenplayHeaderProps` 新增 `isTranslatorOpen: boolean` 与 `onToggleTranslator: () => void`，由 `WritingPanel` 透传。

### 2. TranslatorDock 组件（新文件 `node-workspace/components/TranslatorDock.tsx`）
渲染在 `.screenplay-layout` 内，作为第三个 grid 列（与 inspector 互斥，实际同一时刻至多出现一个 `auto` 列）：

```
┌──────────────────────────────┬──────────────┐
│ 稿纸（1fr，自适应收缩）        │ 安全间距 16px │
│                              │ ┌──────────┐ │
│                              │ │ 输出卡片   │ │  ← 上方：结果区 + 复制/清空
│                              │ └──────────┘ │
│                              │ ┌──────────┐ │
│                              │ │ 输入卡片   │ │  ← 下方：textarea + 翻译按钮
│                              │ │ 纯图标label │ │  ← 底部：语种/模型/推理/系统提示
│                              │ └──────────┘ │
│                              │ 安全间距 16px │
└──────────────────────────────┴──────────────┘
```

- 宽度：`clamp(320px, 28vw, 400px)`，左右安全间距均为 16px（与 `StyloAgent.dockInset` 一致）；上下 16px。
- 上方卡片 = 输出：占约 40% 高度，滚动结果区；头部含“输出”小标题、复制按钮、清空按钮。
- 下方卡片 = 输入：弹性 textarea（Enter 提交 / Shift+Enter 换行），头部含“输入”小标题、语种互换按钮、翻译提交按钮；底部为控制行。
- 空态 / 错误态：未翻译时显示浅灰占位“译文将显示在这里”；请求失败显示错误与重试，不清空输入。
- 交互反馈：提交后立即进入 in-flight 状态（提交按钮转圈、输出区顶部细进度条）；支持 `AbortController` 取消；流式输出作为 Phase 2（复用现有 SSE 读取模式），v1 先整段返回保证稳定。

### 3. 输入卡片底部的纯图标 label 行
一行五个控制点，均为图标（悬停/焦点显示 `title`；激活态可区分）：

| 控制点 | 图标 | 交互 | 说明 |
| --- | --- | --- | --- |
| 输入语种 | `Translate` | 点击弹出紧凑语种列表 | 默认“自动检测” |
| 输出语种 | `ArrowsLeftRight` | 点击弹出紧凑语种列表 | 默认“中文” |
| 模型名称 | `Cpu` | 静态展示，不可点 | label 右侧显示文本 `DeepSeek Flash`，tooltip：默认模型，不可更换 |
| 推理强度 | `Gauge` | 点击循环 low → high → max | 图标旁用小点/短条显示当前档位 |
| 系统提示词 | `NotePencil` | 点击展开内联小编辑区 | 默认内置固定剧本翻译提示词；可临时自定义覆盖、一键恢复默认 |

- 语种候选：`auto / zh / en / ja / ko / fr / de / es / pt / ru / ar / hi`，弹层内列出名称与本地化标签。
- 弹层统一为紧凑浮层（复用现有 `screenplay-*` 面板语言），点击外部关闭、Esc 关闭、键盘可遍历。
- 偏好（语种、推理强度）经 `usePersistedState` 本地持久化；系统提示词为会话内状态（默认内置版本，临时自定义不持久化），输入文本不持久化。
- 输入文本限制 500 字以内（客户端 `maxLength` 与服务端校验一致）；译文输出后附带【译注】语言学说明，输出卡片将译文与译注分区展示。

## 二、布局与自适应

- `.screenplay-layout` 在翻译器打开时保持 `grid-template-columns: minmax(0, 1fr) auto`（inspector 与翻译器互斥，不出现双 `auto` 列）；翻译器列内自带 16px padding，形成左右安全间距。
- 稿纸列 `1fr` 自然收缩；`.screenplay-document-stage` 的中心宽度计算沿用 `--screenplay-agent-inset` 体系，新增 `--screenplay-translator-inset` 参与宽度计算，保证稿纸始终有可读宽度。
- 新增 `.screenplay-workspace.is-translator-open` 修饰类，与 `.is-agent-open`、`.is-inspector-open` 并列；对应调整稿纸 stage 的 padding/宽度。
- 最小稿纸宽度保护：`translatorWidth + paperMinWidth + 2 × safeInset > viewport` 时自动收起翻译器（AC6）。
- 翻译过程中不重渲染稿纸：`TranslatorDock` 内部持有自己的文本/状态，稿纸与翻译器仅通过 props 交换开关与宽度。

## 三、服务端（轻量无状态 chat 端点）

新文件 `functions/api/translate.ts`，模式对齐 `qwen-models.ts` / `agent.ts` 的鉴权与限流：

1. `onRequestOptions`：CORS 预检（与现有端点一致）。
2. `onRequestPost`：
   - `getUserId(context.request, context.env)` 鉴权；
   - `enforceRateLimit({ namespace: "translate", limit: 20, windowSeconds: 60 })`；
   - 校验并规范化请求体：`text` ≤ 500 字符（剧本写作通常为词/句/短片段）、`sourceLang/targetLang` 在白名单、`reasoningEffort ∈ {low,high,max}`、`systemPrompt` ≤ 2000 字符（可空）；
   - 解析 `DEEPSEEK_API_KEY`（env，缺失时返回 500 中文提示）；
   - 请求 `${DEEPSEEK_RESPONSES_BASE_URL}/chat/completions`（官方 OpenAI 兼容端点）：
     ```json
     {
       "model": "deepseek-v4-flash",
       "messages": [
         { "role": "system", "content": "<内置默认或用户临时自定义 systemPrompt；仅当非空时存在>" },
         { "role": "user", "content": "将以下内容从<源语言>翻译成<目标语言>：\n\n<text>" }
       ],
       "stream": false
     }
     ```
   - 模型固定取 `DEEPSEEK_DEFAULT_MODEL`（从 `constants.ts` import），不接受客户端覆盖；`reasoning_effort` 直接透传（flash 官方支持 `low/high/max`，默认 `high`）；思考模式下 `temperature`/`top_p` 等采样参数不生效，故不发送。
   - 成功返回 `{ text, usage }`（usage 映射复用 `mapUsage` 思路）；失败透传简短错误。
- 无记忆不变量：端点内不创建任何 session、不读写会话表、不携带历史消息数组；每次调用只发送当前文本与用户自定义 systemPrompt。
- 不走 `fetchViaProxy`：密钥只在服务端，浏览器端由 `fetchAuthorized` 直连 `/api/translate`。

## 四、客户端服务封装

新文件 `services/translatorService.ts`：

```ts
export type TranslatorLang = "auto" | "zh" | "en" | "ja" | "ko" | "fr" | "de" | "es" | "pt" | "ru" | "ar" | "hi";
export type ReasoningEffort = "low" | "medium" | "high";

export type TranslateRequest = {
  text: string;
  sourceLang: TranslatorLang;
  targetLang: TranslatorLang;
  reasoningEffort: ReasoningEffort;
  systemPrompt?: string;
};

export type TranslateResponse = { text: string; usage?: { promptTokens: number; responseTokens: number; totalTokens: number } };

export const translateText = (request: TranslateRequest, signal?: AbortSignal): Promise<TranslateResponse>;
```

- 实现：`fetchAuthorized(buildApiUrl("/api/translate"), { method: "POST", body: JSON.stringify(request), signal })`，解析 `{ text, usage }`，错误归一化为可读中文。
- 无任何客户端缓存/历史；`AbortSignal` 支持取消。

## 五、状态协调（互斥收起）

`CreativeWorkspace` 是唯一状态源：

```ts
const [isTranslatorOpen, setIsTranslatorOpen] = useState(false);
const [translatorWidth, setTranslatorWidth] = useState(0);
```

- 翻译器打开（`openTranslator`）：`setIsTranslatorOpen(true)` + `setStyloCloseRequest(c => c + 1)`（收起 agent）。
- agent 打开（`styloOpenRequest` 增加、`isStyloCollapsed` 变 false、`onOpenStylo` 触发、`toggleStyloFirstMode` 开启）：effect 里 `setIsTranslatorOpen(false)`。
- inspector 展开 / 进入专注模式：`WritingPanel` 在 `onToggleInspector` / `onToggleFocus` 中，若目标为“展开”则调用 `onCloseTranslator`。
- 项目切换 / 重置（`styloProjectId`、`projectResetToken` 变化）：关闭翻译器。
- 最小稿纸宽度保护触发时：关闭翻译器。
- `ManusPanel` / `WritingPanel` 新增 props：`isTranslatorOpen`、`translatorWidth`、`onToggleTranslator`、`onCloseTranslator`；稿纸宽度收缩沿用 `agentDockWidth` 同款 inset 传递。

## 六、文件清单

| 文件 | 变更 |
| --- | --- |
| `node-workspace/components/screenplay/ScreenplayChrome.tsx` | 新增翻译器按钮与两个 header props |
| `node-workspace/components/TranslatorDock.tsx` | 新增：两段式翻译器 UI + 控制行 |
| `node-workspace/components/WritingPanel.tsx` | 接入 dock、inspector/专注模式互斥收起、inset 透传 |
| `node-workspace/components/CreativeWorkspace.tsx` | 翻译器状态源、与 agent 互斥、宽度协调 |
| `node-workspace/styles/screenplay.css` | `.is-translator-open`、dock 布局与安全间距、控制行样式 |
| `services/translatorService.ts` | 新增客户端封装 |
| `functions/api/translate.ts` | 新增无状态 chat 端点 |
| `tests/manusTranslator.test.ts` | 新增契约测试 |
| `docs/Plans/manus-translator-brief.md` / `-plan.md` | 本设计 |

## 七、验证计划

- 契约测试 `tests/manusTranslator.test.ts`（沿用现有源码断言风格）：
  - `ScreenplayChrome` 含翻译器按钮（`Translate` + aria-label）。
  - `WritingPanel` 渲染 `TranslatorDock`，且 inspector/专注模式展开时关闭翻译器。
  - `CreativeWorkspace` 存在 agent 打开 → 翻译器关闭、翻译器打开 → agent 收起的互斥逻辑。
  - `translatorService` 只向 `/api/translate` 发送单次 POST，不携带历史/session。
  - `functions/api/translate.ts` 使用 `DEEPSEEK_DEFAULT_MODEL` 常量、不 import session 存储、含 `enforceRateLimit`。
  - CSS 含 `.translator-dock` 安全间距与 `.is-translator-open`。
- 全量：`npm run typecheck`、`npm test`、`npm run build`、`git diff --check`。
- 本地视觉验收：Web 与 Electron 渲染器上打开/收起翻译器、与 agent 互斥切换、窄窗口自动收起。

## 八、回滚点

- 翻译器为独立组件 + 独立端点：移除按钮、`TranslatorDock` 与 `/api/translate` 即可完整回退，不动稿纸编辑器、agent 面板、inspector 与任何数据 schema。
- 偏好本地持久化使用独立 localStorage key，删除后无残留影响。
