import type { NodeFlowFile, NodeFlowNode } from "../../node-workspace/types";
import type { NodeFlowHandle, StyloAgentBridge } from "../bridge/styloBridge";
import { buildNodeFlowLinkId } from "../../node-workspace/nodeflow/links";
import {
  FOUNDATION_AXES,
  getFoundationAxisDefinition,
  isFoundationAxis,
  isNodeTypeAllowedInFoundationAxis,
} from "../../node-workspace/foundation/axes";
import { createUniqueFoundationMemberName } from "../../node-workspace/foundation/membership";
import {
  assertPatchDoesNotTouchFoundationMeta,
  describeFoundationNode,
  findNodeByIdOrRef,
  getFoundationAxis,
  getFoundationRole,
  type FoundationAxis,
} from "./foundationAccess";

const ACTIONS = [
  "create_block",
  "delete_block",
  "update_block_document",
  "connect_boundary",
  "disconnect_boundary",
] as const;

type Action = (typeof ACTIONS)[number];

const BLOCK_LAYOUT = {
  blockStartX: 360,
  blockArchiveOffsetX: 270,
  columnWidth: 620,
  rowHeight: 220,
} as const;

const foundationParameters = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: [...ACTIONS],
      description:
        "Foundation operation. Only block folders, block documents, and block boundary links are writable.",
    },
    axis: {
      type: "string",
      enum: [...FOUNDATION_AXES],
      description: "Foundation axis for block operations: time or space.",
    },
    block_node_id: {
      type: "string",
      description: "Foundation block folder node id.",
    },
    block_title: {
      type: "string",
      description: "Block title when locating or creating a block.",
    },
    title: {
      type: "string",
      description: "New block or block document title.",
    },
    content: {
      type: "string",
      description: "User-facing markdown content for the block document.",
    },
    duration_min: {
      type: "number",
      description: "Time-axis block duration in minutes.",
    },
    width_weight: {
      type: "number",
      description: "Space-axis block width weight.",
    },
    color: {
      type: "string",
      description: "Foundation block color token.",
    },
    order: {
      type: "integer",
      description: "0-based order inside the selected axis.",
    },
    external_node_id: {
      type: "string",
      description: "Ordinary Flow node id to connect to or disconnect from a Foundation block.",
    },
    external_node_ref: {
      type: "string",
      description: "Ordinary Flow node ref to connect to or disconnect from a Foundation block.",
    },
    link_id: {
      type: "string",
      description: "Existing boundary link id for disconnect_boundary.",
    },
  },
  additionalProperties: false,
  required: ["action"],
} as const;

const trim = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const numberOrUndefined = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const integerOrUndefined = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) ? value : undefined;

const compactPreview = (content: string) => {
  const clean = content.replace(/\s+/g, " ").trim();
  return clean.length > 180 ? `${clean.slice(0, 180)}...` : clean;
};

const nodeTitle = (node?: NodeFlowNode | null) =>
  (typeof node?.data?.title === "string" && node.data.title.trim()) ||
  (typeof node?.data?.label === "string" && node.data.label.trim()) ||
  node?.id ||
  "";

const markdownUserContent = (content: string) => {
  const marker = "## 用户记录";
  const index = content.indexOf(marker);
  if (index < 0) return content.replace(/^# .+?\n+/, "").trim();
  return content.slice(index + marker.length).trim();
};

const parseMarkdownNumber = (content: string, label: string, fallback: number) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`${escaped}\\s*[：:]\\s*([0-9.]+)`));
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) ? value : fallback;
};

const parseMarkdownColor = (content: string, fallback = "slate") =>
  content.match(/颜色\s*[：:]\s*([A-Za-z0-9_-]+)/)?.[1] || fallback;

const blockMarkdown = ({
  axis,
  title,
  content,
  durationMin,
  widthWeight,
  color,
}: {
  axis: FoundationAxis;
  title: string;
  content: string;
  durationMin?: number;
  widthWeight?: number;
  color?: string;
}) => {
  const fields =
    axis === "time"
      ? [`- 起点：0 min`, `- 时长：${Math.max(3, Math.round(durationMin || 12))} min`, `- 颜色：${color || "slate"}`]
      : [`- 宽度权重：${Math.max(0.45, widthWeight || 1)}`, `- 颜色：${color || "slate"}`];
  return [`# ${title}`, "", `- 轴：${getFoundationAxisDefinition(axis).label}`, ...fields, "", "## 用户记录", "", content || "未记录"].join("\n");
};

