import {
  ARK_DEFAULT_MODEL,
  ARK_RESPONSES_BASE_URL,
  DEEPSEEK_RESPONSES_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL,
  OPENROUTER_RESPONSES_BASE_URL,
  QWEN_DEFAULT_MODEL,
  QWEN_RESPONSES_BASE_URL,
} from "../../constants";

export type StyloAgentProvider = "qwen" | "openrouter" | "ark" | "deepseek";

export const resolveAgentProvider = (provider?: string): StyloAgentProvider =>
  provider === "openrouter"
    ? "openrouter"
    : provider === "ark"
      ? "ark"
      : provider === "qwen"
        ? "qwen"
        : "deepseek";

export const resolveBaseUrl = (provider: StyloAgentProvider, baseUrl?: string) => {
  const configured = (baseUrl || "").trim();
  if (configured) return configured;
  if (provider === "deepseek") return DEEPSEEK_RESPONSES_BASE_URL;
  if (provider === "openrouter") return OPENROUTER_RESPONSES_BASE_URL;
  if (provider === "ark") return ARK_RESPONSES_BASE_URL;
  return QWEN_RESPONSES_BASE_URL;
};

export const resolveProviderModel = (provider: StyloAgentProvider, requestedModel?: string) => {
  const model = (requestedModel || "").trim();
  if (provider === "ark") {
    if (!model || model.startsWith("qwen") || model.startsWith("doubao-lite-") || model.startsWith("doubao-pro-")) {
      return ARK_DEFAULT_MODEL;
    }
    return model;
  }
  if (provider === "qwen") {
    if (!model || model.startsWith("doubao-") || model.startsWith("deepseek-")) {
      return QWEN_DEFAULT_MODEL;
    }
    return model;
  }
  if (provider === "deepseek") {
    return DEEPSEEK_DEFAULT_MODEL;
  }
  return model;
};

export const isModelAccessError = (message: string) =>
  /model or endpoint|model|endpoint/i.test(message) &&
  /(does not exist|do not have access|not found|invalid|unsupported)/i.test(message);

export const formatModelAccessError = (
  provider: StyloAgentProvider,
  effectiveModel: string,
  message: string
) => {
  if (provider === "ark") {
    return `Ark model unavailable: current request uses \`${effectiveModel}\`. Prefer \`doubao-seed-*\` or an enabled \`ep-*\` endpoint ID. Original error: ${message}`;
  }
  if (provider === "qwen") {
    return `Qwen model unavailable: current request uses \`${effectiveModel}\`. Check model access for this API key or switch back to \`${QWEN_DEFAULT_MODEL}\`. Original error: ${message}`;
  }
  if (provider === "deepseek") {
    return `DeepSeek model unavailable: current request uses \`${effectiveModel}\`. Check DEEPSEEK_API_KEY permissions and the Responses API route for \`${DEEPSEEK_DEFAULT_MODEL}\`. Original error: ${message}`;
  }
  return message;
};
