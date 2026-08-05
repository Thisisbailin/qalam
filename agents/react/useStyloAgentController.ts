import { useCallback, useEffect, useRef, useState } from "react";
import type { Message } from "../../node-workspace/components/stylo/types";
import {
  recordAgentToolCalled,
  recordAgentToolCompleted,
  recordAgentToolFailed,
} from "../runtime/activity";
import { browserAgentDebug, browserAgentDebugError } from "../runtime/debug";
import type { AgentRuntimeEvent, StyloAgentRuntime, StyloRunInput, StyloRunResult } from "../runtime/types";
import { StyloMessageEventState } from "./styloMessageState";
import { AgentStreamEventBuffer } from "./streamEventBuffer";

type Options = {
  runtime: StyloAgentRuntime;
  projectId: string;
  sessionId: string;
  conversationId: string;
  activityStorageKey?: string;
  setConversationMessages: (
    conversationId: string,
    updater: Message[] | ((previous: Message[]) => Message[]),
  ) => Message[];
};

type DisplayAwareError = Error & { styloAlreadyDisplayed?: boolean };

const createId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const useStyloAgentController = ({
  runtime,
  projectId,
  sessionId,
  conversationId,
  activityStorageKey,
  setConversationMessages,
}: Options) => {
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const projectionRef = useRef(new StyloMessageEventState());
  const displayedErrorRef = useRef<string | null>(null);
  const streamEventQueueRef = useRef(new AgentStreamEventBuffer());
  const streamFrameRef = useRef<number | null>(null);
  const runConversationIdRef = useRef(conversationId);

  const projectEvents = useCallback((events: AgentRuntimeEvent[]) => {
    if (!events.length || !mountedRef.current) return;
    let abortReason: string | undefined;
    let displayedError: string | undefined;
    setConversationMessages(runConversationIdRef.current, (previous) => {
      let next = previous;
      events.forEach((event) => {
        const projected = projectionRef.current.apply(next, event);
        next = projected.messages;
        abortReason ||= projected.abortReason;
        displayedError ||= projected.displayedError;
      });
      return next;
    });
    if (displayedError) displayedErrorRef.current = displayedError;
    if (abortReason && abortRef.current && !abortRef.current.signal.aborted) {
      abortRef.current.abort(abortReason);
    }
  }, [setConversationMessages]);

  const flushStreamEvents = useCallback(() => {
    if (streamFrameRef.current != null) {
      cancelAnimationFrame(streamFrameRef.current);
      streamFrameRef.current = null;
    }
    const events = streamEventQueueRef.current.drain();
    if (!events.length) return;
    projectEvents(events);
  }, [projectEvents]);

  const handleEvent = useCallback((event: AgentRuntimeEvent) => {
    if (!mountedRef.current) return;
    if (event.type === "item_started" && event.item.type === "tool_call") {
      recordAgentToolCalled({
        callId: event.item.id,
        name: event.item.name,
        status: "running",
        summary: event.item.summary,
        input: event.item.input,
      }, activityStorageKey);
    }
    if (event.type === "item_completed" && event.item.type === "tool_call") {
      const call = {
        callId: event.item.id,
        name: event.item.name,
        status: event.item.status === "completed" ? "success" as const : "error" as const,
        summary: event.item.summary,
        input: event.item.input,
        output: event.item.output,
        error: event.item.error,
      };
      if (event.item.status === "failed") recordAgentToolFailed(call, event.item.error || "工具执行失败", activityStorageKey);
      else recordAgentToolCompleted(call, activityStorageKey);
    }

    if (!streamEventQueueRef.current.push(event)) {
      flushStreamEvents();
      projectEvents([event]);
      return;
    }
    if (streamFrameRef.current != null) return;
    streamFrameRef.current = requestAnimationFrame(() => {
      streamFrameRef.current = null;
      const events = streamEventQueueRef.current.drain();
      projectEvents(events);
    });
  }, [activityStorageKey, flushStreamEvents, projectEvents]);

  const sendMessage = useCallback(async (
    input: Omit<StyloRunInput, "projectId" | "sessionId">,
    runScope?: { conversationId: string; sessionId: string },
  ): Promise<StyloRunResult> => {
    if (abortRef.current) throw new Error("Agent 已有正在执行的任务。");
    const controller = new AbortController();
    abortRef.current = controller;
    displayedErrorRef.current = null;
    const runConversationId = runScope?.conversationId || conversationId;
    const runSessionId = runScope?.sessionId || sessionId;
    runConversationIdRef.current = runConversationId;
    flushStreamEvents();
    const preflightId = createId("preflight");
    setConversationMessages(runConversationId, (previous) => projectionRef.current.createPreflight(previous, preflightId));
    setIsRunning(true);
    try {
      const result = await runtime.run(
        { ...input, projectId, sessionId: runSessionId },
        { signal: controller.signal, onEvent: handleEvent }
      );
      if (result.projectId !== projectId) {
        throw new Error(`Stylo 项目作用域失配：expected ${projectId}, received ${result.projectId || "missing"}。`);
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "Agent 请求失败。");
      if (displayedErrorRef.current === message && error instanceof Error) {
        (error as DisplayAwareError).styloAlreadyDisplayed = true;
      }
      if (projectionRef.current.preflightStatusId) {
        setConversationMessages(runConversationId, (previous) => projectionRef.current.failPreflight(previous, message));
        if (error instanceof Error) {
          (error as DisplayAwareError).styloAlreadyDisplayed = true;
        }
      }
      browserAgentDebugError("useStyloAgentController runtime error", error);
      throw error;
    } finally {
      flushStreamEvents();
      abortRef.current = null;
      setIsRunning(false);
      browserAgentDebug("useStyloAgentController settled", { projectId, sessionId: runSessionId });
    }
  }, [conversationId, flushStreamEvents, handleEvent, projectId, runtime, sessionId, setConversationMessages]);

  const cancel = useCallback(() => abortRef.current?.abort("用户已停止当前 Agent 任务。"), []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (streamFrameRef.current != null) cancelAnimationFrame(streamFrameRef.current);
      streamFrameRef.current = null;
      streamEventQueueRef.current.clear();
      abortRef.current?.abort("Agent 视图已卸载。");
    };
  }, []);

  return { isRunning, sendMessage, cancel };
};