const parseArgs = (input: unknown) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("operate_foundation needs an object argument.");
  }
  const raw = input as Record<string, unknown>;
  const action = trim(raw.action) as Action;
  if (!(ACTIONS as readonly string[]).includes(action)) {
    throw new Error(`operate_foundation 不支持 action=${trim(raw.action)}`);
  }
  const axis = trim(raw.axis) as FoundationAxis;
  if ((action === "create_block" || trim(raw.axis)) && !isFoundationAxis(axis)) {
    throw new Error(`Foundation block 操作需要 axis=${FOUNDATION_AXES.join("、")} 之一。`);
  }
  return {
    action,
    axis: isFoundationAxis(axis) ? axis : undefined,
    blockNodeId: trim(raw.block_node_id ?? raw.blockNodeId),
    blockTitle: trim(raw.block_title ?? raw.blockTitle),
    title: trim(raw.title),
    content: typeof raw.content === "string" ? raw.content : undefined,
    durationMin: numberOrUndefined(raw.duration_min ?? raw.durationMin),
    widthWeight: numberOrUndefined(raw.width_weight ?? raw.widthWeight),
    color: trim(raw.color),
    order: integerOrUndefined(raw.order),
    externalNodeId: trim(raw.external_node_id ?? raw.externalNodeId),
    externalNodeRef: trim(raw.external_node_ref ?? raw.externalNodeRef),
    linkId: trim(raw.link_id ?? raw.linkId),
  };
};

const foundationNodes = (workflow: NodeFlowFile) =>
  workflow.nodes.filter((node) => Boolean(getFoundationRole(node)));

const findAxisNode = (workflow: NodeFlowFile, axis: FoundationAxis) => {
  const node = foundationNodes(workflow).find(
    (item) => getFoundationRole(item) === "axis-folder" && getFoundationAxis(item) === axis
  );
  if (!node) throw new Error(`找不到 Foundation ${getFoundationAxisDefinition(axis).label}文件夹。`);
  return node;
};

const axisBlockFolders = (workflow: NodeFlowFile, axis: FoundationAxis) =>
  foundationNodes(workflow)
    .filter((node) => getFoundationRole(node) === "block-folder" && getFoundationAxis(node) === axis)
    .sort((a, b) => {
      const aOrder = typeof a.data?.foundationOrder === "number" ? a.data.foundationOrder : Number.MAX_SAFE_INTEGER;
      const bOrder = typeof b.data?.foundationOrder === "number" ? b.data.foundationOrder : Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder || (a.position?.y || 0) - (b.position?.y || 0) || (a.position?.x || 0) - (b.position?.x || 0);
    });

const findBlockFolder = (
  workflow: NodeFlowFile,
  input: { axis?: FoundationAxis; blockNodeId?: string; blockTitle?: string }
) => {
  const candidates = input.axis ? axisBlockFolders(workflow, input.axis) : foundationNodes(workflow).filter((node) => getFoundationRole(node) === "block-folder");
  if (input.blockNodeId) {
    const node = candidates.find((item) => item.id === input.blockNodeId);
    if (!node) throw new Error("找不到指定 Foundation block folder。");
    return node;
  }
  if (input.blockTitle) {
    const node = candidates.find((item) => nodeTitle(item) === input.blockTitle);
    if (!node) throw new Error(`找不到 Foundation block：${input.blockTitle}`);
    return node;
  }
  throw new Error("Foundation block 操作需要 block_node_id 或 block_title。");
};

const findBlockArchive = (workflow: NodeFlowFile, blockNodeId: string) => {
  const archiveId = workflow.links.find((link) => link.source === blockNodeId)?.target;
  const linkedArchive = archiveId ? workflow.nodes.find((node) => node.id === archiveId && node.type === "mdText") : null;
  const structuralArchive = workflow.nodes.find(
    (node) =>
      node.type === "mdText" &&
      getFoundationRole(node) === "block-document" &&
      node.data?.foundationParentId === blockNodeId
  );
  return structuralArchive || linkedArchive || null;
};

const assertExternalNodeAllowed = (node: NodeFlowNode | null, axis?: FoundationAxis) => {
  if (!node) throw new Error("找不到要连接的外部 Flow 节点。");
  if (getFoundationRole(node)) {
    throw new Error(`Foundation boundary 只能连接普通 Flow 节点，不能连接 ${describeFoundationNode(node)}。`);
  }
  if (axis && !isNodeTypeAllowedInFoundationAxis(axis, node.type)) {
    const definition = getFoundationAxisDefinition(axis);
    throw new Error(`${definition.label}只接受${definition.accepts === "document" ? "文档" : "多媒体"}节点。`);
  }
};

