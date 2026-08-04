import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AGENT_ACCESS_TOKEN_PREFIX,
  AGENT_ACCESS_TTL_MS,
  DEVICE_CODE_PREFIX,
  PAIRING_TTL_MS,
  createUserCode,
  normalizeUserCode,
  randomSecret,
  sha256Base64Url,
} from "../functions/api/_agentAccess";
import type { StyloAgentBridge } from "../agents/bridge/styloBridge";
import { STYLO_TOOL_CATALOG } from "../agents/runtime/toolCatalog";
import {
  executeStyloCapability,
  listStyloToolDefinitions,
} from "../agents/tools";
import {
  CODEX_FULL_CAPABILITIES,
  CODEX_INITIAL_CAPABILITIES,
  buildStyloToolManifest,
  getCodexCapabilitiesForScope,
} from "../agents/tools/manifest";
import {
  createAgentProjectData,
  createNodeFlowBridgeState,
  mergeAgentNodeFlowIntoProjectData,
} from "../functions/api/_agentBridgeState";

const createReadOnlyBridge = (): StyloAgentBridge => {
  const projectData = {
    fileName: "Gateway fixture",
    activeFlowProjectId: "project-gateway-test",
    flowProjects: [],
    roles: [],
    designAssets: [],
    rawScript: "",
    episodes: [],
    flow: {
      revision: 0,
      flowNodes: [],
      links: [],
      graphLinks: [],
      globalAssetHistory: [],
    },
  } as any;
  const nodeFlow = {
    version: 2,
    revision: 0,
    name: "Gateway fixture",
    nodes: [],
    links: [],
    graphLinks: [],
    globalAssetHistory: [],
    nodeFlowContext: {
      rawScript: "",
      episodes: [],
      roles: [],
      designAssets: [],
    },
    activeView: null,
  } as any;
  const denyMutation = () => {
    throw new Error("fixture mutation must not run");
  };
  return {
    getProjectData: () => projectData,
    getNodeFlowSnapshot: () => nodeFlow,
    getPendingNodeFlowExecutionApprovals: () => [],
    updateProjectData: denyMutation,
    addTextNode: denyMutation,
    createNodeFlowNode: denyMutation,
    updateNodeFlowNode: denyMutation,
    moveNodeFlowNode: denyMutation,
    removeNodeFlowNode: denyMutation,
    updateNodeFlowNodeData: denyMutation,
    createNodeFlowGraphLink: denyMutation,
    connectNodeFlowNodes: denyMutation,
    removeNodeFlowLink: denyMutation,
    getNodeFlowNode: () => null,
    createNodeFlowMap: denyMutation,
    requestNodeFlowExecutionApproval: denyMutation,
    clearNodeFlowExecutionApproval: denyMutation,
    getViewport: () => null,
    getNodeCount: () => 0,
  } as StyloAgentBridge;
};

test("Codex manifest is a progressive-disclosure view over the shared Stylo registry", () => {
  assert.deepEqual(CODEX_INITIAL_CAPABILITIES, ["project_read"]);
  const expectedNames = STYLO_TOOL_CATALOG
    .filter((descriptor) => descriptor.capability === "project_read")
    .map((descriptor) => descriptor.name)
    .sort();
  const definitions = listStyloToolDefinitions(CODEX_INITIAL_CAPABILITIES);
  const manifest = buildStyloToolManifest();

  assert.deepEqual(listStyloToolDefinitions([]), []);
  assert.deepEqual(definitions.map((definition) => definition.name).sort(), expectedNames);
  assert.deepEqual(manifest.map((tool) => tool.name).sort(), expectedNames);
  assert.ok(manifest.every((tool) => tool.annotations.readOnlyHint));
  assert.ok(manifest.every((tool) => tool.annotations.idempotentHint));
  assert.ok(manifest.every((tool) => tool.annotations.destructiveHint === false));
  assert.ok(manifest.every((tool) => tool.inputSchema.type === "object"));
});

