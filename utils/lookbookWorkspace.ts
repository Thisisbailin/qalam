import type { FlowLink, ProjectData } from "../types";
import type {
  ImageInputNodeData,
  LookbookBookEntry,
  LookbookBookState,
  LookbookLayout,
  NodeFlowNode,
  NodeFlowNodeData,
  TextNodeData,
} from "../node-workspace/types";
import {
  LOOKBOOK_MEMBERSHIP_RELATION,
  getVisibleLookbookMemberNodes,
  isLookbookNodeType,
} from "./lookbookIdentities";

const COLUMN_COUNT = 12;
const BOARD_MARGIN = 0.04;
const BOARD_GAP = 0.018;
const MIN_ITEM_WIDTH = 0.1;
const MAX_ITEM_WIDTH = 0.72;
const MAX_WORLD_Y = 24;
const ITEMS_PER_SPREAD = 6;
const LOOKBOOK_PAGE_WIDTH = 0.5;
const LOOKBOOK_PAGE_MARGIN_X = 0.028;
const LOOKBOOK_PAGE_MARGIN_Y = 0.05;

export const LOOKBOOK_SPREAD_HEIGHT = 0.68;

export type LookbookImageAssetInput = {
  id?: string;
  name: string;
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  storageBucket?: "assets" | "public-assets" | null;
  storagePath?: string | null;
};

