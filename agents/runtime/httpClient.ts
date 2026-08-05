import type {
  AgentExecutedToolCall,
  AgentRuntimeEvent,
  AgentThreadItem,
  StyloAgentRuntime,
  StyloRunInput,
  StyloRunOptions,
  StyloRunResult,
  StyloRunTerminalResult,
} from "./types";
import {
  AGENT_HTTP_STREAM_CONTENT_TYPE,
  AgentEventSequenceGuard,
  AgentTurnLifecycleGuard,
  type AgentHttpRunRequest,
  parseAgentStreamPacket,
} from "./httpProtocol";
import { browserAgentDebug, browserAgentDebugError } from "./debug";
import { drainAgentSseBuffer } from "./sseProtocol";
import {
  AGENT_PROTOCOL_VERSION,
  AGENT_TRANSPORT_LIMITS,
  createAbortError,
  throwIfAborted,
  withAbortAndTimeout,
} from "./limits";

const summarizeEventForDebug = (event: any) => {
  if (!event || typeof event !== "object") return event;
  if (event.type === "item_delta") {
    return {
      type: event.type,
      runId: event.runId,
      itemId: event.itemId,
      itemType: event.itemType,
      deltaChars: typeof event.delta === "string" ? event.delta.length : 0,
    };
  }
  if (event.type === "item_started" || event.type === "item_updated" || event.type === "item_completed") {
    return {
      type: event.type,
      runId: event.runId,
      item: {
        id: event.item?.id,
        type: event.item?.type,
        status: event.item?.status,
        textChars: typeof event.item?.text === "string" ? event.item.text.length : undefined,
      },
    };
  }
  if (event.type === "turn_completed") {
    return {
      type: event.type,
      runId: event.runId,
      result: {
        sessionId: event.result?.sessionId,
        finalTextChars: typeof event.result?.finalText === "string" ? event.result.finalText.length : 0,
        toolCalls: Array.isArray(event.result?.toolCalls) ? event.result.toolCalls.length : 0,
      },
    };
  }
  return event;
};

const summarizeResultForDebug = (result: StyloRunResult) => ({
  sessionId: result.sessionId,
  finalTextChars: typeof result.finalText === "string" ? result.finalText.length : 0,
  toolCalls: result.toolCalls.length,
  outputItems: result.outputItems.length,
  usage: result.usage,
});

const readHttpError = async (response: Response) => {
  if (!response.body) return `Agent 请求失败：HTTP ${response.status}`;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let raw = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value?.byteLength || 0;
      if (bytes > AGENT_TRANSPORT_LIMITS.frameBytes) {
        await reader.cancel("error response too large").catch(() => undefined);
        return `Agent 请求失败：HTTP ${response.status}（错误响应过大）`;
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch {
    return `Agent 请求失败：HTTP ${response.status}`;
  } finally {
    reader.releaseLock();
  }
  if (!raw) return `Agent 请求失败：HTTP ${response.status}`;
  try {
    const payload = JSON.parse(raw) as { error?: unknown; detail?: unknown };
    const error = typeof payload.error === "string" ? payload.error.trim() : "";
    const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
    return [error, detail].filter(Boolean).join("：") || raw;
  } catch {
    return raw;
  }
};

type HttpRuntimeDeps = {
  endpoint: string;
  getRuntimeConfig: () => AgentHttpRunRequest["runtime"];
  getProjectRevision: () => number;
  beforeRequest?: () => Promise<{
    expectedRevision: number;
    release?: () => void;
  }>;
  getAuthToken?: (options?: { skipCache?: boolean }) => Promise<string | null>;
};

const decodeStreamChunks = async (
  stream: ReadableStream<Uint8Array>,
  onPacket: (rawPacket: string) => void,
  signal?: AbortSignal,
) => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let totalBytes = 0;
  let eventCount = 0;
  const startedAt = Date.now();
  const consumePacket = (rawPacket: string) => {
    const frameBytes = encoder.encode(rawPacket).byteLength;
    if (frameBytes > AGENT_TRANSPORT_LIMITS.frameBytes) {
      throw new Error(`Agent 流帧超过 ${(AGENT_TRANSPORT_LIMITS.frameBytes / 1024).toFixed(0)} KB 上限。`);
    }
    eventCount += 1;
    if (eventCount > AGENT_TRANSPORT_LIMITS.eventCount) {
      throw new Error(`Agent 流事件超过 ${AGENT_TRANSPORT_LIMITS.eventCount} 条上限。`);
    }
    onPacket(rawPacket);
  };
  try {
    while (true) {
      throwIfAborted(signal);
      const remainingOverallMs = AGENT_TRANSPORT_LIMITS.overallTimeoutMs - (Date.now() - startedAt);
      if (remainingOverallMs <= 0) throw createAbortError("Agent 请求超过总时限，已停止。");
      const timeoutMs = Math.min(AGENT_TRANSPORT_LIMITS.idleTimeoutMs, remainingOverallMs);
      const { done, value } = await withAbortAndTimeout(reader.read(), {
        signal,
        timeoutMs,
        timeoutMessage: timeoutMs === remainingOverallMs
          ? "Agent 请求超过总时限，已停止。"
          : "Agent 流长时间没有新数据，已停止。",
      });
      if (done) break;
      totalBytes += value?.byteLength || 0;
      if (totalBytes > AGENT_TRANSPORT_LIMITS.streamBytes) {
        throw new Error(`Agent 流超过 ${(AGENT_TRANSPORT_LIMITS.streamBytes / 1024 / 1024).toFixed(0)} MB 上限。`);
      }
      buffer += decoder.decode(value, { stream: true });
      if (encoder.encode(buffer).byteLength > AGENT_TRANSPORT_LIMITS.frameBytes * 2) {
        throw new Error("Agent 流包含未终止或过大的事件帧。");
      }
      const drained = drainAgentSseBuffer(buffer);
      buffer = drained.remainder;
      drained.packets.forEach(consumePacket);
    }
    buffer += decoder.decode();
    drainAgentSseBuffer(buffer, true).packets.forEach(consumePacket);
  } finally {
    reader.releaseLock();
  }
};