test("full Codex scope exposes shared project operations without client-only generation approvals", () => {
  assert.deepEqual(getCodexCapabilitiesForScope("project_read"), CODEX_INITIAL_CAPABILITIES);
  assert.deepEqual(getCodexCapabilitiesForScope("project_full"), CODEX_FULL_CAPABILITIES);
  const manifest = buildStyloToolManifest(CODEX_FULL_CAPABILITIES);
  const names = manifest.map((tool) => tool.name);
  assert.ok(names.includes("create_document"));
  assert.ok(names.includes("move_flow_node"));
  assert.ok(names.includes("operate_foundation"));
  assert.ok(names.includes("read_runtime_manual"));
  assert.ok(names.includes("search_web"));
  assert.ok(!names.includes("prepare_generation_execution"));
  assert.ok(!names.includes("cancel_generation_execution"));
  assert.equal(manifest.find((tool) => tool.name === "create_document")?.annotations.readOnlyHint, false);
  assert.equal(manifest.find((tool) => tool.name === "update_document")?.annotations.destructiveHint, true);
  assert.equal(manifest.find((tool) => tool.name === "operate_foundation")?.annotations.destructiveHint, true);
});

test("external Bridge mutations merge into only the selected realtime Flow and advance revision", async () => {
  const source = {
    fileName: "Gateway fixture",
    activeFlowProjectId: "project-gateway-test",
    flowProjects: [{
      id: "project-gateway-test",
      title: "Gateway fixture",
      color: "amber",
      durationMin: 120,
      rootNodeId: "project-root-project-gateway-test",
      createdAt: 1,
      updatedAt: 1,
      flow: { revision: 0, flowNodes: [], links: [] },
    }],
    roles: [],
    designAssets: [],
    rawScript: "",
    episodes: [],
    canvas: { viewport: null },
    flow: { revision: 0, flowNodes: [], links: [] },
    stats: { context: { total: 0, success: 0, error: 0 } },
  } as any;
  const nodeFlow = {
    version: 2,
    revision: 0,
    name: "Gateway fixture",
    nodes: [],
    links: [],
    graphLinks: [],
    globalAssetHistory: [],
    activeView: null,
  } as any;
  const agentProjectData = createAgentProjectData(source, nodeFlow, "project-gateway-test");
  const bridgeState = createNodeFlowBridgeState(agentProjectData, nodeFlow);
  await executeStyloCapability({
    toolName: "create_document",
    input: { document_kind: "note", title: "Codex note", content: "temporary" },
    bridge: bridgeState.bridge,
    allowedCapabilities: CODEX_FULL_CAPABILITIES,
  });
  const merged = mergeAgentNodeFlowIntoProjectData(
    source,
    bridgeState.getProjectData(),
    bridgeState.getNodeFlow(),
    "project-gateway-test",
    2,
  );
  assert.equal(merged.flow?.revision, 1);
  assert.equal(merged.flowProjects?.[0]?.flow.revision, 1);
  assert.equal(merged.flowProjects?.[0]?.flow.flowNodes?.[0]?.data?.title, "Codex note");
});

test("protocol-neutral capability execution serves reads and blocks mutations before Bridge access", async () => {
  const bridge = createReadOnlyBridge();
  const result = await executeStyloCapability({
    toolName: "find_documents",
    input: { document_kind: "all", max_items: 3 },
    bridge,
    allowedCapabilities: CODEX_INITIAL_CAPABILITIES,
  });
  assert.equal(result.name, "find_documents");
  assert.equal(result.descriptor.capability, "project_read");
  assert.deepEqual((result.output as { items: unknown[] }).items, []);

  await assert.rejects(
    executeStyloCapability({
      toolName: "create_document",
      input: { document_kind: "archive", title: "must not be created" },
      bridge,
      allowedCapabilities: CODEX_INITIAL_CAPABILITIES,
    }),
    /project_write is not available/
  );
});

test("external MCP and API adapters do not import the internal Agent runtime pipeline", () => {
  const mcpSource = readFileSync("scripts/stylo-mcp-server.mjs", "utf8");
  const endpointSource = readFileSync("functions/api/agent-tools.ts", "utf8");
  for (const forbidden of [
    "runStyloAgentCore",
    "runtime/memory",
    "streamProjector",
    "styloMessageState",
    "_agentTracing",
  ]) {
    assert.doesNotMatch(mcpSource, new RegExp(forbidden));
    assert.doesNotMatch(endpointSource, new RegExp(forbidden));
  }
  assert.match(endpointSource, /flushRealtimeProjectProjection/);
  assert.match(endpointSource, /loadAgentProjectState/);
  assert.match(endpointSource, /executeStyloCapability/);
  assert.match(endpointSource, /applyRealtimeAgentProjectSnapshot/);
  const realtimeSource = readFileSync("realtime-worker/src/index.ts", "utf8");
  assert.match(realtimeSource, /pathname === "\/agent-apply"/);
  assert.match(realtimeSource, /currentRevision !== expectedRevision \|\| this\.serverSeq !== expectedServerSeq/);
  assert.match(realtimeSource, /INSERT INTO room_operations/);
  assert.match(realtimeSource, /this\.sendSocketMessage\(peer, broadcast\)/);
});

