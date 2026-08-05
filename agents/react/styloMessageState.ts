import type { ChatMessage, Message, StatusMessage, ToolMessage } from "../../node-workspace/components/stylo/types";
import { isToolMessage } from "../../node-workspace/components/stylo/types";
import { buildAssistantChatMessage } from "../adapters/styloMessageAdapter";
import { findStyloToolDescriptor } from "../runtime/toolCatalog";
import type { AgentRuntimeEvent } from "../runtime/types";

type StatusKind = "reasoning" | "response";

export type StyloMessageProjectionResult = {
  messages: Message[];
  abortReason?: string;
  displayedError?: string;
};

const nextOrder = (messages: Message[]) => messages.reduce((max, message) => Math.max(max, message.order || 0), 0) + 1;
const streamKey = (runId: string, messageId?: string) => `${runId}:${messageId || "default"}`;

const isAbortLikeError = (value: unknown) => {
  const message = String(value || "");
  return /AbortError|aborted|已取消|用户已停止/i.test(message);
};

const humanizeToolName = (name: string) => findStyloToolDescriptor(name)?.label || name;

const upsertStatus = (
  messages: Message[],
  statusId: string,
  updater: (current: StatusMessage | null) => StatusMessage
) => {
  const index = messages.findIndex((message) => message.kind === "status" && message.statusCard.id === statusId);
  const current = index >= 0 ? messages[index] as StatusMessage : null;
  const next = updater(current);
  if (index < 0) return [...messages, next];
  const copy = [...messages];
  copy[index] = next;
  return copy;
};

const completeStatus = (
  messages: Message[],
  statusId: string,
  status: "success" | "error",
  patch?: Partial<StatusMessage["statusCard"]>
) => messages.map((message) =>
  message.kind === "status" && message.statusCard.id === statusId
    ? { ...message, statusCard: { ...message.statusCard, ...patch, status, updatedAt: Date.now() } }
    : message
);

const upsertAssistant = (
  messages: Message[],
  runId: string,
  messageId: string | undefined,
  updater: (current: ChatMessage | null) => ChatMessage
) => {
  const index = messages.findIndex((message) =>
    (message.kind === "chat" || message.kind == null) &&
    message.role === "assistant" &&
    message.meta?.runId === runId &&
    (messageId ? message.meta?.messageId === messageId : !message.meta?.messageId)
  );
  const current = index >= 0 ? messages[index] as ChatMessage : null;
  const next = updater(current);
  if (index < 0) return [...messages, next];
  const copy = [...messages];
  copy[index] = next;
  return copy;
};

const updateToolStatus = (
  messages: Message[],
  callId: string,
  status: "running" | "success" | "error",
  summary?: string
) => messages.map((message) =>
  message.kind === "tool" && message.tool.callId === callId
    ? { ...message, tool: { ...message.tool, status, summary: summary ?? message.tool.summary } }
    : message
);

export class StyloMessageEventState {
  activeRunId: string | null = null;
  preflightStatusId: string | null = null;
  private readonly activeReasoning = new Map<string, string>();
  private readonly activeResponse = new Map<string, string>();
  private readonly statusSequence = new Map<string, number>();
  private readonly timelineBase = new Map<string, number>();
  private readonly streamed = new Set<string>();
  private readonly toolFailures = new Map<string, Map<string, number>>();
  private readonly settledToolCalls = new Set<string>();
  private readonly streamedText = new Map<string, string>();

  private appendDelta(event: Extract<AgentRuntimeEvent, { type: "item_delta" }>) {
    const key = streamKey(event.runId, event.itemId);
    const text = `${this.streamedText.get(key) || ""}${event.delta}`;
    this.streamedText.set(key, text);
    return text;
  }

