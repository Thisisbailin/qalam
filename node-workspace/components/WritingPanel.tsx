import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Reorder, useDragControls } from "framer-motion";
import {
  ArrowCounterClockwise,
  CaretLeft,
  CaretRight,
  ChatCenteredDots,
  Check,
  Clipboard,
  Copy,
  DotsSixVertical,
  PaperPlaneTilt,
  Scissors,
  TextStrikethrough,
  Trash,
  X,
} from "@phosphor-icons/react";
import type { AgentUiContext } from "../../agents/runtime/types";
import type { ProjectData, ProjectRoleIdentity } from "../../types";
import { projectRolesToLocations } from "../../utils/projectRoles";
import { removeLookbookIdentity } from "../../utils/lookbookIdentities";
import type { NodeFlowNode } from "../types";
import {
  analyzeFountainLines,
  analyzeScreenplay,
  createScreenplayPreview,
  normalizeFountainDocument,
  stripFountainMarkup,
  type ScreenplayKnownIdentity,
} from "../screenplay/fountainEngine";
import {
  classifyIncomingScreenplaySource,
  mergeConcurrentScreenplayDrafts,
  prepareScreenplayDraftForSave,
  screenplayDraftsEqual,
  type PendingScreenplaySave,
} from "../screenplay/saveCoordinator";
import {
  buildScriptLinePatch,
  deriveReviewedScriptBody,
  hasPendingPatchLines,
  type PendingScriptPatch,
  type ScriptPatchLine,
  type ScriptPatchLineStatus,
} from "../screenplay/scriptPatch";
import {
  createBlankScreenplayPageBody,
  ensureScreenplayTitlePage,
  ensureScreenplayPageLineGrid,
  getConnectedScriptPageSequence,
  isScreenplayTitlePageNode,
  reflowConnectedScriptPages,
  reorderConnectedScriptPages,
  SCREENPLAY_PAGE_RELATION,
  splitScreenplayDocumentAtLine,
} from "../screenplay/manusPages";
import {
  parseFountainTitlePage,
  serializeFountainTitlePage,
  type FountainTitlePage,
} from "../screenplay/titlePage";
import { ScreenplayBlockEditor, type ScreenplayCharacterSuggestion } from "./screenplay/ScreenplayBlockEditor";
import {
  ScreenplayHeader,
  ScreenplayIdentityDock,
  ScreenplayInspector,
  type ScreenplayIdentityEntry,
  type ScreenplayPageArrangement,
  type SaveState,
} from "./screenplay/ScreenplayChrome";
import { TranslatorDock } from "./TranslatorDock";
import type {
  AgentScriptEditProposalBatch,
  ScriptDocumentCommit,
  ScriptPageReorderCommit,
  ScriptPageSplitCommit,
} from "./stylo/interactionTypes";
import "../styles/screenplay.css";

type Props = {
  projectData: ProjectData;
  setProjectData: React.Dispatch<React.SetStateAction<ProjectData>>;
  onClose?: () => void;
  initialScriptNodeId?: string | null;
  isStyloOpen?: boolean;
  agentDockWidth?: number;
  isTranslatorOpen?: boolean;
  translatorDockWidth?: number;
  onToggleTranslator?: () => void;
  onCloseTranslator?: () => void;
  agentScriptEditProposals?: AgentScriptEditProposalBatch | null;
  onResolveAgentScriptEditProposal?: (proposalId: string) => void;
  onCommitScriptDocument?: (commit: ScriptDocumentCommit) => void;
  onDeleteLookbookIdentity?: (roleId: string) => void;
  onSplitScriptDocument?: (commit: ScriptPageSplitCommit) => string | null;
  onReorderScriptDocuments?: (commit: ScriptPageReorderCommit) => void;
  onOpenLookbook?: (identityNodeId: string) => void;
  onOpenStylo?: () => void;
  onSubmitToStylo?: (text: string, uiContext?: AgentUiContext) => void;
};

type WritingDraft = {
  title: string;
  body: string;
};

type SelectionCommand = {
  text: string;
  start: number;
  end: number;
  lineIndex: number;
  anchorX: number;
  anchorY: number;
  isAsking: boolean;
  message: string;
};

type ReviewedSnapshot = WritingDraft;

// 胶卷视图上下安全间距：稿纸整体缩放后仍保留呼吸空间，且不产生滚动余量。
const FILMSTRIP_SAFE_TOP = 44;
const FILMSTRIP_SAFE_BOTTOM = 44;

type FilmstripPageItemProps = {
  nodeId: string;
  title: string;
  preview: string;
  pageNumber: number;
  isActive: boolean;
  isDragging: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
};

