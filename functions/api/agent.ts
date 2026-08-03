import { runStyloAgentCore } from "../../agents/runtime/core";
import type { AgentHttpRunRequest } from "../../agents/runtime/httpProtocol";
import { resolveAgentProvider, resolveBaseUrl, resolveProviderModel } from "../../agents/runtime/providerConfig";
import { resolveActivatedSkills, StaticSkillLoader } from "../../agents/runtime/skills";
import { buildDisabledTools } from "../../agents/runtime/toolPolicy";
import { createAgentSessionKey, D1EdgeSession, migrateLegacyD1AgentSession, StyloResponsesCompactionSession, readD1SessionMessages } from "./_agentSessions";
import { ensureStyloTraceProcessor, forceFlushAgentTracing, persistBufferedTrace } from "./_agentTracing";
import { parseNodeFlowFile } from "../../node-workspace/nodeflow/schema";
import {
  assertStyloProjectScope,
  isStyloSessionInProject,
} from "../../agents/runtime/projectScope";
import { getUserId } from "./_auth";
import { enforceRateLimit } from "./_rateLimit";
import { readJsonRequest } from "./_request";
import type { D1DatabaseLike, PagesContext } from "./_types";
import { loadAgentProjectState } from "./_agentProjectState";
import {
  flushRealtimeProjectProjection,
  type RealtimeProjectionEnv,
} from "./_realtimeProjection";
import {
  createAgentProjectData,
  createAgentProjectPatch,
  createNodeFlowBridgeState,
  hasMeaningfulProjectPatch,
} from "./_agentBridgeState";
import {
  CORS_HEADERS,
  createSseResponse,
  emitError,
  emitEvent,
  withCorsHeaders,
} from "./_agentStream";

type AgentEnv = Record<string, unknown> & RealtimeProjectionEnv & {
  DB: D1DatabaseLike;
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
};

const EDGE_AGENT_MAX_TURNS = 20;
const MAX_AGENT_REQUEST_BYTES = 128 * 1024;
const MAX_AGENT_TEXT_LENGTH = 20_000;

