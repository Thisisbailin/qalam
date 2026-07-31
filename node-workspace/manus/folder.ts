import type { FlowLink } from "../../types";
import type { FolderNodeData, NodeFlowLink, NodeFlowNode } from "../types";
import { SCREENPLAY_PAGE_RELATION } from "../screenplay/manusPages";

export const FOLDER_MEMBERSHIP_RELATION = "folder-membership" as const;
export const MANUS_FOLDER_KIND = "manus" as const;
export const MANUS_FOLDER_NODE_SIZE = { width: 286, height: 356 } as const;

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const getNodeTitle = (node: NodeFlowNode) => {
  const title = typeof node.data?.title === "string" ? node.data.title.trim() : "";
  return title || "剧本";
};

const compareNodes = (left: NodeFlowNode, right: NodeFlowNode) =>
  left.position.y - right.position.y ||
  left.position.x - right.position.x ||
  left.id.localeCompare(right.id);

const orderPages = (pages: NodeFlowNode[], links: NodeFlowLink[]) => {
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const incoming = new Map(pages.map((page) => [page.id, 0]));
  const outgoing = new Map(pages.map((page) => [page.id, [] as string[]]));
  links.forEach((link) => {
    if (
      link.data?.relation !== SCREENPLAY_PAGE_RELATION ||
      !pageById.has(link.source) ||
      !pageById.has(link.target)
    ) return;
    incoming.set(link.target, (incoming.get(link.target) || 0) + 1);
    outgoing.get(link.source)?.push(link.target);
  });
  outgoing.forEach((targets) => {
    targets.sort((left, right) => compareNodes(pageById.get(left)!, pageById.get(right)!));
  });

  const ordered: NodeFlowNode[] = [];
  const visited = new Set<string>();
  const visit = (pageId: string) => {
    if (visited.has(pageId)) return;
    visited.add(pageId);
    const page = pageById.get(pageId);
    if (page) ordered.push(page);
    outgoing.get(pageId)?.forEach(visit);
  };
  pages
    .filter((page) => (incoming.get(page.id) || 0) === 0)
    .sort(compareNodes)
    .forEach((page) => visit(page.id));
  [...pages].sort(compareNodes).forEach((page) => visit(page.id));
  return ordered;
};

export const isManusFolderNode = (node?: NodeFlowNode | null) =>
  node?.type === "folder" && (node.data as FolderNodeData | undefined)?.folderKind === MANUS_FOLDER_KIND;

export const isFolderMembershipLink = (link?: NodeFlowLink | null) =>
  link?.data?.relation === FOLDER_MEMBERSHIP_RELATION;

export type ManusMembershipLink = {
  id: string;
  source: string;
  target: string;
  sourceHandle: "contains";
  targetHandle: "contains";
  data: {
    relation: typeof FOLDER_MEMBERSHIP_RELATION;
    folderKind: typeof MANUS_FOLDER_KIND;
  };
};

export const createManusMembershipLink = (folderId: string, pageId: string): ManusMembershipLink => ({
  id: `folder-membership-${folderId}-${pageId}`,
  source: folderId,
  target: pageId,
  sourceHandle: "contains",
  targetHandle: "contains",
  data: {
    relation: FOLDER_MEMBERSHIP_RELATION,
    folderKind: MANUS_FOLDER_KIND,
  },
});

export const getManusFolderForPage = (
  nodes: NodeFlowNode[],
  links: NodeFlowLink[],
  pageId: string
) => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const membership = links.find(
    (link) =>
      isFolderMembershipLink(link) &&
      link.target === pageId &&
      isManusFolderNode(nodeById.get(link.source))
  );
  return membership ? nodeById.get(membership.source) || null : null;
};

export const getManusPageIds = (
  folderId: string,
  nodes: NodeFlowNode[],
  links: NodeFlowLink[]
) => {
  const scriptPageIds = new Set(
    nodes.filter((node) => node.type === "scriptPage").map((node) => node.id)
  );
  return links
    .filter(
      (link) =>
        isFolderMembershipLink(link) &&
        link.source === folderId &&
        scriptPageIds.has(link.target)
    )
    .map((link) => link.target);
};

type ManusFolderNormalization<TLink extends NodeFlowLink> = {
  nodes: NodeFlowNode[];
  links: TLink[];
  changed: boolean;
};