const FilmstripPageItem: React.FC<FilmstripPageItemProps> = ({
  nodeId,
  title,
  preview,
  pageNumber,
  isActive,
  isDragging,
  onOpen,
  onDragStart,
  onDragEnd,
}) => {
  const dragControls = useDragControls();
  const wasDraggedRef = useRef(false);
  return (
    <Reorder.Item
      value={nodeId}
      dragListener={false}
      dragControls={dragControls}
      dragElastic={0.06}
      dragMomentum={false}
      className={`${isActive ? "is-active" : ""} ${isDragging ? "is-dragging" : ""}`}
      onDragStart={() => {
        wasDraggedRef.current = true;
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      whileDrag={{ scale: 1.02, y: -3 }}
    >
      <button
        type="button"
        className="screenplay-page-filmstrip__page-button"
        onClick={() => {
          // 拖动结束后浏览器可能补发一次 click，吞掉它，避免拖动后误打开稿纸。
          if (wasDraggedRef.current) {
            wasDraggedRef.current = false;
            return;
          }
          onOpen();
        }}
        onPointerDown={(event) => dragControls.start(event)}
        aria-label={`定位到第 ${pageNumber} 张稿纸：${title}`}
      >
        <small>{String(pageNumber).padStart(2, "0")}</small>
        <strong>{title}</strong>
        <span>{preview || "空白稿纸"}</span>
      </button>
      <button
        type="button"
        className="screenplay-page-filmstrip__drag-handle"
        onPointerDown={(event) => dragControls.start(event)}
        aria-label={`拖动第 ${pageNumber} 张稿纸调整顺序`}
        title="拖动调整顺序"
      >
        <DotsSixVertical size={15} weight="bold" aria-hidden="true" />
      </button>
    </Reorder.Item>
  );
};

const ensureFlow = (flow: ProjectData["flow"]): NonNullable<ProjectData["flow"]> => ({
  flowNodes: Array.isArray(flow?.flowNodes) ? flow.flowNodes : [],
  links: Array.isArray(flow?.links) ? flow.links : [],
  graphLinks: Array.isArray(flow?.graphLinks) ? flow.graphLinks : [],
  globalAssetHistory: Array.isArray(flow?.globalAssetHistory) ? flow.globalAssetHistory : [],
  linkStyle: flow?.linkStyle,
  activeView: flow?.activeView,
});

const findScriptNode = (projectData: ProjectData, nodeId?: string | null): NodeFlowNode | null => {
  const nodes = Array.isArray(projectData.flow?.flowNodes) ? projectData.flow.flowNodes : [];
  if (nodeId) {
    const explicit = nodes.find((node) => node.id === nodeId && node.type === "scriptPage");
    return explicit || null;
  }
  return nodes.find((node) => node.type === "scriptPage") || null;
};

const readScriptNode = (
  node: NodeFlowNode | null,
  knownCharacters: ScreenplayKnownIdentity[] = []
): WritingDraft => {
  const data = (node?.data || {}) as { title?: string; text?: string; content?: string };
  const content = typeof data.content === "string" ? data.content : data.text || "";
  const normalizedBody = isScreenplayTitlePageNode(node)
    ? content.replace(/\r\n?/g, "\n")
    : normalizeFountainDocument(content, knownCharacters);
  return {
    title: data.title?.trim() || "剧本文档",
    body: isScreenplayTitlePageNode(node) ? normalizedBody : ensureScreenplayPageLineGrid(normalizedBody),
  };
};

const roleToKnownIdentity = (role: ProjectRoleIdentity): ScreenplayKnownIdentity => ({
  id: role.id,
  name: role.displayName?.trim() || role.name,
  mention: role.mention,
  aliases: [role.name, ...(role.binding?.aliases || []), ...(role.aliases || []).map((alias) => alias.value)],
});

const downloadFountain = (filename: string, content: string) => {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const TITLE_BLOCK_KEY = /^(Title|Author|Draft date|Revision|Contact|Credit|Source|Notes?):/i;

/**
 * Fountain 文件顶部的标题页字段（Title: / Author: 等）不属于正文，
 * 导入时从正文中剥离，标题单独写入稿纸标题。
 */
const stripFountainTitleBlock = (source: string) => {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let cursor = 0;
  while (cursor < lines.length) {
    const trimmed = lines[cursor].trim();
    if (!trimmed) break;
    if (!TITLE_BLOCK_KEY.test(trimmed)) break;
    cursor += 1;
  }
  while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
  return lines.slice(cursor).join("\n");
};

/**
 * 判断用户是否在当前页"开头删除"（页首内容被删/清空）：
 * 这是触发跨页回流的唯一手势。改写字数/替换首行不算。
 */
const didDeletePageStart = (oldBody: string, newBody: string) => {
  const oldLines = oldBody.replace(/\r\n?/g, "\n").split("\n");
  const newLines = newBody.replace(/\r\n?/g, "\n").split("\n");
  const oldFirst = (oldLines[0] || "").trim();
  const newFirst = (newLines[0] || "").trim();
  if (!oldFirst || oldFirst === newFirst) return false;
  return newLines.length < oldLines.length || !newFirst;
};

export const WritingPanel: React.FC<Props> = ({
  projectData,
  setProjectData,
  onClose,
  initialScriptNodeId,
  isStyloOpen = false,
  agentDockWidth = 0,
  isTranslatorOpen = false,
  translatorDockWidth = 0,
  onToggleTranslator,
  onCloseTranslator,
  agentScriptEditProposals = null,
  onResolveAgentScriptEditProposal,
  onCommitScriptDocument,
  onDeleteLookbookIdentity,
  onSplitScriptDocument,
  onReorderScriptDocuments,
  onOpenLookbook,
  onOpenStylo,
  onSubmitToStylo,
}) => {
  const characterRoles = useMemo(
    () => (projectData.roles || []).filter((role) => role.kind === "person"),
    [projectData.roles]
  );
  const sceneRoles = useMemo(
    () => (projectData.roles || []).filter((role) => role.kind === "scene"),
    [projectData.roles]
  );
  const knownCharacterIdentities = useMemo(() => characterRoles.map(roleToKnownIdentity), [characterRoles]);
  const knownSceneIdentities = useMemo(() => sceneRoles.map(roleToKnownIdentity), [sceneRoles]);
  const initialScriptNode = useMemo(
    () => findScriptNode(projectData, initialScriptNodeId),
    [initialScriptNodeId, projectData.flow?.flowNodes]
  );
  const [activeScriptNodeId, setActiveScriptNodeId] = useState<string | null>(initialScriptNode?.id || null);
  const resolvedScriptNode = useMemo(
    () => activeScriptNodeId ? findScriptNode(projectData, activeScriptNodeId) : initialScriptNode,
    [activeScriptNodeId, initialScriptNode, projectData.flow?.flowNodes]
  );
  const scriptNodeCacheRef = useRef<NodeFlowNode | null>(resolvedScriptNode);
  if (resolvedScriptNode) scriptNodeCacheRef.current = resolvedScriptNode;
  const scriptNode = resolvedScriptNode || (
    scriptNodeCacheRef.current?.id === activeScriptNodeId ? scriptNodeCacheRef.current : initialScriptNode
  );
  const pageSequence = useMemo(
    () => getConnectedScriptPageSequence(projectData, scriptNode?.id || activeScriptNodeId || initialScriptNodeId),
    [activeScriptNodeId, initialScriptNodeId, projectData.flow?.flowNodes, projectData.flow?.links, scriptNode?.id]
  );
  const displayPages = useMemo(
    () => pageSequence.length ? pageSequence : scriptNode ? [scriptNode] : [],
    [pageSequence, scriptNode]
  );
  const titlePageNode = useMemo(
    () => displayPages.find(isScreenplayTitlePageNode) || null,
    [displayPages]
  );
  const contentPages = useMemo(
    () => displayPages.filter((node) => !isScreenplayTitlePageNode(node)),
    [displayPages]
  );
  const pageIndex = Math.max(0, pageSequence.findIndex((node) => node.id === scriptNode?.id));
  const isTitlePageActive = isScreenplayTitlePageNode(scriptNode);
  const sourceDraft = useMemo(
    () => readScriptNode(scriptNode, knownCharacterIdentities),
    [knownCharacterIdentities, scriptNode]
  );
  const [loadedNodeId, setLoadedNodeId] = useState<string | null>(scriptNode?.id || null);
  const [draft, setDraft] = useState<WritingDraft>(sourceDraft);
  const draftRef = useRef(draft);
  const lastCommittedRef = useRef<WritingDraft>(sourceDraft);
  const lastObservedSourceRef = useRef<WritingDraft>(sourceDraft);
  const [pendingSave, setPendingSave] = useState<PendingScreenplaySave | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [activeLineIndex, setActiveLineIndex] = useState(0);
  const [navigationRequest, setNavigationRequest] = useState<{ lineIndex: number; id: number } | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [pageArrangement, setPageArrangement] = useState<ScreenplayPageArrangement>("vertical");
  const [filmstripOrder, setFilmstripOrder] = useState<string[]>(() => contentPages.map((node) => node.id));
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
  const filmstripOrderRef = useRef(filmstripOrder);
  const [autoPagination, setAutoPagination] = useState(true);
  const [selectionCommand, setSelectionCommand] = useState<SelectionCommand | null>(null);
  const [pendingPatch, setPendingPatch] = useState<PendingScriptPatch | null>(null);
  const [lastReviewedSnapshot, setLastReviewedSnapshot] = useState<ReviewedSnapshot | null>(null);
  const [externalConflict, setExternalConflict] = useState<WritingDraft | null>(null);
  const previousRoleIdsRef = useRef(new Set((projectData.roles || []).map((role) => role.id)));
  const [identityArrivalQueue, setIdentityArrivalQueue] = useState<string[]>([]);
  const [activeIdentityArrivalId, setActiveIdentityArrivalId] = useState<string | null>(null);
  const [pendingIdentityRemovalId, setPendingIdentityRemovalId] = useState<string | null>(null);
  const dismissedIdentityRemovalIdsRef = useRef(new Set<string>());
  const handledProposalIdsRef = useRef(new Set<string>());
  const shouldActivateCreatedTitlePageRef = useRef(false);
  const pageElementRefs = useRef(new Map<string, HTMLElement>());
  const edgeHoverTimerRef = useRef<number | null>(null);
  const fountainImportInputRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const userEditedRef = useRef(false);
  const pendingReflowFocusRef = useRef<{ nodeId: string; lineIndex: number } | null>(null);
  const [filmstripScale, setFilmstripScale] = useState(1);
  const [filmstripPaperHeight, setFilmstripPaperHeight] = useState(1056);

  useEffect(() => {
    const node = workspaceRef.current;
    if (!node) return;
    const update = () => {
      // 胶卷模式：纸张高度随内容自适应（min-height 1056px），
      // 再按“窗口高度 - 上下安全间距”整体缩放，让整张稿纸占满窗口且不产生滚动。
      const paper = node.querySelector<HTMLElement>(
        ".screenplay-document-stage.is-filmstrip .screenplay-document"
      );
      if (!paper) {
        setFilmstripScale(1);
        setFilmstripPaperHeight(1056);
        return;
      }
      const paperHeight = Math.max(1056, paper.offsetHeight || 1056);
      const available = node.clientHeight - FILMSTRIP_SAFE_TOP - FILMSTRIP_SAFE_BOTTOM;
      const next = Math.min(1, Math.max(0.42, available / paperHeight));
      setFilmstripScale((current) => (Math.abs(current - next) < 0.01 ? current : next));
      setFilmstripPaperHeight((current) =>
        Math.abs(current - paperHeight) < 1 ? current : paperHeight
      );
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [activeScriptNodeId, agentDockWidth, contentPages.length, draft.body, pageArrangement, translatorDockWidth]);

  useEffect(() => {
    if (draggedPageId) return;
    const nextOrder = contentPages.map((node) => node.id);
    filmstripOrderRef.current = nextOrder;
    setFilmstripOrder(nextOrder);
  }, [contentPages, draggedPageId]);

  useEffect(() => {
    if (!scriptNode?.id || titlePageNode) return;
    shouldActivateCreatedTitlePageRef.current = true;
    setProjectData((previous) => ensureScreenplayTitlePage(previous, scriptNode.id).projectData);
  }, [scriptNode?.id, setProjectData, titlePageNode]);

  useEffect(() => {
    if (!titlePageNode || !shouldActivateCreatedTitlePageRef.current) return;
    shouldActivateCreatedTitlePageRef.current = false;
    setActiveScriptNodeId(titlePageNode.id);
  }, [titlePageNode]);

  useEffect(() => {
    if (!initialScriptNodeId) return;
    setActiveScriptNodeId(initialScriptNodeId);
  }, [initialScriptNodeId]);

  const deferredBody = useDeferredValue(draft.body);
  const analysis = useMemo(
    () => analyzeScreenplay(deferredBody, knownCharacterIdentities, knownSceneIdentities),
    [deferredBody, knownCharacterIdentities, knownSceneIdentities]
  );
  const liveLines = useMemo(
    () => analyzeFountainLines(draft.body, knownCharacterIdentities),
    [draft.body, knownCharacterIdentities]
  );
  const activeLine = liveLines[Math.min(activeLineIndex, Math.max(0, liveLines.length - 1))] || {
    index: 0,
    start: 0,
    end: 0,
    raw: "",
    content: "",
    kind: "action" as const,
  };
  const identityEntries = useMemo<ScreenplayIdentityEntry[]>(() => {
    const identityNodeIds = new Map<string, string>();
    (projectData.flow?.flowNodes || []).forEach((node) => {
      if (node.type !== "identityCard" && node.type !== "lookbook") return;
      const identityId = typeof node.data?.identityId === "string" ? node.data.identityId : "";
      if (identityId && !identityNodeIds.has(identityId)) identityNodeIds.set(identityId, node.id);
    });
    return (projectData.roles || []).map((role) => ({
      role,
      identityNodeId: identityNodeIds.get(role.id) || null,
    }));
  }, [projectData.flow?.flowNodes, projectData.roles]);
  const locationSuggestions = useMemo(
    () => Array.from(new Set([...projectRolesToLocations(projectData.roles || []).map((location) => location.name), ...analysis.locations])),
    [analysis.locations, projectData.roles]
  );
  const characterSuggestions = useMemo<ScreenplayCharacterSuggestion[]>(() => {
    return characterRoles.map((role) => ({
      id: role.id,
      name: role.displayName?.trim() || role.name,
      mention: role.mention || role.name,
      status: role.status,
    }));
  }, [characterRoles]);

  useEffect(() => {
    const nextRoleIds = new Set((projectData.roles || []).map((role) => role.id));
    const addedRoleIds = (projectData.roles || [])
      .filter((role) => !previousRoleIdsRef.current.has(role.id))
      .map((role) => role.id);
    previousRoleIdsRef.current = nextRoleIds;
    if (!addedRoleIds.length) return;
    setIdentityArrivalQueue((current) => [
      ...current,
      ...addedRoleIds.filter((roleId) => roleId !== activeIdentityArrivalId && !current.includes(roleId)),
    ]);
  }, [activeIdentityArrivalId, projectData.roles]);

  useEffect(() => {
    if (activeIdentityArrivalId || !identityArrivalQueue.length) return;
    setActiveIdentityArrivalId(identityArrivalQueue[0]);
    setIdentityArrivalQueue((current) => current.slice(1));
  }, [activeIdentityArrivalId, identityArrivalQueue]);

  useEffect(() => {
    if (!activeIdentityArrivalId) return;
    const timer = window.setTimeout(() => setActiveIdentityArrivalId(null), 2800);
    return () => window.clearTimeout(timer);
  }, [activeIdentityArrivalId]);

  const orphanedFountainIdentities = useMemo(
    () => (projectData.roles || []).filter((role) => (
      role.sourceKind === "fountain" && (role.sourceDocumentIds || []).length === 0
    )),
    [projectData.roles]
  );
  const pendingIdentityRemoval = useMemo(
    () => orphanedFountainIdentities.find((role) => role.id === pendingIdentityRemovalId) || null,
    [orphanedFountainIdentities, pendingIdentityRemovalId]
  );

  useEffect(() => {
    const orphanIds = new Set(orphanedFountainIdentities.map((role) => role.id));
    Array.from(dismissedIdentityRemovalIdsRef.current).forEach((roleId) => {
      if (!orphanIds.has(roleId)) dismissedIdentityRemovalIdsRef.current.delete(roleId);
    });
    if (pendingIdentityRemovalId && orphanIds.has(pendingIdentityRemovalId)) return;
    const nextIdentity = orphanedFountainIdentities.find(
      (role) => !dismissedIdentityRemovalIdsRef.current.has(role.id)
    );
    setPendingIdentityRemovalId(nextIdentity?.id || null);
  }, [orphanedFountainIdentities, pendingIdentityRemovalId]);

  const keepOrphanedIdentity = useCallback(() => {
    if (!pendingIdentityRemovalId) return;
    dismissedIdentityRemovalIdsRef.current.add(pendingIdentityRemovalId);
    setPendingIdentityRemovalId(null);
  }, [pendingIdentityRemovalId]);

  const deleteOrphanedIdentity = useCallback(() => {
    if (!pendingIdentityRemovalId) return;
    if (onDeleteLookbookIdentity) onDeleteLookbookIdentity(pendingIdentityRemovalId);
    else setProjectData((previous) => removeLookbookIdentity(previous, pendingIdentityRemovalId));
    dismissedIdentityRemovalIdsRef.current.delete(pendingIdentityRemovalId);
    setPendingIdentityRemovalId(null);
  }, [onDeleteLookbookIdentity, pendingIdentityRemovalId, setProjectData]);

  useEffect(() => {
    draftRef.current = draft;
    if (!screenplayDraftsEqual(draft, lastCommittedRef.current)) setSaveState("idle");
  }, [draft]);

  useEffect(() => {
    if (!scriptNode) return;
    const nextNodeId = scriptNode?.id || null;
    if (nextNodeId === loadedNodeId) return;
    setLoadedNodeId(nextNodeId);
    userEditedRef.current = false;
    setDraft(sourceDraft);
    draftRef.current = sourceDraft;
    lastCommittedRef.current = sourceDraft;
    lastObservedSourceRef.current = sourceDraft;
    setPendingSave(null);
    setSaveState("saved");
    setActiveLineIndex(0);
    if (pendingReflowFocusRef.current?.nodeId === nextNodeId) {
      const focus = pendingReflowFocusRef.current;
      pendingReflowFocusRef.current = null;
      setActiveLineIndex(focus.lineIndex);
      setNavigationRequest({ lineIndex: focus.lineIndex, id: Date.now() });
    }
    setPendingPatch(null);
    setExternalConflict(null);
    setSelectionCommand(null);
  }, [loadedNodeId, scriptNode, sourceDraft]);

  useEffect(() => {
    if (!scriptNode?.id || scriptNode.id !== loadedNodeId || pendingPatch) return;
    const decision = classifyIncomingScreenplaySource({
      source: sourceDraft,
      draft: draftRef.current,
      lastCommitted: lastCommittedRef.current,
      lastObservedSource: lastObservedSourceRef.current,
      pendingSave,
    });
    if (decision === "unchanged" || decision === "stale") return;
    lastObservedSourceRef.current = sourceDraft;
    if (decision === "acknowledge") {
      lastCommittedRef.current = sourceDraft;
      setPendingSave(null);
      setSaveState(screenplayDraftsEqual(draftRef.current, sourceDraft) ? "saved" : "idle");
      return;
    }
    if (decision === "adopt") {
      setDraft(sourceDraft);
      draftRef.current = sourceDraft;
      lastCommittedRef.current = sourceDraft;
      setPendingSave(null);
      setSaveState("saved");
      return;
    }
    const merge = mergeConcurrentScreenplayDrafts(
      lastCommittedRef.current,
      draftRef.current,
      sourceDraft,
    );
    lastObservedSourceRef.current = sourceDraft;
    setPendingSave(null);
    if (merge.conflicts.length === 0) {
      setDraft(merge.merged);
      draftRef.current = merge.merged;
      // The incoming CRDT materialization is the new acknowledged base. Any
      // local portion retained by the merge remains dirty and will be saved as
      // a delta over that base.
      lastCommittedRef.current = sourceDraft;
      setSaveState(screenplayDraftsEqual(merge.merged, sourceDraft) ? "saved" : "idle");
      return;
    }
    setExternalConflict(sourceDraft);
    setSaveState("conflict");
  }, [loadedNodeId, pendingPatch, pendingSave, scriptNode?.id, sourceDraft]);

  const commitDraft = useCallback((nextDraft: WritingDraft, force = false) => {
    const nodeId = scriptNode?.id || initialScriptNodeId;
    if (!nodeId || pendingPatch || externalConflict) return;
    const normalized = prepareScreenplayDraftForSave(nextDraft);
    if (screenplayDraftsEqual(normalized, lastCommittedRef.current)) return;
    if (pendingSave && !force) {
      if (!screenplayDraftsEqual(normalized, pendingSave.submitted)) setSaveState("idle");
      return;
    }
    const save: PendingScreenplaySave = {
      submitted: normalized,
      previousSource: lastObservedSourceRef.current,
    };
    setPendingSave(save);
    setSaveState("saving");
    try {
      if (onCommitScriptDocument) {
        onCommitScriptDocument({
          nodeId,
          title: normalized.title,
          content: normalized.body,
          preview: createScreenplayPreview(normalized.body),
          stats: analyzeScreenplay(normalized.body, knownCharacterIdentities, knownSceneIdentities).stats,
        });
      } else {
        setProjectData((previous) => {
          const flow = ensureFlow(previous.flow);
          let changed = false;
          const flowNodes = (flow.flowNodes || []).map((node) => {
            if (node.id !== nodeId || node.type !== "scriptPage") return node;
            changed = true;
            const data = (node.data || {}) as Record<string, unknown>;
            return {
              ...node,
              data: {
                ...data,
                title: normalized.title,
                text: normalized.body,
                content: normalized.body,
                documentId: typeof data.documentId === "string" && data.documentId ? data.documentId : node.id,
                documentKind: "script",
                format: "fountain",
                preview: createScreenplayPreview(normalized.body),
                updatedAt: Date.now(),
              },
            };
          });
          return changed ? { ...previous, rawScript: "", episodes: [], flow: { ...flow, flowNodes } } : previous;
        });
      }
      lastCommittedRef.current = normalized;
      if (!screenplayDraftsEqual(nextDraft, normalized)) setDraft(normalized);
    } catch {
      setPendingSave(null);
      setSaveState("error");
    }
  }, [externalConflict, initialScriptNodeId, knownCharacterIdentities, knownSceneIdentities, onCommitScriptDocument, pendingPatch, pendingSave, scriptNode?.id, setProjectData]);

  useEffect(() => {
    if (pendingPatch || pendingSave || externalConflict || screenplayDraftsEqual(draft, lastCommittedRef.current)) return;
    const timer = window.setTimeout(() => commitDraft(draft), 650);
    return () => window.clearTimeout(timer);
  }, [commitDraft, draft, externalConflict, pendingPatch, pendingSave]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") commitDraft(draftRef.current);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        commitDraft(draftRef.current);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [commitDraft]);

  useEffect(() => {
    const compactLayout = window.matchMedia("(max-width: 1180px)");
    const collapseSidePanels = (event: MediaQueryListEvent) => {
      if (!event.matches) return;
      setIsInspectorOpen(false);
      onCloseTranslator?.();
    };
    // 只在挂载时与断点真实切换时收起，避免父组件重渲染（回调身份变化）导致面板一闪即关。
    if (compactLayout.matches) {
      setIsInspectorOpen(false);
      onCloseTranslator?.();
    }
    compactLayout.addEventListener("change", collapseSidePanels);
    return () => compactLayout.removeEventListener("change", collapseSidePanels);
  }, [onCloseTranslator]);

  useEffect(() => {
    if (!scriptNode?.id || !agentScriptEditProposals) return;
    const proposal = agentScriptEditProposals.proposals.find((item) => item.nodeId === scriptNode.id);
    if (!proposal || handledProposalIdsRef.current.has(proposal.id)) return;
    handledProposalIdsRef.current.add(proposal.id);
    const proposedDraft = {
      title: proposal.title.trim() || draftRef.current.title,
      body: normalizeFountainDocument(proposal.content),
    };
    if (screenplayDraftsEqual(proposedDraft, draftRef.current)) {
      onResolveAgentScriptEditProposal?.(proposal.id);
      return;
    }
    setSelectionCommand(null);
    setPendingPatch({
      id: proposal.id,
      baseTitle: draftRef.current.title,
      nextTitle: proposedDraft.title,
      baseBody: draftRef.current.body,
      nextBody: proposedDraft.body,
      lines: buildScriptLinePatch(draftRef.current.body, proposedDraft.body),
    });
  }, [agentScriptEditProposals, onResolveAgentScriptEditProposal, scriptNode?.id]);

  const navigateToLine = useCallback((lineIndex: number) => {
    setActiveLineIndex(lineIndex);
    setNavigationRequest({ lineIndex, id: Date.now() });
  }, []);

  const openIdentityLookbook = useCallback((identityNodeId: string) => {
    commitDraft(draftRef.current, true);
    onOpenLookbook?.(identityNodeId);
  }, [commitDraft, onOpenLookbook]);

  const openScriptPage = useCallback((nextIndex: number, behavior: ScrollBehavior = "smooth") => {
    const nextNode = pageSequence[nextIndex];
    if (!nextNode || externalConflict) return;
    if (nextNode.id !== scriptNode?.id) {
      commitDraft(draftRef.current, true);
      setActiveScriptNodeId(nextNode.id);
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        pageElementRefs.current.get(nextNode.id)?.scrollIntoView({
          behavior,
          block: pageArrangement === "vertical" ? "start" : "center",
          inline: "center",
        });
      });
    });
  }, [commitDraft, externalConflict, pageArrangement, pageSequence, scriptNode?.id]);

  const cancelEdgeNavigation = useCallback(() => {
    if (edgeHoverTimerRef.current === null) return;
    window.clearTimeout(edgeHoverTimerRef.current);
    edgeHoverTimerRef.current = null;
  }, []);

  const queueEdgeNavigation = useCallback((direction: -1 | 1) => {
    cancelEdgeNavigation();
    const nextIndex = pageIndex + direction;
    if (!pageSequence[nextIndex]) return;
    edgeHoverTimerRef.current = window.setTimeout(() => {
      edgeHoverTimerRef.current = null;
      openScriptPage(nextIndex);
    }, 360);
  }, [cancelEdgeNavigation, openScriptPage, pageIndex, pageSequence]);

  useEffect(() => cancelEdgeNavigation, [cancelEdgeNavigation]);

  useEffect(() => {
    const activeNodeId = scriptNode?.id;
    if (!activeNodeId) return;
    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = pageElementRefs.current.get(activeNodeId);
        target?.scrollIntoView({
          behavior: "smooth",
          block: pageArrangement === "vertical" ? "start" : "center",
          inline: "center",
        });
      });
    });
    return () => window.cancelAnimationFrame(firstFrame);
  }, [pageArrangement, scriptNode?.id]);

  const handleFilmstripReorder = useCallback((nextOrder: string[]) => {
    filmstripOrderRef.current = nextOrder;
    setFilmstripOrder(nextOrder);
  }, []);

  const finishFilmstripReorder = useCallback(() => {
    const nextOrder = filmstripOrderRef.current;
    setDraggedPageId(null);
    if (
      nextOrder.length !== contentPages.length ||
      nextOrder.every((nodeId, index) => nodeId === contentPages[index]?.id)
    ) return;
    commitDraft(draftRef.current, true);
    const orderedNodeIds = titlePageNode ? [titlePageNode.id, ...nextOrder] : nextOrder;
    if (onReorderScriptDocuments) onReorderScriptDocuments({ orderedNodeIds });
    else setProjectData((previous) => reorderConnectedScriptPages(previous, orderedNodeIds));
  }, [commitDraft, contentPages, onReorderScriptDocuments, setProjectData, titlePageNode]);

  const createPageFromLine = useCallback((lineIndex: number, activateNewPage = true, pinned = false) => {
    if (!scriptNode?.id || !onSplitScriptDocument || pendingPatch || externalConflict) return null;
    const currentDraft = draftRef.current;
    const { currentBody, nextBody } = splitScreenplayDocumentAtLine(currentDraft.body, lineIndex);
    const retainedBody = ensureScreenplayPageLineGrid(currentBody);
    const continuedBody = ensureScreenplayPageLineGrid(nextBody);
    const nextNodeId = onSplitScriptDocument({
      sourceNodeId: scriptNode.id,
      title: currentDraft.title,
      sourceContent: retainedBody,
      nextContent: continuedBody,
      pinned,
    });
    if (!nextNodeId) return null;
    const retainedDraft = { ...currentDraft, body: retainedBody };
    draftRef.current = retainedDraft;
    lastCommittedRef.current = retainedDraft;
    lastObservedSourceRef.current = retainedDraft;
    setDraft(retainedDraft);
    setPendingSave(null);
    setSaveState("saved");
    setSelectionCommand(null);
    if (activateNewPage) setActiveScriptNodeId(nextNodeId);
    return nextNodeId;
  }, [externalConflict, onSplitScriptDocument, pendingPatch, scriptNode?.id]);

  const createBlankPage = useCallback(() => {
    if (!scriptNode?.id || !onSplitScriptDocument || pendingPatch || externalConflict) return;
    const currentDraft = prepareScreenplayDraftForSave(draftRef.current);
    const nextNodeId = onSplitScriptDocument({
      sourceNodeId: scriptNode.id,
      title: currentDraft.title,
      sourceContent: currentDraft.body,
      nextContent: createBlankScreenplayPageBody(),
      pinned: true,
    });
    if (!nextNodeId) return;
    draftRef.current = currentDraft;
    lastCommittedRef.current = currentDraft;
    lastObservedSourceRef.current = currentDraft;
    setDraft(currentDraft);
    setPendingSave(null);
    setSaveState("saved");
    setSelectionCommand(null);
    setActiveScriptNodeId(nextNodeId);
  }, [externalConflict, onSplitScriptDocument, pendingPatch, scriptNode?.id]);

  const reflowCurrentPage = useCallback(() => {
    const anchor = scriptNode?.id || activeScriptNodeId;
    if (!anchor || !onSplitScriptDocument) return;
    const anchorBody = draftRef.current.body;
    // 只有用户在页首删除内容时才触发跨页回流（合并到上一页）；
    // 其它情况只做“内容超出容量时下推”，绝不自动回填。
    const startDeletion = didDeletePageStart(lastCommittedRef.current.body, anchorBody);
    const result = reflowConnectedScriptPages(projectData, anchor, {
      bodyOverrides: { [anchor]: anchorBody },
      cursorLine: activeLineIndex,
      ...(startDeletion ? { mergeNextPageId: anchor } : {}),
    });
    if (!result || !result.changed) return;
    setProjectData(result.projectData);
    const cursorChunk = result.cursor?.chunkIndex ?? 0;
    const targetNodeId = result.contentNodeIds[cursorChunk];
    const targetBody = result.chunkBodies[cursorChunk];
    const cursorLine = result.cursor?.lineIndex ?? 0;
    if (!targetNodeId || targetBody === undefined) return;
    const nextDraft = { title: draftRef.current.title, body: targetBody };
    if (targetNodeId === anchor) {
      draftRef.current = nextDraft;
      lastCommittedRef.current = nextDraft;
      lastObservedSourceRef.current = nextDraft;
      setDraft(nextDraft);
      setActiveLineIndex(cursorLine);
      setNavigationRequest({ lineIndex: cursorLine, id: Date.now() });
    } else {
      pendingReflowFocusRef.current = { nodeId: targetNodeId, lineIndex: cursorLine };
      setActiveScriptNodeId(targetNodeId);
    }
    setPendingSave(null);
    setSaveState("saved");
    setSelectionCommand(null);
    onCommitScriptDocument?.({
      nodeId: targetNodeId,
      title: draftRef.current.title,
      content: targetBody,
      preview: createScreenplayPreview(targetBody),
      stats: analyzeScreenplay(targetBody).stats,
    });
  }, [activeLineIndex, onCommitScriptDocument, onSplitScriptDocument, projectData, scriptNode?.id]);

  useEffect(() => {
    if (isTitlePageActive || !autoPagination || pendingPatch || pendingSave || externalConflict || !onSplitScriptDocument) return;
    // 只对用户编辑过的内容做重排（首次打开/切换页不重排，避免大改已有数据）。
    if (!userEditedRef.current) return;
    // 重排早于自动保存（650ms）执行，保证手势检测读到的是编辑前的已提交正文。
    const timer = window.setTimeout(() => reflowCurrentPage(), 550);
    return () => window.clearTimeout(timer);
  }, [autoPagination, draft.body, externalConflict, isTitlePageActive, onSplitScriptDocument, pendingPatch, pendingSave, reflowCurrentPage]);

  const updatePatch = useCallback((updater: (line: ScriptPatchLine) => ScriptPatchLine) => {
    setPendingPatch((current) => {
      if (!current) return current;
      const next = { ...current, lines: current.lines.map((line) => line.kind === "equal" ? line : updater(line)) };
      const body = deriveReviewedScriptBody(next);
      setDraft((existing) => ({ ...existing, body }));
      if (hasPendingPatchLines(next)) return next;
      const allAccepted = next.lines.filter((line) => line.kind !== "equal").every((line) => line.status === "accepted");
      const reviewed = { title: allAccepted ? next.nextTitle : next.baseTitle, body };
      setLastReviewedSnapshot({ title: next.baseTitle, body: next.baseBody });
      setDraft(reviewed);
      requestAnimationFrame(() => commitDraft(reviewed));
      onResolveAgentScriptEditProposal?.(next.id);
      return null;
    });
  }, [commitDraft, onResolveAgentScriptEditProposal]);

  const reviewAll = useCallback((status: ScriptPatchLineStatus) => {
    updatePatch((line) => ({ ...line, status }));
  }, [updatePatch]);

  const undoReviewedPatch = useCallback(() => {
    if (!lastReviewedSnapshot) return;
    setDraft(lastReviewedSnapshot);
    commitDraft(lastReviewedSnapshot);
    setLastReviewedSnapshot(null);
  }, [commitDraft, lastReviewedSnapshot]);

  const submitSelectionCommand = useCallback(() => {
    if (!selectionCommand?.message.trim() || !scriptNode?.id) return;
    const data = (scriptNode.data || {}) as Record<string, unknown>;
    if (!isStyloOpen) onOpenStylo?.();
    onSubmitToStylo?.(selectionCommand.message.trim(), {
      documentSelection: {
        kind: "script",
        nodeId: scriptNode.id,
        documentId: typeof data.documentId === "string" ? data.documentId : undefined,
        title: draft.title,
        selectedText: selectionCommand.text,
        range: { start: selectionCommand.start, end: selectionCommand.end },
      },
    });
    setSelectionCommand(null);
  }, [draft.title, isStyloOpen, onOpenStylo, onSubmitToStylo, scriptNode, selectionCommand]);

  const writeSelectionToClipboard = useCallback(async () => {
    if (!selectionCommand?.text) return false;
    try {
      await navigator.clipboard.writeText(selectionCommand.text);
      return true;
    } catch {
      return false;
    }
  }, [selectionCommand?.text]);

  const replaceSelectedText = useCallback((replacement: string) => {
    if (!selectionCommand) return;
    setDraft((current) => ({
      ...current,
      body: `${current.body.slice(0, selectionCommand.start)}${replacement}${current.body.slice(selectionCommand.end)}`,
    }));
    setSelectionCommand(null);
  }, [selectionCommand]);

  const cutSelectedText = useCallback(async () => {
    if (await writeSelectionToClipboard()) replaceSelectedText("");
  }, [replaceSelectedText, writeSelectionToClipboard]);

  const pasteOverSelectedText = useCallback(async () => {
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (clipboardText) replaceSelectedText(clipboardText);
    } catch {
      // Clipboard permission can be unavailable in a regular browser tab.
    }
  }, [replaceSelectedText]);

  const underlineSelectedText = useCallback(() => {
    if (!selectionCommand) return;
    replaceSelectedText(`_${selectionCommand.text}_`);
  }, [replaceSelectedText, selectionCommand]);

  const handleClose = () => {
    if (externalConflict) return;
    commitDraft(draftRef.current, true);
    onClose?.();
  };

  const handleShare = async () => {
    const baseName = (projectData.fileName || draft.title || "stylo-script").replace(/\.[^/.]+$/, "");
    const filename = `${baseName}.fountain`;
    const content = pageSequence.length
      ? pageSequence.map((node) => (
          node.id === scriptNode?.id ? prepareScreenplayDraftForSave(draft).body : readScriptNode(node, knownCharacterIdentities).body
        )).join("\n\n")
      : prepareScreenplayDraftForSave(draft).body;
    const file = new File([content], filename, { type: "text/plain;charset=utf-8" });
    if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: draft.title });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    downloadFountain(filename, content);
  };

  const handleImportFountainFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const raw = typeof reader.result === "string" ? reader.result : "";
        const normalized = normalizeFountainDocument(raw);
        if (!normalized.trim()) return;
        if (pendingPatch || externalConflict) return;
        const titlePage = parseFountainTitlePage(normalized);
        const body = ensureScreenplayPageLineGrid(stripFountainTitleBlock(normalized));
        const title =
          titlePage.title.trim() ||
          file.name.replace(/\.[^/.]+$/, "").trim() ||
          "未命名剧本";
        const preview = createScreenplayPreview(body);
        const stats = analyzeScreenplay(body).stats;
        const sequence = getConnectedScriptPageSequence(
          projectData,
          scriptNode?.id || activeScriptNodeId
        );
        const titlePageNode = sequence.find(isScreenplayTitlePageNode);
        const contentPages = sequence.filter((node) => !isScreenplayTitlePageNode(node));
        const anchor = contentPages[0];
        if (!anchor) return;
        const anchorData = anchor.data || {};
        const sequenceIds = new Set(sequence.map((node) => node.id));
        const keptIds = new Set<string>([anchor.id]);
        if (titlePageNode) keptIds.add(titlePageNode.id);
        const now = Date.now();
        setProjectData((previous) => {
          const flow = previous.flow || { links: [] };
          const flowNodes = (flow.flowNodes || [])
            .filter((node) => !sequenceIds.has(node.id) || keptIds.has(node.id))
            .map((node) => {
              if (node.id === anchor.id) {
                return {
                  ...node,
                  data: {
                    ...node.data,
                    title,
                    text: body,
                    content: body,
                    documentKind: "script",
                    format: "fountain",
                    preview,
                    screenplayStats: stats,
                    revision: typeof anchorData.revision === "number" ? anchorData.revision + 1 : 1,
                    updatedAt: now,
                  },
                } as NodeFlowNode;
              }
              if (titlePageNode && node.id === titlePageNode.id) {
                const titleBody = serializeFountainTitlePage({
                  ...parseFountainTitlePage(String(node.data?.content || node.data?.text || "")),
                  title,
                });
                return {
                  ...node,
                  data: {
                    ...node.data,
                    title,
                    text: titleBody,
                    content: titleBody,
                    documentKind: "script",
                    format: "fountain",
                    preview: "",
                    screenplayStats: stats,
                    revision: typeof node.data?.revision === "number" ? node.data.revision + 1 : 1,
                    updatedAt: now,
                  },
                } as NodeFlowNode;
              }
              return node;
            });
          const links = (flow.links || []).filter((link) => {
            if (
              link.data?.relation === SCREENPLAY_PAGE_RELATION &&
              sequenceIds.has(link.source) &&
              sequenceIds.has(link.target)
            ) {
              return keptIds.has(link.source) && keptIds.has(link.target);
            }
            if (link.data?.relation === "folder-membership" && sequenceIds.has(link.target)) {
              return keptIds.has(link.target);
            }
            return true;
          });
          return {
            ...previous,
            flow: { ...flow, flowNodes, links },
          };
        });
        const nextDraft = { title, body };
        draftRef.current = nextDraft;
        lastCommittedRef.current = nextDraft;
        lastObservedSourceRef.current = nextDraft;
        setDraft(nextDraft);
        setPendingSave(null);
        setSaveState("saved");
        setSelectionCommand(null);
        setActiveScriptNodeId(anchor.id);
        onCommitScriptDocument?.({ nodeId: anchor.id, title, content: body, preview, stats });
      };
      reader.readAsText(file);
    },
    [
      activeScriptNodeId,
      externalConflict,
      onCommitScriptDocument,
      pendingPatch,
      projectData,
      scriptNode?.id,
      setProjectData,
    ]
  );

  const orderedFilmstripPages = useMemo(() => {
    const pageById = new Map(contentPages.map((node) => [node.id, node]));
    const ordered = filmstripOrder.map((nodeId) => pageById.get(nodeId)).filter(Boolean) as NodeFlowNode[];
    contentPages.forEach((node) => {
      if (!filmstripOrder.includes(node.id)) ordered.push(node);
    });
    return ordered;
  }, [contentPages, filmstripOrder]);

  const updateTitlePageField = useCallback((key: keyof FountainTitlePage, value: string) => {
    setDraft((current) => {
      const fields = { ...parseFountainTitlePage(current.body), [key]: value };
      return {
        title: key === "title" && value.trim() ? value.trim() : current.title,
        body: serializeFountainTitlePage(fields),
      };
    });
  }, []);

  const screenplayHeader = (
    <ScreenplayHeader
      saveState={saveState}
      isFocusMode={isFocusMode}
      isInspectorOpen={isInspectorOpen}
      onToggleFocus={() => {
        if (!isFocusMode && isTitlePageActive && contentPages[0]) {
          commitDraft(draftRef.current, true);
          setActiveScriptNodeId(contentPages[0].id);
        }
        if (!isFocusMode) onCloseTranslator?.();
        setIsFocusMode((active) => !active);
      }}
      onToggleInspector={() => {
        if (!isInspectorOpen) onCloseTranslator?.();
        setIsInspectorOpen((open) => !open);
      }}
      isTranslatorOpen={isTranslatorOpen}
      onToggleTranslator={() => {
        if (!isTranslatorOpen) setIsInspectorOpen(false);
        onToggleTranslator?.();
      }}
      onImportFountain={() => fountainImportInputRef.current?.click()}
      onShare={() => void handleShare()}
      onClose={handleClose}
      pageIndex={pageIndex}
      pageCount={contentPages.length}
      isCoverPage={isTitlePageActive}
      pageArrangement={pageArrangement}
      autoPagination={autoPagination}
      onPageArrangementChange={setPageArrangement}
      onCreatePage={createBlankPage}
      onToggleAutoPagination={() => setAutoPagination((enabled) => !enabled)}
    />
  );

  const visiblePages = isFocusMode
    ? contentPages
    : pageArrangement === "vertical"
      ? displayPages
      : displayPages.filter((node) => node.id === scriptNode?.id);

  const renderPaper = (node: NodeFlowNode, index: number) => {
    const isActive = node.id === scriptNode?.id;
    const paperDraft = isActive ? draft : readScriptNode(node, knownCharacterIdentities);
    const paperLines = isActive
      ? liveLines
      : analyzeFountainLines(paperDraft.body, knownCharacterIdentities);
    const paperAnalysis = isActive
      ? analysis
      : analyzeScreenplay(paperDraft.body, knownCharacterIdentities, knownSceneIdentities);
    const isTitlePage = isScreenplayTitlePageNode(node);
    const titlePageFields = isTitlePage ? parseFountainTitlePage(paperDraft.body) : null;
    return (
      <article
        key={node.id}
        ref={(element) => {
          if (element) pageElementRefs.current.set(node.id, element);
          else pageElementRefs.current.delete(node.id);
        }}
        className={`screenplay-document ${isTitlePage ? "is-title-page" : ""} ${isActive ? "is-active" : "is-preview"} ${isFocusMode ? "is-focus-section" : ""}`}
        data-page-id={node.id}
        tabIndex={isActive ? undefined : 0}
        role={isActive ? undefined : "button"}
        aria-label={isActive ? undefined : isTitlePage ? "打开剧本封面" : `打开第 ${index} 张稿纸：${paperDraft.title}`}
        onClick={isActive ? undefined : () => openScriptPage(index)}
        onKeyDown={isActive ? undefined : (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          openScriptPage(index);
        }}
      >
        <div className="screenplay-document__body">
          {!isFocusMode && !isTitlePage ? (
            <header className="screenplay-document__masthead">
              <div>
                {isActive ? (
                  <input
                    value={draft.title}
                    onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                    placeholder="未命名剧本"
                    aria-label="剧本标题"
                  />
                ) : <strong>{paperDraft.title}</strong>}
              </div>
              <small>{index}/{Math.max(1, contentPages.length)} · {paperAnalysis.stats.scenes} 场</small>
            </header>
          ) : null}
          {isTitlePage && titlePageFields ? (
            <div className="screenplay-title-page__fields">
              <input
                className="screenplay-title-page__title"
                value={titlePageFields.title}
                readOnly={!isActive || !!pendingPatch}
                placeholder={isActive ? "剧本标题" : ""}
                aria-label="剧本标题"
                onChange={(event) => updateTitlePageField("title", event.target.value)}
              />
              <input
                value={titlePageFields.author}
                readOnly={!isActive || !!pendingPatch}
                placeholder={isActive ? "作者" : ""}
                aria-label="作者"
                onChange={(event) => updateTitlePageField("author", event.target.value)}
              />
              <div className="screenplay-title-page__footer">
                <input
                  value={titlePageFields.date}
                  readOnly={!isActive || !!pendingPatch}
                  placeholder={isActive ? "日期" : ""}
                  aria-label="日期"
                  onChange={(event) => updateTitlePageField("date", event.target.value)}
                />
                <input
                  value={titlePageFields.revision}
                  readOnly={!isActive || !!pendingPatch}
                  placeholder={isActive ? "版本" : ""}
                  aria-label="版本"
                  onChange={(event) => updateTitlePageField("revision", event.target.value)}
                />
              </div>
            </div>
          ) : (
            <ScreenplayBlockEditor
              body={paperDraft.body}
              lines={paperLines}
              activeLineIndex={isActive ? activeLine.index : -1}
              navigationRequest={isActive ? navigationRequest : null}
              readOnly={!isActive || !!pendingPatch}
              characterSuggestions={characterSuggestions}
              locationSuggestions={locationSuggestions}
              locationOptionsId={`screenplay-location-options-${node.id}`}
              onChange={isActive ? (body) => {
                userEditedRef.current = true;
                setDraft((current) => ({ ...current, body: ensureScreenplayPageLineGrid(body) }));
              } : () => undefined}
              onActiveLineChange={isActive ? setActiveLineIndex : () => undefined}
              onSelectionChange={isActive ? (selection) => {
                setSelectionCommand(selection ? { ...selection, isAsking: false, message: "" } : null);
              } : undefined}
              onCreatePageFromLine={isActive ? (lineIndex) => createPageFromLine(lineIndex, true, true) : undefined}
            />
          )}
        </div>
      </article>
    );
  };

  return (
    <div
      ref={workspaceRef}
      className={`screenplay-workspace ${isFocusMode ? "is-focus-mode" : ""} ${isInspectorOpen ? "is-inspector-open" : ""} ${agentDockWidth > 0 ? "is-agent-open" : ""} ${isTranslatorOpen && !isFocusMode ? "is-translator-open" : ""}`}
      style={
        {
          "--screenplay-agent-inset": `${Math.max(0, agentDockWidth)}px`,
          "--screenplay-translator-inset": `${Math.max(0, translatorDockWidth)}px`,
          "--screenplay-film-safe-top": `${FILMSTRIP_SAFE_TOP}px`,
          "--screenplay-film-safe-bottom": `${FILMSTRIP_SAFE_BOTTOM}px`,
          "--screenplay-filmstrip-scale": String(filmstripScale),
          "--screenplay-filmstrip-paper-height": `${filmstripPaperHeight}px`,
          "--screenplay-filmstrip-margin-bottom": `${Math.max(
            -9999,
            FILMSTRIP_SAFE_BOTTOM - filmstripPaperHeight * (1 - filmstripScale)
          )}px`,
        } as React.CSSProperties
      }
    >
      {/* 右侧悬浮操作菜单统一锚定视口右上角（自动隐藏），不再基于单张稿纸 */}
      {screenplayHeader}
      <input
        ref={fountainImportInputRef}
        type="file"
        accept=".fountain,.txt,text/plain"
        className="hidden"
        aria-label="导入 Fountain 文件"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleImportFountainFile(file);
          event.target.value = "";
        }}
      />
      <div className="screenplay-layout">
        <main className={`screenplay-document-viewport ${isFocusMode ? "is-focus" : `is-${pageArrangement}`}`}>
          <div className={`screenplay-document-stage ${isFocusMode ? "is-focus" : `is-${pageArrangement}`}`}>
            {isFocusMode ? (
              <header className="screenplay-focus-masthead">
                <input
                  value={draft.title}
                  onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                  placeholder="未命名剧本"
                  aria-label="剧本标题"
                />
                <small>{Math.max(1, displayPages.length)} 页 · {analysis.stats.scenes} 场</small>
              </header>
            ) : null}
            {visiblePages.map((node) => renderPaper(node, displayPages.findIndex((item) => item.id === node.id)))}
          </div>
          {!isFocusMode && pageArrangement === "horizontal" && displayPages.length > 0 ? (
            <>
              <button
                type="button"
                className="screenplay-page-edge is-previous"
                disabled={pageIndex <= 0}
                aria-label="前一张稿纸"
                onPointerEnter={() => queueEdgeNavigation(-1)}
                onPointerLeave={cancelEdgeNavigation}
                onFocus={() => queueEdgeNavigation(-1)}
                onBlur={cancelEdgeNavigation}
                onClick={() => openScriptPage(pageIndex - 1)}
              ><CaretLeft size={18} /></button>
              <button
                type="button"
                className="screenplay-page-edge is-next"
                disabled={pageIndex >= displayPages.length - 1}
                aria-label="后一张稿纸"
                onPointerEnter={() => queueEdgeNavigation(1)}
                onPointerLeave={cancelEdgeNavigation}
                onFocus={() => queueEdgeNavigation(1)}
                onBlur={cancelEdgeNavigation}
                onClick={() => openScriptPage(pageIndex + 1)}
              ><CaretRight size={18} /></button>
            </>
          ) : null}
        </main>

        {isInspectorOpen ? (
          <ScreenplayInspector
            analysis={analysis}
            activeLine={activeLine}
            onNavigate={navigateToLine}
          />
        ) : null}
      </div>

      {isTranslatorOpen && !isFocusMode ? <TranslatorDock onClose={onCloseTranslator} /> : null}

      {!isFocusMode && pageArrangement === "filmstrip" && displayPages.length > 0 ? (
        <nav className="screenplay-page-filmstrip" aria-label="稿纸缩略队列">
          {titlePageNode ? (
            <button
              type="button"
              className={`screenplay-page-filmstrip__cover ${isTitlePageActive ? "is-active" : ""}`}
              onClick={() => openScriptPage(0)}
              aria-label="打开剧本封面"
            >
              <small>C</small>
              <strong>封面</strong>
              <span>{parseFountainTitlePage(readScriptNode(titlePageNode).body).title || "未填写"}</span>
            </button>
          ) : null}
          <Reorder.Group
            axis="y"
            values={filmstripOrder}
            onReorder={handleFilmstripReorder}
            className="screenplay-page-filmstrip__pages"
            layoutScroll
          >
          {orderedFilmstripPages.map((node) => {
            const index = displayPages.findIndex((page) => page.id === node.id);
            const contentPageNumber = contentPages.findIndex((page) => page.id === node.id) + 1;
            const paperDraft = node.id === scriptNode?.id ? draft : readScriptNode(node, knownCharacterIdentities);
            return (
              <FilmstripPageItem
                key={node.id}
                nodeId={node.id}
                title={paperDraft.title}
                preview={stripFountainMarkup(paperDraft.body).trim().slice(0, 46)}
                pageNumber={contentPageNumber}
                isActive={node.id === scriptNode?.id}
                isDragging={draggedPageId === node.id}
                onOpen={() => openScriptPage(index)}
                onDragStart={() => setDraggedPageId(node.id)}
                onDragEnd={finishFilmstripReorder}
              />
            );
          })}
          </Reorder.Group>
        </nav>
      ) : null}

      <ScreenplayIdentityDock
        entries={identityEntries}
        recentIdentityId={activeIdentityArrivalId}
        onOpenIdentity={openIdentityLookbook}
      />

      {pendingIdentityRemoval ? (
        <aside className="screenplay-identity-removal" role="alertdialog" aria-label="移除未引用身份">
          <span className={`screenplay-identity-removal__mark is-${pendingIdentityRemoval.kind}`} aria-hidden="true">
            {Array.from(pendingIdentityRemoval.displayName || pendingIdentityRemoval.name).slice(0, 1)}
          </span>
          <div>
            <strong>{pendingIdentityRemoval.displayName || pendingIdentityRemoval.name}</strong>
            <span>剧本中已无引用，是否从{pendingIdentityRemoval.kind === "person" ? "角色" : "场景"}库移除？</span>
          </div>
          <button type="button" onClick={keepOrphanedIdentity}>保留</button>
          <button type="button" className="is-destructive" onClick={deleteOrphanedIdentity} aria-label="从资料库移除">
            <Trash size={14} />
          </button>
        </aside>
      ) : null}

      {selectionCommand && !pendingPatch ? (
        <div
          className={`screenplay-selection-command ${selectionCommand.isAsking ? "is-asking" : ""}`}
          style={{ left: selectionCommand.anchorX, top: selectionCommand.anchorY }}
        >
          <div className="screenplay-selection-command__tools" aria-label="文本选中操作">
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => void cutSelectedText()} aria-label="剪切" title="剪切">
              <Scissors size={15} />
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => void writeSelectionToClipboard()} aria-label="复制" title="复制">
              <Copy size={15} />
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => void pasteOverSelectedText()} aria-label="粘贴" title="粘贴">
              <Clipboard size={15} />
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={underlineSelectedText} aria-label="划线" title="划线">
              <TextStrikethrough size={15} />
            </button>
            <button
              type="button"
              className={selectionCommand.isAsking ? "is-active" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setSelectionCommand((current) => current ? { ...current, isAsking: !current.isAsking } : current)}
              aria-label="询问 Stylo"
              title="Ask"
            >
              <ChatCenteredDots size={15} />
            </button>
          </div>
          {selectionCommand.isAsking ? (
            <form className="screenplay-selection-command__ask" onSubmit={(event) => { event.preventDefault(); submitSelectionCommand(); }}>
              <input
                autoFocus
                value={selectionCommand.message}
                onChange={(event) => setSelectionCommand((current) => current ? { ...current, message: event.target.value } : current)}
                placeholder="Ask Stylo"
                aria-label="针对选中文本向 Stylo 提问"
              />
              <button type="submit" className="is-primary" disabled={!selectionCommand.message.trim()} aria-label="发送给 Stylo">
                <PaperPlaneTilt size={14} weight="fill" />
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {externalConflict ? (
        <div className="screenplay-conflict-banner" role="alert">
          <div>
            <strong>检测到外部版本</strong>
            <span>当前草稿尚未保存，请选择要保留的版本。</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setDraft(externalConflict);
              draftRef.current = externalConflict;
              lastCommittedRef.current = externalConflict;
              lastObservedSourceRef.current = externalConflict;
              setPendingSave(null);
              setExternalConflict(null);
              setSaveState("saved");
            }}
          >载入外部版本</button>
          <button
            type="button"
            className="is-primary"
            onClick={() => {
              lastCommittedRef.current = externalConflict;
              lastObservedSourceRef.current = externalConflict;
              setPendingSave(null);
              setExternalConflict(null);
              setSaveState("idle");
            }}
          >保留我的草稿</button>
        </div>
      ) : null}

      {lastReviewedSnapshot && !pendingPatch ? (
        <button type="button" className="screenplay-review-undo" onClick={undoReviewedPatch}>
          <ArrowCounterClockwise size={14} />
          撤销 Stylo 修改
        </button>
      ) : null}

      {pendingPatch ? (
        <div className="screenplay-patch-review" role="dialog" aria-modal="true" aria-label="Stylo 修改审核">
          <div className="screenplay-patch-review__dialog">
            <header className="screenplay-patch-review__header">
              <div>
                <strong>审核 Stylo 修改</strong>
                <span>{pendingPatch.lines.filter((line) => line.kind !== "equal").length} 项变更，逐项决定后才会写入剧本</span>
              </div>
            </header>
            <div className="screenplay-patch-review__list">
              {pendingPatch.lines.filter((line) => line.kind !== "equal").map((line) => (
                <div key={line.id} className={`screenplay-patch-line is-${line.kind} is-${line.status}`}>
                  <span>{line.kind === "insert" ? "新增" : "删除"}</span>
                  <p>{stripFountainMarkup(line.line) || "空行"}</p>
                  {line.status === "pending" ? (
                    <div>
                      <button type="button" onClick={() => updatePatch((item) => item.id === line.id ? { ...item, status: "accepted" } : item)}>接受</button>
                      <button type="button" onClick={() => updatePatch((item) => item.id === line.id ? { ...item, status: "rejected" } : item)}>拒绝</button>
                    </div>
                  ) : <span>{line.status === "accepted" ? "已接受" : "已拒绝"}</span>}
                </div>
              ))}
            </div>
            <footer className="screenplay-patch-review__footer">
              <button type="button" onClick={() => reviewAll("rejected")}><X size={13} /> 全部拒绝</button>
              <button type="button" className="is-primary" onClick={() => reviewAll("accepted")}><Check size={13} /> 全部接受</button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
};
