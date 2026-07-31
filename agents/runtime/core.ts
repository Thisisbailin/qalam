import {
  Agent,
  InputGuardrailTripwireTriggered,
  OutputGuardrailTripwireTriggered,
  Runner,
  ToolInputGuardrailTripwireTriggered,
  ToolOutputGuardrailTripwireTriggered,
  type Session,
} from "@openai/agents";
import type { StyloAgentBridge } from "../bridge/styloBridge";
import { createStyloTools } from "../tools";
import { createStyloInputGuardrails, createStyloOutputGuardrails } from "./guardrails";
import { composeAgentInstructions } from "./instructions";
import { buildRunInputItems } from "./memory";
import { formatModelAccessError, isModelAccessError, type StyloAgentProvider } from "./providerConfig";
import { createStyloProviderRuntime } from "./providerRuntime";
import { AgentMessageStreamProjector, extractTextFromModelOutput } from "./streamProjector";
import { createStyloToolBudgetPolicy } from "./toolBudget";
import { getStyloToolDescriptor } from "./toolCatalog";
import type {
  AgentExecutedToolCall,
  AgentRuntimeEvent,
  AgentTraceEntry,
  AgentTraceStage,
  AgentTraceStatus,
  AgentSessionMessage,
  StyloAgentConfig,
  StyloRunContext,
  StyloRunInput,
  StyloRunResult,
  StyloResolvedSkill,
} from "./types";