const isBoundaryLink = (workflow: NodeFlowFile, link: NodeFlowFile["links"][number]) => {
  const source = workflow.nodes.find((node) => node.id === link.source);
  const target = workflow.nodes.find((node) => node.id === link.target);
  return getFoundationRole(source) === "block-folder" && !getFoundationRole(target);
};

const nodeStorageName = (node: NodeFlowNode) =>
  (typeof node.data?.filename === "string" && node.data.filename.trim()) ||
  (typeof node.data?.title === "string" && node.data.title.trim()) ||
  (typeof node.data?.label === "string" && node.data.label.trim()) ||
  node.id;

const reindexAxisOrders = (bridge: StyloAgentBridge, axis: FoundationAxis, preferredOrder?: string[]) => {
  const workflow = bridge.getNodeFlowSnapshot();
  const blocks = axisBlockFolders(workflow, axis);
  const ordered = preferredOrder?.length
    ? preferredOrder
        .map((id) => blocks.find((block) => block.id === id))
        .filter((node): node is NodeFlowNode => Boolean(node))
    : blocks;
  ordered.forEach((block, index) => {
    if (block.data?.foundationOrder === index) return;
    bridge.updateNodeFlowNodeData(block.id, { foundationOrder: index });
  });
};

const createBlock = (bridge: StyloAgentBridge, args: ReturnType<typeof parseArgs>) => {
  if (!args.axis) throw new Error("create_block 需要 axis。");
  const workflow = bridge.getNodeFlowSnapshot();
  const axisNode = findAxisNode(workflow, args.axis);
  const currentBlocks = axisBlockFolders(workflow, args.axis);
  const order = Math.max(0, Math.min(args.order ?? currentBlocks.length, currentBlocks.length));
  const definition = getFoundationAxisDefinition(args.axis);
  const title = args.title || args.blockTitle || `${definition.blockLabel} ${currentBlocks.length + 1}`;
  const x = BLOCK_LAYOUT.blockStartX + (order % 2) * BLOCK_LAYOUT.columnWidth;
  const y = definition.layoutY + Math.floor(order / 2) * BLOCK_LAYOUT.rowHeight;
  const archiveContent = blockMarkdown({
    axis: args.axis,
    title,
    content: args.content || "",
    durationMin: args.durationMin,
    widthWeight: args.widthWeight,
    color: args.color || "slate",
  });
  const folder = bridge.createNodeFlowNode({
    type: "folder",
    title,
    x,
    y,
  });
  bridge.updateNodeFlowNodeData(folder.nodeId, {
    title,
    foundationRole: "block-folder",
    foundationAxis: args.axis,
    foundationParentId: axisNode.id,
    foundationOrder: order,
    locked: true,
  });
  const archive = bridge.createNodeFlowNode({
    type: "mdText",
    title: `${title}档案.md`,
    text: archiveContent,
    content: archiveContent,
    documentId: `${folder.nodeId}--archive`,
    x: x + BLOCK_LAYOUT.blockArchiveOffsetX,
    y: y - 18,
  });
  bridge.updateNodeFlowNodeData(archive.nodeId, {
    title: `${title}档案.md`,
    text: archiveContent,
    content: archiveContent,
    preview: compactPreview(archiveContent),
    documentKind: "archive",
    format: "markdown",
    foundationRole: "block-document",
    foundationAxis: args.axis,
    foundationParentId: folder.nodeId,
    locked: true,
  });
  bridge.connectNodeFlowNodes({
    sourceNodeId: axisNode.id,
    targetNodeId: folder.nodeId,
    sourceHandle: "text",
    targetHandle: "text",
  });
  bridge.connectNodeFlowNodes({
    sourceNodeId: folder.nodeId,
    targetNodeId: archive.nodeId,
    sourceHandle: "text",
    targetHandle: "text",
  });
  const nextIds = currentBlocks.map((block) => block.id);
  nextIds.splice(order, 0, folder.nodeId);
  reindexAxisOrders(bridge, args.axis, nextIds);
  return {
    target: "foundation:block",
    action: "create_block",
    updated: true,
    item: {
      axis: args.axis,
      block_node_id: folder.nodeId,
      archive_node_id: archive.nodeId,
      title,
      order,
    },
  };
};

