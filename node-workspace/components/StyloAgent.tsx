import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePersistedState } from "../../hooks/usePersistedState";
import { AppConfig, ProjectData, SyncState } from "../../types";
import type { NodeFlowFile, NodeFlowNode } from "../types";
import { createStableId } from "../../utils/id";
import { buildApiUrl } from "../../utils/api";
import { restoreLocalNodeMedia } from "../../utils/cloudProjectData";
import { resolveProviderModel, type StyloAgentProvider } from "../../agents/runtime/providerConfig";
import {
  GLASS_DIFFUSION_PRESETS,
  GlassDiffusionField,
  MaterialGlassShadow,
  STYLO_GLASS_LAB_CONFIG,
  STYLO_GLASS_LAB_SHADOW,
} from "./GlassDiffusionField";
import { StyloChatContent } from "./stylo/StyloChatContent";
import type { ApprovalChoice, ApprovalMessage, ApprovalStatus, ChatMessage, Message } from "./stylo/types";
import { useNodeFlowStore } from "../store/nodeFlowStore";
import { createHttpStyloAgentRuntime } from "../../agents/runtime/httpClient";
import { useStyloAgent } from "../../agents/react/useStyloAgent";
import { useNodeFlowExecutor } from "../store/useNodeFlowExecutor";
import type { NodeFlowExecutionApprovalProposal } from "../nodeflow/approvals";
import { parseNodeFlowFile } from "../nodeflow/schema";
import { projectRolesToCharacters, projectRolesToLocations } from "../../utils/projectRoles";
import type { AgentUiContext } from "../../agents/runtime/types";
import {
  buildAgentRevisionConflictMessage,
  reconcileStaleAgentMessages,
  shouldRejectStaleAgentResult,
} from "./stylo/agentResultReconciliation";
import {
  buildStyloAccountSessionId,
  buildStyloAccountStorageKeys,
  resolveStyloProjectId,
} from "../../agents/runtime/projectScope";
import type {
  AgentScriptEditProposal,
  AgentScriptEditProposalBatch,
  StyloSubmitRequest,
} from "./stylo/interactionTypes";
import type { EnsureProjectSynced, ProjectSyncLease } from "../../hooks/useCloudSync";

type Props = {
  accountScope: string;
  projectId: string;
  projectData: ProjectData;
  config: AppConfig;
  setProjectData: React.Dispatch<React.SetStateAction<ProjectData>>;
  getAuthToken?: (options?: { skipCache?: boolean }) => Promise<string | null>;
  syncState?: SyncState;
  ensureProjectSynced?: EnsureProjectSynced;
  onOpenStats?: () => void;
  settingsOpen?: boolean;
  openRequest?: number;
  closeRequest?: number;
  submitRequest?: StyloSubmitRequest | null;
  cancelRequest?: number;
  onCollapsedChange?: (collapsed: boolean) => void;
  onDockFrameChange?: (frame: { dockWidth: number; isSplit: boolean; collapsed: boolean }) => void;
  onSendingChange?: (sending: boolean) => void;
  renderCollapsedTrigger?: boolean;
  agentFirstMode?: boolean;
  conversationStorageKey?: string;
  allowLegacyConversationMigration?: boolean;
  conversationResetToken?: number;
  panelStyleOverride?: React.CSSProperties;
  showUsageBadge?: boolean;
  onScriptEditProposals?: (batch: AgentScriptEditProposalBatch) => void;
};

const WORK_HINT_KEYWORDS = [
  "剧本",
  "剧情",
  "场景",
  "角色",
  "剧集",
  "画面",
  "视觉",
  "对白",
  "台词",
  "档案",
  "archive",
  "角色库",
  "场景库",
  "总结",
  "梳理",
  "分析",
  "查阅",
  "搜索",
  "提取",
  "生成",
  "写作",
  "改写",
  "优化",
  "Prompt",
  "节点",
  "工作流",
  "workflow",
];

const toSearch = (value: string) => value.toLowerCase().replace(/\s+/g, "");

const getNodeFlowSnapshot = () => useNodeFlowStore.getState();

const buildNodeFlowFileFromProjectData = (
  data: ProjectData,
  fallback: Pick<NodeFlowFile, "revision" | "linkStyle" | "nodeFlowContext" | "viewport" | "activeView">
): NodeFlowFile | null => {
  const flow = data.flow;
  if (!flow || !Array.isArray(flow.flowNodes)) return null;
  return {
    version: 2,
    revision: typeof flow.revision === "number" ? flow.revision : fallback.revision + 1,
    name: data.fileName || "Stylo Flow Workspace",
    nodes: flow.flowNodes,
    links: Array.isArray(flow.links) ? flow.links : [],
    graphLinks: Array.isArray(flow.graphLinks) ? flow.graphLinks : [],
    linkStyle: flow.linkStyle || fallback.linkStyle,
    globalAssetHistory: Array.isArray(flow.globalAssetHistory) ? flow.globalAssetHistory : [],
    nodeFlowContext: fallback.nodeFlowContext,
    viewport: fallback.viewport || undefined,
    activeView: flow.activeView ?? fallback.activeView ?? null,
  };
};

const readScriptDocument = (node: NodeFlowNode) => {
  const data = (node.data || {}) as Record<string, unknown>;
  const text = typeof data.content === "string" ? data.content : typeof data.text === "string" ? data.text : "";
  return {
    title: typeof data.title === "string" && data.title.trim() ? data.title : "剧本文档",
    content: text,
    documentId: typeof data.documentId === "string" && data.documentId.trim() ? data.documentId : undefined,
  };
};

const collectScriptEditProposals = (
  currentNodes: NodeFlowNode[],
  candidateNodes: NodeFlowNode[]
): AgentScriptEditProposal[] => {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  const receivedAt = Date.now();
  return candidateNodes.flatMap((candidate, index) => {
    if (candidate.type !== "scriptPage") return [];
    const current = currentById.get(candidate.id);
    if (!current || current.type !== "scriptPage") return [];
    const previousDocument = readScriptDocument(current);
    const nextDocument = readScriptDocument(candidate);
    if (previousDocument.content === nextDocument.content) return [];
    return [{
      id: `agent-script-edit-${receivedAt.toString(36)}-${index}`,
      nodeId: candidate.id,
      documentId: nextDocument.documentId || previousDocument.documentId,
      title: nextDocument.title,
      content: nextDocument.content,
      receivedAt,
    }];
  });
};

