import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { performance } from "node:perf_hooks";
import { createHttpStyloAgentRuntime } from "../agents/runtime/httpClient";
import {
  parseAgentStreamPacket,
  serializeAgentStreamPacket,
} from "../agents/runtime/httpProtocol";
import { AGENT_TRANSPORT_LIMITS } from "../agents/runtime/limits";
import { readBoundedResponseText } from "../agents/tools/httpSafety";
import { AgentEventStreamWriter } from "../functions/api/_agentStream";
import { splitAgentScriptEditProposals } from "../functions/api/_agentBridgeState";
import { acquireAgentTurnLease, releaseAgentTurnLease } from "../functions/api/_agentTurnCoordinator";
import {
  updateConversationMessages,
  type ConversationState,
} from "../node-workspace/components/stylo/conversationState";
import type { NodeFlowFile } from "../node-workspace/types";

const nodeFlow = (content: string, revision = 1): NodeFlowFile => ({
  version: 2,
  revision,
  name: "Flow",
  nodes: [{
    id: "script-1",
    type: "scriptPage",
    position: { x: 0, y: 0 },
    data: {
      title: "第一场",
      documentId: "document-1",
      text: content,
      content,
      preview: content,
      updatedAt: 1,
    },
  }],
  links: [],
  graphLinks: [],
  linkStyle: "angular",
  globalAssetHistory: [],
  activeView: null,
});

test("delta-only protocol keeps wire growth linear", () => {
  const startedAt = performance.now();
  const sizes: number[] = [];
  let bytes = 0;
  for (let sequence = 1; sequence <= 4_000; sequence += 1) {
    const frame = serializeAgentStreamPacket({
      kind: "event",
      event: {
        type: "item_delta",
        runId: "run-linear",
        itemId: "answer-1",
        itemType: "agent_message",
        delta: "x",
        sequence,
      },
    });
    assert.doesNotMatch(frame, /accumulatedText/);
    const size = Buffer.byteLength(frame);
    sizes.push(size);
    bytes += size;
  }
  const elapsedMs = performance.now() - startedAt;
  assert.ok(Math.max(...sizes) - Math.min(...sizes) < 8);
  assert.ok(bytes < 1_000_000, `delta stream unexpectedly used ${bytes} bytes`);
  assert.ok(elapsedMs < 1_000, `delta serialization took ${elapsedMs.toFixed(1)}ms`);
});

test("server stream writer coalesces deltas and preserves the terminal event under backpressure", async () => {
  let writer!: AgentEventStreamWriter;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      writer = new AgentEventStreamWriter(controller);
    },
    pull() {
      writer.pull();
    },
  });
  for (let sequence = 1; sequence <= 100; sequence += 1) {
    writer.emit({
      type: "item_delta",
      runId: "run-1",
      itemId: "answer-1",
      itemType: "agent_message",
      delta: "x",
      sequence,
    });
  }
  writer.emit({
    type: "turn_completed",
    runId: "run-1",
    sequence: 101,
    result: { projectId: "project-1", sessionId: "session-1" },
  });

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const frames: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    const { value } = await reader.read();
    frames.push(decoder.decode(value));
  }
  await reader.cancel();
  writer.dispose();

  const packets = frames.map((frame) => parseAgentStreamPacket(frame.replace(/^data: /, "").trim()));
  const delta = packets[0].kind === "event" ? packets[0].event : null;
  assert.equal(delta?.type, "item_delta");
  assert.equal(delta?.type === "item_delta" && delta.delta.length, 100);
  assert.equal(packets[1].kind === "event" && packets[1].event.type, "turn_completed");
});

test("server stream writer converts an oversized terminal payload into a bounded failure terminal", async () => {
  let writer!: AgentEventStreamWriter;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      writer = new AgentEventStreamWriter(controller);
    },
    pull() {
      writer.pull();
    },
  });
  writer.emit({
    type: "turn_completed",
    runId: "run-large-terminal",
    sequence: 1,
    result: {
      projectId: "project-1",
      sessionId: "session-1",
      scriptEditProposals: [{
        id: "proposal-1",
        nodeId: "script-1",
        title: "large",
        content: "x".repeat(AGENT_TRANSPORT_LIMITS.frameBytes),
        receivedAt: 1,
      }],
    },
  });
  const reader = stream.getReader();
  const { value } = await reader.read();
  const raw = new TextDecoder().decode(value).replace(/^data: /, "").trim();
  const packet = parseAgentStreamPacket(raw);
  assert.equal(packet.kind === "event" && packet.event.type, "turn_failed");
  if (packet.kind === "event" && packet.event.type === "turn_failed") {
    assert.match(packet.event.error, /单帧上限/);
  }
  await reader.cancel();
  writer.dispose();
});