const resolveApiKey = (env: Record<string, unknown>, provider: "qwen" | "openrouter" | "ark" | "deepseek") => {
  const value =
    provider === "openrouter"
      ? env.OPENROUTER_API_KEY
      : provider === "ark"
        ? env.ARK_API_KEY
        : provider === "deepseek"
          ? env.DEEPSEEK_API_KEY
      : env.QWEN_API_KEY || env.DASHSCOPE_API_KEY || env.OPENAI_API_KEY;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Pages Functions 未配置 ${provider} 的可用 API Key。`);
  }
  return value.trim();
};

const isDebugEnabled = (env: Record<string, unknown>) => {
  const value = env.AGENT_DEBUG_LOGS;
  return value === "1" || value === "true";
};

const debugLog = (enabled: boolean, runId: string, label: string, payload?: unknown) => {
  if (!enabled || typeof console === "undefined") return;
  const prefix = `[Stylo][edge][${runId}] ${label}`;
  if (payload === undefined) {
    console.log(prefix);
    return;
  }
  console.log(prefix, payload);
};

export const onRequestOptions = async () =>
  new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });

export const onRequestPost = async (context: PagesContext<AgentEnv>) => {
  let sessionOwner: string;
  let body: AgentHttpRunRequest | null = null;
  try {
    sessionOwner = await getUserId(context.request, context.env);
    await enforceRateLimit({
      db: context.env.DB,
      namespace: "agent-run",
      subject: sessionOwner,
      limit: 10,
      windowSeconds: 60,
    });
    body = await readJsonRequest<AgentHttpRunRequest>(context.request, MAX_AGENT_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof Response) return withCorsHeaders(error);
    throw error;
  }
  if (
    !body?.run?.projectId ||
    !body?.run?.sessionId ||
    !body?.run?.userText ||
    !body?.runtime?.model ||
    !Number.isInteger(body?.project?.expectedRevision) ||
    body.project.expectedRevision < 0
  ) {
    return new Response(JSON.stringify({ error: "请求缺少有效的项目、会话、模型或 expectedRevision。" }), {
      status: 400,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }
  if (
    body.run.projectId.length > 256 ||
    body.run.sessionId.length > 256 ||
    body.run.userText.length > MAX_AGENT_TEXT_LENGTH ||
    (body.run.attachments?.length || 0) > 8
  ) {
    return new Response(JSON.stringify({ error: "Agent request exceeds the allowed identity, text, or attachment limits." }), {
      status: 413,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }

  try {
    assertStyloProjectScope(body.run.projectId);
    if (!isStyloSessionInProject(body.run.sessionId, body.run.projectId)) {
      throw new Error("Stylo sessionId 不属于当前 projectId。");
    }
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || "Stylo 项目作用域校验失败。" }), {
      status: 409,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }

  const provider = resolveAgentProvider(body.runtime.provider);
  const sessionKey = createAgentSessionKey(body.run.projectId, body.run.sessionId, sessionOwner);

  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const debugEnabled = isDebugEnabled(context.env || {});
      ensureStyloTraceProcessor();
      const tracingEnabled = true;
      const traceId = `edge-trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const workflowName = "Stylo Edge Agent";
      const groupId = sessionKey;
      let wrapperFailure: string | null = null;
      let coreOwnsTerminalEvent = false;
      const skillLoader = new StaticSkillLoader();
      const requestAbortSignal = context.request.signal;
      const emitWrapperTrace = (
        stage: "runtime" | "session" | "model" | "tool" | "result",
        status: "info" | "running" | "success" | "error",
        title: string,
        detail?: string,
        payload?: string
      ) => debugLog(debugEnabled, traceId, `wrapper ${stage}/${status}: ${title}`, {
        detail,
        payload,
      });
      const onAbort = () => {
        debugLog(debugEnabled, traceId, "request aborted", {
          reason: String((requestAbortSignal as any)?.reason || ""),
        });
        emitWrapperTrace("runtime", "error", "Request aborted", String((requestAbortSignal as any)?.reason || ""));
      };
      requestAbortSignal?.addEventListener("abort", onAbort, { once: true });
      try {
        emitWrapperTrace("runtime", "running", "Edge request accepted", `project=${body.run.projectId} · session=${body.run.sessionId}`);
        await migrateLegacyD1AgentSession(
          context.env,
          body.run.projectId,
          body.run.sessionId,
          sessionOwner
        ).catch(() => false);
        await flushRealtimeProjectProjection(
          context.env,
          sessionOwner,
          body.run.projectId,
        );
        const projectState = await loadAgentProjectState(
          context.env.DB,
          sessionOwner,
          body.run.projectId
        );
        if (projectState.nodeFlow.revision !== body.project.expectedRevision) {
          throw new Error(
            `云端 Flow 修订为 ${projectState.nodeFlow.revision}，本地请求修订为 ${body.project.expectedRevision}。请等待项目同步完成后重试。`
          );
        }
        const agentProjectData = createAgentProjectData(
          projectState.projectData,
          projectState.nodeFlow,
          body.run.projectId
        );
        const bridgeState = createNodeFlowBridgeState(agentProjectData, projectState.nodeFlow);
        emitWrapperTrace(
          "session",
          "info",
          "Project tool state attached",
          `revision=${projectState.nodeFlow.revision}`
        );
        debugLog(debugEnabled, traceId, "request received", {
          provider,
          runtime: body.runtime,
          projectId: body.run.projectId,
          sessionId: body.run.sessionId,
          userTextChars: body.run.userText.length,
        });
        const effectiveModel = resolveProviderModel(provider, body.runtime.model);
        const resolvedBaseUrl = resolveBaseUrl(provider);
        const resolvedApiKey = resolveApiKey(context.env || {}, provider);
        const {
          skills: enabledSkills,
          explicitSkillIds,
          implicitSkillIds,
        } = await resolveActivatedSkills({
          explicitSkillIds: body.run.enabledSkillIds || [],
          loader: skillLoader,
        });
        const legacyToolSettings = (body.runtime as unknown as Record<string, unknown>)["qalamTools"];
        const disabledTools = buildDisabledTools({
          styloTools: body.runtime.styloTools || legacyToolSettings as AgentHttpRunRequest["runtime"]["styloTools"],
        }, enabledSkills as Array<{ disabledTools?: string[] }>);
        debugLog(debugEnabled, traceId, "provider resolved", {
          provider,
          model: effectiveModel,
          baseURL: resolvedBaseUrl,
          hasApiKey: Boolean(resolvedApiKey),
          enabledSkills: enabledSkills.map((skill) => skill.id),
          explicitSkillIds,
          implicitSkillIds,
        });
        emitWrapperTrace(
          "runtime",
          "info",
          "Edge runtime prepared",
          `${provider} · ${effectiveModel}`,
          JSON.stringify({
            explicitSkillIds,
            implicitSkillIds,
            enabledSkills: enabledSkills.map((skill) => skill.id),
          })
        );
        const underlyingSession = new D1EdgeSession(context.env || {}, body.run.projectId, body.run.sessionId, sessionKey, sessionOwner);
        const session = new StyloResponsesCompactionSession({
          underlyingSession,
          model: effectiveModel,
          apiKey: resolvedApiKey,
          baseUrl: resolvedBaseUrl,
        });
        const sessionMessages = await readD1SessionMessages(
          context.env || {},
          body.run.projectId,
          sessionKey,
          sessionOwner,
        );
        emitWrapperTrace("session", "info", "Session snapshot loaded", `items=${sessionMessages.length}`);
        emitWrapperTrace("runtime", "running", "Delegating to agent core");
        coreOwnsTerminalEvent = true;
        await runStyloAgentCore({
          input: body.run,
          config: {
            provider,
            model: effectiveModel,
            apiKey: resolvedApiKey,
            baseUrl: resolvedBaseUrl,
          },
          bridge: bridgeState.bridge,
          session,
          sessionMessages,
          runtimeMode: "edge_full",
          runtimeLabel: "Stylo Edge Agent",
          workflowName,
          enabledSkills: enabledSkills as any,
          disabledTools,
          maxTurns: EDGE_AGENT_MAX_TURNS,
          signal: context.request.signal,
          onEvent: (event) => emitEvent(controller, event),
          onDebug: (label, payload) => debugLog(debugEnabled, traceId, label, payload),
          traceId,
          groupId,
          traceMetadata: {
            sessionId: body.run.sessionId,
            projectId: body.run.projectId,
            sessionKey,
            provider,
            model: effectiveModel,
            userId: sessionOwner || "anonymous",
            runtimeMode: "edge_full",
            skillIds: enabledSkills.map((skill) => skill.id).join(","),
            skillVersions: enabledSkills.map((skill) => `${skill.id}:${skill.version || "0"}`).join(","),
            explicitSkillIds: explicitSkillIds.join(","),
            implicitSkillIds: implicitSkillIds.join(","),
          },
          tracingDisabled: false,
          traceIncludeSensitiveData: false,
          getExtraResult: () => ({
            updatedProjectPatch: bridgeState.hasUpdatedProjectData()
              ? (() => {
                  const patch = createAgentProjectPatch(bridgeState.getProjectData(), body.run.projectId);
                  return hasMeaningfulProjectPatch(patch) ? patch : undefined;
                })()
              : undefined,
            updatedNodeFlow: bridgeState.hasUpdatedNodeFlow()
              ? parseNodeFlowFile(bridgeState.getNodeFlow())
              : undefined,
            updatedExecutionApprovals: bridgeState.hasUpdatedExecutionApprovals()
              ? bridgeState.getExecutionApprovals()
              : undefined,
            tracing: {
              enabled: tracingEnabled,
              traceId,
            },
          }),
          runStartedMeta: {
            traceId,
            tracingEnabled,
          },
          recoverFallbackOnAnyError: true,
        });
      } catch (error: any) {
        const message = error?.message || "Cloudflare Agent runtime 执行失败";
        wrapperFailure = message;
        debugLog(debugEnabled, traceId, "run error", message);
        if (!coreOwnsTerminalEvent) {
          emitWrapperTrace("result", "error", "Agent 初始化失败", message);
          const emitted = emitError(controller, message);
          debugLog(debugEnabled, traceId, "emit error packet", { emitted, message });
        }
      } finally {
        try {
          controller.close();
        } catch (error: any) {
          if (!String(error?.message || error).includes("Controller is already closed")) {
            throw error;
          }
        } finally {
          requestAbortSignal?.removeEventListener("abort", onAbort);
        }
        const persistTracePromise = (async () => {
          try {
            await forceFlushAgentTracing();
            await persistBufferedTrace(context.env || {}, {
              traceId,
              projectId: body.run.projectId,
              sessionId: body.run.sessionId,
              sessionKey,
              userId: sessionOwner,
              provider,
              model: resolveProviderModel(provider, body.runtime.model),
              workflowName,
              groupId,
              metadata: {
                sessionId: body.run.sessionId,
                projectId: body.run.projectId,
                sessionKey,
                provider,
                model: resolveProviderModel(provider, body.runtime.model),
                userId: sessionOwner || "anonymous",
                runtimeMode: "edge_full",
                ...(wrapperFailure ? { status: "error" } : {}),
              },
              failure: wrapperFailure,
            });
          } catch (traceError: any) {
            debugLog(debugEnabled, traceId, "trace persistence error", traceError?.message || String(traceError));
          }
        })();
        if (typeof context.waitUntil === "function") {
          context.waitUntil(persistTracePromise);
        } else {
          void persistTracePromise;
        }
      }
    },
  });

  return createSseResponse(stream);
};