const preserveProposedScriptEdits = (
  candidate: NodeFlowFile,
  currentNodes: NodeFlowNode[],
  proposals: AgentScriptEditProposal[]
): NodeFlowFile => {
  if (!proposals.length) return candidate;
  const proposalNodeIds = new Set(proposals.map((proposal) => proposal.nodeId));
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  return {
    ...candidate,
    nodes: candidate.nodes.map((node) => {
      if (!proposalNodeIds.has(node.id)) return node;
      const current = currentById.get(node.id);
      if (!current) return node;
      const currentData = (current.data || {}) as Record<string, unknown>;
      const nextData = { ...((node.data || {}) as Record<string, unknown>) };
      ["title", "text", "content", "preview", "updatedAt"].forEach((key) => {
        if (key in currentData) nextData[key] = currentData[key];
        else delete nextData[key];
      });
      return { ...node, data: nextData as NodeFlowNode["data"] };
    }),
  };
};

const mergeNodeFlowIntoProjectData = (base: ProjectData, nodeFlow: NodeFlowFile): ProjectData => {
  const nextFlow = {
    ...(base.flow || { links: [] }),
    revision: nodeFlow.revision,
    flowNodes: nodeFlow.nodes,
    links: nodeFlow.links,
    graphLinks: nodeFlow.graphLinks || [],
    linkStyle: nodeFlow.linkStyle,
    globalAssetHistory: nodeFlow.globalAssetHistory || [],
    activeView: nodeFlow.activeView ?? null,
  } as NonNullable<ProjectData["flow"]>;
  const activeProjectId = base.activeFlowProjectId || base.flowProjects?.[0]?.id;
  return {
    ...base,
    flow: nextFlow,
    flowProjects: base.flowProjects?.map((project) =>
      project.id === activeProjectId
        ? {
            ...project,
            flow: nextFlow,
            roles: base.roles || [],
            designAssets: base.designAssets || [],
            updatedAt: Date.now(),
          }
        : project
    ),
  };
};

type AgentProjectPatch = Partial<Pick<ProjectData, "activeFlowProjectId" | "roles" | "designAssets" | "flow" | "flowProjects">>;

const normalizeAgentProjectPatch = (
  patch: AgentProjectPatch | ProjectData | undefined,
  projectId: string
): AgentProjectPatch | null => {
  if (!patch || typeof patch !== "object") return null;
  if (typeof patch.activeFlowProjectId === "string" && patch.activeFlowProjectId.trim() && patch.activeFlowProjectId !== projectId) {
    return null;
  }
  const activeProjectPatch = Array.isArray(patch.flowProjects)
    ? patch.flowProjects.find((project) => project.id === projectId)
    : undefined;
  return {
    activeFlowProjectId: projectId,
    roles: Array.isArray(patch.roles) ? patch.roles : undefined,
    designAssets: Array.isArray(patch.designAssets) ? patch.designAssets : undefined,
    flow: patch.flow || activeProjectPatch?.flow,
    flowProjects: activeProjectPatch ? [activeProjectPatch] : undefined,
  };
};

const applyAgentProjectPatch = (
  base: ProjectData,
  patch: AgentProjectPatch | null,
  projectId: string
): ProjectData => {
  if (!patch) return base;
  const activeProjectPatch = patch.flowProjects?.find((project) => project.id === projectId);
  const nextFlow = patch.flow || activeProjectPatch?.flow || base.flow;
  const nextRoles = Array.isArray(patch.roles) ? patch.roles : base.roles;
  const nextDesignAssets = Array.isArray(patch.designAssets) ? patch.designAssets : base.designAssets;
  return {
    ...base,
    activeFlowProjectId: projectId,
    roles: nextRoles,
    designAssets: nextDesignAssets,
    flow: nextFlow,
    flowProjects: base.flowProjects?.map((project) =>
      project.id === projectId
        ? {
            ...project,
            ...(activeProjectPatch || {}),
            id: project.id,
            flow: nextFlow || project.flow,
            roles: nextRoles,
            designAssets: nextDesignAssets,
            updatedAt: Date.now(),
          }
        : project
    ),
  };
};

const resolveAgentRuntimeModel = (textConfig: any) => {
  const provider = (textConfig?.agentProvider || "deepseek") as StyloAgentProvider;
  const explicitAgentModel = (textConfig?.agentModel || "").trim();
  const resolvedExplicit = resolveProviderModel(provider, explicitAgentModel);
  if (explicitAgentModel && resolvedExplicit === explicitAgentModel) return resolvedExplicit;
  const sharedModel = !textConfig?.agentProvider || textConfig?.agentProvider === textConfig?.provider
    ? (textConfig?.model || "").trim()
    : "";
  return resolveProviderModel(provider, sharedModel);
};

const hasEpisodeSceneRef = (text: string) => {
  if (!text) return false;
  if (/第\s*\d+\s*集/.test(text)) return true;
  if (/\d+\s*[-－–—]\s*\d+/.test(text)) return true; // scene id like 12-3
  return false;
};

const detectWorkIntent = (text: string, hasAttachments: boolean) => {
  if (!text) return false;
  const lowered = text.toLowerCase();
  if (hasAttachments) return true;
  if (hasEpisodeSceneRef(text)) return true;
  return WORK_HINT_KEYWORDS.some((kw) => lowered.includes(kw.toLowerCase()));
};

type ConversationRecord = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
};

type ConversationState = {
  activeId: string;
  items: ConversationRecord[];
};

type ApprovalPreferenceState = Partial<Record<"image_generation" | "video_generation", true>>;

const createApprovalStep = (
  id: string,
  label: string,
  status: "info" | "running" | "success" | "error",
  detail?: string
) => ({
  id,
  label,
  status,
  detail,
  at: Date.now(),
});

const buildApprovalPayload = (
  proposal: NodeFlowExecutionApprovalProposal,
  status: ApprovalMessage["approval"]["status"]
): ApprovalMessage["approval"] => ({
  id: proposal.id,
  nodeId: proposal.nodeId,
  nodeRef: proposal.nodeRef,
  nodeTitle: proposal.nodeTitle,
  action: proposal.action,
  providerLabel: proposal.providerLabel,
  modelLabel: proposal.modelLabel,
  promptPreview: proposal.promptPreview,
  inputSummary: proposal.inputSummary,
  status,
  summary: "等待你的批准后启动执行。",
  steps: [
    createApprovalStep(
      "created",
      "已创建审批请求",
      "info",
      `Agent 已为 ${proposal.nodeTitle} 准备好${proposal.action === "video_generation" ? "视频" : "图片"}生成提案，正在等待你的决定。`
    ),
  ],
  createdAt: proposal.createdAt,
  updatedAt: Date.now(),
});

