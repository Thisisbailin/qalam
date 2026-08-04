import type { StyloAgentRuntime, StyloRunInput, StyloRunOptions, StyloRunResult } from "./types";
import type { ProjectData } from "../../types";
import {
  AGENT_HTTP_STREAM_CONTENT_TYPE,
  AgentEventSequenceGuard,
  AgentTurnLifecycleGuard,
  type AgentHttpRunRequest,
  parseAgentStreamPacket,
} from "./httpProtocol";
import { browserAgentDebug, browserAgentDebugError } from "./debug";
import { drainAgentSseBuffer } from "./sseProtocol";

// Agent 请求现在携带本地项目快照，容量上限按项目规模放宽。
const MAX_AGENT_REQUEST_BYTES = 4 * 1024 * 1024;

const summarizeEventForDebug = (event: any) => {
  if (!event || typeof event !== "object") return event;
  if (event.type === "item_delta") {
    return {
      type: event.type,
      runId: event.runId,
      itemId: event.itemId,
      itemType: event.itemType,
      deltaChars: typeof event.delta === "string" ? event.delta.length : 0,
      accumulatedChars: typeof event.accumulatedText === "string" ? event.accumulatedText.length : 0,
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

const summarizeRawPacketForDebug = (rawPacket: string) => {
  try {
    const packet = parseAgentStreamPacket(rawPacket);
    if (packet.kind === "event") {
      return {
        kind: packet.kind,
        event: summarizeEventForDebug(packet.event),
      };
    }
    return {
      kind: packet.kind,
      errorChars: typeof packet.error === "string" ? packet.error.length : 0,
    };
  } catch {
    return {
      kind: "unknown",
      rawChars: rawPacket.length,
    };
  }
};

const summarizeResultForDebug = (result: StyloRunResult) => ({
  sessionId: result.sessionId,
  finalTextChars: typeof result.finalText === "string" ? result.finalText.length : 0,
  toolCalls: result.toolCalls.length,
  outputItems: result.outputItems.length,
  usage: result.usage,
});

const readHttpError = async (response: Response) => {
  const raw = await response.text().catch(() => "");
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
    localSnapshot?: ProjectData;
    release?: () => void;
  }>;
  getAuthToken?: (options?: { skipCache?: boolean }) => Promise<string | null>;
};

const decodeStreamChunks = async (
  stream: ReadableStream<Uint8Array>,
  onPacket: (rawPacket: string) => void
) => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const drained = drainAgentSseBuffer(buffer);
      buffer = drained.remainder;
      drained.packets.forEach(onPacket);
    }
    buffer += decoder.decode();
    drainAgentSseBuffer(buffer, true).packets.forEach(onPacket);
  } finally {
    reader.releaseLock();
  }
};

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
    try {
    const requestBody: AgentHttpRunRequest = {
      run: input,
      runtime: getRuntimeConfig(),
      project: {
        expectedRevision,
        ...(projectLease?.localSnapshot
          ? { localSnapshot: projectLease.localSnapshot }
          : {}),
      },
    };
    const serializedRequestBody = JSON.stringify(requestBody);
    const requestBytes = new TextEncoder().encode(serializedRequestBody).byteLength;
    if (requestBytes > MAX_AGENT_REQUEST_BYTES) {
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
        signal: options?.signal,
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

    const terminalState: { result: StyloRunResult | null } = { result: null };
    let streamedError: string | null = null;
    let lastEventType: string | null = null;
    const sequenceGuard = new AgentEventSequenceGuard();
    const lifecycleGuard = new AgentTurnLifecycleGuard();
    await decodeStreamChunks(response.body, (rawPacket) => {
      browserAgentDebug("httpClient raw packet", summarizeRawPacketForDebug(rawPacket));
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
    });
    lifecycleGuard.assertTerminal();

    const finalResult = terminalState.result;
    if (!finalResult) {
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
    if (finalResult.projectId !== input.projectId) {
      throw new Error(
        `Stylo 返回了其它项目的结果：expected ${input.projectId}, received ${finalResult.projectId || "missing"}。`
      );
    }
    browserAgentDebug("httpClient completed", {
      finalTextChars: finalResult.finalText.length,
      toolCalls: finalResult.toolCalls.length,
    });
    return finalResult;
    } finally {
      projectLease?.release?.();
    }
  },
});
