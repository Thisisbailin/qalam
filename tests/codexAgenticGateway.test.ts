import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { StyloAgentBridge } from "../agents/bridge/styloBridge";
import { STYLO_TOOL_CATALOG } from "../agents/runtime/toolCatalog";
import {
  executeStyloCapability,
  listStyloToolDefinitions,
} from "../agents/tools";
import {
  CODEX_INITIAL_CAPABILITIES,
  buildStyloToolManifest,
} from "../agents/tools/manifest";

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
});

test("stdio MCP host initializes with identity-only management tools when unauthenticated", async (t) => {
  const child = spawn(process.execPath, ["scripts/stylo-mcp-server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      STYLO_AUTH_TOKEN: "",
      STYLO_PROJECT_ID: "",
      STYLO_API_BASE_URL: "https://example.invalid",
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
