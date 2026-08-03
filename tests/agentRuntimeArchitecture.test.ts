import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { performance } from "node:perf_hooks";
import { StyloMessageEventState } from "../agents/react/styloMessageState";
import { AgentStreamEventBuffer } from "../agents/react/streamEventBuffer";
import { createHttpStyloAgentRuntime } from "../agents/runtime/httpClient";
import {
  AgentEventSequenceGuard,
  AgentTurnLifecycleGuard,
  parseAgentStreamPacket,
  serializeAgentStreamPacket,
  type AgentHttpRunRequest,
} from "../agents/runtime/httpProtocol";
import { composeAgentInstructions } from "../agents/runtime/instructions";
import { resolveAgentProvider, resolveBaseUrl, resolveProviderModel } from "../agents/runtime/providerConfig";
import { createStyloProviderRuntime } from "../agents/runtime/providerRuntime";
import {
  compactAgentSessionItems,
  projectAgentItemsToSessionMessages,
} from "../agents/runtime/sessionProjection";
import { drainAgentSseBuffer } from "../agents/runtime/sseProtocol";
import { AgentMessageStreamProjector } from "../agents/runtime/streamProjector";
import { createStyloToolBudgetPolicy } from "../agents/runtime/toolBudget";
import { STYLO_TOOL_CATALOG, getStyloToolDescriptor } from "../agents/runtime/toolCatalog";
import { buildDisabledTools } from "../agents/runtime/toolPolicy";
import { normalizeStyloToolSettings } from "../agents/runtime/toolSettings";
import type { AgentRuntimeEvent, StyloRunResult } from "../agents/runtime/types";
import { buildStyloMessageTimeline } from "../node-workspace/components/stylo/messageTimeline";
import {
  STYLO_PRIMARY_MESSAGE_VISUALS,
  STYLO_TOOL_MESSAGE_VISUALS,
  resolveStyloToolMessageVisual,
} from "../node-workspace/components/stylo/messageVisualPolicy";
import { normalizeSafeExternalUrl } from "../node-workspace/components/stylo/safeExternalUrl";
import { resolveToolDisplayOutcome } from "../node-workspace/components/stylo/toolDisplayOutcome";
import {
  reconcileStaleAgentMessages,
  shouldRejectStaleAgentResult,
} from "../node-workspace/components/stylo/agentResultReconciliation";
import type { Message } from "../node-workspace/components/stylo/types";
import { buildAgentProjectStateFromRealtimeDocument } from "../functions/api/_agentProjectState";
import { DEEPSEEK_DEFAULT_MODEL, DEEPSEEK_RESPONSES_BASE_URL } from "../constants";

const emptyResult = (projectId = "project-1"): StyloRunResult => ({
  projectId,
  sessionId: "session-1",
  finalText: "done",
  outputItems: [{
    id: "message-1",
    type: "agent_message",
    status: "completed",
    text: "done",
    phase: "final_answer",
  }],
  toolCalls: [],
});

test("DeepSeek is the default Agent provider and is locked to the official Responses Flash model", () => {
  assert.equal(resolveAgentProvider(undefined), "deepseek");
  assert.equal(resolveAgentProvider("qwen"), "qwen");
  assert.equal(resolveBaseUrl("deepseek"), DEEPSEEK_RESPONSES_BASE_URL);
  assert.equal(resolveProviderModel("deepseek"), DEEPSEEK_DEFAULT_MODEL);
  assert.equal(resolveProviderModel("deepseek", "deepseek-v4-pro"), DEEPSEEK_DEFAULT_MODEL);
  assert.equal(resolveProviderModel("deepseek", "deepseek-chat"), DEEPSEEK_DEFAULT_MODEL);
  assert.equal(resolveProviderModel("deepseek", "deepseek-custom"), DEEPSEEK_DEFAULT_MODEL);
});

