import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  ReactFlow,
  MiniMap,
  useReactFlow,
  PanOnScrollMode,
  ReactFlowProvider,
  ConnectionMode,
  XYPosition,
  ConnectionLineType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "../styles/nodeflow.css";
import { useNodeFlowStore } from "../store/nodeFlowStore";
import { NodeType, VideoGenNodeData, type NodeFlowNode } from "../types";
import { FloatingActionBar } from "./FloatingActionBar";
import { ProjectSettingsPanel, type ProjectSettingsPanelKey } from "./ProjectSettingsPanel";
import type { MaterialsSectionKey } from "./MaterialsPanel";
import { StyloAgent } from "./StyloAgent";
import { useFlowSurface } from "./FlowSurface";
import { CanvasBackgroundField } from "./CanvasBackgroundField";
import { CanvasContentLocator } from "./CanvasContentLocator";
import { EdgeAlignmentGuides } from "./EdgeAlignmentGuides";
import { ViewportControls } from "./ViewportControls";
import { ManusPanel } from "./ManusPanel";
import { LookbookStudioPanel } from "./lookbook/LookbookStudioPanel";
import { AccountWorkspace, type AccountWorkspaceView } from "./AccountWorkspace";
import { Toast } from "./Toast";
import { AnnotationModal } from "./AnnotationModal";
import { AppConfig, ProjectData, SyncState } from "../../types";
import type { ModuleKey } from "./ModuleBar";
import { FileText, List } from "lucide-react";
import { ChatCenteredDots, Plus, X } from "@phosphor-icons/react";
import type { EdgeAlignmentGuide } from "../utils/edgeAlignment";
import type { BottomDockTray, SharedCanvasControls, SharedCanvasViewport } from "./canvas/types";
import { locateCanvasContent, type CanvasContentDirection } from "./canvas/contentLocator";
import type {
  AgentScriptEditProposalBatch,
  StyloSubmitRequest,
  ScriptDocumentCommit,
  ScriptPageSplitCommit,
} from "./stylo/interactionTypes";
import { saveActiveFlowIntoProjects } from "../foundation/scaffold";
import { resolveStyloProjectId } from "../../agents/runtime/projectScope";
import { addPinoardNote, ensurePinoardForText } from "../../utils/pinoardWorkspace";
import { readNodeFlowImportFile } from "../nodeflow/package";
import { removeLookbookIdentity, syncLookbookIdentitiesFromFountain } from "../../utils/lookbookIdentities";
import { analyzeScreenplay, createScreenplayPreview } from "../screenplay/fountainEngine";
import { getConnectedScriptPageSequence, SCREENPLAY_PAGE_RELATION } from "../screenplay/manusPages";
import {
  createManusMembershipLink,
  getManusFolderForPage,
  normalizeManusFolderStructure,
} from "../manus/folder";
import type { EnsureProjectSynced } from "../../hooks/useCloudSync";
import type { AccountApiSession } from "../../sync/authenticatedFetch";
import { SyncStatusBanner } from "../../components/SyncStatusBanner";

interface CreativeWorkspaceProps {
  accountScope: string;
  projectData: ProjectData;
  setProjectData: React.Dispatch<React.SetStateAction<ProjectData>>;
  config: AppConfig;
  setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
  isSignedIn?: boolean;
  getAuthToken?: (options?: { skipCache?: boolean }) => Promise<string | null>;
  accountSession?: AccountApiSession;
  syncState?: SyncState;
  ensureProjectSynced?: EnsureProjectSynced;
  onOpenLanding?: () => void;
  externalProjectSettingsRequest?: { panel: ProjectSettingsPanelKey; nonce: number } | null;
  onAssetLoad?: (type: "script", content: string, fileName?: string) => void;
  onOpenModule?: (key: ModuleKey) => void;
  syncIndicator?: { label: string; color: string } | null;
  onResetProject?: () => void;
  onDeleteFlowProject?: (projectId: string) => Promise<void>;
  projectResetToken?: number;
  onSignOut?: () => void;
  accountInfo?: {
    isLoaded: boolean;
    isSignedIn: boolean;
    name?: string;
    email?: string;
    avatarUrl?: string;
    onSignIn?: () => void;
    onSignOut?: () => void;
    onUploadAvatar?: () => void;
    username?: string;
  };
}

type ThemeKey = "dark" | "light" | "sand" | "creative" | "calm" | "lively";
type PatternKey = "dots" | "grid" | "cross" | "lines" | "diagonal" | "none";

type ThemePreset = {
  label: string;
  description: string;
  bg: string;
  panel: string;
  panelStrong: string;
  panelMuted: string;
  panelSoft: string;
  border: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  panelShadow: string;
  panelShadowStrong: string;
  nodeShadow: string;
  nodeShadowStrong: string;
  pattern: string;
  patternSoft: string;
  nodeBgGradient: string;
  nodeHeaderBg: string;
  scheme: "light" | "dark";
};