test("terminal packets discard legacy project snapshots and duplicate output payloads", () => {
  const packet = parseAgentStreamPacket(JSON.stringify({
    kind: "event",
    event: {
      type: "turn_completed",
      runId: "run-1",
      result: {
        projectId: "project-1",
        sessionId: "session-1",
        finalText: "duplicated",
        outputItems: [{ id: "answer-1" }],
        toolCalls: [{ callId: "call-1" }],
        updatedProjectData: { fileName: "oversized" },
        updatedNodeFlow: nodeFlow("oversized"),
        projectCommit: { operationId: "agent:1", baseRevision: 1, revision: 2, serverSeq: 4 },
      },
    },
  }));
  assert.equal(packet.kind, "event");
  if (packet.kind !== "event" || packet.event.type !== "turn_completed") return;
  assert.equal("finalText" in packet.event.result, false);
  assert.equal("outputItems" in packet.event.result, false);
  assert.equal("toolCalls" in packet.event.result, false);
  assert.equal("updatedProjectData" in packet.event.result, false);
  assert.equal("updatedNodeFlow" in packet.event.result, false);
  assert.equal(packet.event.result.projectCommit?.revision, 2);
});

test("script edits remain review-gated while unrelated Agent mutations can commit", () => {
  const source = nodeFlow("旧文本", 7);
  const candidate = nodeFlow("新文本", 8);
  candidate.nodes[0] = {
    ...candidate.nodes[0],
    data: { ...candidate.nodes[0].data, title: "新标题", updatedAt: 2 },
  };
  const reviewOnly = splitAgentScriptEditProposals(source, candidate, 123);
  assert.equal(reviewOnly.proposals.length, 1);
  assert.equal(reviewOnly.proposals[0].content, "新文本");
  assert.equal(reviewOnly.proposals[0].title, "新标题");
  assert.equal(reviewOnly.hasCommittedNodeFlowMutation, false);
  assert.equal(reviewOnly.committedNodeFlow.nodes[0].data.content, "旧文本");
  assert.equal(reviewOnly.committedNodeFlow.nodes[0].data.title, "第一场");

  candidate.nodes.push({
    id: "note-1",
    type: "text",
    position: { x: 10, y: 20 },
    data: { title: "可提交笔记", text: "hello" },
  });
  const mixed = splitAgentScriptEditProposals(source, candidate, 124);
  assert.equal(mixed.proposals.length, 1);
  assert.equal(mixed.hasCommittedNodeFlowMutation, true);
  assert.equal(mixed.committedNodeFlow.nodes.some((node) => node.id === "note-1"), true);
  assert.equal(mixed.committedNodeFlow.nodes[0].data.content, "旧文本");
});

test("conversation updates stay bound to the originating conversation", () => {
  const state: ConversationState = {
    activeId: "conversation-b",
    items: [
      { id: "conversation-a", title: "A", createdAt: 1, updatedAt: 1, messages: [] },
      { id: "conversation-b", title: "B", createdAt: 1, updatedAt: 1, messages: [] },
    ],
  };
  const result = updateConversationMessages(state, "conversation-a", (messages) => [
    ...messages,
    { role: "assistant", kind: "chat", text: "A 的流事件" },
  ]);
  assert.equal(result.state.activeId, "conversation-b");
  assert.equal(result.state.items[0].messages.length, 1);
  assert.equal(result.state.items[1].messages.length, 0);
});

