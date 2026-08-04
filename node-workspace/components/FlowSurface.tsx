import React, { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  applyNodeChanges,
  BaseEdge,
  Connection,
  Edge,
  EdgeChange,
  EdgeProps,
  EdgeTypes,
  getBezierPath,
  Handle,
  Node,
  NodeChange,
  NodeTypes,
  OnBeforeDelete,
  OnConnectEnd,
  OnConnectStart,
  Position,
  useReactFlow,
  useStore,
  useUpdateNodeInternals,
  XYPosition,
} from "@xyflow/react";
import {
  AudioLines,
  Boxes,
  Bot,
  Clock3,
  FileText,
  Folder,
  Image as ImageIcon,
  Map as MapIcon,
  Network,
  Pencil,
  Plus,
  ScanSearch,
  Scissors,
  Square,
  Sparkles,
  Trash2,
  Video,
  Clapperboard,
} from "lucide-react";
import {
  ArrowUp,
  BookOpen,
  Check,
  ClipboardText,
  Copy,
  FilePdf,
  Palette,
  PushPinSimple,
  Trash,
} from "@phosphor-icons/react";
import type {
  ProjectData,
  FlowState,
  CanvasMeasuredSize,
} from "../../types";
import type {
  NodeCardColor,
  NodeFlowContextSnapshot,
  NodeFlowLink,
  NodeFlowNode,
  NodeFlowNodeData,
  NodeType,
} from "../types";
import {
  AudioInputNode,
  VideoInputNode,
  PdfInputNode,
  ImageInputNode,
  AnnotationNode,
  FolderNode,
  TextNode,
  ScriptBoardNode,
  IdentityCardNode,
  PinoardNode,
  ImageGenNode,
  NanoBananaImageGenNode,
  WanImageGenNode,
  WanReferenceVideoGenNode,
  ViduVideoGenNode,
  SeedanceVideoGenNode,
} from "../nodes";
import { createDefaultNodeFlowNodeData } from "../nodeflow/defaults";
import { createEmptyNodeFlowApprovalState } from "../nodeflow/approvals";
import { createIdleNodeFlowExecutionState } from "../nodeflow/sessionState";
import { buildNodeFlowFile, hydrateImportedNodeFlow } from "../nodeflow/serialization";
import { parseNodeFlowFile } from "../nodeflow/schema";
import { downloadNodeFlowPackage } from "../nodeflow/package";
import {
  collectUnreferencedOwnedStorageObjects,
  deleteOwnedStorageObjects,
} from "../nodeflow/storageObjects";
import { buildWrapperProjection } from "../nodeflow/wrapperProjection";
import { useNodeFlowStore } from "../store/nodeFlowStore";
import { useNodeFlowExecutor } from "../store/useNodeFlowExecutor";
import { getEdgeAlignedPosition } from "../utils/edgeAlignment";
import { getNodeHandles, inferHandleTypeFromNodeType, isTypedHandle, isValidConnection } from "../utils/handles";
import { createNodeFlowNodeCommand } from "../nodeflow/commands";
import { findSafeNodeFlowPosition, normalizeNodeFlowNodePositions } from "../nodeflow/placement";
import {
  MAX_FLOW_PROJECT_DURATION,
  MIN_FLOW_PROJECT_DURATION,
  normalizeFlowProjectDuration,
} from "../../utils/flowProject";
import { publishProjectNodeGeometryMutation } from "../../sync/projectMutationBus";
import { appendUniqueFlowLink, removeFlowLinksById } from "../nodeflow/flowLinks";
import { applyEdgeSelectionUpdates, type EdgeSelectionUpdate } from "../nodeflow/edgeSelection";
import { ConnectionDropMenu, type ConnectionDropMenuOption } from "./ConnectionDropMenu";
import type { BottomDockTray, CanvasSurfaceConfig, SharedCanvasControls, SharedCanvasViewport } from "./canvas/types";
import {
  DEFAULT_TIMELINE_DURATION,
  DEFAULT_TIMELINE_HEAD,
  FOUNDATION_ROOT_NODE_PREFIX,
  MIN_TIMELINE_BLOCK_MINUTES,
  TIMELINE_COLORS,
  applyFoundationTimelineToGraph,
  buildTimelineMarkdown,
  compactMarkdownPreview,
  createDefaultSpaceBlocks,
  createSpaceBlock,
  formatTimelineTime,
  getFlowProjectDuration,
  getFlowProjectsForState,
  getFoundationNodeRole,
  getFoundationScaffoldNodeIds,
  ensureFoundationGraphSkeleton,
  isFoundationBlockSelectionActive,
  isFoundationStructuralLink,
  isFoundationStructuralNode,
  layoutFoundationGraph,
  getWeightedAxisBlocks,
  setWeightedAxisBlocks,
  parseFoundationGraph,
  recalculateTimelineBlocks,
  saveActiveFlowIntoProjects,
  type FoundationProjectHead,
  type FoundationScaffold,
  type FoundationSpaceBlock,
  type FoundationTimeBlock,
} from "../foundation/scaffold";
import {
  getFoundationAxisDefinition,
  getNextFoundationAxis,
  isFoundationAxis,
  isNodeTypeAllowedInFoundationAxis,
  type FoundationAxis,
  type FoundationWeightedAxis,
} from "../foundation/axes";
import {
  assignFoundationMembership,
  createFoundationMembershipLink,
  isFoundationMembershipLink,
  removeFoundationMembership,
} from "../foundation/membership";
import { LOOKBOOK_MEMBERSHIP_RELATION, isLookbookNodeType } from "../../utils/lookbookIdentities";
import { LOOKBOOK_WRAPPER_DIMENSIONS } from "../lookbook/constants";
import {
  createManusMembershipLink,
  FOLDER_MEMBERSHIP_RELATION,
  getManusPageIds,
  isFolderMembershipLink,
  isManusFolderNode,
  MANUS_FOLDER_KIND,
  MANUS_FOLDER_NODE_SIZE,
} from "../manus/folder";
import {
  createPinoardMembershipLink,
  PINOARD_MEMBERSHIP_RELATION,
} from "../../utils/pinoardWorkspace";
import { DisconnectableEdge, EdgeDisconnectControl } from "../edges/DisconnectableEdge";
import { WrapperMembershipEdge } from "../edges/WrapperMembershipEdge";

const PdfReaderOverlay = React.lazy(() =>
  import("./PdfReaderOverlay").then((module) => ({ default: module.PdfReaderOverlay }))
);

type ScriptPageData = NodeFlowNodeData & {
  title?: string;
  text?: string;
  content?: string;
  documentId?: string;
};

type MarkdownTextData = NodeFlowNodeData & {
  title?: string;
  text?: string;
  content?: string;
  documentId?: string;
};

type FlowRenderNodeType = NodeType | "foundationAnchor";
type FlowRenderNode = Node<NodeFlowNodeData, FlowRenderNodeType>;

type FlowViewportBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type FoundationBoundaryEdgeData = {
  foundationBoundary?: boolean;
  foundationSourceScreenX?: number;
  foundationSourceScreenY?: number;
  foundationTargetBounds?: FlowViewportBounds;
};

type FlowRenderEdge = Edge<FoundationBoundaryEdgeData>;
type WrapperMemberMotion = {
  wrapperId: string;
  mode: "collapsing" | "expanding";
  memberIds: string[];
  orderById: Record<string, number>;
};
type FlowCreateType = "scriptPage" | "mdText" | NodeType;
type ScriptHandleType = "image" | "text" | "audio" | "video" | "multi";
type FoundationGatewaySettingsPanel = "assets" | "identity" | "skills";
type FoundationGatewayAssetsSection = "images" | "videos" | "prompts";


const FOUNDATION_EDGE_COLORS: Record<string, string> = {
  amber: "#c79a46",
  moss: "#6f8f61",
  blue: "#5d88a8",
  rose: "#b86b68",
  violet: "#8a78a7",
  slate: "#8a8f99",
};

const FLOW_VIRTUALIZATION_MIN_NODES = 80;
const FLOW_VIRTUALIZATION_OVERSCAN_RATIO = 0.75;
const FLOW_VIRTUALIZATION_MIN_OVERSCAN = 720;
const FLOW_VIRTUALIZATION_BUCKET_SIZE = 960;
const FOUNDATION_EDGE_OVERSCAN_RATIO = 0.4;
const FOUNDATION_EDGE_MIN_OVERSCAN = 360;

const INPUT_CARD_NODE_TYPES = new Set<NodeType>([
  "text",
  "imageInput",
  "audioInput",
  "videoInput",
  "pdfInput",
]);

const INPUT_CARD_COLORS: Array<{ value: NodeCardColor; label: string }> = [
  { value: "none", label: "无标记" },
  { value: "rose", label: "玫瑰" },
  { value: "amber", label: "琥珀" },
  { value: "moss", label: "苔绿" },
  { value: "blue", label: "蓝色" },
  { value: "slate", label: "灰蓝" },
];

type InputNodeContextMenuState = {
  nodeId: string;
  x: number;
  y: number;
};

const isInputCardNode = (node: Pick<NodeFlowNode, "type"> | undefined | null) =>
  !!node && INPUT_CARD_NODE_TYPES.has(node.type);

type ScriptConnectionDropState = {
  position: { x: number; y: number };
  flowPosition: { x: number; y: number };
  handleType: ScriptHandleType | null;
  connectionType: "source" | "target";
  sourceNodeId: string | null;
  sourceHandleId: string | null;
};

type ScriptFoundationTargetPosition = {
  x: number;
  y: number;
};

type ScriptFoundationProjection = {
  activeAxis: ScriptAxisMode;
  positions: Record<string, ScriptFoundationTargetPosition>;
};

type Props = {
  projectData: ProjectData;
  setProjectData: React.Dispatch<React.SetStateAction<ProjectData>>;
  onOpenScriptDocument: (nodeId: string) => void;
  onOpenLookbook?: (nodeId: string) => void;
  onOpenPinoard?: (pinoardId: string | null, textNodeId?: string) => void;
  focusedWrapperId?: string | null;
  canvasControls: SharedCanvasControls;
  screenToFlowPosition: (position: { x: number; y: number }) => XYPosition;
  isActive?: boolean;
  isWritingEditorOpen?: boolean;
  onCollapseCanvasCards?: () => void;
  onRestoreCanvasCards?: () => void;
  onOpenAgent?: () => void;
  onSubmitAgentMessage?: (text: string) => void;
  agentComposerValue?: string;
  onAgentComposerChange?: (value: string) => void;
  onAgentComposerAction?: () => void;
  isAgentSending?: boolean;
  isAgentFirstMode?: boolean;
  onOpenProjectSettingsPanel?: (panel: FoundationGatewaySettingsPanel, assetsSection?: FoundationGatewayAssetsSection) => void;
  onOpenVisualLab?: (key?: "glassLab") => void;
  pendingScriptReviewNodeIds?: ReadonlySet<string>;
  activeDockTray: BottomDockTray | null;
  onDockTrayChange: (tray: BottomDockTray | null) => void;
};

type FocusedWrapperMemberLayout = {
  position: XYPosition;
  width: number;
  height: number;
};

const buildFocusedWrapperLayout = (memberIds: string[]) => {
  const count = memberIds.length;
  const columns = count <= 1 ? 1 : count <= 4 ? 2 : 3;
  const width = count <= 1 ? 560 : count <= 4 ? 420 : 340;
  const height = count <= 1 ? 420 : count <= 4 ? 340 : 270;
  const gap = count <= 4 ? 44 : 34;
  const rows = Math.max(1, Math.ceil(count / columns));
  const totalWidth = columns * width + Math.max(0, columns - 1) * gap;
  const totalHeight = rows * height + Math.max(0, rows - 1) * gap;
  const layout = new Map<string, FocusedWrapperMemberLayout>();

  memberIds.forEach((memberId, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    layout.set(memberId, {
      position: {
        x: column * (width + gap) - totalWidth / 2,
        y: row * (height + gap) - totalHeight / 2,
      },
      width,
      height,
    });
  });

  return layout;
};

const ensureFlow = (flow?: FlowState): FlowState => ({
  revision: typeof flow?.revision === "number" ? flow.revision : 0,
  flowNodes: Array.isArray(flow?.flowNodes) ? flow.flowNodes : [],
  graphLinks: Array.isArray(flow?.graphLinks) ? flow.graphLinks : [],
  globalAssetHistory: Array.isArray(flow?.globalAssetHistory) ? flow.globalAssetHistory : [],
  linkStyle: flow?.linkStyle || "curved",
  activeView: flow?.activeView ?? null,
  links: Array.isArray(flow?.links) ? flow.links : [],
});

const markdownNodeId = (documentId: string) => `md-${documentId}`;

const isScriptPageNodeId = (id?: string | null) => !!id && id.startsWith("script-");
const isMarkdownNodeId = (id?: string | null) => !!id && id.startsWith("md-");
type ScriptCreateGroup = "wrapper" | "input" | "generation" | "motion";
type ScriptCreateOption = ConnectionDropMenuOption<FlowCreateType> & {
  group: ScriptCreateGroup;
  meta: string;
  tone: string;
  surface: string;
};

const scriptCreateGroups: { key: ScriptCreateGroup; label: string }[] = [
  { key: "wrapper", label: "创作包装器" },
  { key: "input", label: "输入" },
  { key: "generation", label: "图像" },
  { key: "motion", label: "影像" },
];

const scriptCreateOptions: ScriptCreateOption[] = [
  { label: "Pinoard", hint: "灵感构思包装器 · 统合文本贴纸", type: "pinoard", Icon: PushPinSimple, group: "wrapper", meta: "Ideation", tone: "is-rose", surface: "paper" },
  { label: "Manus", hint: "剧本包装器 · 创建第一张稿纸", type: "scriptPage", Icon: FileText, group: "wrapper", meta: "Fountain", tone: "is-slate", surface: "paper" },
  { label: "Lookbook", hint: "角色与场景视觉册", type: "lookbook", Icon: BookOpen, group: "wrapper", meta: "Identity", tone: "is-moss", surface: "card", disabled: true, disabledHint: "由剧本身份生成" },
  { label: "Cinewor", hint: "镜头与调度包装器", type: "scriptBoard", Icon: Clapperboard, group: "wrapper", meta: "Soon", tone: "is-rose", surface: "card", disabled: true, disabledHint: "即将开放" },
  { label: "文件夹", hint: "由 Foundation 自动生成", type: "folder", Icon: Folder, group: "wrapper", meta: "System", tone: "is-blue", surface: "folder", disabled: true, disabledHint: "由系统管理" },
  { label: "文本", hint: "Markdown 文本节点", type: "text", Icon: Pencil, group: "input", meta: "Text", tone: "is-slate", surface: "paper" },
  { label: "图片", hint: "参考图或分镜", type: "imageInput", Icon: ImageIcon, group: "input", meta: "Input", tone: "is-moss", surface: "media" },
  { label: "声音", hint: "对白或声音参考", type: "audioInput", Icon: AudioLines, group: "input", meta: "Input", tone: "is-blue", surface: "media" },
  { label: "视频", hint: "动态参考", type: "videoInput", Icon: Video, group: "input", meta: "Input", tone: "is-rose", surface: "media" },
  { label: "PDF", hint: "阅读资料与关联笔记", type: "pdfInput", Icon: FilePdf, group: "input", meta: "Document", tone: "is-amber", surface: "media" },
  { label: "图像生成", hint: "生成概念图", type: "imageGen", Icon: Sparkles, group: "generation", meta: "Image", tone: "is-amber", surface: "gen" },
  { label: "Nano Banana", hint: "图像生成", type: "nanoBananaImageGen", Icon: Sparkles, group: "generation", meta: "Image", tone: "is-amber", surface: "gen" },
  { label: "WAN 图像", hint: "图像工作流", type: "wanImageGen", Icon: Sparkles, group: "generation", meta: "Image", tone: "is-moss", surface: "gen" },
  { label: "Vidu 视频", hint: "参考生成视频", type: "viduVideoGen", Icon: Video, group: "motion", meta: "Video", tone: "is-blue", surface: "motion" },
  { label: "WAN 视频", hint: "参考生成视频", type: "wanReferenceVideoGen", Icon: Video, group: "motion", meta: "Video", tone: "is-rose", surface: "motion" },
  { label: "Seedance", hint: "多模态视频", type: "seedanceVideoGen", Icon: Video, group: "motion", meta: "Video", tone: "is-blue", surface: "motion" },
];

const SCRIPT_PAGE_NODE_SIZE = { width: 286, height: 356 };
const MARKDOWN_TEXT_NODE_SIZE = { width: 320, height: 252 };
const PINOARD_NODE_SIZE = { width: 372, height: 278 };

const getFixedFlowNodeDimensions = (type?: FlowRenderNode["type"] | null) => {
  if (type === "pinoard") return PINOARD_NODE_SIZE;
  if (type === "scriptPage") return SCRIPT_PAGE_NODE_SIZE;
  if (type && isLookbookNodeType(type)) return LOOKBOOK_WRAPPER_DIMENSIONS;
  return null;
};

const getFixedFlowNodeDimensionsForNode = (
  node: Pick<NodeFlowNode, "type" | "data">
) => isManusFolderNode(node as NodeFlowNode)
  ? MANUS_FOLDER_NODE_SIZE
  : getFixedFlowNodeDimensions(node.type);

const getFlowNodeRenderStyle = (node: Pick<NodeFlowNode, "type" | "style" | "data">) => {
  const fixedDimensions = getFixedFlowNodeDimensionsForNode(node);
  return fixedDimensions ? { ...node.style, ...fixedDimensions } : node.style;
};

const pickOutputHandle = (handles: ScriptHandleType[], preferred?: ScriptHandleType | null) => {
  if (preferred && handles.includes(preferred)) return preferred;
  return handles[0] || null;
};

const pickInputHandle = (
  handles: ScriptHandleType[],
  preferred?: ScriptHandleType | null,
  existingHandleId?: string | null
) => {
  if (existingHandleId === "image" || existingHandleId === "text") {
    if (handles.includes(existingHandleId) && (!preferred || existingHandleId === preferred)) return existingHandleId;
  }
  if (preferred && handles.includes(preferred)) return preferred;
  return handles[0] || null;
};

const getScriptNodeHitAtPoint = (clientX: number, clientY: number, excludedNodeId?: string | null) => {
  if (typeof document === "undefined") return null;
  const magneticPadding = 46;
  let closest: { nodeId: string; side: "left" | "right"; distance: number } | null = null;

  for (const nodeElement of document.querySelectorAll<HTMLElement>(".react-flow__node")) {
    const nodeId = nodeElement.getAttribute("data-id");
    if (!nodeId || nodeId === excludedNodeId) continue;
    const rect = nodeElement.getBoundingClientRect();

    const insideMagneticBounds =
      clientX >= rect.left - magneticPadding &&
      clientX <= rect.right + magneticPadding &&
      clientY >= rect.top - magneticPadding &&
      clientY <= rect.bottom + magneticPadding;

    if (!insideMagneticBounds) continue;

    const dx = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
    const dy = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
    const distance = Math.hypot(dx, dy);

    if (!closest || distance < closest.distance) {
      closest = {
        nodeId,
        side: clientX < rect.left + rect.width / 2 ? "left" : "right",
        distance,
      };
    }
  }

  return closest ? { nodeId: closest.nodeId, side: closest.side } : null;
};

type ScriptAxisTarget =
  | { type: "head"; id: "head" }
  | { type: FoundationAxis; id: string };

