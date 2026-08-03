import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  AlertCircle,
  Boxes,
  CheckCircle,
  ChevronDown,
  Cloud,
  Code2,
  Braces,
  Eye,
  FileText,
  Globe,
  Github,
  Layers,
  Loader2,
  ScanSearch,
  Sparkles,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { usePersistedState } from "../../hooks/usePersistedState";
import { buildApiUrl } from "../../utils/api";
import { AgentTextProvider, AppConfig, ProjectData, SyncState, type SeedanceKeyProbeResult } from "../../types";
import {
  ARK_DEFAULT_MODEL,
  ARK_RESPONSES_BASE_URL,
  DEFAULT_STYLO_TOOL_SETTINGS,
  DEEPSEEK_RESPONSES_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL,
  INITIAL_VIDU_CONFIG,
  NANOBANANA_PRO_ENDPOINT,
  NANOBANANA_PRO_MODEL,
  OPENROUTER_RESPONSES_BASE_URL,
  QWEN_DEFAULT_MODEL,
  QWEN_RESPONSES_BASE_URL,
  QWEN_WAN_IMAGE_ENDPOINT,
  QWEN_WAN_IMAGE_MODEL,
  QWEN_WAN_VIDEO_MODEL,
  SEEDANCE_DEFAULT_BASE_URL,
  SEEDANCE_DEFAULT_MODEL,
  SEEDANCE_FAST_MODEL,
  VIDU_DEFAULT_BASE_URL,
} from "../../constants";
import { normalizeStyloToolSettings } from "../../agents/runtime/toolSettings";
import { listStyloToolNames } from "../../agents/runtime/toolCatalog";
import {
  AGENT_ACTIVITY_STORAGE_UPDATED_EVENT,
  readAgentToolActivity,
  type AgentToolActivityRecord,
} from "../../agents/runtime/activity";
import { listBuiltinSkills } from "../../agents/runtime/skills";
import { useNodeFlowStore } from "../store/nodeFlowStore";
import { fetchArkModels, type ArkModel } from "../../services/arkResponsesService";
import { fetchTextModels } from "../../services/responsesTextService";
import { fetchQwenModels, type QwenModel } from "../../services/qwenResponsesService";
import * as SeedanceVideoService from "../../services/seedanceVideoService";
import { createStableId } from "../../utils/id";
import { CharacterSceneLibraryPanel } from "./CharacterSceneLibraryPanel";
import { InfoPanel } from "./InfoPanel";
import { MaterialsPanel, type MaterialsSectionKey } from "./MaterialsPanel";
import { SyncPanel } from "./SyncPanel";
import type { ModuleKey } from "./ModuleBar";
import type { AccountApiSession } from "../../sync/authenticatedFetch";
import { PRODUCT_REPOSITORIES } from "../../constants/productRepositories";
import {
  buildStyloAccountSessionId,
  buildStyloAccountStorageKeys,
} from "../../agents/runtime/projectScope";

type Props = {
  accountScope: string;
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  leftOffset?: number;
  projectData: ProjectData;
  setProjectData: React.Dispatch<React.SetStateAction<ProjectData>>;
  config: AppConfig;
  setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
  isSignedIn?: boolean;
  getAuthToken?: (options?: { skipCache?: boolean }) => Promise<string | null>;
  accountSession?: AccountApiSession;
  syncState?: SyncState;
  onResetProject?: () => void;
  onOpenLanding?: () => void;
  requestedPanel?: ProjectSettingsPanelKey;
  requestedAssetsSection?: MaterialsSectionKey;
  onOrganizeFoundationScaffold?: () => void;
  onSetFoundationNodeView?: (visible: boolean) => void;
  foundationNodeView?: boolean;
  onOpenVisualLab?: (key?: Extract<ModuleKey, "glassLab" | "agentLab" | "cineworLab" | "designSystemLab">) => void;
};

export type ProjectSettingsPanelKey =
  | "provider"
  | "ability"
  | "tools"
  | "skills"
  | "identity"
  | "history"
  | "assets"
  | "lab"
  | "sync"
  | "info";

type ProjectSettingsPrimaryPanelKey = Exclude<ProjectSettingsPanelKey, "tools" | "skills" | "identity">;
type AssetsUnitKey = MaterialsSectionKey | "identity";

type ConversationRecord = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Array<{ role?: string; text?: string }>;
};

type ConversationState = {
  activeId: string;
  items: ConversationRecord[];
};

type CloudSessionSummary = {
  sessionKey: string;
  sessionId: string;
  updatedAt: number;
  itemCount: number;
  messageCount: number;
  preview: string;
};

type SkillReadRecord = {
  id: string;
  title: string;
  version: string;
  createdAt: number;
};

type CloudTraceSummary = {
  traceId: string;
  sessionId: string;
  provider: string;
  model: string;
  workflowName: string;
  groupId?: string | null;
  updatedAt: number;
  spanCount: number;
  errorCount: number;
  metadata?: Record<string, string>;
  trace?: Record<string, unknown>;
};

type CloudSessionDetail = {
  sessionKey: string;
  sessionId: string;
  updatedAt: number;
  items: any[];
  messages: Array<any>;
  skillReads: SkillReadRecord[];
};

type CloudSpanRecord = {
  spanId: string;
  parentId?: string | null;
  spanType: string;
  spanName: string;
  startedAt?: string | null;
  endedAt?: string | null;
  error?: string | null;
  span?: Record<string, unknown>;
};

type CloudTraceDetail = CloudTraceSummary & {
  spans: CloudSpanRecord[];
  skillReads: SkillReadRecord[];
};

type AgentObservabilityPayload = {
  sessions: CloudSessionSummary[];
  traces: CloudTraceSummary[];
  selectedSession: CloudSessionDetail | null;
  selectedTrace: CloudTraceDetail | null;
};

type ToolKey = "project-data" | "workflow-builder" | "runtime-intelligence";

type ToolItem = {
  key: ToolKey;
  capability: string;
  title: string;
  description: string;
  tools: string[];
  surfaces: string[];
  boundary: string;
  artifact: string;
  note: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
};

type MultiProviderKey = "openrouter" | "qwen" | "nanobanana";

const TOOL_ITEMS: ToolItem[] = [
  {
    key: "project-data",
    capability: "read",
    title: "read",
    description: "Agent 通过统一的读接口查阅当前 Flow 文档节点、档案节点和同一画布上的节点关系。",
    tools: listStyloToolNames(["project_read"]),
    surfaces: ["script document", "archive document", "script map", "canvas node", "canvas link", "canvas map"],
    boundary: "只读，不允许直接修改项目状态。",
    artifact: "返回 Flow 文档 / 档案 / map 事实与当前画布结构，作为理解、编辑和操作的前置输入。",
    note: "负责统一读取 Flow Workspace 内的项目事实。",
    Icon: Eye,
  },
  {
    key: "runtime-intelligence",
    capability: "research",
    title: "research",
    description: "Agent 可以读取运行手册、搜索网页，并实时查看 Stylo GitHub 仓库的完整代码状态。",
    tools: listStyloToolNames(["runtime_read", "external_read"]).filter((name) => name !== "ping_tool"),
    surfaces: ["runtime manual", "web search", "github repository", "source tree", "source file"],
    boundary: "默认只读认知权限；不直接修改远程仓库代码。",
    artifact: "返回运行诊断规则、网页搜索结果、仓库默认分支状态、文件树、源码内容和搜索命中。",
    note: "负责让 Agent 在边缘问题上拥有项目级和外部事实级认知。",
    Icon: Globe,
  },
  {
    key: "workflow-builder",
    capability: "operate",
    title: "operate",
    description: "Agent 通过统一操作接口在 Flow Workspace 画布上创建节点、连接连线，并组织可执行的节点结构。",
    tools: listStyloToolNames(["project_write", "generation_approval"]),
    surfaces: ["script node", "archive node", "text node", "image node", "audio node", "video node", "node connection"],
    boundary: "创建前校验 ref 与资源定位；连线前校验节点存在与 handle 合法性。",
    artifact: "输出可继续编辑和执行的节点 scaffold，承接“查阅”和“编辑”的结果。",
    note: "负责操作表层节点图，把 Script 中的事实与档案继续落成可执行画布结构。",
    Icon: Code2,
  },
];

const OPENROUTER_BASE_URL = OPENROUTER_RESPONSES_BASE_URL;

const QwenIcon: React.FC<{ size?: number; className?: string }> = ({ size = 12, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="7.5" />
    <path d="M16.5 16.5l4 4" />
  </svg>
);

const normalizeModalities = (value: any): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).toLowerCase());
  if (typeof value === "string") return value.split(/[,/ ]+/).map((v) => v.trim().toLowerCase()).filter(Boolean);
  return [];
};

const getModalities = (model: QwenModel) => {
  const input =
    normalizeModalities(model.modalities) ||
    normalizeModalities(model.capabilities?.modalities) ||
    normalizeModalities((model as any).input_modalities) ||
    normalizeModalities((model as any).architecture?.input_modalities);
  const output =
    normalizeModalities((model as any).output_modalities) ||
    normalizeModalities((model as any).architecture?.output_modalities);
  return { input, output };
};

const getQwenCategory = (model: QwenModel) => {
  const id = model.id.toLowerCase();
  if (id.includes("video") || id.includes("t2v") || id.includes("i2v") || id.includes("v2v")) {
    return { key: "video", label: "Video", Icon: Video, tone: "text-cyan-300 bg-cyan-500/10 border-cyan-400/30" };
  }
  if (id.includes("image") || id.includes("z-image")) {
    return { key: "image", label: "Image", Icon: Eye, tone: "text-sky-300 bg-sky-500/10 border-sky-400/30" };
  }
  if (id.includes("vl")) {
    return { key: "vision", label: "Vision", Icon: Eye, tone: "text-sky-300 bg-sky-500/10 border-sky-400/30" };
  }
  if (id.includes("tts") || id.includes("audio") || id.includes("speech")) {
    return { key: "audio", label: "Audio", Icon: AudioLines, tone: "text-pink-300 bg-pink-500/10 border-pink-400/30" };
  }
  if (id.includes("coder") || id.includes("code")) {
    return { key: "code", label: "Code", Icon: Code2, tone: "text-amber-300 bg-amber-500/10 border-amber-400/30" };
  }
  if (id.includes("embed")) {
    return { key: "embedding", label: "Embedding", Icon: Layers, tone: "text-emerald-300 bg-emerald-500/10 border-emerald-400/30" };
  }
  if (id.includes("rerank")) {
    return { key: "rerank", label: "Rerank", Icon: Layers, tone: "text-indigo-300 bg-indigo-500/10 border-indigo-400/30" };
  }
  return { key: "chat", label: "Chat", Icon: Sparkles, tone: "text-violet-300 bg-violet-500/10 border-violet-400/30" };
};

const getQwenTags = (model: QwenModel) => {
  const tags: string[] = [];
  const { input, output } = getModalities(model);
  if (input.length) tags.push(`in:${input.join("/")}`);
  if (output.length) tags.push(`out:${output.join("/")}`);
  const contextLength = model.context_length || model.contextLength || model.max_context_length || model.maxTokens;
  if (typeof contextLength === "number") {
    tags.push(`ctx:${contextLength}`);
  }
  const tools = model.capabilities?.tools || (model as any).supports_tools || (model as any).tool_calls;
  if (tools) tags.push("tools");
  const reasoning = model.capabilities?.reasoning || (model as any).supports_reasoning || (model as any).reasoning;
  if (reasoning) tags.push("reasoning");
  return tags.slice(0, 4);
};

const formatEpochDate = (value?: number) => {
  if (!value) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
};

const formatTimestamp = (value?: number) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
};

const formatRelativeTime = (value?: number) => {
  if (!value) return "暂无";
  const diff = Date.now() - value;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  if (diff < 86_400_000) return `${Math.max(1, Math.floor(diff / 3_600_000))} 小时前`;
  return `${Math.max(1, Math.floor(diff / 86_400_000))} 天前`;
};

const formatIsoTimestamp = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const getLatestActivityTimestamp = (records: AgentToolActivityRecord[]) =>
  records.reduce((latest, record) => Math.max(latest, record.lastFailedAt || 0, record.lastCompletedAt || 0, record.lastCalledAt || 0), 0);

const getLastFailure = (records: AgentToolActivityRecord[]) =>
  records
    .filter((record) => record.lastFailedAt && record.lastError)
    .sort((a, b) => (b.lastFailedAt || 0) - (a.lastFailedAt || 0))[0];

const getLastArtifact = (records: AgentToolActivityRecord[]) =>
  records
    .filter((record) => record.lastCompletedAt && record.lastArtifact)
    .sort((a, b) => (b.lastCompletedAt || 0) - (a.lastCompletedAt || 0))[0];

const summarizeToolActivity = (toolItem: ToolItem, activityMap: Record<string, AgentToolActivityRecord>) => {
  const records = toolItem.tools
    .map((toolName) => activityMap[toolName])
    .filter(Boolean) as AgentToolActivityRecord[];
  return {
    records,
    totalCalls: records.reduce((sum, record) => sum + record.totalCalls, 0),
    totalSuccesses: records.reduce((sum, record) => sum + record.totalSuccesses, 0),
    totalFailures: records.reduce((sum, record) => sum + record.totalFailures, 0),
    latest: getLatestActivityTimestamp(records),
    lastFailure: getLastFailure(records),
    lastArtifact: getLastArtifact(records),
  };
};

const resolveAgentModelForProvider = (provider: AgentTextProvider, configured?: string) => {
  const model = (configured || "").trim();
  if (provider === "qwen") {
    if (!model || model.startsWith("doubao-") || model.startsWith("deepseek-")) return QWEN_DEFAULT_MODEL;
    return model;
  }
  if (provider === "ark") {
    if (!model || model.startsWith("qwen") || model.startsWith("doubao-lite-") || model.startsWith("doubao-pro-")) {
      return ARK_DEFAULT_MODEL;
    }
    return model;
  }
  if (provider === "deepseek") return DEEPSEEK_DEFAULT_MODEL;
  return model;
};