export function normalizeManusFolderStructure(
  inputNodes: NodeFlowNode[],
  inputLinks: FlowLink[]
): ManusFolderNormalization<FlowLink>;
export function normalizeManusFolderStructure(
  inputNodes: NodeFlowNode[],
  inputLinks: NodeFlowLink[]
): ManusFolderNormalization<NodeFlowLink>;
export function normalizeManusFolderStructure(
  inputNodes: NodeFlowNode[],
  inputLinks: NodeFlowLink[]
): ManusFolderNormalization<NodeFlowLink> {
  const scriptPages = inputNodes.filter((node) => node.type === "scriptPage");
  if (!scriptPages.length) {
    const links = inputLinks.filter((link) => !isFolderMembershipLink(link));
    return {
      nodes: inputNodes,
      links,
      changed: links.length !== inputLinks.length,
    };
  }

  const pageById = new Map(scriptPages.map((node) => [node.id, node]));
  const manusFolders = inputNodes.filter(isManusFolderNode);
  const manusFolderById = new Map(manusFolders.map((node) => [node.id, node]));
  const manusFolderByManuscriptId = new Map(
    manusFolders.flatMap((node) => {
      const manuscriptId =
        typeof node.data?.manuscriptId === "string" ? node.data.manuscriptId.trim() : "";
      return manuscriptId ? [[manuscriptId, node] as const] : [];
    })
  );

  const parent = new Map(scriptPages.map((node) => [node.id, node.id]));
  const find = (nodeId: string): string => {
    const current = parent.get(nodeId) || nodeId;
    if (current === nodeId) return nodeId;
    const root = find(current);
    parent.set(nodeId, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };

  inputLinks.forEach((link) => {
    if (
      link.data?.relation === SCREENPLAY_PAGE_RELATION &&
      pageById.has(link.source) &&
      pageById.has(link.target)
    ) {
      union(link.source, link.target);
    }
  });

  const firstPageByManuscript = new Map<string, string>();
  scriptPages.forEach((node) => {
    const manuscriptId =
      typeof node.data?.manuscriptId === "string" ? node.data.manuscriptId.trim() : "";
    if (!manuscriptId) return;
    const existing = firstPageByManuscript.get(manuscriptId);
    if (existing) union(existing, node.id);
    else firstPageByManuscript.set(manuscriptId, node.id);
  });

  const canonicalMembershipByPage = new Map<string, NodeFlowLink>();
  inputLinks.forEach((link) => {
    if (!isFolderMembershipLink(link)) return;
    if (
      manusFolderById.has(link.source) &&
      pageById.has(link.target) &&
      !canonicalMembershipByPage.has(link.target)
    ) {
      canonicalMembershipByPage.set(link.target, createManusMembershipLink(link.source, link.target));
    }
  });

  const groups = new Map<string, NodeFlowNode[]>();
  scriptPages.forEach((page) => {
    const root = find(page.id);
    const group = groups.get(root) || [];
    group.push(page);
    groups.set(root, group);
  });

  const usedNodeIds = new Set(inputNodes.map((node) => node.id));
  const createdFolders: NodeFlowNode[] = [];
  const selectedFolderByGroup = new Map<string, NodeFlowNode>();

  groups.forEach((unorderedPages, groupId) => {
    const pages = orderPages(unorderedPages, inputLinks);
    groups.set(groupId, pages);
    const manuscriptId =
      pages
        .map((page) => typeof page.data?.manuscriptId === "string" ? page.data.manuscriptId.trim() : "")
        .find(Boolean) || "";
    const existingFolder = pages
      .map((page) => canonicalMembershipByPage.get(page.id)?.source)
      .filter((folderId): folderId is string => Boolean(folderId))
      .map((folderId) => manusFolderById.get(folderId))
      .find((folder): folder is NodeFlowNode => Boolean(folder)) ||
      manusFolderByManuscriptId.get(manuscriptId);
    if (existingFolder) {
      selectedFolderByGroup.set(groupId, existingFolder);
      return;
    }

    const nextManuscriptId = manuscriptId || `manuscript-${stableHash(groupId)}`;
    let folderId = `manus-folder-${stableHash(nextManuscriptId)}`;
    let suffix = 2;
    while (usedNodeIds.has(folderId)) {
      folderId = `manus-folder-${stableHash(nextManuscriptId)}-${suffix}`;
      suffix += 1;
    }
    usedNodeIds.add(folderId);
    const anchor = pages[0];
    const folder: NodeFlowNode = {
      id: folderId,
      type: "folder",
      position: {
        x: anchor.position.x - MANUS_FOLDER_NODE_SIZE.width - 80,
        y: anchor.position.y,
      },
      style: MANUS_FOLDER_NODE_SIZE,
      deletable: false,
      data: {
        title: getNodeTitle(anchor),
        folderKind: MANUS_FOLDER_KIND,
        systemManaged: true,
        manuscriptId: nextManuscriptId,
        wrapperCollapsed: false,
      } as FolderNodeData,
    };
    createdFolders.push(folder);
    selectedFolderByGroup.set(groupId, folder);
  });

  const nextNodes = inputNodes.map((node) => {
    if (node.type !== "scriptPage") return node;
    const groupId = find(node.id);
    const folder = selectedFolderByGroup.get(groupId);
    if (!folder) return node;
    const folderData = folder.data as FolderNodeData;
    const manuscriptId =
      folderData.manuscriptId ||
      (typeof node.data?.manuscriptId === "string" && node.data.manuscriptId) ||
      `manuscript-${stableHash(folder.id)}`;
    const { wrapperCollapsed: _wrapperCollapsed, wrapperRoot: _wrapperRoot, ...pageData } = node.data;
    const nextData = {
      ...pageData,
      manuscriptId,
      pageNumber: (groups.get(groupId) || []).findIndex((page) => page.id === node.id) + 1,
    };
    return JSON.stringify(nextData) === JSON.stringify(node.data)
      ? node
      : { ...node, data: nextData };
  });

  const nonFolderLinks = inputLinks.filter((link) => !isFolderMembershipLink(link));
  const nextMemberships = Array.from(groups.entries()).flatMap(([groupId, pages]) => {
    const folder = selectedFolderByGroup.get(groupId);
    if (!folder) return [];
    return pages.map((page) => createManusMembershipLink(folder.id, page.id));
  });
  const nextLinks = [...nonFolderLinks, ...nextMemberships];
  const allNodes = [...nextNodes, ...createdFolders];
  const changed =
    createdFolders.length > 0 ||
    allNodes.some((node, index) => node !== inputNodes[index]) ||
    JSON.stringify(nextLinks) !== JSON.stringify(inputLinks);

  return { nodes: allNodes, links: nextLinks, changed };
};