const getScriptAxisTargetHitAtPoint = (clientX: number, clientY: number): ScriptAxisTarget | null => {
  if (typeof document === "undefined") return null;
  const magneticPadding = 18;
  let closest: { target: ScriptAxisTarget; distance: number } | null = null;

  for (const element of document.querySelectorAll<HTMLElement>("[data-axis-target-type]")) {
    const type = element.getAttribute("data-axis-target-type");
    const id = element.getAttribute("data-axis-target-id");
    if (!id || (type !== "head" && !isFoundationAxis(type))) continue;
    const rect = element.getBoundingClientRect();
    const inside =
      clientX >= rect.left - magneticPadding &&
      clientX <= rect.right + magneticPadding &&
      clientY >= rect.top - magneticPadding &&
      clientY <= rect.bottom + magneticPadding;
    if (!inside) continue;

    const dx = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
    const dy = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
    const distance = Math.hypot(dx, dy);
    if (!closest || distance < closest.distance) {
      closest = { target: { type, id } as ScriptAxisTarget, distance };
    }
  }

  return closest?.target || null;
};

const getDefaultScriptPosition = (index: number) => ({
  x: (index % 3) * 380,
  y: Math.floor(index / 3) * 330,
});

const getDefaultMarkdownPosition = (index: number) => ({
  x: 420 + (index % 2) * 360,
  y: 120 + Math.floor(index / 2) * 300,
});

const getDefaultFlowNodePosition = (index: number) => ({
  x: (index % 3) * 340 - 340,
  y: 420 + Math.floor(index / 3) * 280,
});