const createTraceEntry = (
  stage: AgentTraceStage,
  status: AgentTraceStatus,
  title: string,
  detail?: string,
  payload?: string
): AgentTraceEntry => ({
  id: `${stage}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  at: Date.now(),
  stage,
  status,
  title,
  detail,
  payload,
});

const summarizeSuccessfulToolCalls = (toolCalls: AgentExecutedToolCall[]) => {
  const successfulCalls = toolCalls.filter((toolCall) => toolCall.status === "success" && toolCall.summary?.trim());
  if (!successfulCalls.length) return "";
  const prioritizedCalls = successfulCalls.filter((toolCall) => {
    const category = getStyloToolDescriptor(toolCall.name).category;
    return category === "mutation" || category === "approval";
  });
  const source = prioritizedCalls.length ? prioritizedCalls : successfulCalls;
  const uniqueSummaries = Array.from(
    new Map(source.map((toolCall) => [toolCall.summary!.trim(), toolCall.summary!.trim()])).values()
  );
  return uniqueSummaries.slice(-3).join("\n");
};

type ResolvedRuntimeConfig = Pick<StyloAgentConfig, "defaultHeaders" | "styloTools"> & {
  provider: StyloAgentProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
};

type RunStyloAgentCoreOptions = {
  input: StyloRunInput;
  config: ResolvedRuntimeConfig;
  bridge: StyloAgentBridge;
  session: Session;
  sessionMessages: AgentSessionMessage[];
  runtimeMode: StyloRunContext["runtimeMode"];
  runtimeLabel: string;
  workflowName: string;
  enabledSkills: StyloResolvedSkill[];
  disabledTools?: string[];
  maxTurns?: number;
  signal?: AbortSignal;
  onEvent?: (event: AgentRuntimeEvent) => void;
  onDebug?: (label: string, payload?: unknown) => void;
  getExtraResult?: () => Partial<StyloRunResult>;
  runStartedMeta?: Pick<Extract<AgentRuntimeEvent, { type: "run_started" }>, "traceId" | "tracingEnabled">;
  recoverFallbackOnAnyError?: boolean;
  traceId?: string;
  groupId?: string;
  traceMetadata?: Record<string, string>;
  tracingDisabled?: boolean;
  traceIncludeSensitiveData?: boolean;
};

export const runStyloAgentCore = async ({
  input,
  config,
  bridge,
  session,
  sessionMessages,
  runtimeMode,
  runtimeLabel,
  workflowName,
  enabledSkills,
  disabledTools = [],
  maxTurns = 50,
  signal,
  onEvent,
  onDebug,
  getExtraResult,
  runStartedMeta,
  recoverFallbackOnAnyError = false,
  traceId,
  groupId,
  traceMetadata,
  tracingDisabled,
  traceIncludeSensitiveData,
}: RunStyloAgentCoreOptions): Promise<StyloRunResult> => {
  const runId = `${runtimeMode === "edge_full" ? "edge-run" : "run"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let runtimeEventSequence = 0;
  const emitRuntimeEvent = (event: AgentRuntimeEvent) => {
    runtimeEventSequence += 1;
    onEvent?.({ ...event, sequence: runtimeEventSequence } as AgentRuntimeEvent);
  };
  const emitTrace = (
    stage: AgentTraceStage,
    status: AgentTraceStatus,
    title: string,
    detail?: string,
    payload?: string
  ) => {
    emitRuntimeEvent({
      type: "trace",
      runId,
      entry: createTraceEntry(stage, status, title, detail, payload),
    });
  };

  if (input.attachments?.length) {
    const message = "新的 Agent runtime 暂不支持图片附件，请先移除附件后再发送。";
    emitRuntimeEvent({ type: "run_failed", runId, error: message });
    throw new Error(message);
  }

  onDebug?.("run input", {
    projectId: input.projectId,
    sessionId: input.sessionId,
    userTextChars: input.userText.length,
    enabledSkillIds: input.enabledSkillIds || [],
    attachments: input.attachments?.length || 0,
  });

  emitRuntimeEvent({
    type: "run_started",
    sessionId: input.sessionId,
    runId,
    traceId: runStartedMeta?.traceId,
    tracingEnabled: runStartedMeta?.tracingEnabled,
  });
  emitTrace("runtime", "running", "Run started", `session=${input.sessionId}`);

  const providerRuntime = createStyloProviderRuntime({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    defaultHeaders: config.defaultHeaders,
    allowBrowserClient: runtimeMode === "browser",
  });

  const toolEvents: AgentExecutedToolCall[] = [];
  const toolBudget = createStyloToolBudgetPolicy();
  const messageProjector = new AgentMessageStreamProjector(runId, emitRuntimeEvent);

  const emitToolEvent = (
    event:
      | { type: "tool_called"; call: AgentExecutedToolCall }
      | { type: "tool_completed"; call: AgentExecutedToolCall }
      | { type: "tool_failed"; call: AgentExecutedToolCall; error: string }
  ) => {
    if (event.type === "tool_called") {
      toolEvents.push(event.call);
    }
    if (event.type === "tool_completed" || event.type === "tool_failed") {
      const index = toolEvents.findIndex((toolCall) => toolCall.callId === event.call.callId);
      if (index >= 0) toolEvents[index] = event.call;
      else toolEvents.push(event.call);
    }
    emitRuntimeEvent({ ...event, runId } as AgentRuntimeEvent);
  };

  const tools = createStyloTools({
    bridge,
    emitEvent: emitToolEvent,
    disabledTools,
    toolBudget,
  });
  const initialToolBudgetSnapshot = toolBudget.snapshot();
  const runContext: StyloRunContext = {
    runtimeMode,
    toolBudget: {
      totalCalls: initialToolBudgetSnapshot.totalCalls,
      lookupCalls: initialToolBudgetSnapshot.lookupCalls,
      mutationCalls: initialToolBudgetSnapshot.mutationCalls,
      fullReadCalls: initialToolBudgetSnapshot.fullReadCalls,
      limits: {
        totalCalls: initialToolBudgetSnapshot.limits.totalCalls,
        lookupCalls: initialToolBudgetSnapshot.limits.lookupCalls,
        mutationCalls: initialToolBudgetSnapshot.limits.mutationCalls,
        fullReadCalls: initialToolBudgetSnapshot.limits.fullReadCalls,
      },
    },
    uiContext: input.uiContext,
  };
  const runInputItems = buildRunInputItems(input);
  const resolvedToolChoice = tools.length > 0 ? "auto" : "none";

  emitTrace("runtime", "info", "Config resolved", `${config.provider} · ${config.model}`, config.baseUrl);
  emitTrace("session", "info", "Session attached", `id=${input.sessionId} · items=${sessionMessages.length}`);
  emitTrace(
    "tool",
    "info",
    "Tools prepared",
    `${tools.length} tools enabled`,
    JSON.stringify({
      tools: tools.map((tool) => tool.name),
      budget: initialToolBudgetSnapshot.limits,
    }, null, 2)
  );

  const agent = new Agent<StyloRunContext>({
    name: runtimeLabel,
    instructions: composeAgentInstructions({
      enabledSkills,
    }),
    handoffDescription: "Single all-purpose Stylo creative agent.",
    model: config.model,
    modelSettings: { ...providerRuntime.modelSettings, toolChoice: resolvedToolChoice },
    inputGuardrails: createStyloInputGuardrails(),
    outputGuardrails: createStyloOutputGuardrails(),
    resetToolChoice: true,
    tools,
  });

  emitTrace(
    "model",
    "running",
    "Agent run started",
    `model=${config.model} · sessionMemory=${sessionMessages.length}`,
    JSON.stringify({
      runtimeMode,
      enabledTools: tools.map((tool) => tool.name),
      skills: enabledSkills.map((skill) => skill.id),
    }, null, 2)
  );

  try {
    const runner = new Runner({
      modelProvider: providerRuntime.modelProvider,
      tracingDisabled: tracingDisabled ?? true,
      traceIncludeSensitiveData: traceIncludeSensitiveData ?? false,
      workflowName,
      traceId,
      groupId,
      traceMetadata,
    });
    const result = await runner.run(agent, runInputItems, {
      signal,
      maxTurns,
      session,
      context: runContext,
      stream: true,
    });

    for await (const value of result) {
      messageProjector.consume(value);
    }
    messageProjector.finish();

    await result.completed;
    const synthesizedToolText = summarizeSuccessfulToolCalls(toolEvents);
    const finalText =
      String(result.finalOutput || "").trim() ||
      messageProjector.streamedResponseText.trim() ||
      extractTextFromModelOutput(result.rawResponses?.at(-1)?.output) ||
      messageProjector.streamedText.trim() ||
      synthesizedToolText;

    const runResult: StyloRunResult = {
      projectId: input.projectId,
      finalText,
      sessionId: input.sessionId,
      outputItems: [
        ...toolEvents.map((toolCall) => ({ kind: "tool_result", toolCall }) as const),
        { kind: "text", text: finalText } as const,
      ],
      toolCalls: toolEvents,
      usage: result.rawResponses?.at(-1)?.usage
        ? {
            inputTokens: result.rawResponses.at(-1)?.usage?.inputTokens,
            outputTokens: result.rawResponses.at(-1)?.usage?.outputTokens,
            totalTokens: result.rawResponses.at(-1)?.usage?.totalTokens,
          }
        : undefined,
      ...(getExtraResult?.() || {}),
    };

    onDebug?.("run result", {
      projectId: runResult.projectId,
      sessionId: runResult.sessionId,
      finalTextChars: runResult.finalText.length,
      toolCalls: runResult.toolCalls.map((toolCall) => ({
        callId: toolCall.callId,
        name: toolCall.name,
        status: toolCall.status,
      })),
      usage: runResult.usage,
    });
    emitTrace(
      "result",
      "success",
      "Run completed",
      `tools=${toolEvents.length} · response=${result.lastResponseId || "n/a"}`,
      `text=${finalText.length} chars`
    );
    messageProjector.finalize(finalText);
    emitRuntimeEvent({ type: "run_completed", runId, result: runResult });
    return runResult;
  } catch (error: any) {
    const isMaxTurns = error?.name === "MaxTurnsExceededError" || String(error?.message || "").includes("Max turns");
    const isGuardrailError =
      error instanceof InputGuardrailTripwireTriggered ||
      error instanceof OutputGuardrailTripwireTriggered ||
      error instanceof ToolInputGuardrailTripwireTriggered ||
      error instanceof ToolOutputGuardrailTripwireTriggered;
    const toolTrace = toolEvents
      .slice(-5)
      .map((toolCall) => `${toolCall.name}:${toolCall.status}${toolCall.summary ? `(${toolCall.summary})` : ""}`)
      .join(" -> ");
    const synthesizedToolText = summarizeSuccessfulToolCalls(toolEvents);
    const hasSuccessfulAction = toolEvents.some((toolCall) => {
      if (toolCall.status !== "success") return false;
      const category = getStyloToolDescriptor(toolCall.name).category;
      return category === "mutation" || category === "approval";
    });
    const fallbackText = messageProjector.streamedResponseText.trim() || messageProjector.streamedText.trim() || synthesizedToolText;

    onDebug?.("run error", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
      isMaxTurns,
      toolEvents: toolEvents.map((toolCall) => ({
        callId: toolCall.callId,
        name: toolCall.name,
        status: toolCall.status,
      })),
      toolTrace,
      streamedTextChars: messageProjector.streamedText.length,
      streamedResponseTextChars: messageProjector.streamedResponseText.length,
      fallbackTextChars: fallbackText.length,
    });

    const shouldRecover =
      Boolean(fallbackText) &&
      (
        (isMaxTurns && (!toolEvents.length || hasSuccessfulAction)) ||
        (recoverFallbackOnAnyError && (hasSuccessfulAction || !toolEvents.length))
      );

    if (shouldRecover) {
      const recoveredText = fallbackText;
      const runResult: StyloRunResult = {
        projectId: input.projectId,
        finalText: recoveredText,
        sessionId: input.sessionId,
        outputItems: [
          ...toolEvents.map((toolCall) => ({ kind: "tool_result", toolCall }) as const),
          { kind: "text", text: recoveredText } as const,
        ],
        toolCalls: toolEvents,
        ...(getExtraResult?.() || {}),
      };
      emitTrace(
        "result",
        "success",
        "Fallback text recovered",
        isMaxTurns
          ? "模型未完整收尾，已从已知结果恢复文本。"
          : "运行中断，但已从已知结果恢复文本。",
        `text=${recoveredText.length} chars`
      );
      messageProjector.finalize(recoveredText);
      emitRuntimeEvent({ type: "run_completed", runId, result: runResult });
      return runResult;
    }

    const message = isGuardrailError
      ? `Guardrail 已拦截当前请求：${error?.message || "请求不符合运行边界。"}`
      : isMaxTurns
        ? toolEvents.length
          ? `Agent 在工具调用中未能收敛，已中止。${toolTrace ? ` 最近工具链路：${toolTrace}` : ""}`
          : `Agent 未产出可识别的最终输出，已在 ${maxTurns} 个回合后中止。`
        : isModelAccessError(error?.message || String(error))
          ? formatModelAccessError(config.provider, config.model, error?.message || String(error))
          : error?.message || "Agent runtime 执行失败";

    emitTrace("result", "error", "Run failed", message);
    emitRuntimeEvent({ type: "run_failed", runId, error: message });
    throw new Error(message);
  } finally {
    await providerRuntime.close().catch((error) => {
      onDebug?.("provider close failed", error instanceof Error ? error.message : String(error));
    });
  }
};
