import { DEEPSEEK_DEFAULT_MODEL } from "../constants";
import { buildApiUrl, fetchAuthorized } from "../utils/api";

export type TranslatorLang =
  | "auto"
  | "zh"
  | "en"
  | "ja"
  | "ko"
  | "fr"
  | "de"
  | "es"
  | "pt"
  | "ru"
  | "ar"
  | "hi";

/**
 * DeepSeek v4-flash 支持三档推理强度（官方 API：low / high / max，
 * 默认 high）。low/medium 兼容映射 high、xhigh 映射 max 由服务端处理，
 * 客户端只暴露 flash 真实支持的三档。
 */
export type ReasoningEffort = "low" | "high" | "max";

export type TranslatorPreferences = {
  sourceLang: TranslatorLang;
  targetLang: TranslatorLang;
  reasoningEffort: ReasoningEffort;
};

export type TranslateRequest = {
  text: string;
  sourceLang: TranslatorLang;
  targetLang: TranslatorLang;
  reasoningEffort: ReasoningEffort;
  systemPrompt?: string;
};

export type TranslateResponse = {
  text: string;
  usage?: {
    promptTokens: number;
    responseTokens: number;
    totalTokens: number;
  };
};

export const TRANSLATOR_LANGS: ReadonlyArray<{ value: TranslatorLang; label: string }> = [
  { value: "auto", label: "自动检测" },
  { value: "zh", label: "中文" },
  { value: "en", label: "英语" },
  { value: "ja", label: "日语" },
  { value: "ko", label: "韩语" },
  { value: "fr", label: "法语" },
  { value: "de", label: "德语" },
  { value: "es", label: "西班牙语" },
  { value: "pt", label: "葡萄牙语" },
  { value: "ru", label: "俄语" },
  { value: "ar", label: "阿拉伯语" },
  { value: "hi", label: "印地语" },
];

export const TRANSLATOR_REASONING_EFFORTS: ReadonlyArray<{ value: ReasoningEffort; label: string }> = [
  { value: "low", label: "低" },
  { value: "high", label: "标准" },
  { value: "max", label: "深度" },
];

export const TRANSLATOR_MODEL_LABEL = "DeepSeek Flash";

/**
 * 内置固定系统提示词：所有客户端共用同一份默认值，不随本地偏好丢失。
 * 用户在翻译器内可临时自定义（仅当前会话生效），或清空、恢复默认。
 * 要求模型在译文之后附带【译注】：说明关键翻译决策与语言学依据。
 */
export const TRANSLATOR_DEFAULT_SYSTEM_PROMPT = `你是专业的影视剧本翻译助手，服务于剧本写作过程中的即时翻译。用户输入的内容通常是剧本写作中的词语、台词或短片段，一般不超过 500 字。

翻译原则：
1. 准确传达原文含义，不增删信息；人名、地名与专有名词保持与剧本上下文一致的译法。
2. 对白译文必须口语化，贴合人物语气与身份，读起来像演员能自然说出的台词，避免书面化翻译腔。
3. 场景标题、动作描述等遵循剧本格式惯例，简洁、直接、有画面感，保留戏剧张力与节奏。
4. 按目标语言习惯调整语序、时态、标点与行文节奏，保证译文自然流畅。

输出要求：
1. 第一段只输出译文本身，不加引号，不加解释性前缀。
2. 译文之后另起一行，以「【译注】」开头，用中文给出 2-4 条关键翻译决策说明，覆盖语域与语气把握、文化或习惯表达的处理、术语选择、语法结构调整等，每条一句话左右；输入越简短，译注越精炼（1-2 条）。
3. 除译文与【译注】外，不要输出任何其他内容。`;

export const TRANSLATOR_MAX_INPUT_LENGTH = 500;

export const DEFAULT_TRANSLATOR_PREFERENCES: TranslatorPreferences = {
  sourceLang: "auto",
  targetLang: "zh",
  reasoningEffort: "high",
};

/**
 * 无记忆翻译请求：只发送当前文本与用户自定义 systemPrompt，
 * 不携带任何历史；每次调用独立可取消。
 */
export const translateText = async (
  request: TranslateRequest,
  signal?: AbortSignal
): Promise<TranslateResponse> => {
  const text = request.text.trim();
  if (!text) throw new Error("翻译文本为空。");
  const response = await fetchAuthorized(buildApiUrl("/api/translate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...request,
      text,
      systemPrompt: request.systemPrompt?.trim() || undefined,
    }),
    signal,
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    let message = `翻译失败（HTTP ${response.status}）`;
    try {
      const payload = JSON.parse(raw) as { error?: string };
      if (typeof payload.error === "string" && payload.error.trim()) message = payload.error.trim();
    } catch {
      if (raw.trim()) message = raw.trim();
    }
    throw new Error(message);
  }
  return (await response.json()) as TranslateResponse;
};

/** 服务端固定使用的模型（单一来源），界面不可更换。 */
export const translateModel = DEEPSEEK_DEFAULT_MODEL;