const upsertApprovalMessage = (
  messages: Message[],
  approval: ApprovalMessage["approval"]
) => {
  const index = messages.findIndex(
    (message) => message.kind === "approval" && message.approval.nodeId === approval.nodeId
  );
  const next: ApprovalMessage = {
    role: "assistant",
    kind: "approval",
    order: index >= 0 ? messages[index].order : messages.reduce((max, message) => Math.max(max, message.order || 0), 0) + 1,
    approval,
  };
  if (index >= 0) {
    const clone = [...messages];
    clone[index] = next;
    return clone;
  }
  return [...messages, next];
};

const patchApprovalMessage = (
  messages: Message[],
  nodeId: string,
  patch: Partial<ApprovalMessage["approval"]>,
  options?: {
    appendStep?: ApprovalMessage["approval"]["steps"][number];
  }
) =>
  messages.map((message) => {
    if (message.kind !== "approval" || message.approval.nodeId !== nodeId) return message;
    const existingSteps = Array.isArray(message.approval.steps) ? message.approval.steps : [];
    const nextSteps =
      options?.appendStep && !existingSteps.some((step) => step.id === options.appendStep!.id)
        ? [...existingSteps, options.appendStep]
        : existingSteps;
    return {
      ...message,
      approval: {
        ...message.approval,
        ...patch,
        steps: nextSteps,
        updatedAt: Date.now(),
      },
    };
  });

const summarizeApprovedExecutionResult = (
  nodeId: string,
  fallbackTitle: string
): { status: ApprovalStatus; summary: string } => {
  const node = useNodeFlowStore.getState().getNodeById(nodeId);
  if (!node) {
    return {
      status: "failed",
      summary: `已批准执行 ${fallbackTitle}，但节点已不存在。请在 Flow Workspace 中检查该任务是否被删除。`,
    };
  }
  const title = String((node.data as Record<string, unknown>)?.title || fallbackTitle || node.type);
  const status = String((node.data as Record<string, unknown>)?.status || "");
  const error = String((node.data as Record<string, unknown>)?.error || "").trim();
  const outputImage = String((node.data as Record<string, unknown>)?.outputImage || "").trim();
  const videoUrl = String((node.data as Record<string, unknown>)?.videoUrl || "").trim();

  if (status === "complete") {
    if (outputImage) {
      return {
        status: "completed",
        summary: `已批准并完成图片生成：${title}。结果已经写回节点，当前可以继续围绕这张图进行后续编辑或连线操作。`,
      };
    }
    if (videoUrl) {
      return {
        status: "completed",
        summary: `已批准并完成视频生成：${title}。结果已经写回节点，当前可以继续围绕这段视频进行后续编辑或串联工作流。`,
      };
    }
    return {
      status: "completed",
      summary: `已批准并完成执行：${title}。结果已经写回对应节点。`,
    };
  }

  if (status === "error") {
    return {
      status: "failed",
      summary: `已批准执行 ${title}，但任务失败了。${error || "请检查该节点的配置、输入素材或服务端返回信息。"}`,
    };
  }

  if (status === "loading") {
    return {
      status: "executing",
      summary: `已批准执行 ${title}，任务已经启动，当前仍在处理中。结果会持续写回该节点。`,
    };
  }

  return {
    status: "approved",
    summary: `已批准执行 ${title}。当前节点状态为 ${status || "unknown"}，请继续观察结果回写。`,
  };
};

const buildConversationTitle = (messages: Message[]) => {
  const firstUser = messages.find((m) => m.role === "user" && (m as ChatMessage).text?.trim()) as ChatMessage | undefined;
  if (!firstUser) return "新对话";
  const text = firstUser.text.trim();
  return text.length > 20 ? `${text.slice(0, 20)}...` : text;
};

const createConversationRecord = (messages: Message[] = []): ConversationRecord => {
  const now = Date.now();
  const title = buildConversationTitle(messages);
  return {
    id: createStableId("chat"),
    title,
    createdAt: now,
    updatedAt: now,
    messages,
  };
};

