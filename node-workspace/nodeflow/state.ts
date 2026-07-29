import type {
  NodeFlowFile,
  NodeFlowGraphLink,
  NodeFlowLink,
  NodeFlowNode,
  NodeFlowNodeData,
  NodeFlowNodeStyle,
  NodeType,
} from "../types";
import { NODE_TYPES } from "../types";
import { createDefaultNodeFlowNodeData } from "./defaults";
import { buildNodeFlowLinkId } from "./links";
import { normalizeNodeFlowGraphLinks } from "./graphLinks";
import { dedupeNodeFlowRefs } from "./refs";
import { normalizeManusFolderStructure } from "../manus/folder";

const NODE_TYPE_SET = new Set<NodeType>(NODE_TYPES);

const isNodeType = (type: unknown): type is NodeType => typeof type === "string" && NODE_TYPE_SET.has(type as NodeType);

export const getNodeFlowNodeDimensions = (node: NodeFlowNode) => {
  const styleWidth = typeof node.style?.width === "number" ? node.style.width : undefined;
  const styleHeight = typeof node.style?.height === "number" ? node.style.height : undefined;
  const measuredWidth = typeof node.measured?.width === "number" ? node.measured.width : undefined;
  const measuredHeight = typeof node.measured?.height === "number" ? node.measured.height : undefined;
  return {
    width: measuredWidth ?? styleWidth ?? 280,
    height: measuredHeight ?? styleHeight ?? 200,
  };
};

export const getNodeFlowAbsolutePosition = (node: NodeFlowNode, nodeMap: Map<string, NodeFlowNode>) => {
  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.parentId;
  while (parentId) {
    const parent = nodeMap.get(parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }
  return { x, y };
};

export const sanitizeNodeFlowNodeStyle = (_type: NodeType, style?: NodeFlowNodeStyle) => {
  if (!style) return style;
  const nextStyle = { ...style };
  return Object.keys(nextStyle).length > 0 ? nextStyle : undefined;
};

export const normalizeNodeFlowNode = (node: NodeFlowNode): NodeFlowNode | null => {
  if (!isNodeType((node as { type?: unknown }).type)) return null;
  const base = createDefaultNodeFlowNodeData(node.type);
  const data = (base ? { ...base, ...(node.data || {}) } : node.data) as NodeFlowNodeData;
  const position = node.position || { x: 0, y: 0 };
  return {
    ...node,
    position,
    selected: false,
    data,
    style: sanitizeNodeFlowNodeStyle(node.type, node.style),
  };
};

export const normalizeNodeFlowLink = (link: NodeFlowLink, index: number): NodeFlowLink => {
  const id =
    link.id ||
    buildNodeFlowLinkId(link.source, link.target, link.sourceHandle, link.targetHandle) ||
    `link-${index}`;
  return {
    ...link,
    id,
    sourceHandle: link.sourceHandle ?? null,
    targetHandle: link.targetHandle ?? null,
    selected: false,
  };
};

export const normalizeNodeFlowData = (nodeFlow: NodeFlowFile) => {
  const nodes = dedupeNodeFlowRefs(
    Array.isArray(nodeFlow.nodes)
      ? nodeFlow.nodes.map(normalizeNodeFlowNode).filter((node): node is NodeFlowNode => Boolean(node))
      : []
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = Array.isArray(nodeFlow.links)
    ? nodeFlow.links
        .map(normalizeNodeFlowLink)
        .filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target))
    : [];
  const graphLinks: NodeFlowGraphLink[] = normalizeNodeFlowGraphLinks(nodeFlow.graphLinks);
  const manusStructure = normalizeManusFolderStructure(nodes, links);
  return { nodes: manusStructure.nodes, links: manusStructure.links, graphLinks };
};
