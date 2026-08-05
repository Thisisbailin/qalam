import { AGENT_TRANSPORT_LIMITS, throwIfAborted } from "../runtime/limits";

export const readBoundedResponseText = async (
  response: Response,
  options: { signal?: AbortSignal; maxBytes?: number } = {},
) => {
  const maxBytes = options.maxBytes ?? AGENT_TRANSPORT_LIMITS.toolResponseBytes;
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`External tool response exceeds ${Math.round(maxBytes / 1024)} KB.`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      throwIfAborted(options.signal);
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value?.byteLength || 0;
      if (bytes > maxBytes) {
        await reader.cancel("response too large").catch(() => undefined);
        throw new Error(`External tool response exceeds ${Math.round(maxBytes / 1024)} KB.`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
};
