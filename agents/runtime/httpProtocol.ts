import type { StyloToolSettings } from "../../types";
import type { AgentRuntimeEvent, AgentThreadItem, StyloRunInput, StyloRunResult } from "./types";
import { parseNodeFlowFile } from "../../node-workspace/nodeflow/schema";

export type AgentHttpRuntimeConfig = {
  provider?: "qwen" | "openrouter" | "ark" | "deepseek";
  model: string;
  baseUrl?: string;
  styloTools?: StyloToolSettings;
};

export type AgentHttpRunRequest = {
  run: StyloRunInput;
  runtime: AgentHttpRuntimeConfig;
  project: {
    expectedRevision: number;
  };
};

export type AgentHttpStreamPacket =
  | { kind: "event"; event: AgentRuntimeEvent }
  | { kind: "error"; error: string };

export const AGENT_HTTP_STREAM_CONTENT_TYPE = "text/event-stream; charset=utf-8";

export const serializeAgentStreamPacket = (packet: AgentHttpStreamPacket) =>
  `data: ${JSON.stringify(packet)}\n\n`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const failMalformedPacket = (): never => {
  throw new Error("Malformed Agent stream packet");
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const TOOL_CALL_STATUSES = new Set(["running", "success", "error"]);
const THREAD_ITEM_STATUSES = new Set(["in_progress", "completed", "failed"]);

const parseToolCall = (value: unknown) => {
  if (!isRecord(value) || !isNonEmptyString(value.callId) || !isNonEmptyString(value.name)) {
    return failMalformedPacket();
  }
  if (typeof value.status !== "string" || !TOOL_CALL_STATUSES.has(value.status)) {
    return failMalformedPacket();
  }
  return value;
};

const parseThreadItem = (value: unknown): AgentThreadItem => {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.type) ||
    typeof value.status !== "string" ||
    !THREAD_ITEM_STATUSES.has(value.status)
  ) {
    return failMalformedPacket();
  }
  if (value.type === "agent_message") {
    if (
      typeof value.text !== "string" ||
      (value.phase !== "commentary" && value.phase !== "final_answer")
    ) return failMalformedPacket();
    return value as unknown as AgentThreadItem;
  }
  if (value.type === "reasoning") {
    if (typeof value.text !== "string") return failMalformedPacket();
    return value as unknown as AgentThreadItem;
  }
  if (value.type === "tool_call") {
    if (!isNonEmptyString(value.name)) return failMalformedPacket();
    return value as unknown as AgentThreadItem;
  }
  return failMalformedPacket();
};

const parseRunResult = (value: unknown): StyloRunResult => {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.projectId) ||
    !isNonEmptyString(value.sessionId) ||
    typeof value.finalText !== "string" ||
    !Array.isArray(value.outputItems) ||
    !Array.isArray(value.toolCalls)
  ) {
    return failMalformedPacket();
  }
  value.toolCalls.forEach(parseToolCall);
  value.outputItems.forEach(parseThreadItem);
  const result = value as unknown as StyloRunResult;
  return {
    ...result,
    ...(result.updatedNodeFlow !== undefined
      ? { updatedNodeFlow: parseNodeFlowFile(result.updatedNodeFlow) }
      : {}),
  };
};

const parseRuntimeEvent = (value: unknown): AgentRuntimeEvent => {
  if (!isRecord(value) || !isNonEmptyString(value.type) || !isNonEmptyString(value.runId)) {
    return failMalformedPacket();
  }
  if (
    value.sequence !== undefined &&
    (!Number.isSafeInteger(value.sequence) || Number(value.sequence) <= 0)
  ) {
    return failMalformedPacket();
  }
  switch (value.type) {
    case "turn_started":
      if (!isNonEmptyString(value.sessionId)) return failMalformedPacket();
      break;
    case "item_started": {
      const item = parseThreadItem(value.item);
      if (item.status !== "in_progress") return failMalformedPacket();
      break;
    }
    case "item_updated":
      parseThreadItem(value.item);
      break;
    case "item_completed": {
      const item = parseThreadItem(value.item);
      if (item.status === "in_progress") return failMalformedPacket();
      break;
    }
    case "item_delta":
      if (
        !isNonEmptyString(value.itemId) ||
        (value.itemType !== "agent_message" && value.itemType !== "reasoning") ||
        typeof value.delta !== "string" ||
        typeof value.accumulatedText !== "string"
      ) return failMalformedPacket();
      break;
    case "turn_completed":
      return { ...value, result: parseRunResult(value.result) } as unknown as AgentRuntimeEvent;
    case "turn_failed":
      if (typeof value.error !== "string") return failMalformedPacket();
      break;
    default:
      return failMalformedPacket();
  }
  return value as unknown as AgentRuntimeEvent;
};

export class AgentEventSequenceGuard {
  private readonly lastSequenceByRun = new Map<string, number>();

  accept(event: AgentRuntimeEvent) {
    if (event.sequence === undefined) return true;
    const previous = this.lastSequenceByRun.get(event.runId) || 0;
    if (event.sequence <= previous) return false;
    this.lastSequenceByRun.set(event.runId, event.sequence);
    return true;
  }
}

export class AgentTurnLifecycleGuard {
  private runId: string | null = null;
  private terminal = false;

  accept(event: AgentRuntimeEvent) {
    if (!this.runId) {
      if (event.type !== "turn_started") {
        throw new Error("远端 Agent 流必须从 turn_started 开始。");
      }
      this.runId = event.runId;
      return;
    }
    if (event.runId !== this.runId) {
      throw new Error("远端 Agent 流在同一请求内切换了 runId。");
    }
    if (this.terminal) {
      throw new Error("远端 Agent 流在终态之后继续发送了事件。");
    }
    if (event.type === "turn_started") {
      throw new Error("远端 Agent 流重复发送了 turn_started。");
    }
    if (event.type === "turn_completed" || event.type === "turn_failed") {
      this.terminal = true;
    }
  }

  assertTerminal() {
    if (!this.terminal) throw new Error("远端 Agent 流结束时缺少终态事件。");
  }
}

export const parseAgentStreamPacket = (raw: string): AgentHttpStreamPacket => {
  const packet: unknown = JSON.parse(raw);
  if (!isRecord(packet) || typeof packet.kind !== "string") {
    throw new Error("Malformed Agent stream packet");
  }
  if (packet.kind === "error" && typeof packet.error === "string") {
    return { kind: "error", error: packet.error };
  }
  if (packet.kind === "event" && isRecord(packet.event)) {
    return { kind: "event", event: parseRuntimeEvent(packet.event) };
  }
  return failMalformedPacket();
};
