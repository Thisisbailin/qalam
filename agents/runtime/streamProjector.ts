import type { RunStreamEvent } from "@openai/agents";
import type {
  AgentMessageThreadItem,
  AgentReasoningThreadItem,
  AgentRuntimeEvent,
} from "./types";

type MessageRuntimeEvent = Extract<
  AgentRuntimeEvent,
  { type: "item_started" | "item_delta" | "item_updated" | "item_completed" }
>;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const getArray = (record: Record<string, unknown> | null, key: string) =>
  record && Array.isArray(record[key]) ? record[key] as unknown[] : [];

export const extractTextFromModelOutput = (output: unknown): string => {
  if (typeof output === "string") return output.trim();
  if (!Array.isArray(output)) return "";
  const parts: string[] = [];
  output.forEach((item) => {
    const record = asRecord(item);
    if (!record) return;
    if (record.type === "output_text" && typeof record.text === "string") parts.push(record.text);
    if (record.type !== "message") return;
    getArray(record, "content").forEach((content) => {
      const contentRecord = asRecord(content);
      if (contentRecord?.type === "output_text" && typeof contentRecord.text === "string") parts.push(contentRecord.text);
    });
  });
  return parts.join("\n").trim();
};

export const extractReasoningFromModelOutput = (output: unknown): string => {
  if (!Array.isArray(output)) return "";
  const parts: string[] = [];
  output.forEach((item) => {
    const record = asRecord(item);
    if (!record) return;
    if (["reasoning", "reasoning_summary", "summary_text"].includes(String(record.type)) && typeof record.text === "string") {
      parts.push(record.text);
    }
    [...getArray(record, "summary"), ...getArray(record, "content"), ...getArray(record, "rawContent")].forEach((content) => {
      const contentRecord = asRecord(content);
      if (
        ["reasoning_summary_text", "reasoning_text", "summary_text"].includes(String(contentRecord?.type)) &&
        typeof contentRecord?.text === "string"
      ) {
        parts.push(contentRecord.text);
      }
    });
  });
  return Array.from(new Set(parts.map((part) => part.trim()).filter(Boolean))).join("\n").trim();
};

const unwrapProviderEvent = (value: unknown) => {
  const record = asRecord(value);
  return asRecord(record?.event) || asRecord(record?.providerData) || record;
};

const mergeCompletedText = (streamedText: string, completedText?: string) => {
  const candidate = completedText || "";
  if (!candidate) return streamedText;
  if (!streamedText) return candidate;
  if (candidate.includes(streamedText)) return candidate;
  if (streamedText.includes(candidate)) return streamedText;
  return `${streamedText.trimEnd()}\n\n${candidate.trimStart()}`;
};

export class AgentMessageStreamProjector {
  private textSegmentIndex = 0;
  private reasoningSegmentIndex = 0;
  private activeMessageId = "";
  private activeMessageText = "";
  private activeReasoningId = "";
  private activeReasoningText = "";
  private readonly completedMessages: AgentMessageThreadItem[] = [];

  streamedText = "";
  streamedResponseText = "";
  streamedReasoningText = "";

  constructor(
    private readonly runId: string,
    private readonly emit: (event: MessageRuntimeEvent) => void
  ) {}

  private ensureMessageId(preferredId?: string) {
    if (!this.activeMessageId) {
      this.textSegmentIndex += 1;
      this.activeMessageId = preferredId || `${this.runId}-message-${this.textSegmentIndex}`;
      this.activeMessageText = "";
      this.emit({
        type: "item_started",
        runId: this.runId,
        item: {
          id: this.activeMessageId,
          type: "agent_message",
          status: "in_progress",
          text: "",
          phase: "commentary",
        },
      });
    }
    return this.activeMessageId;
  }

  private ensureReasoningId(preferredId?: string) {
    if (!this.activeReasoningId) {
      this.reasoningSegmentIndex += 1;
      this.activeReasoningId = preferredId || `${this.runId}-reasoning-${this.reasoningSegmentIndex}`;
      this.activeReasoningText = "";
      this.emit({
        type: "item_started",
        runId: this.runId,
        item: {
          id: this.activeReasoningId,
          type: "reasoning",
          status: "in_progress",
          text: "",
        },
      });
    }
    return this.activeReasoningId;
  }

  private emitMessageDelta(delta: string, preferredId?: string) {
    if (!delta) return;
    const messageId = this.ensureMessageId(preferredId);
    this.activeMessageText += delta;
    this.streamedText += delta;
    this.emit({
      type: "item_delta",
      runId: this.runId,
      itemId: messageId,
      itemType: "agent_message",
      delta,
    });
  }

  private emitReasoningDelta(delta: string, preferredId?: string) {
    if (!delta) return;
    const reasoningId = this.ensureReasoningId(preferredId);
    this.activeReasoningText += delta;
    this.streamedReasoningText += delta;
    this.emit({
      type: "item_delta",
      runId: this.runId,
      itemId: reasoningId,
      itemType: "reasoning",
      delta,
    });
  }