const resolveConfiguredAgentModel = (textConfig: {
  agentProvider?: AgentTextProvider;
  provider?: string;
  agentModel?: string;
  model?: string;
}) => {
  const provider = textConfig.agentProvider || "deepseek";
  const explicitAgentModel = (textConfig.agentModel || "").trim();
  if (explicitAgentModel) {
    return resolveAgentModelForProvider(provider, explicitAgentModel);
  }
  const canFallbackToSharedModel = textConfig.agentProvider === textConfig.provider;
  const sharedModel = canFallbackToSharedModel ? (textConfig.model || "").trim() : "";
  return resolveAgentModelForProvider(provider, sharedModel);
};

const resolveMultiProviderKey = (provider?: string): MultiProviderKey => {
  if (provider === "wan") return "qwen";
  if (provider === "nanobanana" || provider === "wuyinkeji") return "nanobanana";
  return "openrouter";
};

const summarizeRuntimeToolOutput = (value: unknown) => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 220 ? `${serialized.slice(0, 220)}...` : serialized;
  } catch {
    return "tool output";
  }
};

const buildConversationTitle = (messages: Array<{ role?: string; text?: string }>) => {
  const firstUser = messages.find((m) => m.role === "user" && m.text && m.text.trim());
  if (!firstUser?.text) return "新对话";
  const text = firstUser.text.trim();
  return text.length > 20 ? `${text.slice(0, 20)}...` : text;
};

const clampProjectSettingsWidth = (width: number, leftOffset: number) => {
  if (typeof window === "undefined") return width;
  const availableWidth = Math.max(360, window.innerWidth - leftOffset - 6);
  const minWidth = Math.min(520, availableWidth);
  return Math.min(availableWidth, Math.max(minWidth, width));
};

const getDefaultProjectSettingsWidth = (leftOffset: number) => {
  if (typeof window === "undefined") return 720;
  const availableWidth = Math.max(360, window.innerWidth - leftOffset - 6);
  return clampProjectSettingsWidth(Math.round(availableWidth / 2), leftOffset);
};