const deleteBlock = (bridge: StyloAgentBridge, args: ReturnType<typeof parseArgs>) => {
  const workflow = bridge.getNodeFlowSnapshot();
  const block = findBlockFolder(workflow, args);
  const axis = getFoundationAxis(block);
  const archive = findBlockArchive(workflow, block.id);
  workflow.links
    .filter((link) => link.source === block.id && isBoundaryLink(workflow, link))
    .forEach((link) => bridge.updateNodeFlowNodeData(link.target, { foundationContainerId: undefined }));
  if (archive) bridge.removeNodeFlowNode({ nodeId: archive.id });
  bridge.removeNodeFlowNode({ nodeId: block.id });
  if (axis) reindexAxisOrders(bridge, axis);
  return {
    target: "foundation:block",
    action: "delete_block",
    updated: true,
    item: {
      axis: axis || null,
      block_node_id: block.id,
      archive_node_id: archive?.id || null,
      title: nodeTitle(block),
    },
  };
};

const updateBlockDocument = (bridge: StyloAgentBridge, args: ReturnType<typeof parseArgs>) => {
  const workflow = bridge.getNodeFlowSnapshot();
  const block = findBlockFolder(workflow, args);
  const axis = getFoundationAxis(block);
  if (!axis) throw new Error("目标不是 Foundation block。");
  const archive = findBlockArchive(workflow, block.id);
  if (!archive) throw new Error("Foundation block 缺少可编辑的块文档。");
  const currentContent =
    typeof archive.data?.content === "string"
      ? archive.data.content
      : typeof archive.data?.text === "string"
        ? archive.data.text
        : "";
  const nextTitle = args.title || nodeTitle(block);
  const nextContent = blockMarkdown({
    axis,
    title: nextTitle,
    content: args.content ?? markdownUserContent(currentContent),
    durationMin: args.durationMin ?? parseMarkdownNumber(currentContent, "时长", 12),
    widthWeight: args.widthWeight ?? parseMarkdownNumber(currentContent, "宽度权重", 1),
    color: args.color || parseMarkdownColor(currentContent, "slate"),
  });
  assertPatchDoesNotTouchFoundationMeta({
    title: nextTitle,
    text: nextContent,
    content: nextContent,
    preview: compactPreview(nextContent),
  });
  if (args.title) {
    bridge.updateNodeFlowNodeData(block.id, { title: args.title });
  }
  bridge.updateNodeFlowNodeData(archive.id, {
    title: args.title ? `${args.title}档案.md` : archive.data?.title,
    text: nextContent,
    content: nextContent,
    preview: compactPreview(nextContent),
    updatedAt: Date.now(),
  });
  if (typeof args.order === "number") {
    const blocks = axisBlockFolders(bridge.getNodeFlowSnapshot(), axis).map((item) => item.id).filter((id) => id !== block.id);
    blocks.splice(Math.max(0, Math.min(args.order, blocks.length)), 0, block.id);
    reindexAxisOrders(bridge, axis, blocks);
  }
  return {
    target: "foundation:block_document",
    action: "update_block_document",
    updated: true,
    item: {
      axis,
      block_node_id: block.id,
      archive_node_id: archive.id,
      title: nextTitle,
      order: typeof args.order === "number" ? args.order : block.data?.foundationOrder ?? null,
      duration_min: axis === "time" ? parseMarkdownNumber(nextContent, "时长", 12) : null,
      width_weight: axis !== "time" ? parseMarkdownNumber(nextContent, "宽度权重", 1) : null,
    },
  };
};