test("Codex device pairing uses short-lived high-entropy secrets and normalized human codes", async () => {
  assert.equal(PAIRING_TTL_MS, 10 * 60 * 1_000);
  assert.equal(AGENT_ACCESS_TTL_MS, 8 * 60 * 60 * 1_000);
  assert.equal(normalizeUserCode("abcd efgh"), "ABCD-EFGH");
  assert.equal(normalizeUserCode("abc"), "");

  const userCode = createUserCode();
  assert.match(userCode, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  const deviceCode = randomSecret(DEVICE_CODE_PREFIX);
  const accessToken = randomSecret(AGENT_ACCESS_TOKEN_PREFIX);
  assert.match(deviceCode, /^stylo_device_[A-Za-z0-9_-]{43}$/);
  assert.match(accessToken, /^stylo_agent_[A-Za-z0-9_-]{43}$/);
  assert.equal((await sha256Base64Url(accessToken)).length, 43);
  assert.notEqual(await sha256Base64Url(accessToken), accessToken);
});

test("pairing adapters keep credentials out of browser storage, logs, and the internal Agent runtime", () => {
  const endpointSource = readFileSync("functions/api/codex-pairing.ts", "utf8");
  const authSource = readFileSync("functions/api/_agentAccess.ts", "utf8");
  const dialogSource = readFileSync("components/CodexConnectDialog.tsx", "utf8");
  const connectSource = readFileSync("scripts/stylo-connect.mjs", "utf8");
  const mcpSource = readFileSync("scripts/stylo-mcp-server.mjs", "utf8");

  assert.match(endpointSource, /sha256Base64Url\(accessToken\)/);
  assert.match(endpointSource, /requested_scope/);
  assert.match(endpointSource, /expectedScope/);
  assert.doesNotMatch(endpointSource, /\.bind\(\s*accessToken\s*,/);
  assert.doesNotMatch(dialogSource, /localStorage|indexedDB|document\.cookie|getToken/);
  assert.doesNotMatch(connectSource, /console\.log\([^\n]*accessToken/);
  assert.match(mcpSource, /loadStyloCredential/);
  assert.match(mcpSource, /\/api\/agent-projects/);
  assert.match(mcpSource, /expectedRevision/);
  assert.match(readFileSync(".codex/config.toml", "utf8"), /default_tools_approval_mode = "writes"/);

  for (const source of [endpointSource, authSource, dialogSource, connectSource, mcpSource]) {
    assert.doesNotMatch(source, /runStyloAgentCore|runtime\/memory|streamProjector|styloMessageState|_agentTracing/);
  }
});

test("stdio MCP host initializes with identity-only management tools when unauthenticated", async (t) => {
  const child = spawn(process.execPath, ["scripts/stylo-mcp-server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      STYLO_AUTH_TOKEN: "",
      STYLO_PROJECT_ID: "",
      STYLO_API_BASE_URL: "https://example.invalid",
      STYLO_CREDENTIAL_FILE: `/tmp/stylo-codex-test-missing-${process.pid}.json`,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill());

  const messages: any[] = [];
  let stdoutBuffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) messages.push(JSON.parse(line));
    }
  });

  const waitForMessage = async (id: number) => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const match = messages.find((message) => message.id === id);
      if (match) return match;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for MCP response ${id}`);
  };

  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "stylo-gateway-test", version: "1.0.0" },
    },
  })}\n`);
  const initialized = await waitForMessage(1);
  assert.equal(initialized.result.serverInfo.name, "stylo-agentic-gateway");

  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  })}\n`);
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  })}\n`);
  const listed = await waitForMessage(2);
  const names = listed.result.tools.map((tool: { name: string }) => tool.name);
  assert.deepEqual(names, [
    "stylo_connection_status",
    "stylo_list_projects",
    "stylo_select_project",
  ]);
});
