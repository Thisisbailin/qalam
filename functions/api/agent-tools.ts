import {
  executeStyloCapability,
  findStyloToolDefinition,
} from "../../agents/tools";
import {
  CODEX_INITIAL_CAPABILITIES,
  buildStyloToolManifest,
} from "../../agents/tools/manifest";
import { getStyloToolDescriptor } from "../../agents/runtime/toolCatalog";
import { assertStyloProjectScope } from "../../agents/runtime/projectScope";
import { authenticateAgentRequest } from "./_agentAccess";
import { jsonResponse } from "./_auth";
import { createAgentProjectData, createNodeFlowBridgeState } from "./_agentBridgeState";
import { loadAgentProjectState } from "./_agentProjectState";
import { hasProjectCatalogEntry } from "./_projectCatalog";
import {
  flushRealtimeProjectProjection,
  type RealtimeProjectionEnv,
} from "./_realtimeProjection";
import { enforceRateLimit } from "./_rateLimit";
import { readJsonRequest } from "./_request";
import type { D1DatabaseLike, PagesContext } from "./_types";

type AgentToolsEnv = Record<string, unknown> & RealtimeProjectionEnv & {
  DB: D1DatabaseLike;
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
};

type AgentToolRequest = {
  projectId?: unknown;
  toolName?: unknown;
  arguments?: unknown;
};

const MAX_REQUEST_BYTES = 64 * 1024;

const authenticate = async (context: PagesContext<AgentToolsEnv>, namespace: string) => {
  const { userId } = await authenticateAgentRequest(context.request, context.env);
  await enforceRateLimit({
    db: context.env.DB,
    namespace,
    subject: userId,
    limit: namespace === "agent-tools-manifest" ? 60 : 120,
    windowSeconds: 60,
  });
  return userId;
};

export const onRequestGet = async (context: PagesContext<AgentToolsEnv>) => {
  try {
    await authenticate(context, "agent-tools-manifest");
    return jsonResponse({
      version: 1,
      capabilities: [...CODEX_INITIAL_CAPABILITIES],
      tools: buildStyloToolManifest(),
    });
  } catch (error) {
    return error instanceof Response
      ? error
      : jsonResponse({ error: "Failed to load Stylo tool manifest" }, { status: 500 });
  }
};

export const onRequestPost = async (context: PagesContext<AgentToolsEnv>) => {
  let userId: string;
  let body: AgentToolRequest;
  try {
    userId = await authenticate(context, "agent-tool-call");
    body = await readJsonRequest<AgentToolRequest>(context.request, MAX_REQUEST_BYTES);
  } catch (error) {
    return error instanceof Response
      ? error
      : jsonResponse({ error: "Invalid Stylo tool request" }, { status: 400 });
  }

  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const toolName = typeof body.toolName === "string" ? body.toolName.trim() : "";
  if (!projectId || projectId.length > 256 || !toolName || toolName.length > 128) {
    return jsonResponse({ error: "A valid projectId and toolName are required" }, { status: 400 });
  }

  try {
    assertStyloProjectScope(projectId);
    const definition = findStyloToolDefinition(toolName);
    if (!definition) {
      return jsonResponse({ error: `Unknown Stylo tool: ${toolName}` }, { status: 404 });
    }
    const descriptor = getStyloToolDescriptor(toolName);
    if (!CODEX_INITIAL_CAPABILITIES.includes(descriptor.capability as "project_read")) {
      return jsonResponse({
        error: `Stylo capability ${descriptor.capability} is not enabled for external Agents`,
        code: "CAPABILITY_NOT_ENABLED",
      }, { status: 403 });
    }
    if (!await hasProjectCatalogEntry(context.env.DB, userId, projectId)) {
      return jsonResponse({ error: "Project not found" }, { status: 404 });
    }

    await flushRealtimeProjectProjection(context.env, userId, projectId);
    const projectState = await loadAgentProjectState(context.env.DB, userId, projectId);
    const agentProjectData = createAgentProjectData(
      projectState.projectData,
      projectState.nodeFlow,
      projectId
    );
    const bridgeState = createNodeFlowBridgeState(agentProjectData, projectState.nodeFlow);
    const execution = await executeStyloCapability({
      toolName,
      input: body.arguments ?? {},
      bridge: bridgeState.bridge,
      allowedCapabilities: CODEX_INITIAL_CAPABILITIES,
    });

    return jsonResponse({
      projectId,
      revision: projectState.nodeFlow.revision,
      updatedAt: projectState.updatedAt,
      tool: execution.name,
      summary: execution.summary,
      output: execution.output,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : "Stylo tool execution failed";
    return jsonResponse({
      error: message,
      code: "TOOL_EXECUTION_FAILED",
      recoverable: true,
    }, { status: 400 });
  }
};
