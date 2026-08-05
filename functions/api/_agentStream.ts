import {
  AGENT_HTTP_STREAM_CONTENT_TYPE,
  serializeAgentStreamPacket,
} from "../../agents/runtime/httpProtocol";
import type { AgentRuntimeEvent } from "../../agents/runtime/types";
import { AGENT_TRANSPORT_LIMITS, withAbortAndTimeout } from "../../agents/runtime/limits";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
};

export const withCorsHeaders = (response: Response) => {
  const headers = new Headers(response.headers);
  Object.entries(CORS_HEADERS).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const createSseResponse = (stream: ReadableStream<Uint8Array>) =>
  new Response(stream, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": AGENT_HTTP_STREAM_CONTENT_TYPE,
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });

const isClosedStreamControllerError = (error: unknown) =>
  error instanceof Error && /Unable to enqueue|already closed|Invalid state/i.test(error.message);

export const emitEvent = (controller: ReadableStreamDefaultController<Uint8Array>, event: AgentRuntimeEvent) => {
  try {
    controller.enqueue(
      new TextEncoder().encode(serializeAgentStreamPacket({ kind: "event", event }))
    );
    return true;
  } catch (error: unknown) {
    if (!isClosedStreamControllerError(error)) throw error;
    return false;
  }
};

export const emitError = (controller: ReadableStreamDefaultController<Uint8Array>, error: string) => {
  try {
    controller.enqueue(
      new TextEncoder().encode(serializeAgentStreamPacket({ kind: "error", error }))
    );
    return true;
  } catch (errorLike: unknown) {
    if (!isClosedStreamControllerError(errorLike)) throw errorLike;
    return false;
  }
};

export class AgentEventStreamWriter {
  private readonly encoder = new TextEncoder();
  private readonly queue: Uint8Array[] = [];
  private pendingDeltas: AgentRuntimeEvent[] = [];
  private pendingDeltaIndex = new Map<string, number>();
  private queuedBytes = 0;
  private deltaTimer: ReturnType<typeof setTimeout> | null = null;
  private drainWaiters = new Set<() => void>();
  private failureReason: string | null = null;
  private disposed = false;

  constructor(private readonly controller: ReadableStreamDefaultController<Uint8Array>) {}

  emit(event: AgentRuntimeEvent) {
    if (this.disposed) return false;
    if (event.type === "item_delta") {
      const key = `${event.runId}:${event.itemType}:${event.itemId}`;
      const index = this.pendingDeltaIndex.get(key);
      if (index === undefined) {
        this.pendingDeltaIndex.set(key, this.pendingDeltas.length);
        this.pendingDeltas.push(event);
      } else {
        const existing = this.pendingDeltas[index];
        if (existing?.type === "item_delta") {
          this.pendingDeltas[index] = {
            ...event,
            delta: `${existing.delta}${event.delta}`,
          };
        }
      }
      this.scheduleDeltaFlush();
      return true;
    }
    this.flushDeltas();
    this.enqueue({ kind: "event", event });
    this.pump();
    return true;
  }

  emitError(error: string) {
    if (this.disposed) return false;
    this.flushDeltas();
    this.enqueue({ kind: "error", error });
    this.pump();
    return true;
  }

  pull() {
    if (this.disposed) return;
    this.pump();
  }

  async drain(signal?: AbortSignal) {
    this.flushDeltas();
    this.pump();
    if (!this.queue.length) return;
    await withAbortAndTimeout(new Promise<void>((resolve) => {
      this.drainWaiters.add(resolve);
    }), {
      signal,
      timeoutMs: AGENT_TRANSPORT_LIMITS.idleTimeoutMs,
      timeoutMessage: "Agent 客户端长时间未读取输出，流已停止。",
    });
  }

  dispose() {
    this.disposed = true;
    if (this.deltaTimer) clearTimeout(this.deltaTimer);
    this.deltaTimer = null;
    this.queue.length = 0;
    this.pendingDeltas = [];
    this.pendingDeltaIndex.clear();
    this.resolveDrainWaiters();
  }

  private scheduleDeltaFlush() {
    if (this.disposed) return;
    if (this.deltaTimer) return;
    this.deltaTimer = setTimeout(() => {
      this.deltaTimer = null;
      this.flushDeltas();
      this.pump();
    }, AGENT_TRANSPORT_LIMITS.deltaFlushMs);
  }

  private flushDeltas() {
    if (this.deltaTimer) clearTimeout(this.deltaTimer);
    this.deltaTimer = null;
    const deltas = this.pendingDeltas;
    this.pendingDeltas = [];
    this.pendingDeltaIndex.clear();
    if (this.disposed) return;
    deltas.forEach((event) => this.enqueue({ kind: "event", event }));
  }

  private enqueue(packet: Parameters<typeof serializeAgentStreamPacket>[0]) {
    const terminalEvent = packet.kind === "event" &&
      (packet.event.type === "turn_completed" || packet.event.type === "turn_failed");
    let resolvedPacket = packet;
    if (terminalEvent && this.failureReason && packet.kind === "event") {
      resolvedPacket = {
        kind: "event",
        event: {
          type: "turn_failed",
          runId: packet.event.runId,
          sequence: packet.event.sequence,
          error: this.failureReason,
        },
      };
    }
    let chunk = this.encoder.encode(serializeAgentStreamPacket(resolvedPacket));
    if (chunk.byteLength > AGENT_TRANSPORT_LIMITS.frameBytes) {
      this.failureReason = "Agent 结果元数据超过服务端单帧上限，已停止本轮任务。";
      if (!terminalEvent || packet.kind !== "event") {
        throw new Error(this.failureReason);
      }
      resolvedPacket = {
        kind: "event",
        event: {
          type: "turn_failed",
          runId: packet.event.runId,
          sequence: packet.event.sequence,
          error: this.failureReason,
        },
      };
      chunk = this.encoder.encode(serializeAgentStreamPacket(resolvedPacket));
    }
    if (this.queuedBytes + chunk.byteLength > AGENT_TRANSPORT_LIMITS.serverQueueBytes) {
      this.failureReason = "Agent 客户端读取过慢，服务端输出队列已达到上限。";
      if (!terminalEvent) throw new Error(this.failureReason);
      this.queue.length = 0;
      this.queuedBytes = 0;
      if (resolvedPacket.kind === "event" && resolvedPacket.event.type !== "turn_failed") {
        resolvedPacket = {
          kind: "event",
          event: {
            type: "turn_failed",
            runId: resolvedPacket.event.runId,
            sequence: resolvedPacket.event.sequence,
            error: this.failureReason,
          },
        };
        chunk = this.encoder.encode(serializeAgentStreamPacket(resolvedPacket));
      }
    }
    this.queue.push(chunk);
    this.queuedBytes += chunk.byteLength;
  }

  private pump() {
    while (this.queue.length && (this.controller.desiredSize ?? 0) > 0) {
      const chunk = this.queue.shift()!;
      this.queuedBytes -= chunk.byteLength;
      this.controller.enqueue(chunk);
    }
    if (!this.queue.length) this.resolveDrainWaiters();
  }

  private resolveDrainWaiters() {
    this.drainWaiters.forEach((resolve) => resolve());
    this.drainWaiters.clear();
  }
}
