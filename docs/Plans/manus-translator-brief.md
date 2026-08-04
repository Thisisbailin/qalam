# Mission Brief — Manus 翻译器（Translator Dock）

Objective:
- 在 Manus 稿纸右侧垂直菜单（`ScreenplayHeader`）新增一个翻译器入口，点击后稿纸自适应收缩到左侧，两段式翻译器停靠右侧。
- 翻译器采用“上方输出卡片 + 下方输入卡片”的极简结构；输入卡片底部以纯图标 label 提供输入语种、输出语种、模型名称、推理强度、系统提示词五个控制点。
- 翻译服务固定使用 agent 模块的默认模型 `deepseek-v4-flash`（`DEEPSEEK_DEFAULT_MODEL`，不可更换），但**不走 agent 运行时**（无会话、无工具、无项目快照、无记忆），通过一个轻量无状态 chat 端点直达 DeepSeek。
- 翻译器与其它“自适应宽度因素”互斥：agent 面板唤起、Manus 信息（inspector）展开、专注模式进入等任一因素出现时，翻译器自动收起。

Out-of-scope:
- 不引入新模型选项、不接入 agent 的会话/记忆/工具体系。
- 系统提示词为内置固定版本（详细剧本翻译提示词，要求译文后附【译注】语言学说明）；用户可临时自定义覆盖，仅当前会话生效，不跨端持久化，可一键恢复默认。
- 不改变现有稿纸编辑器、agent 面板、inspector 的既有行为。
- 不做云同步/跨设备翻译历史。

Inputs / Outputs (contracts):
- Input: 稿纸右侧菜单（`ScreenplayHeader`）、稿纸布局（`.screenplay-layout`）、`CreativeWorkspace` 的 agent dock 宽度协调、`DEEPSEEK_DEFAULT_MODEL` / `DEEPSEEK_RESPONSES_BASE_URL` 常量、`DEEPSEEK_API_KEY`（服务端 env）。
- Output: 翻译器按钮、`TranslatorDock` 组件、`/api/translate` 无状态端点、客户端 `translatorService`、互斥收起规则、契约测试与文档。
- `POST /api/translate` 请求体：`{ text, sourceLang, targetLang, reasoningEffort, systemPrompt? }`；响应：`{ text, usage? }`。单次请求只包含当前文本与用户自定义 systemPrompt，不携带任何历史。

Acceptance Criteria (AC):
- AC1: 稿纸右侧菜单出现翻译器按钮（纯图标 + 可访问 label）；点击后面板打开，稿纸保持在左侧并自适应收缩，翻译器停靠右侧，两侧保持安全间距。
- AC2: 翻译器内上方为输出卡片、下方为输入卡片；输入卡片底部为纯图标 label 行，覆盖输入语种、输出语种、模型名称（静态展示 DeepSeek Flash）、推理强度、系统提示词五个控制点。
- AC3: 系统提示词默认内置固定版本（剧本翻译 + 语言学译注要求）；用户可临时自定义覆盖并一键恢复默认；自定义内容只用于当前会话与单次请求，不写入持久化偏好。
- AC3b: 输入文本限制 500 字以内（客户端 maxLength 与服务端校验一致）；译文输出后附带【译注】语言学说明。
- AC4: 翻译请求固定使用 `DEEPSEEK_DEFAULT_MODEL`，界面不可更换模型；请求经轻量端点直达 DeepSeek chat，不创建会话、不读历史、不携带项目快照。
- AC5: agent 面板唤起、inspector 展开或进入专注模式时，翻译器自动收起；翻译器打开时 agent 面板自动收起。
- AC6: 稿纸宽度过窄（低于可用下限）时翻译器自动收起，保证稿纸可读性优先。
- AC7: 新增契约测试覆盖按钮存在性、互斥收起、无状态请求契约与固定模型；`npm run typecheck`、`npm test`、`npm run build` 全部通过。

Constraints (perf/i18n/a11y/privacy):
- 不新增依赖；继续使用 React、Tailwind v4、Framer Motion 与 Phosphor 图标。
- 翻译状态隔离在 `TranslatorDock` 内部，翻译过程中不触发稿纸重渲染。
- 语种/推理强度偏好可本地持久化；系统提示词与输入文本、历史一律不持久化，切换客户端后始终回到内置默认提示词。
- 按钮与弹层提供 `aria-label`、焦点管理与 Esc 关闭；纯图标控制必须带 `title`。
- 服务端沿用 `getUserId` 鉴权与 `enforceRateLimit`，防止滥用。

Dependencies & Risks:
- 已核对 DeepSeek 官方 API 文档：`deepseek-v4-flash` 通过 OpenAI 兼容 chat completions 支持 `reasoning_effort`（`low / high / max` 三档，默认 `high`）；思考模式（v4 默认开启）下 `temperature`/`top_p` 等采样参数被忽略，故请求体不发送这些参数。
- `DEEPSEEK_API_KEY` 仅存在于服务端 env；浏览器端不接触密钥。
- 翻译器与 agent 面板共用“右 dock + 稿纸收缩”的空间，互斥规则必须由 `CreativeWorkspace` 单一状态源保证，避免两侧同时展开。

Platform Differences via Platform Layer:
- 桌面与 Web 共用同一渲染；触屏下纯图标控件保留 `title`/长按提示，弹层点击外部即关闭。
