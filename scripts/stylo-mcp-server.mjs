#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadStyloCredential } from "./stylo-credential-store.mjs";

const DEFAULT_API_BASE_URL = "https://node-qalam.pages.dev";
let apiBaseUrl = (process.env.STYLO_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
const environmentAuthToken = (process.env.STYLO_AUTH_TOKEN || "").trim();
let authToken = environmentAuthToken;
let authSource = environmentAuthToken ? "environment" : "none";
let authExpiresAt = null;
let authScope = environmentAuthToken ? "clerk" : null;
let activeProjectId = (process.env.STYLO_PROJECT_ID || "").trim();
let activeProjectRevision = null;
let manifestCache = null;
let manifestCacheTime = 0;
let lastManifestError = "";

const MANAGEMENT_TOOLS = [
  {
    name: "stylo_connection_status",
    title: "检查 Stylo 连接",
    description: "Check the external Stylo Agent host connection without reading project content.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "stylo_list_projects",
    title: "列出 Stylo 项目",
    description: "List a small identity-only page of available Stylo projects. Does not preload project content.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional exact title or project id filter." },
        max_items: { type: "integer", minimum: 1, maximum: 50, description: "Maximum identities to return; defaults to 12." },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "stylo_select_project",
    title: "选择 Stylo 项目",
    description: "Bind this MCP process to one accessible Stylo project. Returns identity only and does not read project content.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Exact project id returned by stylo_list_projects." },
      },
      required: ["project_id"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];

const parseResponse = async (response, action) => {
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text || `${action} failed` };
  }
  if (!response.ok) {
    const detail = typeof payload?.error === "string" ? payload.error : `${action} failed`;
    const code = typeof payload?.code === "string" ? ` · ${payload.code}` : "";
    const revision = Number.isInteger(payload?.currentRevision)
      ? ` · current revision ${payload.currentRevision}`
      : "";
    throw new Error(`${detail} (HTTP ${response.status}${code}${revision})`);
  }
  return payload;
};

const styloRequest = async (path, init = {}) => {
  await refreshCredential();
  if (!authToken) {
    throw new Error("Stylo is not connected. Run `npm run mcp:stylo:connect` and approve the pairing code in the Stylo desktop app.");
  }
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${authToken}`,
      ...init.headers,
    },
  });
  return parseResponse(response, `${init.method || "GET"} ${path}`);
};

const loadManifest = async ({ force = false } = {}) => {
  await refreshCredential();
  if (!authToken) return [];
  const now = Date.now();
  if (!force && manifestCache && now - manifestCacheTime < 30_000) return manifestCache;
  try {
    const payload = await styloRequest("/api/agent-tools");
    manifestCache = Array.isArray(payload.tools) ? payload.tools : [];
    authScope = typeof payload.scope === "string" ? payload.scope : authScope;
    manifestCacheTime = now;
    lastManifestError = "";
    return manifestCache;
  } catch (error) {
    lastManifestError = error instanceof Error ? error.message : String(error);
    return manifestCache || [];
  }
};

const listProjects = async ({ query = "", maxItems = 12 } = {}) => {
  const payload = await styloRequest("/api/agent-projects");
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase();
  const limit = Math.max(1, Math.min(50, Number.isInteger(maxItems) ? maxItems : 12));
  const projects = (Array.isArray(payload.projects) ? payload.projects : [])
    .filter((project) => {
      if (!normalizedQuery) return true;
      return [project.projectId, project.title]
        .filter((value) => typeof value === "string")
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    })
    .slice(0, limit)
    .map((project) => ({
      projectId: project.projectId,
      title: project.title,
      updatedAt: project.updatedAt,
      hasDocument: project.hasDocument,
      selected: project.projectId === activeProjectId,
    }));
  return { total: projects.length, items: projects };
};

const asStructuredContent = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return { value };
};

const successResult = (value, meta) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: asStructuredContent(value),
  ...(meta ? { _meta: meta } : {}),
});

const errorResult = (error) => ({
  content: [{
    type: "text",
    text: error instanceof Error ? error.message : String(error || "Stylo tool call failed"),
  }],
  isError: true,
});

const server = new Server(
  { name: "stylo-agentic-gateway", version: "0.1.0" },
  {
    capabilities: { tools: { listChanged: true } },
    instructions:
      "Stylo exposes project-native capabilities without preloading project content. Select exactly one project, read the smallest useful scope before editing, and use returned stable refs. Writes persist through the realtime project authority and may fail with a revision conflict; re-read the target before retrying. Script body edits remain app-review gated. Generation execution is not exposed through this host.",
  }
);

const refreshCredential = async () => {
  if (environmentAuthToken) return;
  const credential = await loadStyloCredential();
  const nextToken = credential?.accessToken || "";
  const changed = nextToken !== authToken;
  authToken = nextToken;
  authSource = credential ? "temporary_file" : "none";
  authExpiresAt = credential?.expiresAt || null;
  authScope = credential?.scope || null;
  if (credential?.apiBaseUrl && !process.env.STYLO_API_BASE_URL) {
    apiBaseUrl = credential.apiBaseUrl.replace(/\/+$/, "");
  }
  if (changed) {
    manifestCache = null;
    manifestCacheTime = 0;
    lastManifestError = "";
    activeProjectRevision = null;
    await server.sendToolListChanged().catch(() => undefined);
  }
};

await refreshCredential();

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...MANAGEMENT_TOOLS, ...(await loadManifest())],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments || {};
  try {
    if (name === "stylo_connection_status") {
      await loadManifest({ force: true });
      return successResult({
        apiBaseUrl,
        authenticated: Boolean(authToken),
        authSource,
        authExpiresAt,
        authScope,
        activeProjectId: activeProjectId || null,
        activeProjectRevision,
        sharedToolsAvailable: manifestCache?.length || 0,
        manifestError: lastManifestError || null,
      });
    }
    if (name === "stylo_list_projects") {
      return successResult(await listProjects({
        query: typeof args.query === "string" ? args.query : "",
        maxItems: Number(args.max_items) || 12,
      }));
    }
    if (name === "stylo_select_project") {
      const projectId = typeof args.project_id === "string" ? args.project_id.trim() : "";
      if (!projectId) throw new Error("project_id is required.");
      const projects = await listProjects({ query: projectId, maxItems: 50 });
      const selected = projects.items.find((project) => project.projectId === projectId);
      if (!selected) throw new Error("The requested Stylo project is not accessible.");
      activeProjectId = projectId;
      activeProjectRevision = null;
      return successResult({
        projectId: selected.projectId,
        title: selected.title,
        updatedAt: selected.updatedAt,
      });
    }

    const manifest = await loadManifest();
    if (!manifest.some((tool) => tool.name === name)) {
      throw new Error(`Unknown or unavailable Stylo tool: ${name}`);
    }
    if (!activeProjectId) {
      throw new Error("No Stylo project is selected. Call stylo_list_projects and stylo_select_project first.");
    }
    const payload = await styloRequest("/api/agent-tools", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: activeProjectId,
        toolName: name,
        arguments: args,
        ...(Number.isInteger(activeProjectRevision) ? { expectedRevision: activeProjectRevision } : {}),
      }),
    });
    if (Number.isInteger(payload.revision)) activeProjectRevision = payload.revision;
    return successResult(payload.output, {
      projectId: payload.projectId,
      revision: payload.revision,
      updatedAt: payload.updatedAt,
      summary: payload.summary,
    });
  } catch (error) {
    return errorResult(error);
  }
});

await server.connect(new StdioServerTransport());