export const StyloAgent: React.FC<Props> = ({
  accountScope,
  projectId,
  projectData,
  config,
  setProjectData,
  getAuthToken,
  syncState,
  ensureProjectSynced,
  onOpenStats,
  settingsOpen = false,
  openRequest = 0,
  closeRequest = 0,
  submitRequest = null,
  cancelRequest = 0,
  onCollapsedChange,
  onDockFrameChange,
  onSendingChange,
  renderCollapsedTrigger = true,
  agentFirstMode = false,
  conversationStorageKey,
  allowLegacyConversationMigration = false,
  conversationResetToken,
  panelStyleOverride,
  showUsageBadge = true,
  onScriptEditProposals,
}) => {
  const PANEL_ANIMATION_MS = 460;
  const accountStorageKeys = buildStyloAccountStorageKeys(accountScope, projectId);
  const effectiveConversationStorageKey = conversationStorageKey || accountStorageKeys.conversationStorageKey;
  const activityStorageKey = accountStorageKeys.activityStorageKey;
  const approvalPreferenceStorageKey = accountScope === "guest"
    ? "stylo_execution_approval_prefs_v1"
    : `stylo_execution_approval_prefs_v1:${encodeURIComponent(accountScope)}`;
  const importNodeFlow = useNodeFlowStore((state) => state.importNodeFlow);
  const setExecutionApprovals = useNodeFlowStore((state) => state.setExecutionApprovals);
  const pendingExecutionApprovals = useNodeFlowStore((state) => state.pendingExecutionApprovals);
  const nodes = useNodeFlowStore((state) => state.nodes);
  const links = useNodeFlowStore((state) => state.links);
  const graphLinks = useNodeFlowStore((state) => state.graphLinks);
  const revision = useNodeFlowStore((state) => state.revision);
  const linkStyle = useNodeFlowStore((state) => state.linkStyle);
  const globalAssetHistory = useNodeFlowStore((state) => state.globalAssetHistory);
  const nodeFlowContext = useNodeFlowStore((state) => state.nodeFlowContext);
  const activeView = useNodeFlowStore((state) => state.activeView);
  const projectDataRef = useRef(projectData);
  projectDataRef.current = projectData;
  const viewport = useNodeFlowStore((state) => state.viewport);
  const [collapsed, setCollapsed] = useState(true);
  const [isRevealing, setIsRevealing] = useState(false);
  const [panelPhase, setPanelPhase] = useState<"collapsed" | "opening" | "open" | "closing">("collapsed");
  const [conversationState, setConversationState] = usePersistedState<ConversationState>({
    key: effectiveConversationStorageKey,
    initialValue: { activeId: "", items: [] },
    debounceMs: 180,
    serialize: (value) => JSON.stringify(value),
    deserialize: (value) => {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.items)) {
          return {
            activeId: typeof parsed.activeId === "string" ? parsed.activeId : "",
            items: parsed.items,
          } as ConversationState;
        }
        return { activeId: "", items: [] };
      } catch {
        return { activeId: "", items: [] };
      }
    },
  });
  const conversationStateRef = useRef(conversationState);
  conversationStateRef.current = conversationState;
  const [approvalPreferences, setApprovalPreferences] = usePersistedState<ApprovalPreferenceState>({
    key: approvalPreferenceStorageKey,
    initialValue: {},
    serialize: (value) => JSON.stringify(value),
    deserialize: (value) => {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        return {};
      }
    },
  });
  const { approveExecution, dismissExecutionApproval } = useNodeFlowExecutor();
  const clampMessages = useCallback((items: Message[]) => items.slice(-120), []);
  const activeConversation = useMemo(() => {
    if (!conversationState.items.length) return null;
    return (
      conversationState.items.find((item) => item.id === conversationState.activeId) ||
      conversationState.items[0] ||
      null
    );
  }, [conversationState.items, conversationState.activeId]);
  const messages = activeConversation?.messages || [];
  const setMessages = useCallback(
    (updater: Message[] | ((prev: Message[]) => Message[])) => {
      const previous = conversationStateRef.current;
      let items = [...previous.items];
      let activeId = previous.activeId;
      if (!items.length) {
        const created = createConversationRecord();
        items = [created];
        activeId = created.id;
      }
      if (!activeId && items.length) activeId = items[0].id;
      let idx = items.findIndex((item) => item.id === activeId);
      if (idx < 0) {
        const created = createConversationRecord();
        items = [created, ...items];
        activeId = created.id;
        idx = 0;
      }
      const current = items[idx];
      const currentMessages = Array.isArray(current.messages) ? current.messages : [];
      const nextMessages =
        typeof updater === "function" ? (updater as (p: Message[]) => Message[])(currentMessages) : updater;
      const clamped = clampMessages(nextMessages);
      const nextTitle = current.title && current.title !== "新对话" ? current.title : buildConversationTitle(clamped);
      items[idx] = {
        ...current,
        title: nextTitle,
        messages: clamped,
        updatedAt: Date.now(),
      };
      const nextState = { ...previous, activeId, items };
      conversationStateRef.current = nextState;
      setConversationState(nextState);
      return clamped;
    },
    [setConversationState, clampMessages]
  );
  const [isSending, setIsSending] = useState(false);
  const submittingRef = useRef(false);
  const [viewportSize, setViewportSize] = useState(
    typeof window !== "undefined"
      ? { width: window.innerWidth, height: window.innerHeight }
      : { width: 1200, height: 900 }
  );
  const handledSubmitRequestRef = useRef<number>(0);
  const handledCancelRequestRef = useRef<number>(cancelRequest);
  const phaseTimerRef = useRef<number | null>(null);
  const messagePanelRef = useRef<HTMLDivElement | null>(null);
  const glassAnchorRef = useRef<HTMLDivElement | null>(null);
  const approvalSyncRef = useRef<string[]>([]);
  const handledConversationResetRef = useRef<number | null>(null);
  const [messagePanelSize, setMessagePanelSize] = useState({ width: 0, height: 0 });
  const [glassAnchorFrame, setGlassAnchorFrame] = useState({ left: 0, top: 0 });
  const effectiveCollapsed = collapsed;
  const dockInset = 16;
  const syncStateRef = useRef(syncState);
  syncStateRef.current = syncState;
  const waitForProjectSync = useCallback(async () => {
    const deadline = Date.now() + 15_000;
    while (true) {
      const projectSync = syncStateRef.current?.project;
      if (!projectSync) return;
      if (projectSync.status === "disabled") {
        throw new Error("Agent 工具需要云端项目状态，但当前账户未启用项目同步。");
      }
      if (projectSync.status === "error" || projectSync.status === "conflict") {
        throw new Error(projectSync.lastError || "项目同步尚未完成，Agent 无法读取权威项目状态。");
      }
      if (projectSync.status === "synced" && (projectSync.pendingOps || 0) === 0) return;
      if (Date.now() >= deadline) {
        throw new Error("等待项目同步超时。Agent 未读取本地快照，请确认同步完成后重试。");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
  }, []);
  const prepareProjectToolState = useCallback(async (): Promise<ProjectSyncLease> => {
    const flowState = getNodeFlowSnapshot();
    const expectedRevision = flowState.revision;
    const nodeFlowSnapshot: NodeFlowFile = {
      version: 2,
      revision: expectedRevision,
      name: projectDataRef.current.fileName || "Stylo Flow Workspace",
      nodes: flowState.nodes,
      links: flowState.links,
      graphLinks: flowState.graphLinks,
      linkStyle: flowState.linkStyle,
      globalAssetHistory: flowState.globalAssetHistory,
      nodeFlowContext: flowState.nodeFlowContext,
      viewport: flowState.viewport || undefined,
      activeView: flowState.activeView,
    };
    const snapshot = mergeNodeFlowIntoProjectData(projectDataRef.current, nodeFlowSnapshot);
    projectDataRef.current = snapshot;
    setProjectData(snapshot);
    if (ensureProjectSynced) {
      return ensureProjectSynced(snapshot, expectedRevision);
    }
    await waitForProjectSync();
    return { expectedRevision, remoteVersion: 0, release: () => undefined };
  }, [ensureProjectSynced, setProjectData, waitForProjectSync]);
  const edgeRuntime = useMemo(
    () =>
      createHttpStyloAgentRuntime({
        endpoint: buildApiUrl("/api/agent"),
        getRuntimeConfig: () => ({
          provider: config.textConfig?.agentProvider || "deepseek",
          model: resolveAgentRuntimeModel(config.textConfig),
          baseUrl:
            config.textConfig?.agentBaseUrl ||
            (config.textConfig?.agentProvider === config.textConfig?.provider ? config.textConfig?.baseUrl : undefined),
          styloTools: config.textConfig?.styloTools,
        }),
        getAuthToken,
        getProjectRevision: () => useNodeFlowStore.getState().revision,
        beforeRequest: prepareProjectToolState,
      }),
    [
      config.textConfig?.agentBaseUrl,
      config.textConfig?.agentModel,
      config.textConfig?.agentProvider,
      config.textConfig?.baseUrl,
      config.textConfig?.model,
      config.textConfig?.provider,
      config.textConfig?.styloTools,
      getAuthToken,
      prepareProjectToolState,
    ]
  );
  const runtime = edgeRuntime;
  const mentionTargets = useMemo(() => {
    const targets: Array<{ kind: "character" | "location"; name: string; label: string; search: string; id?: string }> = [];
    projectRolesToCharacters(projectData.roles || []).forEach((c) => {
      if (!c?.name) return;
      const aliases = [c.name, ...((c.aliases || []).map((item) => item.value))].filter(Boolean);
      const seen = new Set<string>();
      aliases.forEach((alias) => {
        const key = toSearch(alias);
        if (!key || seen.has(key)) return;
        seen.add(key);
        targets.push({
          kind: "character",
          name: alias,
          label: alias === c.name ? `角色 · ${c.name}` : `角色 · ${c.name}（别名）`,
          search: toSearch([alias, c.name, c.role, c.bio, ...(c.tags || [])].filter(Boolean).join(" ")),
          id: c.id,
        });
      });
    });
    projectRolesToLocations(projectData.roles || []).forEach((l) => {
      if (!l?.name) return;
      targets.push({
        kind: "location",
        name: l.name,
        label: `场景 · ${l.name}`,
        search: toSearch(l.name),
        id: l.id,
      });
    });
    return targets;
  }, [projectData.roles]);
  const { sendMessage: runAgentMessage, cancel: cancelAgentRun } = useStyloAgent({
    runtime,
    projectId,
    sessionId: buildStyloAccountSessionId(
      accountScope,
      projectId,
      activeConversation?.id || conversationState.activeId || "stylo-default"
    ),
    activityStorageKey,
    setMessages,
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const node = messagePanelRef.current;
    if (!node) return;

    const update = () => {
      const rect = node.getBoundingClientRect();
      setMessagePanelSize({ width: rect.width, height: rect.height });
    };

    update();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => update());
    observer.observe(node);
    return () => observer.disconnect();
  }, [collapsed, messages.length, panelPhase]);

  useEffect(() => {
    const node = glassAnchorRef.current;
    if (!node) return;

    const update = () => {
      const rect = node.getBoundingClientRect();
      setGlassAnchorFrame({ left: rect.left, top: rect.top });
    };

    update();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => update());
    observer.observe(node);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [collapsed, messages.length, panelPhase]);

  useEffect(() => {
    if (conversationState.items.length) return;
    try {
      if (allowLegacyConversationMigration) {
        const legacyConversations = localStorage.getItem("stylo_conversations_v1");
        if (legacyConversations) {
          const parsed = JSON.parse(legacyConversations);
          if (parsed && typeof parsed === "object" && Array.isArray(parsed.items) && parsed.items.length) {
            setConversationState({
              activeId: typeof parsed.activeId === "string" ? parsed.activeId : parsed.items[0]?.id || "",
              items: parsed.items,
            });
            localStorage.removeItem("stylo_conversations_v1");
            return;
          }
        }
      }
      const stored = localStorage.getItem("stylo_messages_v1");
      if (allowLegacyConversationMigration && stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length) {
          const migrated = createConversationRecord(clampMessages(parsed));
          setConversationState({ activeId: migrated.id, items: [migrated] });
          localStorage.removeItem("stylo_messages_v1");
          return;
        }
      }
    } catch {}
    if (!conversationState.items.length) {
      const created = createConversationRecord();
      setConversationState({ activeId: created.id, items: [created] });
    }
  }, [allowLegacyConversationMigration, conversationState.items.length, setConversationState, clampMessages]);

  useEffect(() => {
    if (!conversationState.items.length) return;
    if (!conversationState.activeId) {
      setConversationState((prev) => ({ ...prev, activeId: prev.items[0]?.id || "" }));
      return;
    }
    if (!conversationState.items.find((item) => item.id === conversationState.activeId)) {
      setConversationState((prev) => ({ ...prev, activeId: prev.items[0]?.id || "" }));
    }
  }, [conversationState.activeId, conversationState.items, setConversationState]);

  useEffect(() => {
    if (typeof conversationResetToken !== "number" || conversationResetToken <= 0) return;
    if (handledConversationResetRef.current === conversationResetToken) return;
    handledConversationResetRef.current = conversationResetToken;
    const created = createConversationRecord();
    setConversationState({
      activeId: created.id,
      items: [created],
    });
  }, [conversationResetToken, setConversationState]);

  useEffect(() => {
    onCollapsedChange?.(effectiveCollapsed);
  }, [effectiveCollapsed, onCollapsedChange]);

  useEffect(() => {
    onSendingChange?.(isSending);
  }, [isSending, onSendingChange]);

  useEffect(() => {
    return () => {
      if (phaseTimerRef.current) window.clearTimeout(phaseTimerRef.current);
    };
  }, []);

  const triggerReveal = useCallback(() => {
    setIsRevealing(true);
    setTimeout(() => setIsRevealing(false), 900);
  }, []);

  const openPanel = useCallback(() => {
    if (phaseTimerRef.current) window.clearTimeout(phaseTimerRef.current);
    setCollapsed(false);
    setPanelPhase((prev) => (prev === "open" ? "open" : "opening"));
    triggerReveal();
    phaseTimerRef.current = window.setTimeout(() => {
      setPanelPhase("open");
      phaseTimerRef.current = null;
    }, PANEL_ANIMATION_MS);
  }, [triggerReveal]);

  const closePanel = useCallback(() => {
    if (phaseTimerRef.current) window.clearTimeout(phaseTimerRef.current);
    setPanelPhase("closing");
    phaseTimerRef.current = window.setTimeout(() => {
      setCollapsed(true);
      setPanelPhase("collapsed");
      phaseTimerRef.current = null;
    }, PANEL_ANIMATION_MS);
  }, []);

  useEffect(() => {
    if (phaseTimerRef.current) {
      window.clearTimeout(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
    if (!agentFirstMode || !collapsed) return;
    openPanel();
  }, [agentFirstMode, collapsed, openPanel]);

  useEffect(() => {
    if (!settingsOpen) return;
    openPanel();
  }, [openPanel, settingsOpen]);

  useEffect(() => {
    const isNewCancelRequest = cancelRequest !== handledCancelRequestRef.current;
    handledCancelRequestRef.current = cancelRequest;
    if (!isNewCancelRequest || !isSending) return;
    cancelAgentRun();
  }, [cancelAgentRun, cancelRequest, isSending]);

  useEffect(() => {
    const panelWidth = agentFirstMode
      ? Math.max(320, viewportSize.width - dockInset * 2)
      : Math.min(420, Math.max(320, viewportSize.width - dockInset * 2));
    onDockFrameChange?.({
      dockWidth: effectiveCollapsed ? 0 : Math.min(viewportSize.width, dockInset + panelWidth + 16),
      isSplit: false,
      collapsed: effectiveCollapsed,
    });
  }, [agentFirstMode, dockInset, effectiveCollapsed, onDockFrameChange, viewportSize.width]);

  useEffect(() => {
    const proposals = Object.values(pendingExecutionApprovals).sort((a, b) => a.createdAt - b.createdAt);
    const previousNodeIds = new Set(approvalSyncRef.current);
    const newProposals = proposals.filter((proposal) => !previousNodeIds.has(proposal.nodeId));
    approvalSyncRef.current = proposals.map((proposal) => proposal.nodeId);

    if (!proposals.length) return;

    setMessages((prev) => {
      let next = prev;
      proposals.forEach((proposal) => {
        const existing = next.find(
          (message): message is ApprovalMessage =>
            message.kind === "approval" && message.approval.nodeId === proposal.nodeId
        );
        const isSameProposal = existing?.approval.id === proposal.id;
        if (isSameProposal && existing) {
          next = patchApprovalMessage(next, proposal.nodeId, {
            nodeTitle: proposal.nodeTitle,
            providerLabel: proposal.providerLabel,
            modelLabel: proposal.modelLabel,
            promptPreview: proposal.promptPreview,
            inputSummary: proposal.inputSummary,
          });
          return;
        }
        next = upsertApprovalMessage(next, buildApprovalPayload(proposal, "pending"));
      });
      return next;
    });

    if (newProposals.some((proposal) => !approvalPreferences[proposal.action])) {
      openPanel();
    }

    newProposals
      .filter((proposal) => approvalPreferences[proposal.action])
      .forEach((proposal) => {
        setMessages((prev) =>
          patchApprovalMessage(
            prev,
            proposal.nodeId,
            {
              status: "executing",
              summary: `已按你的默认偏好自动批准，正在执行 ${proposal.nodeTitle} 的${proposal.action === "video_generation" ? "视频" : "图片"}生成。`,
            },
            {
              appendStep: createApprovalStep(
                "approved-auto",
                "已自动批准",
                "success",
                "系统根据你的默认偏好自动通过了这次执行请求。"
              ),
            }
          )
        );
        void approveExecution(proposal.nodeId)
          .then(() => {
            const result = summarizeApprovedExecutionResult(proposal.nodeId, proposal.nodeTitle);
            setMessages((prev) => {
              return patchApprovalMessage(
                prev,
                proposal.nodeId,
                { status: result.status, summary: result.summary },
                {
                  appendStep: createApprovalStep(
                    result.status === "failed" ? "completed-error" : "completed-success",
                    result.status === "failed" ? "执行失败" : "执行完成",
                    result.status === "failed" ? "error" : "success",
                    result.summary
                  ),
                }
              );
            });
          })
          .catch((error: any) => {
            const message = `已批准执行 ${proposal.nodeTitle}，但执行过程中出现错误：${String(error?.message || error || "未知错误")}`;
            setMessages((prev) => {
              return patchApprovalMessage(
                prev,
                proposal.nodeId,
                { status: "failed", summary: message },
                {
                  appendStep: createApprovalStep("execution-error", "执行失败", "error", message),
                }
              );
            });
          });
      });
  }, [approvalPreferences, approveExecution, openPanel, pendingExecutionApprovals, setMessages]);

  const submitText = useCallback(async (rawText: string, submittedUiContext?: AgentUiContext) => {
    const cleanedInput = rawText.trim();
    if (!cleanedInput || submittingRef.current) return;
    submittingRef.current = true;
    const runProjectId = projectId;
    const runFlowRevision = getNodeFlowSnapshot().revision;
    const runAccountGeneration = useNodeFlowStore.getState().accountGeneration;
    const isRunAccountCurrent = () =>
      useNodeFlowStore.getState().accountGeneration === runAccountGeneration;
    setMessages((prev) => {
      const nextOrder = prev.reduce((max, message) => Math.max(max, message.order || 0), 0) + 1;
      const userMsg: Message = { role: "user", text: cleanedInput, kind: "chat", order: nextOrder };
      return [...prev, userMsg];
    });
    setIsSending(true);
    try {
      const runResult = await runAgentMessage({
        userText: cleanedInput,
        enabledSkillIds: [],
        uiContext: submittedUiContext,
      });
      if (
        !isRunAccountCurrent() ||
        runResult.projectId !== runProjectId ||
        resolveStyloProjectId(projectDataRef.current) !== runProjectId
      ) {
        return;
      }
      const latestFlowRevision = getNodeFlowSnapshot().revision;
      if (shouldRejectStaleAgentResult(runResult, runFlowRevision, latestFlowRevision)) {
        const conflictMessage = buildAgentRevisionConflictMessage(runFlowRevision, latestFlowRevision);
        setMessages((previous) => reconcileStaleAgentMessages(previous, runResult, conflictMessage));
        return;
      }
      const agentProjectPatch = normalizeAgentProjectPatch(
        runResult.updatedProjectPatch || runResult.updatedProjectData,
        runProjectId
      );
      if (agentProjectPatch || runResult.updatedNodeFlow) {
        const latestProjectData = projectDataRef.current;
        const currentFlow = buildNodeFlowFileFromProjectData(latestProjectData, {
          revision,
          linkStyle,
          nodeFlowContext,
          viewport: viewport || undefined,
          activeView,
        });
        const candidateFlowInput =
          runResult.updatedNodeFlow ||
          (agentProjectPatch?.flow
            ? buildNodeFlowFileFromProjectData({ ...latestProjectData, flow: agentProjectPatch.flow }, {
                revision,
                linkStyle,
                nodeFlowContext,
                viewport: viewport || undefined,
                activeView,
              })
            : null);
        const parsedCandidateFlow = candidateFlowInput
          ? parseNodeFlowFile(candidateFlowInput)
          : null;
        const candidateFlow = parsedCandidateFlow && currentFlow
          ? {
              ...parsedCandidateFlow,
              nodes: restoreLocalNodeMedia(parsedCandidateFlow.nodes, currentFlow.nodes),
            }
          : parsedCandidateFlow;
        const proposals =
          currentFlow && candidateFlow
            ? collectScriptEditProposals(currentFlow.nodes, candidateFlow.nodes)
            : [];
        const committedFlow =
          candidateFlow && currentFlow
            ? preserveProposedScriptEdits(candidateFlow, currentFlow.nodes, proposals)
            : candidateFlow;
        const resultBase = applyAgentProjectPatch(latestProjectData, agentProjectPatch, runProjectId);

        if (committedFlow) {
          if (!isRunAccountCurrent()) return;
          const nextProjectData = mergeNodeFlowIntoProjectData(resultBase, committedFlow);
          setProjectData(nextProjectData);
          projectDataRef.current = nextProjectData;
          importNodeFlow(committedFlow, { expectedAccountGeneration: runAccountGeneration });
        } else if (agentProjectPatch) {
          setProjectData(resultBase);
          projectDataRef.current = resultBase;
        }

        if (proposals.length) {
          onScriptEditProposals?.({
            id: `agent-script-batch-${Date.now().toString(36)}`,
            proposals,
          });
        }
      }
      if (runResult.updatedExecutionApprovals) {
        if (!isRunAccountCurrent()) return;
        setExecutionApprovals(runResult.updatedExecutionApprovals);
      }
    } catch (err: any) {
      if (err?.styloAlreadyDisplayed) {
        return;
      }
      const message = String(err?.message || err || "");
      const isAborted =
        err?.name === "AbortError" ||
        message.includes("aborted") ||
        message.includes("AbortError") ||
        message.includes("用户已停止") ||
        message.includes("已取消");
      if (isAborted) {
        setMessages((prev) => {
          const nextOrder = prev.reduce((max, message) => Math.max(max, message.order || 0), 0) + 1;
          return [
            ...prev,
            { role: "assistant", text: "已停止当前任务。", kind: "chat", order: nextOrder },
          ];
        });
        return;
      }
      setMessages((prev) => {
        const nextOrder = prev.reduce((max, message) => Math.max(max, message.order || 0), 0) + 1;
        return [
          ...prev,
          { role: "assistant", text: `请求失败: ${err?.message || err}`, kind: "chat", order: nextOrder },
        ];
      });
    } finally {
      submittingRef.current = false;
      setIsSending(false);
    }
  }, [accountScope, activeView, importNodeFlow, linkStyle, nodeFlowContext, onScriptEditProposals, projectId, revision, runAgentMessage, setExecutionApprovals, setMessages, setProjectData, viewport]);

  const panelClassName = "pointer-events-auto stylo-panel";
  const titleOrigin = { x: 16, y: 20, width: 126, height: 42, radius: 12 };
  const handleApprovalChoice = useCallback(
    async (approval: ApprovalMessage["approval"], choice: ApprovalChoice) => {
      if (choice === "reject_once") {
        dismissExecutionApproval(approval.nodeId);
        setMessages((prev) =>
          patchApprovalMessage(
            prev,
            approval.nodeId,
            {
              status: "rejected",
              summary: `已拒绝本次 ${approval.nodeTitle} 的执行请求。该节点配置会保留，但不会启动生成。`,
            },
            {
              appendStep: createApprovalStep(
                "rejected",
                "已拒绝",
                "error",
                "本次请求不会执行，你可以稍后调整节点配置后再重新发起。"
              ),
            }
          )
        );
        return;
      }
      if (choice === "approve_always") {
        setApprovalPreferences((prev) => ({ ...prev, [approval.action]: true }));
      }
      setMessages((prev) =>
        patchApprovalMessage(
          prev,
          approval.nodeId,
          {
            status: "executing",
            summary:
              choice === "approve_always"
                ? `已批准本次请求，并记住你对${approval.action === "video_generation" ? "视频" : "图片"}生成的默认同意偏好。`
                : `已批准 ${approval.nodeTitle} 的${approval.action === "video_generation" ? "视频" : "图片"}生成请求，正在执行。`,
          },
          {
            appendStep: createApprovalStep(
              choice === "approve_always" ? "approved-always" : "approved-once",
              choice === "approve_always" ? "已批准并记住偏好" : "已批准执行",
              "success",
              choice === "approve_always"
                ? "后续同类 Agent 生成请求会自动通过。"
                : "本次请求已经通过，系统正在启动执行。"
            ),
          }
        )
      );
      try {
        await approveExecution(approval.nodeId);
        const result = summarizeApprovedExecutionResult(approval.nodeId, approval.nodeTitle);
        setMessages((prev) => {
          return patchApprovalMessage(
            prev,
            approval.nodeId,
            { status: result.status, summary: result.summary },
            {
              appendStep: createApprovalStep(
                result.status === "failed" ? "completed-error" : "completed-success",
                result.status === "failed" ? "执行失败" : "执行完成",
                result.status === "failed" ? "error" : "success",
                result.summary
              ),
            }
          );
        });
      } catch (error: any) {
        const message = `已批准执行 ${approval.nodeTitle}，但执行过程中出现错误：${String(error?.message || error || "未知错误")}`;
        setMessages((prev) => {
          return patchApprovalMessage(
            prev,
            approval.nodeId,
            { status: "failed", summary: message },
            {
              appendStep: createApprovalStep("execution-error", "执行失败", "error", message),
            }
          );
        });
      }
    },
    [approveExecution, dismissExecutionApproval, setApprovalPreferences, setMessages]
  );
  const styloVisibleMaxHeight = Math.max(280, Math.floor(viewportSize.height * 0.8));
  const styloChromeHeight = 62;
  const messageViewportHeight = Math.max(180, styloVisibleMaxHeight - styloChromeHeight);
  const styloGlassConfig = useMemo(
    () => ({
      ...GLASS_DIFFUSION_PRESETS.stylo,
      ...STYLO_GLASS_LAB_CONFIG,
    }),
    []
  );
  const styloGlassShadow = STYLO_GLASS_LAB_SHADOW;
  const styloTitleBandHeight = titleOrigin.y + titleOrigin.height + 10;
  const styloUnifiedBaseWidth = Math.max(0, messagePanelSize.width);
  const styloGlassBaseHeight = Math.min(
    styloVisibleMaxHeight,
    Math.max(styloChromeHeight + 12, styloChromeHeight + messagePanelSize.height)
  );
  const styloUnifiedBaseHeight = styloGlassBaseHeight + styloTitleBandHeight;
  const styloGlassSafeInsetX = styloGlassConfig.fadeInsetX + 12;
  const styloGlassSafeInsetTop = styloGlassConfig.fadeInsetY + 24;
  const styloGlassSafeInsetBottom = styloGlassConfig.fadeInsetY + 14;
  const styloGlassWidth = Math.max(0, Math.round(styloUnifiedBaseWidth + styloGlassSafeInsetX * 2));
  const styloGlassHeight = Math.max(
    0,
    Math.round(styloUnifiedBaseHeight + styloGlassSafeInsetTop + styloGlassSafeInsetBottom)
  );
  const styloGlassOffsetX = -styloGlassSafeInsetX;
  const styloGlassOffsetY = -styloTitleBandHeight - styloGlassSafeInsetTop;
  const styloGlassLeft = glassAnchorFrame.left + styloGlassOffsetX;
  const styloGlassTop = glassAnchorFrame.top + styloGlassOffsetY;
  const panelStyle: React.CSSProperties | undefined = {
    position: "fixed",
    top: dockInset,
    left: dockInset,
    width: agentFirstMode
      ? Math.max(320, viewportSize.width - dockInset * 2)
      : Math.min(420, Math.max(320, viewportSize.width - dockInset * 2)),
    maxWidth: `calc(100vw - ${dockInset * 2}px)`,
    zIndex: 80,
  };
  const resolvedPanelStyle: React.CSSProperties = {
    ...panelStyle,
    ...(panelStyleOverride || {}),
  };

  const tokenUsage = useMemo(() => {
    return projectData.phase5Usage?.totalTokens || 0;
  }, [projectData]);

  const formatNumber = (n: number) => n.toLocaleString();
  const styloMark = (
    <span
      className={`stylo-wordmark inline-flex items-center text-[28px] font-semibold transition duration-500 ${
        !effectiveCollapsed || isSending || isRevealing ? "stylo-wordmark--active opacity-100 blur-0" : "opacity-96"
      }`}
    >
      <span>Stylo</span>
    </span>
  );

  useEffect(() => {
    if (!openRequest) return;
    openPanel();
  }, [openPanel, openRequest]);

  useEffect(() => {
    if (!closeRequest) return;
    closePanel();
  }, [closePanel, closeRequest]);

  useEffect(() => {
    if (!submitRequest?.id || !submitRequest.text.trim()) return;
    if (submitRequest.projectId && submitRequest.projectId !== projectId) return;
    if (handledSubmitRequestRef.current === submitRequest.id) return;
    handledSubmitRequestRef.current = submitRequest.id;
    openPanel();
    void submitText(submitRequest.text, submitRequest.uiContext);
  }, [openPanel, projectId, submitRequest, submitText]);

  const isOpenPhase = panelPhase === "open";
  const styloGlassOverlay =
    typeof document !== "undefined" && !effectiveCollapsed && styloGlassWidth > 0 && styloGlassHeight > 0
      ? createPortal(
          <div
            className="pointer-events-none fixed z-[79] transition-opacity duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{
              left: styloGlassLeft,
              top: styloGlassTop,
              width: styloGlassWidth,
              height: styloGlassHeight,
              opacity: effectiveCollapsed ? 0 : 1,
            }}
            aria-hidden="true"
          >
            <GlassDiffusionField
              className="absolute inset-0"
              width={styloGlassWidth}
              height={styloGlassHeight}
              config={{
                blur: styloGlassConfig.blur,
                fillAlpha: styloGlassConfig.fillAlpha,
                saturate: styloGlassConfig.saturate,
                fadeInsetX: styloGlassConfig.fadeInsetX,
                fadeInsetY: styloGlassConfig.fadeInsetY,
                fade: styloGlassConfig.fade,
                edgeAlpha: styloGlassConfig.edgeAlpha,
                curve: styloGlassConfig.curve,
              }}
              showBoundary={false}
            />
            <MaterialGlassShadow
              width={styloGlassWidth}
              height={styloGlassHeight}
              curve={styloGlassConfig.curve}
              offsetX={styloGlassShadow.offsetX}
              offsetY={styloGlassShadow.offsetY}
              blur={styloGlassShadow.blur}
              alpha={styloGlassShadow.alpha}
              spread={styloGlassShadow.spread}
            />
          </div>,
          document.body
        )
      : null;

  return (
    <>
      {styloGlassOverlay}
      <div
        className={panelClassName}
        style={{
          ...resolvedPanelStyle,
          transition: `opacity ${PANEL_ANIMATION_MS}ms cubic-bezier(0.16,1,0.3,1)`,
          pointerEvents: "none",
          overflow: "visible",
          background: "transparent",
          boxShadow: "none",
          backdropFilter: "none",
          WebkitBackdropFilter: "none",
          fontFamily: '"Outfit", "Avenir Next", "SF Pro Display", "Segoe UI", sans-serif',
        }}
      >
        <div className="relative">
        <div
          className="stylo-header-shell absolute left-4 right-4 z-20 flex items-center justify-between gap-3"
          style={{ top: titleOrigin.y, minHeight: titleOrigin.height }}
        >
          <div className="flex min-w-0 items-center gap-3">
            {(!collapsed || renderCollapsedTrigger) ? (
            <button
              type="button"
              onClick={collapsed ? openPanel : closePanel}
              className="pointer-events-auto inline-flex items-center transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-px"
              aria-label={collapsed ? "Open Stylo" : "Close Stylo"}
              title={collapsed ? "Open Stylo" : "Close Stylo"}
            >
              {styloMark}
            </button>
            ) : null}
            {!effectiveCollapsed && showUsageBadge && (
              <button
                type="button"
                onClick={onOpenStats}
                className="pointer-events-auto inline-flex h-8 items-center rounded-full border border-white/8 bg-white/6 px-3 text-[11px] text-[var(--app-text-secondary)] backdrop-blur-md transition hover:border-white/12 hover:bg-white/9 hover:text-[var(--app-text-primary)]"
                title="打开 Setting"
              >
                <span>{formatNumber(tokenUsage)}</span>
              </button>
            )}
          </div>
        </div>
        <div
          className={`px-4 pb-4 pt-[38px] transition-opacity duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            effectiveCollapsed ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100"
          }`}
        >
          <div ref={glassAnchorRef} className="relative">
            <div
              ref={messagePanelRef}
              className="relative z-10 rounded-[30px] bg-transparent"
            >
              <StyloChatContent
                messages={messages}
                isSending={isSending}
                onApprovalChoice={handleApprovalChoice}
                className="bg-transparent"
                revealMode="latest"
                latestBlockMaxHeight={messageViewportHeight}
                style={{ maxHeight: `${messageViewportHeight}px` }}
              />
            </div>
          </div>
        </div>
      </div>
      </div>
    </>
  );
};