const createScriptFlowNodeId = (type: NodeType) => `script-flow-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const getSafeScriptNodePosition = (
  nodes: NodeFlowNode[],
  type: NodeType,
  requestedPosition: { x: number; y: number },
  node?: Pick<NodeFlowNode, "id" | "type" | "position" | "style" | "measured">
) =>
  findSafeNodeFlowPosition({
    nodes,
    type,
    requestedPosition,
    node,
  });

const createScriptNodeFlowContext = (projectData: ProjectData): NodeFlowContextSnapshot => ({
  projectId: projectData.activeFlowProjectId || projectData.flowProjects?.[0]?.id,
  rawScript: "",
  episodes: [],
  designAssets: projectData.designAssets || [],
  roles: projectData.roles || [],
});

const toRuntimeFlowNode = (node: NodeFlowNode, index: number): NodeFlowNode => ({
  ...node,
  position: node.position || getDefaultFlowNodePosition(index),
  measured: getFixedFlowNodeDimensionsForNode(node) || sanitizeScriptMeasured(node.measured),
  selected: false,
  style: getFlowNodeRenderStyle(node),
  data: {
    ...createDefaultNodeFlowNodeData(node.type),
    ...(node.data || {}),
  } as NodeFlowNodeData,
});

const isScriptRuntimeHandle = (handle?: string | null): handle is ScriptHandleType =>
  isTypedHandle(handle) || handle === "multi";

const toRuntimeScriptLink = (link: FlowState["links"][number]): NodeFlowLink => ({
  id: link.id,
  source: link.source,
  target: link.target,
  sourceHandle: isScriptRuntimeHandle(link.sourceHandle) ? link.sourceHandle : null,
  targetHandle: isScriptRuntimeHandle(link.targetHandle) ? link.targetHandle : null,
  data: link.data,
});

const getScriptNodeHandlesForType = (type?: FlowRenderNode["type"] | null) => {
  if (!type || type === "scriptPage" || type === "mdText") {
    return { inputs: ["image", "text"] as ScriptHandleType[], outputs: ["text"] as ScriptHandleType[] };
  }
  if (type === "folder") {
    return { inputs: ["text"] as ScriptHandleType[], outputs: ["text"] as ScriptHandleType[] };
  }
  const handles = getNodeHandles(type as NodeType);
  return {
    inputs: handles.inputs as ScriptHandleType[],
    outputs: handles.outputs as ScriptHandleType[],
  };
};



const FOUNDATION_BOUNDARY_HANDLE_ID = "foundation-boundary";

const withFoundationBoundaryHandle = (Component: React.ComponentType<any>) => {
  const NodeWithFoundationBoundaryHandle = (props: any) => (
    <>
      <Component {...props} />
      <Handle
        id={FOUNDATION_BOUNDARY_HANDLE_ID}
        type="target"
        position={Position.Bottom}
        isConnectable={false}
        className="foundation-boundary-handle"
      />
    </>
  );
  return NodeWithFoundationBoundaryHandle;
};

const FoundationProjectionAnchor = () => (
  <div className="foundation-projection-anchor" aria-hidden="true">
    <Handle id={FOUNDATION_BOUNDARY_HANDLE_ID} type="source" position={Position.Top} isConnectable={false} />
  </div>
);

const FoundationBoundaryEdge: React.FC<EdgeProps<FlowRenderEdge>> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
  selected,
  deletable,
  interactionWidth,
}) => {
  const transform = useStore((state) => state.transform);
  const [viewportX, viewportY, zoom] = transform;
  const safeZoom = Math.max(zoom || 1, 0.001);
  const targetBounds = data?.foundationTargetBounds;
  if (targetBounds && typeof window !== "undefined") {
    const viewportBounds = getViewportBounds(
      { x: viewportX, y: viewportY, zoom: safeZoom },
      getViewportWindowSize(),
      FOUNDATION_EDGE_OVERSCAN_RATIO,
      FOUNDATION_EDGE_MIN_OVERSCAN
    );
    if (!nodeBoundsIntersect(targetBounds, viewportBounds)) return null;
  }
  const hasProjectionSource =
    typeof data?.foundationSourceScreenX === "number" &&
    Number.isFinite(data.foundationSourceScreenX) &&
    typeof data?.foundationSourceScreenY === "number" &&
    Number.isFinite(data.foundationSourceScreenY);
  const projectedSourceX = hasProjectionSource
    ? ((data.foundationSourceScreenX as number) - viewportX) / safeZoom
    : sourceX;
  const projectedSourceY = hasProjectionSource
    ? ((data.foundationSourceScreenY as number) - viewportY) / safeZoom
    : sourceY;
  const [path, labelX, labelY] = getBezierPath({
    sourceX: projectedSourceX,
    sourceY: projectedSourceY,
    targetX,
    targetY,
    sourcePosition: sourcePosition || Position.Bottom,
    targetPosition: targetPosition || Position.Top,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={style}
        interactionWidth={interactionWidth || 28}
      />
      <EdgeDisconnectControl
        edgeId={id}
        labelX={labelX}
        labelY={labelY}
        selected={selected}
        deletable={deletable}
      />
    </>
  );
};

const nodeTypes: NodeTypes = {
  foundationAnchor: FoundationProjectionAnchor,
  folder: withFoundationBoundaryHandle(FolderNode),
  scriptPage: withFoundationBoundaryHandle(TextNode),
  text: withFoundationBoundaryHandle(TextNode),
  mdText: withFoundationBoundaryHandle(TextNode),
  imageInput: withFoundationBoundaryHandle(ImageInputNode),
  audioInput: withFoundationBoundaryHandle(AudioInputNode),
  videoInput: withFoundationBoundaryHandle(VideoInputNode),
  pdfInput: withFoundationBoundaryHandle(PdfInputNode),
  annotation: withFoundationBoundaryHandle(AnnotationNode),
  scriptBoard: withFoundationBoundaryHandle(ScriptBoardNode),
  lookbook: withFoundationBoundaryHandle(IdentityCardNode),
  pinoard: withFoundationBoundaryHandle(PinoardNode),
  identityCard: withFoundationBoundaryHandle(IdentityCardNode),
  imageGen: withFoundationBoundaryHandle(ImageGenNode),
  nanoBananaImageGen: withFoundationBoundaryHandle(NanoBananaImageGenNode),
  wanImageGen: withFoundationBoundaryHandle(WanImageGenNode),
  wanReferenceVideoGen: withFoundationBoundaryHandle(WanReferenceVideoGenNode),
  viduVideoGen: withFoundationBoundaryHandle(ViduVideoGenNode),
  seedanceVideoGen: withFoundationBoundaryHandle(SeedanceVideoGenNode),
};

const edgeTypes: EdgeTypes = {
  disconnectable: DisconnectableEdge,
  foundationBoundary: FoundationBoundaryEdge,
  wrapperMembership: WrapperMembershipEdge,
};

type ScriptFoundationProps = {
  timeline: FoundationScaffold;
  activeBlockId: string;
  onActiveBlockChange: (blockId: string) => void;
  onUpdateHead: (patch: Partial<FoundationProjectHead>) => void;
  onUpdateBlock: (blockId: string, patch: Partial<FoundationTimeBlock>) => void;
  onUpdateWeightedBlock: (axis: FoundationWeightedAxis, blockId: string, patch: Partial<FoundationSpaceBlock>) => void;
  onAddTimeBlock: (afterBlockId?: string) => void;
  onAddWeightedBlock: (axis: FoundationWeightedAxis, afterBlockId?: string) => void;
  onSplitBlock: (blockId: string) => void;
  onSplitWeightedBlock: (axis: FoundationWeightedAxis, blockId: string) => void;
  onDeleteBlock: (blockId: string) => void;
  onDeleteWeightedBlock: (axis: FoundationWeightedAxis, blockId: string) => void;
  onReorderBlock: (sourceBlockId: string, targetBlockId: string) => void;
  onReorderWeightedBlock: (axis: FoundationWeightedAxis, sourceBlockId: string, targetBlockId: string) => void;
  onResizeStart: (blockId: string, edge: "left" | "right", clientX: number, trackWidth: number) => void;
  onWeightedResizeStart: (axis: FoundationWeightedAxis, blockId: string, edge: "left" | "right", clientX: number, trackWidth: number) => void;
  axisRevealRequest: number;
  onCreateArchiveNode: () => void;
  onCreateScriptNode: () => void;
  onCreateFlowNode: (type: NodeType) => void;
  hasScriptPage: boolean;
  hasPinoard: boolean;
  onOpenAgent?: () => void;
  onSubmitAgentMessage?: (text: string) => void;
  agentComposerValue?: string;
  onAgentComposerChange?: (value: string) => void;
  onAgentComposerAction?: () => void;
  isAgentSending?: boolean;
  isAgentFirstMode?: boolean;
  onOpenProjectSettingsPanel?: (panel: FoundationGatewaySettingsPanel, assetsSection?: FoundationGatewayAssetsSection) => void;
  onOpenVisualLab?: (key?: "glassLab") => void;
  onOpenMarkdownCard?: () => void;
  onCloseMarkdownCard?: () => void;
  onFoundationProjectionChange?: (projection: ScriptFoundationProjection) => void;
  activeDockTray: BottomDockTray | null;
  onDockTrayChange: (tray: BottomDockTray | null) => void;
};

type ScriptAxisMode = FoundationAxis;

type ScriptFoundationMenuState =
  | { type: "head"; x: number; y: number }
  | { type: "block"; blockId: string; x: number; y: number };

type ScriptFoundationEditTarget =
  | { type: "head" }
  | { type: FoundationAxis; id: string };

const getFoundationMenuStyle = (x: number, y: number, menuWidth = 390): CSSProperties => {
  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 720 : window.innerHeight;
  return {
    "--timeline-menu-x": `${Math.min(Math.max(x, menuWidth / 2 + 12), viewportWidth - menuWidth / 2 - 12)}px`,
    "--timeline-menu-y": `${Math.min(Math.max(y, 180), viewportHeight - 104)}px`,
  } as CSSProperties;
};

const sanitizeScriptMeasured = (measured?: { width?: unknown; height?: unknown } | null): CanvasMeasuredSize | undefined => {
  if (!measured) return undefined;
  const width = typeof measured.width === "number" && Number.isFinite(measured.width) && measured.width > 0 ? measured.width : undefined;
  const height = typeof measured.height === "number" && Number.isFinite(measured.height) && measured.height > 0 ? measured.height : undefined;
  return width || height ? { width, height } : undefined;
};

const remapImportedFoundationNodeData = (
  data: NodeFlowNodeData,
  idMap: Map<string, string>
): NodeFlowNodeData => {
  const nextData = { ...data } as NodeFlowNodeData & {
    foundationParentId?: string;
    foundationContainerId?: string;
    boundaryNodeIds?: string[];
  };
  if (typeof nextData.foundationParentId === "string") {
    nextData.foundationParentId = idMap.get(nextData.foundationParentId) || nextData.foundationParentId;
  }
  if (typeof nextData.foundationContainerId === "string") {
    nextData.foundationContainerId = idMap.get(nextData.foundationContainerId) || nextData.foundationContainerId;
  }
  if (Array.isArray(nextData.boundaryNodeIds)) {
    nextData.boundaryNodeIds = nextData.boundaryNodeIds.map((nodeId) => idMap.get(nodeId) || nodeId);
  }
  return nextData;
};

const getFlowNodeVirtualSize = (node: Pick<NodeFlowNode, "type" | "style" | "measured" | "data">) => {
  const fixedDimensions = getFixedFlowNodeDimensionsForNode(node);
  if (fixedDimensions) return fixedDimensions;
  const measured = sanitizeScriptMeasured(node.measured);
  const style = node.style || {};
  const styleWidth = typeof style.width === "number" ? style.width : undefined;
  const styleHeight = typeof style.height === "number" ? style.height : undefined;
  const fallbackHeight =
    node.type === "pinoard"
      ? 278
      : node.type === "scriptPage"
      ? 249
      : node.type === "folder"
        ? 128
        : node.type === "mdText"
          ? 252
          : node.type === "imageInput"
            ? 440
            : node.type === "text"
              ? 256
              : 220;
  return {
    width: styleWidth || measured?.width || 320,
    height: styleHeight || measured?.height || fallbackHeight,
  };
};

const getViewportWindowSize = () => ({
  width: typeof window === "undefined" ? 1280 : window.innerWidth,
  height: typeof window === "undefined" ? 720 : window.innerHeight,
});

const getViewportBounds = (
  viewport: SharedCanvasViewport,
  viewportSize: { width: number; height: number },
  overscanRatio: number,
  minOverscan: number
): FlowViewportBounds => {
  const zoom = Math.max(viewport.zoom || 1, 0.001);
  const visibleWidth = viewportSize.width / zoom;
  const visibleHeight = viewportSize.height / zoom;
  const overscanX = Math.max(minOverscan, visibleWidth * overscanRatio);
  const overscanY = Math.max(minOverscan, visibleHeight * overscanRatio);
  const left = -viewport.x / zoom;
  const top = -viewport.y / zoom;
  return {
    left: left - overscanX,
    right: left + visibleWidth + overscanX,
    top: top - overscanY,
    bottom: top + visibleHeight + overscanY,
  };
};

const getVirtualizedViewportBounds = (
  viewport: SharedCanvasViewport,
  viewportSize: { width: number; height: number }
) => getViewportBounds(viewport, viewportSize, FLOW_VIRTUALIZATION_OVERSCAN_RATIO, FLOW_VIRTUALIZATION_MIN_OVERSCAN);

const nodeBoundsIntersect = (nodeBounds: FlowViewportBounds, viewportBounds: FlowViewportBounds) =>
  nodeBounds.right >= viewportBounds.left &&
  nodeBounds.left <= viewportBounds.right &&
  nodeBounds.bottom >= viewportBounds.top &&
  nodeBounds.top <= viewportBounds.bottom;

const getVirtualBucketKey = (bucketX: number, bucketY: number) => `${bucketX}:${bucketY}`;

const ScriptFoundation: React.FC<ScriptFoundationProps> = ({
  timeline,
  activeBlockId,
  onActiveBlockChange,
  onUpdateHead,
  onUpdateBlock,
  onUpdateWeightedBlock,
  onAddTimeBlock,
  onAddWeightedBlock,
  onSplitBlock,
  onSplitWeightedBlock,
  onDeleteBlock,
  onDeleteWeightedBlock,
  onReorderBlock,
  onReorderWeightedBlock,
  onResizeStart,
  onWeightedResizeStart,
  axisRevealRequest,
  onCreateArchiveNode,
  onCreateScriptNode,
  onCreateFlowNode,
  hasScriptPage,
  hasPinoard,
  onOpenAgent,
  onSubmitAgentMessage,
  agentComposerValue = "",
  onAgentComposerChange,
  onAgentComposerAction,
  isAgentSending = false,
  isAgentFirstMode = false,
  onOpenProjectSettingsPanel,
  onOpenVisualLab,
  onOpenMarkdownCard,
  onCloseMarkdownCard,
  onFoundationProjectionChange,
  activeDockTray,
  onDockTrayChange,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const agentComposerRef = useRef<HTMLTextAreaElement>(null);
  const clickTimerRef = useRef<number | null>(null);
  const axisSwitchTimerRef = useRef<number | null>(null);
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [activeAxis, setActiveAxis] = useState<ScriptAxisMode>("time");
  const [isAxisSwitching, setIsAxisSwitching] = useState(false);
  const [menuState, setMenuState] = useState<ScriptFoundationMenuState | null>(null);
  const [editingTarget, setEditingTarget] = useState<ScriptFoundationEditTarget | null>(null);
  const [dockTrayHost, setDockTrayHost] = useState<HTMLDivElement | null>(null);
  const isFoundationGatewayOpen = activeDockTray === "foundationCards";
  const isFoundationExpanded = activeDockTray === "foundation";
  const isAgentTailOpen = activeDockTray === "agent";
  const nodeCreateMenu = activeDockTray === "nodes";
  const availableScriptCreateOptions = useMemo(
    () => scriptCreateOptions.filter((option) =>
      (option.type !== "pinoard" || !hasPinoard) &&
      (option.type !== "scriptPage" || !hasScriptPage)
    ),
    [hasPinoard, hasScriptPage]
  );
  const head = timeline.head || DEFAULT_TIMELINE_HEAD;
  const weightedBlocksByAxis = useMemo(
    () => ({
      space: getWeightedAxisBlocks(timeline, "space"),
    }),
    [timeline]
  );
  const activeAxisBlocks = activeAxis === "time" ? timeline.blocks : weightedBlocksByAxis[activeAxis];
  const activeBlock =
    activeAxisBlocks.find((block) => block.id === activeBlockId) || activeAxisBlocks[0];
  const actionBlock =
    menuState?.type === "block"
      ? activeAxisBlocks.find((block) => block.id === menuState.blockId) || null
      : null;
  const editingBlock =
    editingTarget?.type && editingTarget.type !== "head"
      ? (editingTarget.type === "time" ? timeline.blocks : weightedBlocksByAxis[editingTarget.type])
          .find((block) => block.id === editingTarget.id) || null
      : null;
  const projectIndexMarkdown = useMemo(
    () => head.content?.trim() || buildTimelineMarkdown(timeline),
    [head.content, timeline]
  );
  const activeAxisDefinition = getFoundationAxisDefinition(activeAxis);
  const nextAxisDefinition = getFoundationAxisDefinition(getNextFoundationAxis(activeAxis));

  const closeMarkdownCard = useCallback(() => {
    setEditingTarget(null);
    if (activeDockTray === "foundationCards") onDockTrayChange(null);
    onCloseMarkdownCard?.();
  }, [activeDockTray, onCloseMarkdownCard, onDockTrayChange]);

  useEffect(
    () => () => {
      if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
      if (axisSwitchTimerRef.current) window.clearTimeout(axisSwitchTimerRef.current);
    },
    []
  );

  useEffect(() => {
    const textarea = agentComposerRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 44), 118)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 118 ? "auto" : "hidden";
  }, [agentComposerValue, isAgentTailOpen]);

  const switchAxisWithFilmMotion = useCallback(() => {
    if (axisSwitchTimerRef.current) window.clearTimeout(axisSwitchTimerRef.current);
    onDockTrayChange(null);
    setIsAxisSwitching(true);
    setMenuState(null);
    setEditingTarget(null);
    const nextAxis = getNextFoundationAxis(activeAxis);
    axisSwitchTimerRef.current = window.setTimeout(() => {
      setActiveAxis(nextAxis);
      const nextActiveBlockId = nextAxis === "time" ? timeline.blocks[0]?.id : weightedBlocksByAxis[nextAxis][0]?.id;
      if (nextActiveBlockId) onActiveBlockChange(nextActiveBlockId);
      setIsAxisSwitching(false);
      axisSwitchTimerRef.current = null;
    }, 180);
  }, [activeAxis, onActiveBlockChange, onDockTrayChange, timeline.blocks, weightedBlocksByAxis]);

  useEffect(() => {
    if (!axisRevealRequest) return;
    switchAxisWithFilmMotion();
  }, [axisRevealRequest, switchAxisWithFilmMotion]);

  useEffect(() => {
    if (!menuState && !nodeCreateMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          ".script-foundation-floating-menu, .script-foundation-block-menu-wrap, .script-foundation-node-menu-wrap, .script-foundation-node-popover, .script-foundation-block, .script-foundation-head-block, .script-foundation-tail"
        )
      ) {
        return;
      }
      setMenuState(null);
      if (activeDockTray === "nodes") onDockTrayChange(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [activeDockTray, menuState, nodeCreateMenu, onDockTrayChange]);

  useEffect(() => {
    if (!editingBlock && !isFoundationGatewayOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".script-foundation-md-card, .script-foundation-gateway-card")) return;
      closeMarkdownCard();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMarkdownCard();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMarkdownCard, editingBlock, isFoundationGatewayOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let animationFrame = 0;
    let isMounted = true;
    const measureTargets = () => {
      if (!isMounted) return;
      const next: Record<string, ScriptFoundationTargetPosition> = {};
      document.querySelectorAll<HTMLElement>("[data-axis-target-type][data-axis-target-id]").forEach((element) => {
        const type = element.dataset.axisTargetType;
        const id = element.dataset.axisTargetId;
        if (!type || !id) return;
        const rect = element.getBoundingClientRect();
        next[`${type}:${id}`] = {
          x: Math.round((rect.left + rect.width / 2) * 2) / 2,
          y: Math.round((rect.top + 5) * 2) / 2,
        };
      });
      onFoundationProjectionChange?.({ activeAxis, positions: next });
    };
    const scheduleMeasure = () => {
      if (!isMounted) return;
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(measureTargets);
    };
    scheduleMeasure();
    const timeouts = [window.setTimeout(scheduleMeasure, 140), window.setTimeout(scheduleMeasure, 320)];
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);
    document.addEventListener("transitionend", scheduleMeasure, true);
    return () => {
      isMounted = false;
      window.cancelAnimationFrame(animationFrame);
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      document.removeEventListener("transitionend", scheduleMeasure, true);
    };
  }, [activeAxis, activeAxisBlocks, isAgentTailOpen, onFoundationProjectionChange]);

  const handleResizePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    blockId: string,
    edge: "left" | "right"
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const trackWidth = trackRef.current?.getBoundingClientRect().width || 1;
    onResizeStart(blockId, edge, event.clientX, trackWidth);
  };

  const handleWeightedResizePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    blockId: string,
    edge: "left" | "right"
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const trackWidth = trackRef.current?.getBoundingClientRect().width || 1;
    if (activeAxis !== "time") onWeightedResizeStart(activeAxis, blockId, edge, event.clientX, trackWidth);
  };

  const openFoundationGateway = () => {
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    onOpenMarkdownCard?.();
    setMenuState(null);
    setEditingTarget(null);
    onDockTrayChange("foundationCards");
  };

  const handleHeadClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
    }
    if (event.detail > 1) {
      clickTimerRef.current = null;
      return;
    }
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      switchAxisWithFilmMotion();
    }, 220);
  };

  const handleHeadDoubleClick = () => {
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    openFoundationGateway();
  };

  const openGatewaySettingsPanel = (
    panel: FoundationGatewaySettingsPanel,
    assetsSection?: FoundationGatewayAssetsSection
  ) => {
    onOpenProjectSettingsPanel?.(panel, assetsSection);
    onDockTrayChange(null);
    onCloseMarkdownCard?.();
  };

  const openGatewayVisualLab = (key: "glassLab") => {
    onOpenVisualLab?.(key);
    onDockTrayChange(null);
    onCloseMarkdownCard?.();
  };

  const handleBlockClick = (event: React.MouseEvent<HTMLDivElement>, blockId: string) => {
    if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
    const { clientX, clientY } = event;
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      onActiveBlockChange(blockId);
      setMenuState((current) =>
        current?.type === "block" && current.blockId === blockId ? null : { type: "block", blockId, x: clientX, y: clientY }
      );
      setEditingTarget(null);
    }, 170);
  };

  const handleBlockDoubleClick = (blockId: string) => {
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    onOpenMarkdownCard?.();
    onActiveBlockChange(blockId);
    setMenuState(null);
    if (activeDockTray === "foundationCards") onDockTrayChange(null);
    setEditingTarget({ type: activeAxis, id: blockId });
  };

  const handleTailNodeClick = () => {
    onDockTrayChange(nodeCreateMenu ? null : "nodes");
    setMenuState(null);
    setEditingTarget(null);
  };

  const runNodeCreateAction = (action: () => void) => {
    action();
    onDockTrayChange(null);
  };

  const handleAgentTailSend = () => {
    const text = agentComposerValue.trim();
    if (text) {
      if (onAgentComposerAction) {
        onAgentComposerAction();
        return;
      }
      onSubmitAgentMessage?.(text);
      onAgentComposerChange?.("");
      return;
    }
    if (onAgentComposerAction) {
      onAgentComposerAction();
      return;
    }
    onOpenAgent?.();
  };

  return (
    <>
      <div
        className={`script-foundation-dock script-foundation-filmstrip ${isAgentTailOpen ? "is-agent-open" : ""} ${isAxisSwitching ? "is-axis-switching" : ""}`}
        data-foundation-expanded={isFoundationExpanded}
        data-dock-expanded={activeDockTray !== null}
        data-dock-tray={activeDockTray || "none"}
        aria-label="剧本基地"
      >
        <div
          ref={setDockTrayHost}
          id="script-foundation-dock-tray-host"
          className="script-foundation-dock__tray"
          aria-live="polite"
        />
        <div className="script-foundation-dock__bar">
        <div
          id="script-foundation-account-host"
          className="script-foundation-account-host"
          aria-label="Account control"
        />

        <button
          type="button"
          className={`script-foundation-bar-label script-foundation-bar-label--foundation ${isFoundationExpanded && !isAgentTailOpen ? "is-active" : ""}`}
          onClick={() => {
            onDockTrayChange(isFoundationExpanded ? null : "foundation");
            setMenuState(null);
            setEditingTarget(null);
          }}
          title={isFoundationExpanded && !isAgentTailOpen ? "收起 Foundation" : "展开 Foundation"}
          aria-label={isFoundationExpanded && !isAgentTailOpen ? "收起 Foundation" : "展开 Foundation"}
          aria-expanded={isFoundationExpanded && !isAgentTailOpen}
        >
          <span className="script-foundation-bar-label__icon" aria-hidden="true">
            {activeAxis === "time" ? (
              <Clock3 size={15} strokeWidth={1.9} />
            ) : (
              <MapIcon size={15} strokeWidth={1.9} />
            )}
          </span>
        </button>

        {isFoundationExpanded && dockTrayHost ? createPortal(
        <div className="script-foundation-axis-body">
          <div className="script-foundation-ribbon-background" aria-hidden="true" />
          <button
            type="button"
            className="script-foundation-head-block"
            data-axis-target-type="head"
            data-axis-target-id="head"
            data-axis-active={activeAxis}
            onClick={handleHeadClick}
            onDoubleClick={handleHeadDoubleClick}
            title={`切换到${nextAxisDefinition.label}`}
          >
            <span className="script-foundation-head-icon" aria-hidden="true">
              {activeAxis === "time" ? (
                <Clock3 size={17} strokeWidth={1.9} />
              ) : (
                <MapIcon size={17} strokeWidth={1.9} />
              )}
            </span>
          </button>

          <div ref={trackRef} className="script-foundation-track">
              {activeAxisBlocks.map((block, axisIndex, axisBlocks) => {
                const weightedWidthTotal = activeAxis === "time"
                  ? 1
                  : weightedBlocksByAxis[activeAxis].reduce((sum, item) => sum + Math.max(0.45, item.width), 0) || 1;
                const width =
                  activeAxis === "time"
                    ? Math.max(6, ((block as FoundationTimeBlock).durationMin / timeline.durationMin) * 100)
                    : Math.max(8, ((block as FoundationSpaceBlock).width / weightedWidthTotal) * 100);
                const timeBlock = block as FoundationTimeBlock;
                const previousBlock = axisBlocks[axisIndex - 1];
                const nextBlock = axisBlocks[axisIndex + 1];
                const joinsPrev = previousBlock?.color === block.color;
                const joinsNext = nextBlock?.color === block.color;
                const isActive = block.id === activeBlock?.id;
                const boundaryCount = block.boundaryNodeIds.length;
                return (
                  <React.Fragment key={block.id}>
                    <div
                      data-axis-target-type={activeAxis}
                      data-axis-target-id={block.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${block.title}，双击打开块档案`}
                      title={`${block.title} · 双击打开块档案文档`}
                      draggable
                      onDragStart={(event) => {
                        setDraggingBlockId(block.id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", block.id);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const sourceId = event.dataTransfer.getData("text/plain") || draggingBlockId;
                        if (sourceId && sourceId !== block.id) {
                          if (activeAxis === "time") onReorderBlock(sourceId, block.id);
                          else onReorderWeightedBlock(activeAxis, sourceId, block.id);
                        }
                        setDraggingBlockId(null);
                      }}
                      onDragEnd={() => setDraggingBlockId(null)}
                      onClick={(event) => handleBlockClick(event, block.id)}
                      onDoubleClick={() => handleBlockDoubleClick(block.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") handleBlockDoubleClick(block.id);
                      }}
                      className={`script-foundation-block is-${block.color} ${joinsPrev || joinsNext ? "is-segment" : "is-block"} ${joinsPrev ? "joins-prev" : ""} ${joinsNext ? "joins-next" : ""} ${isActive ? "is-active" : ""} ${draggingBlockId === block.id ? "is-dragging" : ""}`}
                      style={{ flexBasis: `${width}%`, "--axis-index": axisIndex } as CSSProperties}
                    >
                      <div className="script-foundation-block__inner">
                        <strong>{block.title}</strong>
                        <div className="script-foundation-block__meta">
                          <span>
                            {activeAxis === "time"
                              ? `${formatTimelineTime(timeBlock.startMin)}-${formatTimelineTime(timeBlock.startMin + timeBlock.durationMin)}`
                              : activeAxisDefinition.label}
                          </span>
                          <span>
                            {boundaryCount
                              ? `${boundaryCount} 连接`
                              : activeAxis === "time"
                                ? `${timeBlock.durationMin} min`
                                : activeAxisDefinition.blockLabel}
                          </span>
                        </div>
                      </div>
                    </div>
                    {axisIndex < axisBlocks.length - 1 ? (
                      <span
                        className={`script-foundation-boundary is-${block.color} ${nextBlock?.color === block.color ? "is-segment-boundary" : ""}`}
                      >
                        <button
                          type="button"
                          className="script-foundation-resize"
                          aria-label={activeAxis === "time" ? "调整相邻区间边界" : `调整相邻${activeAxisDefinition.blockLabel}边界`}
                          onPointerDown={(event) =>
                            activeAxis === "time"
                              ? handleResizePointerDown(event, block.id, "right")
                              : handleWeightedResizePointerDown(event, block.id, "right")
                          }
                        />
                      </span>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </div>
          </div>,
          dockTrayHost
        ) : null}

        <div
          id="script-foundation-viewport-host"
          className="script-foundation-viewport-host"
          aria-label="Viewport controls"
        />

        {isAgentTailOpen && dockTrayHost ? createPortal(
            <div className="script-foundation-tail-composer stylo-surface">
              <textarea
                ref={agentComposerRef}
                value={agentComposerValue}
                rows={1}
                placeholder=""
                aria-label="向 Stylo Agent 输入消息"
                onChange={(event) => onAgentComposerChange?.(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    handleAgentTailSend();
                  }
                  if (event.key === "Escape") {
                    onDockTrayChange(null);
                  }
                }}
              />
            </div>,
            dockTrayHost
          ) : null}

        <div className="script-foundation-tail">
            <div className="script-foundation-tail-labels">
              <button
                type="button"
                className={`script-foundation-bar-label script-foundation-bar-label--nodes ${nodeCreateMenu ? "is-active" : ""}`}
                onClick={handleTailNodeClick}
                title="新增节点"
                aria-label="新增节点"
                aria-expanded={!!nodeCreateMenu}
              >
                <span className="script-foundation-bar-label__icon" aria-hidden="true">
                  <Network size={15} strokeWidth={1.85} />
                </span>
              </button>
              <button
                type="button"
                className={`script-foundation-bar-label script-foundation-bar-label--agent ${isAgentTailOpen ? "script-foundation-tail-send is-active" : ""} ${isAgentSending ? "is-sending" : ""}`}
                onClick={() => {
                  if (isAgentTailOpen) {
                    handleAgentTailSend();
                    return;
                  }
                  onDockTrayChange("agent");
                  setMenuState(null);
                  setEditingTarget(null);
                }}
                title={isAgentTailOpen ? (isAgentSending ? "停止 Agent" : "发送给 Agent") : "打开 Agent"}
                aria-label={isAgentTailOpen ? (isAgentSending ? "停止 Agent" : "发送给 Agent") : "打开 Agent"}
                aria-expanded={isAgentTailOpen}
              >
                <span className="script-foundation-bar-label__icon" aria-hidden="true">
                  {isAgentTailOpen ? (
                    isAgentSending ? <Square size={13} strokeWidth={2} /> : <ArrowUp size={16} weight="bold" />
                  ) : (
                    <Bot size={15} strokeWidth={1.85} />
                  )}
                </span>
              </button>
            </div>
        </div>

        </div>
      </div>

      {nodeCreateMenu && dockTrayHost ? createPortal(
          <section className="script-foundation-node-popover script-foundation-node-palette">
            <header className="script-foundation-node-palette__head">
              <span>新增节点</span>
              <strong>文档、素材与生成流</strong>
            </header>
            <div className="script-foundation-node-palette__groups">
              {scriptCreateGroups.map((group) => {
                const options = availableScriptCreateOptions.filter((option) => option.group === group.key);
                if (!options.length) return null;
                return (
                  <div key={group.key} className="script-foundation-node-group">
                    <p>{group.label}</p>
                    <div className="script-foundation-node-grid">
                      {options.map(({ label, hint, type, Icon, meta, tone, surface, disabled, disabledHint }) => (
                        <button
                          key={type}
                          type="button"
                          className={`script-foundation-node-card ${tone} ${disabled ? "is-disabled" : ""}`}
                          data-surface={surface}
                          data-meta={meta}
                          disabled={disabled}
                          onClick={() => {
                            if (disabled) return;
                            runNodeCreateAction(() => {
                              if (type === "scriptPage") {
                                onCreateScriptNode();
                                return;
                              }
                              if (type === "mdText") {
                                onCreateArchiveNode();
                                return;
                              }
                              onCreateFlowNode(type);
                            });
                          }}
                        >
                          <span className="script-foundation-node-card__icon">
                            <Icon size={16} />
                          </span>
                          <span className="script-foundation-node-card__body">
                            <span className="script-foundation-node-card__meta">{meta}</span>
                            <strong>{label}</strong>
                            <small>{disabledHint || hint}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>,
          dockTrayHost
      ) : null}

      {actionBlock && menuState?.type === "block" ? (
        <div className="script-foundation-block-menu-wrap" style={getFoundationMenuStyle(menuState.x, menuState.y, 230)}>
          <section className="script-foundation-floating-menu script-foundation-action-popover">
            <div className="script-foundation-action-row">
              <button
                type="button"
                onClick={() =>
                  activeAxis === "time"
                    ? onAddTimeBlock(actionBlock.id)
                    : onAddWeightedBlock(activeAxis, actionBlock.id)
                }
                disabled={activeAxis === "time" && (actionBlock as FoundationTimeBlock).durationMin < MIN_TIMELINE_BLOCK_MINUTES * 2}
                title={`新增${activeAxisDefinition.blockLabel}`}
              >
                <Plus size={14} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={() => (activeAxis === "time" ? onSplitBlock(actionBlock.id) : onSplitWeightedBlock(activeAxis, actionBlock.id))}
                disabled={activeAxis === "time" && (actionBlock as FoundationTimeBlock).durationMin < MIN_TIMELINE_BLOCK_MINUTES * 2}
                title={`拆分${activeAxisDefinition.blockLabel}`}
              >
                <Scissors size={14} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={() => (activeAxis === "time" ? onDeleteBlock(actionBlock.id) : onDeleteWeightedBlock(activeAxis, actionBlock.id))}
                disabled={activeAxisBlocks.length <= 1}
                className="is-danger"
                title={`删除${activeAxisDefinition.blockLabel}`}
              >
                <Trash2 size={14} strokeWidth={1.8} />
              </button>
            </div>
            <div className="script-foundation-color-list">
              {TIMELINE_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  className={`script-foundation-color is-${color.value} ${actionBlock.color === color.value ? "is-active" : ""}`}
                  onClick={() =>
                    activeAxis === "time"
                      ? onUpdateBlock(actionBlock.id, { color: color.value })
                      : onUpdateWeightedBlock(activeAxis, actionBlock.id, { color: color.value })
                  }
                  title={color.name}
                />
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {isFoundationGatewayOpen && dockTrayHost ? createPortal(
        <section className="script-foundation-gateway" role="dialog" aria-label="Foundation 卡牌组">
          <div className="script-foundation-gateway__grid">
              <article className="script-foundation-gateway-card script-foundation-gateway-card--index">
                <div className="script-foundation-gateway-card__title">
                  <span className="script-foundation-gateway-card__icon">
                    <FileText size={18} strokeWidth={1.9} />
                  </span>
                  <div>
                    <span>Index Card</span>
                    <strong>{head.title || "项目索引"}</strong>
                  </div>
                </div>
                <textarea value={projectIndexMarkdown} readOnly />
              </article>

              <article className="script-foundation-gateway-card">
                <div className="script-foundation-gateway-card__title">
                  <span className="script-foundation-gateway-card__icon">
                    <Boxes size={18} strokeWidth={1.9} />
                  </span>
                  <div>
                    <span>Project Setting</span>
                    <strong>Assets</strong>
                  </div>
                </div>
                <p>项目素材组，按图片、视频和提示词进入对应资产视图。</p>
                <div className="script-foundation-gateway-card__chips">
                  {[
                    { key: "images" as const, label: "Images" },
                    { key: "videos" as const, label: "Videos" },
                    { key: "prompts" as const, label: "Prompts" },
                  ].map((item) => (
                    <button key={item.key} type="button" onClick={() => openGatewaySettingsPanel("assets", item.key)}>
                      {item.label}
                    </button>
                  ))}
                </div>
              </article>

              <button
                type="button"
                className="script-foundation-gateway-card"
                onClick={() => openGatewaySettingsPanel("skills")}
              >
                <span className="script-foundation-gateway-card__title">
                  <span className="script-foundation-gateway-card__icon">
                    <Sparkles size={18} strokeWidth={1.9} />
                  </span>
                  <span>
                    <span>Project Setting</span>
                    <strong>Skills</strong>
                  </span>
                </span>
                <span className="script-foundation-gateway-card__copy">内建工作方法和能力模块。</span>
              </button>

              <article className="script-foundation-gateway-card">
                <div className="script-foundation-gateway-card__title">
                  <span className="script-foundation-gateway-card__icon">
                    <ScanSearch size={18} strokeWidth={1.9} />
                  </span>
                  <div>
                    <span>Project</span>
                    <strong>Visual Lab</strong>
                  </div>
                </div>
                <p>进入 Project 中的视觉实验模块。</p>
                <div className="script-foundation-gateway-card__chips">
                  <button type="button" onClick={(event) => { event.stopPropagation(); openGatewayVisualLab("glassLab"); }}>
                    Glass
                  </button>
                </div>
              </article>
          </div>
        </section>,
        dockTrayHost
      ) : null}

      {editingBlock ? (
        <section
          className="script-foundation-md-card"
          role="dialog"
          aria-label={`编辑${editingTarget?.type && editingTarget.type !== "head" ? getFoundationAxisDefinition(editingTarget.type).blockLabel : "块"}档案`}
        >
            <input
              className="script-foundation-md-title"
              value={editingBlock.title}
              onChange={(event) =>
                editingTarget?.type === "time"
                  ? onUpdateBlock(editingBlock.id, { title: event.target.value })
                  : editingTarget?.type && editingTarget.type !== "head"
                    ? onUpdateWeightedBlock(editingTarget.type, editingBlock.id, { title: event.target.value })
                    : undefined
              }
            />
          <div className="script-foundation-md-meta">
            <span>{editingTarget?.type && editingTarget.type !== "head" ? `${getFoundationAxisDefinition(editingTarget.type).blockLabel}档案` : "块档案"}</span>
            <strong>
              {editingTarget?.type === "time"
                ? `${formatTimelineTime((editingBlock as FoundationTimeBlock).startMin)}-${formatTimelineTime((editingBlock as FoundationTimeBlock).startMin + (editingBlock as FoundationTimeBlock).durationMin)}`
                : `权重 ${(editingBlock as FoundationSpaceBlock).width.toFixed(2)}`}
            </strong>
            <span>{editingBlock.boundaryNodeIds.length} 个连接节点</span>
          </div>
          <div className="script-foundation-md-body">
            <textarea
              value={editingBlock.content}
              onChange={(event) =>
                editingTarget?.type === "time"
                  ? onUpdateBlock(editingBlock.id, { content: event.target.value })
                  : editingTarget?.type && editingTarget.type !== "head"
                    ? onUpdateWeightedBlock(editingTarget.type, editingBlock.id, { content: event.target.value })
                    : undefined
              }
              placeholder="Markdown"
            />
          </div>
        </section>
      ) : null}
    </>
  );
};

export const useFlowSurface = ({
  projectData,
  setProjectData,
  onOpenScriptDocument,
  onOpenLookbook,
  onOpenPinoard,
  focusedWrapperId = null,
  canvasControls,
  screenToFlowPosition,
  isActive = false,
  isWritingEditorOpen,
  onCollapseCanvasCards,
  onRestoreCanvasCards,
  onOpenAgent,
  onSubmitAgentMessage,
  agentComposerValue,
  onAgentComposerChange,
  onAgentComposerAction,
  isAgentSending,
  isAgentFirstMode,
  onOpenProjectSettingsPanel,
  onOpenVisualLab,
  pendingScriptReviewNodeIds,
  activeDockTray,
  onDockTrayChange,
}: Props): CanvasSurfaceConfig => {
  const {
    isLocked,
    snapToGrid,
    onAlignmentGuideChange,
    viewport,
  } = canvasControls;
  const [connectionDrop, setConnectionDrop] = useState<ScriptConnectionDropState | null>(null);
  const [activeTimelineBlockId, setActiveTimelineBlockId] = useState("");
  const [axisRevealRequest, setAxisRevealRequest] = useState(0);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set());
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<ReadonlySet<string>>(() => new Set());
  const [foundationProjection, setFoundationProjection] = useState<ScriptFoundationProjection>({
    activeAxis: "time",
    positions: {},
  });
  const [viewportWindowSize, setViewportWindowSize] = useState(getViewportWindowSize);
  const [showFoundationNodes, setShowFoundationNodes] = useState(false);
  const [activePdfNodeId, setActivePdfNodeId] = useState<string | null>(null);
  const [inputNodeContextMenu, setInputNodeContextMenu] = useState<InputNodeContextMenuState | null>(null);
  const inputNodeClipboardRef = useRef<NodeFlowNode | null>(null);
  const axisRevealTriggeredRef = useRef(false);
  const applyingFlowRuntimeRef = useRef(false);
  const wrapperClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperMotionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperToggleLockRef = useRef(new Map<string, number>());
  const [wrapperMemberMotion, setWrapperMemberMotion] = useState<WrapperMemberMotion | null>(null);
  const { deleteElements } = useReactFlow<FlowRenderNode, FlowRenderEdge>();
  const updateNodeInternals = useUpdateNodeInternals();
  const { runImageGen, runVideoGen } = useNodeFlowExecutor();
  const flow = useMemo(() => ensureFlow(projectData.flow), [projectData.flow]);
  const flowProjects = useMemo(() => getFlowProjectsForState(projectData), [projectData]);
  const activeFlowProjectId = projectData.activeFlowProjectId || flowProjects[0]?.id || "flow-project-main";
  const activeFlowProject = useMemo(
    () => flowProjects.find((project) => project.id === activeFlowProjectId) || flowProjects[0],
    [activeFlowProjectId, flowProjects]
  );
  const hydratedStyloProjectRef = useRef(activeFlowProjectId);

  useEffect(() => () => {
    if (wrapperClickTimerRef.current) clearTimeout(wrapperClickTimerRef.current);
    if (wrapperMotionTimerRef.current) clearTimeout(wrapperMotionTimerRef.current);
    wrapperToggleLockRef.current.clear();
  }, []);

  useEffect(() => {
    if (hydratedStyloProjectRef.current === activeFlowProjectId) return;
    hydratedStyloProjectRef.current = activeFlowProjectId;
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
    setInputNodeContextMenu(null);
    inputNodeClipboardRef.current = null;
    useNodeFlowStore.setState((state) => ({
      ...state,
      ...createIdleNodeFlowExecutionState(),
      ...createEmptyNodeFlowApprovalState(),
    }));
  }, [activeFlowProjectId]);

  useEffect(() => {
    const liveIds = new Set(flow.links.map((link) => link.id));
    setSelectedEdgeIds((current) => {
      const next = new Set(Array.from(current).filter((edgeId) => liveIds.has(edgeId)));
      return next.size === current.size ? current : next;
    });
  }, [flow.links]);
  const foundationGraph = useMemo(
    () =>
      parseFoundationGraph(flow, {
        rootNodeId: activeFlowProject?.rootNodeId || `${FOUNDATION_ROOT_NODE_PREFIX}${activeFlowProjectId}`,
        title: activeFlowProject?.title || projectData.fileName || "主项目",
        durationMin: activeFlowProject?.durationMin || DEFAULT_TIMELINE_DURATION,
      }),
    [activeFlowProject?.durationMin, activeFlowProject?.rootNodeId, activeFlowProject?.title, activeFlowProjectId, flow, projectData.fileName]
  );
  const timeline = foundationGraph.timeline;
  const foundationWeightedBlocksByAxis = useMemo(
    () => ({
      space: getWeightedAxisBlocks(timeline, "space"),
    }),
    [timeline]
  );
  const allFoundationBlocks = useMemo(
    () => [...timeline.blocks, ...foundationWeightedBlocksByAxis.space],
    [foundationWeightedBlocksByAxis, timeline.blocks]
  );
  const foundationScaffoldNodeIds = useMemo(
    () =>
      getFoundationScaffoldNodeIds(flow, {
        rootNodeId: activeFlowProject?.rootNodeId || `${FOUNDATION_ROOT_NODE_PREFIX}${activeFlowProjectId}`,
        title: activeFlowProject?.title || projectData.fileName || "主项目",
        durationMin: activeFlowProject?.durationMin || DEFAULT_TIMELINE_DURATION,
      }),
    [activeFlowProject?.durationMin, activeFlowProject?.rootNodeId, activeFlowProject?.title, activeFlowProjectId, flow, projectData.fileName]
  );
  const flowRuntimeContext = useMemo(() => createScriptNodeFlowContext(projectData), [projectData]);

  const handleFoundationProjectionChange = useCallback((next: ScriptFoundationProjection) => {
    setFoundationProjection((current) =>
      current.activeAxis === next.activeAxis && JSON.stringify(current.positions) === JSON.stringify(next.positions)
        ? current
        : next
    );
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let animationFrame = 0;
    const handleResize = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        setViewportWindowSize(getViewportWindowSize());
      });
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  useEffect(() => {
    if (!isActive || !activeFlowProject) return;
    setProjectData((previous) => {
      const now = Date.now();
      const projects = getFlowProjectsForState(previous);
      const activeId = previous.activeFlowProjectId || projects[0]?.id || activeFlowProject.id;
      const project = projects.find((item) => item.id === activeId) || activeFlowProject;
      const rootNodeId = project.rootNodeId || `${FOUNDATION_ROOT_NODE_PREFIX}${project.id}`;
      const currentFlow = ensureFlow(previous.flow);
      const nextFlow = ensureFoundationGraphSkeleton(currentFlow, {
        rootNodeId,
        title: project.title,
        durationMin: project.durationMin,
      });
      if (nextFlow === currentFlow && project.rootNodeId === rootNodeId) return previous;
      const nextProjects = projects.map((item) =>
        item.id === activeId
          ? {
              ...item,
              rootNodeId,
              updatedAt: now,
              flow: nextFlow,
            }
          : item
      );
      return {
        ...previous,
        activeFlowProjectId: activeId,
        flow: nextFlow,
        flowProjects: nextProjects,
      };
    });
  }, [activeFlowProject, isActive, setProjectData]);

  const foundationBlockVisuals = useMemo(() => {
    const visuals = new Map<string, { axis: ScriptAxisMode; color: string }>();
    timeline.blocks.forEach((block) => visuals.set(block.id, { axis: "time", color: block.color }));
    (Object.entries(foundationWeightedBlocksByAxis) as Array<[FoundationWeightedAxis, FoundationSpaceBlock[]]>).forEach(
      ([axis, blocks]) => blocks.forEach((block) => visuals.set(block.id, { axis, color: block.color }))
    );
    return visuals;
  }, [foundationWeightedBlocksByAxis, timeline.blocks]);

  const flowNodeById = useMemo(
    () => new Map((flow.flowNodes || []).map((node) => [node.id, node])),
    [flow.flowNodes]
  );

  const shouldVirtualizeFlow = (flow.flowNodes || []).length >= FLOW_VIRTUALIZATION_MIN_NODES;

  const virtualizedNodeIndex = useMemo(() => {
    const buckets = new Map<string, string[]>();
    const boundsById = new Map<string, { left: number; right: number; top: number; bottom: number }>();
    (flow.flowNodes || []).forEach((node) => {
      const size = getFlowNodeVirtualSize(node);
      const left = node.position?.x || 0;
      const top = node.position?.y || 0;
      const right = left + size.width;
      const bottom = top + size.height;
      boundsById.set(node.id, { left, right, top, bottom });
      const minBucketX = Math.floor(left / FLOW_VIRTUALIZATION_BUCKET_SIZE);
      const maxBucketX = Math.floor(right / FLOW_VIRTUALIZATION_BUCKET_SIZE);
      const minBucketY = Math.floor(top / FLOW_VIRTUALIZATION_BUCKET_SIZE);
      const maxBucketY = Math.floor(bottom / FLOW_VIRTUALIZATION_BUCKET_SIZE);
      for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX += 1) {
        for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY += 1) {
          const key = getVirtualBucketKey(bucketX, bucketY);
          const bucket = buckets.get(key);
          if (bucket) bucket.push(node.id);
          else buckets.set(key, [node.id]);
        }
      }
    });
    return { buckets, boundsById };
  }, [flow.flowNodes]);

  const virtualizedViewportBounds = useMemo(
    () => getVirtualizedViewportBounds(canvasControls.viewport, viewportWindowSize),
    [canvasControls.viewport, viewportWindowSize]
  );

  const visibleFlowNodeIds = useMemo(() => {
    if (focusedWrapperId || !shouldVirtualizeFlow) return null;
    const ids = new Set<string>();
    const minBucketX = Math.floor(virtualizedViewportBounds.left / FLOW_VIRTUALIZATION_BUCKET_SIZE);
    const maxBucketX = Math.floor(virtualizedViewportBounds.right / FLOW_VIRTUALIZATION_BUCKET_SIZE);
    const minBucketY = Math.floor(virtualizedViewportBounds.top / FLOW_VIRTUALIZATION_BUCKET_SIZE);
    const maxBucketY = Math.floor(virtualizedViewportBounds.bottom / FLOW_VIRTUALIZATION_BUCKET_SIZE);
    for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX += 1) {
      for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY += 1) {
        const bucket = virtualizedNodeIndex.buckets.get(getVirtualBucketKey(bucketX, bucketY));
        if (!bucket) continue;
        bucket.forEach((nodeId) => {
          if (ids.has(nodeId)) return;
          const bounds = virtualizedNodeIndex.boundsById.get(nodeId);
          if (!bounds) return;
          if (nodeBoundsIntersect(bounds, virtualizedViewportBounds)) {
            ids.add(nodeId);
          }
        });
      }
    }
    selectedNodeIds.forEach((nodeId) => ids.add(nodeId));
    return ids;
  }, [focusedWrapperId, selectedNodeIds, shouldVirtualizeFlow, virtualizedNodeIndex, virtualizedViewportBounds]);

  const foundationProjectionPositions = useMemo(() => {
    const positions = new Map<string, XYPosition>();
    if (showFoundationNodes || isWritingEditorOpen) return positions;
    const headPosition = foundationProjection.positions["head:head"];
    const viewport = canvasControls.viewport;
    const zoom = Math.max(viewport.zoom || 1, 0.001);
    foundationBlockVisuals.forEach((visual, blockId) => {
      const screenPosition =
        (visual.axis === foundationProjection.activeAxis
          ? foundationProjection.positions[`${visual.axis}:${blockId}`]
          : undefined) || headPosition;
      if (!screenPosition) return;
      positions.set(blockId, {
        x: (screenPosition.x - viewport.x) / zoom,
        y: (screenPosition.y - viewport.y) / zoom,
      });
    });
    return positions;
  }, [canvasControls.viewport, foundationBlockVisuals, foundationProjection, isWritingEditorOpen, showFoundationNodes]);

  const wrapperProjection = useMemo(
    () => buildWrapperProjection(flow.flowNodes || [], flow.links || []),
    [flow.flowNodes, flow.links]
  );
  const focusedWrapperMemberIds = useMemo(
    () => focusedWrapperId
      ? new Set(wrapperProjection.memberIdsByWrapper.get(focusedWrapperId) || [])
      : null,
    [focusedWrapperId, wrapperProjection.memberIdsByWrapper]
  );
  const focusedWrapperLayout = useMemo(
    () => buildFocusedWrapperLayout(Array.from(focusedWrapperMemberIds || [])),
    [focusedWrapperMemberIds]
  );
  const wrapperGeometrySignature = useMemo(
    () => JSON.stringify(
      Array.from(wrapperProjection.memberIdsByWrapper.entries())
        .map(([wrapperId, memberIds]) => [
          wrapperId,
          flowNodeById.get(wrapperId)?.data?.wrapperCollapsed === true,
          [...memberIds].sort(),
        ] as const)
        .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
    ),
    [flowNodeById, wrapperProjection.memberIdsByWrapper]
  );

  useEffect(() => {
    const entries = JSON.parse(wrapperGeometrySignature) as Array<
      readonly [string, boolean, string[]]
    >;
    const nodeIds = Array.from(
      new Set(entries.flatMap(([wrapperId, , memberIds]) => [wrapperId, ...memberIds]))
    );
    if (!nodeIds.length) return;

    const frameId = window.requestAnimationFrame(() => {
      updateNodeInternals(nodeIds);
    });
    const settleTimer = window.setTimeout(() => {
      updateNodeInternals(nodeIds);
    }, 520);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(settleTimer);
    };
  }, [updateNodeInternals, wrapperGeometrySignature]);

  const baseNodes = useMemo<FlowRenderNode[]>(() => {
    return (flow.flowNodes || [])
      .filter((node) => !visibleFlowNodeIds || visibleFlowNodeIds.has(node.id))
      .filter((node) => !focusedWrapperMemberIds || focusedWrapperMemberIds.has(node.id))
      .filter((node) => showFoundationNodes || !getFoundationNodeRole(node))
      .map((node, index) => {
        const memberMotionOrder = wrapperMemberMotion?.orderById[node.id];
        const isMotionMember = memberMotionOrder !== undefined;
        const fixedDimensions = getFixedFlowNodeDimensionsForNode(node);
        const wrapperMemberIds = wrapperProjection.memberIdsByWrapper.get(node.id) || [];
        const wrapperPreview = isManusFolderNode(node)
          ? wrapperMemberIds
              .map((memberId) => flowNodeById.get(memberId))
              .filter((member): member is NodeFlowNode => member?.type === "scriptPage")
              .sort((left, right) => {
                const leftPage = typeof left.data?.pageNumber === "number" ? left.data.pageNumber : Number.MAX_SAFE_INTEGER;
                const rightPage = typeof right.data?.pageNumber === "number" ? right.data.pageNumber : Number.MAX_SAFE_INTEGER;
                return leftPage - rightPage;
              })
              .map((member) => {
                const data = member.data as { preview?: string; content?: string; text?: string };
                return data.preview || data.content || data.text || "";
              })
              .find((value) => value.trim())
          : undefined;
        const baseStyle = getFlowNodeRenderStyle(node);
        const focusedLayout = focusedWrapperLayout.get(node.id);
        const motionStyle = isMotionMember
          ? {
              ...baseStyle,
              "--wrapper-motion-delay": `${Math.min(memberMotionOrder ?? 0, 8) * 18}ms`,
            } as CSSProperties & Record<`--wrapper-motion-${string}`, string>
          : baseStyle;
        const existingClassName = (node as NodeFlowNode & { className?: string }).className;
        return {
          ...node,
          position: focusedLayout?.position || node.position || getDefaultFlowNodePosition(index),
          measured: focusedLayout
            ? { width: focusedLayout.width, height: focusedLayout.height }
            : fixedDimensions || sanitizeScriptMeasured(node.measured),
          draggable: focusedLayout ? false : node.draggable,
          className: [
            existingClassName,
            isMotionMember ? `wrapper-member--${wrapperMemberMotion?.mode}` : "",
            focusedLayout ? "wrapper-focus-node" : "",
          ]
            .filter(Boolean)
            .join(" "),
          style: focusedLayout
            ? {
                ...motionStyle,
                width: focusedLayout.width,
                height: focusedLayout.height,
                minHeight: focusedLayout.height,
              }
            : motionStyle,
          hidden: focusedLayout ? false : wrapperProjection.hiddenNodeIds.has(node.id) && !isMotionMember,
          selected: selectedNodeIds.has(node.id),
          data: {
            ...createDefaultNodeFlowNodeData(node.type),
            ...(node.data || {}),
            wrapperMemberCount: wrapperMemberIds.length,
            wrapperRoot: isLookbookNodeType(node.type) || node.type === "pinoard" || isManusFolderNode(node),
            wrapperPreview,
            agentReviewPending: node.type === "scriptPage" && !!pendingScriptReviewNodeIds?.has(node.id),
          } as NodeFlowNodeData,
        };
      });
  }, [flow.flowNodes, flowNodeById, focusedWrapperLayout, focusedWrapperMemberIds, pendingScriptReviewNodeIds, selectedNodeIds, showFoundationNodes, visibleFlowNodeIds, wrapperMemberMotion, wrapperProjection]);

  const foundationBlockFolderNodes = useMemo(
    () =>
      (flow.flowNodes || []).filter(
        (node) =>
          getFoundationNodeRole(node) === "block-folder" &&
          (!showFoundationNodes || !visibleFlowNodeIds || visibleFlowNodeIds.has(node.id))
      ),
    [flow.flowNodes, showFoundationNodes, visibleFlowNodeIds]
  );

  const foundationProjectionAnchorNodes = useMemo<FlowRenderNode[]>(() => {
    if (showFoundationNodes || isWritingEditorOpen) return [];
    return foundationBlockFolderNodes.map((node, index) => ({
      ...node,
      type: "foundationAnchor",
      position: foundationProjectionPositions.get(node.id) || node.position || getDefaultFlowNodePosition(index),
      selected: false,
      draggable: false,
      selectable: false,
      connectable: false,
      deletable: false,
      style: { width: 1, height: 1, opacity: 0, pointerEvents: "none" },
      measured: { width: 1, height: 1 },
      data: node.data || createDefaultNodeFlowNodeData(node.type),
    }));
  }, [foundationBlockFolderNodes, foundationProjectionPositions, isWritingEditorOpen, showFoundationNodes]);

  const nodes = useMemo<FlowRenderNode[]>(
    () => [...baseNodes, ...foundationProjectionAnchorNodes],
    [baseNodes, foundationProjectionAnchorNodes]
  );

  const nodeIdSet = useMemo(() => {
    const ids = new Set(baseNodes.map((node) => node.id));
    if (!showFoundationNodes && !isWritingEditorOpen) {
      foundationBlockFolderNodes.forEach((node) => ids.add(node.id));
    }
    return ids;
  }, [baseNodes, foundationBlockFolderNodes, isWritingEditorOpen, showFoundationNodes]);

  const nodeTypeById = useMemo(() => new Map(baseNodes.map((node) => [node.id, node.type])), [baseNodes]);
  const flowRuntimeNodes = useMemo<NodeFlowNode[]>(
    () => (flow.flowNodes || []).map((node, index) => toRuntimeFlowNode(node, index)),
    [flow.flowNodes]
  );
  const flowRuntimeNodeIdSet = useMemo(
    () => new Set(flowRuntimeNodes.map((node) => node.id)),
    [flowRuntimeNodes]
  );
  const flowRuntimeLinks = useMemo<NodeFlowLink[]>(
    () =>
      flow.links
        .filter(
          (link) =>
            !isFolderMembershipLink(link) &&
            flowRuntimeNodeIdSet.has(link.source) &&
            flowRuntimeNodeIdSet.has(link.target)
        )
        .map(toRuntimeScriptLink),
    [flow.links, flowRuntimeNodeIdSet]
  );
  const edges = useMemo<FlowRenderEdge[]>(() => {
    return flow.links
      .filter((link) => nodeIdSet.has(link.source) && nodeIdSet.has(link.target))
      .map((link) => {
        const isWrapperMembership = link.data?.relation === LOOKBOOK_MEMBERSHIP_RELATION ||
          link.data?.relation === PINOARD_MEMBERSHIP_RELATION ||
          link.data?.relation === FOLDER_MEMBERSHIP_RELATION;
        const sourceIsMotionMember = wrapperMemberMotion?.orderById[link.source] !== undefined;
        const targetIsMotionMember = wrapperMemberMotion?.orderById[link.target] !== undefined;
        const isWrapperMotionEdge = sourceIsMotionMember || targetIsMotionMember;
        const isProjectedHiddenEdge = wrapperProjection.hiddenNodeIds.has(link.source) || wrapperProjection.hiddenNodeIds.has(link.target);
        const sourceVisual = foundationBlockVisuals.get(link.source);
        const targetRole = getFoundationNodeRole(flowNodeById.get(link.target));
        const isFoundationBoundary = Boolean(sourceVisual && !targetRole);
        const foundationSourceScreenPosition =
          isFoundationBoundary && sourceVisual
            ? (sourceVisual.axis === foundationProjection.activeAxis
                ? foundationProjection.positions[`${sourceVisual.axis}:${link.source}`]
                : undefined) || foundationProjection.positions["head:head"]
            : undefined;
        const isActiveBoundary = Boolean(
          sourceVisual &&
          isFoundationBlockSelectionActive(
            foundationProjection.activeAxis,
            activeTimelineBlockId,
            sourceVisual.axis,
            link.source
          )
        );
        return {
          id: link.id,
          source: link.source,
          target: link.target,
          sourceHandle: isFoundationBoundary ? FOUNDATION_BOUNDARY_HANDLE_ID : link.sourceHandle || "text",
          targetHandle: isFoundationBoundary ? FOUNDATION_BOUNDARY_HANDLE_ID : link.targetHandle || "text",
          type: isFoundationBoundary ? "foundationBoundary" : isWrapperMembership ? "wrapperMembership" : "disconnectable",
          animated: false,
          selected: selectedEdgeIds.has(link.id),
          hidden: isProjectedHiddenEdge && !isWrapperMotionEdge,
          className: [
            isWrapperMembership ? "wrapper-membership-edge" : "",
            isWrapperMotionEdge ? `wrapper-edge--${wrapperMemberMotion?.mode}` : "",
          ].filter(Boolean).join(" ") || undefined,
          deletable: !isFolderMembershipLink(link) && !isFoundationStructuralLink(flow, link),
          zIndex: isFoundationBoundary ? 2 : 0,
          data: isFoundationBoundary
            ? {
                foundationBoundary: true,
                foundationSourceScreenX: foundationSourceScreenPosition?.x,
                foundationSourceScreenY: foundationSourceScreenPosition?.y,
                foundationTargetBounds: virtualizedNodeIndex.boundsById.get(link.target),
              }
            : undefined,
          style: isFoundationBoundary
            ? {
                stroke: FOUNDATION_EDGE_COLORS[sourceVisual?.color || ""] || "var(--app-accent-strong)",
                strokeWidth: isActiveBoundary ? 2.65 : 1.8,
                opacity: isActiveBoundary ? 0.95 : 0.62,
              }
            : { stroke: "var(--app-accent-strong)", strokeWidth: 1.8 },
        };
      });
  }, [
    activeTimelineBlockId,
    flow,
    flowNodeById,
    foundationBlockVisuals,
    foundationProjection.activeAxis,
    foundationProjection.positions,
    nodeIdSet,
    selectedEdgeIds,
    virtualizedNodeIndex,
    wrapperMemberMotion,
    wrapperProjection.hiddenNodeIds,
  ]);

  const persistFlow = useCallback(
    (updater: (flow: FlowState, previous: ProjectData) => FlowState) => {
      setProjectData((previous) => {
        const nextFlow = updater(ensureFlow(previous.flow), previous);
        const nextData = {
          ...previous,
          activeFlowProjectId: previous.activeFlowProjectId || previous.flowProjects?.[0]?.id || "flow-project-main",
          flow: nextFlow,
        };
        return {
          ...nextData,
          flowProjects: saveActiveFlowIntoProjects(nextData),
        };
      });
    },
    [setProjectData]
  );

  const handleOrganizeFoundationScaffold = useCallback(() => {
    setConnectionDrop(null);
    setShowFoundationNodes(true);
    const rootNodeId = activeFlowProject?.rootNodeId || `${FOUNDATION_ROOT_NODE_PREFIX}${activeFlowProjectId}`;
    setSelectedNodeIds(new Set([rootNodeId]));
    persistFlow((currentFlow, previous) => {
      const projects = getFlowProjectsForState(previous);
      const project = projects.find((item) => item.id === (previous.activeFlowProjectId || activeFlowProjectId)) || activeFlowProject;
      return layoutFoundationGraph(currentFlow, {
        rootNodeId,
        title: project?.title || previous.fileName || "主项目",
        durationMin: project?.durationMin || DEFAULT_TIMELINE_DURATION,
      });
    });
  }, [activeFlowProject, activeFlowProjectId, persistFlow]);

  const handleSetFoundationNodeView = useCallback(
    (visible: boolean) => {
      setConnectionDrop(null);
      if (!visible) {
        setShowFoundationNodes(false);
        setSelectedNodeIds(new Set());
        return;
      }
      handleOrganizeFoundationScaffold();
    },
    [handleOrganizeFoundationScaffold]
  );

  useEffect(() => {
    if (!isActive) return;
    applyingFlowRuntimeRef.current = true;
    try {
      useNodeFlowStore.setState((state) => ({
        ...state,
        revision: flow.revision || 0,
        nodes: flowRuntimeNodes,
        links: flowRuntimeLinks,
        graphLinks: flow.graphLinks || [],
        globalAssetHistory: flow.globalAssetHistory || [],
        linkStyle: flow.linkStyle || "curved",
        activeView: flow.activeView ?? null,
        nodeFlowContext: flowRuntimeContext,
      }));
    } finally {
      applyingFlowRuntimeRef.current = false;
    }
  }, [flow.activeView, flow.globalAssetHistory, flow.graphLinks, flow.linkStyle, flow.revision, isActive, flowRuntimeContext, flowRuntimeNodes, flowRuntimeLinks]);

  useEffect(() => {
    if (!isActive) return undefined;
    return useNodeFlowStore.subscribe((state, previousState) => {
      if (applyingFlowRuntimeRef.current) return;
      if (
        state.revision === previousState.revision &&
        state.graphLinks === previousState.graphLinks &&
        state.globalAssetHistory === previousState.globalAssetHistory &&
        state.linkStyle === previousState.linkStyle &&
        state.activeView === previousState.activeView
      ) return;

      const storeNodeById = new Map(state.nodes.map((node) => [node.id, node]));
      const storeNodeIds = new Set(storeNodeById.keys());
      const storeLinks = state.links;

      persistFlow((currentFlow) => {
        const flowNodeIds = new Set((currentFlow.flowNodes || []).map((node) => node.id));
        const protectedNodeIds = [...flowNodeIds];
        const missingProtectedNodeIds = protectedNodeIds.filter((id) => !storeNodeIds.has(id));
        if (missingProtectedNodeIds.length > 0) return currentFlow;

        const currentFlowNodes = (currentFlow.flowNodes || [])
          .map((node, index) => {
            const storeNode = storeNodeById.get(node.id);
            if (!storeNode) {
              return {
                ...node,
                position: node.position || getDefaultFlowNodePosition(index),
                data: {
                  ...createDefaultNodeFlowNodeData(node.type),
                  ...(node.data || {}),
                } as NodeFlowNodeData,
              };
            }
            return {
              ...node,
              type: storeNode.type,
              position: storeNode.position || node.position || getDefaultFlowNodePosition(index),
              data: {
                ...createDefaultNodeFlowNodeData(storeNode.type),
                ...(storeNode.data || {}),
              } as NodeFlowNodeData,
              parentId: storeNode.parentId,
              extent: storeNode.extent,
              style: storeNode.style,
              measured: sanitizeScriptMeasured(storeNode.measured),
            };
          });
        const newStoreFlowNodes = state.nodes
          .filter((node) => !flowNodeIds.has(node.id))
          .map((node) => ({
            ...node,
            measured: sanitizeScriptMeasured(node.measured),
            selected: false,
            data: {
              ...createDefaultNodeFlowNodeData(node.type),
              ...(node.data || {}),
            } as NodeFlowNodeData,
          }));
        const nextFlowNodes = [...currentFlowNodes, ...newStoreFlowNodes];
        const allowedNodeIds = new Set(nextFlowNodes.map((node) => node.id));

        return {
          ...currentFlow,
          revision: state.revision,
          graphLinks: state.graphLinks,
          globalAssetHistory: state.globalAssetHistory,
          linkStyle: state.linkStyle,
          activeView: state.activeView,
          flowNodes: nextFlowNodes,
          links: storeLinks
            .filter((link) => allowedNodeIds.has(link.source) && allowedNodeIds.has(link.target))
            .map((link) => ({
              id: link.id,
              source: link.source,
              target: link.target,
              sourceHandle: isScriptRuntimeHandle(link.sourceHandle) ? link.sourceHandle : undefined,
              targetHandle: isScriptRuntimeHandle(link.targetHandle) ? link.targetHandle : undefined,
              data: link.data,
            })),
        };
      });
    });
  }, [isActive, persistFlow]);

  useEffect(() => {
    if (!timeline.blocks.length) return;
    const hasActiveBlock =
      allFoundationBlocks.some((block) => block.id === activeTimelineBlockId);
    if (!activeTimelineBlockId || !hasActiveBlock) {
      setActiveTimelineBlockId(timeline.blocks[0].id);
    }
  }, [activeTimelineBlockId, allFoundationBlocks, timeline.blocks]);

  const persistTimeline = useCallback(
    (updater: (timeline: FoundationScaffold) => FoundationScaffold) => {
      persistFlow((currentFlow, previous) => {
        const projects = getFlowProjectsForState(previous);
        const project = projects.find((item) => item.id === (previous.activeFlowProjectId || activeFlowProjectId)) || activeFlowProject;
        const rootNodeId = project?.rootNodeId || `${FOUNDATION_ROOT_NODE_PREFIX}${activeFlowProjectId}`;
        const projectDuration = project?.durationMin || DEFAULT_TIMELINE_DURATION;
        const currentTimeline = parseFoundationGraph(currentFlow, {
          rootNodeId,
          title: project?.title || previous.fileName || "主项目",
          durationMin: projectDuration,
        }).timeline;
        const nextTimeline = updater(currentTimeline);
        return applyFoundationTimelineToGraph(
          currentFlow,
          {
            rootNodeId,
            title: project?.title || previous.fileName || "主项目",
            durationMin: nextTimeline.durationMin || projectDuration,
          },
          {
            ...nextTimeline,
            blocks: recalculateTimelineBlocks(nextTimeline.blocks, nextTimeline.durationMin || projectDuration),
          }
        );
      });
    },
    [activeFlowProject, activeFlowProjectId, persistFlow]
  );

  const handleTimelineBlockUpdate = useCallback(
    (blockId: string, patch: Partial<FoundationTimeBlock>) => {
      persistTimeline((current) => ({
        ...current,
        blocks: current.blocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block)),
      }));
    },
    [persistTimeline]
  );

  const handleTimelineHeadUpdate = useCallback(
    (patch: Partial<FoundationProjectHead>) => {
      persistTimeline((current) => ({
        ...current,
        head: {
          ...(current.head || DEFAULT_TIMELINE_HEAD),
          ...patch,
        },
      }));
    },
    [persistTimeline]
  );

  const handleWeightedBlockUpdate = useCallback(
    (axis: FoundationWeightedAxis, blockId: string, patch: Partial<FoundationSpaceBlock>) => {
      persistTimeline((current) => setWeightedAxisBlocks(
        current,
        axis,
        getWeightedAxisBlocks(current, axis).map((block) =>
          block.id === blockId ? { ...block, ...patch } : block
        )
      ));
    },
    [persistTimeline]
  );

  const handleTimelineBlockAdd = useCallback(
    (afterBlockId?: string) => {
      persistTimeline((current) => {
        const blocks = current.blocks.slice().sort((a, b) => a.order - b.order);
        const requestedIndex = afterBlockId
          ? blocks.findIndex((block) => block.id === afterBlockId)
          : blocks.length - 1;
        const donorIndex = requestedIndex >= 0 ? requestedIndex : blocks.length - 1;
        const donor = blocks[donorIndex];
        if (!donor || donor.durationMin < MIN_TIMELINE_BLOCK_MINUTES * 2) return current;
        const durationMin = Math.max(
          MIN_TIMELINE_BLOCK_MINUTES,
          Math.min(12, Math.floor(donor.durationMin / 2))
        );
        blocks[donorIndex] = {
          ...donor,
          durationMin: donor.durationMin - durationMin,
        };
        const nextBlock: FoundationTimeBlock = {
          id: `timeline-block-${Date.now()}`,
          title: "新时间块",
          content: "",
          startMin: 0,
          durationMin,
          color: TIMELINE_COLORS[blocks.length % TIMELINE_COLORS.length].value,
          order: donorIndex + 1,
          boundaryNodeIds: [],
        };
        blocks.splice(donorIndex + 1, 0, nextBlock);
        return {
          ...current,
          blocks: blocks.map((block, order) => ({ ...block, order })),
        };
      });
    },
    [persistTimeline]
  );

  const handleWeightedBlockAdd = useCallback(
    (axis: FoundationWeightedAxis, afterBlockId?: string) => {
      persistTimeline((current) => {
        const blocks = getWeightedAxisBlocks(current, axis);
        const insertIndex = afterBlockId ? blocks.findIndex((block) => block.id === afterBlockId) + 1 : blocks.length;
        const safeIndex = insertIndex > 0 ? insertIndex : blocks.length;
        const definition = getFoundationAxisDefinition(axis);
        const nextBlock = createSpaceBlock(
          `${axis}-block-${Date.now()}`,
          `新${definition.blockLabel}`,
          safeIndex,
          0.9,
          TIMELINE_COLORS[blocks.length % TIMELINE_COLORS.length].value,
          ""
        );
        const nextBlocks = blocks.slice();
        nextBlocks.splice(safeIndex, 0, nextBlock);
        return setWeightedAxisBlocks(current, axis, nextBlocks.map((block, order) => ({ ...block, order })));
      });
    },
    [persistTimeline]
  );

  const handleTimelineBlockSplit = useCallback(
    (blockId: string) => {
      persistTimeline((current) => {
        const index = current.blocks.findIndex((block) => block.id === blockId);
        if (index < 0) return current;
        const block = current.blocks[index];
        if (block.durationMin < MIN_TIMELINE_BLOCK_MINUTES * 2) return current;
        const firstDuration = Math.ceil(block.durationMin / 2);
        const secondDuration = block.durationMin - firstDuration;
        const nextBlock: FoundationTimeBlock = {
          ...block,
          id: `timeline-block-${Date.now()}`,
          title: `${block.title} · 延展`,
          content: "",
          durationMin: secondDuration,
          boundaryNodeIds: [],
          order: block.order + 0.5,
        };
        const blocks = current.blocks.map((item) =>
          item.id === blockId ? { ...item, durationMin: firstDuration } : item
        );
        blocks.splice(index + 1, 0, nextBlock);
        return { ...current, blocks };
      });
    },
    [persistTimeline]
  );

  const handleWeightedBlockSplit = useCallback(
    (axis: FoundationWeightedAxis, blockId: string) => {
      persistTimeline((current) => {
        const blocks = getWeightedAxisBlocks(current, axis);
        const index = blocks.findIndex((block) => block.id === blockId);
        if (index < 0) return current;
        const block = blocks[index];
        const firstWidth = Math.max(0.45, block.width / 2);
        const nextBlock: FoundationSpaceBlock = {
          ...block,
          id: `${axis}-block-${Date.now()}`,
          title: `${block.title} · 延展`,
          content: "",
          width: firstWidth,
          boundaryNodeIds: [],
          order: block.order + 0.5,
        };
        blocks[index] = { ...block, width: firstWidth };
        blocks.splice(index + 1, 0, nextBlock);
        return setWeightedAxisBlocks(current, axis, blocks.map((item, order) => ({ ...item, order })));
      });
    },
    [persistTimeline]
  );

  const handleTimelineBlockDelete = useCallback(
    (blockId: string) => {
      persistTimeline((current) => {
        if (current.blocks.length <= 1) return current;
        const removed = current.blocks.find((block) => block.id === blockId);
        const blocks = current.blocks.filter((block) => block.id !== blockId);
        if (removed && blocks.length) {
          blocks[blocks.length - 1] = {
            ...blocks[blocks.length - 1],
            durationMin: blocks[blocks.length - 1].durationMin + removed.durationMin,
          };
        }
        return { ...current, blocks };
      });
    },
    [persistTimeline]
  );

  const handleWeightedBlockDelete = useCallback(
    (axis: FoundationWeightedAxis, blockId: string) => {
      persistTimeline((current) => {
        const blocks = getWeightedAxisBlocks(current, axis);
        if (blocks.length <= 1) return current;
        const removed = blocks.find((block) => block.id === blockId);
        const nextBlocks = blocks.filter((block) => block.id !== blockId);
        if (removed && nextBlocks.length) {
          nextBlocks[nextBlocks.length - 1] = {
            ...nextBlocks[nextBlocks.length - 1],
            width: nextBlocks[nextBlocks.length - 1].width + removed.width,
          };
        }
        return setWeightedAxisBlocks(current, axis, nextBlocks.map((block, order) => ({ ...block, order })));
      });
    },
    [persistTimeline]
  );

  const commitAxisTargetConnection = useCallback(
    (target: ScriptAxisTarget, nodeId: string) => {
      if (!nodeIdSet.has(nodeId)) return false;
      if (target.type === "head") {
        setAxisRevealRequest(Date.now());
        return true;
      }
      const block = (flow.flowNodes || []).find((node) => node.id === target.id);
      const member = (flow.flowNodes || []).find((node) => node.id === nodeId);
      const axis = block?.data?.foundationAxis;
      if (!block || !member || !isFoundationAxis(axis) || !isNodeTypeAllowedInFoundationAxis(axis, member.type)) return false;
      persistFlow((currentFlow) => assignFoundationMembership(currentFlow, target.id, nodeId));
      setActiveTimelineBlockId(target.id);
      return true;
    },
    [flow.flowNodes, nodeIdSet, persistFlow]
  );

  const handleTimelineBlockReorder = useCallback(
    (sourceBlockId: string, targetBlockId: string) => {
      persistTimeline((current) => {
        const blocks = current.blocks.slice().sort((a, b) => a.order - b.order);
        const sourceIndex = blocks.findIndex((block) => block.id === sourceBlockId);
        const targetIndex = blocks.findIndex((block) => block.id === targetBlockId);
        if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return current;
        const [moved] = blocks.splice(sourceIndex, 1);
        blocks.splice(targetIndex, 0, moved);
        return {
          ...current,
          blocks: blocks.map((block, index) => ({ ...block, order: index })),
        };
      });
    },
    [persistTimeline]
  );

  const handleWeightedBlockReorder = useCallback(
    (axis: FoundationWeightedAxis, sourceBlockId: string, targetBlockId: string) => {
      persistTimeline((current) => {
        const blocks = getWeightedAxisBlocks(current, axis);
        const sourceIndex = blocks.findIndex((block) => block.id === sourceBlockId);
        const targetIndex = blocks.findIndex((block) => block.id === targetBlockId);
        if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return current;
        const [moved] = blocks.splice(sourceIndex, 1);
        blocks.splice(targetIndex, 0, moved);
        return setWeightedAxisBlocks(current, axis, blocks.map((block, order) => ({ ...block, order })));
      });
    },
    [persistTimeline]
  );

  const handleTimelineResizeStart = useCallback(
    (blockId: string, edge: "left" | "right", startX: number, trackWidth: number) => {
      const originalTimeline = timeline;
      const originalBlocks = timeline.blocks.map((block) => ({ ...block }));
      const blockIndex = originalBlocks.findIndex((block) => block.id === blockId);
      const neighborIndex = edge === "left" ? blockIndex - 1 : blockIndex + 1;
      if (blockIndex < 0) return;

      if (edge === "right" && neighborIndex >= originalBlocks.length) {
        const handlePointerMove = (event: PointerEvent) => {
          const deltaMinutes = Math.round(((event.clientX - startX) / Math.max(1, trackWidth)) * originalTimeline.durationMin);
          const blocks = originalBlocks.map((block) => ({ ...block }));
          const nextLastDuration = Math.max(
            MIN_TIMELINE_BLOCK_MINUTES,
            originalBlocks[blockIndex].durationMin + deltaMinutes
          );
          blocks[blockIndex].durationMin = nextLastDuration;
          persistTimeline((current) => ({
            ...current,
            durationMin: originalTimeline.durationMin,
            blocks,
          }));
        };

        const stopPointerMove = () => {
          document.removeEventListener("pointermove", handlePointerMove);
          document.removeEventListener("pointerup", stopPointerMove);
        };

        document.addEventListener("pointermove", handlePointerMove);
        document.addEventListener("pointerup", stopPointerMove, { once: true });
        return;
      }

      if (neighborIndex < 0 || neighborIndex >= originalBlocks.length) return;
      const pairTotal = originalBlocks[blockIndex].durationMin + originalBlocks[neighborIndex].durationMin;

      const handlePointerMove = (event: PointerEvent) => {
        const deltaMinutes = Math.round(((event.clientX - startX) / Math.max(1, trackWidth)) * originalTimeline.durationMin);
        const blocks = originalBlocks.map((block) => ({ ...block }));

        if (edge === "right") {
          const nextDuration = Math.max(
            MIN_TIMELINE_BLOCK_MINUTES,
            Math.min(pairTotal - MIN_TIMELINE_BLOCK_MINUTES, originalBlocks[blockIndex].durationMin + deltaMinutes)
          );
          blocks[blockIndex].durationMin = nextDuration;
          blocks[neighborIndex].durationMin = pairTotal - nextDuration;
        } else {
          const nextDuration = Math.max(
            MIN_TIMELINE_BLOCK_MINUTES,
            Math.min(pairTotal - MIN_TIMELINE_BLOCK_MINUTES, originalBlocks[blockIndex].durationMin - deltaMinutes)
          );
          blocks[blockIndex].durationMin = nextDuration;
          blocks[neighborIndex].durationMin = pairTotal - nextDuration;
        }

        persistTimeline((current) => ({
          ...current,
          durationMin: originalTimeline.durationMin,
          blocks,
        }));
      };

      const stopPointerMove = () => {
        document.removeEventListener("pointermove", handlePointerMove);
        document.removeEventListener("pointerup", stopPointerMove);
      };

      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", stopPointerMove, { once: true });
    },
    [persistTimeline, timeline]
  );

  const handleWeightedResizeStart = useCallback(
    (axis: FoundationWeightedAxis, blockId: string, edge: "left" | "right", startX: number, trackWidth: number) => {
      const originalBlocks = getWeightedAxisBlocks(timeline, axis).map((block) => ({ ...block }));
      const blockIndex = originalBlocks.findIndex((block) => block.id === blockId);
      const neighborIndex = edge === "left" ? blockIndex - 1 : blockIndex + 1;
      if (blockIndex < 0 || neighborIndex < 0 || neighborIndex >= originalBlocks.length) return;
      const pairTotal = originalBlocks[blockIndex].width + originalBlocks[neighborIndex].width;

      const handlePointerMove = (event: PointerEvent) => {
        const deltaWeight = ((event.clientX - startX) / Math.max(1, trackWidth)) * originalBlocks.length;
        const blocks = originalBlocks.map((block) => ({ ...block }));
        if (edge === "right") {
          const nextWidth = Math.max(0.45, Math.min(pairTotal - 0.45, originalBlocks[blockIndex].width + deltaWeight));
          blocks[blockIndex].width = nextWidth;
          blocks[neighborIndex].width = pairTotal - nextWidth;
        } else {
          const nextWidth = Math.max(0.45, Math.min(pairTotal - 0.45, originalBlocks[blockIndex].width - deltaWeight));
          blocks[blockIndex].width = nextWidth;
          blocks[neighborIndex].width = pairTotal - nextWidth;
        }
        persistTimeline((current) => setWeightedAxisBlocks(current, axis, blocks));
      };

      const stopPointerMove = () => {
        document.removeEventListener("pointermove", handlePointerMove);
        document.removeEventListener("pointerup", stopPointerMove);
      };

      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", stopPointerMove, { once: true });
    },
    [persistTimeline, timeline]
  );

  const buildLinkForCreatedNode = useCallback(
    (
      currentLinks: FlowState["links"],
      createdNodeId: string,
      createdNodeType: FlowRenderNode["type"],
      dropState: ScriptConnectionDropState | null
    ) => {
      if (!dropState?.sourceNodeId) return currentLinks;

      const existingNodeType = nodeTypeById.get(dropState.sourceNodeId);
      const existingNode = (flow.flowNodes || []).find((node) => node.id === dropState.sourceNodeId);
      const foundationRole = getFoundationNodeRole(existingNode);
      if (
        (dropState.connectionType === "target" && foundationRole) ||
        (foundationRole && foundationRole !== "block-folder")
      ) {
        return currentLinks;
      }
      if (foundationRole === "block-folder" && dropState.connectionType === "source") {
        const axis = existingNode?.data?.foundationAxis;
        if (!isFoundationAxis(axis) || !isNodeTypeAllowedInFoundationAxis(axis, createdNodeType as NodeType)) return currentLinks;
        const membership = createFoundationMembershipLink(existingNode!.id, createdNodeId);
        return [...currentLinks.filter((link) => link.id !== membership.id), membership];
      }
      const existingNodeHandles = getScriptNodeHandlesForType(existingNodeType);
      const createdNodeHandles = getScriptNodeHandlesForType(createdNodeType);
      const existingTypedHandle = isTypedHandle(dropState.sourceHandleId) ? dropState.sourceHandleId : null;
      const preferredHandleType = dropState.handleType || existingTypedHandle;
      let source: string | null = null;
      let target: string | null = null;
      let sourceHandle: ScriptHandleType | null = null;
      let targetHandle: ScriptHandleType | null = null;

      if (dropState.connectionType === "source") {
        source = dropState.sourceNodeId;
        target = createdNodeId;
        sourceHandle = existingTypedHandle || pickOutputHandle(existingNodeHandles.outputs, preferredHandleType);
        targetHandle = pickInputHandle(createdNodeHandles.inputs, preferredHandleType || sourceHandle);
      } else {
        source = createdNodeId;
        target = dropState.sourceNodeId;
        sourceHandle = pickOutputHandle(createdNodeHandles.outputs, preferredHandleType);
        targetHandle =
          existingTypedHandle ||
          pickInputHandle(existingNodeHandles.inputs, preferredHandleType || sourceHandle, dropState.sourceHandleId);
      }

      if (!source || !target || !sourceHandle || !targetHandle) return currentLinks;

      const sourceNodeType = source === createdNodeId ? createdNodeType : existingNodeType;
      const targetNodeType = target === createdNodeId ? createdNodeType : existingNodeType;
      const pinoardId =
        sourceNodeType === "pinoard" && targetNodeType === "text"
          ? source
          : targetNodeType === "pinoard" && sourceNodeType === "text"
            ? target
            : null;
      const pinoardTextId =
        sourceNodeType === "text" && targetNodeType === "pinoard"
          ? source
          : targetNodeType === "text" && sourceNodeType === "pinoard"
            ? target
            : null;
      if (pinoardId && pinoardTextId) {
        const membership = createPinoardMembershipLink(pinoardId, pinoardTextId);
        return [
          ...currentLinks.filter(
            (link) =>
              !(
                link.data?.relation === PINOARD_MEMBERSHIP_RELATION &&
                (link.source === pinoardTextId || link.target === pinoardTextId)
              )
          ),
          membership,
        ];
      }
      const sourceIsScriptNode = sourceNodeType === "scriptPage" || sourceNodeType === "mdText";
      const targetIsScriptNode = targetNodeType === "scriptPage" || targetNodeType === "mdText";
      if (!sourceIsScriptNode && !targetIsScriptNode && !isValidConnection({ sourceHandle, targetHandle })) {
        return currentLinks;
      }

      const id = `link-${source}-${target}-${sourceHandle}-${targetHandle}`;
      return [
        ...currentLinks.filter((link) => link.id !== id),
        {
          id,
          source,
          target,
          sourceHandle,
          targetHandle,
        },
      ];
    },
    [flow.flowNodes, nodeTypeById]
  );

  const handleAddScriptPage = useCallback((position?: { x: number; y: number }, dropState: ScriptConnectionDropState | null = null) => {
    let createdNodeId: string | null = null;
    let createdFolderId: string | null = null;
    setProjectData((previous) => {
      const nextFlow = ensureFlow(previous.flow);
      const seed = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const documentId = `script-${seed}`;
      const manuscriptId = `manuscript-${seed}`;
      createdNodeId = `script-page-${seed}`;
      createdFolderId = `manus-folder-${seed}`;
      const requestedFolderPosition = position || getDefaultScriptPosition(nextFlow.flowNodes?.length || 0);
      const folderPosition = getSafeScriptNodePosition(
        nextFlow.flowNodes || [],
        "folder",
        requestedFolderPosition,
        {
          id: createdFolderId,
          type: "folder",
          position: requestedFolderPosition,
          style: MANUS_FOLDER_NODE_SIZE,
        }
      );
      const requestedPagePosition = {
        x: folderPosition.x + MANUS_FOLDER_NODE_SIZE.width + 80,
        y: folderPosition.y,
      };
      const nextNode: NodeFlowNode = {
        id: createdNodeId,
        type: "scriptPage",
        position: getSafeScriptNodePosition(nextFlow.flowNodes || [], "scriptPage", requestedPagePosition, {
          id: createdNodeId,
          type: "scriptPage",
          position: requestedPagePosition,
          style: SCRIPT_PAGE_NODE_SIZE,
        }),
        style: SCRIPT_PAGE_NODE_SIZE,
        data: {
          ...createDefaultNodeFlowNodeData("scriptPage"),
          title: "剧本文档",
          documentId,
          documentKind: "script",
          format: "fountain",
          text: "",
          content: "",
          preview: "",
          manuscriptId,
          pageNumber: 1,
        },
      };
      const folderNode: NodeFlowNode = {
        id: createdFolderId,
        type: "folder",
        position: folderPosition,
        style: MANUS_FOLDER_NODE_SIZE,
        deletable: false,
        data: {
          ...createDefaultNodeFlowNodeData("folder"),
          title: "剧本",
          folderKind: MANUS_FOLDER_KIND,
          systemManaged: true,
          manuscriptId,
          wrapperCollapsed: false,
        },
      };
      const contentLinks = buildLinkForCreatedNode(nextFlow.links, createdNodeId, "scriptPage", dropState);
      return {
        ...previous,
        flow: {
          ...nextFlow,
          flowNodes: [...(nextFlow.flowNodes || []), folderNode, nextNode],
          links: [...contentLinks, createManusMembershipLink(createdFolderId, createdNodeId)],
        },
      };
    });
    if (createdFolderId) setSelectedNodeIds(new Set([createdFolderId]));
    return createdNodeId;
  }, [buildLinkForCreatedNode, setProjectData]);

  const handleAddMarkdownNode = useCallback(
    (position?: { x: number; y: number }, dropState: ScriptConnectionDropState | null = null) => {
      const id = `text-${Date.now()}`;
      const createdNodeId = markdownNodeId(id);
      const now = Date.now();
      setProjectData((previous) => {
        const nextFlow = ensureFlow(previous.flow);
        const requestedPosition = position || getDefaultMarkdownPosition(nextFlow.flowNodes?.length || 0);
        const nextNode: NodeFlowNode = {
          id: createdNodeId,
          type: "text",
          position: getSafeScriptNodePosition(nextFlow.flowNodes || [], "text", requestedPosition, {
            id: createdNodeId,
            type: "text",
            position: requestedPosition,
            style: MARKDOWN_TEXT_NODE_SIZE,
          }),
          style: MARKDOWN_TEXT_NODE_SIZE,
          data: {
            ...createDefaultNodeFlowNodeData("text"),
            documentId: id,
            title: "文本",
            text: "",
            content: "",
            preview: compactMarkdownPreview(""),
            createdAt: now,
          } as NodeFlowNodeData,
        };
        return {
        ...previous,
        flow: {
          ...nextFlow,
          flowNodes: [...(nextFlow.flowNodes || []), nextNode],
          links: buildLinkForCreatedNode(nextFlow.links, createdNodeId, "text", dropState),
        },
        };
      });
      setSelectedNodeIds(new Set([createdNodeId]));
      return createdNodeId;
    },
    [buildLinkForCreatedNode, setProjectData]
  );

  const handleAddFlowNode = useCallback(
    (
      type: NodeType,
      position?: { x: number; y: number },
      dropState: ScriptConnectionDropState | null = null,
      extraData?: Partial<NodeFlowNodeData>,
      fixedNodeId?: string
    ) => {
      if (type === "folder" || isLookbookNodeType(type)) return null;
      if (type === "pinoard" && (flow.flowNodes || []).some((node) => node.type === "pinoard")) return null;
      const requestedPosition = position || getDefaultFlowNodePosition(flow.flowNodes?.length || 0);
      const commandState = {
        revision: flow.revision || 0,
        nodes: flowRuntimeNodes,
        links: flowRuntimeLinks,
        graphLinks: flow.graphLinks || [],
        globalAssetHistory: flow.globalAssetHistory || [],
        linkStyle: flow.linkStyle || "curved",
        activeView: flow.activeView ?? null,
        nodeFlowContext: flowRuntimeContext,
      };
      const createResult = createNodeFlowNodeCommand({
        state: commandState,
        type,
        position: requestedPosition,
        extraData,
        allocateNodeId: fixedNodeId ? () => fixedNodeId : createScriptFlowNodeId,
      });
      const createdNode = createResult.state.nodes.find((node) => !commandState.nodes.some((existing) => existing.id === node.id));
      const createdNodeId = createdNode?.id || fixedNodeId || createScriptFlowNodeId(type);
      const nodeToPersist: NodeFlowNode =
        createdNode || {
          id: createdNodeId,
          type,
          position: requestedPosition,
          data: {
            ...createDefaultNodeFlowNodeData(type),
            ...(extraData || {}),
          } as NodeFlowNodeData,
        };
      setProjectData((previous) => {
        const nextFlow = ensureFlow(previous.flow);
        const hasExistingNode = (nextFlow.flowNodes || []).some((node) => node.id === createdNodeId);
        const revision = Math.max((nextFlow.revision || 0) + 1, createResult.state.revision);
        return {
          ...previous,
          flow: {
            ...nextFlow,
            revision,
            flowNodes: hasExistingNode
              ? (nextFlow.flowNodes || []).map((node) => (node.id === createdNodeId ? { ...node, ...nodeToPersist, selected: false } : node))
              : [...(nextFlow.flowNodes || []), { ...nodeToPersist, selected: false }],
            links: buildLinkForCreatedNode(nextFlow.links, createdNodeId, type, dropState),
          },
        };
      });
      setSelectedNodeIds(new Set([createdNodeId]));
      return createdNodeId;
    },
    [
      buildLinkForCreatedNode,
      flow.activeView,
      flow.flowNodes?.length,
      flow.globalAssetHistory,
      flow.graphLinks,
      flow.linkStyle,
      flow.revision,
      flowRuntimeContext,
      flowRuntimeNodes,
      flowRuntimeLinks,
      projectData,
      setProjectData,
    ]
  );

  const handleAddMarkdownNodeFromTail = useCallback(() => {
    const position =
      typeof window === "undefined"
        ? undefined
        : screenToFlowPosition({
            x: window.innerWidth / 2,
            y: Math.max(120, window.innerHeight / 2 - 120),
          });
    handleAddMarkdownNode(position);
  }, [handleAddMarkdownNode, screenToFlowPosition]);

  const handleAddScriptPageFromTail = useCallback(() => {
    const position =
      typeof window === "undefined"
        ? undefined
        : screenToFlowPosition({
            x: window.innerWidth / 2,
            y: Math.max(120, window.innerHeight / 2 - 120),
          });
    handleAddScriptPage(position);
  }, [handleAddScriptPage, screenToFlowPosition]);

  const openInputNodeContextMenu = useCallback(
    (point: { clientX: number; clientY: number }, node: FlowRenderNode) => {
      const sourceNode = (flow.flowNodes || []).find((candidate) => candidate.id === node.id);
      if (!isInputCardNode(sourceNode)) {
        setInputNodeContextMenu(null);
        return;
      }
      const menuWidth = 216;
      const menuHeight = 242;
      const maxX = typeof window === "undefined" ? point.clientX : window.innerWidth - menuWidth - 8;
      const maxY = typeof window === "undefined" ? point.clientY : window.innerHeight - menuHeight - 8;
      setSelectedNodeIds(new Set([node.id]));
      setInputNodeContextMenu({
        nodeId: node.id,
        x: Math.max(8, Math.min(point.clientX, maxX)),
        y: Math.max(8, Math.min(point.clientY, maxY)),
      });
    },
    [flow.flowNodes]
  );

  const handleInputNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: FlowRenderNode) => {
      const sourceNode = (flow.flowNodes || []).find((candidate) => candidate.id === node.id);
      if (!isInputCardNode(sourceNode)) return;
      event.preventDefault();
      event.stopPropagation();
      openInputNodeContextMenu(event, node);
    },
    [flow.flowNodes, openInputNodeContextMenu]
  );

  const handleCopyInputNode = useCallback((nodeId: string) => {
    const sourceNode = (flow.flowNodes || []).find((node) => node.id === nodeId);
    if (!isInputCardNode(sourceNode)) return;
    inputNodeClipboardRef.current = JSON.parse(JSON.stringify(sourceNode)) as NodeFlowNode;
    setInputNodeContextMenu(null);
  }, [flow.flowNodes]);

  const handlePasteInputNode = useCallback((targetNodeId: string) => {
    const clipboardNode = inputNodeClipboardRef.current;
    const targetNode = (flow.flowNodes || []).find((node) => node.id === targetNodeId);
    if (!clipboardNode || !isInputCardNode(clipboardNode) || !targetNode) return;
    const nextData = JSON.parse(JSON.stringify(clipboardNode.data || {})) as NodeFlowNodeData;
    const createdNodeId = handleAddFlowNode(
      clipboardNode.type,
      { x: targetNode.position.x + 42, y: targetNode.position.y + 42 },
      null,
      nextData
    );
    if (createdNodeId && clipboardNode.style) {
      persistFlow((currentFlow) => ({
        ...currentFlow,
        revision: (currentFlow.revision || 0) + 1,
        flowNodes: (currentFlow.flowNodes || []).map((node) =>
          node.id === createdNodeId
            ? { ...node, style: { ...clipboardNode.style }, measured: undefined }
            : node
        ),
      }));
    }
    setInputNodeContextMenu(null);
  }, [flow.flowNodes, handleAddFlowNode, persistFlow]);

  const handleSetInputNodeColor = useCallback((nodeId: string, cardColor: NodeCardColor) => {
    persistFlow((currentFlow) => ({
      ...currentFlow,
      revision: (currentFlow.revision || 0) + 1,
      flowNodes: (currentFlow.flowNodes || []).map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...(node.data || {}), cardColor } as NodeFlowNodeData }
          : node
      ),
    }));
    setInputNodeContextMenu(null);
  }, [persistFlow]);

  const handleDeleteInputNode = useCallback(async (nodeId: string) => {
    setInputNodeContextMenu(null);
    await deleteElements({ nodes: [{ id: nodeId }] });
  }, [deleteElements]);

  useEffect(() => {
    if (!inputNodeContextMenu) return undefined;
    const closeMenu = () => setInputNodeContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeMenu);
    };
  }, [inputNodeContextMenu]);

  const handleImportScriptNodeFlow = useCallback(
    (nodeFlow: unknown) => {
      const parsed = parseNodeFlowFile(nodeFlow);
      const hydrated = hydrateImportedNodeFlow(parsed, flowRuntimeContext);
      setProjectData((previous) => {
        const currentFlow = ensureFlow(previous.flow);
        const existingIds = new Set<string>([
          ...(currentFlow.flowNodes || []).map((node) => node.id),
        ]);
        const idMap = new Map<string, string>();
        const now = Date.now();
        hydrated.nodes.forEach((node, index) => {
          let nextId = node.id;
          if (existingIds.has(nextId) || isScriptPageNodeId(nextId) || isMarkdownNodeId(nextId)) {
            nextId = `script-flow-${node.type}-${now}-${index}`;
          }
          existingIds.add(nextId);
          idMap.set(node.id, nextId);
        });
        const importedNodes = hydrated.nodes.map((node, index) => {
          const nextId = idMap.get(node.id) || node.id;
          const remappedData = remapImportedFoundationNodeData(
            {
              ...createDefaultNodeFlowNodeData(node.type),
              ...(node.data || {}),
            } as NodeFlowNodeData,
            idMap
          );
          return {
            ...node,
            id: nextId,
            measured: sanitizeScriptMeasured(node.measured),
            position: {
              x: (node.position?.x || 0) + 80,
              y: (node.position?.y || 0) + 80,
            },
            selected: false,
            data: remappedData,
          };
        });
        const placedImportedNodes = normalizeNodeFlowNodePositions({
          existingNodes: currentFlow.flowNodes || [],
          nodes: importedNodes,
        });
        const importedNodeIds = new Set(placedImportedNodes.map((node) => node.id));
        const importedLinks = hydrated.links
          .map((link, index): FlowState["links"][number] | null => {
            const source = idMap.get(link.source);
            const target = idMap.get(link.target);
            if (!source || !target) return null;
            return {
              id: `link-${source}-${target}-${link.sourceHandle || "out"}-${link.targetHandle || "in"}-${index}`,
              source,
              target,
              sourceHandle: isScriptRuntimeHandle(link.sourceHandle) ? link.sourceHandle : undefined,
              targetHandle: isScriptRuntimeHandle(link.targetHandle) ? link.targetHandle : undefined,
              data: link.data,
            };
          })
          .filter((link): link is FlowState["links"][number] => {
            if (!link) return false;
            return importedNodeIds.has(link.source) && importedNodeIds.has(link.target);
          });

        return {
          ...previous,
          flow: {
            ...currentFlow,
            revision: Math.max((currentFlow.revision || 0) + 1, hydrated.revision || 1),
            flowNodes: [...(currentFlow.flowNodes || []), ...placedImportedNodes],
            links: [...currentFlow.links, ...importedLinks],
            graphLinks: [...(currentFlow.graphLinks || []), ...(hydrated.graphLinks || [])],
            globalAssetHistory: [
              ...(currentFlow.globalAssetHistory || []),
              ...(hydrated.globalAssetHistory || []),
            ],
            linkStyle: hydrated.linkStyle || currentFlow.linkStyle || "curved",
            activeView: hydrated.activeView ?? currentFlow.activeView ?? null,
          },
        };
      });
    },
    [flowRuntimeContext, setProjectData]
  );

  const handleExportScriptNodeFlow = useCallback(async () => {
    await downloadNodeFlowPackage(
      buildNodeFlowFile({
        revision: flow.revision || 0,
        nodes: flowRuntimeNodes,
        links: flowRuntimeLinks,
        graphLinks: flow.graphLinks || [],
        linkStyle: flow.linkStyle || "curved",
        globalAssetHistory: flow.globalAssetHistory || [],
        nodeFlowContext: flowRuntimeContext,
        activeView: flow.activeView ?? null,
        name: `${projectData.fileName || "stylo-flow"}-flow`,
      })
    );
  }, [
    flow.activeView,
    flow.globalAssetHistory,
    flow.graphLinks,
    flow.linkStyle,
    flow.revision,
    projectData.fileName,
    flowRuntimeContext,
    flowRuntimeNodes,
    flowRuntimeLinks,
  ]);

  const handleRunScriptAll = useCallback(async () => {
    let started = 0;
    for (const node of flowRuntimeNodes) {
      if (node.type === "imageGen" || node.type === "nanoBananaImageGen" || node.type === "wanImageGen") {
        started += 1;
        await runImageGen(node.id);
      }
      if (
        node.type === "wanReferenceVideoGen" ||
        node.type === "viduVideoGen" ||
        node.type === "seedanceVideoGen"
      ) {
        started += 1;
        await runVideoGen(node.id);
      }
    }
    alert(started > 0 ? `已启动 ${started} 个生成节点。` : "当前没有可执行的生成节点。");
  }, [runImageGen, runVideoGen, flowRuntimeNodes]);

  const handleBeforeDelete = useCallback<OnBeforeDelete<FlowRenderNode, FlowRenderEdge>>(
    async ({ nodes: requestedNodes, edges: requestedEdges }) => {
      const protectedNodeIds = new Set(
        requestedNodes
          .filter((node) => isFoundationStructuralNode(node as NodeFlowNode))
          .map((node) => node.id)
      );
      const deletableNodes = requestedNodes.filter((node) => !protectedNodeIds.has(node.id));
      const deletableEdges = requestedEdges.filter(
        (edge) => !protectedNodeIds.has(edge.source) && !protectedNodeIds.has(edge.target)
      );
      if (requestedNodes.length > 0 && deletableNodes.length === 0) return false;

      const deletingNodeIds = new Set(deletableNodes.map((node) => node.id));
      const storageObjects = collectUnreferencedOwnedStorageObjects(
        deletableNodes,
        (flow.flowNodes || []).filter((node) => !deletingNodeIds.has(node.id))
      );
      if (storageObjects.length > 0) {
        try {
          await deleteOwnedStorageObjects(storageObjects, activeFlowProjectId);
        } catch (error) {
          const message = error instanceof Error ? error.message : "未知错误";
          window.alert(`无法删除节点：云端图片尚未清理。\n${message}`);
          return false;
        }
      }

      return { nodes: deletableNodes, edges: deletableEdges };
    },
    [activeFlowProjectId, flow.flowNodes]
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<FlowRenderNode>[]) => {
      const mutableChanges = changes.filter(
        (change) => {
          if (!("id" in change)) return true;
          const node = (flow.flowNodes || []).find((item) => item.id === change.id);
          if (!showFoundationNodes && isFoundationStructuralNode(node)) return false;
          return change.type !== "remove" || !isFoundationStructuralNode(node);
        }
      );
      const effectiveChanges = mutableChanges;
      const hasPositionChange = effectiveChanges.some((change) => change.type === "position" && change.position);
      const hasDimensionChange = effectiveChanges.some((change) => change.type === "dimensions");
      const selectionChanges = effectiveChanges.filter(
        (change): change is Extract<NodeChange<FlowRenderNode>, { type: "select" }> => change.type === "select"
      );
      if (selectionChanges.length) {
        setSelectedNodeIds((current) => {
          const next = new Set(current);
          selectionChanges.forEach((change) => {
            if (change.selected) next.add(change.id);
            else next.delete(change.id);
          });
          return next;
        });
      }
      const removedFlowNodeIds = effectiveChanges
        .filter((change): change is Extract<NodeChange<FlowRenderNode>, { type: "remove" }> => change.type === "remove")
        .map((change) => change.id);
      const removedNodeIds = new Set(removedFlowNodeIds);
      if (removedNodeIds.size) {
        setSelectedNodeIds((current) => {
          const next = new Set(current);
          removedNodeIds.forEach((nodeId) => next.delete(nodeId));
          return next;
        });
      }

      if (
        !hasPositionChange &&
        !hasDimensionChange &&
        removedFlowNodeIds.length === 0
      ) return;

      const nextNodes = applyNodeChanges(effectiveChanges, nodes);
      const positionById = new Map(nextNodes.map((node) => [node.id, node.position]));
      const nextNodeById = new Map(nextNodes.map((node) => [node.id, node]));

      persistFlow((currentFlow) => {
        const removedFlowNodeSet = new Set(removedFlowNodeIds);
        return {
          ...currentFlow,
          flowNodes: (currentFlow.flowNodes || [])
            .filter((node) => !removedFlowNodeSet.has(node.id))
            .map((node, index) => {
              const position = positionById.get(node.id) || node.position || getDefaultFlowNodePosition(index);
              const measured = sanitizeScriptMeasured(nextNodeById.get(node.id)?.measured)
                || sanitizeScriptMeasured(node.measured);
              if (
                position.x === node.position?.x
                && position.y === node.position?.y
                && measured?.width === node.measured?.width
                && measured?.height === node.measured?.height
              ) return node;
              return { ...node, position, measured };
            }),
          links: currentFlow.links.filter((link) => {
            return !removedFlowNodeSet.has(link.source) && !removedFlowNodeSet.has(link.target);
          }),
        };
      });
      publishProjectNodeGeometryMutation({
        projectId: activeFlowProjectId,
        updatedAt: Date.now(),
        patches: effectiveChanges.flatMap((change) => {
          if (!("id" in change)) return [];
          const nextNode = nextNodeById.get(change.id);
          if (!nextNode || (change.type !== "position" && change.type !== "dimensions")) return [];
          return [{
            nodeId: change.id,
            position: nextNode.position,
            measured: sanitizeScriptMeasured(nextNode.measured),
          }];
        }),
      });
    },
    [activeFlowProjectId, flow.flowNodes, nodes, persistFlow, showFoundationNodes]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<FlowRenderEdge>[]) => {
      const selectionChanges = changes.filter(
        (change): change is Extract<EdgeChange<FlowRenderEdge>, { type: "select" }> =>
          change.type === "select"
      );
      if (selectionChanges.length) {
        setSelectedEdgeIds((current) =>
          applyEdgeSelectionUpdates(current, selectionChanges)
        );
      }

      const removedIds = new Set(
        changes
          .filter((change): change is Extract<EdgeChange<FlowRenderEdge>, { type: "remove" }> => change.type === "remove")
          .filter((change) => {
            const link = flow.links.find((item) => item.id === change.id);
            return !link || !isFoundationStructuralLink(flow, link);
          })
          .map((change) => change.id)
      );
      if (!removedIds.size) return;
      setSelectedEdgeIds((current) =>
        applyEdgeSelectionUpdates(
          current,
          Array.from(removedIds, (id): EdgeSelectionUpdate => ({ id, removed: true }))
        )
      );
      persistFlow((currentFlow) => {
        const removedMemberships = currentFlow.links.filter(
          (link) => removedIds.has(link.id) && isFoundationMembershipLink(currentFlow.flowNodes || [], link)
        );
        let nextFlow = currentFlow;
        removedMemberships.forEach((link) => {
          nextFlow = removeFoundationMembership(nextFlow, link.target, link.source);
        });
        const links = removeFlowLinksById(nextFlow.links, removedIds);
        return links === nextFlow.links
          ? nextFlow
          : { ...nextFlow, revision: (nextFlow.revision || 0) + 1, links };
      });
    },
    [flow, persistFlow]
  );

  const commitScriptConnection = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return false;
      const sourceNode = (flow.flowNodes || []).find((node) => node.id === connection.source);
      const targetNode = (flow.flowNodes || []).find((node) => node.id === connection.target);
      const sourceFoundationRole = getFoundationNodeRole(sourceNode);
      const targetFoundationRole = getFoundationNodeRole(targetNode);
      if (targetFoundationRole || (sourceFoundationRole && sourceFoundationRole !== "block-folder")) {
        return false;
      }
      if (sourceFoundationRole === "block-folder") {
        const axis = sourceNode?.data?.foundationAxis;
        if (!targetNode || !isFoundationAxis(axis) || !isNodeTypeAllowedInFoundationAxis(axis, targetNode.type)) return false;
        persistFlow((currentFlow) => assignFoundationMembership(currentFlow, sourceNode!.id, targetNode.id));
        return true;
      }
      const sourceType = nodeTypeById.get(connection.source);
      const targetType = nodeTypeById.get(connection.target);
      if (!sourceType || !targetType) return false;
      if (connection.sourceHandle === "contains" || connection.targetHandle === "contains") {
        if (
          connection.sourceHandle !== "contains" ||
          connection.targetHandle !== "contains" ||
          !isManusFolderNode(sourceNode) ||
          targetType !== "scriptPage"
        ) {
          return false;
        }
        persistFlow((currentFlow) => ({
          ...currentFlow,
          revision: (currentFlow.revision || 0) + 1,
          links: [
            ...currentFlow.links.filter(
              (link) => !(isFolderMembershipLink(link) && link.target === connection.target)
            ),
            createManusMembershipLink(connection.source!, connection.target!),
          ],
        }));
        return true;
      }
      const pinoardId =
        sourceType === "pinoard" && targetType === "text"
          ? connection.source
          : targetType === "pinoard" && sourceType === "text"
            ? connection.target
            : null;
      const pinoardTextId =
        sourceType === "text" && targetType === "pinoard"
          ? connection.source
          : targetType === "text" && sourceType === "pinoard"
            ? connection.target
            : null;
      if (pinoardId && pinoardTextId) {
        const membership = createPinoardMembershipLink(pinoardId, pinoardTextId);
        persistFlow((currentFlow) => ({
          ...currentFlow,
          revision: (currentFlow.revision || 0) + 1,
          links: [
            ...currentFlow.links.filter(
              (link) =>
                !(
                  link.data?.relation === PINOARD_MEMBERSHIP_RELATION &&
                  (link.source === pinoardTextId || link.target === pinoardTextId)
                )
            ),
            membership,
          ],
        }));
        return true;
      }

      const sourceHandles = getScriptNodeHandlesForType(sourceType);
      const targetHandles = getScriptNodeHandlesForType(targetType);
      const inferredSourceHandle =
        sourceType === "scriptPage" || sourceType === "mdText" ? "text" : inferHandleTypeFromNodeType(sourceType as NodeType);
      const sourceHandle =
        isTypedHandle(connection.sourceHandle) || connection.sourceHandle === "multi"
          ? connection.sourceHandle
          : pickOutputHandle(sourceHandles.outputs, inferredSourceHandle as ScriptHandleType);
      const targetHandle =
        isTypedHandle(connection.targetHandle) || connection.targetHandle === "multi"
          ? connection.targetHandle
          : pickInputHandle(targetHandles.inputs, sourceHandle as ScriptHandleType);
      if (!sourceHandle || !targetHandle) return false;
      const sourceIsScriptNode = sourceType === "scriptPage" || sourceType === "mdText";
      const targetIsScriptNode = targetType === "scriptPage" || targetType === "mdText";
      if (
        !sourceIsScriptNode &&
        !targetIsScriptNode &&
        !isValidConnection({ sourceHandle, targetHandle })
      ) {
        return false;
      }
      const id = `link-${connection.source}-${connection.target}-${sourceHandle}-${targetHandle}`;
      persistFlow((currentFlow) => {
        const nextLinks = appendUniqueFlowLink(currentFlow.links, {
          id,
          source: connection.source,
          target: connection.target,
          sourceHandle,
          targetHandle,
        });
        if (nextLinks === currentFlow.links) return currentFlow;
        return {
          ...currentFlow,
          revision: (currentFlow.revision || 0) + 1,
          links: nextLinks,
        };
      });
      return true;
    },
    [flow.flowNodes, nodeTypeById, persistFlow]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      commitScriptConnection(connection);
    },
    [commitScriptConnection]
  );

  const updateSnapGuide = useCallback(
    (nodeId: string, position: { x: number; y: number }) => {
      if (!snapToGrid || isLocked) {
        onAlignmentGuideChange(null);
        return;
      }
      const node = baseNodes.find((item) => item.id === nodeId);
      if (!node) {
        onAlignmentGuideChange(null);
        return;
      }
      const zoom = Math.max(viewport.zoom || 1, 0.1);
      onAlignmentGuideChange(getEdgeAlignedPosition(node, baseNodes, position, {
        guideThreshold: 14 / zoom,
        snapThreshold: 4 / zoom,
      }).guide);
    },
    [baseNodes, isLocked, onAlignmentGuideChange, snapToGrid, viewport.zoom]
  );

  const finishNodeDrag = useCallback(
    (node: FlowRenderNode) => {
      if (!snapToGrid || isLocked || selectedNodeIds.size > 1) {
        onAlignmentGuideChange(null);
        return;
      }
      const sourceNode = baseNodes.find((item) => item.id === node.id);
      if (!sourceNode) {
        onAlignmentGuideChange(null);
        return;
      }
      const zoom = Math.max(viewport.zoom || 1, 0.1);
      const aligned = getEdgeAlignedPosition(sourceNode, baseNodes, node.position, {
        guideThreshold: 14 / zoom,
        snapThreshold: 4 / zoom,
      });
      if (aligned.position.x !== node.position.x || aligned.position.y !== node.position.y) {
        handleNodesChange([{
          id: node.id,
          type: "position",
          position: aligned.position,
          dragging: false,
        }]);
      }
      onAlignmentGuideChange(null);
    },
    [baseNodes, handleNodesChange, isLocked, onAlignmentGuideChange, selectedNodeIds.size, snapToGrid, viewport.zoom]
  );

  useEffect(() => {
    if (!snapToGrid) onAlignmentGuideChange(null);
  }, [onAlignmentGuideChange, snapToGrid]);

  const revealAxisFromHead = useCallback(() => {
    if (axisRevealTriggeredRef.current) return;
    axisRevealTriggeredRef.current = true;
    setAxisRevealRequest(Date.now());
  }, []);

  const handleConnectStart: OnConnectStart = useCallback(() => {
    axisRevealTriggeredRef.current = false;

    const handlePointerMove = (event: PointerEvent) => {
      if (axisRevealTriggeredRef.current) return;
      const hitAxisTarget = getScriptAxisTargetHitAtPoint(event.clientX, event.clientY);
      if (hitAxisTarget?.type === "head") revealAxisFromHead();
    };
    const handleTouchMove = (event: TouchEvent) => {
      if (axisRevealTriggeredRef.current) return;
      const touch = event.touches[0];
      if (!touch) return;
      const hitAxisTarget = getScriptAxisTargetHitAtPoint(touch.clientX, touch.clientY);
      if (hitAxisTarget?.type === "head") revealAxisFromHead();
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", cleanup);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", cleanup);
      document.removeEventListener("touchcancel", cleanup);
      window.setTimeout(() => {
        axisRevealTriggeredRef.current = false;
      }, 0);
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", cleanup, { once: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: true });
    document.addEventListener("touchend", cleanup, { once: true });
    document.addEventListener("touchcancel", cleanup, { once: true });
  }, [revealAxisFromHead]);

  const handleConnectEnd: OnConnectEnd = useCallback(
    (event, connectionState) => {
      if (connectionState.isValid || !connectionState.fromNode) return;
      const e = event as MouseEvent | TouchEvent;
      const clientX = "clientX" in e ? e.clientX : e.touches?.[0]?.clientX;
      const clientY = "clientY" in e ? e.clientY : e.touches?.[0]?.clientY;
      if (typeof clientX !== "number" || typeof clientY !== "number") return;

      const fromHandleId = connectionState.fromHandle?.id || null;
      const fromHandleType =
        isTypedHandle(fromHandleId) || fromHandleId === "multi" ? (fromHandleId as ScriptHandleType) : null;
      const isFromSource = connectionState.fromHandle?.type === "source";
      const hitAxisTarget = getScriptAxisTargetHitAtPoint(clientX, clientY);
      if (hitAxisTarget?.type === "head") {
        revealAxisFromHead();
        return;
      }
      if (hitAxisTarget && commitAxisTargetConnection(hitAxisTarget, connectionState.fromNode.id)) {
        return;
      }

      const hitNode = getScriptNodeHitAtPoint(clientX, clientY, connectionState.fromNode.id);
      if (hitNode) {
        const fromNodeId = connectionState.fromNode.id;
        const fromNodeType = nodeTypeById.get(fromNodeId);
        const preferred =
          fromHandleType ||
          (fromNodeType === "scriptPage" || fromNodeType === "mdText"
            ? "text"
            : (inferHandleTypeFromNodeType(fromNodeType as NodeType) as ScriptHandleType | null)) ||
          "text";

        const buildConnection = (sourceNodeId: string, targetNodeId: string): Connection | null => {
          if (sourceNodeId === targetNodeId) return null;
          const sourceHandles = getScriptNodeHandlesForType(nodeTypeById.get(sourceNodeId));
          const targetHandles = getScriptNodeHandlesForType(nodeTypeById.get(targetNodeId));
          const sourceHandle =
            sourceNodeId === fromNodeId && isFromSource && (isTypedHandle(fromHandleId) || fromHandleId === "multi")
              ? (fromHandleId as ScriptHandleType)
              : pickOutputHandle(sourceHandles.outputs, preferred);
          const targetHandle =
            targetNodeId === fromNodeId && !isFromSource
              ? pickInputHandle(targetHandles.inputs, preferred, fromHandleType)
              : pickInputHandle(targetHandles.inputs, preferred);

          if (!sourceHandle || !targetHandle) return null;
          return {
            source: sourceNodeId,
            sourceHandle,
            target: targetNodeId,
            targetHandle,
          };
        };

        const sidePreferredConnections =
          hitNode.side === "right"
            ? [buildConnection(hitNode.nodeId, fromNodeId), buildConnection(fromNodeId, hitNode.nodeId)]
            : [buildConnection(fromNodeId, hitNode.nodeId), buildConnection(hitNode.nodeId, fromNodeId)];

        for (const connection of sidePreferredConnections) {
          if (connection && commitScriptConnection(connection)) return;
        }
        return;
      }
      setConnectionDrop({
        position: { x: clientX, y: clientY },
        flowPosition: screenToFlowPosition({ x: clientX, y: clientY }),
        handleType: fromHandleType,
        connectionType: isFromSource ? "source" : "target",
        sourceNodeId: connectionState.fromNode.id,
        sourceHandleId: fromHandleId,
      });
    },
    [commitAxisTargetConnection, commitScriptConnection, nodeTypeById, revealAxisFromHead, screenToFlowPosition]
  );

  const handleDropCreate = useCallback(
    (type: FlowCreateType) => {
      if (!connectionDrop) return;
      if (type === "folder") {
        setConnectionDrop(null);
        return;
      }
      if (type === "scriptPage") {
        handleAddScriptPage(connectionDrop.flowPosition, connectionDrop);
        setConnectionDrop(null);
        return;
      }
      if (type === "mdText") {
        handleAddMarkdownNode(connectionDrop.flowPosition, connectionDrop);
        setConnectionDrop(null);
        return;
      }
      if (isLookbookNodeType(type)) {
        setConnectionDrop(null);
        return;
      }

      handleAddFlowNode(type, connectionDrop.flowPosition, connectionDrop);
      setConnectionDrop(null);
    },
    [connectionDrop, handleAddFlowNode, handleAddMarkdownNode, handleAddScriptPage]
  );

  const toggleWrapperCollapsed = useCallback((nodeId: string) => {
    const now = Date.now();
    if ((wrapperToggleLockRef.current.get(nodeId) || 0) > now) return;
    wrapperToggleLockRef.current.set(nodeId, now + 600);
    const wrapperNode = (flow.flowNodes || []).find((node) => node.id === nodeId);
    const memberIds = wrapperProjection.memberIdsByWrapper.get(nodeId) || [];
    const isCollapsing = wrapperNode?.data?.wrapperCollapsed !== true;
    const orderById = Object.fromEntries(
      memberIds.map((memberId, order) => [memberId, order])
    );
    if (wrapperMotionTimerRef.current) clearTimeout(wrapperMotionTimerRef.current);
    setWrapperMemberMotion({
      wrapperId: nodeId,
      mode: isCollapsing ? "collapsing" : "expanding",
      memberIds,
      orderById,
    });
    persistFlow((currentFlow) => ({
      ...currentFlow,
      revision: (currentFlow.revision || 0) + 1,
      flowNodes: (currentFlow.flowNodes || []).map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                wrapperCollapsed: node.data?.wrapperCollapsed !== true,
              },
            }
          : node
      ),
    }));
    wrapperMotionTimerRef.current = setTimeout(() => {
      wrapperMotionTimerRef.current = null;
      setWrapperMemberMotion((current) => current?.wrapperId === nodeId ? null : current);
    }, 480);
  }, [flow.flowNodes, persistFlow, wrapperProjection.memberIdsByWrapper]);

  const handleScriptNodeClick = useCallback(
    (node: FlowRenderNode) => {
      const boundaryBlock = allFoundationBlocks.find((block) =>
        block.boundaryNodeIds.includes(node.id)
      );
      if (boundaryBlock) setActiveTimelineBlockId(boundaryBlock.id);
      const memberCount = typeof node.data.wrapperMemberCount === "number" ? node.data.wrapperMemberCount : 0;
      const isCollapsibleLookbook = isLookbookNodeType(node.type) && memberCount > 0;
      const isCollapsibleScreenplay = node.type === "folder" && isManusFolderNode(node as unknown as NodeFlowNode) && memberCount > 0;
      if (!isCollapsibleLookbook && !isCollapsibleScreenplay) return;
      if (wrapperClickTimerRef.current) clearTimeout(wrapperClickTimerRef.current);
      wrapperClickTimerRef.current = setTimeout(() => {
        wrapperClickTimerRef.current = null;
        toggleWrapperCollapsed(node.id);
      }, 210);
    },
    [allFoundationBlocks, toggleWrapperCollapsed]
  );

  const handleScriptNodeDoubleClick = useCallback(
    (node: FlowRenderNode) => {
      if (wrapperClickTimerRef.current) {
        clearTimeout(wrapperClickTimerRef.current);
        wrapperClickTimerRef.current = null;
      }
      if (isLookbookNodeType(node.type)) onOpenLookbook?.(node.id);
      else if (node.type === "pinoard") onOpenPinoard?.(node.id);
      else if (node.type === "text" && !focusedWrapperId) onOpenPinoard?.(null, node.id);
      else if (node.type === "folder" && isManusFolderNode(node as unknown as NodeFlowNode)) {
        const pageIds = new Set(getManusPageIds(node.id, flow.flowNodes || [], flow.links || []));
        const firstPage = (flow.flowNodes || [])
          .filter((candidate) => pageIds.has(candidate.id))
          .sort((left, right) => {
            const leftPage = typeof left.data?.pageNumber === "number" ? left.data.pageNumber : Number.MAX_SAFE_INTEGER;
            const rightPage = typeof right.data?.pageNumber === "number" ? right.data.pageNumber : Number.MAX_SAFE_INTEGER;
            return leftPage - rightPage ||
              left.position.y - right.position.y ||
              left.position.x - right.position.x;
          })[0];
        if (firstPage) onOpenScriptDocument(firstPage.id);
      }
      else if (node.type === "scriptPage") onOpenScriptDocument(node.id);
      else if (node.type === "pdfInput") setActivePdfNodeId(node.id);
    },
    [flow.flowNodes, flow.links, focusedWrapperId, onOpenLookbook, onOpenPinoard, onOpenScriptDocument]
  );

  const inputNodeContextTarget = inputNodeContextMenu
    ? (flow.flowNodes || []).find((node) => node.id === inputNodeContextMenu.nodeId)
    : null;

  const overlays = (
    <>
      {inputNodeContextMenu && inputNodeContextTarget ? (
        <div
          className="input-node-context-layer"
          onPointerDown={() => setInputNodeContextMenu(null)}
          onContextMenu={(event) => event.preventDefault()}
        >
          <section
            className="input-node-context-menu"
            role="menu"
            aria-label="输入节点操作"
            style={{ left: inputNodeContextMenu.x, top: inputNodeContextMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="input-node-context-menu__actions">
              <button type="button" role="menuitem" onClick={() => handleCopyInputNode(inputNodeContextMenu.nodeId)}>
                <Copy size={16} weight="regular" aria-hidden="true" />
                <span>复制</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!inputNodeClipboardRef.current}
                onClick={() => handlePasteInputNode(inputNodeContextMenu.nodeId)}
              >
                <ClipboardText size={16} weight="regular" aria-hidden="true" />
                <span>粘贴</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                onClick={() => void handleDeleteInputNode(inputNodeContextMenu.nodeId)}
              >
                <Trash size={16} weight="regular" aria-hidden="true" />
                <span>删除卡片</span>
              </button>
            </div>
            <div className="input-node-context-menu__palette" aria-label="卡片标记颜色">
              <div className="input-node-context-menu__palette-title">
                <Palette size={14} weight="regular" aria-hidden="true" />
                <span>标记颜色</span>
              </div>
              <div className="input-node-context-menu__swatches">
                {INPUT_CARD_COLORS.map((color) => {
                  const isActive = (inputNodeContextTarget.data?.cardColor || "none") === color.value;
                  return (
                    <button
                      key={color.value}
                      type="button"
                      className="input-node-context-menu__swatch"
                      data-color={color.value}
                      data-active={isActive}
                      title={color.label}
                      aria-label={color.label}
                      aria-pressed={isActive}
                      onClick={() => handleSetInputNodeColor(inputNodeContextMenu.nodeId, color.value)}
                    >
                      {isActive ? <Check size={11} weight="bold" aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {connectionDrop ? (
        <ConnectionDropMenu
          position={connectionDrop.position}
          options={scriptCreateOptions.filter((option) =>
            (option.type !== "pinoard" || !nodes.some((node) => node.type === "pinoard")) &&
            (option.type !== "scriptPage" || !nodes.some((node) => node.type === "scriptPage"))
          )}
          subtitle="创建 Flow 节点"
          onCreate={handleDropCreate}
          onClose={() => setConnectionDrop(null)}
        />
      ) : null}

      {activePdfNodeId ? (
        <React.Suspense fallback={<div className="pdf-focus-module-loading" role="status">正在载入 PDF 文稿工具…</div>}>
          <PdfReaderOverlay
            nodeId={activePdfNodeId}
            onClose={() => setActivePdfNodeId(null)}
            onOpenAgent={onOpenAgent}
            onSubmitAgentMessage={onSubmitAgentMessage}
          />
        </React.Suspense>
      ) : null}

      {!focusedWrapperId && nodes.length === 0 && foundationScaffoldNodeIds.size === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <button
            type="button"
            onClick={() => handleAddFlowNode("pinoard")}
            className="pointer-events-auto inline-flex h-11 items-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-panel)] px-4 text-[13px] font-semibold text-[var(--app-text-primary)] shadow-[var(--app-shadow)] transition hover:border-[var(--app-border-strong)]"
          >
            <Plus size={16} />
            Pinoard
          </button>
        </div>
      ) : null}

      {!isWritingEditorOpen && !showFoundationNodes ? (
        <ScriptFoundation
          timeline={timeline}
          activeBlockId={activeTimelineBlockId}
          onActiveBlockChange={setActiveTimelineBlockId}
          onUpdateHead={handleTimelineHeadUpdate}
          onUpdateBlock={handleTimelineBlockUpdate}
          onUpdateWeightedBlock={handleWeightedBlockUpdate}
          onAddTimeBlock={handleTimelineBlockAdd}
          onAddWeightedBlock={handleWeightedBlockAdd}
          onSplitBlock={handleTimelineBlockSplit}
          onSplitWeightedBlock={handleWeightedBlockSplit}
          onDeleteBlock={handleTimelineBlockDelete}
          onDeleteWeightedBlock={handleWeightedBlockDelete}
          onReorderBlock={handleTimelineBlockReorder}
          onReorderWeightedBlock={handleWeightedBlockReorder}
          onResizeStart={handleTimelineResizeStart}
          onWeightedResizeStart={handleWeightedResizeStart}
          axisRevealRequest={axisRevealRequest}
          onCreateArchiveNode={handleAddMarkdownNodeFromTail}
          onCreateScriptNode={handleAddScriptPageFromTail}
          hasScriptPage={nodes.some((node) => node.type === "scriptPage")}
          hasPinoard={nodes.some((node) => node.type === "pinoard")}
          onCreateFlowNode={(type) => {
            const position =
              typeof window === "undefined"
                ? undefined
                : screenToFlowPosition({
                    x: window.innerWidth / 2,
                    y: Math.max(120, window.innerHeight / 2 - 120),
                  });
            if (!isLookbookNodeType(type)) handleAddFlowNode(type, position);
          }}
          onOpenAgent={onOpenAgent}
          onSubmitAgentMessage={onSubmitAgentMessage}
          agentComposerValue={agentComposerValue}
          onAgentComposerChange={onAgentComposerChange}
          onAgentComposerAction={onAgentComposerAction}
          isAgentSending={isAgentSending}
          isAgentFirstMode={isAgentFirstMode}
          onOpenProjectSettingsPanel={onOpenProjectSettingsPanel}
          onOpenVisualLab={onOpenVisualLab}
          onOpenMarkdownCard={onCollapseCanvasCards}
          onCloseMarkdownCard={onRestoreCanvasCards}
          onFoundationProjectionChange={handleFoundationProjectionChange}
          activeDockTray={activeDockTray}
          onDockTrayChange={onDockTrayChange}
        />
      ) : null}

    </>
  );

  return {
    key: "flow",
    nodes,
    edges,
    nodeTypes,
    edgeTypes,
    onNodesChange: handleNodesChange as CanvasSurfaceConfig["onNodesChange"],
    onEdgesChange: handleEdgesChange as CanvasSurfaceConfig["onEdgesChange"],
    onConnect: handleConnect,
    onConnectStart: handleConnectStart,
    onConnectEnd: handleConnectEnd,
    onBeforeDelete: handleBeforeDelete as CanvasSurfaceConfig["onBeforeDelete"],
    onNodeClick: (_, node) => handleScriptNodeClick(node as FlowRenderNode),
    onNodeDoubleClick: (_, node) => handleScriptNodeDoubleClick(node as FlowRenderNode),
    onNodeContextMenu: (event, node) => handleInputNodeContextMenu(event, node as FlowRenderNode),
    onNodeLongPress: (point, node) => openInputNodeContextMenu(point, node as FlowRenderNode),
    onNodeDragStart: (_, node) => updateSnapGuide(node.id, node.position),
    onNodeDrag: (_, node) => updateSnapGuide(node.id, node.position),
    onNodeDragStop: (_, node) => finishNodeDrag(node as FlowRenderNode),
    nodesDraggable: !isLocked && !focusedWrapperId,
    nodesConnectable: !isLocked,
    elementsSelectable: !isLocked,
    onlyRenderVisibleElements: false,
    overlays,
    actions: {
      addNode: (type, position) => isLookbookNodeType(type)
        ? null
        : handleAddFlowNode(type, position),
      importNodeFlow: handleImportScriptNodeFlow,
      exportNodeFlow: handleExportScriptNodeFlow,
      runAll: handleRunScriptAll,
      organizeFoundationScaffold: handleOrganizeFoundationScaffold,
      setFoundationNodeView: handleSetFoundationNodeView,
      foundationNodeView: showFoundationNodes,
    },
  };
};
