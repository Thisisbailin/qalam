import type {
  NodeFlowContextSnapshot,
  NodeFlowLink,
  NodeFlowFile,
  NodeFlowNode,
} from "../types";
import { getNodeHandles } from "../utils/handles";
import { resolveNodeFlowNodeStatus, resolveNodeFlowNodeTitle } from "./titles";
import { isNodeRefField, readStyloNodeRef } from "./compatibility";
import { isManusFolderNode } from "../manus/folder";

export type NodeFlowNodeRecord = {
  id: string;
  ref: string;
  kind: string;
  plane: "source" | "semantic" | "design" | "execution";
  assetType: string;
  title?: string;
  body: Record<string, unknown>;
  meta: Record<string, unknown>;
  inputs: string[];
  outputs: string[];
  x: number;
  y: number;
  parentId?: string | null;
};

export type NodeFlowLinkRecord = {
  id: string;
  fromNodeId: string;
  fromPort?: string | null;
  toNodeId: string;
  toPort?: string | null;
  paused: boolean;
  relation?: string | null;
};

export type NodeFlowMapView = {
  name: string;
  revision: number;
  nodes: NodeFlowNodeRecord[];
  links: NodeFlowLinkRecord[];
  viewport: NodeFlowFile["viewport"] | null;
  activeView: string | null;
};

const trimString = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonNegativeInteger = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;

const summarizeScreenplayStats = (value: unknown) => {
  if (!isRecord(value)) return undefined;
  return {
    lines: nonNegativeInteger(value.lines),
    scenes: nonNegativeInteger(value.scenes),
    characters: nonNegativeInteger(value.characters),
    locations: nonNegativeInteger(value.locations),
    words: nonNegativeInteger(value.words),
    glyphs: nonNegativeInteger(value.glyphs),
    estimatedPages: nonNegativeInteger(value.estimatedPages),
    estimatedMinutes: nonNegativeInteger(value.estimatedMinutes),
    dialoguePercent: Math.min(100, nonNegativeInteger(value.dialoguePercent)),
  };
};

const getNodeData = (node: NodeFlowNode) => (node.data || {}) as Record<string, unknown>;

export const getNodeFlowNodeRef = (node: NodeFlowNode) => trimString(readStyloNodeRef(getNodeData(node))) || node.id;

export const getNodeFlowNodePlane = (_node: NodeFlowNode): NodeFlowNodeRecord["plane"] => "execution";

export const getNodeFlowNodeAssetType = (node: NodeFlowNode) => `execution.${node.type}`;

export const getNodeFlowNodeTitle = (node: NodeFlowNode, context?: NodeFlowContextSnapshot) =>
  resolveNodeFlowNodeTitle(node, context);