const THEME_PRESETS: Record<ThemeKey, ThemePreset> = {
  dark: {
    label: "Dark",
    description: "System dark neutrals in graphite and charcoal.",
    bg: "#1c1c1e",
    panel: "rgba(28, 28, 30, 0.92)",
    panelStrong: "rgba(44, 44, 46, 0.96)",
    panelMuted: "rgba(255, 255, 255, 0.05)",
    panelSoft: "rgba(255, 255, 255, 0.08)",
    border: "rgba(255, 255, 255, 0.1)",
    borderStrong: "rgba(255, 255, 255, 0.18)",
    textPrimary: "#f5f5f7",
    textSecondary: "rgba(245, 245, 247, 0.68)",
    textMuted: "rgba(245, 245, 247, 0.44)",
    accent: "#8e8e93",
    accentStrong: "#aeaeb2",
    accentSoft: "rgba(142, 142, 147, 0.12)",
    panelShadow: "0 12px 28px rgba(8, 8, 10, 0.2)",
    panelShadowStrong: "0 16px 36px rgba(8, 8, 10, 0.24)",
    nodeShadow: "0 18px 40px rgba(8, 8, 10, 0.3)",
    nodeShadowStrong: "0 22px 52px rgba(8, 8, 10, 0.36)",
    pattern: "rgba(255, 255, 255, 0.045)",
    patternSoft: "rgba(255, 255, 255, 0.022)",
    nodeBgGradient: "linear-gradient(160deg, rgba(44, 44, 46, 0.97), rgba(28, 28, 30, 0.98))",
    nodeHeaderBg: "rgba(255, 255, 255, 0.02)",
    scheme: "dark",
  },
  light: {
    label: "Light",
    description: "Warm paper, editorial ink, and the Stylo landing grid.",
    bg: "#f3f3ef",
    panel: "rgba(251, 251, 248, 0.92)",
    panelStrong: "#fbfbf8",
    panelMuted: "rgba(24, 24, 23, 0.045)",
    panelSoft: "rgba(24, 24, 23, 0.075)",
    border: "rgba(24, 24, 23, 0.12)",
    borderStrong: "rgba(24, 24, 23, 0.2)",
    textPrimary: "#181817",
    textSecondary: "rgba(24, 24, 23, 0.62)",
    textMuted: "rgba(24, 24, 23, 0.4)",
    accent: "#b3483f",
    accentStrong: "#913a34",
    accentSoft: "rgba(179, 72, 63, 0.1)",
    panelShadow: "0 14px 34px -24px rgba(24, 24, 23, 0.34)",
    panelShadowStrong: "0 22px 52px -30px rgba(24, 24, 23, 0.42)",
    nodeShadow: "0 18px 38px -24px rgba(24, 24, 23, 0.3)",
    nodeShadowStrong: "0 24px 50px -28px rgba(24, 24, 23, 0.38)",
    pattern: "rgba(24, 24, 23, 0.042)",
    patternSoft: "rgba(24, 24, 23, 0.042)",
    nodeBgGradient: "linear-gradient(160deg, rgba(251, 251, 248, 0.99), rgba(243, 243, 239, 0.97))",
    nodeHeaderBg: "rgba(24, 24, 23, 0.025)",
    scheme: "light",
  },
  sand: {
    label: "Amber",
    description: "Sunlit amber paper with honey glass layers and cleaner warmth.",
    bg: "#ffe7b8",
    panel: "rgba(255, 247, 228, 0.84)",
    panelStrong: "rgba(255, 251, 242, 0.96)",
    panelMuted: "rgba(230, 150, 12, 0.1)",
    panelSoft: "rgba(230, 150, 12, 0.17)",
    border: "rgba(201, 118, 0, 0.18)",
    borderStrong: "rgba(201, 118, 0, 0.3)",
    textPrimary: "#4b2d02",
    textSecondary: "rgba(75, 45, 2, 0.7)",
    textMuted: "rgba(75, 45, 2, 0.46)",
    accent: "#e6960c",
    accentStrong: "#c97600",
    accentSoft: "rgba(230, 150, 12, 0.18)",
    panelShadow: "0 12px 28px rgba(126, 72, 0, 0.1)",
    panelShadowStrong: "0 18px 40px rgba(126, 72, 0, 0.14)",
    nodeShadow: "0 16px 36px rgba(126, 72, 0, 0.12)",
    nodeShadowStrong: "0 22px 48px rgba(126, 72, 0, 0.16)",
    pattern: "rgba(201, 118, 0, 0.12)",
    patternSoft: "rgba(230, 150, 12, 0.055)",
    nodeBgGradient: "linear-gradient(160deg, rgba(255, 251, 242, 0.99), rgba(255, 234, 193, 0.96))",
    nodeHeaderBg: "rgba(230, 150, 12, 0.05)",
    scheme: "light",
  },
  creative: {
    label: "Green",
    description: "Fresh translucent green with clearer mint glass and less haze.",
    bg: "#d7ffe5",
    panel: "rgba(244, 255, 248, 0.84)",
    panelStrong: "rgba(250, 255, 252, 0.96)",
    panelMuted: "rgba(18, 196, 102, 0.1)",
    panelSoft: "rgba(18, 196, 102, 0.17)",
    border: "rgba(0, 151, 74, 0.18)",
    borderStrong: "rgba(0, 151, 74, 0.3)",
    textPrimary: "#0c3821",
    textSecondary: "rgba(12, 56, 33, 0.7)",
    textMuted: "rgba(12, 56, 33, 0.46)",
    accent: "#12c466",
    accentStrong: "#00974a",
    accentSoft: "rgba(18, 196, 102, 0.18)",
    panelShadow: "0 12px 28px rgba(8, 88, 48, 0.08)",
    panelShadowStrong: "0 18px 40px rgba(8, 88, 48, 0.12)",
    nodeShadow: "0 16px 36px rgba(8, 88, 48, 0.1)",
    nodeShadowStrong: "0 22px 48px rgba(8, 88, 48, 0.14)",
    pattern: "rgba(0, 151, 74, 0.12)",
    patternSoft: "rgba(18, 196, 102, 0.055)",
    nodeBgGradient: "linear-gradient(160deg, rgba(250, 255, 252, 0.99), rgba(223, 255, 235, 0.96))",
    nodeHeaderBg: "rgba(18, 196, 102, 0.05)",
    scheme: "light",
  },
  calm: {
    label: "Blue",
    description: "Clear sky blue with brighter water-glass surfaces and more lift.",
    bg: "#d9efff",
    panel: "rgba(243, 250, 255, 0.84)",
    panelStrong: "rgba(250, 253, 255, 0.96)",
    panelMuted: "rgba(34, 149, 255, 0.1)",
    panelSoft: "rgba(34, 149, 255, 0.17)",
    border: "rgba(0, 107, 204, 0.18)",
    borderStrong: "rgba(0, 107, 204, 0.3)",
    textPrimary: "#0b3156",
    textSecondary: "rgba(11, 49, 86, 0.7)",
    textMuted: "rgba(11, 49, 86, 0.46)",
    accent: "#2295ff",
    accentStrong: "#006bcc",
    accentSoft: "rgba(34, 149, 255, 0.18)",
    panelShadow: "0 12px 28px rgba(0, 73, 143, 0.08)",
    panelShadowStrong: "0 18px 40px rgba(0, 73, 143, 0.12)",
    nodeShadow: "0 16px 36px rgba(0, 73, 143, 0.1)",
    nodeShadowStrong: "0 22px 48px rgba(0, 73, 143, 0.14)",
    pattern: "rgba(0, 107, 204, 0.12)",
    patternSoft: "rgba(34, 149, 255, 0.055)",
    nodeBgGradient: "linear-gradient(160deg, rgba(250, 253, 255, 0.99), rgba(220, 241, 255, 0.96))",
    nodeHeaderBg: "rgba(34, 149, 255, 0.05)",
    scheme: "light",
  },
  lively: {
    label: "Pink",
    description: "Clean pink bloom with brighter rose glass and less dustiness.",
    bg: "#ffe0ef",
    panel: "rgba(255, 244, 249, 0.84)",
    panelStrong: "rgba(255, 250, 252, 0.96)",
    panelMuted: "rgba(255, 96, 156, 0.1)",
    panelSoft: "rgba(255, 96, 156, 0.17)",
    border: "rgba(214, 56, 120, 0.18)",
    borderStrong: "rgba(214, 56, 120, 0.3)",
    textPrimary: "#4a1830",
    textSecondary: "rgba(74, 24, 48, 0.7)",
    textMuted: "rgba(74, 24, 48, 0.46)",
    accent: "#ff609c",
    accentStrong: "#d63878",
    accentSoft: "rgba(255, 96, 156, 0.18)",
    panelShadow: "0 12px 28px rgba(140, 28, 79, 0.08)",
    panelShadowStrong: "0 18px 40px rgba(140, 28, 79, 0.12)",
    nodeShadow: "0 16px 36px rgba(140, 28, 79, 0.1)",
    nodeShadowStrong: "0 22px 48px rgba(140, 28, 79, 0.14)",
    pattern: "rgba(214, 56, 120, 0.12)",
    patternSoft: "rgba(255, 96, 156, 0.055)",
    nodeBgGradient: "linear-gradient(160deg, rgba(255, 250, 252, 0.99), rgba(255, 226, 238, 0.96))",
    nodeHeaderBg: "rgba(255, 96, 156, 0.05)",
    scheme: "light",
  },
};

const boostAlpha = (color: string, multiplier: number) => {
  const match = color.match(/rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/i);
  if (!match) return color;
  const [, r, g, b, a] = match;
  const nextAlpha = Math.min(1, Number.parseFloat(a) * multiplier);
  return `rgba(${r}, ${g}, ${b}, ${nextAlpha})`;
};

const toSvgDataUri = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