  createPreflight(messages: Message[], statusId: string): Message[] {
    this.preflightStatusId = statusId;
    return upsertStatus(messages, statusId, (current) => ({
      role: "assistant",
      kind: "status",
      order: current?.order || nextOrder(messages),
      statusCard: {
        id: statusId,
        runId: statusId,
        status: "running",
        headline: "思考中",
        detail: "正在启动 Agent。",
        steps: current?.statusCard.steps || [],
        startedAt: current?.statusCard.startedAt || Date.now(),
        updatedAt: Date.now(),
        isThinking: true,
      },
    }));
  }

  failPreflight(messages: Message[], error: string): Message[] {
    const statusId = this.preflightStatusId;
    this.preflightStatusId = null;
    if (!statusId) return messages;
    const aborted = isAbortLikeError(error);
    return upsertStatus(messages, statusId, (current) => ({
      role: "assistant",
      kind: "status",
      order: current?.order || nextOrder(messages),
      statusCard: {
        id: statusId,
        runId: statusId,
        status: aborted ? "success" : "error",
        headline: aborted ? "已停止" : "连接失败",
        detail: aborted ? "当前任务已由你手动停止。" : error,
        summary: aborted ? undefined : error,
        steps: current?.statusCard.steps || [],
        startedAt: current?.statusCard.startedAt || Date.now(),
        updatedAt: Date.now(),
        isThinking: false,
      },
    }));
  }

  private order(messages: Message[], event: AgentRuntimeEvent) {
    if (typeof event.sequence !== "number") return nextOrder(messages);
    let base = this.timelineBase.get(event.runId);
    if (base == null) {
      base = nextOrder(messages) - event.sequence;
      this.timelineBase.set(event.runId, base);
    }
    return base + event.sequence;
  }

  private statusId(runId: string, kind: StatusKind) {
    const active = kind === "reasoning" ? this.activeReasoning : this.activeResponse;
    const existing = active.get(runId);
    if (existing) return existing;
    const sequence = (this.statusSequence.get(runId) || 0) + 1;
    this.statusSequence.set(runId, sequence);
    const id = `${runId}-${kind}-${sequence}`;
    active.set(runId, id);
    return id;
  }

  private finalizeStatus(messages: Message[], runId: string, kind: StatusKind, status: "success" | "error", patch?: Partial<StatusMessage["statusCard"]>) {
    const active = kind === "reasoning" ? this.activeReasoning : this.activeResponse;
    const id = active.get(runId);
    if (!id) return messages;
    active.delete(runId);
    return completeStatus(messages, id, status, patch);
  }

  private finalizeTools(messages: Message[], runId: string, error: string) {
    const existingResults = new Set(messages.filter((message): message is ToolMessage =>
      isToolMessage(message) && message.kind === "tool_result" && message.tool.runId === runId
    ).map((message) => message.tool.callId).filter(Boolean));
    const pending = messages.filter((message): message is ToolMessage =>
      isToolMessage(message) && message.kind === "tool" && message.tool.runId === runId && message.tool.status === "running"
    );
    if (!pending.length) return messages;
    const updated = messages.map((message) =>
      isToolMessage(message) && message.kind === "tool" && message.tool.runId === runId && message.tool.status === "running"
        ? { ...message, tool: { ...message.tool, status: "error" as const, summary: error } }
        : message
    );
    let order = nextOrder(updated);
    const results: Message[] = pending.filter((message) => message.tool.callId && !existingResults.has(message.tool.callId)).map((message) => ({
      role: "assistant",
      kind: "tool_result",
      order: order++,
      tool: { ...message.tool, status: "error", summary: error },
    }));
    return results.length ? [...updated, ...results] : updated;
  }

  private cleanup(runId: string) {
    this.activeReasoning.delete(runId);
    this.activeResponse.delete(runId);
    this.statusSequence.delete(runId);
    this.timelineBase.delete(runId);
    this.toolFailures.delete(runId);
    [...this.streamed].filter((key) => key.startsWith(`${runId}:`)).forEach((key) => this.streamed.delete(key));
    [...this.settledToolCalls]
      .filter((key) => key.startsWith(`${runId}:`))
      .forEach((key) => this.settledToolCalls.delete(key));
    [...this.streamedText.keys()]
      .filter((key) => key.startsWith(`${runId}:`))
      .forEach((key) => this.streamedText.delete(key));
    if (this.activeRunId === runId) this.activeRunId = null;
  }