const summarizeNodeBody = (node: NodeFlowNode): Record<string, unknown> => {
  const data = getNodeData(node);

  switch (node.type) {
    case "folder":
      return {
        folderKind: trimString(data.folderKind) || "generic",
        systemManaged: data.systemManaged === true,
        manuscriptId: trimString(data.manuscriptId) || null,
        wrapperCollapsed: data.wrapperCollapsed === true,
        memberCount: nonNegativeInteger(data.wrapperMemberCount),
      };
    case "pinoard":
      return {
        wrapperCollapsed: data.wrapperCollapsed === true,
        memberCount: nonNegativeInteger(data.wrapperMemberCount),
      };
    case "scriptPage":
      return {
        documentId: trimString(data.documentId) || node.id,
        documentKind: "script",
        format: "fountain",
        content: trimString(data.content) || trimString(data.text) || "",
        preview: trimString(data.preview) || "",
        revision: nonNegativeInteger(data.revision),
        screenplayStats: summarizeScreenplayStats(data.screenplayStats),
      };
    case "mdText":
      return {
        documentId: trimString(data.documentId) || node.id.replace(/^md-/, ""),
        documentKind: "archive",
        format: "markdown",
        content: trimString(data.content) || trimString(data.text) || "",
        preview: trimString(data.preview) || "",
      };
    case "text":
      return {
        documentId: trimString(data.documentId) || node.id,
        documentKind: trimString(data.documentKind) || "note",
        format: trimString(data.format) || "markdown",
        content: trimString(data.content) || trimString(data.text) || "",
      };
    case "scriptBoard":
      return {
        episodeId: data.episodeId ?? null,
        sceneId: data.sceneId ?? null,
      };
    case "lookbook":
    case "identityCard":
      return {
        identityId: data.identityId ?? null,
      };
    case "leporello":
      return {
        aspectRatio: data.aspectRatio ?? "21:9",
        leporelloBook: data.leporelloBook ?? null,
      };
    case "imageInput":
      return {
        filename: data.filename ?? null,
        image: data.image ?? null,
        dimensions: data.dimensions ?? null,
        identityId: data.identityId ?? null,
        identityTag: data.identityTag ?? null,
      };
    case "audioInput":
      return {
        filename: data.filename ?? null,
        audio: data.audio ?? null,
        durationMs: data.durationMs ?? null,
      };
    case "videoInput":
      return {
        filename: data.filename ?? null,
        video: data.video ?? null,
        durationMs: data.durationMs ?? null,
        dimensions: data.dimensions ?? null,
        aspectRatio: data.aspectRatio ?? null,
        resolution: data.resolution ?? null,
        model: data.model ?? null,
      };
    case "pdfInput":
      return {
        filename: data.filename ?? null,
        pdf: data.pdf ?? null,
        fileSize: data.fileSize ?? null,
        highlightCount: Array.isArray(data.highlights) ? data.highlights.length : 0,
      };
    case "annotation":
      return {
        sourceImage: data.sourceImage ?? null,
        outputImage: data.outputImage ?? null,
        annotationCount: Array.isArray(data.annotations) ? data.annotations.length : 0,
      };
    case "imageGen":
    case "nanoBananaImageGen":
    case "wanImageGen":
      return {
        inputImages: Array.isArray(data.inputImages) ? data.inputImages.length : 0,
        outputImage: data.outputImage ?? null,
        model: data.model ?? null,
        aspectRatio: data.aspectRatio ?? null,
        status: data.status ?? null,
        error: data.error ?? null,
        identityId: data.identityId ?? null,
        identityTag: data.identityTag ?? null,
      };
    case "wanReferenceVideoGen":
    case "viduVideoGen":
    case "seedanceVideoGen":
      return {
        inputImages: Array.isArray(data.inputImages) ? data.inputImages.length : 0,
        referenceImages: Array.isArray(data.referenceImages) ? data.referenceImages.length : 0,
        referenceVideos: Array.isArray(data.referenceVideos) ? data.referenceVideos.length : 0,
        referenceAudios: Array.isArray(data.referenceAudios) ? data.referenceAudios.length : 0,
        model: data.model ?? null,
        aspectRatio: data.aspectRatio ?? data.ratio ?? null,
        duration: data.duration ?? null,
        status: data.status ?? null,
        error: data.error ?? null,
        videoUrl: data.videoUrl ?? null,
      };
    default:
      return Object.fromEntries(
        Object.entries(data).filter(([key]) => !isNodeRefField(key) && key !== "title" && key !== "label")
      );
  }
};

const summarizeNodeMeta = (node: NodeFlowNode): Record<string, unknown> => {
  const data = getNodeData(node);
  return {
    plane: getNodeFlowNodePlane(node),
    assetType: getNodeFlowNodeAssetType(node),
    status: resolveNodeFlowNodeStatus(node),
    selected: Boolean(node.selected),
    width: typeof node.style?.width === "number" ? node.style.width : node.style?.width ?? null,
    height: typeof node.style?.height === "number" ? node.style.height : node.style?.height ?? null,
    hasViewBinding: Boolean(trimString(data.view)),
  };
};

export const toNodeFlowNodeRecord = (
  node: NodeFlowNode,
  context?: NodeFlowContextSnapshot
): NodeFlowNodeRecord => {
  const handles = isManusFolderNode(node)
    ? { inputs: [], outputs: ["contains"] }
    : getNodeHandles(node.type);
  return {
    id: node.id,
    ref: getNodeFlowNodeRef(node),
    kind: node.type,
    plane: getNodeFlowNodePlane(node),
    assetType: getNodeFlowNodeAssetType(node),
    title: getNodeFlowNodeTitle(node, context),
    body: summarizeNodeBody(node),
    meta: summarizeNodeMeta(node),
    inputs: handles.inputs,
    outputs: handles.outputs,
    x: node.position?.x ?? 0,
    y: node.position?.y ?? 0,
    parentId: node.parentId ?? null,
  };
};

