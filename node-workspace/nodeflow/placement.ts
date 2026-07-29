import type { XYPosition } from "@xyflow/react";
import type { NodeFlowNode, NodeFlowNodeStyle, NodeFlowViewport, NodeType } from "../types";
import { LOOKBOOK_WRAPPER_DIMENSIONS } from "../lookbook/constants";

export const DEFAULT_NODE_DIMENSIONS: Partial<Record<NodeType, { width: number; height?: number }>> = {
  pinoard: { width: 372, height: 278 },
  scriptPage: { width: 286, height: 356 },
  mdText: { width: 320, height: 252 },
  folder: { width: 360, height: 240 },
  text: { width: 320, height: 180 },
  imageInput: { width: 320, height: 220 },
  audioInput: { width: 340, height: 180 },
  videoInput: { width: 360, height: 220 },
  pdfInput: { width: 248, height: 350 },
  scriptBoard: { width: 920 },
  lookbook: LOOKBOOK_WRAPPER_DIMENSIONS,
  leporello: { width: 356, height: 180 },
  identityCard: LOOKBOOK_WRAPPER_DIMENSIONS,
  imageGen: { width: 380, height: 520 },
  nanoBananaImageGen: { width: 380, height: 520 },
  wanImageGen: { width: 380, height: 520 },
  wanReferenceVideoGen: { width: 380, height: 560 },
  seedanceVideoGen: { width: 380 },
  viduVideoGen: { width: 380, height: 560 },
};

const DEFAULT_NODE_WIDTH = 320;
const DEFAULT_NODE_HEIGHT = 180;
const SAFE_NODE_GAP = 48;
const SEARCH_STEP_X = 392;
const SEARCH_STEP_Y = 320;
const SEARCH_LIMIT = 160;
const GRID_SIZE = 16;

const parseSize = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const getStyleSize = (style?: NodeFlowNodeStyle) => ({
  width: parseSize(style?.width),
  height: parseSize(style?.height),
});

export const getNodeFlowNodeDimensions = (
  type: NodeType,
  node?: Pick<NodeFlowNode, "style" | "measured">
) => {
  const defaults = DEFAULT_NODE_DIMENSIONS[type];
  const styleSize = getStyleSize(node?.style);
  return {
    width: node?.measured?.width || styleSize.width || defaults?.width || DEFAULT_NODE_WIDTH,
    height: node?.measured?.height || styleSize.height || defaults?.height || DEFAULT_NODE_HEIGHT,
  };
};

const toBounds = (
  node: Pick<NodeFlowNode, "type" | "position" | "style" | "measured">,
  position: XYPosition = node.position
) => {
  const size = getNodeFlowNodeDimensions(node.type, node);
  return {
    left: position.x,
    right: position.x + size.width,
    top: position.y,
    bottom: position.y + size.height,
  };
};

const intersectsWithGap = (
  active: ReturnType<typeof toBounds>,
  target: ReturnType<typeof toBounds>,
  gap = SAFE_NODE_GAP
) =>
  active.left < target.right + gap &&
  active.right > target.left - gap &&
  active.top < target.bottom + gap &&
  active.bottom > target.top - gap;

export const roundNodeFlowPositionToGrid = (position: XYPosition, grid = GRID_SIZE): XYPosition => ({
  x: Math.round(position.x / grid) * grid,
  y: Math.round(position.y / grid) * grid,
});

const roundToGrid = (value: number, grid = GRID_SIZE) => Math.round(value / grid) * grid;

const getBasePlacement = (
  nodes: NodeFlowNode[],
  viewport?: NodeFlowViewport | null,
  requestedPosition?: XYPosition
) => {
  if (requestedPosition) {
    return {
      x: roundToGrid(requestedPosition.x),
      y: roundToGrid(requestedPosition.y),
    };
  }
  const activeViewport = viewport || null;
  const baseX = activeViewport ? (-activeViewport.x + 120) / activeViewport.zoom : 120;
  const baseY = activeViewport ? (-activeViewport.y + 120) / activeViewport.zoom : 120;
  const offset = Math.min(nodes.length, 12) * 16;
  return {
    x: roundToGrid(baseX + offset),
    y: roundToGrid(baseY + offset),
  };
};