test("provider runtimes own isolated SDK clients and always resolve Responses models", async () => {
  const config = {
    apiKey: "test-key",
    baseUrl: "https://example.invalid",
    allowBrowserClient: false,
  };
  const first = createStyloProviderRuntime(config);
  const second = createStyloProviderRuntime(config);
  try {
    assert.notEqual(first.client, second.client);
    assert.notEqual(first.modelProvider, second.modelProvider);
    assert.equal(first.modelSettings.parallelToolCalls, false);
    assert.equal(first.modelSettings.store, false);
    assert.equal(first.modelSettings.providerData, undefined);
    assert.equal(first.modelSettings.reasoning, undefined);
    const resolvedModel = await first.modelProvider.getModel(DEEPSEEK_DEFAULT_MODEL);
    assert.equal(resolvedModel.constructor.name, "OpenAIResponsesModel");
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

test("Agent source has one Responses pipeline and no DeepSeek transport branch", () => {
  const providerRuntime = readFileSync("agents/runtime/providerRuntime.ts", "utf8");
  const edgeRuntime = readFileSync("functions/api/agent.ts", "utf8");
  const settings = readFileSync("node-workspace/components/ProjectSettingsPanel.tsx", "utf8");
  assert.match(providerRuntime, /useResponses:\s*true/);
  assert.doesNotMatch(providerRuntime, /deepseek|chat_completions|ChatCompletions/);
  assert.doesNotMatch(edgeRuntime, /StyloChatCompactionSession|resolveApiMode|chat_completions/);
  assert.match(settings, /Responses API/);
  assert.doesNotMatch(settings, /DEEPSEEK_PRO_MODEL|deepseek-v4-pro|Chat Completions/);
});

test("tool metadata is unique and drives lookup, mutation, cache, and budget behavior", () => {
  const names = STYLO_TOOL_CATALOG.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(getStyloToolDescriptor("operate_foundation").category, "mutation");
  assert.equal(getStyloToolDescriptor("create_document").interaction, "edit");
  assert.equal(getStyloToolDescriptor("create_document").label, "创建文档");
  assert.equal(getStyloToolDescriptor("access_github_repository").capability, "external_read");

  const policy = createStyloToolBudgetPolicy();
  assert.equal(policy.reserve("access_github_repository", { owner: "stylo", repo: "app" }).allowed, true);
  const duplicate = policy.reserve("access_github_repository", { repo: "app", owner: "stylo" });
  assert.equal(duplicate.allowed, false);
  assert.match(duplicate.allowed ? "" : duplicate.reason, /Duplicate lookup blocked/);
  assert.equal(policy.reserve("operate_foundation", { action: "rename" }).allowed, true);
  const snapshot = policy.snapshot();
  assert.equal(snapshot.lookupCalls, 1);
  assert.equal(snapshot.mutationCalls, 1);
  assert.throws(() => getStyloToolDescriptor("unknown_tool"), /Unknown Stylo tool/);
});

test("every registered Agent tool has a distinct message icon and unknown tools degrade safely", () => {
  const catalogNames = STYLO_TOOL_CATALOG.map((tool) => tool.name).sort();
  const visualNames = Object.keys(STYLO_TOOL_MESSAGE_VISUALS).sort();
  const toolIcons = Object.values(STYLO_TOOL_MESSAGE_VISUALS).map((visual) => visual.icon);
  const primaryIcons = Object.values(STYLO_PRIMARY_MESSAGE_VISUALS).map((visual) => visual.icon);

  assert.deepEqual(visualNames, catalogNames);
  assert.equal(new Set(toolIcons).size, toolIcons.length);
  assert.equal(new Set(primaryIcons).size, primaryIcons.length);
  assert.equal(resolveStyloToolMessageVisual("unknown_tool").icon, "tool_generic");
});

test("Agent message rendering reserves visual identities for semantic status and action rows", () => {
  const source = readFileSync(
    "node-workspace/components/stylo/StyloChatContent.tsx",
    "utf8"
  );
  const iconSource = readFileSync(
    "node-workspace/components/stylo/StyloMessageIcon.tsx",
    "utf8"
  );

  for (const visualKey of ["thinking", "response", "approval"] as const) {
    assert.match(source, new RegExp(`STYLO_PRIMARY_MESSAGE_VISUALS\\.${visualKey}`));
  }
  assert.doesNotMatch(source, /STYLO_PRIMARY_MESSAGE_VISUALS\.(user|assistant)/);
  assert.match(source, /resolveStyloToolMessageVisual\(effectiveTool\.name\)/);
  assert.match(iconSource, /data-tone=\{visual\.tone\}/);
  assert.match(iconSource, /weight="duotone"/);
});

test("tool settings are normalized in runtime and disable complete capability groups", () => {
  const normalized = normalizeStyloToolSettings({
    projectData: { enabled: false },
    workflowBuilder: { enabled: false },
    runtimeIntelligence: { enabled: false },
  });
  assert.equal(normalized.projectData.enabled, false);
  assert.equal(normalized.workflowBuilder.enabled, false);
  assert.equal(normalized.runtimeIntelligence.webSearchEnabled, true);

  const disabled = new Set(buildDisabledTools({
    styloTools: {
      projectData: { enabled: false },
      workflowBuilder: { enabled: false },
      runtimeIntelligence: { enabled: false },
    },
  }, []));
  assert.equal(disabled.has("read_project_resource"), true);
  assert.equal(disabled.has("access_github_repository"), true);
  assert.equal(disabled.has("operate_foundation"), true);
  assert.equal(disabled.has("prepare_generation_execution"), true);
});

test("session compaction bounds text and removes incomplete tool transactions", () => {
  const longText = "x".repeat(3_000);
  const longSummary = "summary-".repeat(100);
  const items = [
    { role: "user", content: [{ type: "input_text", text: longText }] },
    { type: "reasoning", rawContent: [{ type: "reasoning_text", text: "inspect context" }] },
    { type: "function_call", callId: "complete", name: "read_document", arguments: "{}" },
    {
      type: "function_call_result",
      callId: "complete",
      name: "read_document",
      status: "completed",
      output: JSON.stringify({ status: "success", tool: "read_document", summary: longSummary }),
    },
    { type: "function_call", callId: "dangling", name: "read_document", arguments: "{}" },
  ] as any[];

  const compacted = compactAgentSessionItems(items, { maxItems: 10, textLimit: 80, toolOutputLimit: 120 }) as any[];
  assert.equal(compacted.some((item) => item.callId === "dangling"), false);
  assert.equal(compacted.some((item) => item.callId === "complete" && item.type === "function_call"), true);
  assert.ok(compacted[0].content[0].text.length <= 83);

  const projected = projectAgentItemsToSessionMessages(compacted as any, 100);
  assert.equal(projected.some((message) => message.role === "reasoning" && message.text === "inspect context"), true);
  const toolMessage = projected.find((message) => message.role === "tool");
  assert.ok(toolMessage);
  assert.ok(toolMessage.text.length <= 303);
});

test("SDK stream projection merges deltas and emits a single final completion", () => {
  const events: AgentRuntimeEvent[] = [];
  const projector = new AgentMessageStreamProjector("run-1", (event) => events.push(event));
  projector.consume({
    type: "raw_model_stream_event",
    data: { type: "model", event: { choices: [{ delta: { reasoning_content: "think" } }] } },
  } as any);
  projector.consume({ type: "raw_model_stream_event", data: { type: "output_text_delta", delta: "Hel" } } as any);
  projector.consume({
    type: "run_item_stream_event",
    name: "message_output_created",
    item: {
      type: "message_output_item",
      content: "Hello",
      rawItem: {
        id: "message-1",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "Hello" }],
      },
    },
  } as any);
  projector.finish();
  projector.finalize("Hello world");

  assert.equal(events.filter((event) => event.type === "item_delta" && event.itemType === "reasoning").length, 1);
  const completed = events.filter((event) => event.type === "item_completed" && event.item.type === "agent_message");
  assert.equal(completed.length, 1);
  const completedMessage = completed[0];
  assert.equal(
    completedMessage.type === "item_completed" && completedMessage.item.type === "agent_message"
      ? completedMessage.item.text
      : "",
    "Hello"
  );
  const finalUpdate = events.find((event) => event.type === "item_updated" && event.item.type === "agent_message");
  assert.equal(
    finalUpdate?.type === "item_updated" && finalUpdate.item.type === "agent_message"
      ? finalUpdate.item.phase
      : "",
    "final_answer"
  );
  assert.equal(
    finalUpdate?.type === "item_updated" && finalUpdate.item.type === "agent_message"
      ? finalUpdate.item.text
      : "",
    "Hello world"
  );
});

test("React message projection is idempotent for replayed terminal events and trips on distinct repeated failures", () => {
  const state = new StyloMessageEventState();
  let messages: Message[] = [];
  const apply = (event: AgentRuntimeEvent) => {
    const projected = state.apply(messages, event);
    messages = projected.messages;
    return projected;
  };
  apply({ type: "turn_started", runId: "run-1", sessionId: "session-1", sequence: 1 });
  apply({ type: "item_delta", runId: "run-1", itemId: "message-1", itemType: "agent_message", delta: "Hi", accumulatedText: "Hi", sequence: 2 });
  const completedEvent: AgentRuntimeEvent = {
    type: "item_completed",
    runId: "run-1",
    item: { id: "message-1", type: "agent_message", status: "completed", text: "Hi", phase: "final_answer" },
    sequence: 3,
  };
  apply(completedEvent);
  apply(completedEvent);
  assert.equal(messages.filter((message) => message.kind === "chat" && message.role === "assistant").length, 1);

  const settledCall = { id: "call-1", type: "tool_call" as const, name: "read_document", status: "completed" as const, summary: "read" };
  apply({ type: "item_completed", runId: "run-1", item: settledCall, sequence: 4 });
  apply({ type: "item_completed", runId: "run-1", item: settledCall, sequence: 4 });
  assert.equal(messages.filter((message) => message.kind === "tool_result" && message.tool.callId === "call-1").length, 1);

  let abortReason = "";
  for (let index = 0; index < 5; index += 1) {
    const failure = apply({
      type: "item_completed",
      runId: "run-1",
      item: { id: `failed-${index}`, type: "tool_call", name: "read_document", status: "failed", error: "failed" },
      sequence: 5 + index,
    });
    abortReason = failure.abortReason || abortReason;
  }
  assert.match(abortReason, /连续失败 5 次/);
});

test("stream event buffering coalesces text deltas without swallowing ordered terminal events", () => {
  const buffer = new AgentStreamEventBuffer();
  assert.equal(buffer.push({
    type: "item_delta",
    runId: "run-1",
    itemId: "reasoning-1",
    itemType: "reasoning",
    delta: "a",
    accumulatedText: "a",
    sequence: 1,
  }), true);
  assert.equal(buffer.push({
    type: "item_delta",
    runId: "run-1",
    itemId: "reasoning-1",
    itemType: "reasoning",
    delta: "b",
    accumulatedText: "ab",
    sequence: 2,
  }), true);
  assert.equal(buffer.push({
    type: "item_delta",
    runId: "run-1",
    itemId: "answer-1",
    itemType: "agent_message",
    delta: "x",
    accumulatedText: "x",
    sequence: 3,
  }), true);
  assert.equal(buffer.push({
    type: "item_started",
    runId: "run-1",
    item: { id: "call-1", type: "tool_call", name: "read_document", status: "in_progress" },
    sequence: 4,
  }), false);

  const events = buffer.drain();
  assert.equal(events.length, 2);
  assert.equal(events[0].type, "item_delta");
  assert.equal(events[0].type === "item_delta" && events[0].accumulatedText, "ab");
  assert.equal(events[1].type, "item_delta");
  assert.deepEqual(buffer.drain(), []);
});

test("preflight cancellation is projected as a stopped task instead of a connection failure", () => {
  const state = new StyloMessageEventState();
  const pending = state.createPreflight([], "preflight-1");
  const messages = state.failPreflight(pending, "用户已停止当前 Agent 任务。");
  const status = messages.find((message) => message.kind === "status");

  assert.equal(status?.kind, "status");
  if (status?.kind !== "status") return;
  assert.equal(status.statusCard.status, "success");
  assert.equal(status.statusCard.headline, "已停止");
  assert.equal(status.statusCard.detail, "当前任务已由你手动停止。");
});

test("preflight failures project the actionable transport error", () => {
  const state = new StyloMessageEventState();
  let messages = state.createPreflight([], "preflight-1");
  messages = state.failPreflight(messages, "云端 Flow 修订为 7，本地请求修订为 9。");
  const status = messages.find((message) => message.kind === "status");

  assert.equal(status?.kind, "status");
  if (status?.kind !== "status") return;
  assert.equal(status.statusCard.detail, "云端 Flow 修订为 7，本地请求修订为 9。");
  assert.equal(status.statusCard.summary, "云端 Flow 修订为 7，本地请求修订为 9。");
  assert.equal(status.statusCard.isThinking, false);
});

test("Stylo Agent consumes each cancellation request token only once", () => {
  const source = readFileSync("node-workspace/components/StyloAgent.tsx", "utf8");

  assert.match(source, /handledCancelRequestRef\s*=\s*useRef<number>\(cancelRequest\)/);
  assert.match(source, /cancelRequest\s*!==\s*handledCancelRequestRef\.current/);
  assert.match(source, /handledCancelRequestRef\.current\s*=\s*cancelRequest/);
  assert.doesNotMatch(source, /if \(!cancelRequest \|\| !isSending\) return;/);
});

test("message timeline pairs tool transactions in O(n) projection order", () => {
  const messages: Message[] = [
    {
      role: "assistant",
      kind: "tool_result",
      order: 3,
      tool: { callId: "call-1", runId: "run-1", name: "read_document", status: "success" },
    },
    {
      role: "assistant",
      kind: "tool",
      order: 2,
      tool: { callId: "call-1", runId: "run-1", name: "read_document", status: "running" },
    },
    { role: "assistant", kind: "chat", order: 4, text: "done", meta: { runId: "run-1", isFinal: true } },
  ];
  const timeline = buildStyloMessageTimeline(messages);
  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].kind, "tool");
  assert.equal(timeline[0].kind === "tool" && timeline[0].thread.request?.tool.callId, "call-1");
  assert.equal(timeline[0].kind === "tool" && timeline[0].thread.result?.tool.callId, "call-1");
  assert.equal(timeline[1].kind === "chat" && timeline[1].message.text, "done");
});