  apply(messages: Message[], event: AgentRuntimeEvent): StyloMessageProjectionResult {
    const order = () => this.order(messages, event);
    if (event.type === "turn_started") {
      this.activeRunId = event.runId;
      this.toolFailures.set(event.runId, new Map());
      const reasoningId = this.statusId(event.runId, "reasoning");
      const preflightId = this.preflightStatusId;
      this.preflightStatusId = null;
      const withPreflight = preflightId ? completeStatus(messages, preflightId, "success", {
        runId: event.runId,
        headline: "Agent 已启动",
        detail: "Edge 已受理请求，正在初始化模型会话。",
        isThinking: false,
      }) : messages;
      return { messages: upsertStatus(withPreflight, reasoningId, (current) => ({
        role: "assistant", kind: "status", order: current?.order || this.order(withPreflight, event),
        statusCard: {
          id: reasoningId, runId: event.runId, status: "running", headline: "准备中",
          detail: "正在建立本轮 Agent 执行上下文。", steps: [],
          startedAt: current?.statusCard.startedAt || Date.now(), updatedAt: Date.now(), isThinking: true,
        },
      })) };
    }

    if (event.type === "item_delta" && event.itemType === "reasoning") {
      const accumulatedText = this.appendDelta(event);
      const id = this.statusId(event.runId, "reasoning");
      const next = upsertStatus(messages, id, (current) => ({
        role: "assistant", kind: "status", order: current?.order || order(),
        statusCard: {
          id, runId: event.runId, status: current?.statusCard.status || "running",
          headline: "思考", detail: "模型正在分析并规划下一步。",
          summary: accumulatedText.slice(-8_000), steps: [],
          startedAt: current?.statusCard.startedAt || Date.now(), updatedAt: Date.now(), isThinking: true,
        },
      }));
      return { messages: next };
    }

    if (event.type === "item_delta" && event.itemType === "agent_message") {
      const accumulatedText = this.appendDelta(event);
      this.streamed.add(streamKey(event.runId, event.itemId));
      const responseId = this.statusId(event.runId, "response");
      let next = upsertStatus(messages, responseId, (current) => ({
        role: "assistant", kind: "status", order: current?.order || order(),
        statusCard: {
          id: responseId, runId: event.runId, status: current?.statusCard.status || "running", headline: "生成内容",
          detail: "模型正在持续输出本轮内容。", steps: [], startedAt: current?.statusCard.startedAt || Date.now(),
          updatedAt: Date.now(), isThinking: false,
        },
      }));
      next = upsertAssistant(next, event.runId, event.itemId, (current) => ({
        role: "assistant", kind: "chat", order: current?.order || this.order(next, event), text: accumulatedText,
        meta: { ...current?.meta, runId: event.runId, messageId: event.itemId, isStreaming: true },
      }));
      return { messages: this.finalizeStatus(next, event.runId, "reasoning", "success") };
    }

    if (event.type === "item_started" && event.item.type === "tool_call") {
      const withReasoning = this.finalizeStatus(messages, event.runId, "reasoning", "success");
      const duplicate = withReasoning.some((message) => message.kind === "tool" && message.tool.callId === event.item.id);
      if (duplicate) return { messages: withReasoning };
      return { messages: [...withReasoning, {
        role: "assistant", kind: "tool", order: this.order(withReasoning, event),
        tool: {
          callId: event.item.id,
          runId: event.runId,
          name: event.item.name,
          status: "running",
          summary: event.item.summary || humanizeToolName(event.item.name),
        },
      }] };
    }

    if (event.type === "item_started") return { messages };

    if (event.type === "item_completed" && event.item.type === "tool_call") {
      const settledKey = `${event.runId}:${event.item.id}`;
      if (this.settledToolCalls.has(settledKey)) return { messages };
      this.settledToolCalls.add(settledKey);
      const failed = event.item.status === "failed";
      const summary = failed ? event.item.error : event.item.summary;
      const updated = updateToolStatus(messages, event.item.id, failed ? "error" : "success", summary);
      const alreadyHasResult = updated.some((message) => message.kind === "tool_result" && message.tool.callId === event.item.id);
      let next = alreadyHasResult ? updated : [...updated, {
        role: "assistant" as const, kind: "tool_result" as const, order: this.order(updated, event),
        tool: {
          callId: event.item.id, runId: event.runId, name: event.item.name, status: failed ? "error" as const : "success" as const,
          summary, output: failed ? undefined : typeof event.item.output === "string" ? event.item.output : JSON.stringify(event.item.output || {}),
        },
      }];
      if (!failed) return { messages: next };
      const failures = this.toolFailures.get(event.runId) || new Map<string, number>();
      const count = (failures.get(event.item.name) || 0) + 1;
      failures.set(event.item.name, count);
      this.toolFailures.set(event.runId, failures);
      const abortReason = count >= 5 ? `${event.item.name} 在本轮中已连续失败 ${count} 次，任务已停止。请修正工具链逻辑后再继续。` : undefined;
      if (abortReason) next = this.finalizeTools(next, event.runId, abortReason);
      return { messages: next, abortReason };
    }

    if (event.type === "item_completed" || event.type === "item_updated") {
      const item = event.item;
      if (item.type === "reasoning") {
        const id = this.statusId(event.runId, "reasoning");
        const next = upsertStatus(messages, id, (current) => ({
          role: "assistant", kind: "status", order: current?.order || order(),
          statusCard: {
            id, runId: event.runId, status: item.status === "failed" ? "error" : "success",
            headline: "思考", detail: "模型已完成这一段思考。", summary: item.text, steps: [],
            startedAt: current?.statusCard.startedAt || Date.now(), updatedAt: Date.now(), isThinking: true,
          },
        }));
        this.activeReasoning.delete(event.runId);
        return { messages: next };
      }
      if (item.type === "agent_message") {
        const built = buildAssistantChatMessage(item.text);
        const key = streamKey(event.runId, item.id);
        const next = upsertAssistant(messages, event.runId, item.id, (current) => ({
          ...built,
          order: current?.order || order(),
          text: built.text || current?.text || item.text,
          meta: {
            ...current?.meta,
            ...built.meta,
            runId: event.runId,
            messageId: item.id,
            isStreaming: false,
            isFinal: item.phase === "final_answer",
          },
        }));
        this.streamed.delete(key);
        this.streamedText.delete(key);
        return { messages: this.finalizeStatus(next, event.runId, "response", "success", {
          headline: item.phase === "final_answer" ? "最终回答已完成" : "本轮内容已生成",
          detail: item.phase === "final_answer" ? "Agent 已完成本次任务。" : "Agent 将继续处理后续工具或推理步骤。",
        }) };
      }
      return { messages };
    }

    if (event.type === "turn_completed") {
      this.cleanup(event.runId);
      return { messages };
    }

    if (event.type !== "turn_failed") return { messages };

    const aborted = isAbortLikeError(event.error);
    let next = this.finalizeTools(messages, event.runId, event.error);
    next = this.finalizeStatus(next, event.runId, "reasoning", "error");
    next = this.finalizeStatus(next, event.runId, "response", "error", {
      headline: aborted ? "已停止" : "回复中断",
      detail: aborted ? "当前任务已由你手动停止。" : event.error,
    });
    if (!aborted) next = [...next, { role: "assistant", kind: "chat", order: nextOrder(next), text: `请求失败: ${event.error}` }];
    this.cleanup(event.runId);
    return { messages: next, displayedError: event.error };
  }
}