const connectBoundary = (bridge: StyloAgentBridge, args: ReturnType<typeof parseArgs>) => {
  const workflow = bridge.getNodeFlowSnapshot();
  const block = findBlockFolder(workflow, args);
  const external = findNodeByIdOrRef(workflow, {
    nodeId: args.externalNodeId,
    nodeRef: args.externalNodeRef,
  });
  const axis = getFoundationAxis(block);
  if (!axis) throw new Error("目标 Foundation block 缺少轴类型。");
  assertExternalNodeAllowed(external, axis);
  workflow.links
    .filter((link) => link.target === external!.id && isBoundaryLink(workflow, link))
    .forEach((link) => bridge.removeNodeFlowLink({ linkId: link.id, linkKind: "canvas" }));
  const destinationNames = workflow.links
    .filter((link) => link.source === block.id && link.target !== external!.id && isBoundaryLink(workflow, link))
    .map((link) => workflow.nodes.find((node) => node.id === link.target))
    .filter((node): node is NodeFlowNode => Boolean(node))
    .map(nodeStorageName);
  const currentName = nodeStorageName(external!);
  const nextName = createUniqueFoundationMemberName(currentName, destinationNames);
  const renamePatch: Record<string, unknown> = { foundationContainerId: block.id };
  if (nextName !== currentName) {
    if (typeof external!.data?.filename === "string" && external!.data.filename.trim()) renamePatch.filename = nextName;
    else if (typeof external!.data?.title === "string") renamePatch.title = nextName;
    else renamePatch.label = nextName;
  }
  bridge.updateNodeFlowNodeData(external!.id, renamePatch);
  const connected = bridge.connectNodeFlowNodes({
    sourceNodeId: block.id,
    targetNodeId: external!.id,
    sourceHandle: "text" as NodeFlowHandle,
    targetHandle: "text" as NodeFlowHandle,
  });
  return {
    target: "foundation:block_boundary",
    action: "connect_boundary",
    updated: true,
    item: {
      axis,
      block_node_id: block.id,
      external_node_id: external!.id,
      link_id: connected.linkId,
    },
  };
};

const disconnectBoundary = (bridge: StyloAgentBridge, args: ReturnType<typeof parseArgs>) => {
  const workflow = bridge.getNodeFlowSnapshot();
  const block = findBlockFolder(workflow, args);
  const external = args.externalNodeId || args.externalNodeRef
    ? findNodeByIdOrRef(workflow, { nodeId: args.externalNodeId, nodeRef: args.externalNodeRef })
    : null;
  if (external) assertExternalNodeAllowed(external, getFoundationAxis(block) || undefined);
  const linkId =
    args.linkId ||
    (external
      ? buildNodeFlowLinkId(block.id, external.id, "text", "text")
      : workflow.links.find((link) => link.source === block.id && link.target !== findBlockArchive(workflow, block.id)?.id)?.id);
  if (!linkId) throw new Error("disconnect_boundary 需要 link_id 或 external_node_id/external_node_ref。");
  const link = workflow.links.find((item) => item.id === linkId);
  if (!link || link.source !== block.id) {
    throw new Error("只能断开从 Foundation block 指向普通节点的 boundary link。");
  }
  const target = workflow.nodes.find((node) => node.id === link.target) || null;
  assertExternalNodeAllowed(target, getFoundationAxis(block) || undefined);
  bridge.removeNodeFlowLink({ linkId, linkKind: "canvas" });
  bridge.updateNodeFlowNodeData(target!.id, { foundationContainerId: undefined });
  return {
    target: "foundation:block_boundary",
    action: "disconnect_boundary",
    updated: true,
    item: {
      axis: getFoundationAxis(block) || null,
      block_node_id: block.id,
      external_node_id: target!.id,
      link_id: linkId,
    },
  };
};

export const operateFoundationToolDef = {
  name: "operate_foundation",
  description:
    "Operate the two-axis Foundation container: create/delete time or space blocks, update block documents, and assign compatible Flow nodes to one block folder. Character and scene libraries belong to Lookbook. Project root and project index are read-only.",
  parameters: foundationParameters,
  execute: (input: unknown, bridge: StyloAgentBridge) => {
    const args = parseArgs(input);
    if (args.action === "create_block") return createBlock(bridge, args);
    if (args.action === "delete_block") return deleteBlock(bridge, args);
    if (args.action === "update_block_document") return updateBlockDocument(bridge, args);
    if (args.action === "connect_boundary") return connectBoundary(bridge, args);
    if (args.action === "disconnect_boundary") return disconnectBoundary(bridge, args);
    throw new Error(`operate_foundation 不支持 action=${args.action}`);
  },
  summarize: (output: any) => {
    if (output?.action === "create_block") return `创建 Foundation ${output?.item?.axis || ""} block ${output?.item?.title || ""}`.trim();
    if (output?.action === "delete_block") return `删除 Foundation block ${output?.item?.title || output?.item?.block_node_id || ""}`.trim();
    if (output?.action === "update_block_document") return `更新 Foundation block 文档 ${output?.item?.title || ""}`.trim();
    if (output?.action === "connect_boundary") return `连接 Foundation block boundary ${output?.item?.link_id || ""}`.trim();
    if (output?.action === "disconnect_boundary") return `断开 Foundation block boundary ${output?.item?.link_id || ""}`.trim();
    return "更新 Foundation";
  },
};