test("turn coordinator permits one live writer per session and rejects idempotency replay", async () => {
  type Lease = { turnId: string; idempotencyKey: string; expiresAt: number };
  const leases = new Map<string, Lease>();
  const database = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              if (sql.startsWith("DELETE")) {
                const [sessionKey, turnId] = values as [string, string];
                if (leases.get(sessionKey)?.turnId === turnId) leases.delete(sessionKey);
                return { meta: { changes: 1 } };
              }
              const [sessionKey, turnId, idempotencyKey, , , now, expiresAt] = values as [
                string,
                string,
                string,
                string,
                string,
                number,
                number,
              ];
              if ([...leases.values()].some((lease) => lease.idempotencyKey === idempotencyKey)) {
                throw new Error("UNIQUE constraint failed: agent_turn_leases.user_id, agent_turn_leases.idempotency_key");
              }
              const existing = leases.get(sessionKey);
              if (existing && existing.expiresAt > now) return { meta: { changes: 0 } };
              leases.set(sessionKey, { turnId, idempotencyKey, expiresAt });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  } as any;
  const acquire = (sessionKey: string, turnId: string, idempotencyKey: string, now: number) =>
    acquireAgentTurnLease({
      db: database,
      sessionKey,
      turnId,
      idempotencyKey,
      userId: "user-1",
      projectId: "project-1",
      now,
    });

  assert.equal(await acquire("session-1", "turn-1", "key-1", 1_000), true);
  assert.equal(await acquire("session-1", "turn-2", "key-2", 2_000), false);
  assert.equal(await acquire("session-2", "turn-3", "key-1", 2_000), false);
  await releaseAgentTurnLease(database, "session-1", "wrong-turn");
  assert.equal(await acquire("session-1", "turn-2", "key-2", 3_000), false);
  await releaseAgentTurnLease(database, "session-1", "turn-1");
  assert.equal(await acquire("session-1", "turn-2", "key-2", 4_000), true);
  assert.equal(await acquire("session-1", "turn-3", "key-3", 400_000), true);
});

test("large requests and external tool responses fail before unbounded buffering", async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("fetch should not run");
  }) as typeof fetch;
  try {
    const runtime = createHttpStyloAgentRuntime({
      endpoint: "https://stylo.test/api/agent",
      getRuntimeConfig: () => ({ model: "test-model" }),
      getProjectRevision: () => 1,
    });
    await assert.rejects(() => runtime.run({
      projectId: "project-1",
      sessionId: "stylo:project-1:conversation-1",
      userText: "test",
      uiContext: { supplementalContextText: "x".repeat(AGENT_TRANSPORT_LIMITS.requestBytes + 1) },
    }), /输入过大/);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }

  await assert.rejects(
    () => readBoundedResponseText(new Response("x".repeat(65)), { maxBytes: 64 }),
    /exceeds/,
  );
});

test("architecture routes durable changes through realtime authority and keeps streaming render cheap", () => {
  const api = readFileSync("functions/api/agent.ts", "utf8");
  const commit = readFileSync("functions/api/_agentProjectCommit.ts", "utf8");
  const component = readFileSync("node-workspace/components/StyloAgent.tsx", "utf8");
  const chat = readFileSync("node-workspace/components/stylo/StyloChatContent.tsx", "utf8");
  const persistence = readFileSync("hooks/useAsyncPersistedState.ts", "utf8");
  const electron = readFileSync("electron/main.cjs", "utf8");
  const entry = readFileSync("index.tsx", "utf8");
  assert.match(api, /commitAgentBridgeResult/);
  assert.match(commit, /applyRealtimeAgentProjectSnapshot/);
  assert.match(api, /acquireAgentTurnLease/);
  assert.match(api, /AGENT_EXTERNAL_TOOLS_ENABLED/);
  assert.doesNotMatch(component, /runResult\.updatedProjectData|runResult\.updatedNodeFlow/);
  assert.match(chat, /message\.meta\?\.isStreaming[\s\S]*whitespace-pre-wrap/);
  assert.match(chat, /aria-live=\{isSending \? "off" : "polite"\}/);
  assert.match(persistence, /indexedDB\.open/);
  assert.match(persistence, /new BroadcastChannel/);
  assert.match(persistence, /localMutationVersionRef/);
  assert.match(readFileSync("agents/runtime/core.ts", "utf8"), /styloResultFinalizationFailure/);
  assert.match(readFileSync("agents/react/useStyloAgentController.ts", "utf8"), /runConversationIdRef/);
  assert.match(electron, /render-process-gone/);
  assert.match(electron, /renderer-unresponsive/);
  assert.match(electron, /stylo-runtime-diagnostics\.log/);
  assert.match(entry, /AppErrorBoundary/);
});
