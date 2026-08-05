import type { StyloAgentBridge } from "../bridge/styloBridge";
import { readBoundedResponseText } from "./httpSafety";

const DEFAULT_MAX_CHARS = 8000;

const searchWebParameters = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Web search query.",
    },
    max_chars: {
      type: "integer",
      description: "Maximum characters to return from the search result page.",
    },
  },
  additionalProperties: false,
  required: ["query"],
} as const;

const trim = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const toPositiveInteger = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return Math.min(value, 32_000);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return Math.min(parsed, 32_000);
  }
  return fallback;
};

const parseArgs = (input: unknown) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("search_web 需要对象参数。");
  }
  const raw = input as Record<string, unknown>;
  const query = trim(raw.query);
  if (!query) throw new Error("search_web 需要 query。");
  return {
    query,
    maxChars: toPositiveInteger(raw.max_chars ?? raw.maxChars, DEFAULT_MAX_CHARS),
  };
};

const clipText = (value: string, maxChars: number) =>
  value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`;

export const searchWebToolDef = {
  name: "search_web",
  description:
    "Search the public web for fresh information. Prefer primary sources when technical, legal, financial, or product accuracy matters.",
  parameters: searchWebParameters,
  execute: async (input: unknown, _bridge: StyloAgentBridge, options?: { signal?: AbortSignal }) => {
    const args = parseArgs(input);
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(args.query)}`;
    const readerUrl = `https://r.jina.ai/http://${searchUrl.replace(/^https?:\/\//, "")}`;
    const response = await fetch(readerUrl, {
      headers: {
        Accept: "text/plain",
      },
      signal: options?.signal,
    });
    if (!response.ok) {
      throw new Error(`Web search failed: ${response.status} ${response.statusText}`);
    }
    const text = await readBoundedResponseText(response, { signal: options?.signal });
    return {
      target: "web_search",
      action: "search",
      query: args.query,
      search_url: searchUrl,
      reader_url: readerUrl,
      truncated: text.length > args.maxChars,
      content: clipText(text, args.maxChars),
      guidance:
        "Use this as a discovery result. For precise claims, open and verify primary source URLs surfaced in the result text.",
    };
  },
  summarize: (output: any) => `已搜索网页: ${output?.query || ""}`,
};
