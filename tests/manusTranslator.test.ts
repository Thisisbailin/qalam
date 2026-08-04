import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("Manus translator exposes a header button and a two-card dock with icon-only controls", async () => {
  const root = process.cwd();
  const [chrome, writingPanel, dock, styles] = await Promise.all([
    readFile(path.join(root, "node-workspace/components/screenplay/ScreenplayChrome.tsx"), "utf8"),
    readFile(path.join(root, "node-workspace/components/WritingPanel.tsx"), "utf8"),
    readFile(path.join(root, "node-workspace/components/TranslatorDock.tsx"), "utf8"),
    readFile(path.join(root, "node-workspace/styles/screenplay.css"), "utf8"),
  ]);

  assert.match(chrome, /isTranslatorOpen\?: boolean/);
  assert.match(chrome, /onToggleTranslator\?: \(\) => void/);
  assert.match(chrome, /title="翻译器"[\s\S]*aria-label="打开翻译器"/);
  assert.match(chrome, /<Translate size=\{18\} \/>/);

  assert.match(writingPanel, /import \{ TranslatorDock \} from "\.\/TranslatorDock"/);
  assert.match(writingPanel, /isTranslatorOpen && !isFocusMode \? "is-translator-open" : ""/);
  assert.match(writingPanel, /--screenplay-translator-inset/);
  assert.match(writingPanel, /<TranslatorDock onClose=\{onCloseTranslator\} \/>/);
  assert.match(writingPanel, /if \(!isInspectorOpen\) onCloseTranslator\?\.\(\)/);
  assert.match(writingPanel, /if \(!isFocusMode\) onCloseTranslator\?\.\(\)/);

  assert.match(dock, /translator-dock__card is-output/);
  assert.match(dock, /translator-dock__card is-input/);
  assert.match(dock, /translator-dock__controls/);
  assert.match(dock, /TRANSLATOR_MODEL_LABEL/);
  assert.match(dock, /选择输入语种/);
  assert.match(dock, /选择输出语种/);
  assert.match(dock, /切换推理强度/);
  assert.match(dock, /自定义系统提示词/);
  assert.match(dock, /TRANSLATOR_DEFAULT_SYSTEM_PROMPT/);
  assert.match(dock, /恢复默认/);
  assert.match(dock, /仅当前会话生效/);
  assert.match(dock, /maxLength=\{TRANSLATOR_MAX_INPUT_LENGTH\}/);
  assert.match(dock, /【译注】/);

  assert.match(styles, /\.translator-dock \{[\s\S]*position: fixed;[\s\S]*right: 16px/);
  assert.match(styles, /\.screenplay-workspace\.is-translator-open/);
  assert.match(styles, /--screenplay-translator-inset: 0px/);
  assert.match(styles, /padding-right: var\(--screenplay-translator-inset, 0px\)/);
});

test("Manus translator service is a single stateless POST with a fixed model", async () => {
  const root = process.cwd();
  const [service, endpoint, constants] = await Promise.all([
    readFile(path.join(root, "services/translatorService.ts"), "utf8"),
    readFile(path.join(root, "functions/api/translate.ts"), "utf8"),
    readFile(path.join(root, "constants.ts"), "utf8"),
  ]);

  assert.match(service, /buildApiUrl\("\/api\/translate"\)/);
  assert.match(service, /fetchAuthorized/);
  assert.match(service, /translateModel = DEEPSEEK_DEFAULT_MODEL/);
  assert.match(service, /TRANSLATOR_MAX_INPUT_LENGTH = 500/);
  assert.match(service, /export type TranslateRequest = \{[\s\S]*systemPrompt\?: string/);
  // 系统提示词不作为持久化偏好的一部分，避免换端后依赖本地状态。
  const prefsType = service.match(/export type TranslatorPreferences = \{([\s\S]*?)\n\};/);
  assert.ok(prefsType, "TranslatorPreferences type exists");
  assert.doesNotMatch(prefsType[1], /systemPrompt/);
  assert.match(service, /TRANSLATOR_DEFAULT_SYSTEM_PROMPT = `[\s\S]*【译注】/);
  assert.match(service, /剧本写作|对白译文/);
  assert.doesNotMatch(service, /session|history|conversation/i);
  assert.match(constants, /DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash'/);

  assert.match(endpoint, /DEEPSEEK_DEFAULT_MODEL/);
  assert.match(endpoint, /enforceRateLimit/);
  assert.match(endpoint, /namespace: "translate"/);
  assert.match(endpoint, /reasoning_effort: body\.reasoningEffort/);
  assert.match(endpoint, /chat\/completions/);
  assert.match(endpoint, /MAX_TEXT_LENGTH = 500/);
  assert.doesNotMatch(endpoint, /只输出译文本身/);
  assert.doesNotMatch(endpoint, /D1EdgeSession|runStyloAgentCore|sessionStore/);
  assert.match(endpoint, /思考模式（v4 默认开启）下 temperature\/top_p 等采样参数不生效，故不发送/);
});

test("Manus translator mutual exclusion with adaptive-width factors", async () => {
  const root = process.cwd();
  const workspace = await readFile(
    path.join(root, "node-workspace/components/CreativeWorkspace.tsx"),
    "utf8"
  );

  assert.match(workspace, /const \[isTranslatorOpen, setIsTranslatorOpen\] = useState\(false\)/);
  assert.match(workspace, /翻译器打开时，agent 面板保持收起/);
  assert.match(workspace, /agent 面板被唤起（自适应宽度因素出现）时，翻译器自动收起/);
  assert.match(workspace, /if \(!collapsed\) setIsTranslatorOpen\(false\)/);
  assert.match(workspace, /isTranslatorOpen=\{isTranslatorOpen\}/);
  assert.match(workspace, /onToggleTranslator=\{toggleTranslator\}/);
  assert.match(workspace, /onCloseTranslator=\{\(\) => setIsTranslatorOpen\(false\)\}/);
});
