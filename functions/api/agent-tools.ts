import {
  executeStyloCapability,
  findStyloToolDefinition,
} from "../../agents/tools";
import {
  buildStyloToolManifest,
  getCodexCapabilitiesForScope,
} from "../../agents/tools/manifest";
import { getStyloToolDescriptor } from "../../agents/runtime/toolCatalog";
import { assertStyloProjectScope } from "../../agents/runtime/projectScope";
import { authenticateAgentRequest, type AgentAuthentication } from "./_agentAccess";
import { jsonResponse } from "./_auth";
import {
  createAgentProjectData,
  createNodeFlowBridgeState,
  mergeAgentNodeFlowIntoProjectData,
} from "./_agentBridgeState";
import { loadAgentProjectState } from "./_agentProjectState";
import { hasProjectCatalogEntry } from "./_projectCatalog";
import {
  flushRealtimeProjectProjection,
  applyRealtimeAgentProjectSnapshot,
  RealtimeProjectRevisionConflict,
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
  expectedRevision?: unknown;
};

const MAX_REQUEST_BYTES = 64 * 1024;

const authenticate = async (context: PagesContext<AgentToolsEnv>, namespace: string) => {
  const authentication = await authenticateAgentRequest(context.request, context.env);
  await enforceRateLimit({
    db: context.env.DB,
    namespace,
    subject: authentication.userId,
    limit: namespace === "agent-tools-manifest" ? 60 : 120,
    windowSeconds: 60,
  });
  return authentication;
};

const capabilitiesFor = (authentication: AgentAuthentication) =>
  getCodexCapabilitiesForScope(authentication.scope);

export const onRequestGet = async (context: PagesContext<AgentToolsEnv>) => {
  try {
    const authentication = await authenticate(context, "agent-tools-manifest");
    const capabilities = capabilitiesFor(authentication);
    return jsonResponse({
      version: 1,
      scope: authentication.scope,
      capabilities: [...capabilities],
      tools: buildStyloToolManifest(capabilities),
    });
  } catch (error) {
    return error instanceof Response
      ? error
      : jsonResponse({ error: "Failed to load Stylo tool manifest" }, { status: 500 });
  }
};

export const onRequestPost = async (context: PagesContext<AgentToolsEnv>) => {
  let authentication: AgentAuthentication;
  let body: AgentToolRequest;
  try {
    authentication = await authenticate(context, "agent-tool-call");
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
    const userId = authentication.userId;
    const allowedCapabilities = capabilitiesFor(authentication);
    assertStyloProjectScope(projectId);
    const definition = findStyloToolDefinition(toolName);
    if (!definition) {
      return jsonResponse({ error: `Unknown Stylo tool: ${toolName}` }, { status: 404 });
    }
    const descriptor = getStyloToolDescriptor(toolName);
    if (!allowedCapabilities.includes(descriptor.capability as never)) {
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
    const isMutation = descriptor.interaction !== "read";
    if (
      isMutation
      && body.expectedRevision !== undefined
      && (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0)
    ) {
      return jsonResponse({ error: "expectedRevision must be a non-negative integer" }, { status: 400 });
    }
    if (isMutation && Number.isSafeInteger(body.expectedRevision)
      && Number(body.expectedRevision) !== projectState.nodeFlow.revision) {
      return jsonResponse({
        error: "The Stylo project changed. Re-read the target before retrying.",
        code: "REVISION_CONFLICT",
        currentRevision: projectState.nodeFlow.revision,
        recoverable: true,
      }, { status: 409 });
    }
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
      allowedCapabilities,
    });

    const outputRecord = execution.output && typeof execution.output === "object"
      ? execution.output as Record<string, unknown>
      : {};
    if (outputRecord.commit_status === "pending_review" || outputRecord.commitStatus === "pending_review") {
      return jsonResponse({
        error: "Script body edits require review inside Stylo and cannot be committed through the external Codex gateway.",
        code: "APP_REVIEW_REQUIRED",
        currentRevision: projectState.nodeFlow.revision,
        recoverable: true,
      }, { status: 409 });
    }

    let revision = projectState.nodeFlow.revision;
    let updatedAt = projectState.updatedAt;
    if (bridgeState.hasUpdatedNodeFlow() || bridgeState.hasUpdatedProjectData()) {
      const nextProjectData = mergeAgentNodeFlowIntoProjectData(
        projectState.projectData,
        bridgeState.getProjectData(),
        bridgeState.getNodeFlow(),
        projectId,
      );
      await applyRealtimeAgentProjectSnapshot(context.env, userId, projectId, {
        expectedRevision: projectState.nodeFlow.revision,
        expectedServerSeq: projectState.serverSeq,
        projectData: nextProjectData,
        actorId: `codex:${authentication.tokenHash?.slice(0, 24) || userId.slice(0, 24)}`,
        operationId: `codex-op-${crypto.randomUUID()}`,
      });
      const committed = await loadAgentProjectState(context.env.DB, userId, projectId);
      revision = committed.nodeFlow.revision;
      updatedAt = committed.updatedAt;
    }

    return jsonResponse({
      projectId,
      revision,
      updatedAt,
      tool: execution.name,
      summary: execution.summary,
      output: execution.output,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof RealtimeProjectRevisionConflict) {
      return jsonResponse({
        error: error.message,
        code: "REVISION_CONFLICT",
        currentRevision: error.currentRevision,
        currentServerSeq: error.currentServerSeq,
        recoverable: true,
      }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Stylo tool execution failed";
    return jsonResponse({
      error: message,
      code: "TOOL_EXECUTION_FAILED",
      recoverable: true,
    }, { status: 400 });
  }
};