export const ProjectSettingsPanel: React.FC<Props> = ({
  accountScope,
  projectId,
  isOpen,
  onClose,
  leftOffset = 0,
  config,
  setConfig,
  isSignedIn = false,
  getAuthToken,
  accountSession,
  syncState,
  onResetProject,
  onOpenLanding,
  projectData,
  setProjectData,
  requestedPanel = "provider",
  requestedAssetsSection,
  onOrganizeFoundationScaffold,
  onSetFoundationNodeView,
  foundationNodeView = false,
  onOpenVisualLab,
}) => {
  const { conversationStorageKey, activityStorageKey } = buildStyloAccountStorageKeys(
    accountScope,
    projectId
  );
  const { applyViduReferenceDemo, revision, globalAssetHistory } = useNodeFlowStore();
  const [activeMultiProvider, setActiveMultiProvider] = useState<MultiProviderKey>(resolveMultiProviderKey(config.multimodalConfig.provider));
  const [activeVideoProvider, setActiveVideoProvider] = useState<"qwen" | "vidu" | "seedance">("qwen");
  const [selectedPanel, setSelectedPanel] = useState<ProjectSettingsPrimaryPanelKey>("provider");
  const [assetsSection, setAssetsSection] = useState<MaterialsSectionKey>("images");
  const [assetsUnit, setAssetsUnit] = useState<AssetsUnitKey>("images");
  const [panelWidth, setPanelWidth] = useState(() => getDefaultProjectSettingsWidth(leftOffset));
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const panelResizeRef = useRef<{ startX: number; startWidth: number; pointerId: number } | null>(null);
  const [historyFilter, setHistoryFilter] = useState<"all" | "user" | "assistant" | "tool">("all");
  const [isLoadingTextModels, setIsLoadingTextModels] = useState(false);
  const [textModelFetchMessage, setTextModelFetchMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [availableTextModels, setAvailableTextModels] = useState<string[]>([]);

  const [isLoadingQwenChatModels, setIsLoadingQwenChatModels] = useState(false);
  const [qwenChatFetchMessage, setQwenChatFetchMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [qwenChatModels, setQwenChatModels] = useState<QwenModel[]>([]);
  const [qwenModelsRaw, setQwenModelsRaw] = useState<string>("");
  const [showQwenRaw, setShowQwenRaw] = useState(false);
  const [isLoadingArkChatModels, setIsLoadingArkChatModels] = useState(false);
  const [arkChatFetchMessage, setArkChatFetchMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [arkChatModels, setArkChatModels] = useState<ArkModel[]>([]);
  const [arkModelsRaw, setArkModelsRaw] = useState<string>("");
  const [showArkRaw, setShowArkRaw] = useState(false);
  const [isCheckingSeedanceKey, setIsCheckingSeedanceKey] = useState(false);
  const [seedanceProbeResult, setSeedanceProbeResult] = useState<SeedanceKeyProbeResult | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [runtimeMetaVersion, setRuntimeMetaVersion] = useState(0);
  const [observabilityData, setObservabilityData] = useState<AgentObservabilityPayload | null>(null);
  const [observabilityLoading, setObservabilityLoading] = useState(false);
  const [observabilityError, setObservabilityError] = useState<string | null>(null);
  const observabilityRequestSeqRef = useRef(0);
  const observabilityInFlightRef = useRef(false);
  const observabilityTokenGetterRef = useRef(getAuthToken);
  const [selectedTraceId, setSelectedTraceId] = useState<string>("");
  const [traceProviderFilter, setTraceProviderFilter] = useState<string>("all");
  const [traceStatusFilter, setTraceStatusFilter] = useState<"all" | "failed">("all");
  const [traceSpanFilter, setTraceSpanFilter] = useState<"all" | "error">("all");
  const [traceSearch, setTraceSearch] = useState("");

  useEffect(() => {
    observabilityTokenGetterRef.current = getAuthToken;
  }, [getAuthToken]);
  const [conversationState, setConversationState] = usePersistedState<ConversationState>({
    key: conversationStorageKey,
    initialValue: { activeId: "", items: [] },
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
      } catch {}
      return { activeId: "", items: [] };
    },
  });
  const styloToolSettings = useMemo(() => {
    return normalizeStyloToolSettings({
      ...DEFAULT_STYLO_TOOL_SETTINGS,
      ...config.textConfig.styloTools,
      projectData: {
        ...DEFAULT_STYLO_TOOL_SETTINGS.projectData,
        ...config.textConfig.styloTools?.projectData,
      },
      workflowBuilder: {
        ...DEFAULT_STYLO_TOOL_SETTINGS.workflowBuilder,
        ...config.textConfig.styloTools?.workflowBuilder,
      },
      runtimeIntelligence: {
        ...DEFAULT_STYLO_TOOL_SETTINGS.runtimeIntelligence,
        ...config.textConfig.styloTools?.runtimeIntelligence,
      },
    });
  }, [config.textConfig.styloTools]);
  const availableAgentSkills = useMemo(() => listBuiltinSkills(), []);
  const activeAgentProvider: AgentTextProvider = config.textConfig.agentProvider || "deepseek";
  const activeAgentBaseUrl =
    config.textConfig.agentBaseUrl ||
    (activeAgentProvider === config.textConfig.provider ? config.textConfig.baseUrl : "") ||
    (activeAgentProvider === "ark"
      ? ARK_RESPONSES_BASE_URL
      : activeAgentProvider === "deepseek"
        ? DEEPSEEK_RESPONSES_BASE_URL
        : activeAgentProvider === "openrouter"
          ? OPENROUTER_BASE_URL
        : QWEN_RESPONSES_BASE_URL);
  const activeAgentModel = resolveAgentModelForProvider(
    activeAgentProvider,
    resolveConfiguredAgentModel(config.textConfig)
  );
  const activeConversation = useMemo(
    () => conversationState.items.find((item) => item.id === conversationState.activeId) || null,
    [conversationState.activeId, conversationState.items]
  );
  const selectedCloudSession = observabilityData?.selectedSession || null;
  const selectedCloudTrace = observabilityData?.selectedTrace || null;
  const cloudSessions = observabilityData?.sessions || [];
  const cloudTraces = observabilityData?.traces || [];
  const traceProviderOptions = useMemo(
    () => ["all", ...Array.from(new Set(cloudTraces.map((item) => item.provider).filter(Boolean)))],
    [cloudTraces]
  );
  const filteredTraceSummaries = useMemo(() => {
    const keyword = traceSearch.trim().toLowerCase();
    return cloudTraces.filter((trace) => {
      if (traceProviderFilter !== "all" && trace.provider !== traceProviderFilter) return false;
      if (traceStatusFilter === "failed" && trace.errorCount <= 0) return false;
      if (!keyword) return true;
      return [trace.traceId, trace.model, trace.workflowName, trace.sessionId]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    });
  }, [cloudTraces, traceProviderFilter, traceSearch, traceStatusFilter]);
  const visibleSelectedTraceSpans = useMemo(() => {
    const spans = selectedCloudTrace?.spans || [];
    if (traceSpanFilter === "error") return spans.filter((span) => span.error);
    return spans;
  }, [selectedCloudTrace?.spans, traceSpanFilter]);
  const toolActivityMap = useMemo(
    () => readAgentToolActivity(activityStorageKey),
    [activityStorageKey, runtimeMetaVersion]
  );
  const imageAssetCount = useMemo(
    () => globalAssetHistory.filter((item) => item.type === "image").length,
    [globalAssetHistory]
  );
  const videoAssetCount = useMemo(
    () => globalAssetHistory.filter((item) => item.type === "video").length,
    [globalAssetHistory]
  );
  const promptAssetCount = useMemo(
    () => globalAssetHistory.filter((item) => item.prompt.trim().length > 0).length,
    [globalAssetHistory]
  );
  const filteredConversationMessages = useMemo(() => {
    const messages = activeConversation?.messages || [];
    if (historyFilter === "all") return messages;
    return messages.filter((message) => message.role === historyFilter);
  }, [activeConversation?.messages, historyFilter]);
  const filteredCloudSessionMessages = useMemo(() => {
    const messages = selectedCloudSession?.messages || [];
    if (historyFilter === "all") return messages;
    return messages.filter((message) => message.role === historyFilter);
  }, [historyFilter, selectedCloudSession?.messages]);
  useEffect(() => {
    const onUpdated = () => setRuntimeMetaVersion((value) => value + 1);
    if (typeof window === "undefined") return;
    window.addEventListener(AGENT_ACTIVITY_STORAGE_UPDATED_EVENT, onUpdated);
    return () => {
      window.removeEventListener(AGENT_ACTIVITY_STORAGE_UPDATED_EVENT, onUpdated);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const syncPanelWidth = () => {
      setPanelWidth((current) => clampProjectSettingsWidth(current, leftOffset));
    };
    syncPanelWidth();
    window.addEventListener("resize", syncPanelWidth);
    return () => {
      window.removeEventListener("resize", syncPanelWidth);
    };
  }, [leftOffset]);

  useEffect(() => {
    const activeResize = panelResizeRef.current;
    if (!isResizingPanel || !activeResize || typeof window === "undefined") return undefined;

    const stopResizing = (event?: PointerEvent) => {
      if (event && event.pointerId !== activeResize.pointerId) return;
      panelResizeRef.current = null;
      setIsResizingPanel(false);
      document.body.classList.remove("stylo-resizing");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== activeResize.pointerId) return;
      const nextWidth = activeResize.startWidth + (activeResize.startX - event.clientX);
      setPanelWidth(clampProjectSettingsWidth(nextWidth, leftOffset));
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
    document.body.classList.add("stylo-resizing");

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
      document.body.classList.remove("stylo-resizing");
    };
  }, [isResizingPanel, leftOffset]);

  useEffect(
    () => () => {
      panelResizeRef.current = null;
      document.body.classList.remove("stylo-resizing");
    },
    []
  );

  const loadObservability = useCallback(async (traceIdOverride?: string) => {
    const tokenGetter = observabilityTokenGetterRef.current;
    if (!isSignedIn || !activeConversation?.id || !tokenGetter) {
      setObservabilityData(null);
      setObservabilityError(null);
      return;
    }
    if (observabilityInFlightRef.current) return;
    observabilityInFlightRef.current = true;
    const requestSeq = observabilityRequestSeqRef.current + 1;
    observabilityRequestSeqRef.current = requestSeq;
    setObservabilityLoading(true);
    setObservabilityError(null);
    try {
      const token = await tokenGetter();
      if (!token) throw new Error("缺少登录态，无法读取云端 Agent 观测数据。");
      const params = new URLSearchParams({
        projectId,
        sessionId: buildStyloAccountSessionId(accountScope, projectId, activeConversation.id),
      });
      const traceId = (traceIdOverride || selectedTraceId || "").trim();
      if (traceId) params.set("traceId", traceId);
      const executeRequest = (authToken: string) => fetch(
        buildApiUrl(`/api/agent-observability?${params.toString()}`),
        { headers: { authorization: `Bearer ${authToken}` } }
      );
      let response = await executeRequest(token);
      if (response.status === 401 || response.status === 403) {
        const refreshedToken = await tokenGetter({ skipCache: true });
        if (refreshedToken) response = await executeRequest(refreshedToken);
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String((payload as any)?.error || `HTTP ${response.status}`));
      }
      if (requestSeq !== observabilityRequestSeqRef.current) return;
      setObservabilityData(payload as AgentObservabilityPayload);
    } catch (error: any) {
      if (requestSeq !== observabilityRequestSeqRef.current) return;
      setObservabilityError(error?.message || "无法加载 Agent 观测数据。");
    } finally {
      observabilityInFlightRef.current = false;
      if (requestSeq === observabilityRequestSeqRef.current) {
        setObservabilityLoading(false);
      }
    }
  }, [accountScope, activeConversation?.id, isSignedIn, projectId, selectedTraceId]);

  useEffect(() => {
    if (!isOpen || selectedPanel !== "history") return;
    void loadObservability();
  }, [isOpen, loadObservability, selectedPanel]);

  useEffect(() => {
    setSelectedTraceId("");
    setTraceProviderFilter("all");
    setTraceStatusFilter("all");
    setTraceSpanFilter("all");
    setTraceSearch("");
  }, [activeConversation?.id]);

  const updateProjectToolSettings = (patch: Partial<typeof styloToolSettings.projectData>) => {
    setConfig((prev) => {
      const existing = prev.textConfig.styloTools?.projectData || {};
      const next = { ...existing, ...patch };
      return {
        ...prev,
        textConfig: {
          ...prev.textConfig,
          styloTools: {
            ...(prev.textConfig.styloTools || {}),
            projectData: next,
          },
        },
      };
    });
  };

  const updateWorkflowToolSettings = (patch: Partial<typeof styloToolSettings.workflowBuilder>) => {
    setConfig((prev) => {
      const existing = prev.textConfig.styloTools?.workflowBuilder || {};
      const next = { ...existing, ...patch };
      return {
        ...prev,
        textConfig: {
          ...prev.textConfig,
          styloTools: {
            ...(prev.textConfig.styloTools || {}),
            workflowBuilder: next,
          },
        },
      };
    });
  };

  const updateRuntimeToolSettings = (patch: Partial<typeof styloToolSettings.runtimeIntelligence>) => {
    setConfig((prev) => {
      const existing = prev.textConfig.styloTools?.runtimeIntelligence || {};
      return {
        ...prev,
        textConfig: {
          ...prev.textConfig,
          styloTools: {
            ...(prev.textConfig.styloTools || {}),
            runtimeIntelligence: {
              ...existing,
              ...patch,
            },
          },
        },
      };
    });
  };

  const qwenGroups = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; Icon: React.ComponentType<{ size?: number }>; tone: string; items: QwenModel[] }>();
    qwenChatModels.forEach((model) => {
      const category = getQwenCategory(model);
      if (!groups.has(category.key)) {
        groups.set(category.key, { ...category, items: [] });
      }
      groups.get(category.key)!.items.push(model);
    });
    const order = ["chat", "code", "image", "video", "vision", "audio", "embedding", "rerank"];
    return Array.from(groups.values()).sort((a, b) => {
      const ai = order.indexOf(a.key);
      const bi = order.indexOf(b.key);
      if (ai === -1 && bi === -1) return a.label.localeCompare(b.label);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [qwenChatModels]);

  useEffect(() => {
    if (!qwenChatModels.length && config.textConfig.qwenModels?.length) {
      setQwenChatModels(config.textConfig.qwenModels as QwenModel[]);
    }
  }, [config.textConfig.qwenModels, qwenChatModels.length]);

  useEffect(() => {
    if (!conversationState.items.length) return;
    if (!conversationState.activeId || !conversationState.items.find((item) => item.id === conversationState.activeId)) {
      setConversationState((prev) => ({ ...prev, activeId: prev.items[0]?.id || "" }));
    }
  }, [conversationState.activeId, conversationState.items, setConversationState]);

  useEffect(() => {
    if (!config.textConfig.agentProvider) {
      setConfig((prev) => ({
        ...prev,
        textConfig: {
          ...prev.textConfig,
          agentProvider: "deepseek",
          agentBaseUrl: prev.textConfig.agentBaseUrl || DEEPSEEK_RESPONSES_BASE_URL,
          agentModel: resolveAgentModelForProvider("deepseek", prev.textConfig.agentModel),
        },
      }));
    }
  }, [config.textConfig.agentBaseUrl, config.textConfig.agentModel, config.textConfig.agentProvider, setConfig]);

  useEffect(() => {
    setActiveMultiProvider(resolveMultiProviderKey(config.multimodalConfig.provider));
  }, [config.multimodalConfig.provider]);

  useEffect(() => {
    if (!isOpen) return;
    if (requestedPanel === "tools" || requestedPanel === "skills") {
      setSelectedPanel("ability");
      return;
    }
    if (requestedPanel === "identity") {
      setSelectedPanel("assets");
      setAssetsUnit("identity");
      return;
    }
    setSelectedPanel(requestedPanel);
  }, [isOpen, requestedPanel]);

  useEffect(() => {
    if (!isOpen || requestedPanel !== "assets" || !requestedAssetsSection) return;
    setAssetsSection(requestedAssetsSection);
    setAssetsUnit(requestedAssetsSection);
  }, [isOpen, requestedAssetsSection, requestedPanel]);

  const setProvider = (p: AgentTextProvider) => {
    setConfig((prev) => {
      const currentProvider = prev.textConfig.agentProvider || "deepseek";
      const providerChanged = currentProvider !== p;
      const nextConfig = { ...prev.textConfig };
      if (p === "openrouter") {
        nextConfig.agentBaseUrl = OPENROUTER_BASE_URL;
        nextConfig.agentModel = providerChanged ? "" : resolveAgentModelForProvider(p, nextConfig.agentModel);
      } else if (p === "ark") {
        nextConfig.agentBaseUrl = ARK_RESPONSES_BASE_URL;
        nextConfig.agentModel = providerChanged ? ARK_DEFAULT_MODEL : resolveAgentModelForProvider(p, nextConfig.agentModel);
      } else if (p === "deepseek") {
        nextConfig.agentBaseUrl = DEEPSEEK_RESPONSES_BASE_URL;
        nextConfig.agentModel = DEEPSEEK_DEFAULT_MODEL;
      } else {
        nextConfig.agentBaseUrl = QWEN_RESPONSES_BASE_URL;
        nextConfig.agentModel = providerChanged ? QWEN_DEFAULT_MODEL : resolveAgentModelForProvider(p, nextConfig.agentModel);
      }

      return {
        ...prev,
        textConfig: {
          ...nextConfig,
          agentProvider: p,
        },
      };
    });
  };

  const setMultiProvider = (provider: MultiProviderKey) => {
    setActiveMultiProvider(provider);
    setConfig((prev) => {
      const nextMulti = { ...prev.multimodalConfig };
      if (provider === "qwen") {
        nextMulti.provider = "wan";
        nextMulti.baseUrl = QWEN_WAN_IMAGE_ENDPOINT;
        nextMulti.model = QWEN_WAN_IMAGE_MODEL;
      } else if (provider === "nanobanana") {
        nextMulti.provider = "nanobanana";
        nextMulti.baseUrl = resolveMultiProviderKey(prev.multimodalConfig.provider) === "nanobanana"
          ? (prev.multimodalConfig.baseUrl || NANOBANANA_PRO_ENDPOINT)
          : NANOBANANA_PRO_ENDPOINT;
        nextMulti.model = NANOBANANA_PRO_MODEL;
        nextMulti.apiKey = "";
      } else {
        nextMulti.provider = "standard";
        nextMulti.baseUrl = OPENROUTER_BASE_URL;
        nextMulti.model = "openrouter-managed";
      }
      return {
        ...prev,
        multimodalConfig: nextMulti,
      };
    });
  };

  const handleNewConversation = () => {
    const id = createStableId("chat");
    const now = Date.now();
    const next: ConversationRecord = {
      id,
      title: "新对话",
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    setConversationState((prev) => ({
      activeId: id,
      items: [next, ...prev.items],
    }));
    setSelectedPanel("history");
  };

  const handleSelectConversation = (id: string) => {
    setConversationState((prev) => ({ ...prev, activeId: id }));
  };

  const handleClearConversation = (id: string) => {
    setConversationState((prev) => {
      const remaining = prev.items.filter((item) => item.id !== id);
      const nextActive =
        prev.activeId === id ? (remaining[0]?.id || "") : prev.activeId;
      if (!remaining.length) {
        const created = {
          id: createStableId("chat"),
          title: "新对话",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
        };
        return { activeId: created.id, items: [created] };
      }
      return { ...prev, activeId: nextActive, items: remaining };
    });
  };

  const handlePanelResizePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    panelResizeRef.current = {
      startX: event.clientX,
      startWidth: panelWidth,
      pointerId: event.pointerId,
    };
    setIsResizingPanel(true);
    document.body.classList.add("stylo-resizing");
  };

  const handleFetchTextModels = async () => {
    const apiKey = config.textConfig.apiKey;
    const baseUrl = activeAgentBaseUrl || OPENROUTER_BASE_URL;
    if (!apiKey) {
      setTextModelFetchMessage({ type: "error", text: "请先在项目设置中填写 OpenRouter API Key。" });
      return;
    }
    setIsLoadingTextModels(true);
    setTextModelFetchMessage(null);
    try {
      const models = await fetchTextModels(baseUrl, apiKey);
      if (models.length > 0) {
        setAvailableTextModels(models);
        setTextModelFetchMessage({ type: "success", text: `获取成功，${models.length} 个模型` });
      } else {
        setTextModelFetchMessage({ type: "success", text: "连接成功，但未返回模型列表" });
      }
    } catch (e: any) {
      setTextModelFetchMessage({ type: "error", text: e.message || "拉取失败" });
    } finally {
      setIsLoadingTextModels(false);
    }
  };

  const handleFetchQwenModels = async () => {
    setIsLoadingQwenChatModels(true);
    setQwenChatFetchMessage(null);
    try {
      const { models, raw } = await fetchQwenModels({
        apiKey: config.textConfig.apiKey || undefined,
        baseUrl: activeAgentBaseUrl || QWEN_RESPONSES_BASE_URL,
      });
      setQwenChatModels(models);
      setQwenModelsRaw(JSON.stringify(raw, null, 2));
      setQwenChatFetchMessage({
        type: "success",
        text: models.length ? `获取成功，${models.length} 个模型` : "获取成功，但返回为空",
      });
      setConfig((prev) => {
        const nextText = {
          ...prev.textConfig,
          qwenModels: models,
        };
        if (models.length) {
          const audioIds = models
            .map((m) => m.id)
            .filter(Boolean)
            .filter((id) => {
              const lower = id.toLowerCase();
              return lower.includes("tts") || lower.includes("audio") || lower.includes("speech");
            });
          const designDefault = audioIds.find((id) => id.toLowerCase().includes("tts-vd")) || audioIds[0];
          const dubbingDefault = audioIds.find((id) => id.toLowerCase().includes("tts-vc")) || audioIds[0];
          if (!nextText.agentModel || !models.find((m) => m.id === nextText.agentModel)) {
            nextText.agentModel = models.find((m) => m.id === QWEN_DEFAULT_MODEL)?.id || QWEN_DEFAULT_MODEL;
          }
          if (designDefault && (!nextText.voiceDesignModel || !audioIds.includes(nextText.voiceDesignModel))) {
            nextText.voiceDesignModel = designDefault;
          }
          if (dubbingDefault && (!nextText.voiceDubbingModel || !audioIds.includes(nextText.voiceDubbingModel))) {
            nextText.voiceDubbingModel = dubbingDefault;
          }
        }
        return { ...prev, textConfig: nextText };
      });
    } catch (e: any) {
      setQwenChatFetchMessage({ type: "error", text: e.message || "拉取失败" });
      setQwenModelsRaw("");
    } finally {
      setIsLoadingQwenChatModels(false);
    }
  };

  const handleFetchArkModels = async () => {
    setIsLoadingArkChatModels(true);
    setArkChatFetchMessage(null);
    try {
      const { models, raw } = await fetchArkModels(activeAgentBaseUrl || ARK_RESPONSES_BASE_URL);
      setArkChatModels(models);
      setArkModelsRaw(JSON.stringify(raw, null, 2));
      setArkChatFetchMessage({
        type: "success",
        text: models.length ? `获取成功，${models.length} 个模型` : "获取成功，但返回为空",
      });
    } catch (e: any) {
      setArkChatFetchMessage({ type: "error", text: e.message || "拉取失败" });
      setArkModelsRaw("");
    } finally {
      setIsLoadingArkChatModels(false);
    }
  };

  const handleProbeSeedanceKey = async () => {
    setIsCheckingSeedanceKey(true);
    setSeedanceProbeResult(null);
    try {
      const configuredModel =
        config.videoConfig.model === SEEDANCE_DEFAULT_MODEL || config.videoConfig.model === SEEDANCE_FAST_MODEL
          ? config.videoConfig.model
          : SEEDANCE_DEFAULT_MODEL;
      const result = await SeedanceVideoService.probeSeedanceApiKey(
        {
          ...config.videoConfig,
          baseUrl: SEEDANCE_DEFAULT_BASE_URL,
          model: configuredModel,
        },
        configuredModel
      );
      setSeedanceProbeResult(result);
    } catch (e: any) {
      setSeedanceProbeResult({
        status: "unknown",
        message: e?.message || "Seedance API Key 检测失败。",
        keySource: "missing",
        baseUrl: SEEDANCE_DEFAULT_BASE_URL,
        configuredModel: SEEDANCE_DEFAULT_MODEL,
        models: [],
        modelAvailable: undefined,
        capabilities: ["video-generation", "multimodal-reference-video", "asset-uri-reference"],
      });
    } finally {
      setIsCheckingSeedanceKey(false);
    }
  };

  const renderCompatibleModelCard = (model: QwenModel | ArkModel, isActive: boolean, onSelect: () => void) => {
    const category = getQwenCategory(model);
    const tags = getQwenTags(model);
    const description = model.description || (model as any).summary || (model as any).display_name || "";
    const owner = model.owned_by || (model as any).provider || (model as any).vendor;
    const createdAt = formatEpochDate((model as any).created);
    return (
      <button
        key={model.id}
        type="button"
        onClick={onSelect}
        className={`text-left rounded-2xl border bg-[var(--app-panel-muted)] p-3 space-y-2 transition ${
          isActive ? "border-amber-300/60 shadow-[0_0_0_1px_rgba(251,191,36,0.35)]" : "border-[var(--app-border)] hover:border-[var(--app-border-strong)]"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-[var(--app-text-primary)]">{model.id}</div>
          <span className={`text-[10px] px-2 py-1 rounded-full border ${category.tone} flex items-center gap-1`}>
            <category.Icon size={10} />
            {category.label}
          </span>
        </div>
        {description && (
          <div className="text-[11px] text-[var(--app-text-secondary)] line-clamp-2">{description}</div>
        )}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={`${model.id}-${tag}`}
                className="px-2 py-0.5 rounded-full border border-[var(--app-border)] text-[10px] text-[var(--app-text-secondary)]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        {(owner || createdAt) && (
          <div className="text-[10px] text-[var(--app-text-muted)] flex flex-wrap gap-2">
            {owner && <span>owner: {owner}</span>}
            {createdAt && <span>created: {createdAt}</span>}
          </div>
        )}
      </button>
    );
  };

  if (!isOpen) return null;

  const panelMeta =
    selectedPanel === "provider"
      ? {
          label: "Provider",
          title: "Providers",
          description: "统一管理项目级模型路线、Agent runtime 基线和多模态服务配置。",
        }
      : selectedPanel === "ability"
        ? {
            label: "Ability",
            title: "Ability",
            description: "Agent 能力统一放在 Ability 下，Tools 是真实 runtime 操作面，Skills 是按需读取的方法层。",
          }
        : selectedPanel === "assets"
              ? {
                  label: "Assets",
                  title:
                    assetsUnit === "identity"
                      ? "Identity Assets"
                      : assetsSection === "images"
                        ? "Images"
                        : assetsSection === "videos"
                          ? "Videos"
                          : "Prompts",
                  description: "素材、提示词与身份系统统一归入 Assets；身份系统作为身份资产继续保留查看与编辑入口。",
                }
              : selectedPanel === "lab"
                ? {
                    label: "Lab",
                    title: "Labs",
                    description: "实验入口从 Identity 中独立出来，避免与身份资产继续混在一起。",
                  }
              : selectedPanel === "sync"
                ? {
                    label: "Sync",
                    title: "Sync",
                    description: "同步诊断与云端快照直接并入设置侧栏。",
                  }
              : selectedPanel === "info"
                  ? {
                      label: "信息",
                      title: "产品信息",
                      description: "查看 Stylo 的产品定位、工作面结构与后续路线。",
                    }
                  : {
                      label: "History",
                      title: "Conversation & Trace",
                      description: "",
                    };
  const primaryTabs: Array<{ key: ProjectSettingsPrimaryPanelKey; label: string; Icon: React.ComponentType<{ size?: number; className?: string }>; meta?: string }> = [
    { key: "provider", label: "Provider", Icon: Sparkles, meta: "3" },
    { key: "ability", label: "Ability", Icon: Code2, meta: `${TOOL_ITEMS.length + availableAgentSkills.length}` },
    { key: "assets", label: "Assets", Icon: Boxes, meta: `${imageAssetCount + videoAssetCount + promptAssetCount + (projectData.roles?.length || 0)}` },
    { key: "lab", label: "Lab", Icon: ScanSearch, meta: "5" },
    { key: "history", label: "History", Icon: Cloud, meta: `${conversationState.items.length}` },
    { key: "sync", label: "Sync", Icon: Cloud, meta: syncState?.project.status || "local" },
    { key: "info", label: "信息", Icon: FileText },
  ];

  const subTabClass = (active: boolean) =>
    `inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] transition ${
      active
        ? "border-[var(--app-border-strong)] bg-[var(--app-panel-soft)] text-[var(--app-text-primary)]"
        : "border-[var(--app-border)] bg-transparent text-[var(--app-text-secondary)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
    }`;

  const renderSecondaryTabs = () => {
    if (selectedPanel === "assets") {
      return (
        <>
          {[
            { key: "images" as const, label: "Images", count: imageAssetCount },
            { key: "videos" as const, label: "Videos", count: videoAssetCount },
            { key: "prompts" as const, label: "Prompts", count: promptAssetCount },
            { key: "identity" as const, label: "Identity", count: projectData.roles?.length || 0 },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setAssetsUnit(item.key);
                if (item.key !== "identity") setAssetsSection(item.key);
              }}
              className={subTabClass(assetsUnit === item.key)}
            >
              {item.key === "identity" ? <Layers size={12} /> : <Boxes size={12} />}
              {item.label}
              <span className="text-[10px] text-[var(--app-text-muted)]">{item.count}</span>
            </button>
          ))}
        </>
      );
    }
    if (selectedPanel === "history") {
      return (
        <>
          <button type="button" onClick={handleNewConversation} className={subTabClass(false)}>
            新对话
          </button>
          {conversationState.items
            .slice()
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 12)
            .map((item) => {
              const active = item.id === conversationState.activeId;
              const title = item.title || buildConversationTitle(item.messages || []) || "新对话";
              return (
                <span key={item.id} className={`${subTabClass(active)} max-w-[220px] pr-1`} title={title}>
                  <button
                    type="button"
                    onClick={() => handleSelectConversation(item.id)}
                    className="min-w-0 truncate text-left"
                  >
                    <span className="block max-w-[150px] truncate">{title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleClearConversation(item.id);
                    }}
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[var(--app-text-muted)] transition hover:bg-rose-500/10 hover:text-rose-300"
                    title="删除该对话"
                    aria-label={`删除对话 ${title}`}
                  >
                    <Trash2 size={11} />
                  </button>
                </span>
              );
            })}
        </>
      );
    }
    return null;
  };
  const secondaryTabs = renderSecondaryTabs();

  return (
    <div
      className="fixed right-[3px] top-[3px] bottom-[3px] z-[80] min-w-0 overflow-hidden rounded-[18px] border border-[var(--app-border)] bg-[var(--app-panel-strong)] text-[var(--app-text-primary)] shadow-[0_30px_80px_rgba(0,0,0,0.24)]"
      style={{
        width: panelWidth,
        maxWidth: "calc(100vw - 6px)",
      }}
    >
      <button
        type="button"
        aria-label="Resize settings panel"
        onPointerDown={handlePanelResizePointerDown}
        className="absolute left-0 top-0 z-20 h-full w-3 cursor-col-resize bg-transparent touch-none"
      />
      <div className="flex h-full min-w-0 flex-col">
        <header className="shrink-0 border-b border-[var(--app-border)] bg-[var(--app-panel-strong)] px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-3">
                <div className="truncate text-[22px] font-semibold tracking-[-0.03em] text-[var(--app-text-primary)]">
                  Setting
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-panel-soft)] text-[var(--app-text-secondary)] transition hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
              title="Close"
              aria-label="Close settings"
            >
              <X size={14} />
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 pb-1">
            {primaryTabs.map(({ key, label, Icon, meta }) => {
              const active = selectedPanel === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedPanel(key)}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-2xl border px-3 py-2 text-[12px] transition ${
                    active
                      ? "border-[var(--app-border-strong)] bg-[var(--app-panel-soft)] text-[var(--app-text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                      : "border-[var(--app-border)] bg-[var(--app-panel-muted)] text-[var(--app-text-secondary)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
                  }`}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                  {meta ? <span className="rounded-full border border-[var(--app-border)] px-1.5 py-0.5 text-[10px] text-[var(--app-text-muted)]">{meta}</span> : null}
                </button>
              );
            })}
          </div>
        </header>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {secondaryTabs ? (
            <div className="shrink-0 border-b border-[var(--app-border)] bg-[var(--app-panel-muted)] px-6 py-3">
              <div className="scrollbar-none flex gap-2 overflow-x-auto pb-0.5">
                {secondaryTabs}
              </div>
            </div>
          ) : null}

          <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="space-y-4">
              <div className="border-b border-[var(--app-border)] pb-4">
                <div className="flex items-center gap-2 text-[20px] font-semibold tracking-[-0.03em] text-[var(--app-text-primary)]">
                  {panelMeta.title}
                </div>
                {panelMeta.description ? (
                  <div className="mt-2 max-w-2xl text-[12px] leading-6 text-[var(--app-text-secondary)]">
                    {panelMeta.description}
                  </div>
                ) : null}
              </div>

              <div className="space-y-4">
              {selectedPanel === "provider" && (
                <div className="flex flex-col gap-3">
                    <div className="order-[10] rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 space-y-3">
                      <div className="text-[11px] uppercase tracking-widest app-text-muted">Chat Providers</div>
                      <div className="text-[11px] text-[var(--app-text-muted)]">
                        项目设置统一承载模型、Agent runtime 与多模态服务。当前支持 `Qwen`、`Seed / Ark` 与 `OpenRouter` 三条常规 API 路线。
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { key: "qwen" as AgentTextProvider, label: "Qwen", Icon: QwenIcon },
                          { key: "ark" as AgentTextProvider, label: "Seed / Ark", Icon: Sparkles },
                          { key: "deepseek" as AgentTextProvider, label: "DeepSeek", Icon: Code2 },
                          { key: "openrouter" as AgentTextProvider, label: "OpenRouter", Icon: Globe },
                        ].map(({ key, label, Icon }) => {
                          const active = activeAgentProvider === key;
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setProvider(key)}
                              className={`flex items-center gap-2 px-3 py-2 rounded-full text-[11px] border transition ${
                                active
                                  ? "bg-[var(--app-panel-soft)] border-[var(--app-border-strong)] text-[var(--app-text-primary)]"
                                  : "border-[var(--app-border)] text-[var(--app-text-secondary)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
                              }`}
                            >
                              <Icon size={12} className={active ? "text-[var(--app-text-primary)]" : "text-[var(--app-text-secondary)]"} />
                              {label}
                              {active && <span className="ml-1 text-[10px] text-emerald-400">Active</span>}
                            </button>
                          );
                        })}
                      </div>
                      <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-2 text-[11px] text-[var(--app-text-secondary)]">
                        <div>Effective provider: <span className="text-[var(--app-text-primary)]">{activeAgentProvider}</span></div>
                        <div>Effective model: <span className="text-[var(--app-text-primary)]">{activeAgentModel || "unset"}</span></div>
                        <div className="truncate">Effective baseUrl: <span className="text-[var(--app-text-primary)]">{activeAgentBaseUrl || "unset"}</span></div>
                      </div>
                    </div>

                    <div className="order-[30] mt-5 rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 space-y-3">
                      <div className="text-[11px] uppercase tracking-widest app-text-muted">Multi Providers</div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { key: "openrouter" as const, label: "OpenRouter", Icon: Globe },
                          { key: "qwen" as const, label: "Qwen", Icon: QwenIcon },
                          { key: "nanobanana" as const, label: "Nano Banana", Icon: Sparkles },
                        ].map(({ key, label, Icon }) => {
                          const active = activeMultiProvider === key;
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setMultiProvider(key)}
                              className={`flex items-center gap-2 px-3 py-2 rounded-full text-[11px] border transition ${
                                active
                                  ? "bg-[var(--app-panel-soft)] border-[var(--app-border-strong)] text-[var(--app-text-primary)]"
                                  : "border-[var(--app-border)] text-[var(--app-text-secondary)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
                              }`}
                            >
                              <Icon size={12} className={active ? "text-[var(--app-text-primary)]" : "text-[var(--app-text-secondary)]"} />
                              {label}
                              {active && <span className="ml-1 text-[10px] text-emerald-400">Active</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="order-[50] mt-5 rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 space-y-3">
                      <div className="text-[11px] uppercase tracking-widest app-text-muted">Video Providers</div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { key: "qwen" as const, label: "Qwen", Icon: QwenIcon },
                          { key: "vidu" as const, label: "Vidu", Icon: Video },
                          { key: "seedance" as const, label: "Seedance", Icon: Video },
                        ].map(({ key, label, Icon }) => {
                          const active = activeVideoProvider === key;
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setActiveVideoProvider(key)}
                              className={`flex items-center gap-2 px-3 py-2 rounded-full text-[11px] border transition ${
                                active
                                  ? "bg-[var(--app-panel-soft)] border-[var(--app-border-strong)] text-[var(--app-text-primary)]"
                                  : "border-[var(--app-border)] text-[var(--app-text-secondary)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
                              }`}
                            >
                              <Icon size={12} className={active ? "text-[var(--app-text-primary)]" : "text-[var(--app-text-secondary)]"} />
                              {label}
                              {active && <span className="ml-1 text-[10px] text-emerald-400">Active</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>

          {activeAgentProvider === "deepseek" && (
            <div className="order-[20] rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-xs text-[var(--app-text-secondary)]">DeepSeek</div>
                <div className="rounded-full border border-[var(--app-border)] px-2 py-1 text-[10px] uppercase tracking-widest text-[var(--app-text-muted)]">
                  Responses API
                </div>
              </div>
              <div className="text-[11px] text-[var(--app-text-muted)]">
                Uses the shared OpenAI Agents SDK Responses pipeline. DeepSeek currently supports this route only with the official Flash model.
              </div>
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-[var(--app-text-secondary)] mb-1">API Endpoint</div>
                  <input
                    type="text"
                    value={activeAgentBaseUrl || DEEPSEEK_RESPONSES_BASE_URL}
                    onChange={(e) => setConfig({ ...config, textConfig: { ...config.textConfig, agentBaseUrl: e.target.value } })}
                    className="w-full bg-[var(--app-panel-muted)] border border-[var(--app-border)] rounded-xl px-3 py-2 text-sm text-[var(--app-text-primary)] focus:ring-2 focus:ring-cyan-300 focus:outline-none"
                  />
                </div>
                <div>
                  <div className="text-xs text-[var(--app-text-secondary)] mb-2">Target Model</div>
                  <div className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-2 text-sm text-[var(--app-text-primary)]">
                    {DEEPSEEK_DEFAULT_MODEL}
                  </div>
                </div>
              </div>
              <div className="text-[11px] text-[var(--app-text-muted)]">
                Pro is disabled until DeepSeek officially adds Responses API support. Legacy Pro selections are migrated to Flash.
              </div>
            </div>
          )}

          {activeAgentProvider === "openrouter" && (
            <div className="order-[20] rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 space-y-3">
              <div>
                <div className="text-xs text-[var(--app-text-secondary)] mb-1">API Endpoint</div>
                <div className="text-sm text-[var(--app-text-secondary)]">{activeAgentBaseUrl || OPENROUTER_BASE_URL}</div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-[var(--app-text-secondary)]">Target Model</label>
                  <button
                    type="button"
                    onClick={handleFetchTextModels}
                    disabled={isLoadingTextModels}
                    className="text-[11px] flex items-center gap-1 text-sky-300 hover:text-sky-200 disabled:opacity-50"
                  >
                    {isLoadingTextModels ? <Loader2 size={12} className="animate-spin" /> : "拉取模型"}
                  </button>
                </div>
                {textModelFetchMessage && (
                  <div className={`text-[11px] mb-2 flex items-center gap-1 ${textModelFetchMessage.type === "error" ? "text-red-400" : "text-emerald-300"}`}>
                    {textModelFetchMessage.type === "error" ? <AlertCircle size={10} /> : <CheckCircle size={10} />}
                    {textModelFetchMessage.text}
                  </div>
                )}
                {availableTextModels.length > 0 ? (
                  <select
                    value={activeAgentModel}
                    onChange={(e) => setConfig({ ...config, textConfig: { ...config.textConfig, agentModel: e.target.value } })}
                    className="w-full bg-[var(--app-panel-muted)] border border-[var(--app-border)] rounded-xl px-3 py-2 text-sm text-[var(--app-text-primary)] focus:ring-2 focus:ring-sky-400 focus:outline-none"
                  >
                    {availableTextModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="e.g. openai/gpt-4.1-mini"
                    value={activeAgentModel}
                    onChange={(e) => setConfig({ ...config, textConfig: { ...config.textConfig, agentModel: e.target.value } })}
                    className="w-full bg-[var(--app-panel-muted)] border border-[var(--app-border)] rounded-xl px-3 py-2 text-sm text-[var(--app-text-primary)] focus:ring-2 focus:ring-sky-400 focus:outline-none"
                  />
                )}
              </div>
              <div className="text-[11px] text-[var(--app-text-muted)]">
                备用路线。共享密钥仅配置在 Edge；个人密钥请在项目设置中填写。
              </div>
            </div>
          )}

          {activeAgentProvider === "ark" && (
            <div className="order-[20] rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-xs text-[var(--app-text-secondary)]">Volcengine Ark</div>
              </div>
              <div className="text-[11px] text-[var(--app-text-muted)]">
                主选路线之一。edge runtime 仅读取 Cloudflare Pages Functions 环境变量 `ARK_API_KEY`，不会把密钥下发到浏览器。Agent 建议优先使用 `doubao-seed-*` 或已开通权限的 `ep-*` 接入点 ID，旧的 `doubao-lite/pro-*` 常会在 Responses 路线上直接 404。
              </div>

              <div className="space-y-4">
                <div>
                  <div className="text-xs text-[var(--app-text-secondary)] mb-1">API Endpoint</div>
                  <div className="text-sm text-[var(--app-text-secondary)]">{activeAgentBaseUrl || ARK_RESPONSES_BASE_URL}</div>
                </div>
                <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] uppercase tracking-widest text-[var(--app-text-muted)]">
                      chat · {arkChatModels.length}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleFetchArkModels}
                        disabled={isLoadingArkChatModels}
                        className="text-[11px] flex items-center gap-1 text-emerald-300 hover:text-emerald-200 disabled:opacity-50"
                      >
                        {isLoadingArkChatModels ? <Loader2 size={12} className="animate-spin" /> : "拉取模型"}
                      </button>
                      {arkModelsRaw && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(arkModelsRaw);
                            } catch {
                              // Ignore clipboard failures.
                            }
                          }}
                          className="text-[11px] flex items-center gap-1 text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]"
                        >
                          复制原始返回
                        </button>
                      )}
                    </div>
                  </div>
                  {arkChatFetchMessage && (
                    <div className={`text-[11px] flex items-center gap-1 ${arkChatFetchMessage.type === "error" ? "text-red-400" : "text-emerald-300"}`}>
                      {arkChatFetchMessage.type === "error" ? <AlertCircle size={10} /> : <CheckCircle size={10} />}
                      {arkChatFetchMessage.text}
                    </div>
                  )}
                  <select
                    value={activeAgentModel || ARK_DEFAULT_MODEL}
                    onChange={(e) => setConfig({ ...config, textConfig: { ...config.textConfig, agentModel: e.target.value } })}
                    className="w-full bg-[var(--app-panel-muted)] border border-[var(--app-border)] rounded-xl px-3 py-2 text-sm text-[var(--app-text-primary)] focus:ring-2 focus:ring-emerald-300 focus:outline-none"
                  >
                    {(
                      arkChatModels.length
                        ? [
                            ...(activeAgentModel && !arkChatModels.find((m) => m.id === activeAgentModel)
                              ? [{ id: activeAgentModel } as ArkModel]
                              : []),
                            ...arkChatModels,
                          ]
                        : [{ id: ARK_DEFAULT_MODEL } as ArkModel]
                    ).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id}
                      </option>
                    ))}
                  </select>
                  {arkChatModels.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {arkChatModels.map((model) =>
                        renderCompatibleModelCard(model, activeAgentModel === model.id, () =>
                          setConfig({ ...config, textConfig: { ...config.textConfig, agentModel: model.id } })
                        )
                      )}
                    </div>
                  ) : (
                    <div className="text-[12px] text-[var(--app-text-muted)]">暂无模型信息，请先拉取。</div>
                  )}
                  {arkModelsRaw && (
                    <div className="pt-3 border-t border-[var(--app-border)]">
                      <button
                        type="button"
                        onClick={() => setShowArkRaw((prev) => !prev)}
                        className="text-[11px] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]"
                      >
                        {showArkRaw ? "隐藏原始返回" : "查看原始返回"}
                      </button>
                      {showArkRaw && (
                        <pre className="mt-2 max-h-56 overflow-auto rounded-xl border border-[var(--app-border)] bg-black/30 p-3 text-[10px] text-[var(--app-text-secondary)] whitespace-pre-wrap">
                          {arkModelsRaw}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
                <div className="text-[11px] text-[var(--app-text-muted)]">
                  使用方舟 OpenAI 兼容 / Responses 路线。默认基址为 `{ARK_RESPONSES_BASE_URL}`。
                </div>
              </div>
            </div>
          )}

          {activeAgentProvider === "qwen" && (
            <div className="order-[20] rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-xs text-[var(--app-text-secondary)]">Aliyun Qwen</div>
              </div>
              <div className="text-[11px] text-[var(--app-text-muted)]">
                主选路线。共享密钥仅配置在 Edge；个人密钥请在项目设置中填写。模型列表接口返回的是平台可见模型，不等于当前 API Key 一定已开通全部权限；若 404，请先回退到 `qwen-plus`。
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] uppercase tracking-widest text-[var(--app-text-muted)]">
                      chat · {qwenChatModels.length}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleFetchQwenModels}
                        disabled={isLoadingQwenChatModels}
                        className="text-[11px] flex items-center gap-1 text-amber-300 hover:text-amber-200 disabled:opacity-50"
                      >
                        {isLoadingQwenChatModels ? <Loader2 size={12} className="animate-spin" /> : "拉取模型"}
                      </button>
                      {qwenModelsRaw && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(qwenModelsRaw);
                            } catch {
                              // Ignore clipboard failures.
                            }
                          }}
                          className="text-[11px] flex items-center gap-1 text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]"
                        >
                          复制原始返回
                        </button>
                      )}
                    </div>
                  </div>
                  {qwenChatFetchMessage && (
                    <div className={`text-[11px] flex items-center gap-1 ${qwenChatFetchMessage.type === "error" ? "text-red-400" : "text-emerald-300"}`}>
                      {qwenChatFetchMessage.type === "error" ? <AlertCircle size={10} /> : <CheckCircle size={10} />}
                      {qwenChatFetchMessage.text}
                    </div>
                  )}
                  <select
                    value={activeAgentModel || QWEN_DEFAULT_MODEL}
                    onChange={(e) => setConfig({ ...config, textConfig: { ...config.textConfig, agentModel: e.target.value } })}
                    className="w-full bg-[var(--app-panel-muted)] border border-[var(--app-border)] rounded-xl px-3 py-2 text-sm text-[var(--app-text-primary)] focus:ring-2 focus:ring-amber-300 focus:outline-none"
                  >
                    {(qwenChatModels.length ? qwenChatModels : [{ id: QWEN_DEFAULT_MODEL }]).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id}
                      </option>
                    ))}
                  </select>
                  <div className="pt-2 border-t border-[var(--app-border)]">
                    <div className="text-[11px] uppercase tracking-widest text-[var(--app-text-muted)] mb-2">Models</div>
                    {qwenChatModels.length === 0 ? (
                      <div className="text-[12px] text-[var(--app-text-muted)]">暂无模型信息，请先拉取。</div>
                    ) : (
                      <div className="space-y-4">
                        {qwenGroups.map((group) => {
                          const isCollapsed = collapsedGroups[group.key] ?? false;
                          return (
                            <div key={group.key} className="space-y-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setCollapsedGroups((prev) => ({ ...prev, [group.key]: !isCollapsed }))
                                }
                                className="w-full flex items-center justify-between text-[11px] uppercase tracking-widest text-[var(--app-text-muted)] hover:text-[var(--app-text-secondary)]"
                              >
                                <span className="flex items-center gap-2">
                                  <group.Icon size={12} />
                                  {group.label} · {group.items.length}
                                </span>
                                <ChevronDown size={12} className={`transition ${isCollapsed ? "-rotate-90" : "rotate-0"}`} />
                              </button>
                              {!isCollapsed && (
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                  {group.items.map((model) =>
                                    renderCompatibleModelCard(model, activeAgentModel === model.id, () =>
                                      setConfig({ ...config, textConfig: { ...config.textConfig, agentModel: model.id } })
                                    )
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {qwenModelsRaw && (
                      <div className="pt-3">
                        <button
                          type="button"
                          onClick={() => setShowQwenRaw((prev) => !prev)}
                          className="text-[11px] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]"
                        >
                          {showQwenRaw ? "隐藏原始返回" : "查看原始返回"}
                        </button>
                        {showQwenRaw && (
                          <pre className="mt-2 max-h-56 overflow-auto rounded-xl border border-[var(--app-border)] bg-black/30 p-3 text-[10px] text-[var(--app-text-secondary)] whitespace-pre-wrap">
                            {qwenModelsRaw}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}


          {activeMultiProvider === "openrouter" && (
            <div className="order-[40] rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 space-y-3">
              <div className="text-xs text-[var(--app-text-secondary)]">OpenRouter</div>
              <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-3 space-y-3">
                <div className="text-[11px] uppercase tracking-widest text-[var(--app-text-muted)]">multimodal-generation · 1</div>
                <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-3 text-[12px] text-[var(--app-text-secondary)]">
                  固定模型：<span className="text-[var(--app-text-primary)] font-semibold">openrouter-managed</span>
                </div>
                <div className="text-[11px] text-[var(--app-text-muted)]">用于多模态图片生成，占位可替换。</div>
              </div>
              <div className="text-[11px] text-[var(--app-text-muted)]">
                共享密钥仅配置在 Edge；个人密钥请在项目设置中填写。
              </div>
            </div>
          )}

          {activeMultiProvider === "qwen" && (
            <div className="order-[40] rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 space-y-3">
              <div className="text-xs text-[var(--app-text-secondary)]">Aliyun Qwen</div>
              <div className="text-[11px] text-[var(--app-text-muted)]">
                共享密钥仅配置在 Edge；个人密钥请在项目设置中填写。
              </div>
              <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-3 space-y-3">
                <div className="text-[11px] uppercase tracking-widest text-[var(--app-text-muted)]">multimodal-generation · 1</div>
                <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-3 text-[12px] text-[var(--app-text-secondary)]">
                  固定模型：<span className="text-[var(--app-text-primary)] font-semibold">{QWEN_WAN_IMAGE_MODEL}</span>
                </div>
                <div className="text-[11px] text-[var(--app-text-muted)]">用于 WAN Image 节点，端口已固定。</div>
              </div>
            </div>
          )}

          {activeMultiProvider === "nanobanana" && (
            <div className="order-[40] rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 space-y-4">
              <div className="text-xs text-[var(--app-text-secondary)]">Nano Banana</div>
              <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-3 space-y-3">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-[var(--app-text-muted)]">
                  <Sparkles size={12} />
                  async-image-generation · 1
                </div>
                <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-3 text-[12px] text-[var(--app-text-secondary)]">
                  固定模型：<span className="text-[var(--app-text-primary)] font-semibold">{NANOBANANA_PRO_MODEL}</span>
                </div>
                <div className="text-[11px] text-[var(--app-text-muted)]">
                  按文档走 `application/json` + `Authorization` Header，请求入口固定为异步图片接口。
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-[var(--app-text-secondary)] flex items-center gap-2">
                  <Globe size={12} />
                  API Endpoint
                </label>
                <input
                  type="text"
                  value={config.multimodalConfig.baseUrl || NANOBANANA_PRO_ENDPOINT}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      multimodalConfig: {
                        ...prev.multimodalConfig,
                        provider: "nanobanana",
                        model: NANOBANANA_PRO_MODEL,
                        baseUrl: e.target.value,
                      },
                    }))
                  }
                  className="w-full bg-[var(--app-panel-muted)] border border-[var(--app-border)] rounded-xl px-3 py-2 text-sm text-[var(--app-text-primary)] focus:ring-2 focus:ring-amber-300 focus:outline-none"
                />
              </div>
              <div className="text-[11px] text-[var(--app-text-muted)]">
                API Key 由 Cloudflare Pages Functions 从环境变量自动注入，用户侧不再填写。支持文生图，也支持通过 `urls` 传单张参考图到专属的 Nano Banana 节点。
              </div>
            </div>
          )}

          {activeVideoProvider === "qwen" && (
            <div className="order-[60] rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 space-y-3">
              <div className="text-xs text-[var(--app-text-secondary)]">Aliyun Qwen</div>
              <div className="text-[11px] text-[var(--app-text-muted)]">
                共享密钥仅配置在 Edge；个人密钥请在项目设置中填写。
              </div>
              <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-3 space-y-3">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-[var(--app-text-muted)]">
                  <Video size={12} />
                  video-generation · 1
                </div>
                <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-3 text-[12px] text-[var(--app-text-secondary)]">
                  固定模型：<span className="text-[var(--app-text-primary)] font-semibold">{QWEN_WAN_VIDEO_MODEL}</span>
                </div>
                <div className="text-[11px] text-[var(--app-text-muted)]">用于 WAN Video 节点，端口已固定。</div>
              </div>
            </div>
          )}

          {activeVideoProvider === "vidu" && (
            <div className="order-[60] rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 space-y-2">
              <div className="text-sm font-semibold text-[var(--app-text-primary)]">Vidu CN Q3</div>
              <div className="text-[11px] text-[var(--app-text-muted)]">
                Base URL: {VIDU_DEFAULT_BASE_URL}
              </div>
              <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-2 text-[12px] text-[var(--app-text-secondary)]">
                默认模型：<span className="text-[var(--app-text-primary)] font-semibold">{INITIAL_VIDU_CONFIG.defaultModel}</span>
                <span className="text-[var(--app-text-muted)]"> · 可切到 viduq3-mix</span>
              </div>
              <div className="text-[11px] text-[var(--app-text-muted)]">
                使用国内区 `https://platform.vidu.cn` 文档与 `VIDU_API_KEY`。前端节点无需手填 API Key。
              </div>
              <button
                type="button"
                onClick={() => applyViduReferenceDemo(undefined, { expectedRevision: revision })}
                className="inline-flex items-center justify-center px-3 py-2 rounded-full text-[10px] font-semibold uppercase tracking-widest text-[var(--app-text-secondary)] bg-white/5 hover:bg-white/10 transition"
              >
                载入 Vidu 参考演示
              </button>
            </div>
          )}

          {activeVideoProvider === "seedance" && (
            <div className="order-[60] rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 space-y-3">
              <div className="text-sm font-semibold text-[var(--app-text-primary)]">Seedance</div>
              <div className="text-[11px] text-[var(--app-text-muted)]">
                Base URL: {SEEDANCE_DEFAULT_BASE_URL}
              </div>
              <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-3 space-y-3">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-[var(--app-text-muted)]">
                  <Video size={12} />
                  video-generation · 2
                </div>
                <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-3 text-[12px] text-[var(--app-text-secondary)] space-y-1">
                  <div>
                    可选模型：<span className="text-[var(--app-text-primary)] font-semibold">Seedance 2.0</span>
                    <span className="text-[var(--app-text-muted)]"> · {SEEDANCE_DEFAULT_MODEL}</span>
                  </div>
                  <div>
                    可选模型：<span className="text-[var(--app-text-primary)] font-semibold">Seedance 2.0 Fast</span>
                    <span className="text-[var(--app-text-muted)]"> · {SEEDANCE_FAST_MODEL}</span>
                  </div>
                </div>
                <div className="text-[11px] leading-5 text-[var(--app-text-muted)]">
                  固定模式：多模态参考生视频。输入参考图片（0~9）+ 参考视频（0~3）+ 参考音频（0~3）+ 文本提示词（可选）生成 1 个目标视频。
                </div>
                <div className="text-[11px] leading-5 text-[var(--app-text-muted)]">
                  注意：不可单独输入音频，应至少包含 1 个参考视频或图片。
                </div>
              </div>
              <div className="text-[11px] text-[var(--app-text-muted)]">
                共享 ARK_API_KEY 仅配置在 Edge；个人密钥请在项目设置中填写，或沿用 Video API Key。
              </div>
              <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold text-[var(--app-text-primary)]">API Key 检测</div>
                    <div className="text-[11px] text-[var(--app-text-muted)]">
                      验证 Key、可调用能力和当前 Seedance 模型 ID。
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleProbeSeedanceKey}
                    disabled={isCheckingSeedanceKey}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--app-text-secondary)] hover:bg-white/10 transition disabled:opacity-60"
                  >
                    {isCheckingSeedanceKey ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                    检测 API Key
                  </button>
                </div>
                {seedanceProbeResult ? (
                  <div
                    className={`rounded-xl border px-3 py-2 text-[11px] leading-5 ${
                      seedanceProbeResult.status === "valid"
                        ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                        : seedanceProbeResult.status === "invalid"
                          ? "border-red-400/30 bg-red-500/10 text-red-200"
                          : "border-amber-400/30 bg-amber-500/10 text-amber-200"
                    }`}
                  >
                    <div className="font-semibold">{seedanceProbeResult.message}</div>
                    <div className="mt-1 text-[var(--app-text-secondary)]">
                      Key 来源：{seedanceProbeResult.keySource} · Base URL：{seedanceProbeResult.baseUrl}
                    </div>
                    <div className="text-[var(--app-text-secondary)]">
                      当前模型：{seedanceProbeResult.configuredModel || "未设置"} ·{" "}
                      {seedanceProbeResult.modelAvailable === true
                        ? "模型 ID 可用"
                        : seedanceProbeResult.modelAvailable === false
                          ? "模型 ID 未出现在返回列表"
                          : "模型可用性未确认"}
                    </div>
                    <div className="text-[var(--app-text-secondary)]">
                      能力：{seedanceProbeResult.capabilities.join(" / ")}
                    </div>
                    {seedanceProbeResult.models.length ? (
                      <div className="mt-1 max-h-16 overflow-auto font-mono text-[10px] text-[var(--app-text-muted)]">
                        {seedanceProbeResult.models.slice(0, 24).join("\n")}
                        {seedanceProbeResult.models.length > 24 ? `\n... +${seedanceProbeResult.models.length - 24}` : ""}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          )}
                </div>
              )}

              {selectedPanel === "ability" && (
                <div className="space-y-6">
                  <div className="border-b border-[var(--app-border)] pb-3">
                    <div className="text-[13px] font-semibold text-[var(--app-text-primary)]">Tools</div>
                    <div className="mt-1 text-[11px] leading-5 text-[var(--app-text-secondary)]">
                      Runtime 操作面，负责读取事实、沉淀资产并写回 Flow。
                    </div>
                  </div>
                  {TOOL_ITEMS.map((activeToolItem) => {
                    const ActiveToolIcon = activeToolItem.Icon;
                    const activeTool = activeToolItem.key;
                    const activeToolActivity = summarizeToolActivity(activeToolItem, toolActivityMap);
                    return (
                      <section key={activeToolItem.key} className="border-b border-[var(--app-border)] pb-6 last:border-b-0 last:pb-0">
                        <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-4">
                  <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                            <ActiveToolIcon size={16} className="text-[var(--app-text-primary)]" />
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--app-text-muted)]">
                              {activeToolItem.capability} capability
                            </div>
                            <div className="text-[13px] font-semibold text-[var(--app-text-primary)]">
                              {activeToolItem.title}
                            </div>
                          </div>
                        </div>
                        <div className="max-w-[62ch] text-[12px] leading-relaxed text-[var(--app-text-secondary)]">
                          {activeToolItem.description}
                        </div>
                      </div>
                      <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">
                        已接入
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-3">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">Tool Contract</div>
                        <div className="mt-2 text-[16px] font-semibold text-[var(--app-text-primary)]">{activeToolItem.tools.length}</div>
                        <div className="mt-1 text-[11px] text-[var(--app-text-secondary)]">真实 runtime tools</div>
                      </div>
                      <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-3">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">Persistence</div>
                        <div className="mt-2 text-[16px] font-semibold text-[var(--app-text-primary)]">
                          {activeTool === "project-data" ? "Read-only" : "Workflow-backed"}
                        </div>
                        <div className="mt-1 text-[11px] text-[var(--app-text-secondary)]">{activeToolItem.artifact}</div>
                      </div>
                      <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-3">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">Boundary</div>
                        <div className="mt-2 text-[16px] font-semibold text-[var(--app-text-primary)]">{activeToolItem.capability}</div>
                        <div className="mt-1 text-[11px] text-[var(--app-text-secondary)]">{activeToolItem.boundary}</div>
                      </div>
                    </div>

                    <div className="rounded-[28px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-4 py-4 space-y-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">Runtime Tools</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {activeToolItem.tools.map((toolName) => (
                            <span
                              key={toolName}
                              className="px-3 py-1.5 rounded-full border border-[var(--app-border)] bg-[var(--app-panel-muted)] text-[11px] text-[var(--app-text-primary)]"
                            >
                              {toolName}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">作用对象</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {activeToolItem.surfaces.map((surface) => (
                            <span
                              key={surface}
                              className="px-3 py-1.5 rounded-full border border-[var(--app-border)] text-[11px] text-[var(--app-text-secondary)]"
                            >
                              {surface}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {activeTool === "project-data" ? (
                      <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-4 py-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[12px] font-semibold text-[var(--app-text-primary)]">查阅开关</div>
                            <div className="mt-1 text-[11px] text-[var(--app-text-secondary)]">
                              控制 Agent 是否可以读取项目事实层，并以证据驱动回答与后续理解。
                            </div>
                          </div>
                          <label className="flex items-center gap-2 text-[11px] text-[var(--app-text-secondary)]">
                            <input
                              type="checkbox"
                              checked={styloToolSettings.projectData.enabled}
                              onChange={(e) => updateProjectToolSettings({ enabled: e.target.checked })}
                              className="h-4 w-4 text-emerald-400 border-[var(--app-border)] rounded bg-[var(--app-panel-muted)]"
                            />
                            启用
                          </label>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-3">
                            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Evidence Rule</div>
                            <div className="mt-2 text-[11px] leading-relaxed text-[var(--app-text-secondary)]">
                              回答优先引用剧本、分集、场景、角色库和场景库，而不是仅依赖短期对话记忆。
                            </div>
                          </div>
                          <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-3">
                            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Return Shape</div>
                            <div className="mt-2 text-[11px] leading-relaxed text-[var(--app-text-secondary)]">
                              返回结构化片段、检索命中和 evidence-friendly 摘要，供理解与操作继续消费。
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (onSetFoundationNodeView) {
                              onSetFoundationNodeView(!foundationNodeView);
                              return;
                            }
                            onOrganizeFoundationScaffold?.();
                          }}
                          disabled={!onSetFoundationNodeView && !onOrganizeFoundationScaffold}
                          className="inline-flex w-full items-center justify-between gap-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-4 py-3 text-left transition hover:border-[var(--app-border-strong)] hover:bg-[var(--app-panel-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span>
                            <span className="block text-[12px] font-semibold text-[var(--app-text-primary)]">
                              {foundationNodeView ? "返回 Foundation 模块" : "查看底层节点骨架"}
                            </span>
                            <span className="mt-1 block text-[11px] leading-relaxed text-[var(--app-text-secondary)]">
                              {foundationNodeView
                                ? "隐藏系统文件夹和档案节点，回到胶卷盒、轴与块的快捷操作视图。"
                                : "展开项目、轴、块三层真实节点与固定连线，并自动整理布局。"}
                            </span>
                          </span>
                          <span className="rounded-full border border-[var(--app-border)] px-2.5 py-1 text-[10px] font-semibold text-[var(--app-text-secondary)]">
                            {foundationNodeView ? "Foundation" : "Nodes"}
                          </span>
                        </button>
                      </div>
                    ) : activeTool === "runtime-intelligence" ? (
                      <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-4 py-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[12px] font-semibold text-[var(--app-text-primary)]">认知开关</div>
                            <div className="mt-1 text-[11px] text-[var(--app-text-secondary)]">
                              控制 Agent 是否可以读取运行手册、搜索网页，并查看 Stylo GitHub 仓库实时源码。
                            </div>
                          </div>
                          <label className="flex items-center gap-2 text-[11px] text-[var(--app-text-secondary)]">
                            <input
                              type="checkbox"
                              checked={styloToolSettings.runtimeIntelligence.enabled}
                              onChange={(e) => updateRuntimeToolSettings({ enabled: e.target.checked })}
                              className="h-4 w-4 text-emerald-400 border-[var(--app-border)] rounded bg-[var(--app-panel-muted)]"
                            />
                            启用
                          </label>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <label className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-3">
                            <span className="flex items-center justify-between gap-3">
                              <span>
                                <span className="block text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Web Search</span>
                                <span className="mt-2 block text-[11px] leading-relaxed text-[var(--app-text-secondary)]">
                                  默认开启。用于实时外部事实、Provider/API 行为、版本、价格和文档变更。
                                </span>
                              </span>
                              <input
                                type="checkbox"
                                checked={styloToolSettings.runtimeIntelligence.webSearchEnabled}
                                onChange={(e) => updateRuntimeToolSettings({ webSearchEnabled: e.target.checked })}
                                className="h-4 w-4 text-emerald-400 border-[var(--app-border)] rounded bg-[var(--app-panel-muted)]"
                              />
                            </span>
                          </label>
                          <label className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-3">
                            <span className="flex items-center justify-between gap-3">
                              <span>
                                <span className="block text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">GitHub Source</span>
                                <span className="mt-2 block text-[11px] leading-relaxed text-[var(--app-text-secondary)]">
                                  默认开启。允许读取完整仓库树、任意源码文件，并按路径或内容搜索。
                                </span>
                              </span>
                              <input
                                type="checkbox"
                                checked={styloToolSettings.runtimeIntelligence.githubAccessEnabled}
                                onChange={(e) => updateRuntimeToolSettings({ githubAccessEnabled: e.target.checked })}
                                className="h-4 w-4 text-emerald-400 border-[var(--app-border)] rounded bg-[var(--app-panel-muted)]"
                              />
                            </span>
                          </label>
                        </div>
                      </div>
                    ) : activeTool === "workflow-builder" ? (
                      <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-4 py-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[12px] font-semibold text-[var(--app-text-primary)]">操作开关</div>
                            <div className="mt-1 text-[11px] text-[var(--app-text-secondary)]">
                              控制 Agent 是否可以把理解转成 Flow Workspace 中的真实节点与连线。
                            </div>
                          </div>
                          <label className="flex items-center gap-2 text-[11px] text-[var(--app-text-secondary)]">
                            <input
                              type="checkbox"
                              checked={styloToolSettings.workflowBuilder.enabled}
                              onChange={(e) => updateWorkflowToolSettings({ enabled: e.target.checked })}
                              className="h-4 w-4 text-emerald-400 border-[var(--app-border)] rounded bg-[var(--app-panel-muted)]"
                            />
                            启用
                          </label>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
	                          <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-3">
	                            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Single Node</div>
	                            <div className="mt-2 text-[11px] leading-relaxed text-[var(--app-text-secondary)]">
	                              文档优先通过 `create_document` / `update_document` 写入；通用节点操作仅作为兜底路径。
	                            </div>
	                          </div>
	                          <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-3">
	                            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Connection</div>
	                            <div className="mt-2 text-[11px] leading-relaxed text-[var(--app-text-secondary)]">
	                              普通画布移动与连线优先使用 `move_flow_node` / `connect_flow_nodes`。
	                            </div>
	                          </div>
                          <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-3">
                            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Safety</div>
                            <div className="mt-2 text-[11px] leading-relaxed text-[var(--app-text-secondary)]">
                              创建前校验 ref 与剧集定位；连线前校验节点与 handle 合法性。
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 space-y-4">
                    <div>
                      <div className="text-[11px] uppercase tracking-widest app-text-muted">Runtime Activity</div>
                      <div className="mt-2 text-[12px] leading-relaxed text-[var(--app-text-secondary)]">
                        当前单元对应的真实 tool 调用轨迹与产物摘要。
                      </div>
                    </div>
                    <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-3 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">Activity Summary</div>
                          <div className="mt-1 text-[11px] text-[var(--app-text-secondary)]">
                            当前能力卡对应的真实 tool 调用轨迹与产物摘要。
                          </div>
                        </div>
                        <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-2.5 py-1 text-[10px] text-[var(--app-text-secondary)]">
                          {activeToolActivity.records.length}/{activeToolItem.tools.length} 已记录
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-3">
                          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">最近调用</div>
                          <div className="mt-2 text-[14px] font-semibold text-[var(--app-text-primary)]">
                            {formatRelativeTime(activeToolActivity.latest)}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-3">
                          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">累计调用</div>
                          <div className="mt-2 text-[14px] font-semibold text-[var(--app-text-primary)]">
                            {activeToolActivity.totalCalls}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-3">
                          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">成功</div>
                          <div className="mt-2 text-[14px] font-semibold text-emerald-300">
                            {activeToolActivity.totalSuccesses}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-3">
                          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">失败</div>
                          <div className="mt-2 text-[14px] font-semibold text-rose-300">
                            {activeToolActivity.totalFailures}
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-3">
                          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">最近失败</div>
                          <div className="mt-2 text-[11px] leading-relaxed text-[var(--app-text-secondary)]">
                            {activeToolActivity.lastFailure?.lastError
                              ? `${activeToolActivity.lastFailure.toolName} · ${activeToolActivity.lastFailure.lastError}`
                              : "暂无失败记录。"}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-3">
                          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">最近产物</div>
                          <div className="mt-2 text-[11px] leading-relaxed text-[var(--app-text-secondary)]">
                            {activeToolActivity.lastArtifact?.lastArtifact
                              ? `${activeToolActivity.lastArtifact.toolName} · ${activeToolActivity.lastArtifact.lastArtifact}`
                              : "暂无持久化或节点产物。"}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-3">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">Execution Principle</div>
                      <div className="mt-2 text-[11px] leading-relaxed text-[var(--app-text-secondary)]">
                        Agent 的状态变更必须通过 tools 完成。查阅负责取证，理解负责沉淀事实，操作负责把事实转成节点工作流。
                      </div>
                    </div>
                  </div>
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}

              {selectedPanel === "ability" && (
                <div className="space-y-4 border-t border-[var(--app-border)] pt-6">
                  <div>
                    <div className="text-[13px] font-semibold text-[var(--app-text-primary)]">Skills</div>
                    <div className="mt-1 text-[11px] leading-5 text-[var(--app-text-secondary)]">
                      按需读取的方法层，作为 Agent 能力的工作方式说明。
                    </div>
                  </div>
                  {availableAgentSkills.length ? (
                    <>
                      {availableAgentSkills.map((activeSkill) => (
                      <div key={activeSkill.id} className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-2">
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-10 rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] flex items-center justify-center">
                                <Sparkles size={16} className="text-[var(--app-text-primary)]" />
                              </div>
                              <div>
                                <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--app-text-muted)]">internal skill</div>
                                <div className="text-[13px] font-semibold text-[var(--app-text-primary)]">{activeSkill.title}</div>
                              </div>
                            </div>
                            <div className="max-w-[62ch] text-[12px] leading-relaxed text-[var(--app-text-secondary)]">
                              {activeSkill.description}
                            </div>
                          </div>
                          <span className="rounded-full border border-[var(--app-border)] px-2.5 py-1 text-[10px] text-[var(--app-text-secondary)]">
                            on-demand
                          </span>
                        </div>
                        {activeSkill.tags?.length ? (
                          <div className="flex flex-wrap gap-2">
                            {activeSkill.tags.map((tag) => (
                              <span
                                key={`${activeSkill.id}-${tag}`}
                                className="rounded-full border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-2.5 py-1 text-[10px] text-[var(--app-text-secondary)]"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      ))}
                      <div className="rounded-xl border border-dashed border-[var(--app-border)] px-3 py-2 text-[11px] leading-5 text-[var(--app-text-muted)]">
                        这些 skill 不会预先注入到系统提示词里。Agent 会在任务需要时先调用 skill catalog / read 工具，再按需学习并应用对应方法。
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-dashed border-[var(--app-border)] px-3 py-4 text-[11px] text-[var(--app-text-muted)]">
                      当前没有可启用的内建 skill。
                    </div>
                  )}
                </div>
              )}

              {selectedPanel === "assets" && assetsUnit === "identity" && (
                <CharacterSceneLibraryPanel
                  projectData={projectData}
                  setProjectData={setProjectData}
                  initialSelectionType="character"
                  apiKey={config.textConfig.apiKey}
                />
              )}

              {selectedPanel === "history" && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-widest app-text-muted">History</div>
                        <div className="mt-2 text-[12px] leading-relaxed text-[var(--app-text-secondary)]">
                          当前面板展示用户可见的聊天时间线、Cloudflare D1 持久化的 edge session，以及 OpenAI Agents SDK tracing 生命周期。
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-2.5 py-1 text-[10px] text-[var(--app-text-secondary)]">
                          edge {cloudSessions.length}
                        </span>
                        <button
                          type="button"
                          onClick={() => void loadObservability()}
                          disabled={observabilityLoading || !activeConversation?.id || !isSignedIn}
                          className="rounded-full border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-2.5 py-1 text-[10px] text-[var(--app-text-secondary)] transition hover:bg-[var(--app-panel-muted)] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {observabilityLoading ? "刷新中" : "刷新"}
                        </button>
                      </div>
                    </div>
                    {!isSignedIn ? (
                      <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-3 py-3 text-[11px] text-amber-200">
                        登录后可读取 Cloudflare D1 中的 edge session 与 SDK traces。
                      </div>
                    ) : observabilityError ? (
                      <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-3 py-3 text-[11px] text-rose-200">
                        {observabilityError}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {[
                        { key: "all", label: "全部" },
                        { key: "user", label: "User" },
                        { key: "assistant", label: "Assistant" },
                        { key: "tool", label: "Tool" },
                      ].map((item) => {
                        const active = historyFilter === item.key;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => setHistoryFilter(item.key as typeof historyFilter)}
                            className={`rounded-full px-3 py-1.5 text-[11px] transition ${
                              active
                                ? "border border-[var(--app-border-strong)] bg-[var(--app-panel-soft)] text-[var(--app-text-primary)]"
                                : "border border-[var(--app-border)] bg-transparent text-[var(--app-text-secondary)] hover:bg-[var(--app-panel-soft)]"
                            }`}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                    {activeConversation ? (
                      <>
                        <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] p-3 space-y-1">
                          <div className="text-[12px] font-semibold text-[var(--app-text-primary)]">
                            {activeConversation.title || buildConversationTitle(activeConversation.messages || [])}
                          </div>
                          <div className="text-[10px] text-[var(--app-text-muted)]">
                            聊天更新 {formatTimestamp(activeConversation.updatedAt || activeConversation.createdAt)}
                          </div>
                          <div className="text-[10px] text-[var(--app-text-muted)]">
                            Edge Session 更新 {selectedCloudSession ? formatTimestamp(selectedCloudSession.updatedAt) : "尚未写入 D1"}
                          </div>
                          <div className="text-[10px] text-[var(--app-text-muted)]">
                            最新 Trace {selectedCloudTrace ? formatTimestamp(selectedCloudTrace.updatedAt) : "尚未写入 trace"}
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                          <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-3">
                            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Chat Timeline</div>
                            <div className="mt-2 text-[16px] font-semibold text-[var(--app-text-primary)]">
                              {filteredConversationMessages.length}
                            </div>
                            <div className="mt-1 text-[11px] text-[var(--app-text-secondary)]">用户可见消息</div>
                          </div>
                          <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-3">
                            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Edge Session</div>
                            <div className="mt-2 text-[16px] font-semibold text-[var(--app-text-primary)]">
                              {filteredCloudSessionMessages.length}
                            </div>
                            <div className="mt-1 text-[11px] text-[var(--app-text-secondary)]">D1 中的多轮 session items</div>
                          </div>
                          <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-3">
                            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">SDK Trace</div>
                            <div className="mt-2 text-[16px] font-semibold text-[var(--app-text-primary)]">
                              {selectedCloudTrace?.spans.length || 0}
                            </div>
                            <div className="mt-1 text-[11px] text-[var(--app-text-secondary)]">
                              {selectedCloudTrace ? `${selectedCloudTrace.provider} · ${selectedCloudTrace.model}` : "暂无 trace"}
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-[11px] text-[var(--app-text-muted)]">请选择一条对话。</div>
                    )}
                  </div>

                  {activeConversation && (
                    <div className="grid grid-cols-1 xl:grid-cols-[0.85fr_1.15fr] gap-4">
                      <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[11px] uppercase tracking-widest app-text-muted">Chat Timeline</div>
                            <div className="mt-1 text-[11px] text-[var(--app-text-secondary)]">
                              用户在聊天面板可直接看到的消息历史。
                            </div>
                          </div>
                          <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-2.5 py-1 text-[10px] text-[var(--app-text-secondary)]">
                            {filteredConversationMessages.length} msgs
                          </span>
                        </div>
                        <div className="space-y-2">
                          {filteredConversationMessages.length ? (
                            filteredConversationMessages.map((message, index) => (
                              <div
                                key={`${activeConversation.id}-${index}`}
                                className="rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-3"
                              >
                                <div className="text-[10px] uppercase tracking-widest text-[var(--app-text-muted)]">
                                  {message.role || "unknown"}
                                </div>
                                <div className="mt-1 text-[12px] text-[var(--app-text-secondary)] whitespace-pre-wrap">
                                  {message.text || "（空消息）"}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-xl border border-dashed border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-4 text-[11px] text-[var(--app-text-muted)]">
                              暂无对话内容。
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-[11px] uppercase tracking-widest app-text-muted">Edge Session Memory</div>
                              <div className="mt-1 text-[11px] text-[var(--app-text-secondary)]">
                                D1 中的真实 session items。这里不再手工裁 history，而是读取 compaction 后的当前真相。
                              </div>
                            </div>
                            <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-2.5 py-1 text-[10px] text-[var(--app-text-secondary)]">
                              {filteredCloudSessionMessages.length} entries
                            </span>
                          </div>
                          {selectedCloudSession ? (
                            <div className="space-y-2">
                              <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-3">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] text-[var(--app-text-secondary)]">
                                  <div>
                                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Session Id</div>
                                    <div className="mt-1 break-all">{selectedCloudSession.sessionId}</div>
                                  </div>
                                  <div>
                                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Items</div>
                                    <div className="mt-1">{selectedCloudSession.items.length}</div>
                                  </div>
                                  <div>
                                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Updated</div>
                                    <div className="mt-1">{formatTimestamp(selectedCloudSession.updatedAt)}</div>
                                  </div>
                                </div>
                              </div>
                              {selectedCloudSession.skillReads?.length ? (
                                <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-3 space-y-2">
                                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Read Skill Packages</div>
                                  <div className="flex flex-wrap gap-2">
                                    {selectedCloudSession.skillReads.map((skill) => (
                                      <div
                                        key={`${skill.id}:${skill.version}`}
                                        className="rounded-full border border-[var(--app-border)] px-2.5 py-1 text-[10px] text-[var(--app-text-secondary)]"
                                      >
                                        {skill.title}
                                        {skill.version ? ` · ${skill.version}` : ""}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              {filteredCloudSessionMessages.length ? (
                                filteredCloudSessionMessages.map((message, index) => (
                                  <div
                                    key={`${selectedCloudSession.sessionId}-${index}`}
                                    className="rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-3"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="space-y-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="text-[10px] uppercase tracking-widest text-[var(--app-text-muted)]">
                                            {message.role || "unknown"}
                                          </span>
                                          {message.type ? (
                                            <span className="rounded-full border border-[var(--app-border)] px-2 py-0.5 text-[10px] text-[var(--app-text-secondary)]">
                                              {message.type}
                                            </span>
                                          ) : null}
                                        </div>
                                        <div className="text-[12px] text-[var(--app-text-secondary)] whitespace-pre-wrap">
                                          {typeof message.text === "string" && message.text.trim()
                                            ? message.text
                                            : summarizeRuntimeToolOutput(message)}
                                        </div>
                                      </div>
                                      <div className="text-right text-[10px] text-[var(--app-text-muted)]">
                                        {formatTimestamp(message.createdAt)}
                                      </div>
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <div className="rounded-xl border border-dashed border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-4 text-[11px] text-[var(--app-text-muted)]">
                                  该对话尚未写入 edge session，或当前过滤条件下没有匹配项。
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="rounded-xl border border-dashed border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-4 text-[11px] text-[var(--app-text-muted)]">
                              尚未读取到该对话对应的云端 session。
                            </div>
                          )}
                        </div>

                        <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-[11px] uppercase tracking-widest app-text-muted">SDK Trace</div>
                              <div className="mt-1 text-[11px] text-[var(--app-text-secondary)]">
                                基于 OpenAI Agents SDK tracing processor 落到 D1 的 run/span 视图。
                              </div>
                            </div>
                            <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-2.5 py-1 text-[10px] text-[var(--app-text-secondary)]">
                              {cloudTraces.length} traces
                            </span>
                          </div>
                          <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-3 space-y-3">
                            <div className="flex flex-wrap gap-2">
                              {[
                                { key: "all", label: `全部 ${cloudTraces.length}` },
                                {
                                  key: "failed",
                                  label: `失败 ${cloudTraces.filter((trace) => trace.errorCount > 0).length}`,
                                },
                              ].map((item) => {
                                const active = traceStatusFilter === item.key;
                                return (
                                  <button
                                    key={item.key}
                                    type="button"
                                    onClick={() => setTraceStatusFilter(item.key as "all" | "failed")}
                                    className={`rounded-full px-3 py-1.5 text-[11px] transition ${
                                      active
                                        ? "border border-[var(--app-border-strong)] bg-[var(--app-panel-muted)] text-[var(--app-text-primary)]"
                                        : "border border-[var(--app-border)] bg-transparent text-[var(--app-text-secondary)] hover:bg-[var(--app-panel-muted)]"
                                    }`}
                                  >
                                    {item.label}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {traceProviderOptions.map((provider) => {
                                const active = traceProviderFilter === provider;
                                return (
                                  <button
                                    key={provider}
                                    type="button"
                                    onClick={() => setTraceProviderFilter(provider)}
                                    className={`rounded-full px-3 py-1.5 text-[11px] transition ${
                                      active
                                        ? "border border-[var(--app-border-strong)] bg-[var(--app-panel-muted)] text-[var(--app-text-primary)]"
                                        : "border border-[var(--app-border)] bg-transparent text-[var(--app-text-secondary)] hover:bg-[var(--app-panel-muted)]"
                                    }`}
                                  >
                                    {provider === "all" ? "全部 provider" : provider}
                                  </button>
                                );
                              })}
                            </div>
                            <input
                              value={traceSearch}
                              onChange={(e) => setTraceSearch(e.target.value)}
                              placeholder="搜索 model / workflow / trace id"
                              className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-2 text-[12px] text-[var(--app-text-primary)] placeholder:text-[var(--app-text-muted)] focus:ring-2 focus:ring-emerald-300 focus:outline-none"
                            />
                            <div className="space-y-2 max-h-56 overflow-auto pr-1">
                              {filteredTraceSummaries.length ? (
                                filteredTraceSummaries.map((trace) => {
                                  const active = selectedCloudTrace?.traceId === trace.traceId;
                                  return (
                                    <button
                                      key={trace.traceId}
                                      type="button"
                                      onClick={() => {
                                        setSelectedTraceId(trace.traceId);
                                        void loadObservability(trace.traceId);
                                      }}
                                      className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                                        active
                                          ? "border-[var(--app-border-strong)] bg-[var(--app-panel-muted)]"
                                          : "border-[var(--app-border)] bg-transparent hover:bg-[var(--app-panel-muted)]"
                                      }`}
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="rounded-full border border-[var(--app-border)] px-2 py-0.5 text-[10px] text-[var(--app-text-secondary)]">
                                              {trace.provider}
                                            </span>
                                            {trace.errorCount > 0 ? (
                                              <span className="rounded-full border border-rose-400/30 bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-300">
                                                {trace.errorCount} errors
                                              </span>
                                            ) : null}
                                            <span className="text-[12px] font-semibold text-[var(--app-text-primary)] break-all">
                                              {trace.model}
                                            </span>
                                          </div>
                                          <div className="mt-1 text-[11px] text-[var(--app-text-secondary)] break-all">
                                            {trace.workflowName || "Stylo Edge Agent"}
                                          </div>
                                          <div className="mt-1 text-[10px] text-[var(--app-text-muted)]">
                                            {trace.spanCount} spans
                                          </div>
                                          <div className="mt-1 text-[10px] text-[var(--app-text-muted)] break-all">
                                            {trace.traceId}
                                          </div>
                                        </div>
                                        <div className="text-right text-[10px] text-[var(--app-text-muted)]">
                                          <div>{formatRelativeTime(trace.updatedAt)}</div>
                                          <div className="mt-1">{formatTimestamp(trace.updatedAt)}</div>
                                        </div>
                                      </div>
                                    </button>
                                  );
                                })
                              ) : (
                                <div className="rounded-xl border border-dashed border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-4 text-[11px] text-[var(--app-text-muted)]">
                                  当前过滤条件下没有 trace。
                                </div>
                              )}
                            </div>
                          </div>
                          {selectedCloudTrace ? (
                            <div className="space-y-3">
                              <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-3">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] text-[var(--app-text-secondary)]">
                                  <div>
                                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Trace Id</div>
                                    <div className="mt-1 break-all">{selectedCloudTrace.traceId}</div>
                                  </div>
                                  <div>
                                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Provider / Model</div>
                                    <div className="mt-1">{selectedCloudTrace.provider} · {selectedCloudTrace.model}</div>
                                  </div>
                                  <div>
                                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Workflow</div>
                                    <div className="mt-1">{selectedCloudTrace.workflowName || "Stylo Edge Agent"}</div>
                                  </div>
                                  <div>
                                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Updated</div>
                                    <div className="mt-1">{formatTimestamp(selectedCloudTrace.updatedAt)}</div>
                                  </div>
                                  <div>
                                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Span Count</div>
                                    <div className="mt-1">{selectedCloudTrace.spanCount}</div>
                                  </div>
                                  <div>
                                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Error Count</div>
                                    <div className={`mt-1 ${selectedCloudTrace.errorCount ? "text-rose-300" : ""}`}>
                                      {selectedCloudTrace.errorCount}
                                    </div>
                                  </div>
                                </div>
                              </div>
                              {selectedCloudTrace.skillReads?.length ? (
                                <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-3 space-y-2">
                                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Skill Reads</div>
                                  <div className="flex flex-wrap gap-2">
                                    {selectedCloudTrace.skillReads.map((skill) => (
                                      <div
                                        key={`${skill.id}:${skill.version}`}
                                        className="rounded-full border border-[var(--app-border)] px-2.5 py-1 text-[10px] text-[var(--app-text-secondary)]"
                                      >
                                        {skill.title}
                                        {skill.version ? ` · ${skill.version}` : ""}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              <div className="flex flex-wrap gap-2">
                                {[
                                  { key: "all", label: `全部 spans ${selectedCloudTrace.spans.length}` },
                                  {
                                    key: "error",
                                    label: `错误 spans ${selectedCloudTrace.spans.filter((span) => span.error).length}`,
                                  },
                                ].map((item) => {
                                  const active = traceSpanFilter === item.key;
                                  return (
                                    <button
                                      key={item.key}
                                      type="button"
                                      onClick={() => setTraceSpanFilter(item.key as "all" | "error")}
                                      className={`rounded-full px-3 py-1.5 text-[11px] transition ${
                                        active
                                          ? "border border-[var(--app-border-strong)] bg-[var(--app-panel-soft)] text-[var(--app-text-primary)]"
                                          : "border border-[var(--app-border)] bg-transparent text-[var(--app-text-secondary)] hover:bg-[var(--app-panel-soft)]"
                                      }`}
                                    >
                                      {item.label}
                                    </button>
                                  );
                                })}
                              </div>
                              <div className="space-y-2">
                                {visibleSelectedTraceSpans.length ? (
                                  visibleSelectedTraceSpans.map((span) => (
                                    <div
                                      key={span.spanId}
                                      className="rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-3"
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="space-y-1 min-w-0">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-[10px] uppercase tracking-widest text-[var(--app-text-muted)]">
                                              {span.spanType}
                                            </span>
                                            <span className="text-[12px] font-semibold text-[var(--app-text-primary)]">
                                              {span.spanName || span.spanId}
                                            </span>
                                            {span.error ? (
                                              <span className="rounded-full border border-rose-400/30 bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-300">
                                                error
                                              </span>
                                            ) : null}
                                          </div>
                                          <div className="text-[11px] text-[var(--app-text-secondary)] break-all">
                                            {span.parentId ? `parent: ${span.parentId}` : "root span"}
                                          </div>
                                          {span.error ? (
                                            <div className="text-[11px] text-rose-200 whitespace-pre-wrap">{span.error}</div>
                                          ) : null}
                                        </div>
                                        <div className="text-right text-[10px] text-[var(--app-text-muted)]">
                                          <div>{formatIsoTimestamp(span.startedAt)}</div>
                                          <div className="mt-1">{formatIsoTimestamp(span.endedAt)}</div>
                                        </div>
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <div className="rounded-xl border border-dashed border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-4 text-[11px] text-[var(--app-text-muted)]">
                                    当前过滤条件下没有可展示的 span。
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-xl border border-dashed border-[var(--app-border)] bg-[var(--app-panel-soft)] px-3 py-4 text-[11px] text-[var(--app-text-muted)]">
                              尚未读取到与当前对话关联的 SDK trace。
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="text-[11px] text-[var(--app-text-muted)]">
                    仅对 Stylo 对话生效。当前主链以 Cloudflare edge session 与 SDK trace 为准。
                  </div>
                </div>
              )}

              {selectedPanel === "assets" && assetsUnit !== "identity" && (
                <div className="space-y-4">
                  <MaterialsPanel
                    activeSection={assetsSection}
                    onActiveSectionChange={setAssetsSection}
                    showSidebar={false}
                  />
                </div>
              )}

              {selectedPanel === "lab" && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {([
                    { key: "glassLab", actionKey: "glassLab" as const, title: "Glass Lab", detail: "调试玻璃、折射与悬浮面板的视觉参数。", Icon: ScanSearch, status: "independent lab" },
                    { key: "agentLab", actionKey: "agentLab" as const, title: "Agent Lab", detail: "检查 Agent runtime、工具调用与实验性能力面板。", Icon: Braces, status: "independent lab" },
                    { key: "designSystemLab", actionKey: "designSystemLab" as const, title: "Design System", detail: "统一 Stylo 的视觉 token、组件层级、包装器材质与动效规则。当前为规范工作台占位。", Icon: ScanSearch, status: "foundation placeholder" },
                    { key: "manus", title: "Manus", detail: "剧本写作包装器：Fountain 解析、专业格式编辑、角色绑定与保存协调。", Icon: FileText, status: "source repository", href: PRODUCT_REPOSITORIES.manus },
                    { key: "lookbookLab", title: "LookBook", detail: "前期美术包装器：组织角色、场景身份与视觉开发资料。", Icon: FileText, status: "source repository", href: PRODUCT_REPOSITORIES.lookbook },
                    { key: "cinewor", actionKey: "cineworLab" as const, title: "Cinewor", detail: "原生电影调度工作台：以 3D 空间组织角色轨迹、机位与交付画幅，数据随当前项目保存。", Icon: Video, status: "integrated experiment" },
                  ] as Array<{
                    key: string;
                    title: string;
                    detail: string;
                    Icon: React.ComponentType<{ size?: number }>;
                    status: string;
                    actionKey?: Extract<ModuleKey, "glassLab" | "agentLab" | "cineworLab" | "designSystemLab">;
                    href?: string;
                  }>).map((lab) => {
                    const content = (
                      <>
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-soft)]">
                          <lab.Icon size={16} />
                        </div>
                        <div>
                          <div className="text-[13px] font-semibold text-[var(--app-text-primary)]">{lab.title}</div>
                          <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">{lab.status}</div>
                        </div>
                      </div>
                      <div className="mt-3 text-[12px] leading-6 text-[var(--app-text-secondary)]">{lab.detail}</div>
                      {lab.href ? (
                        <div className="mt-3 flex items-center gap-2 border-t border-[var(--app-border)] pt-3 text-[10px] font-medium text-[var(--app-text-primary)]">
                          <Github size={14} />
                          <span>Open repository</span>
                        </div>
                      ) : null}
                      </>
                    );
                    if (lab.href) {
                      return (
                        <a
                          key={lab.key}
                          href={lab.href}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 text-left transition hover:-translate-y-px hover:border-[var(--app-border-strong)] hover:bg-[var(--app-panel-soft)] active:translate-y-0"
                          aria-label={`打开 ${lab.title} GitHub 仓库`}
                        >
                          {content}
                        </a>
                      );
                    }
                    return (
                      <button
                        key={lab.key}
                        type="button"
                        onClick={() => lab.actionKey && onOpenVisualLab?.(lab.actionKey)}
                        disabled={!lab.actionKey || !onOpenVisualLab}
                        className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-4 text-left transition hover:border-[var(--app-border-strong)] hover:bg-[var(--app-panel-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {content}
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedPanel === "sync" && (
                <div className="space-y-6">
                  {(["status", "history"] as const).map((section) => (
                    <section key={section} className="space-y-3 border-b border-[var(--app-border)] pb-6 last:border-b-0 last:pb-0">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--app-text-muted)]">
                        {section === "status" ? "Status & Keys" : "Cloud History"}
                      </div>
                      <SyncPanel
                        config={config}
                        onConfigChange={setConfig}
                        isSignedIn={isSignedIn}
                        accountSession={accountSession}
                        syncState={syncState}
                        onResetProject={onResetProject}
                        activeSection={section}
                        showSidebar={false}
                      />
                    </section>
                  ))}
                </div>
              )}

              {selectedPanel === "info" && (
                <div className="space-y-6">
                  {(["about", "roadmap"] as const).map((section) => (
                    <section key={section} className="space-y-3 border-b border-[var(--app-border)] pb-6 last:border-b-0 last:pb-0">
                      <InfoPanel
                        onOpenLanding={onOpenLanding}
                        activeSection={section}
                        showSidebar={false}
                      />
                    </section>
                  ))}
                </div>
              )}
            </div>
          </div>
          </div>
        </section>
      </div>
    </div>
  );
};
