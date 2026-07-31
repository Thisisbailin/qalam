import type { ProjectData } from "../types";
import type {
  ImageInputNodeData,
  LeporelloBookState,
  LeporelloNodeData,
  LeporelloPage,
  NodeFlowNode,
} from "../node-workspace/types";
import type { LookbookImageAssetInput } from "./lookbookWorkspace";

export const LEPORELLO_MEMBERSHIP_RELATION = "leporello-membership" as const;
export const LEPORELLO_ASPECT_RATIO = "21:9" as const;
export const LEPORELLO_MAX_PAGES = 48;

const cleanProjectName = (value?: string | null) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return (trimmed.replace(/\.[a-z0-9]{1,8}$/i, "") || "未命名项目").slice(0, 120);
};

export const createInitialLeporelloBook = (): LeporelloBookState => ({
  version: 1,
  aspectRatio: LEPORELLO_ASPECT_RATIO,
  pages: [
    { id: "cover", kind: "cover", face: "lit" },
    { id: "panel-1", kind: "panel", face: "shadow" },
    { id: "back", kind: "back", face: "lit" },
  ],
});

export const createInitialLeporelloData = (projectName?: string | null): LeporelloNodeData => ({
  title: cleanProjectName(projectName),
  aspectRatio: LEPORELLO_ASPECT_RATIO,
  leporelloBook: createInitialLeporelloBook(),
});

const sanitizePage = (value: unknown, index: number): LeporelloPage | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<LeporelloPage>;
  if (raw.kind !== "cover" && raw.kind !== "panel" && raw.kind !== "back") return null;
  const imageNodeId = typeof raw.imageNodeId === "string" && raw.imageNodeId.trim()
    ? raw.imageNodeId.trim()
    : undefined;
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 120) : `panel-${index + 1}`,
    kind: raw.kind,
    face: index % 2 === 0 ? "lit" : "shadow",
    ...(imageNodeId ? { imageNodeId } : {}),
  };
};

export const sanitizeLeporelloBook = (value: unknown): LeporelloBookState => {
  const rawPages = value && typeof value === "object" && Array.isArray((value as { pages?: unknown }).pages)
    ? (value as { pages: unknown[] }).pages.slice(0, LEPORELLO_MAX_PAGES)
    : [];
  const parsed = rawPages.map(sanitizePage).filter((page): page is LeporelloPage => Boolean(page));
  const cover = parsed.find((page) => page.kind === "cover") || createInitialLeporelloBook().pages[0];
  const panels = parsed.filter((page) => page.kind === "panel");
  const back = parsed.find((page) => page.kind === "back") || createInitialLeporelloBook().pages[2];
  const pages = [cover, ...(panels.length ? panels : [createInitialLeporelloBook().pages[1]]), back]
    .slice(0, LEPORELLO_MAX_PAGES)
    .map((page, index) => ({ ...page, face: index % 2 === 0 ? "lit" as const : "shadow" as const }));
  return { version: 1, aspectRatio: LEPORELLO_ASPECT_RATIO, pages };
};

export const getLeporelloNode = (projectData: ProjectData, nodeId?: string | null) =>
  (projectData.flow?.flowNodes || []).find((node) =>
    node.type === "leporello" && (!nodeId || node.id === nodeId)
  );

export const getLeporelloBook = (projectData: ProjectData, nodeId: string) => {
  const node = getLeporelloNode(projectData, nodeId);
  return sanitizeLeporelloBook((node?.data as Partial<LeporelloNodeData> | undefined)?.leporelloBook);
};

const updateLeporelloBook = (
  projectData: ProjectData,
  nodeId: string,
  updater: (book: LeporelloBookState) => LeporelloBookState
) => {
  const flow = projectData.flow;
  if (!flow?.flowNodes?.some((node) => node.id === nodeId && node.type === "leporello")) return projectData;
  const flowNodes = flow.flowNodes.map((node) => {
    if (node.id !== nodeId || node.type !== "leporello") return node;
    const currentBook = sanitizeLeporelloBook((node.data as Partial<LeporelloNodeData>).leporelloBook);
    const nextBook = updater(currentBook);
    if (nextBook === currentBook) return node;
    return {
      ...node,
      data: {
        ...node.data,
        aspectRatio: LEPORELLO_ASPECT_RATIO,
        leporelloBook: nextBook,
      },
    } as NodeFlowNode;
  });
  return {
    ...projectData,
    flow: { ...flow, revision: (flow.revision || 0) + 1, flowNodes },
  };
};