  private completeReasoning(completedText?: string, preferredId?: string) {
    const text = mergeCompletedText(this.activeReasoningText, completedText);
    if (!text.trim()) return;
    const id = this.ensureReasoningId(preferredId);
    this.activeReasoningText = "";
    this.activeReasoningId = "";
    const item: AgentReasoningThreadItem = {
      id,
      type: "reasoning",
      status: "completed",
      text,
    };
    this.emit({ type: "item_completed", runId: this.runId, item });
  }

  private completeMessage(completedText?: string, isFinal = false, preferredId?: string) {
    if (!this.activeMessageText.trim() && !completedText?.trim()) return;
    const messageId = this.ensureMessageId(preferredId);
    this.activeMessageText = mergeCompletedText(this.activeMessageText, completedText);
    const item: AgentMessageThreadItem = {
      id: messageId,
      type: "agent_message",
      status: "completed",
      text: this.activeMessageText,
      phase: isFinal ? "final_answer" : "commentary",
    };
    this.completedMessages.push(item);
    this.emit({ type: "item_completed", runId: this.runId, item });
    this.activeMessageId = "";
    this.activeMessageText = "";
  }

  consume(event: RunStreamEvent) {
    if (event.type === "run_item_stream_event") {
      const item = event.item as unknown as Record<string, unknown>;
      const rawItem = asRecord(item.rawItem);
      const itemId = typeof rawItem?.id === "string" ? rawItem.id : undefined;
      if (event.name === "message_output_created") {
        const completedText =
          typeof item.content === "string"
            ? item.content
            : extractTextFromModelOutput(rawItem ? [rawItem] : []);
        this.completeMessage(completedText, false, itemId);
      }
      if (event.name === "reasoning_item_created") {
        const completedText = extractReasoningFromModelOutput(rawItem ? [rawItem] : []);
        this.completeReasoning(completedText, itemId);
      }
      return;
    }
    if (event.type !== "raw_model_stream_event") return;
    const raw = asRecord(event.data);
    const provider = unwrapProviderEvent(event.data);
    const rawType = String(raw?.type || provider?.type || "");
    const rawItemId = typeof raw?.item_id === "string" ? raw.item_id : undefined;
    const choices = getArray(provider, "choices");
    const firstChoice = asRecord(choices[0]);
    const chatDelta = asRecord(firstChoice?.delta);
    const chatReasoning =
      typeof chatDelta?.reasoning_content === "string"
        ? chatDelta.reasoning_content
        : typeof chatDelta?.reasoning === "string"
          ? chatDelta.reasoning
          : "";
    this.emitReasoningDelta(chatReasoning, rawItemId);

    if (rawType === "output_text_delta" && typeof raw?.delta === "string") {
      this.emitMessageDelta(raw.delta, rawItemId);
    }

    const reasoningDelta =
      typeof raw?.delta === "string" ? raw.delta : typeof provider?.delta === "string" ? provider.delta : "";
    if (["response.reasoning_summary_text.delta", "reasoning_summary_text.delta"].includes(rawType)) {
      this.emitReasoningDelta(reasoningDelta, rawItemId);
    }
    if (
      ["response.reasoning_summary_text.done", "reasoning_summary_text.done"].includes(rawType) &&
      typeof raw?.text === "string"
    ) {
      this.completeReasoning(raw.text, rawItemId);
    }
    if (rawType === "response_done") {
      const response = asRecord(raw?.response) || asRecord(provider?.response);
      const candidate = extractTextFromModelOutput(response?.output);
      if (candidate) this.streamedResponseText = candidate;
      const reasoning = extractReasoningFromModelOutput(response?.output);
      if (reasoning) this.completeReasoning(reasoning);
    }
  }

  finish() {
    this.completeReasoning();
    this.completeMessage();
  }

  finalize(finalText: string) {
    const normalized = finalText.trim();
    if (!normalized) return;
    let completed: AgentMessageThreadItem | undefined;
    let completedIndex = -1;
    for (let index = this.completedMessages.length - 1; index >= 0; index -= 1) {
      const candidate = this.completedMessages[index];
      const text = candidate.text.trim();
      if (text === normalized || text.includes(normalized) || normalized.includes(text)) {
        completed = candidate;
        completedIndex = index;
        break;
      }
    }
    if (completed) {
      const resolvedText = normalized.includes(completed.text.trim()) ? normalized : completed.text;
      if (completed.phase !== "final_answer" || completed.text !== resolvedText) {
        const updated: AgentMessageThreadItem = {
          ...completed,
          phase: "final_answer",
          text: resolvedText,
        };
        this.completedMessages[completedIndex] = updated;
        this.emit({ type: "item_updated", runId: this.runId, item: updated });
      }
      return;
    }
    this.completeMessage(normalized, true);
  }
}