const getPatternDefinitions = (
  theme: ThemePreset,
  intensity = 1
): Record<Exclude<PatternKey, "none">, { image: string; size: (scale: number) => string; position?: string }> => {
  const primary = boostAlpha(theme.pattern, intensity);
  const secondary = boostAlpha(theme.patternSoft, intensity);

  return ({
  dots: {
    image:
      `radial-gradient(circle at 1.6px 1.6px, ${primary} 1.6px, transparent 0), radial-gradient(circle at 1px 1px, ${secondary} 1px, transparent 0)`,
    size: (scale) => `${28 * scale}px ${28 * scale}px, ${28 * scale}px ${28 * scale}px`,
    position: "0 0, 14px 14px",
  },
  grid: {
    image:
      `linear-gradient(${secondary} 1px, transparent 1px), linear-gradient(90deg, ${secondary} 1px, transparent 1px), linear-gradient(${primary} 1px, transparent 1px), linear-gradient(90deg, ${primary} 1px, transparent 1px)`,
    size: (scale) =>
      `${22 * scale}px ${22 * scale}px, ${22 * scale}px ${22 * scale}px, ${110 * scale}px ${110 * scale}px, ${110 * scale}px ${110 * scale}px`,
  },
  cross: {
    image: toSvgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44" fill="none">
        <path d="M22 16.5V27.5" stroke="${primary}" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M16.5 22H27.5" stroke="${primary}" stroke-width="1.2" stroke-linecap="round"/>
        <circle cx="22" cy="22" r="1.05" fill="${secondary}"/>
      </svg>
    `),
    size: (scale) =>
      `${44 * scale}px ${44 * scale}px`,
    position: "0 0",
  },
  lines: {
    image:
      `linear-gradient(0deg, ${secondary} 1px, transparent 1px), linear-gradient(0deg, ${primary} 2px, transparent 2px)`,
    size: (scale) => `${26 * scale}px ${26 * scale}px, ${104 * scale}px ${104 * scale}px`,
  },
  diagonal: {
    image:
      `linear-gradient(135deg, transparent 0 43%, ${secondary} 43% 46%, transparent 46% 54%, ${primary} 54% 58%, transparent 58% 100%)`,
    size: (scale) => `${34 * scale}px ${34 * scale}px`,
  },
  });
};

const CreativeWorkspaceInner: React.FC<CreativeWorkspaceProps> = ({
  accountScope,
  projectData,
  setProjectData,
  config,
  setConfig,
  isSignedIn,
  getAuthToken,
  accountSession,
  syncState,
  ensureProjectSynced,
  onOpenLanding,
  externalProjectSettingsRequest,
  onAssetLoad,
  onOpenModule,
  syncIndicator,
  onResetProject,
  onDeleteFlowProject,
  projectResetToken = 0,
  onSignOut,
  accountInfo,
}) => {
  const styloProjectId = resolveStyloProjectId(projectData);
  const [bgTheme, setBgTheme] = useState<ThemeKey>("light");
  const [bgPattern, setBgPattern] = useState<PatternKey>("grid");
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [editingScriptNodeId, setEditingScriptNodeId] = useState<string | null>(null);
  const [activeLookbookNodeId, setActiveLookbookNodeId] = useState<string | null>(null);
  const [activePinoard, setActivePinoard] = useState<{
    pinoardId: string;
    textNodeId: string | null;
  } | null>(null);
  const pinoardEntryViewportRef = useRef<SharedCanvasViewport | null>(null);
  const focusedPinoardIdRef = useRef<string | null>(null);
  const [themeAnchor, setThemeAnchor] = useState<DOMRect | null>(null);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [accountWorkspaceView, setAccountWorkspaceView] = useState<AccountWorkspaceView | null>(null);
  const [projectSettingsPanel, setProjectSettingsPanel] = useState<ProjectSettingsPanelKey>("provider");
  const [projectSettingsAssetsSection, setProjectSettingsAssetsSection] = useState<MaterialsSectionKey | undefined>();
  const [agentDockWidth, setAgentDockWidth] = useState(0);
  const [isStyloCollapsed, setIsStyloCollapsed] = useState(true);
  const [isStyloSending, setIsStyloSending] = useState(false);
  const [styloOpenRequest, setStyloOpenRequest] = useState(0);
  const [styloCloseRequest, setStyloCloseRequest] = useState(0);
  const [styloSubmitRequest, setStyloSubmitRequest] = useState<StyloSubmitRequest | null>(null);
  const [agentScriptEditProposals, setAgentScriptEditProposals] = useState<AgentScriptEditProposalBatch | null>(null);
  const [styloCancelRequest, setStyloCancelRequest] = useState(0);
  const [isStyloFirstManual, setIsStyloFirstManual] = useState(false);
  const [composerInput, setComposerInput] = useState("");
  const isStyloFirstMode = isStyloFirstManual;
  const handleOpenScriptDocument = useCallback((nodeId: string) => {
    setActivePinoard(null);
    setEditingScriptNodeId(nodeId);
    setIsStyloCollapsed(true);
    setStyloCloseRequest((count) => count + 1);
  }, []);
  const handleOpenPinoard = useCallback(
    (pinoardId: string | null, textNodeId?: string) => {
      let resolvedPinoardId = pinoardId;
      if (!resolvedPinoardId && textNodeId) {
        const result = ensurePinoardForText(projectData, textNodeId);
        resolvedPinoardId = result.pinoardId;
        if (result.projectData !== projectData) setProjectData(result.projectData);
      }
      if (!resolvedPinoardId) return;
      setEditingScriptNodeId(null);
      setActiveLookbookNodeId(null);
      setActivePinoard({
        pinoardId: resolvedPinoardId,
        textNodeId: textNodeId || null,
      });
    },
    [projectData, setProjectData]
  );
  const handleAddPinoardNote = useCallback(() => {
    if (!activePinoard) return;
    let createdNodeId: string | null = null;
    setProjectData((previous) => {
      const result = addPinoardNote(previous, activePinoard.pinoardId);
      createdNodeId = result.nodeId;
      return result.projectData;
    });
    window.setTimeout(() => {
      if (!createdNodeId) return;
      setActivePinoard((current) => current
        ? { ...current, textNodeId: createdNodeId }
        : current);
    }, 0);
  }, [activePinoard, setProjectData]);
  useEffect(() => {
    setStyloSubmitRequest(null);
    setAgentScriptEditProposals(null);
    setComposerInput("");
    setIsStyloSending(false);
  }, [styloProjectId]);
  useEffect(() => {
    if (projectResetToken <= 0) return;
    setStyloCancelRequest((count) => count + 1);
    setStyloSubmitRequest(null);
    setAgentScriptEditProposals(null);
    setComposerInput("");
    setIsStyloSending(false);
  }, [projectResetToken]);
  const handleAgentScriptEditProposals = useCallback((batch: AgentScriptEditProposalBatch) => {
    setAgentScriptEditProposals((current) => {
      const nextNodeIds = new Set(batch.proposals.map((proposal) => proposal.nodeId));
      return {
        id: batch.id,
        proposals: [
          ...(current?.proposals || []).filter((proposal) => !nextNodeIds.has(proposal.nodeId)),
          ...batch.proposals,
        ],
      };
    });
  }, []);
  const resolveAgentScriptEditProposal = useCallback((proposalId: string) => {
    setAgentScriptEditProposals((current) => {
      if (!current) return current;
      const proposals = current.proposals.filter((proposal) => proposal.id !== proposalId);
      return proposals.length ? { ...current, proposals } : null;
    });
  }, []);
  const openProjectSettingsPanel = useCallback(
    (panel: ProjectSettingsPanelKey = "provider", assetsSection?: MaterialsSectionKey) => {
      setProjectSettingsPanel(panel);
      setProjectSettingsAssetsSection(panel === "assets" ? assetsSection : undefined);
      setShowProjectSettings(true);
    },
    []
  );
  useEffect(() => {
    if (!externalProjectSettingsRequest) return;
    openProjectSettingsPanel(externalProjectSettingsRequest.panel);
  }, [externalProjectSettingsRequest, openProjectSettingsPanel]);
  const {
    nodes,
    setNodeFlowContext,
    setAppConfig,
    setProjectRoleUpdater,
    setViewportState,
    readingMode,
    setReadingMode,
    currentNodeId,
    setCurrentNode,
    updateNodeData,
    addToGlobalHistory,
    globalAssetHistory,
  } = useNodeFlowStore();
  const { setViewport, screenToFlowPosition, getViewport, getNodesBounds, fitView, zoomTo } = useReactFlow();

  const minZoom = 0.25;
  const maxZoom = 4;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [activeDockTray, setActiveDockTray] = useState<BottomDockTray | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [foundationViewportHost, setFoundationViewportHost] = useState<HTMLElement | null>(null);
  const [foundationViewportTrayHost, setFoundationViewportTrayHost] = useState<HTMLElement | null>(null);
  const [snapToGrid] = useState(true);
  const [snapGuide, setSnapGuide] = useState<EdgeAlignmentGuide | null>(null);
  const initialCanvasViewport = projectData.canvas?.viewport || null;
  const [zoomValue, setZoomValue] = useState(() => initialCanvasViewport?.zoom ?? getViewport().zoom ?? 1);
  const [liveViewport, setLiveViewport] = useState(() => initialCanvasViewport || getViewport());
  const [canvasContentDirection, setCanvasContentDirection] = useState<CanvasContentDirection | null>(null);

  useEffect(() => {
    setAppConfig(config);
  }, [config, setAppConfig]);

  const pendingScriptReviewNodeIds = useMemo(
    () => new Set((agentScriptEditProposals?.proposals || []).map((proposal) => proposal.nodeId)),
    [agentScriptEditProposals]
  );

  const commitScriptDocument = useCallback(
    ({ nodeId, title, content, preview, stats }: ScriptDocumentCommit) => {
      const updatedAt = Date.now();
      const patch = {
        title,
        text: content,
        content,
        documentKind: "script" as const,
        format: "fountain" as const,
        preview,
        updatedAt,
      };
      setProjectData((previous) => {
        const flow = previous.flow || { links: [] };
        const manuscriptNodeIds = new Set(
          getConnectedScriptPageSequence(previous, nodeId).map((node) => node.id)
        );
        const manusFolder = getManusFolderForPage(flow.flowNodes || [], flow.links || [], nodeId);
        let didUpdate = false;
        let didFind = false;
        const flowNodes = (flow.flowNodes || []).map((node) => {
          if (node.id === manusFolder?.id) {
            if (node.data?.title === title) return node;
            didUpdate = true;
            return {
              ...node,
              data: { ...node.data, title, updatedAt },
            };
          }
          if (node.type !== "scriptPage" || !manuscriptNodeIds.has(node.id)) return node;
          if (node.id !== nodeId) {
            if (node.data?.title === title) return node;
            didUpdate = true;
            return {
              ...node,
              data: { ...node.data, title, updatedAt },
            };
          }
          didFind = true;
          const data = (node.data || {}) as Record<string, unknown>;
          if (
            data.title === title &&
            data.text === content &&
            data.content === content &&
            data.preview === preview
          ) {
            return node;
          }
          didUpdate = true;
          const documentId =
            typeof data.documentId === "string" && data.documentId.trim()
              ? data.documentId
              : node.id.replace(/^script-/, "") || node.id;
          return {
            ...node,
            data: {
              ...data,
                ...patch,
                documentId,
                screenplayStats: stats,
                revision: typeof data.revision === "number" ? data.revision + 1 : 1,
            },
          };
        });
        if (!didFind) return previous;
        if (!didUpdate && !content.trim()) return previous;
        const nextData = syncLookbookIdentitiesFromFountain({
          ...previous,
          rawScript: "",
          episodes: [],
          flow: {
            ...flow,
            flowNodes,
          },
        }, {
          sourceNodeId: nodeId,
          content,
          now: updatedAt,
        });
        return {
          ...nextData,
          flowProjects: previous.flowProjects?.length
            ? saveActiveFlowIntoProjects(nextData, updatedAt)
            : previous.flowProjects,
        };
      });
    },
    [setProjectData]
  );

  const deleteLookbookIdentity = useCallback((roleId: string) => {
    const updatedAt = Date.now();
    setProjectData((previous) => {
      const nextData = removeLookbookIdentity(previous, roleId);
      if (nextData === previous) return previous;
      return {
        ...nextData,
        flowProjects: previous.flowProjects?.length
          ? saveActiveFlowIntoProjects(nextData, updatedAt)
          : previous.flowProjects,
      };
    });
  }, [setProjectData]);

  const splitScriptDocument = useCallback(
    ({ sourceNodeId, title, sourceContent, nextContent }: ScriptPageSplitCommit) => {
      const now = Date.now();
      const nextNodeId = `script-page-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      setProjectData((previous) => {
        const flow = previous.flow || { links: [] };
        const sourceNode = (flow.flowNodes || []).find(
          (node) => node.id === sourceNodeId && node.type === "scriptPage"
        );
        if (!sourceNode) return previous;
        const sourceData = (sourceNode.data || {}) as Record<string, unknown>;
        const manuscriptId =
          (typeof sourceData.manuscriptId === "string" && sourceData.manuscriptId) ||
          (typeof sourceData.documentId === "string" && sourceData.documentId) ||
          sourceNode.id;
        const sourcePageNumber = typeof sourceData.pageNumber === "number" ? sourceData.pageNumber : 1;
        const outgoingPageLink = (flow.links || []).find(
          (link) => link.source === sourceNodeId && link.data?.relation === SCREENPLAY_PAGE_RELATION
        );
        const manusFolder = getManusFolderForPage(flow.flowNodes || [], flow.links || [], sourceNodeId);
        const sourceStats = analyzeScreenplay(sourceContent).stats;
        const nextStats = analyzeScreenplay(nextContent).stats;
        const flowNodes = (flow.flowNodes || []).map((node) => {
          if (node.id !== sourceNodeId) return node;
          return {
            ...node,
            data: {
              ...node.data,
              title,
              text: sourceContent,
              content: sourceContent,
              documentKind: "script",
              format: "fountain",
              manuscriptId,
              pageNumber: sourcePageNumber,
              preview: createScreenplayPreview(sourceContent),
              screenplayStats: sourceStats,
              revision: typeof sourceData.revision === "number" ? sourceData.revision + 1 : 1,
              updatedAt: now,
            },
          } as NodeFlowNode;
        });
        const nextNode: NodeFlowNode = {
          id: nextNodeId,
          type: "scriptPage",
          position: { x: sourceNode.position.x + 380, y: sourceNode.position.y },
          style: sourceNode.style,
          data: {
            title,
            text: nextContent,
            content: nextContent,
            documentId: nextNodeId,
            documentKind: "script",
            format: "fountain",
            manuscriptId,
            pageNumber: sourcePageNumber + 1,
            preview: createScreenplayPreview(nextContent),
            screenplayStats: nextStats,
            revision: 1,
            updatedAt: now,
          },
        };
        const links = (flow.links || []).filter((link) => link.id !== outgoingPageLink?.id);
        links.push({
          id: `screenplay-page-${sourceNodeId}-${nextNodeId}`,
          source: sourceNodeId,
          target: nextNodeId,
          sourceHandle: "text",
          targetHandle: "text",
          data: { relation: SCREENPLAY_PAGE_RELATION },
        });
        if (outgoingPageLink) {
          links.push({
            ...outgoingPageLink,
            id: `screenplay-page-${nextNodeId}-${outgoingPageLink.target}`,
            source: nextNodeId,
          });
        }
        if (manusFolder) {
          links.push(createManusMembershipLink(manusFolder.id, nextNodeId));
        }
        const manusStructure = normalizeManusFolderStructure([...flowNodes, nextNode], links);
        let nextData: ProjectData = {
          ...previous,
          rawScript: "",
          episodes: [],
          flow: { ...flow, flowNodes: manusStructure.nodes, links: manusStructure.links },
        };
        nextData = syncLookbookIdentitiesFromFountain(nextData, {
          sourceNodeId,
          content: sourceContent,
          now,
        });
        nextData = syncLookbookIdentitiesFromFountain(nextData, {
          sourceNodeId: nextNodeId,
          content: nextContent,
          now,
        });
        return {
          ...nextData,
          flowProjects: previous.flowProjects?.length
            ? saveActiveFlowIntoProjects(nextData, now)
            : previous.flowProjects,
        };
      });
      return nextNodeId;
    },
    [setProjectData]
  );

  useEffect(() => {
    if (!snapToGrid) setSnapGuide(null);
  }, [snapToGrid]);

  const toggleStyloFirstMode = useCallback(() => {
    setIsStyloFirstManual((prev) => {
      const next = !prev;
      if (next) {
        setStyloOpenRequest((count) => count + 1);
      } else {
        setStyloCloseRequest((count) => count + 1);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setNodeFlowContext({
      projectId: styloProjectId,
      rawScript: "",
      episodes: [],
      designAssets: projectData.designAssets || [],
      roles: projectData.roles || [],
    });
  }, [projectData.designAssets, projectData.roles, setNodeFlowContext, styloProjectId]);

  useEffect(() => {
    setProjectRoleUpdater((roleId, updater) => {
      setProjectData((prev) => ({
        ...prev,
        roles: (prev.roles || []).map((role) => (role.id === roleId ? updater(role) : role)),
      }));
    });
    return () => setProjectRoleUpdater(null);
  }, [setProjectData, setProjectRoleUpdater]);

  useEffect(() => {
    setViewportState(getViewport());
  }, [getViewport, setViewportState]);

  const persistCanvasViewport = useCallback(
    (nextViewport: SharedCanvasViewport) => {
      setProjectData((previous) => ({
        ...previous,
        canvas: {
          ...(previous.canvas || {}),
          viewport: nextViewport,
        },
      }));
    },
    [setProjectData]
  );

  const didInitFitRef = useRef(false);
  const didHydrateCanvasViewportRef = useRef(false);
  useEffect(() => {
    if (didHydrateCanvasViewportRef.current) return;
    const savedViewport = projectData.canvas?.viewport;
    if (!savedViewport) return;
    didHydrateCanvasViewportRef.current = true;
    setLiveViewport(savedViewport);
    setZoomValue(savedViewport.zoom);
    setViewport(savedViewport, { duration: 0 });
    setViewportState(savedViewport);
  }, [projectData.canvas?.viewport, setViewport, setViewportState]);

  const handleStyloComposerAction = useCallback(() => {
    const text = composerInput.trim();
    if (isStyloSending && !text) {
      setStyloCancelRequest((prev) => prev + 1);
      return;
    }
    if (!text) {
      toggleStyloFirstMode();
      return;
    }
    setComposerInput("");
    setStyloSubmitRequest({ id: Date.now(), projectId: styloProjectId, text });
  }, [composerInput, isStyloSending, styloProjectId, toggleStyloFirstMode]);

  useEffect(() => {
    if (didInitFitRef.current) return;
    if (projectData.canvas?.viewport) return;
    if (!nodes.length) return;
    fitView({ padding: 0.2, duration: 0 });
    didInitFitRef.current = true;
  }, [fitView, nodes.length, projectData.canvas?.viewport]);

  useEffect(() => {
    const videoNodes = nodes.filter(
      (node) =>
        node.type === "wanReferenceVideoGen" ||
        node.type === "seedanceVideoGen"
    );
    videoNodes.forEach((node) => {
      const data = node.data as VideoGenNodeData & { ratio?: string };
      if (!data?.videoUrl) return;
      const alreadyAdded = globalAssetHistory.some(
        (item) => item.type === "video" && (item.sourceId === node.id || item.src === data.videoUrl)
      );
      if (alreadyAdded) return;
      addToGlobalHistory({
        type: "video",
        src: data.videoUrl,
        prompt: "Video Output",
        model: data.model,
        aspectRatio: data.aspectRatio || data.ratio,
        sourceId: node.id,
      });
    });
  }, [addToGlobalHistory, globalAssetHistory, nodes]);

  useEffect(() => {
    const selectedNode = nodes.find((node) => node.selected) || null;
    const nextCurrentNodeId = selectedNode?.id || null;
    if (nextCurrentNodeId !== currentNodeId) {
      setCurrentNode(nextCurrentNodeId);
    }
  }, [currentNodeId, nodes, setCurrentNode]);

  const handleZoomChange = useCallback(
    (value: number) => {
      const nextZoom = Math.min(maxZoom, Math.max(minZoom, value));
      setZoomValue(nextZoom);
      void zoomTo(nextZoom, { duration: 120 });
    },
    [maxZoom, minZoom, zoomTo]
  );

  const handleSharedViewportChange = useCallback(
    (nextViewport: SharedCanvasViewport, options?: { commit?: boolean }) => {
      if (!options?.commit) return;
      setLiveViewport(nextViewport);
      setZoomValue(nextViewport.zoom);
      setViewportState(nextViewport);
      if (activePinoard) return;
      persistCanvasViewport(nextViewport);
    },
    [activePinoard, persistCanvasViewport, setViewportState]
  );

  const handleToggleLock = useCallback(() => {
    setIsLocked((prev) => !prev);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const syncHost = () => {
      setFoundationViewportHost(document.getElementById("script-foundation-viewport-host"));
      setFoundationViewportTrayHost(document.getElementById("script-foundation-viewport-tray-host"));
    };
    syncHost();
    const frame = window.requestAnimationFrame(syncHost);
    return () => window.cancelAnimationFrame(frame);
  }, [editingScriptNodeId]);

  const handleToggleReadingMode = useCallback(() => {
    setReadingMode(readingMode === "identity" ? "full" : "identity");
  }, [readingMode, setReadingMode]);

  const handleCollapseCanvasCards = useCallback(() => {
    setReadingMode("identity");
  }, [setReadingMode]);

  const handleRestoreCanvasCards = useCallback(() => {
    setReadingMode("full");
  }, [setReadingMode]);

  const sharedCanvasControls = useMemo<SharedCanvasControls>(
    () => ({
      viewport: liveViewport,
      minZoom,
      maxZoom,
      isLocked,
      snapToGrid,
      showMiniMap,
      onViewportChange: handleSharedViewportChange,
      onViewportApiChange: () => {},
      onAlignmentGuideChange: setSnapGuide,
    }),
    [handleSharedViewportChange, isLocked, liveViewport, maxZoom, minZoom, showMiniMap, snapToGrid]
  );

  const flowSurface = useFlowSurface({
    projectData,
    setProjectData,
    onOpenScriptDocument: handleOpenScriptDocument,
    onOpenLookbook: (nodeId) => {
      setActivePinoard(null);
      setActiveLookbookNodeId(nodeId);
    },
    onOpenPinoard: handleOpenPinoard,
    focusedWrapperId: activePinoard?.pinoardId || null,
    canvasControls: sharedCanvasControls,
    screenToFlowPosition,
    isActive: true,
    isWritingEditorOpen: editingScriptNodeId !== null || activePinoard !== null,
    onCollapseCanvasCards: handleCollapseCanvasCards,
    onRestoreCanvasCards: handleRestoreCanvasCards,
    onOpenAgent: () => setStyloOpenRequest((count) => count + 1),
    onSubmitAgentMessage: (text) => setStyloSubmitRequest({ id: Date.now(), projectId: styloProjectId, text }),
    agentComposerValue: composerInput,
    onAgentComposerChange: setComposerInput,
    onAgentComposerAction: handleStyloComposerAction,
    isAgentSending: isStyloSending,
    isAgentFirstMode: isStyloFirstMode,
    onOpenProjectSettingsPanel: (panel, assetsSection) => openProjectSettingsPanel(panel, assetsSection),
    onOpenVisualLab: (key = "glassLab") => onOpenModule?.(key),
    pendingScriptReviewNodeIds,
    activeDockTray,
    onDockTrayChange: setActiveDockTray,
  });

  const focusedPinoardNodeSignature = activePinoard
    ? flowSurface.nodes.map((node) => node.id).sort().join("|")
    : "";

  useEffect(() => {
    const focusedPinoardId = activePinoard?.pinoardId || null;
    if (focusedPinoardId) {
      if (!focusedPinoardIdRef.current) {
        pinoardEntryViewportRef.current = getViewport();
      }
      focusedPinoardIdRef.current = focusedPinoardId;
      const frame = window.requestAnimationFrame(() => {
        const focusedNodes = flowSurface.nodes.filter((node) => node.hidden !== true);
        if (!focusedNodes.length) return;
        void fitView({
          nodes: focusedNodes,
          padding: 0.16,
          duration: 360,
          minZoom,
          maxZoom: Math.min(maxZoom, 1.2),
        }).then((didFit) => {
          if (!didFit || focusedPinoardIdRef.current !== focusedPinoardId) return;
          const nextViewport = getViewport();
          setLiveViewport(nextViewport);
          setZoomValue(nextViewport.zoom);
          setViewportState(nextViewport);
        });
      });
      return () => window.cancelAnimationFrame(frame);
    }

    if (!focusedPinoardIdRef.current) return;
    focusedPinoardIdRef.current = null;
    const previousViewport = pinoardEntryViewportRef.current;
    pinoardEntryViewportRef.current = null;
    if (!previousViewport) return;
    setLiveViewport(previousViewport);
    setZoomValue(previousViewport.zoom);
    setViewportState(previousViewport);
    void setViewport(previousViewport, { duration: 320 });
  }, [activePinoard?.pinoardId, fitView, focusedPinoardNodeSignature, flowSurface.nodes, getViewport, maxZoom, minZoom, setViewport, setViewportState]);

  useEffect(() => {
    if (!activePinoard) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setActivePinoard(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePinoard]);

  const nodeLongPressRef = useRef<{
    nodeId: string;
    startX: number;
    startY: number;
    timer: ReturnType<typeof setTimeout>;
    triggered: boolean;
  } | null>(null);

  const cancelNodeLongPress = useCallback(() => {
    if (!nodeLongPressRef.current) return;
    clearTimeout(nodeLongPressRef.current.timer);
    nodeLongPressRef.current = null;
  }, []);

  useEffect(() => cancelNodeLongPress, [cancelNodeLongPress]);

  const handleCanvasPointerDownCapture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" || event.button !== 0 || !flowSurface.onNodeLongPress) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, select, a, [contenteditable='true'], .image-input-control-rail")) return;
    const nodeElement = target.closest<HTMLElement>(".react-flow__node[data-id]");
    const nodeId = nodeElement?.dataset.id;
    if (!nodeId) return;
    cancelNodeLongPress();
    const startX = event.clientX;
    const startY = event.clientY;
    const timer = setTimeout(() => {
      const active = nodeLongPressRef.current;
      const node = flowSurface.nodes.find((candidate) => candidate.id === nodeId);
      if (!active || !node || !flowSurface.onNodeLongPress) return;
      active.triggered = true;
      flowSurface.onNodeLongPress({ clientX: startX, clientY: startY }, node);
    }, 520);
    nodeLongPressRef.current = { nodeId, startX, startY, timer, triggered: false };
  }, [cancelNodeLongPress, flowSurface.nodes, flowSurface.onNodeLongPress]);

  const handleCanvasPointerMoveCapture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const active = nodeLongPressRef.current;
    if (!active || active.triggered) return;
    if (Math.hypot(event.clientX - active.startX, event.clientY - active.startY) > 10) {
      cancelNodeLongPress();
    }
  }, [cancelNodeLongPress]);

  const handleCanvasPointerEndCapture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const didTrigger = nodeLongPressRef.current?.triggered === true;
    cancelNodeLongPress();
    if (didTrigger) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, [cancelNodeLongPress]);

  const effectiveAgentDockWidth = isStyloCollapsed ? 0 : agentDockWidth;
  const canvasNodeRects = useMemo(
    () => flowSurface.nodes
      .filter((node) => node.hidden !== true)
      .map((node) => getNodesBounds([node])),
    [flowSurface.nodes, getNodesBounds]
  );

  const evaluateCanvasContentLocation = useCallback(
    (nextViewport: SharedCanvasViewport) => {
      const host = canvasViewportRef.current;
      if (!host) return;
      const bounds = host.getBoundingClientRect();
      const location = locateCanvasContent({
        viewport: nextViewport,
        canvasWidth: bounds.width,
        canvasHeight: bounds.height,
        nodeRects: canvasNodeRects,
        leftInset: effectiveAgentDockWidth,
        bottomInset: 84,
      });
      const nextDirection = location.status === "offscreen" ? location.direction : null;
      setCanvasContentDirection((current) => current === nextDirection ? current : nextDirection);
    },
    [canvasNodeRects, effectiveAgentDockWidth]
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => evaluateCanvasContentLocation(getViewport()));
    return () => window.cancelAnimationFrame(frame);
  }, [evaluateCanvasContentLocation, getViewport]);

  useEffect(() => {
    const host = canvasViewportRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => evaluateCanvasContentLocation(getViewport()));
    observer.observe(host);
    return () => observer.disconnect();
  }, [evaluateCanvasContentLocation, getViewport]);

  const handleReturnToCanvasContent = useCallback(() => {
    const targetNodes = flowSurface.nodes.filter((node) => node.hidden !== true);
    if (!targetNodes.length) return;
    setCanvasContentDirection(null);
    void fitView({
      nodes: targetNodes,
      padding: 0.22,
      duration: 360,
      minZoom,
      maxZoom: Math.min(maxZoom, 1.35),
    }).then((didFit) => {
      if (!didFit) return;
      const nextViewport = getViewport();
      handleSharedViewportChange(nextViewport, { commit: true });
      evaluateCanvasContentLocation(nextViewport);
    });
  }, [evaluateCanvasContentLocation, fitView, flowSurface.nodes, getViewport, handleSharedViewportChange, maxZoom, minZoom]);

  const getToolbarNodePosition = useCallback(
    (fallback: XYPosition): XYPosition => {
      if (typeof window === "undefined") return fallback;
      return screenToFlowPosition({
        x: window.innerWidth / 2,
        y: Math.max(120, window.innerHeight / 2 - 160),
      });
    },
    [screenToFlowPosition]
  );

  const handleFlowAddNode = useCallback(
    (type: NodeType, fallback: XYPosition) => {
      const position = getToolbarNodePosition(fallback);
      return flowSurface.actions?.addNode?.(type, position) ?? null;
    },
    [getToolbarNodePosition, flowSurface.actions]
  );

  const handleFlowExport = useCallback(() => {
    void flowSurface.actions?.exportNodeFlow?.();
  }, [flowSurface.actions]);

  const handleFlowRunAll = useCallback(() => {
    void flowSurface.actions?.runAll?.();
  }, [flowSurface.actions]);

  const handleFileImport = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      readNodeFlowImportFile(file)
        .then((data) => {
          flowSurface.actions?.importNodeFlow?.(data);
        })
        .catch((err) => {
          console.error("Failed to import Flow package", err);
          alert("Failed to import Stylo project package");
        });
      event.target.value = "";
    },
    [flowSurface.actions]
  );

  const activeTheme = useMemo(() => THEME_PRESETS[bgTheme], [bgTheme]);
  const hasUserFlowNodes = useMemo(
    () => flowSurface.nodes.some((node) => {
      const data = node.data as Record<string, unknown> | undefined;
      return !data?.foundationRole;
    }),
    [flowSurface.nodes]
  );
  const patternDefinitions = useMemo(
    () => getPatternDefinitions(activeTheme, activeTheme.scheme === "light" ? 1.45 : 1),
    [activeTheme]
  );
  const patternPreviewDefinitions = useMemo(
    () => getPatternDefinitions(activeTheme, activeTheme.scheme === "light" ? 2.2 : 1.2),
    [activeTheme]
  );
  const patternOptions: { key: PatternKey; label: string }[] = [
    { key: "dots", label: "Dots" },
    { key: "grid", label: "Grid" },
    { key: "cross", label: "Cross" },
    { key: "lines", label: "Lines" },
    { key: "diagonal", label: "Diagonal" },
    { key: "none", label: "None" },
  ];
  const miniMapTheme = useMemo(
    () => ({
      surface: activeTheme.panelStrong,
      border: activeTheme.border,
      shadow: activeTheme.panelShadowStrong,
      mask: activeTheme.scheme === "light" ? "rgba(255, 255, 255, 0.56)" : "rgba(6, 8, 10, 0.48)",
      maskStroke: activeTheme.scheme === "light" ? "rgba(24, 24, 23, 0.16)" : "rgba(255, 255, 255, 0.14)",
      node: activeTheme.accent,
      nodeStroke: activeTheme.accentStrong,
    }),
    [activeTheme]
  );

  const handleMiniMapJump = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const targetNodes = flowSurface.nodes.filter((node) => node.hidden !== true);
      if (!targetNodes.length) return;
      const host = canvasViewportRef.current;
      if (!host) return;

      const miniMapBounds = event.currentTarget.getBoundingClientRect();
      const canvasBounds = host.getBoundingClientRect();
      const nodeBounds = getNodesBounds(targetNodes);
      if (!nodeBounds.width || !nodeBounds.height || !canvasBounds.width || !canvasBounds.height) return;

      const padding = Math.max(80, Math.min(nodeBounds.width, nodeBounds.height) * 0.12);
      const paddedBounds = {
        x: nodeBounds.x - padding,
        y: nodeBounds.y - padding,
        width: nodeBounds.width + padding * 2,
        height: nodeBounds.height + padding * 2,
      };
      const ratioX = Math.min(1, Math.max(0, (event.clientX - miniMapBounds.left) / miniMapBounds.width));
      const ratioY = Math.min(1, Math.max(0, (event.clientY - miniMapBounds.top) / miniMapBounds.height));
      const targetX = paddedBounds.x + paddedBounds.width * ratioX;
      const targetY = paddedBounds.y + paddedBounds.height * ratioY;
      const currentViewport = getViewport();
      const nextViewport = {
        x: canvasBounds.width / 2 - targetX * currentViewport.zoom,
        y: canvasBounds.height / 2 - targetY * currentViewport.zoom,
        zoom: currentViewport.zoom,
      };

      void Promise.resolve(setViewport(nextViewport, { duration: 260 })).then(() => {
        const committedViewport = getViewport();
        handleSharedViewportChange(committedViewport, { commit: true });
        evaluateCanvasContentLocation(committedViewport);
      });
    },
    [evaluateCanvasContentLocation, flowSurface.nodes, getNodesBounds, getViewport, handleSharedViewportChange, setViewport]
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const mapping: Record<string, string> = {
      "bg-base": activeTheme.bg,
      "bg-panel": activeTheme.panel,
      "bg-elevated": activeTheme.panelStrong,
      "bg-overlay": activeTheme.panelMuted,
      "bg-muted": activeTheme.panelSoft,
      "border-subtle": activeTheme.border,
      "border-strong": activeTheme.borderStrong,
      "text-primary": activeTheme.textPrimary,
      "text-secondary": activeTheme.textSecondary,
      "accent-blue": activeTheme.accent,
      "accent-green": "#10b981",
      "shadow-soft": activeTheme.panelShadow,
      "shadow-strong": activeTheme.panelShadowStrong,
      "dot-weak": activeTheme.patternSoft,
      "dot-strong": activeTheme.pattern,
      "app-bg": activeTheme.bg,
      "app-panel": activeTheme.panel,
      "app-panel-strong": activeTheme.panelStrong,
      "app-panel-muted": activeTheme.panelMuted,
      "app-panel-soft": activeTheme.panelSoft,
      "app-border": activeTheme.border,
      "app-border-strong": activeTheme.borderStrong,
      "app-text-primary": activeTheme.textPrimary,
      "app-text-secondary": activeTheme.textSecondary,
      "app-text-muted": activeTheme.textMuted,
      "app-accent": activeTheme.accent,
      "app-accent-strong": activeTheme.accentStrong,
      "app-accent-soft": activeTheme.accentSoft,
      "app-shadow": activeTheme.panelShadow,
      "app-shadow-strong": activeTheme.panelShadowStrong,
      "app-pattern": activeTheme.pattern,
      "node-bg": activeTheme.panel,
      "node-bg-selected": activeTheme.panelStrong,
      "node-bg-gradient": activeTheme.nodeBgGradient,
      "node-accent": activeTheme.accent,
      "node-text-primary": activeTheme.textPrimary,
      "node-text-secondary": activeTheme.textSecondary,
      "node-textarea-bg": activeTheme.panelMuted,
      "node-border": activeTheme.border,
      "node-border-strong": activeTheme.borderStrong,
      "node-surface": activeTheme.panelMuted,
      "node-surface-strong": activeTheme.panelSoft,
      "node-shadow": activeTheme.nodeShadow,
      "node-shadow-strong": activeTheme.nodeShadowStrong,
      "node-header-bg": activeTheme.nodeHeaderBg,
      "stylo-wordmark-glow": activeTheme.accentSoft,
    };
    Object.entries(mapping).forEach(([key, value]) => {
      root.style.setProperty(`--${key}`, value);
    });
    root.style.colorScheme = activeTheme.scheme;
  }, [activeTheme]);

  const backgroundStyle = useMemo(() => {
    const base = activeTheme.bg;
    return {
      backgroundColor: base,
      backgroundImage: "none",
      backgroundSize: "auto",
      backgroundPosition: "0 0",
      baseColor: base,
    };
  }, [activeTheme.bg]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      const base = (backgroundStyle as any).baseColor || activeTheme.bg;
      document.body.style.background = base;
      document.documentElement.style.background = base;
    }
  }, [activeTheme.bg, backgroundStyle]);

  useEffect(() => {
    if (!showThemeModal) return;

    const updateAnchor = () => {
      if (typeof document === "undefined") return;
      const anchor = document.querySelector("[data-theme-trigger]") as HTMLElement | null;
      if (anchor) {
        setThemeAnchor(anchor.getBoundingClientRect());
      }
    };

    updateAnchor();
    window.addEventListener("resize", updateAnchor);
    window.addEventListener("scroll", updateAnchor, true);

    return () => {
      window.removeEventListener("resize", updateAnchor);
      window.removeEventListener("scroll", updateAnchor, true);
    };
  }, [showThemeModal]);

  const themeModalStyle = useMemo<React.CSSProperties>(() => {
    if (typeof window === "undefined" || !themeAnchor) {
      return {
        right: 24,
        bottom: 80,
        width: "min(360px,calc(100vw-24px))",
      };
    }

    const viewportPadding = 12;
    const width = Math.min(360, window.innerWidth - viewportPadding * 2);
    const left = Math.max(
      viewportPadding,
      Math.min(themeAnchor.left + themeAnchor.width / 2 - width / 2, window.innerWidth - viewportPadding - width)
    );
    const bottom = Math.max(16, window.innerHeight - themeAnchor.top + 12);

    return {
      left,
      bottom,
      width,
      maxWidth: `calc(100vw - ${viewportPadding * 2}px)`,
    };
  }, [themeAnchor]);

  const accountThemeControls = useMemo(
    () => (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--app-text-muted)]">Theme</span>
          <span className="truncate text-[10px] font-semibold text-[var(--app-text-secondary)]">{activeTheme.label}</span>
        </div>
        <div className="grid grid-cols-6 gap-1.5">
          {(Object.keys(THEME_PRESETS) as ThemeKey[]).map((key) => {
            const theme = THEME_PRESETS[key];
            const isActive = bgTheme === key;
            return (
              <button
                key={key}
                type="button"
                title={theme.label}
                aria-label={theme.label}
                data-active={isActive}
                onClick={() => setBgTheme(key)}
                className="theme-account-swatch"
                style={{
                  borderColor: isActive ? theme.accentStrong : undefined,
                  background: `linear-gradient(135deg, ${theme.bg} 0 34%, ${theme.panel} 34% 67%, ${theme.accent} 67%)`,
                }}
              />
            );
          })}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {patternOptions.map((item) => (
            <button
              key={item.key}
              type="button"
              title={item.label}
              data-active={bgPattern === item.key}
              onClick={() => setBgPattern(item.key)}
              className="theme-account-pattern"
              style={
                item.key === "none"
                  ? {
                      background: `linear-gradient(180deg, ${activeTheme.panelStrong}, ${activeTheme.panelMuted})`,
                    }
                  : {
                      backgroundColor: activeTheme.panelStrong,
                      backgroundImage: `linear-gradient(180deg, ${activeTheme.accentSoft}, transparent 70%), ${patternPreviewDefinitions[item.key as Exclude<PatternKey, "none">].image}`,
                      backgroundSize: `100% 100%, ${patternPreviewDefinitions[item.key as Exclude<PatternKey, "none">].size(0.58)}`,
                      backgroundPosition: `0 0, ${patternPreviewDefinitions[item.key as Exclude<PatternKey, "none">].position ?? "0 0"}`,
                    }
              }
            >
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    ),
    [activeTheme, bgPattern, bgTheme, patternOptions, patternPreviewDefinitions]
  );

  const styloGlobalHeader = (
    <StyloAgent
      key={styloProjectId}
      accountScope={accountScope}
      projectId={styloProjectId}
      projectData={projectData}
      config={config}
      setProjectData={setProjectData}
      getAuthToken={getAuthToken}
      syncState={syncState}
      ensureProjectSynced={ensureProjectSynced}
      onOpenStats={() => openProjectSettingsPanel("provider")}
      settingsOpen={showProjectSettings}
      openRequest={styloOpenRequest}
      closeRequest={styloCloseRequest}
      submitRequest={styloSubmitRequest}
      cancelRequest={styloCancelRequest}
      onCollapsedChange={(collapsed) => {
        setIsStyloCollapsed(collapsed);
        if (collapsed) {
          if (isStyloFirstMode) {
            setIsStyloFirstManual(false);
          }
        }
      }}
      onDockFrameChange={({ dockWidth }) => setAgentDockWidth(dockWidth)}
      onSendingChange={setIsStyloSending}
      onScriptEditProposals={handleAgentScriptEditProposals}
      renderCollapsedTrigger
      agentFirstMode={isStyloFirstMode}
      showUsageBadge={false}
      allowLegacyConversationMigration={false}
      conversationResetToken={projectResetToken}
      titleStatus={
        syncState ? (
          <SyncStatusBanner syncState={syncState} isSignedIn={!!isSignedIn} />
        ) : null
      }
    />
  );

  return (
    <div className="h-full w-full flex flex-col app-text-primary" style={backgroundStyle}>
      <div
        ref={canvasViewportRef}
        className="flex-1 relative node-flow-canvas"
        data-zoomed={zoomValue > 1}
        data-connecting={false}
        data-wrapper-focus={editingScriptNodeId !== null ? "manus" : activePinoard !== null ? "pinoard" : undefined}
        style={backgroundStyle}
        onPointerDownCapture={handleCanvasPointerDownCapture}
        onPointerMoveCapture={handleCanvasPointerMoveCapture}
        onPointerUpCapture={handleCanvasPointerEndCapture}
        onPointerCancelCapture={handleCanvasPointerEndCapture}
      >
        <CanvasBackgroundField
          pattern={bgPattern}
          baseColor={activeTheme.bg}
          primaryColor={activeTheme.pattern}
          secondaryColor={activeTheme.patternSoft}
          accentColor={activeTheme.accentSoft}
        />
        {flowSurface.underlays}
        <ReactFlow
          nodes={flowSurface.nodes}
          edges={flowSurface.edges}
          onNodesChange={flowSurface.onNodesChange}
          onEdgesChange={flowSurface.onEdgesChange}
          onConnect={flowSurface.onConnect}
          onConnectStart={flowSurface.onConnectStart}
          onConnectEnd={flowSurface.onConnectEnd}
          onBeforeDelete={flowSurface.onBeforeDelete}
          onNodeClick={flowSurface.onNodeClick}
          onNodeDoubleClick={flowSurface.onNodeDoubleClick}
          onNodeContextMenu={flowSurface.onNodeContextMenu}
          onNodeDragStart={flowSurface.onNodeDragStart}
          onNodeDrag={flowSurface.onNodeDrag}
          onNodeDragStop={flowSurface.onNodeDragStop}
          onMove={(_, vp) => evaluateCanvasContentLocation(vp)}
          onMoveEnd={(_, vp) => {
            evaluateCanvasContentLocation(vp);
            handleSharedViewportChange(vp, { commit: true });
          }}
          minZoom={minZoom}
          maxZoom={maxZoom}
          nodesDraggable={flowSurface.nodesDraggable ?? !isLocked}
          nodesConnectable={flowSurface.nodesConnectable ?? !isLocked}
          elementsSelectable={flowSurface.elementsSelectable ?? !isLocked}
          panOnDrag={!isLocked}
          panOnScroll={!isLocked}
          panOnScrollMode={flowSurface.panOnScrollMode ?? PanOnScrollMode.Free}
          zoomOnScroll={false}
          zoomOnPinch={!isLocked}
          zoomOnDoubleClick={!isLocked}
          nodeTypes={flowSurface.nodeTypes}
          edgeTypes={flowSurface.edgeTypes}
          connectionMode={ConnectionMode.Loose}
          connectionLineType={flowSurface.connectionLineType ?? ConnectionLineType.Bezier}
          defaultViewport={liveViewport}
          connectionLineStyle={flowSurface.connectionLineStyle}
          onlyRenderVisibleElements={flowSurface.onlyRenderVisibleElements}
          proOptions={{ hideAttribution: true }}
          data-canvas-surface="flow"
        >
          {showMiniMap && !activePinoard && (
            <div
              className="nodeflow-minimap-drawer"
              data-open={showMiniMap}
              style={{
                "--nodeflow-minimap-bg": miniMapTheme.surface,
                "--nodeflow-minimap-border": miniMapTheme.border,
                "--nodeflow-minimap-shadow": miniMapTheme.shadow,
              } as React.CSSProperties}
            >
              <MiniMap
                className="nodeflow-minimap"
                maskColor={miniMapTheme.mask}
                maskStrokeColor={miniMapTheme.maskStroke}
                maskStrokeWidth={1.2}
                nodeStrokeColor={miniMapTheme.nodeStroke}
                nodeColor={miniMapTheme.node}
              />
              <button
                type="button"
                className="nodeflow-minimap-hitbox"
                aria-label="跳转到小地图位置"
                title="跳转到小地图位置"
                onClick={handleMiniMapJump}
              />
            </div>
          )}
          {flowSurface.miniMap}
        </ReactFlow>
        {flowSurface.overlays}

        {activePinoard ? (
          <nav className="wrapper-focus-toolbar" aria-label="Pinoard 操作">
            <button type="button" onClick={handleAddPinoardNote} aria-label="新增文本节点" title="新增文本节点">
              <Plus size={17} weight="regular" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setStyloOpenRequest((count) => count + 1)} aria-label="打开 Stylo Agent" title="Stylo Agent">
              <ChatCenteredDots size={17} weight="regular" aria-hidden="true" />
            </button>
            <span aria-hidden="true" />
            <button type="button" onClick={() => setActivePinoard(null)} aria-label="退出 Pinoard 聚焦视图" title="返回完整 Flow">
              <X size={17} weight="regular" aria-hidden="true" />
            </button>
          </nav>
        ) : null}

        {!activePinoard && !hasUserFlowNodes ? (
          <div className="canvas-empty-state" style={{ left: effectiveAgentDockWidth }} role="status">
            <span>Flow 从节点开始</span>
            <strong>创建第一个节点</strong>
            <button type="button" onClick={() => handleFlowAddNode("pinoard", { x: 100, y: 100 })}>
              <Plus size={15} strokeWidth={1.8} aria-hidden="true" />
              <span>创建 Pinoard</span>
            </button>
          </div>
        ) : null}

        {!activePinoard && canvasContentDirection && hasUserFlowNodes ? (
          <CanvasContentLocator
            direction={canvasContentDirection}
            leftInset={effectiveAgentDockWidth}
            onReturn={handleReturnToCanvasContent}
          />
        ) : null}

        {snapToGrid && !activePinoard ? (
          <EdgeAlignmentGuides guide={snapGuide} viewport={liveViewport} />
        ) : null}

      </div>

      {styloGlobalHeader}

      <FloatingActionBar
        onAddText={() => handleFlowAddNode("text", { x: 100, y: 100 })}
        onAddIdentityCard={() => handleFlowAddNode("lookbook", { x: 220, y: 160 })}
        onAddImage={() => handleFlowAddNode("imageInput", { x: 200, y: 100 })}
        onAddAudio={() => handleFlowAddNode("audioInput", { x: 220, y: 120 })}
        onAddVideo={() => handleFlowAddNode("videoInput", { x: 240, y: 140 })}
        onAddPdf={() => handleFlowAddNode("pdfInput", { x: 260, y: 160 })}
        onAddNanoBananaImageGen={() => handleFlowAddNode("nanoBananaImageGen", { x: 410, y: 110 })}
        onAddWanImageGen={() => handleFlowAddNode("wanImageGen", { x: 420, y: 120 })}
        onAddViduVideoGen={() => handleFlowAddNode("viduVideoGen", { x: 510, y: 110 })}
        onAddWanReferenceVideoGen={() => handleFlowAddNode("wanReferenceVideoGen", { x: 540, y: 140 })}
        onAddSeedanceVideoGen={() => handleFlowAddNode("seedanceVideoGen", { x: 560, y: 160 })}
        onImport={() => fileInputRef.current?.click()}
        onExport={handleFlowExport}
        onRun={handleFlowRunAll}
        floating={false}
        syncIndicator={syncIndicator}
        onResetProject={onResetProject}
        onSignOut={onSignOut}
        onAssetLoad={onAssetLoad}
        accountInfo={accountInfo ? {
          ...accountInfo,
          onOpenAccountWorkspace: () => setAccountWorkspaceView("projects"),
          onOpenUserSquare: () => setAccountWorkspaceView("square"),
        } : undefined}
        onOpenSettings={() => openProjectSettingsPanel("provider")}
        accountThemeControls={accountThemeControls}
        showGlobalAccountTrigger
        globalAccountHostId="script-foundation-account-host"
        showToolbar={false}
        variant="embedded"
      />

      {foundationViewportHost
        ? createPortal(
            <ViewportControls
              variant="dock"
              zoom={zoomValue}
              minZoom={minZoom}
              maxZoom={maxZoom}
              onZoomChange={handleZoomChange}
              isLocked={isLocked}
              onToggleLock={handleToggleLock}
              showMiniMap={showMiniMap}
              onToggleMiniMap={() => setShowMiniMap((prev) => !prev)}
              readingMode={readingMode}
              onToggleReadingMode={handleToggleReadingMode}
            />,
            foundationViewportHost
          )
        : null}

      <ProjectSettingsPanel
        key={styloProjectId}
        accountScope={accountScope}
        projectId={styloProjectId}
        isOpen={showProjectSettings}
        onClose={() => setShowProjectSettings(false)}
        leftOffset={agentDockWidth}
        projectData={projectData}
        setProjectData={setProjectData}
        config={config}
        setConfig={setConfig}
        isSignedIn={isSignedIn}
        getAuthToken={getAuthToken}
        accountSession={accountSession}
        syncState={syncState}
        onOpenLanding={onOpenLanding}
        onResetProject={onResetProject}
        requestedPanel={projectSettingsPanel}
        requestedAssetsSection={projectSettingsAssetsSection}
        onOrganizeFoundationScaffold={flowSurface.actions?.organizeFoundationScaffold}
        onSetFoundationNodeView={flowSurface.actions?.setFoundationNodeView}
        foundationNodeView={flowSurface.actions?.foundationNodeView}
        onOpenVisualLab={(key = "glassLab") => onOpenModule?.(key)}
      />
      {accountWorkspaceView && accountSession && accountInfo ? (
        <AccountWorkspace
          isOpen
          initialView={accountWorkspaceView}
          onClose={() => setAccountWorkspaceView(null)}
          accountSession={accountSession}
          projectData={projectData}
          setProjectData={setProjectData}
          onDeleteCloudProject={onDeleteFlowProject}
          accountInfo={{
            name: accountInfo.name || accountInfo.email || "Stylo User",
            username: accountInfo.username,
            email: accountInfo.email,
            avatarUrl: accountInfo.avatarUrl,
          }}
        />
      ) : null}
      {editingScriptNodeId !== null ? (
        <ManusPanel
          projectData={projectData}
          setProjectData={setProjectData}
          initialScriptNodeId={editingScriptNodeId}
          isStyloOpen={!isStyloCollapsed}
          agentDockWidth={effectiveAgentDockWidth}
          agentScriptEditProposals={agentScriptEditProposals}
          onResolveAgentScriptEditProposal={resolveAgentScriptEditProposal}
          onCommitScriptDocument={commitScriptDocument}
          onDeleteLookbookIdentity={deleteLookbookIdentity}
          onSplitScriptDocument={splitScriptDocument}
          onOpenLookbook={(identityNodeId) => {
            setEditingScriptNodeId(null);
            setActiveLookbookNodeId(identityNodeId);
          }}
          onOpenStylo={() => setStyloOpenRequest((count) => count + 1)}
          onSubmitToStylo={(text, uiContext) => setStyloSubmitRequest({ id: Date.now(), projectId: styloProjectId, text, uiContext })}
          onClose={() => {
            setEditingScriptNodeId(null);
          }}
        />
      ) : null}
      {activeLookbookNodeId !== null ? (
        <LookbookStudioPanel
          projectData={projectData}
          setProjectData={setProjectData}
          identityNodeId={activeLookbookNodeId}
          onClose={() => setActiveLookbookNodeId(null)}
        />
      ) : null}
      <Toast />
      <AnnotationModal />
      {showThemeModal && (
        <>
          <div className="theme-modal-backdrop fixed inset-0 z-50" onClick={() => setShowThemeModal(false)} />
          <div
            className="theme-modal fixed z-50 max-h-[min(58dvh,520px)] overflow-x-hidden overflow-y-auto rounded-[24px] p-3"
            style={themeModalStyle}
          >
            <div className="flex items-start gap-4">
              <div>
                <div className="theme-modal-eyebrow">Workspace Styling</div>
                <div className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-[var(--app-text-primary)]">主题与样式</div>
                <p className="mt-1 max-w-[30ch] text-[11px] leading-5 text-[var(--app-text-secondary)]">
                  调整底色、表面层次和背景纹理。
                </p>
              </div>
            </div>
            <div className="mt-4">
              <div className="mb-2 text-[10px] uppercase tracking-[0.24em] app-text-muted">颜色主题</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(Object.keys(THEME_PRESETS) as ThemeKey[]).map((key) => {
                  const theme = THEME_PRESETS[key];
                  const isActive = bgTheme === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setBgTheme(key)}
                      className="theme-preset-card flex min-h-[146px] flex-col rounded-[16px] border px-2.5 py-2.5 text-left transition"
                      data-active={isActive}
                      style={isActive ? {
                        borderColor: theme.accentStrong,
                        boxShadow: `0 8px 20px ${theme.accentSoft}`,
                        background: `linear-gradient(180deg, ${theme.panelSoft}, ${theme.panelMuted})`,
                      } : undefined}
                    >
                      <div className="relative min-h-[48px]">
                        <div className={isActive ? "pr-16" : undefined}>
                          <div className="text-[13px] font-semibold tracking-[-0.02em] text-[var(--app-text-primary)]">{theme.label}</div>
                          <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-[var(--app-text-muted)]">{theme.description}</div>
                        </div>
                        {isActive && (
                          <span
                            className="absolute right-0 top-0 rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.16em]"
                            style={{ color: theme.accentStrong, background: theme.accentSoft }}
                          >
                            Active
                          </span>
                        )}
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-1.5">
                        <span className="h-6 rounded-[10px] border border-white/5" style={{ background: theme.bg }} />
                        <span className="h-6 rounded-[10px] border border-white/5" style={{ background: theme.panel }} />
                        <span className="h-6 rounded-[10px] border border-white/5" style={{ background: theme.accent }} />
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-1.5 text-[8px] uppercase tracking-[0.14em] app-text-muted">
                        <span>Base</span>
                        <span>Surface</span>
                        <span style={{ color: isActive ? theme.accentStrong : undefined }}>Accent</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-4">
              <div className="mb-2 text-[10px] uppercase tracking-[0.24em] app-text-muted">图案</div>
              <div className="grid grid-cols-2 gap-2">
                {patternOptions.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setBgPattern(item.key)}
                    className="theme-pattern-card flex flex-col gap-1.5 rounded-[14px] border px-2.5 py-2 text-left transition"
                    data-active={bgPattern === item.key}
                    style={bgPattern === item.key ? {
                      borderColor: activeTheme.accentStrong,
                      boxShadow: `0 6px 16px ${activeTheme.accentSoft}`,
                    } : undefined}
                  >
                    <span
                      className="theme-pattern-preview h-7 rounded-[10px] border border-white/5"
                      style={item.key === "none"
                        ? {
                            background: `linear-gradient(180deg, ${activeTheme.panelStrong}, ${activeTheme.panelMuted})`,
                          }
                        : {
                            backgroundColor: activeTheme.panelStrong,
                            backgroundImage: `linear-gradient(180deg, ${activeTheme.accentSoft}, transparent 70%), ${patternPreviewDefinitions[item.key as Exclude<PatternKey, "none">].image}`,
                            backgroundSize: `100% 100%, ${patternPreviewDefinitions[item.key as Exclude<PatternKey, "none">].size(0.62)}`,
                            backgroundPosition: `0 0, ${patternPreviewDefinitions[item.key as Exclude<PatternKey, "none">].position ?? "0 0"}`,
                          }}
                    />
                    <span className="text-[12px] font-medium text-[var(--app-text-primary)]">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".stylo.zip,.qalam.zip,.zip,.json,application/json,application/zip"
        className="hidden"
        onChange={handleFileImport}
      />
    </div>
  );
};

export const CreativeWorkspace: React.FC<CreativeWorkspaceProps> = (props) => {
  return (
    <ReactFlowProvider>
      <CreativeWorkspaceInner {...props} />
    </ReactFlowProvider>
  );
};
