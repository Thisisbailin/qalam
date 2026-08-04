import { DEEPSEEK_DEFAULT_MODEL, DEEPSEEK_RESPONSES_BASE_URL } from "../../constants";
import { getUserId, jsonResponse } from "./_auth";
import { enforceRateLimit } from "./_rateLimit";
import type { D1DatabaseLike, PagesContext } from "./_types";

type Env = Record<string, unknown> & {
  DB: D1DatabaseLike;
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
};

const TRANSLATOR_LANGS = new Set([
  "auto",
  "zh",
  "en",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "pt",
  "ru",
  "ar",
  "hi",
]);

/**
 * DeepSeek v4-flash 官方 API 支持三档推理强度 low / high / max，
 * 默认 high。为避免兼容歧义，这里只透传 flash 真实支持的三档。
 */
const REASONING_EFFORTS = new Set(["low", "high", "max"]);

// 剧本写作中的翻译输入通常为词语、台词或短片段，限制 500 字以内。
const MAX_TEXT_LENGTH = 500;
const MAX_SYSTEM_PROMPT_LENGTH = 2_000;

const LANGS_LABELS: Record<string, string> = {
  auto: "自动检测",
  zh: "中文",
  en: "英语",
  ja: "日语",
  ko: "韩语",
  fr: "法语",
  de: "德语",
  es: "西班牙语",
  pt: "葡萄牙语",
  ru: "俄语",
  ar: "阿拉伯语",
  hi: "印地语",
};

type TranslateBody = {
  text: string;
  sourceLang: string;
  targetLang: string;
  reasoningEffort: string;
  systemPrompt?: string;
};

const parseTranslateBody = (value: unknown): TranslateBody => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Response("Invalid translate request body", { status: 400 });
  }
  const record = value as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!text) throw new Response("翻译文本为空。", { status: 400 });
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Response(`翻译文本过长（上限 ${MAX_TEXT_LENGTH} 字符）。`, { status: 400 });
  }
  const sourceLang = typeof record.sourceLang === "string" ? record.sourceLang : "auto";
  const targetLang = typeof record.targetLang === "string" ? record.targetLang : "zh";
  if (!TRANSLATOR_LANGS.has(sourceLang) || !TRANSLATOR_LANGS.has(targetLang)) {
    throw new Response("不支持的语种。", { status: 400 });
  }
  const reasoningEffort = typeof record.reasoningEffort === "string" ? record.reasoningEffort : "high";
  if (!REASONING_EFFORTS.has(reasoningEffort)) {
    throw new Response("不支持的推理强度。", { status: 400 });
  }
  let systemPrompt = typeof record.systemPrompt === "string" ? record.systemPrompt.trim() : "";
  if (systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
    throw new Response(`系统提示词过长（上限 ${MAX_SYSTEM_PROMPT_LENGTH} 字符）。`, { status: 400 });
  }
  return { text, sourceLang, targetLang, reasoningEffort, systemPrompt };
};

const buildTranslatePrompt = (body: TranslateBody) => {
  const sourceLabel = LANGS_LABELS[body.sourceLang] || body.sourceLang;
  const targetLabel = LANGS_LABELS[body.targetLang] || body.targetLang;
  const sourcePart = body.sourceLang === "auto" ? "自动检测到的语言" : sourceLabel;
  return `请将以下内容从${sourcePart}翻译成${targetLabel}。\n\n${body.text}`;
};

const extractChatText = (data: any): string => {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  return "";
};

const mapUsage = (usage: any) => {
  if (!usage || typeof usage !== "object") return undefined;
  const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const responseTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? promptTokens + responseTokens;
  return { promptTokens, responseTokens, totalTokens };
};

export const onRequestOptions = async () =>
  new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });

export const onRequestPost = async (context: PagesContext<Env>) => {
  try {
    const userId = await getUserId(context.request, context.env);
    await enforceRateLimit({
      db: context.env.DB,
      namespace: "translate",
      subject: userId,
      limit: 20,
      windowSeconds: 60,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }

  let body: TranslateBody;
  try {
    body = parseTranslateBody(await context.request.json());
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response("Invalid JSON body", { status: 400, headers: CORS_HEADERS });
  }

  const apiKey = typeof context.env.DEEPSEEK_API_KEY === "string" ? context.env.DEEPSEEK_API_KEY.trim() : "";
  if (!apiKey) {
    return new Response("Pages Functions 未配置 DEEPSEEK_API_KEY。", {
      status: 500,
      headers: CORS_HEADERS,
    });
  }

  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (body.systemPrompt) messages.push({ role: "system", content: body.systemPrompt });
  messages.push({ role: "user", content: buildTranslatePrompt(body) });

  try {
    const upstream = await fetch(`${DEEPSEEK_RESPONSES_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        // 模型固定为 agent 模块默认模型，不接受客户端覆盖。
        model: DEEPSEEK_DEFAULT_MODEL,
        messages,
        reasoning_effort: body.reasoningEffort,
        // 思考模式（v4 默认开启）下 temperature/top_p 等采样参数不生效，故不发送。
        stream: false,
      }),
      redirect: "manual",
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      return new Response("DeepSeek chat endpoint redirected unexpectedly", {
        status: 502,
        headers: CORS_HEADERS,
      });
    }
    const raw = (await upstream.json()) as any;
    if (!upstream.ok) {
      const detail =
        (typeof raw?.error?.message === "string" && raw.error.message) ||
        `DeepSeek 请求失败（HTTP ${upstream.status}）`;
      return jsonResponse({ error: detail }, { status: upstream.status, headers: CORS_HEADERS });
    }
    const text = extractChatText(raw);
    if (!text) {
      return new Response("DeepSeek 未返回译文内容。", { status: 502, headers: CORS_HEADERS });
    }
    return jsonResponse({ text, usage: mapUsage(raw?.usage) }, { headers: CORS_HEADERS });
  } catch (error: any) {
    console.error("Translate upstream failed", error);
    return new Response("翻译服务暂不可用，请稍后重试。", { status: 502, headers: CORS_HEADERS });
  }
};