const buildSearchOffsets = () => {
  const offsets: XYPosition[] = [{ x: 0, y: 0 }];
  for (let ring = 1; offsets.length < SEARCH_LIMIT; ring += 1) {
    for (let x = -ring; x <= ring && offsets.length < SEARCH_LIMIT; x += 1) {
      offsets.push({ x: x * SEARCH_STEP_X, y: -ring * SEARCH_STEP_Y });
      offsets.push({ x: x * SEARCH_STEP_X, y: ring * SEARCH_STEP_Y });
    }
    for (let y = -ring + 1; y <= ring - 1 && offsets.length < SEARCH_LIMIT; y += 1) {
      offsets.push({ x: -ring * SEARCH_STEP_X, y: y * SEARCH_STEP_Y });
      offsets.push({ x: ring * SEARCH_STEP_X, y: y * SEARCH_STEP_Y });
    }
  }
  return offsets;
};

const SEARCH_OFFSETS = buildSearchOffsets();

export const findSafeNodeFlowPosition = ({
  nodes,
  type,
  requestedPosition,
  parentId,
  viewport,
  gap = SAFE_NODE_GAP,
  node,
}: {
  nodes: NodeFlowNode[];
  type: NodeType;
  requestedPosition?: XYPosition;
  parentId?: string;
  viewport?: NodeFlowViewport | null;
  gap?: number;
  node?: Pick<NodeFlowNode, "id" | "type" | "position" | "style" | "measured">;
}): XYPosition => {
  const comparableNodes = nodes.filter((node) => (node.parentId || undefined) === (parentId || undefined));
  const base = getBasePlacement(comparableNodes, viewport, requestedPosition);
  const candidateNode = {
    id: node?.id || "__placement_candidate__",
    type,
    position: base,
    style: node?.style || DEFAULT_NODE_DIMENSIONS[type],
    measured: node?.measured,
  } as NodeFlowNode;

  for (const offset of SEARCH_OFFSETS) {
    const rawPosition = {
      x: roundToGrid(base.x + offset.x),
      y: roundToGrid(base.y + offset.y),
    };
    const position = rawPosition;
    const activeBounds = toBounds(candidateNode, position);
    const overlaps = comparableNodes.some((node) => intersectsWithGap(activeBounds, toBounds(node), gap));
    if (!overlaps) return position;
  }

  const fallbackColumn = comparableNodes.length % 6;
  const fallbackRow = Math.floor(comparableNodes.length / 6);
  return {
    x: roundToGrid(base.x + fallbackColumn * SEARCH_STEP_X),
    y: roundToGrid(base.y + (fallbackRow + 1) * SEARCH_STEP_Y),
  };
};

export const normalizeNodeFlowNodePositions = ({
  existingNodes,
  nodes,
  gap = SAFE_NODE_GAP,
  viewport,
}: {
  existingNodes: NodeFlowNode[];
  nodes: NodeFlowNode[];
  gap?: number;
  viewport?: NodeFlowViewport | null;
}) => {
  const stagedNodes: NodeFlowNode[] = [];
  return nodes.map((node) => {
    const requestedPosition = roundNodeFlowPositionToGrid(node.position || { x: 0, y: 0 });
    const safePosition = findSafeNodeFlowPosition({
      nodes: [...existingNodes, ...stagedNodes],
      type: node.type,
      requestedPosition,
      parentId: node.parentId,
      viewport,
      gap,
      node,
    });
    const nextNode = {
      ...node,
      position: safePosition,
    };
    stagedNodes.push(nextNode);
    return nextNode;
  });
};