export const toNodeFlowLinkRecord = (edge: NodeFlowLink): NodeFlowLinkRecord => {
  return {
    id: edge.id,
    fromNodeId: edge.source,
    fromPort: edge.sourceHandle ?? null,
    toNodeId: edge.target,
    toPort: edge.targetHandle ?? null,
    paused: Boolean(edge.data?.hasPause),
    relation: typeof edge.data?.relation === "string" ? edge.data.relation : null,
  };
};

export const toNodeFlowMapView = (workflow: NodeFlowFile): NodeFlowMapView => {
  return {
    name: workflow.name,
    revision: workflow.revision,
    nodes: workflow.nodes.map((node) => toNodeFlowNodeRecord(node, workflow.nodeFlowContext)),
    links: workflow.links.map(toNodeFlowLinkRecord),
    viewport: workflow.viewport ?? null,
    activeView: workflow.activeView ?? null,
  };
};

export const findNodeFlowNode = (workflow: NodeFlowFile, args: { nodeId?: string; nodeRef?: string }) => {
  if (args.nodeRef) {
    return workflow.nodes.find((node) => getNodeFlowNodeRef(node) === args.nodeRef);
  }
  if (args.nodeId) {
    return workflow.nodes.find((node) => node.id === args.nodeId);
  }
  return undefined;
};

export const getNodeFlowLinksForNode = (workflow: NodeFlowFile, nodeId: string) => {
  return workflow.links
    .filter((edge) => edge.source === nodeId || edge.target === nodeId)
    .map((edge) => ({
      ...toNodeFlowLinkRecord(edge),
      direction: edge.source === nodeId ? "outgoing" : "incoming",
    }));
};

export const getNodeFlowLinkRelationsForNode = (workflow: NodeFlowFile, nodeId: string) => {
  const nodeMap = new Map(workflow.nodes.map((node) => [node.id, node]));
  const rawLinks = getNodeFlowLinksForNode(workflow, nodeId);

  const toRelatedNode = (relatedNodeId: string) => {
    const related = nodeMap.get(relatedNodeId);
    if (!related) {
      return {
        nodeId: relatedNodeId,
        nodeRef: relatedNodeId,
        nodeTitle: relatedNodeId,
      };
    }
    return {
      nodeId: related.id,
      nodeRef: getNodeFlowNodeRef(related),
      nodeTitle: getNodeFlowNodeTitle(related, workflow.nodeFlowContext),
    };
  };

  const incomingLinks = rawLinks
    .filter((link) => link.direction === "incoming")
    .map((link) => {
      const related = toRelatedNode(link.fromNodeId);
      return {
        linkId: link.id,
        fromNodeId: related.nodeId,
        fromRef: related.nodeRef,
        fromTitle: related.nodeTitle,
        fromPort: link.fromPort ?? null,
        toPort: link.toPort ?? null,
        paused: link.paused,
      };
    });

  const outgoingLinks = rawLinks
    .filter((link) => link.direction === "outgoing")
    .map((link) => {
      const related = toRelatedNode(link.toNodeId);
      return {
        linkId: link.id,
        toNodeId: related.nodeId,
        toRef: related.nodeRef,
        toTitle: related.nodeTitle,
        fromPort: link.fromPort ?? null,
        toPort: link.toPort ?? null,
        paused: link.paused,
      };
    });

  return { incomingLinks, outgoingLinks };
};

export const buildNodeFlowSearchText = (node: NodeFlowNode) => {
  const record = toNodeFlowNodeRecord(node);
  return [
    record.id,
    record.ref,
    record.kind,
    record.plane,
    record.assetType,
    record.title,
    JSON.stringify(record.body),
  ]
    .filter(Boolean)
    .join(" ");
};