export const addLeporelloPanel = (projectData: ProjectData, nodeId: string, now = Date.now()) =>
  updateLeporelloBook(projectData, nodeId, (book) => {
    if (book.pages.length >= LEPORELLO_MAX_PAGES) return book;
    const backIndex = book.pages.findIndex((page) => page.kind === "back");
    const insertAt = backIndex >= 0 ? backIndex : book.pages.length;
    const idBase = `panel-${now.toString(36)}`;
    const usedIds = new Set(book.pages.map((page) => page.id));
    let id = idBase;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${idBase}-${suffix}`;
      suffix += 1;
    }
    const pages = [
      ...book.pages.slice(0, insertAt),
      { id, kind: "panel" as const, face: "lit" as const },
      ...book.pages.slice(insertAt),
    ].map((page, index) => ({ ...page, face: index % 2 === 0 ? "lit" as const : "shadow" as const }));
    return { ...book, pages };
  });

export const setLeporelloPageImage = (
  projectData: ProjectData,
  nodeId: string,
  pageId: string,
  asset: LookbookImageAssetInput,
  now = Date.now()
) => {
  const wrapper = getLeporelloNode(projectData, nodeId);
  const flow = projectData.flow;
  if (!wrapper || !flow) return projectData;
  const book = getLeporelloBook(projectData, nodeId);
  const page = book.pages.find((candidate) => candidate.id === pageId);
  if (!page || page.kind !== "panel") return projectData;

  const existingImageNode = page.imageNodeId
    ? flow.flowNodes?.find((node) => node.id === page.imageNodeId && node.type === "imageInput")
    : undefined;
  const imageNodeId = existingImageNode?.id || asset.id || `leporello-image-${now.toString(36)}`;
  const imageData: ImageInputNodeData = {
    image: asset.dataUrl,
    filename: asset.name,
    mimeType: asset.mimeType,
    dimensions: { width: asset.width, height: asset.height },
    hasAlpha: asset.hasAlpha,
    label: asset.name,
    assetAuditStatus: "idle",
    assetAuditMessage: null,
    assetAuditCheckedAt: null,
    assetId: null,
    assetUri: null,
    assetGroupId: null,
    assetSourceUrl: null,
    assetSourceBucket: null,
    assetSourcePath: null,
    storageBucket: asset.storageBucket || null,
    storagePath: asset.storagePath || null,
  };
  const nextImageNode: NodeFlowNode = existingImageNode
    ? { ...existingImageNode, data: { ...existingImageNode.data, ...imageData } }
    : {
        id: imageNodeId,
        type: "imageInput",
        position: { x: wrapper.position.x + 420, y: wrapper.position.y + 220 },
        style: { width: 320, height: 220 },
        data: imageData,
      };
  const flowNodes = existingImageNode
    ? (flow.flowNodes || []).map((node) => node.id === imageNodeId ? nextImageNode : node)
    : [...(flow.flowNodes || []), nextImageNode];
  const hasMembership = flow.links.some((link) =>
    link.data?.relation === LEPORELLO_MEMBERSHIP_RELATION &&
    ((link.source === imageNodeId && link.target === nodeId) || (link.source === nodeId && link.target === imageNodeId))
  );
  const links = hasMembership
    ? flow.links
    : [...flow.links, {
        id: `link-${imageNodeId}-${nodeId}-leporello`,
        source: imageNodeId,
        target: nodeId,
        sourceHandle: "image" as const,
        targetHandle: "image" as const,
        data: { relation: LEPORELLO_MEMBERSHIP_RELATION },
      }];
  const pages = book.pages.map((candidate) =>
    candidate.id === pageId ? { ...candidate, imageNodeId } : candidate
  );
  const finalizedNodes = flowNodes.map((node) => node.id === nodeId
    ? { ...node, data: { ...node.data, aspectRatio: LEPORELLO_ASPECT_RATIO, leporelloBook: { ...book, pages } } }
    : node
  );
  return {
    ...projectData,
    flow: {
      ...flow,
      revision: (flow.revision || 0) + 1,
      flowNodes: finalizedNodes,
      links,
    },
  };
};

export const getLeporelloPageImage = (projectData: ProjectData, page: LeporelloPage) => {
  if (!page.imageNodeId) return "";
  const node = projectData.flow?.flowNodes?.find((candidate) =>
    candidate.id === page.imageNodeId && candidate.type === "imageInput"
  );
  const image = node?.data && "image" in node.data ? node.data.image : null;
  return typeof image === "string" ? image : "";
};

export const resolveLeporelloProjectName = (projectData: ProjectData) => {
  const active = projectData.flowProjects?.find((project) => project.id === projectData.activeFlowProjectId);
  return cleanProjectName(active?.title || projectData.fileName);
};