export type LookbookBoardItem = {
  node: NodeFlowNode;
  layout: LookbookLayout;
  spreadIndex: number;
  aspectRatio: number;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const isLookbookLayout = (value: unknown): value is LookbookLayout => {
  if (!value || typeof value !== "object") return false;
  const layout = value as Partial<LookbookLayout>;
  return isFiniteNumber(layout.x) &&
    isFiniteNumber(layout.y) &&
    isFiniteNumber(layout.width) &&
    isFiniteNumber(layout.height) &&
    isFiniteNumber(layout.rotation) &&
    isFiniteNumber(layout.zIndex) &&
    (layout.fit === "cover" || layout.fit === "contain") &&
    layout.width > 0 &&
    layout.height > 0;
};

export const sanitizeLookbookLayout = (layout: LookbookLayout): LookbookLayout => {
  const width = clamp(layout.width, MIN_ITEM_WIDTH, MAX_ITEM_WIDTH);
  return {
    x: clamp(layout.x, 0, 1 - width),
    y: clamp(layout.y, 0, MAX_WORLD_Y),
    width,
    height: clamp(layout.height, 0.08, 1.2),
    rotation: clamp(layout.rotation, -6, 6),
    zIndex: Math.max(1, Math.round(layout.zIndex)),
    fit: layout.fit,
  };
};

export const getLookbookPageIndexForLayout = (spreadIndex: number, layout: LookbookLayout) => {
  const sanitized = sanitizeLookbookLayout(layout);
  const side = sanitized.x + sanitized.width / 2 >= LOOKBOOK_PAGE_WIDTH ? 1 : 0;
  return Math.max(0, Math.round(spreadIndex)) * 2 + side;
};

/** Keep one content item completely inside one physical page of the current spread. */
export const fitLookbookLayoutToPage = (layout: LookbookLayout, pageIndex: number): LookbookLayout => {
  const sanitized = sanitizeLookbookLayout(layout);
  const targetSide = Math.max(0, Math.round(pageIndex)) % 2;
  const sourceSide = sanitized.x + sanitized.width / 2 >= LOOKBOOK_PAGE_WIDTH ? 1 : 0;
  const targetLeft = targetSide * LOOKBOOK_PAGE_WIDTH;
  const sourceLeft = sourceSide * LOOKBOOK_PAGE_WIDTH;
  // Keep a microscopic safety gutter so floating-point addition can never
  // place the rendered edge one sub-pixel beyond the physical page.
  const maximumWidth = LOOKBOOK_PAGE_WIDTH - LOOKBOOK_PAGE_MARGIN_X * 2 - 0.000001;
  const maximumHeight = LOOKBOOK_SPREAD_HEIGHT - LOOKBOOK_PAGE_MARGIN_Y * 2 - 0.000001;
  const width = Math.min(sanitized.width, maximumWidth);
  const height = Math.min(sanitized.height, maximumHeight);
  const localX = sanitized.x - sourceLeft;
  return {
    ...sanitized,
    x: clamp(
      targetLeft + localX,
      targetLeft + LOOKBOOK_PAGE_MARGIN_X,
      targetLeft + LOOKBOOK_PAGE_WIDTH - LOOKBOOK_PAGE_MARGIN_X - width
    ),
    y: clamp(
      sanitized.y,
      LOOKBOOK_PAGE_MARGIN_Y,
      Math.max(LOOKBOOK_PAGE_MARGIN_Y, LOOKBOOK_SPREAD_HEIGHT - LOOKBOOK_PAGE_MARGIN_Y - height)
    ),
    width,
    height,
  };
};

const layoutsEqual = (left: LookbookLayout, right: LookbookLayout) =>
  left.x === right.x && left.y === right.y && left.width === right.width &&
  left.height === right.height && left.rotation === right.rotation &&
  left.zIndex === right.zIndex && left.fit === right.fit;

const entriesEqual = (left: LookbookBookEntry[], right: LookbookBookEntry[]) =>
  left.length === right.length && left.every((entry, index) => {
    const candidate = right[index];
    return candidate?.nodeId === entry.nodeId &&
      candidate.spreadIndex === entry.spreadIndex &&
      layoutsEqual(candidate.layout, entry.layout);
  });

const readDimensions = (node: NodeFlowNode) => {
  const dimensions = node.data?.dimensions;
  if (!dimensions || typeof dimensions !== "object") return null;
  const width = (dimensions as { width?: unknown }).width;
  const height = (dimensions as { height?: unknown }).height;
  if (!isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0) return null;
  return { width, height };
};

export const getLookbookNodeAspectRatio = (node: NodeFlowNode) => {
  const dimensions = readDimensions(node);
  if (dimensions) return clamp(dimensions.width / dimensions.height, 0.28, 3.4);
  if (node.type === "videoInput") return 16 / 9;
  if (node.type === "audioInput") return 1.8;
  return node.type === "imageInput" ? 4 / 5 : 1.32;
};

const getColumnSpan = (node: NodeFlowNode, aspectRatio: number) => {
  if (node.type === "videoInput") return 6;
  if (node.type === "audioInput") return 4;
  if (node.type === "mdText" || node.type === "text") return 4;
  if (aspectRatio >= 1.48) return 6;
  if (aspectRatio <= 0.78) return 3;
  return 4;
};

const getLayoutHeight = (node: NodeFlowNode, width: number, aspectRatio: number) => {
  if (node.type === "mdText" || node.type === "text") return width * 0.76;
  if (node.type === "audioInput") return width * 0.58;
  return clamp(width / aspectRatio, 0.14, 0.58);
};

const prefersContain = (node: NodeFlowNode) =>
  node.type === "imageInput" && (node.data as ImageInputNodeData).hasAlpha === true;

/** Generic adaptive layout retained for migration and non-book projections. */
export const buildAdaptiveLookbookLayouts = (
  nodes: NodeFlowNode[],
  startY = BOARD_MARGIN
): Map<string, LookbookLayout> => {
  const columnWidth = (1 - BOARD_MARGIN * 2 - BOARD_GAP * (COLUMN_COUNT - 1)) / COLUMN_COUNT;
  const skyline = Array<number>(COLUMN_COUNT).fill(Math.max(BOARD_MARGIN, startY));
  const layouts = new Map<string, LookbookLayout>();

  nodes.forEach((node, index) => {
    const aspectRatio = getLookbookNodeAspectRatio(node);
    const span = getColumnSpan(node, aspectRatio);
    let selectedColumn = 0;
    let selectedY = Number.POSITIVE_INFINITY;
    for (let column = 0; column <= COLUMN_COUNT - span; column += 1) {
      const candidateY = Math.max(...skyline.slice(column, column + span));
      if (candidateY < selectedY) {
        selectedColumn = column;
        selectedY = candidateY;
      }
    }
    const width = columnWidth * span + BOARD_GAP * (span - 1);
    const height = getLayoutHeight(node, width, aspectRatio);
    const layout = sanitizeLookbookLayout({
      x: nodes.length === 1 ? (1 - width) / 2 : BOARD_MARGIN + selectedColumn * (columnWidth + BOARD_GAP),
      y: selectedY,
      width,
      height,
      rotation: index % 4 === 1 ? -0.35 : index % 4 === 3 ? 0.35 : 0,
      zIndex: index + 1,
      fit: prefersContain(node) ? "contain" : "cover",
    });
    layouts.set(node.id, layout);
    const nextY = layout.y + layout.height + BOARD_GAP;
    for (let column = selectedColumn; column < selectedColumn + span; column += 1) skyline[column] = nextY;
  });
  return layouts;
};

const pageSlot = (count: number, index: number) => {
  if (count === 1) return { x: 0.5, y: 0.15, anchor: "center" as const };
  if (count === 2) return index === 0
    ? { x: 0.08, y: 0.1, anchor: "start" as const }
    : { x: 0.92, y: 0.37, anchor: "end" as const };
  return [
    { x: 0.07, y: 0.08, anchor: "start" as const },
    { x: 0.92, y: 0.13, anchor: "end" as const },
    { x: 0.5, y: 0.41, anchor: "center" as const },
  ][index]!;
};

const buildPageEntries = (
  nodes: NodeFlowNode[],
  spreadIndex: number,
  pageIndex: 0 | 1,
  zOffset: number
): LookbookBookEntry[] => nodes.map((node, index) => {
  const aspectRatio = getLookbookNodeAspectRatio(node);
  const slot = pageSlot(nodes.length, index);
  const localWidth = node.type === "text" || node.type === "mdText"
    ? 0.47
    : aspectRatio >= 1.45
      ? 0.58
      : aspectRatio <= 0.72
        ? 0.38
        : 0.46;
  const width = localWidth * 0.43;
  const height = node.type === "text" || node.type === "mdText"
    ? width * 0.82
    : node.type === "audioInput"
      ? width * 0.5
      : clamp(width / aspectRatio, 0.1, 0.31);
  const pageLeft = pageIndex * 0.5;
  const localX = slot.anchor === "center"
    ? slot.x * 0.5 - width / 2
    : slot.anchor === "end"
      ? slot.x * 0.5 - width
      : slot.x * 0.5;
  return {
    nodeId: node.id,
    spreadIndex,
    layout: sanitizeLookbookLayout({
      x: clamp(pageLeft + localX, pageLeft + 0.028, pageLeft + 0.472 - width),
      y: clamp(slot.y, 0.05, LOOKBOOK_SPREAD_HEIGHT - height - 0.05),
      width,
      height,
      rotation: index === 1 ? (pageIndex === 0 ? -0.45 : 0.45) : 0,
      zIndex: zOffset + index + 1,
      fit: prefersContain(node) ? "contain" : "cover",
    }),
  };
});

export const buildLookbookBookEntries = (nodes: NodeFlowNode[]): LookbookBookEntry[] => {
  const entries: LookbookBookEntry[] = [];
  for (let offset = 0; offset < nodes.length; offset += ITEMS_PER_SPREAD) {
    const spreadNodes = nodes.slice(offset, offset + ITEMS_PER_SPREAD);
    const leftCount = Math.ceil(spreadNodes.length / 2);
    const spreadIndex = Math.floor(offset / ITEMS_PER_SPREAD);
    entries.push(
      ...buildPageEntries(spreadNodes.slice(0, leftCount), spreadIndex, 0, offset),
      ...buildPageEntries(spreadNodes.slice(leftCount), spreadIndex, 1, offset + leftCount)
    );
  }
  return entries;
};

const appendLookbookBookEntries = (
  existingItems: LookbookBoardItem[],
  newNodes: NodeFlowNode[]
) => {
  const entries: LookbookBookEntry[] = existingItems.map((item) => ({
    nodeId: item.node.id,
    spreadIndex: item.spreadIndex,
    layout: item.layout,
  }));
  const nodeById = new Map(existingItems.map((item) => [item.node.id, item.node]));

  newNodes.forEach((node) => {
    nodeById.set(node.id, node);
    let spreadIndex = entries.length ? Math.max(...entries.map((entry) => entry.spreadIndex)) : 0;
    let spreadEntries = entries.filter((entry) => entry.spreadIndex === spreadIndex);
    if (spreadEntries.length >= ITEMS_PER_SPREAD) {
      spreadIndex += 1;
      spreadEntries = [];
    }
    const virtualNodes = [
      ...spreadEntries.flatMap((entry) => {
        const candidate = nodeById.get(entry.nodeId);
        return candidate ? [candidate] : [];
      }),
      node,
    ];
    const proposed = buildLookbookBookEntries(virtualNodes).find((entry) => entry.nodeId === node.id);
    entries.push({
      nodeId: node.id,
      spreadIndex,
      layout: proposed?.layout || buildLookbookBookEntries([node])[0]!.layout,
    });
  });
  return entries;
};

const isBookState = (value: unknown): value is LookbookBookState => {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<LookbookBookState>;
  return state.version === 1 && Array.isArray(state.entries);
};

const readBookEntries = (indexNode: NodeFlowNode | undefined) => {
  const state = indexNode?.data.lookbookBook;
  if (!isBookState(state)) return [];
  const seen = new Set<string>();
  return state.entries.flatMap((entry) => {
    if (!entry || typeof entry.nodeId !== "string" || seen.has(entry.nodeId) || !isLookbookLayout(entry.layout)) return [];
    seen.add(entry.nodeId);
    return [{
      nodeId: entry.nodeId,
      spreadIndex: Math.max(0, Math.round(isFiniteNumber(entry.spreadIndex) ? entry.spreadIndex : 0)),
      layout: sanitizeLookbookLayout(entry.layout),
    }];
  });
};

const findConnectedIdentityNodeId = (projectData: ProjectData, memberNodeId: string) => {
  const nodes = projectData.flow?.flowNodes || [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const link of projectData.flow?.links || []) {
    const candidateId = link.source === memberNodeId ? link.target : link.target === memberNodeId ? link.source : "";
    if (candidateId && isLookbookNodeType(nodeById.get(candidateId)?.type)) return candidateId;
  }
  return "";
};

export const getLookbookIndexNode = (projectData: ProjectData, identityNodeId: string) => {
  const nodes = projectData.flow?.flowNodes || [];
  const identityNode = nodes.find((node) => node.id === identityNodeId && isLookbookNodeType(node.type));
  if (!identityNode) return undefined;
  const explicitId = typeof identityNode.data.lookbookIndexNodeId === "string" ? identityNode.data.lookbookIndexNodeId : "";
  const explicit = explicitId ? nodes.find((node) => node.id === explicitId && (node.type === "text" || node.type === "mdText")) : undefined;
  if (explicit) return explicit;
  const identityId = typeof identityNode.data.identityId === "string" ? identityNode.data.identityId : "";
  return nodes.find((node) => (node.type === "text" || node.type === "mdText") && node.data.lookbookRole === "index" && node.data.lookbookIdentityId === identityId);
};

export const projectLookbookBoardItems = (
  projectData: ProjectData,
  identityNodeId: string
): LookbookBoardItem[] => {
  const nodes = getVisibleLookbookMemberNodes(projectData, identityNodeId);
  const storedEntries = readBookEntries(getLookbookIndexNode(projectData, identityNodeId));
  const storedByNodeId = new Map(storedEntries.map((entry) => [entry.nodeId, entry]));
  const fallbackByNodeId = new Map(buildLookbookBookEntries(nodes).map((entry) => [entry.nodeId, entry]));
  return nodes.map((node) => {
    const legacyLayout = isLookbookLayout(node.data.lookbookLayout)
      ? sanitizeLookbookLayout(node.data.lookbookLayout)
      : undefined;
    const entry = storedByNodeId.get(node.id) || fallbackByNodeId.get(node.id)!;
    return {
      node,
      layout: storedByNodeId.has(node.id) ? entry.layout : legacyLayout || entry.layout,
      spreadIndex: entry.spreadIndex,
      aspectRatio: getLookbookNodeAspectRatio(node),
    };
  });
};

const makeMembershipLink = (
  identityNodeId: string,
  memberNodeId: string,
  memberType: NodeFlowNode["type"]
): FlowLink => {
  const mediaHandle = memberType === "imageInput" ? "image" : memberType === "audioInput" ? "audio" : memberType === "videoInput" ? "video" : null;
  return mediaHandle ? {
    id: `link-${memberNodeId}-${identityNodeId}-lookbook`,
    source: memberNodeId,
    target: identityNodeId,
    sourceHandle: mediaHandle,
    targetHandle: mediaHandle,
    data: { relation: LOOKBOOK_MEMBERSHIP_RELATION },
  } : {
    id: `link-${identityNodeId}-${memberNodeId}-lookbook`,
    source: identityNodeId,
    target: memberNodeId,
    sourceHandle: "text",
    targetHandle: "text",
    data: { relation: LOOKBOOK_MEMBERSHIP_RELATION },
  };
};

const reserveNodeId = (nodes: NodeFlowNode[], requested: string) => {
  const ids = new Set(nodes.map((node) => node.id));
  if (!ids.has(requested)) return requested;
  let suffix = 2;
  while (ids.has(`${requested}-${suffix}`)) suffix += 1;
  return `${requested}-${suffix}`;
};

const ensureIndexDocument = (
  projectData: ProjectData,
  identityNodeId: string,
  inputNodes: NodeFlowNode[],
  inputLinks: FlowLink[]
) => {
  const nodes = [...inputNodes];
  const links = [...inputLinks];
  const identityIndex = nodes.findIndex((node) => node.id === identityNodeId && isLookbookNodeType(node.type));
  if (identityIndex < 0) return null;
  let identityNode = nodes[identityIndex]!;
  let indexNode = getLookbookIndexNode({ ...projectData, flow: { ...(projectData.flow || { links: [] }), flowNodes: nodes, links } }, identityNodeId);
  if (!indexNode) {
    const identityId = typeof identityNode.data.identityId === "string" ? identityNode.data.identityId : identityNode.id;
    const role = (projectData.roles || []).find((candidate) => candidate.id === identityId);
    const indexNodeId = reserveNodeId(nodes, role?.profileNodeId || `lookbook-index-${identityId}`);
    const title = `${role?.displayName || role?.name || identityNode.data.title || "Lookbook"} · Lookbook 索引`;
    const content = `# ${role?.displayName || role?.name || "Lookbook"}\n\n## Lookbook 索引\n\n本页保存书册的内容连接、跨页顺序与排版。`;
    indexNode = {
      id: indexNodeId,
      type: "text",
      position: { x: identityNode.position.x + 390, y: identityNode.position.y + 28 },
      data: {
        title,
        documentId: role?.profileDocumentId || indexNodeId,
        documentKind: "archive",
        format: "markdown",
        text: content,
        content,
        lookbookIdentityId: identityId,
        lookbookRole: "index",
        lookbookBook: { version: 1, pageCount: 0, entries: [] },
      } as NodeFlowNodeData,
    };
    nodes.push(indexNode);
  }
  if (identityNode.data.lookbookIndexNodeId !== indexNode.id) {
    identityNode = { ...identityNode, data: { ...identityNode.data, lookbookIndexNodeId: indexNode.id } as NodeFlowNodeData };
    nodes[identityIndex] = identityNode;
  }
  const indexLink = makeMembershipLink(identityNodeId, indexNode.id, indexNode.type);
  if (!links.some((link) => (link.source === identityNodeId && link.target === indexNode!.id) || (link.target === identityNodeId && link.source === indexNode!.id))) {
    links.push(indexLink);
  }
  return { nodes, links, identityNode, indexNode };
};

const withIndexEntries = (nodes: NodeFlowNode[], indexNodeId: string, entries: LookbookBookEntry[]) =>
  nodes.map((node) => node.id === indexNodeId ? {
    ...node,
    data: {
      ...node.data,
      lookbookBook: {
        version: 1,
        ...(isBookState(node.data.lookbookBook) && isFiniteNumber(node.data.lookbookBook.pageCount)
          ? { pageCount: Math.max(0, Math.round(node.data.lookbookBook.pageCount)) }
          : {}),
        entries,
      } satisfies LookbookBookState,
    } as NodeFlowNodeData,
  } : node);

const requiredPageCountForItems = (items: LookbookBoardItem[]) =>
  items.length ? (Math.max(...items.map((item) => item.spreadIndex)) + 1) * 2 : 0;

export const getLookbookPageCount = (projectData: ProjectData, identityNodeId: string) => {
  const indexNode = getLookbookIndexNode(projectData, identityNodeId);
  const state = indexNode?.data.lookbookBook;
  const stored = isBookState(state) && isFiniteNumber(state.pageCount)
    ? Math.max(0, Math.round(state.pageCount))
    : 0;
  return Math.max(stored, requiredPageCountForItems(projectLookbookBoardItems(projectData, identityNodeId)));
};

export const addLookbookPage = (
  projectData: ProjectData,
  identityNodeId: string,
  amount = 1
): ProjectData => {
  const increment = Math.max(1, Math.round(amount));
  const flow = projectData.flow || { links: [] };
  const ensured = ensureIndexDocument(projectData, identityNodeId, flow.flowNodes || [], flow.links);
  if (!ensured) return projectData;
  const ensuredProject = {
    ...projectData,
    flow: { ...flow, flowNodes: ensured.nodes, links: ensured.links },
  };
  const pageCount = getLookbookPageCount(ensuredProject, identityNodeId) + increment;
  return {
    ...projectData,
    flow: {
      ...flow,
      revision: (flow.revision || 0) + 1,
      flowNodes: ensured.nodes.map((node) => node.id === ensured.indexNode.id ? {
        ...node,
        data: {
          ...node.data,
          lookbookBook: {
            version: 1,
            pageCount,
            entries: readBookEntries(ensured.indexNode),
          } satisfies LookbookBookState,
        } as NodeFlowNodeData,
      } : node),
      links: ensured.links,
    },
  };
};

const flowPositionForMember = (identityNode: NodeFlowNode, index: number) => ({
  x: identityNode.position.x + 340 + (index % 3) * 310,
  y: identityNode.position.y + 360 + Math.floor(index / 3) * 300,
});

export const addLookbookImageAssets = (
  projectData: ProjectData,
  identityNodeId: string,
  assets: LookbookImageAssetInput[],
  now = Date.now()
): ProjectData => {
  if (!assets.length) return projectData;
  const flow = projectData.flow || { links: [] };
  const ensured = ensureIndexDocument(projectData, identityNodeId, flow.flowNodes || [], flow.links);
  if (!ensured) return projectData;
  const existingItems = projectLookbookBoardItems(projectData, identityNodeId);
  const existingMembers = existingItems.map((item) => item.node);
  const reservedNodes = [...ensured.nodes];
  const createdNodes = assets.map((asset, index): NodeFlowNode => {
    const id = reserveNodeId(reservedNodes, asset.id || `lookbook-image-${now.toString(36)}-${index + 1}`);
    const node: NodeFlowNode = {
      id,
      type: "imageInput",
      position: flowPositionForMember(ensured.identityNode, existingMembers.length + index),
      style: { width: 260, height: clamp(260 / Math.max(0.35, asset.width / asset.height), 180, 420) },
      data: {
        image: asset.dataUrl,
        filename: asset.name,
        label: asset.name.replace(/\.[^/.]+$/, ""),
        mimeType: asset.mimeType,
        storageBucket: asset.storageBucket || null,
        storagePath: asset.storagePath || null,
        dimensions: { width: asset.width, height: asset.height },
        hasAlpha: asset.hasAlpha,
        lookbookIdentityId: ensured.identityNode.data.identityId as string | undefined,
        lookbookRole: "member",
        assetAuditStatus: "idle",
        assetAuditMessage: null,
        assetAuditCheckedAt: null,
        assetId: null,
        assetUri: null,
        assetGroupId: null,
        assetSourceUrl: null,
      } as ImageInputNodeData,
    };
    reservedNodes.push(node);
    return node;
  });
  const links = [...ensured.links];
  createdNodes.forEach((node) => {
    const link = makeMembershipLink(identityNodeId, node.id, node.type);
    if (!links.some((existing) => existing.id === link.id)) links.push(link);
  });
  const entries = appendLookbookBookEntries(existingItems, createdNodes);
  return {
    ...projectData,
    flow: {
      ...flow,
      revision: (flow.revision || 0) + 1,
      flowNodes: withIndexEntries([...ensured.nodes, ...createdNodes], ensured.indexNode.id, entries),
      links,
    },
  };
};

export const addLookbookTextCard = (
  projectData: ProjectData,
  identityNodeId: string,
  now = Date.now(),
  requestedNodeId?: string
): { projectData: ProjectData; nodeId: string | null } => {
  const flow = projectData.flow || { links: [] };
  const ensured = ensureIndexDocument(projectData, identityNodeId, flow.flowNodes || [], flow.links);
  if (!ensured) return { projectData, nodeId: null };
  const existingItems = projectLookbookBoardItems(projectData, identityNodeId);
  const members = existingItems.map((item) => item.node);
  const nodeId = reserveNodeId(ensured.nodes, requestedNodeId || `lookbook-note-${now.toString(36)}`);
  const createdNode: NodeFlowNode = {
    id: nodeId,
    type: "text",
    position: flowPositionForMember(ensured.identityNode, members.length),
    style: { width: 280, height: 220 },
    data: {
      title: "视觉笔记",
      text: "",
      documentId: nodeId,
      documentKind: "note",
      format: "markdown",
      lookbookIdentityId: ensured.identityNode.data.identityId as string | undefined,
      lookbookRole: "member",
    } as TextNodeData,
  };
  const link = makeMembershipLink(identityNodeId, nodeId, createdNode.type);
  const entries = appendLookbookBookEntries(existingItems, [createdNode]);
  return {
    nodeId,
    projectData: {
      ...projectData,
      flow: {
        ...flow,
        revision: (flow.revision || 0) + 1,
        flowNodes: withIndexEntries([...ensured.nodes, createdNode], ensured.indexNode.id, entries),
        links: [...ensured.links.filter((item) => item.id !== link.id), link],
      },
    },
  };
};

const updateLookbookNode = (
  projectData: ProjectData,
  nodeId: string,
  update: (node: NodeFlowNode) => NodeFlowNode
) => {
  const flow = projectData.flow;
  if (!flow?.flowNodes) return projectData;
  let didUpdate = false;
  const flowNodes = flow.flowNodes.map((node) => {
    if (node.id !== nodeId) return node;
    const nextNode = update(node);
    if (nextNode !== node) didUpdate = true;
    return nextNode;
  });
  if (!didUpdate) return projectData;
  return { ...projectData, flow: { ...flow, revision: (flow.revision || 0) + 1, flowNodes } };
};

export const updateLookbookNodeLayout = (
  projectData: ProjectData,
  nodeId: string,
  layout: LookbookLayout
) => {
  const flow = projectData.flow;
  if (!flow?.flowNodes) return projectData;
  const identityNodeId = findConnectedIdentityNodeId(projectData, nodeId);
  const indexNode = identityNodeId ? getLookbookIndexNode(projectData, identityNodeId) : undefined;
  if (!identityNodeId || !indexNode) return projectData;
  const projected = projectLookbookBoardItems(projectData, identityNodeId);
  const currentEntries = readBookEntries(indexNode);
  const item = projected.find((candidate) => candidate.node.id === nodeId);
  if (!item) return projectData;
  const targetPageIndex = getLookbookPageIndexForLayout(item.spreadIndex, layout);
  const sanitized = fitLookbookLayoutToPage(layout, targetPageIndex);
  const entries = projected.map((candidate): LookbookBookEntry => ({
    nodeId: candidate.node.id,
    spreadIndex: candidate.spreadIndex,
    layout: candidate.node.id === nodeId ? sanitized : candidate.layout,
  }));
  const current = currentEntries.find((entry) => entry.nodeId === nodeId);
  if (current && layoutsEqual(current.layout, sanitized) && entriesEqual(currentEntries, entries)) return projectData;
  return {
    ...projectData,
    flow: {
      ...flow,
      revision: (flow.revision || 0) + 1,
      flowNodes: withIndexEntries(flow.flowNodes, indexNode.id, entries),
    },
  };
};

export const moveLookbookNodeToSpread = (
  projectData: ProjectData,
  identityNodeId: string,
  nodeId: string,
  spreadIndex: number
) => {
  const flow = projectData.flow;
  const indexNode = getLookbookIndexNode(projectData, identityNodeId);
  if (!flow?.flowNodes || !indexNode) return projectData;
  const nextSpreadIndex = Math.max(0, Math.round(spreadIndex));
  const entries = projectLookbookBoardItems(projectData, identityNodeId).map((item): LookbookBookEntry => ({
    nodeId: item.node.id,
    spreadIndex: item.node.id === nodeId ? nextSpreadIndex : item.spreadIndex,
    layout: item.node.id === nodeId
      ? fitLookbookLayoutToPage(
          item.layout,
          nextSpreadIndex * 2 + (getLookbookPageIndexForLayout(item.spreadIndex, item.layout) % 2)
        )
      : item.layout,
  }));
  const currentEntries = readBookEntries(indexNode);
  if (entriesEqual(currentEntries, entries)) return projectData;
  return { ...projectData, flow: { ...flow, revision: (flow.revision || 0) + 1, flowNodes: withIndexEntries(flow.flowNodes, indexNode.id, entries) } };
};

export const moveLookbookNodeToPage = (
  projectData: ProjectData,
  identityNodeId: string,
  nodeId: string,
  pageIndex: number
) => {
  const flow = projectData.flow;
  const indexNode = getLookbookIndexNode(projectData, identityNodeId);
  if (!flow?.flowNodes || !indexNode) return projectData;
  const nextPageIndex = Math.max(0, Math.round(pageIndex));
  const nextSpreadIndex = Math.floor(nextPageIndex / 2);
  const entries = projectLookbookBoardItems(projectData, identityNodeId).map((item): LookbookBookEntry => ({
    nodeId: item.node.id,
    spreadIndex: item.node.id === nodeId ? nextSpreadIndex : item.spreadIndex,
    layout: item.node.id === nodeId
      ? fitLookbookLayoutToPage(item.layout, nextPageIndex)
      : item.layout,
  }));
  const currentEntries = readBookEntries(indexNode);
  if (entriesEqual(currentEntries, entries)) return projectData;
  return {
    ...projectData,
    flow: {
      ...flow,
      revision: (flow.revision || 0) + 1,
      flowNodes: withIndexEntries(flow.flowNodes, indexNode.id, entries),
    },
  };
};

export const updateLookbookTextCard = (
  projectData: ProjectData,
  nodeId: string,
  patch: { title?: string; text?: string }
) => updateLookbookNode(projectData, nodeId, (node) => {
  const titleUnchanged = patch.title === undefined || patch.title === node.data.title;
  const textUnchanged = patch.text === undefined || patch.text === node.data.text;
  if (titleUnchanged && textUnchanged) return node;
  return {
    ...node,
    data: {
      ...node.data,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.text !== undefined ? { text: patch.text } : {}),
    } as NodeFlowNodeData,
  };
});

export const reflowLookbookLayouts = (
  projectData: ProjectData,
  identityNodeId: string
): ProjectData => {
  const flow = projectData.flow;
  const indexNode = getLookbookIndexNode(projectData, identityNodeId);
  if (!flow?.flowNodes || !indexNode) return projectData;
  const members = getVisibleLookbookMemberNodes(projectData, identityNodeId);
  const entries = buildLookbookBookEntries(members);
  if (entriesEqual(readBookEntries(indexNode), entries)) return projectData;
  return { ...projectData, flow: { ...flow, revision: (flow.revision || 0) + 1, flowNodes: withIndexEntries(flow.flowNodes, indexNode.id, entries) } };
};

export const getLookbookSpreadCount = (items: LookbookBoardItem[], pageCount = 0) =>
  Math.max(1, Math.ceil(Math.max(0, pageCount) / 2), ...items.map((item) => item.spreadIndex + 1));

export const getLookbookWorldHeight = (_items: LookbookBoardItem[]) => LOOKBOOK_SPREAD_HEIGHT;
