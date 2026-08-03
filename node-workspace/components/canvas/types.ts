import type React from "react";
import type {
  Connection,
  ConnectionLineType,
  Edge,
  EdgeChange,
  EdgeTypes,
  Node,
  NodeChange,
  NodeTypes,
  OnConnectEnd,
  OnConnectStart,
  OnBeforeDelete,
  PanOnScrollMode,
  XYPosition,
} from "@xyflow/react";
import type { EdgeAlignmentGuide } from "../../utils/edgeAlignment";
import type { NodeFlowFile, NodeType } from "../../types";

export type SharedCanvasViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type SharedCanvasViewportApi = {
  getViewport: () => SharedCanvasViewport;
  setViewport: (viewport: SharedCanvasViewport, options?: { duration?: number }) => void;
};

export type SharedCanvasControls = {
  viewport: SharedCanvasViewport;
  minZoom: number;
  maxZoom: number;
  isLocked: boolean;
  snapToGrid: boolean;
  showMiniMap: boolean;
  onViewportChange: (viewport: SharedCanvasViewport, options?: { commit?: boolean }) => void;
  onViewportApiChange: (api: SharedCanvasViewportApi | null) => void;
  onAlignmentGuideChange: (guide: EdgeAlignmentGuide | null) => void;
};

export type CanvasSurfaceKey = "flow";

export type CanvasSurfaceConfig = {
  key: CanvasSurfaceKey;
  nodes: Node[];
  edges: Edge[];
  nodeTypes?: NodeTypes;
  edgeTypes?: EdgeTypes;
  onNodesChange?: (changes: NodeChange[]) => void;
  onEdgesChange?: (changes: EdgeChange[]) => void;
  onConnect?: (connection: Connection) => void;
  onConnectStart?: OnConnectStart;
  onConnectEnd?: OnConnectEnd;
  onBeforeDelete?: OnBeforeDelete<any, any>;
  onNodeClick?: (event: React.MouseEvent, node: Node) => void;
  onNodeDoubleClick?: (event: React.MouseEvent, node: Node) => void;
  onNodeContextMenu?: (event: React.MouseEvent, node: Node) => void;
  onNodeLongPress?: (point: { clientX: number; clientY: number }, node: Node) => void;
  onNodeDragStart?: (event: React.MouseEvent, node: Node) => void;
  onNodeDrag?: (event: React.MouseEvent, node: Node) => void;
  onNodeDragStop?: (event: React.MouseEvent, node: Node) => void;
  nodesDraggable?: boolean;
  nodesConnectable?: boolean;
  elementsSelectable?: boolean;
  onlyRenderVisibleElements?: boolean;
  connectionLineType?: ConnectionLineType;
  connectionLineStyle?: React.CSSProperties;
  panOnScrollMode?: PanOnScrollMode;
  underlays?: React.ReactNode;
  overlays?: React.ReactNode;
  miniMap?: React.ReactNode;
  actions?: {
    addNode?: (type: NodeType, position?: XYPosition) => string | null | undefined;
    importNodeFlow?: (nodeFlow: NodeFlowFile) => void;
    exportNodeFlow?: () => void;
    runAll?: () => void | Promise<void>;
    organizeFoundationScaffold?: () => void;
    setFoundationNodeView?: (visible: boolean) => void;
    foundationNodeView?: boolean;
  };
};