test("message timeline renders work directly, removes redundant response status, and preserves approvals", () => {
  const messages: Message[] = [
    {
      role: "assistant",
      kind: "status",
      order: 1,
      statusCard: {
        id: "thinking-1",
        runId: "run-1",
        status: "success",
        headline: "思考",
        steps: [],
        startedAt: 100,
        updatedAt: 1_100,
        isThinking: true,
      },
    },
    {
      role: "assistant",
      kind: "tool_result",
      order: 2,
      tool: { callId: "call-1", runId: "run-1", name: "read_document", status: "success" },
    },
    {
      role: "assistant",
      kind: "chat",
      order: 3,
      text: "继续处理。",
      meta: { runId: "run-1", messageId: "progress-1", isFinal: false },
    },
    {
      role: "assistant",
      kind: "status",
      order: 3.5,
      statusCard: {
        id: "response-1",
        runId: "run-1",
        status: "success",
        headline: "本轮内容已生成",
        steps: [],
        startedAt: 1_100,
        updatedAt: 1_200,
      },
    },
    {
      role: "assistant",
      kind: "approval",
      order: 4,
      approval: {
        id: "approval-1",
        nodeId: "node-1",
        nodeTitle: "镜头图",
        action: "image_generation",
        providerLabel: "Image",
        modelLabel: "model",
        status: "pending",
        steps: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    {
      role: "assistant",
      kind: "chat",
      order: 5,
      text: "最终结果。",
      meta: { runId: "run-1", messageId: "final-1", isFinal: true },
    },
  ];

  const timeline = buildStyloMessageTimeline(messages);
  assert.equal(
    timeline.some((item) => item.kind === "status" && item.message.statusCard.id === "response-1"),
    false
  );
  assert.equal(timeline.some((item) => item.kind === "status" && item.message.statusCard.id === "thinking-1"), false);
  assert.equal(timeline.some((item) => item.kind === "tool"), true);
  assert.equal(timeline.some((item) => item.kind === "approval"), true);
  assert.equal(
    timeline.some((item) => item.kind === "chat" && item.message.text === "最终结果。"),
    true
  );
  assert.equal(
    timeline.some((item) => item.kind === "chat" && item.message.text === "继续处理。"),
    true
  );
  assert.equal(timeline.some((item) => (item as { kind?: string }).kind === "work"), false);
});

test("message timeline projects a synthetic long conversation within the rendering budget", () => {
  const messages: Message[] = [];
  for (let index = 0; index < 2_000; index += 1) {
    const runId = `run-${index}`;
    const callId = `call-${index}`;
    const order = index * 5;
    messages.push(
      { role: "user", kind: "chat", order, text: `任务 ${index}` },
      {
        role: "assistant",
        kind: "status",
        order: order + 1,
        statusCard: {
          id: `status-${index}`,
          runId,
          status: "success",
          headline: "思考",
          steps: [],
          startedAt: order,
          updatedAt: order + 10,
          isThinking: true,
        },
      },
      {
        role: "assistant",
        kind: "tool",
        order: order + 2,
        tool: { callId, runId, name: "read_document", status: "running" },
      },
      {
        role: "assistant",
        kind: "tool_result",
        order: order + 3,
        tool: { callId, runId, name: "read_document", status: "success" },
      },
      {
        role: "assistant",
        kind: "chat",
        order: order + 4,
        text: `完成 ${index}`,
        meta: { runId, messageId: `answer-${index}`, isFinal: true },
      }
    );
  }

  const startedAt = performance.now();
  const timeline = buildStyloMessageTimeline(messages);
  const elapsedMs = performance.now() - startedAt;

  assert.equal(timeline.length, 6_000);
  assert.ok(elapsedMs < 1_000, `10,000-message timeline projection took ${elapsedMs.toFixed(1)}ms`);
});

test("Agent follows streaming output but releases scroll position after completion", () => {
  const componentSource = readFileSync("node-workspace/components/stylo/StyloChatContent.tsx", "utf8");
  const styleSource = readFileSync("node-workspace/styles/nodeflow.css", "utf8");

  assert.match(componentSource, /const MessageItemView = memo/);
  assert.match(componentSource, /cancelAnimationFrame\(scrollFrameRef\.current\)/);
  assert.match(componentSource, /new ResizeObserver\(followLatestContent\)/);
  assert.match(componentSource, /new MutationObserver\(followLatestContent\)/);
  assert.match(componentSource, /if \(!isSending\) return/);
  assert.match(componentSource, /const shouldAttachRef = isSending/);
  assert.match(componentSource, /node\.scrollTop = getCurrentAnchorScrollTop\(node, currentNode\)/);
  assert.doesNotMatch(componentSource, /currentNode\.scrollTop\s*=/);
  assert.doesNotMatch(componentSource, /style=\{attachRef && latestBlockMaxHeight/);
  assert.match(styleSource, /\.stylo-message-item:not\(\[data-current="true"\]\)[\s\S]*content-visibility:\s*auto/);
  assert.match(styleSource, /contain-intrinsic-block-size:\s*auto 76px/);
});

test("Agent icons stay editorial while message surfaces follow Account theme panels", () => {
  const styleSource = readFileSync("node-workspace/styles/nodeflow.css", "utf8");
  const iconRule = styleSource.match(/\.stylo-message-icon\s*\{([^}]+)\}/)?.[1] || "";
  const approvalRule = styleSource.match(/\.stylo-approval-panel\s*\{([^}]+)\}/)?.[1] || "";

  assert.match(iconRule, /border-radius:\s*0/);
  assert.match(iconRule, /background:\s*transparent/);
  assert.match(iconRule, /box-shadow:\s*none/);
  assert.doesNotMatch(iconRule, /radial-gradient|filter:|text-shadow/);
  assert.match(approvalRule, /border-radius:\s*14px/);
  assert.match(approvalRule, /var\(--app-panel-muted\)/);
  assert.doesNotMatch(approvalRule, /radial-gradient|filter:|text-shadow/);
});

test("Agent messages are borderless while approvals remain explicit decision cards", () => {
  const componentSource = readFileSync("node-workspace/components/stylo/StyloChatContent.tsx", "utf8");
  const styleSource = readFileSync("node-workspace/styles/nodeflow.css", "utf8");
  const userRule = styleSource.match(/\.stylo-user-message\s*\{([^}]+)\}/)?.[1] || "";
  const assistantRule = styleSource.match(/\.stylo-assistant-answer\s*\{([^}]+)\}/)?.[1] || "";

  assert.match(componentSource, /className="stylo-assistant-answer/);
  assert.doesNotMatch(componentSource, /STYLO_PRIMARY_MESSAGE_VISUALS\.(user|assistant)/);
  assert.match(componentSource, /renderToolThread\(item\.thread\)/);
  assert.doesNotMatch(componentSource, /stylo-work-detail-row--tool group`} open=/);
  assert.doesNotMatch(componentSource, /WorkStageView|stylo-work-stage/);
  assert.match(componentSource, /data-status=\{approval\.status\}/);
  assert.match(userRule, /border:\s*0/);
  assert.match(userRule, /background:\s*transparent/);
  assert.match(userRule, /box-shadow:\s*none/);
  assert.match(assistantRule, /border:\s*0/);
  assert.match(assistantRule, /background:\s*transparent/);
  assert.match(assistantRule, /box-shadow:\s*none/);
  assert.match(styleSource, /\.stylo-work-detail-row \.stylo-message-icon\s*\{[\s\S]*opacity:\s*0\.58/);
  assert.match(styleSource, /\.stylo-approval-panel\[data-status="pending"\]\s*\{[\s\S]*border-color:\s*var\(--app-border-strong\)/);
  assert.doesNotMatch(styleSource, /\.stylo-approval-panel\[data-status="pending"\]\s*\{[^}]*inset 3px/);
});

test("Agent sending uses a synchronous lock and batches stream persistence work", () => {
  const agentSource = readFileSync("node-workspace/components/StyloAgent.tsx", "utf8");
  const controllerSource = readFileSync("agents/react/useStyloAgentController.ts", "utf8");

  assert.match(agentSource, /debounceMs:\s*180/);
  assert.match(agentSource, /conversationStateRef\.current\s*=\s*nextState/);
  assert.match(agentSource, /if \(!cleanedInput \|\| submittingRef\.current\) return/);
  assert.match(agentSource, /submittingRef\.current\s*=\s*true/);
  assert.match(agentSource, /submittingRef\.current\s*=\s*false/);
  assert.match(controllerSource, /streamEventQueueRef/);
  assert.match(controllerSource, /requestAnimationFrame/);
  assert.match(controllerSource, /AgentStreamEventBuffer/);
});

test("tool display outcomes do not present budget skips or no-ops as success", () => {
  assert.equal(resolveToolDisplayOutcome(undefined, {
    name: "operate_foundation",
    status: "success",
    summary: "Tool skipped: Tool budget exhausted",
    output: JSON.stringify({ target: "tool_budget", action: "skip", skipped: true }),
  }), "skipped");
  assert.equal(resolveToolDisplayOutcome(undefined, {
    name: "update_document",
    status: "success",
    summary: "Document not updated",
    output: JSON.stringify({ target: "document", action: "update", updated: false }),
  }), "no_change");
  assert.equal(resolveToolDisplayOutcome(undefined, {
    name: "read_document",
    status: "success",
    output: JSON.stringify({ target: "document", action: "read" }),
  }), "success");
});

test("Agent markdown accepts only HTTP(S) links", () => {
  assert.equal(normalizeSafeExternalUrl("javascript:alert(1)"), null);
  assert.equal(normalizeSafeExternalUrl("data:text/html,unsafe"), null);
  assert.equal(normalizeSafeExternalUrl("https://example.com/path"), "https://example.com/path");
});

test("stale durable Agent results cannot overwrite a newer Flow revision", () => {
  const result: StyloRunResult = {
    ...emptyResult(),
    updatedProjectPatch: { activeFlowProjectId: "project-1" },
    toolCalls: [
      { callId: "write-1", name: "update_document", status: "success" },
      { callId: "read-1", name: "read_document", status: "success" },
    ],
  };
  assert.equal(shouldRejectStaleAgentResult(result, 10, 11), true);
  assert.equal(shouldRejectStaleAgentResult(emptyResult(), 10, 11), false);
  const messages: Message[] = [
    { role: "assistant", kind: "tool_result", tool: { callId: "write-1", name: "update_document", status: "success" } },
    { role: "assistant", kind: "tool_result", tool: { callId: "read-1", name: "read_document", status: "success" } },
  ];
  const reconciled = reconcileStaleAgentMessages(messages, result, "conflict");
  assert.equal(reconciled[0].kind === "tool_result" && reconciled[0].tool.status, "error");
  assert.equal(reconciled[1].kind === "tool_result" && reconciled[1].tool.status, "success");
  const last = reconciled.at(-1);
  assert.equal(last?.kind === "chat" && last.text, "conflict");
});

test("HTTP stream packets validate shape and sequence guard rejects replay", () => {
  const event = parseAgentStreamPacket(JSON.stringify({
    kind: "event",
    event: { type: "item_delta", runId: "run-1", sequence: 2, itemId: "message-1", itemType: "agent_message", delta: "a", accumulatedText: "a" },
  }));
  assert.equal(event.kind, "event");
  assert.throws(
    () => parseAgentStreamPacket(JSON.stringify({ kind: "event", event: { type: "item_delta", runId: "run-1" } })),
    /Malformed Agent stream packet/
  );
  assert.throws(
    () => parseAgentStreamPacket(JSON.stringify({ kind: "event", event: { type: "unknown", runId: "run-1" } })),
    /Malformed Agent stream packet/
  );
  assert.throws(
    () => parseAgentStreamPacket(JSON.stringify({
      kind: "event",
      event: { type: "trace", runId: "wrapper-1", entry: {} },
    })),
    /Malformed Agent stream packet/
  );
  assert.throws(
    () => parseAgentStreamPacket(JSON.stringify({ kind: "result", result: emptyResult() })),
    /Malformed Agent stream packet/
  );
  const terminalPacket = parseAgentStreamPacket(JSON.stringify({
    kind: "event",
    event: { type: "turn_completed", runId: "run-1", sequence: 3, result: emptyResult() },
  }));
  assert.equal(terminalPacket.kind === "event" && terminalPacket.event.type, "turn_completed");

  const guard = new AgentEventSequenceGuard();
  const sequenced = event.kind === "event" ? event.event : null;
  assert.ok(sequenced);
  assert.equal(guard.accept(sequenced), true);
  assert.equal(guard.accept(sequenced), false);

  const lifecycle = new AgentTurnLifecycleGuard();
  lifecycle.accept({ type: "turn_started", runId: "run-1", sessionId: "session-1" });
  lifecycle.accept(sequenced);
  lifecycle.accept({ type: "turn_completed", runId: "run-1", result: emptyResult() });
  lifecycle.assertTerminal();
  assert.throws(
    () => lifecycle.accept({
      type: "item_completed",
      runId: "run-1",
      item: emptyResult().outputItems[0],
    }),
    /终态之后/
  );
});

test("SSE decoder handles CRLF frames, comments, and multi-line data", () => {
  const first = drainAgentSseBuffer(": heartbeat\r\ndata: {\"kind\":\r\ndata: \"event\"}\r\n\r\ndata: next");
  assert.deepEqual(first.packets, ['{"kind":\n"event"}']);
  assert.equal(first.remainder, "data: next");
  const flushed = drainAgentSseBuffer(first.remainder, true);
  assert.deepEqual(flushed.packets, ["next"]);
  assert.equal(flushed.remainder, "");
});

test("Agent run requests carry identity and revision but no project knowledge", () => {
  const request: AgentHttpRunRequest = {
    run: {
      projectId: "project-1",
      sessionId: "stylo:project-1:conversation-1",
      userText: "检查项目",
    },
    runtime: { provider: "deepseek", model: DEEPSEEK_DEFAULT_MODEL },
    project: { expectedRevision: 7 },
  };
  assert.deepEqual(Object.keys(request).sort(), ["project", "run", "runtime"]);
  assert.equal("projectData" in request, false);
  assert.equal("nodeFlow" in request, false);
  assert.deepEqual(request.project, { expectedRevision: 7 });
});

test("HTTP Agent runtime flushes sync before sending the minimal request", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ body: AgentHttpRunRequest; syncFinished: boolean }> = [];
  let revision = 3;
  let syncFinished = false;
  let leaseReleased = false;
  globalThis.fetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
    calls.push({
      body: JSON.parse(String(init?.body || "{}")) as AgentHttpRunRequest,
      syncFinished,
    });
    return new Response(
      serializeAgentStreamPacket({
        kind: "event",
        event: {
          type: "turn_started",
          runId: "run-1",
          sequence: 1,
          sessionId: "session-1",
        },
      }) + serializeAgentStreamPacket({
        kind: "event",
        event: {
          type: "turn_completed",
          runId: "run-1",
          sequence: 2,
          result: emptyResult("project-1"),
        },
      }), {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
      }
    );
  }) as typeof fetch;

  try {
    const runtime = createHttpStyloAgentRuntime({
      endpoint: "https://stylo.test/api/agent",
      getRuntimeConfig: () => ({ provider: "deepseek", model: DEEPSEEK_DEFAULT_MODEL }),
      beforeRequest: async () => {
        await Promise.resolve();
        revision = 9;
        syncFinished = true;
        return {
          expectedRevision: revision,
          release: () => {
            leaseReleased = true;
          },
        };
      },
      getProjectRevision: () => revision,
    });
    await runtime.run({
      projectId: "project-1",
      sessionId: "stylo:project-1:conversation-1",
      userText: "先自行探索项目",
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].syncFinished, true);
    assert.deepEqual(calls[0].body.project, { expectedRevision: 9 });
    assert.equal("projectData" in calls[0].body, false);
    assert.equal("nodeFlow" in calls[0].body, false);
    assert.deepEqual(Object.keys(calls[0].body).sort(), ["project", "run", "runtime"]);
    assert.equal(leaseReleased, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Agent project sync barrier uses an immutable snapshot lease instead of UI polling", () => {
  const syncSource = readFileSync("hooks/useCloudSync.ts", "utf8");
  assert.match(syncSource, /return scopedEngine\.engine\.acquire\(snapshot, expectedRevision\)/);
  assert.doesNotMatch(syncSource, /while \(readActiveFlowRevision/);
  assert.doesNotMatch(syncSource, /isSavingRef|pendingOpRef|saveRetryTimeout/);

  const engineSource = readFileSync("sync/realtimeProjectSyncEngine.ts", "utf8");
  assert.match(engineSource, /private lastLocalSend: Promise<number> \| null/);
  assert.match(engineSource, /private async applyAndWait\(snapshot: ProjectData\)/);
  assert.match(engineSource, /const sendsAtBoundary = Array\.from\(this\.inFlightSends\)/);
  assert.match(engineSource, /await Promise\.all\(sendsAtBoundary\)/);

  const agentSource = readFileSync("node-workspace/components/StyloAgent.tsx", "utf8");
  assert.match(agentSource, /const snapshot = mergeNodeFlowIntoProjectData/);
  assert.match(agentSource, /return ensureProjectSynced\(snapshot, expectedRevision\)/);
  assert.match(
    agentSource,
    /nodes: restoreLocalNodeMedia\(parsedCandidateFlow\.nodes, currentFlow\.nodes\)/
  );
});

test("Agent instructions start without environment or operational-memory injection", () => {
  const instructions = composeAgentInstructions({ enabledSkills: [] })({
    context: {
      runtimeMode: "edge_full",
      toolBudget: {
        totalCalls: 0,
        lookupCalls: 0,
        mutationCalls: 0,
        fullReadCalls: 0,
        limits: { totalCalls: 10, lookupCalls: 10, mutationCalls: 4, fullReadCalls: 4 },
      },
      agentEnvironment: { project: { fileName: "must-not-leak" } },
      agentMemory: { recentSuccessfulTools: [{ summary: "must-not-leak" }] },
    },
  } as any);
  assert.match(instructions, /Start with no project knowledge/);
  assert.doesNotMatch(instructions, /Environment Snapshot|Operational Memory|must-not-leak/);
});

test("Edge Agent rebuilds tool state from the realtime D1 document", () => {
  const state = buildAgentProjectStateFromRealtimeDocument("project-1", {
    fileName: "Project",
    roles: [],
    designAssets: [],
    canvas: {},
    activeFlowProjectId: "project-1",
    flowProjects: [{
      id: "project-1",
      title: "Project",
      color: "#000000",
      durationMin: 0,
      rootNodeId: "root",
      createdAt: 1,
      updatedAt: 2,
      flow: {
        revision: 7,
        links: [],
        graphLinks: [],
        linkStyle: "angular",
        flowNodes: [{ id: "text-1", type: "text", position: { x: 0, y: 0 }, data: { title: "Note", text: "secret" } }],
      },
    }],
  }, 9);
  assert.equal(state.projectData.activeFlowProjectId, "project-1");
  assert.equal(state.nodeFlow.revision, 7);
  assert.equal(state.nodeFlow.nodes[0].data.text, "secret");
  assert.equal(state.updatedAt, 9);
});

test("Edge Agent repairs null link data from realtime D1 documents", () => {
  const state = buildAgentProjectStateFromRealtimeDocument("project-1", {
    fileName: "Project",
    roles: [],
    designAssets: [],
    canvas: {},
    activeFlowProjectId: "project-1",
    flowProjects: [{
      id: "project-1",
      title: "Project",
      flow: {
        revision: 8,
        graphLinks: [],
        flowNodes: [
          { id: "source", type: "text", position: { x: 0, y: 0 }, data: { text: "A" } },
          { id: "target", type: "text", position: { x: 100, y: 0 }, data: { text: "B" } },
        ],
        links: Array.from({ length: 8 }, (_, index) => ({
          id: `link-${index + 1}`,
          source: "source",
          target: "target",
          data: null,
        })),
      },
    }],
  }, 10);

  assert.equal(state.nodeFlow.links.length, 8);
  assert.equal(state.nodeFlow.links.every((link) => link.data === undefined), true);
  assert.equal(state.nodeFlow.links.every((link) => !Object.hasOwn(link, "data")), true);
});

test("runtime core does not mutate process-wide OpenAI Agents SDK defaults", () => {
  const source = readFileSync("agents/runtime/core.ts", "utf8");
  assert.doesNotMatch(source, /setDefaultOpenAIClient|setOpenAIAPI/);
  assert.match(source, /createStyloProviderRuntime/);
});

test("prompt catalog follows the registered tool graph and excludes legacy tool files", () => {
  const source = readFileSync("agents/runtime/promptCatalog.generated.ts", "utf8");
  assert.doesNotMatch(source, /agents\/tools\/(editScriptResource|getEpisodeScript|getSceneScript)\.ts/);
});

test("Edge sessions use optimistic concurrency and the API delegates bridge and stream adapters", () => {
  const sessionSource = readFileSync("functions/api/_agentSessions.ts", "utf8");
  assert.match(sessionSource, /WHERE session_key=\?1 AND project_id=\?4 AND user_id IS \?3 AND updated_at=\?8/);
  assert.match(sessionSource, /Agent session update conflicted repeatedly/);
  const apiSource = readFileSync("functions/api/agent.ts", "utf8");
  assert.match(apiSource, /from "\.\/_agentBridgeState"/);
  assert.match(apiSource, /from "\.\/_agentProjectState"/);
  assert.match(apiSource, /from "\.\/_agentStream"/);
  assert.doesNotMatch(apiSource, /body\.projectData|body\.nodeFlow/);
  assert.ok(apiSource.split("\n").length < 450);
});