const createTurnIdentity = () => {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return { turnId: `turn-${id}`, idempotencyKey: `agent-${id}` };
};

const toExecutedToolCall = (item: Extract<AgentThreadItem, { type: "tool_call" }>): AgentExecutedToolCall => ({
  callId: item.id,
  name: item.name,
  status: item.status === "in_progress" ? "running" : item.status === "failed" ? "error" : "success",
  summary: item.summary,
  input: item.input,
  output: item.output,
  error: item.error,
});

export const createHttpStyloAgentRuntime = ({
  endpoint,
  getRuntimeConfig,
  getProjectRevision,
  beforeRequest,
  getAuthToken,
}: HttpRuntimeDeps): StyloAgentRuntime => ({
  async run(input: StyloRunInput, options?: StyloRunOptions): Promise<StyloRunResult> {
    let expectedRevision = getProjectRevision();
    let projectLease: Awaited<ReturnType<NonNullable<HttpRuntimeDeps["beforeRequest"]>>> | null = null;
    if (beforeRequest) {
      projectLease = await beforeRequest();
      expectedRevision = projectLease.expectedRevision;
    }
    const requestController = new AbortController();
    const forwardAbort = () => requestController.abort(options?.signal?.reason);
    if (options?.signal?.aborted) forwardAbort();
    else options?.signal?.addEventListener("abort", forwardAbort, { once: true });
    const overallTimeout = setTimeout(
      () => requestController.abort(createAbortError("Agent 请求超过总时限，已停止。")),
      AGENT_TRANSPORT_LIMITS.overallTimeoutMs,
    );
    try {
    const turnIdentity = createTurnIdentity();
    const requestBody: AgentHttpRunRequest = {
      protocolVersion: AGENT_PROTOCOL_VERSION,
      ...turnIdentity,
      run: input,
      runtime: getRuntimeConfig(),
      project: { expectedRevision },
    };
    const serializedRequestBody = JSON.stringify(requestBody);
    const requestBytes = new TextEncoder().encode(serializedRequestBody).byteLength;
    if (requestBytes > AGENT_TRANSPORT_LIMITS.requestBytes) {
      throw new Error(
        `Agent 本次输入过大（${(requestBytes / 1024).toFixed(1)} KB）。请减少消息、选中文本或附件后重试。`
      );
    }
    browserAgentDebug("httpClient request", {
      endpoint,
      runtime: requestBody.runtime,
      projectId: requestBody.run.projectId,
      sessionId: requestBody.run.sessionId,
      userTextChars: requestBody.run.userText.length,
      requestBytes,
    });
    let authToken = await getAuthToken?.();
    if (!authToken && getAuthToken) {
      authToken = await getAuthToken({ skipCache: true });
    }
    const executeRequest = (token?: string | null) =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: AGENT_HTTP_STREAM_CONTENT_TYPE,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: serializedRequestBody,
        signal: requestController.signal,
      });
    let response = await executeRequest(authToken);
    if ((response.status === 401 || response.status === 403) && getAuthToken) {
      browserAgentDebug("httpClient auth retry", { status: response.status });
      const refreshedToken = await getAuthToken({ skipCache: true });
      if (refreshedToken) {
        authToken = refreshedToken;
        response = await executeRequest(refreshedToken);
      }
    }
    browserAgentDebug("httpClient response", {
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get("content-type"),
    });

    if (!response.ok || !response.body) {
      const message = await readHttpError(response);
      browserAgentDebugError("httpClient non-ok response", {
        status: response.status,
        message,
      });
      throw new Error(message || `Agent 请求失败：HTTP ${response.status}`);
    }

    const terminalState: { result: StyloRunTerminalResult | null } = { result: null };
    const outputItems = new Map<string, AgentThreadItem>();
    const toolCalls = new Map<string, AgentExecutedToolCall>();
    const streamedText = new Map<string, string>();
    let streamedError: string | null = null;
    let lastEventType: string | null = null;
    const sequenceGuard = new AgentEventSequenceGuard();
    const lifecycleGuard = new AgentTurnLifecycleGuard();
    await decodeStreamChunks(response.body, (rawPacket) => {
      const packet = parseAgentStreamPacket(rawPacket);
      if (packet.kind === "event") {
        if (!sequenceGuard.accept(packet.event)) {
          browserAgentDebug("httpClient duplicate event ignored", {
            runId: packet.event.runId,
            sequence: packet.event.sequence,
            type: packet.event.type,
          });
          return;
        }
        lifecycleGuard.accept(packet.event);
        browserAgentDebug("httpClient event", summarizeEventForDebug(packet.event));
        lastEventType = packet.event.type;
        if (packet.event.type === "item_delta") {
          const key = `${packet.event.runId}:${packet.event.itemId}`;
          const next = `${streamedText.get(key) || ""}${packet.event.delta}`;
          if (next.length > AGENT_TRANSPORT_LIMITS.bufferedTextChars) {
            throw new Error("Agent 单条输出超过客户端文本上限。");
          }
          streamedText.set(key, next);
        }
        if (
          packet.event.type === "item_started" ||
          packet.event.type === "item_updated" ||
          packet.event.type === "item_completed"
        ) {
          outputItems.set(packet.event.item.id, packet.event.item);
          if (packet.event.item.type === "tool_call") {
            toolCalls.set(packet.event.item.id, toExecutedToolCall(packet.event.item));
          }
        }
        if (packet.event.type === "turn_completed") {
          terminalState.result = packet.event.result;
        }
        if (packet.event.type === "turn_failed") {
          streamedError = packet.event.error;
        }
        options?.onEvent?.(packet.event);
        return;
      }
      if (packet.kind === "error") {
        browserAgentDebugError("httpClient packet error", packet.error);
        throw new Error(packet.error);
      }
    }, requestController.signal).catch((error) => {
      if (!requestController.signal.aborted) requestController.abort(error);
      throw error;
    });
    lifecycleGuard.assertTerminal();

    const terminalResult = terminalState.result;
    if (!terminalResult) {
      if (streamedError) {
        browserAgentDebugError("httpClient streamed error without result", streamedError);
        throw new Error(streamedError);
      }
      browserAgentDebugError("httpClient missing final result", {
        sessionId: input.sessionId,
        lastEventType,
      });
      throw new Error(
        lastEventType
          ? `远端 Agent 在 ${lastEventType} 阶段后异常结束，未返回最终结果。`
          : "远端 Agent 没有返回最终结果。"
      );
    }
    if (terminalResult.projectId !== input.projectId) {
      throw new Error(
        `Stylo 返回了其它项目的结果：expected ${input.projectId}, received ${terminalResult.projectId || "missing"}。`
      );
    }
    const orderedItems = Array.from(outputItems.values());
    const finalItem = terminalResult.finalItemId
      ? outputItems.get(terminalResult.finalItemId)
      : [...orderedItems].reverse().find((item) => item.type === "agent_message" && item.phase === "final_answer") ||
        [...orderedItems].reverse().find((item) => item.type === "agent_message");
    const finalText = finalItem?.type === "agent_message"
      ? finalItem.text
      : Array.from(streamedText.values()).at(-1) || "";
    const finalResult: StyloRunResult = {
      ...terminalResult,
      finalText,
      outputItems: orderedItems,
      toolCalls: Array.from(toolCalls.values()),
    };
    browserAgentDebug("httpClient completed", {
      finalTextChars: finalResult.finalText.length,
      toolCalls: finalResult.toolCalls.length,
    });
    return finalResult;
    } finally {
      clearTimeout(overallTimeout);
      options?.signal?.removeEventListener("abort", forwardAbort);
      projectLease?.release?.();
    }
  },
});
