import type { ProjectData } from "../../types";
import type { NodeFlowNode } from "../types";
import {
  analyzeFountainLines,
  analyzeScreenplay,
  createScreenplayPreview,
  getNextScreenplayLineKind,
  SCREENPLAY_PAGE_LINE_COUNT,
  serializeScreenplayLine,
  splitScreenplayLines,
  type ScreenplayLine,
} from "./fountainEngine";

export const SCREENPLAY_PAGE_RELATION = "screenplay-page" as const;
export const SCREENPLAY_TITLE_PAGE_ROLE = "title" as const;
export const DEFAULT_SCREENPLAY_PAGE_CAPACITY = SCREENPLAY_PAGE_LINE_COUNT;

export const isScreenplayTitlePageNode = (node?: NodeFlowNode | null) =>
  node?.type === "scriptPage" && node.data?.pageRole === SCREENPLAY_TITLE_PAGE_ROLE;

export const ensureScreenplayPageLineGrid = (
  body: string,
  lineCount = SCREENPLAY_PAGE_LINE_COUNT
) => {
  // 页正文只保留真实内容：归一化行尾并去掉末尾空行。
  // 不再强制填充到 SCREENPLAY_PAGE_LINE_COUNT，避免每页后半段出现
  // 无法删除的大片空白。lineCount 仍作为“一页约一分钟戏”的容量参考，
  // 由 findAutomaticPageBreakLine 分页算法使用。
  const normalizedBody = body.replace(/\r\n?/g, "\n");
  return normalizedBody.replace(/\n+$/, "");
};

export const createBlankScreenplayPageBody = (
  lineCount = SCREENPLAY_PAGE_LINE_COUNT
) => ensureScreenplayPageLineGrid("", lineCount);

const getScriptNodes = (projectData: ProjectData) =>
  (projectData.flow?.flowNodes || []).filter((node) => node.type === "scriptPage");

const readPageNumber = (node: NodeFlowNode) => {
  const pageNumber = Number(node.data?.pageNumber);
  return Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : Number.POSITIVE_INFINITY;
};

const compareNodes = (left: NodeFlowNode, right: NodeFlowNode) =>
  readPageNumber(left) - readPageNumber(right) ||
  left.position.y - right.position.y ||
  left.position.x - right.position.x ||
  left.id.localeCompare(right.id);

const readManuscriptId = (node?: NodeFlowNode | null) => {
  const manuscriptId = node?.data?.manuscriptId;
  return typeof manuscriptId === "string" ? manuscriptId.trim() : "";
};

export const getConnectedScriptPageSequence = (
  projectData: ProjectData,
  anchorNodeId?: string | null
): NodeFlowNode[] => {
  const scriptNodes = getScriptNodes(projectData);
  if (!scriptNodes.length) return [];
  const allNodes = projectData.flow?.flowNodes || [];
  const nodeById = new Map(scriptNodes.map((node) => [node.id, node]));
  const allNodeById = new Map(allNodes.map((node) => [node.id, node]));
  const anchor = (anchorNodeId && nodeById.get(anchorNodeId)) || scriptNodes[0];
  const allLinks = projectData.flow?.links || [];
  const isManusMembership = (link: (typeof allLinks)[number]) =>
    link.data?.relation === "folder-membership" && (
      link.data?.folderKind === "manus" ||
      allNodeById.get(link.source)?.data?.folderKind === "manus"
    );
  const pageLinks = allLinks.filter(
    (link) =>
      link.data?.relation === SCREENPLAY_PAGE_RELATION &&
      nodeById.has(link.source) &&
      nodeById.has(link.target)
  );

  const neighbors = new Map<string, Set<string>>();
  pageLinks.forEach((link) => {
    if (!neighbors.has(link.source)) neighbors.set(link.source, new Set());
    if (!neighbors.has(link.target)) neighbors.set(link.target, new Set());
    neighbors.get(link.source)?.add(link.target);
    neighbors.get(link.target)?.add(link.source);
  });

  // Manus membership is durable domain data. screenplay-page edges are only
  // a repairable ordering projection, so a delayed edge can never hide a page.
  const manuscriptId = readManuscriptId(anchor);
  const folderIds = new Set(
    allLinks
      .filter((link) => isManusMembership(link) && link.target === anchor.id)
      .map((link) => link.source)
  );
  const members = new Set<string>([anchor.id]);
  if (manuscriptId) {
    scriptNodes.forEach((node) => {
      if (readManuscriptId(node) === manuscriptId) members.add(node.id);
    });
  }
  if (folderIds.size) {
    allLinks.forEach((link) => {
      if (
        isManusMembership(link) &&
        folderIds.has(link.source) &&
        nodeById.has(link.target)
      ) members.add(link.target);
    });
  }

  // Preserve legacy manuscripts that have only ordering edges, without ever
  // crossing an edge into a different explicit manuscript.
  const queue = Array.from(members);
  const traversed = new Set<string>();
  while (queue.length) {
    const nodeId = queue.shift();
    if (!nodeId || traversed.has(nodeId)) continue;
    traversed.add(nodeId);
    neighbors.get(nodeId)?.forEach((neighborId) => {
      const neighborManuscriptId = readManuscriptId(nodeById.get(neighborId));
      if (manuscriptId && neighborManuscriptId && neighborManuscriptId !== manuscriptId) return;
      members.add(neighborId);
      if (!traversed.has(neighborId)) queue.push(neighborId);
    });
  }

  const componentLinks = pageLinks.filter((link) => members.has(link.source) && members.has(link.target));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  members.forEach((nodeId) => {
    incoming.set(nodeId, 0);
    outgoing.set(nodeId, []);
  });
  componentLinks.forEach((link) => {
    incoming.set(link.target, (incoming.get(link.target) || 0) + 1);
    outgoing.get(link.source)?.push(link.target);
  });
  outgoing.forEach((targets) => targets.sort((left, right) => compareNodes(nodeById.get(left)!, nodeById.get(right)!)));

  const heads = Array.from(members)
    .filter((nodeId) => (incoming.get(nodeId) || 0) === 0)
    .map((nodeId) => nodeById.get(nodeId)!)
    .sort(compareNodes);
  const ordered: NodeFlowNode[] = [];
  const visited = new Set<string>();
  const visit = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodeById.get(nodeId);
    if (node) ordered.push(node);
    outgoing.get(nodeId)?.forEach(visit);
  };
  (heads.length ? heads : [anchor]).forEach((node) => visit(node.id));
  Array.from(members)
    .map((nodeId) => nodeById.get(nodeId)!)
    .sort(compareNodes)
    .forEach((node) => visit(node.id));
  return ordered;
};

export const ensureScreenplayTitlePage = (
  projectData: ProjectData,
  anchorNodeId?: string | null
): { projectData: ProjectData; titlePageId: string | null; created: boolean } => {
  const sequence = getConnectedScriptPageSequence(projectData, anchorNodeId);
  if (!sequence.length) return { projectData, titlePageId: null, created: false };

  const existingTitlePage = sequence.find(isScreenplayTitlePageNode);
  if (existingTitlePage) {
    const orderedIds = [existingTitlePage.id, ...sequence.filter((node) => node.id !== existingTitlePage.id).map((node) => node.id)];
    const nextProjectData = sequence[0]?.id === existingTitlePage.id
      ? projectData
      : reorderConnectedScriptPages(projectData, orderedIds);
    return { projectData: nextProjectData, titlePageId: existingTitlePage.id, created: false };
  }

  const flow = projectData.flow;
  const firstPage = sequence[0];
  if (!flow || !firstPage) return { projectData, titlePageId: null, created: false };
  const firstData = firstPage.data || {};
  const manuscriptId = typeof firstData.manuscriptId === "string" && firstData.manuscriptId.trim()
    ? firstData.manuscriptId
    : firstPage.id;
  const usedNodeIds = new Set((flow.flowNodes || []).map((node) => node.id));
  const baseId = `script-title-${manuscriptId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  let titlePageId = baseId;
  let suffix = 2;
  while (usedNodeIds.has(titlePageId)) {
    titlePageId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  const now = Date.now();
  const pageNumberById = new Map(sequence.map((node, index) => [node.id, index + 2]));
  const titlePage: NodeFlowNode = {
    id: titlePageId,
    type: "scriptPage",
    position: { x: firstPage.position.x - 380, y: firstPage.position.y },
    style: firstPage.style,
    data: {
      ...firstData,
      pageRole: SCREENPLAY_TITLE_PAGE_ROLE,
      pageNumber: 1,
      documentId: titlePageId,
      documentKind: "script",
      format: "fountain",
      text: "",
      content: "",
      preview: "",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    },
  };
  const flowNodes = [
    ...(flow.flowNodes || []).map((node) => {
      const pageNumber = pageNumberById.get(node.id);
      return pageNumber ? { ...node, data: { ...node.data, pageRole: node.data?.pageRole || "content", pageNumber } } : node;
    }),
    titlePage,
  ];
  const links = [...(flow.links || [])];
  links.push({
    id: `screenplay-page-${titlePageId}-${firstPage.id}`,
    source: titlePageId,
    target: firstPage.id,
    sourceHandle: "text",
    targetHandle: "text",
    data: { relation: SCREENPLAY_PAGE_RELATION },
  });
  const membership = links.find(
    (link) => link.data?.relation === "folder-membership" && link.target === firstPage.id
  );
  if (membership) {
    links.push({
      ...membership,
      id: `folder-membership-${membership.source}-${titlePageId}`,
      target: titlePageId,
    });
  }

  return {
    projectData: {
      ...projectData,
      flow: { ...flow, flowNodes, links },
    },
    titlePageId,
    created: true,
  };
};

export const reorderConnectedScriptPages = (
  projectData: ProjectData,
  orderedNodeIds: string[]
): ProjectData => {
  let uniqueNodeIds = Array.from(new Set(orderedNodeIds));
  if (uniqueNodeIds.length < 2 || uniqueNodeIds.length !== orderedNodeIds.length) return projectData;

  const flow = projectData.flow;
  if (!flow) return projectData;
  const scriptNodeIds = new Set(
    (flow.flowNodes || []).filter((node) => node.type === "scriptPage").map((node) => node.id)
  );
  if (uniqueNodeIds.some((nodeId) => !scriptNodeIds.has(nodeId))) return projectData;

  const titlePageId = uniqueNodeIds.find((nodeId) => {
    const node = (flow.flowNodes || []).find((item) => item.id === nodeId);
    return isScreenplayTitlePageNode(node);
  });
  if (titlePageId) {
    uniqueNodeIds = [titlePageId, ...uniqueNodeIds.filter((nodeId) => nodeId !== titlePageId)];
  }

  const currentOrder = getConnectedScriptPageSequence(projectData, uniqueNodeIds[0]).map((node) => node.id);
  if (
    currentOrder.length !== uniqueNodeIds.length ||
    currentOrder.some((nodeId) => !uniqueNodeIds.includes(nodeId))
  ) return projectData;
  if (currentOrder.every((nodeId, index) => nodeId === uniqueNodeIds[index])) return projectData;

  const reorderedIds = new Set(uniqueNodeIds);
  const links = (flow.links || []).filter((link) => !(
    link.data?.relation === SCREENPLAY_PAGE_RELATION &&
    (reorderedIds.has(link.source) || reorderedIds.has(link.target))
  ));
  for (let index = 0; index < uniqueNodeIds.length - 1; index += 1) {
    const source = uniqueNodeIds[index];
    const target = uniqueNodeIds[index + 1];
    links.push({
      id: `screenplay-page-${source}-${target}`,
      source,
      target,
      sourceHandle: "text",
      targetHandle: "text",
      data: { relation: SCREENPLAY_PAGE_RELATION },
    });
  }

  const pageNumberById = new Map(uniqueNodeIds.map((nodeId, index) => [nodeId, index + 1]));
  const flowNodes = (flow.flowNodes || []).map((node) => {
    const pageNumber = pageNumberById.get(node.id);
    if (!pageNumber) return node;
    return { ...node, data: { ...node.data, pageNumber } };
  });

  return {
    ...projectData,
    flow: { ...flow, flowNodes, links },
  };
};

export const splitScreenplayDocumentAtLine = (body: string, lineIndex: number) => {
  const lines = splitScreenplayLines(body);
  const safeIndex = Math.max(0, Math.min(lines.length, lineIndex));
  return {
    currentBody: lines.slice(0, safeIndex).join("\n"),
    nextBody: lines.slice(safeIndex).join("\n"),
  };
};

export const splitScreenplayLineAtSelection = (
  body: string,
  line: ScreenplayLine,
  selectionStart: number,
  selectionEnd = selectionStart
) => {
  const start = Math.max(0, Math.min(line.content.length, selectionStart));
  const end = Math.max(start, Math.min(line.content.length, selectionEnd));
  const before = line.content.slice(0, start);
  const after = line.content.slice(end);
  const atEnd = start === line.content.length && end === line.content.length;
  const nextKind = atEnd ? getNextScreenplayLineKind(line.kind) : line.kind;
  const nextContent = atEnd ? "" : after;
  const rawLines = splitScreenplayLines(body);
  rawLines.splice(
    line.index,
    1,
    serializeScreenplayLine(before, line.kind),
    serializeScreenplayLine(nextContent, nextKind)
  );
  return rawLines.join("\n");
};

export const mergeScreenplayLineWithPrevious = (
  body: string,
  line: ScreenplayLine
) => {
  const parsedLines = analyzeFountainLines(body);
  const previousLine = parsedLines[line.index - 1];
  if (!previousLine || line.index <= 0) {
    return { body, cursor: 0 };
  }

  const cursor = previousLine.content.length;
  const mergedContent = `${previousLine.content}${line.content}`;
  const rawLines = splitScreenplayLines(body);
  rawLines.splice(
    previousLine.index,
    2,
    serializeScreenplayLine(mergedContent, previousLine.kind)
  );
  return { body: rawLines.join("\n"), cursor };
};

const getLineCapacity = (line: ScreenplayLine) => {
  if (!line.content.trim()) return 0.55;
  const wrappedLines = Math.max(1, Math.ceil(Array.from(line.content).length / 44));
  switch (line.kind) {
    case "scene_heading":
      return 3.2;
    case "character":
    case "dual_dialogue":
      return 2.1;
    case "dialogue":
    case "parenthetical":
      return 1.35 + wrappedLines;
    case "section":
      return 2.4;
    case "page_break":
      return DEFAULT_SCREENPLAY_PAGE_CAPACITY;
    default:
      return 1.2 + wrappedLines;
  }
};

export const findAutomaticPageBreakLine = (
  body: string,
  capacity = DEFAULT_SCREENPLAY_PAGE_CAPACITY
) => {
  const lines = analyzeFountainLines(body);
  let lastContentIndex = lines.length - 1;
  while (lastContentIndex >= 0 && !lines[lastContentIndex].raw.trim()) lastContentIndex -= 1;
  if (lastContentIndex < 0) return null;
  let used = 0;
  for (const line of lines.slice(0, lastContentIndex + 1)) {
    const next = used + getLineCapacity(line);
    if (next > capacity && line.index > 0) return line.index;
    used = next;
  }
  return null;
};

export type ScreenplayReflowPage = {
  body: string;
  pinned: boolean;
};

/**
 * 行业剧本软件的页语义：内容超出当前页容量时，溢出内容流入下一页；
 * 前一页未满时**不**自动回填（刻意分页要保持），只有用户在后一页开头
 * 删除内容（手势合并）才回流。
 * - 显式分页符（===）与手动分页（pinned）是硬边界，重排不会跨过；
 * - 空页会被合并，末尾空行不会保留。
 */
export const reflowScreenplayPages = (
  pages: ScreenplayReflowPage[],
  capacity = DEFAULT_SCREENPLAY_PAGE_CAPACITY
): ScreenplayReflowPage[] => {
  type SplitChunk = { lines: ScreenplayLine[]; pinned: boolean };

  const splitByCapacity = (source: ScreenplayLine[]): SplitChunk[] => {
    const chunks: SplitChunk[] = [];
    let current: ScreenplayLine[] = [];
    let currentPinned = false;
    let used = 0;
    const flush = () => {
      if (current.length || currentPinned || !chunks.length) {
        chunks.push({ lines: current, pinned: currentPinned });
      }
      current = [];
      used = 0;
      currentPinned = false;
    };
    for (const line of source) {
      if (line.kind === "page_break") {
        // 显式分页符：结束当前页，后续内容从新页开始（硬边界）。
        flush();
        currentPinned = true;
        continue;
      }
      const lineCapacity = getLineCapacity(line);
      if (used + lineCapacity > capacity && current.length) flush();
      current.push(line);
      used += lineCapacity;
    }
    flush();
    return chunks;
  };

  const result: ScreenplayReflowPage[] = [];
  let pending: ScreenplayLine[] = [];

  const pushPage = (chunk: SplitChunk) => {
    const body = chunk.lines
      .map((line) => line.raw)
      .join("\n")
      .replace(/\n+$/, "");
    if (body || chunk.pinned || !result.length) result.push({ body, pinned: chunk.pinned });
  };

  const flushPending = () => {
    if (!pending.length) return;
    splitByCapacity(pending).forEach(pushPage);
    pending = [];
  };

  pages.forEach((page) => {
    const lines = analyzeFountainLines(page.body);
    if (page.pinned) {
      // 硬边界：上一页遗留的溢出先落成独立页，再处理本页。
      flushPending();
      const chunks = splitByCapacity(lines);
      chunks.forEach((chunk, index) => {
        if (chunk.pinned) pushPage(chunk);
        else if (index === 0) pushPage({ ...chunk, pinned: true });
        else pending.push(...chunk.lines);
      });
      return;
    }
    const combined = [...pending, ...lines];
    pending = [];
    const chunks = splitByCapacity(combined);
    chunks.forEach((chunk, index) => {
      if (chunk.pinned) pushPage(chunk);
      else if (index === 0) pushPage(chunk);
      else pending.push(...chunk.lines);
    });
  });
  flushPending();

  if (!result.length) result.push({ body: "", pinned: false });
  return result;
};

export type ScreenplayReflowResult = {
  projectData: ProjectData;
  changed: boolean;
  contentNodeIds: string[];
  chunkBodies: string[];
  cursor: { chunkIndex: number; lineIndex: number } | null;
};

/**
 * 对连接的稿纸序列做连续流重排：从锚点页（含前一页）开始把正文拼成
 * 连续流并重新切页，写回节点（必要时增删节点并重建页间链），
 * 返回光标在重排后所属的页与行，便于编辑器把焦点带到内容真正所在的位置。
 */
export const reflowConnectedScriptPages = (
  projectData: ProjectData,
  anchorNodeId: string,
  options?: {
    bodyOverrides?: Record<string, string>;
    cursorLine?: number;
    capacity?: number;
    /** 手势合并：把该页开头删除后的剩余内容回流到上一页（溶解硬边界）。 */
    mergeNextPageId?: string;
  }
): ScreenplayReflowResult | null => {
  const flow = projectData.flow;
  const sequence = getConnectedScriptPageSequence(projectData, anchorNodeId);
  const contentNodes = sequence.filter((node) => !isScreenplayTitlePageNode(node));
  if (!contentNodes.length) return null;
  const anchorIndex = contentNodes.findIndex((node) => node.id === anchorNodeId);
  const safeAnchorIndex = anchorIndex < 0 ? contentNodes.length - 1 : anchorIndex;
  const mergeIndex = options?.mergeNextPageId
    ? contentNodes.findIndex((node) => node.id === options.mergeNextPageId)
    : -1;
  const canMerge = mergeIndex >= 1;
  const startIndex = canMerge
    ? mergeIndex - 1
    : Math.max(0, safeAnchorIndex - 1);

  const tailNodes = contentNodes.slice(startIndex);
  const overrides = options?.bodyOverrides || {};
  const pages: ScreenplayReflowPage[] = [];
  let anchorStreamOffset: number | null = null;
  for (let index = 0; index < tailNodes.length; index += 1) {
    const node = tailNodes[index];
    const body =
      overrides[node.id] ?? String(node.data?.content || node.data?.text || "");
    if (canMerge && node.id === options?.mergeNextPageId && pages.length > 0) {
      const previous = pages[pages.length - 1];
      const previousLineCount = analyzeFountainLines(previous.body).length;
      const offsetBeforePrevious = pages
        .slice(0, -1)
        .reduce((sum, page) => sum + analyzeFountainLines(page.body).length, 0);
      previous.body = `${previous.body}${previous.body ? "\n" : ""}${body}`;
      previous.pinned = false;
      if (node.id === anchorNodeId) anchorStreamOffset = offsetBeforePrevious + previousLineCount;
      continue;
    }
    if (node.id === anchorNodeId) {
      anchorStreamOffset = pages.reduce(
        (sum, page) => sum + analyzeFountainLines(page.body).length,
        0
      );
    }
    pages.push({ body, pinned: node.data?.pinnedBreak === true });
  }
  const capacity = options?.capacity || DEFAULT_SCREENPLAY_PAGE_CAPACITY;
  const reflowed = reflowScreenplayPages(pages, capacity);
  if (!reflowed.length) return null;

  let cursor: { chunkIndex: number; lineIndex: number } | null = null;
  if (options?.cursorLine !== undefined && anchorStreamOffset !== null) {
    const cursorStreamIndex = anchorStreamOffset + Math.max(0, options.cursorLine);
    let acc = 0;
    for (let chunkIndex = 0; chunkIndex < reflowed.length; chunkIndex += 1) {
      const lineCount = analyzeFountainLines(reflowed[chunkIndex].body).length;
      if (cursorStreamIndex < acc + lineCount) {
        cursor = {
          chunkIndex,
          lineIndex: Math.min(lineCount - 1, Math.max(0, cursorStreamIndex - acc)),
        };
        break;
      }
      acc += lineCount;
    }
    if (!cursor && reflowed.length) {
      cursor = { chunkIndex: reflowed.length - 1, lineIndex: 0 };
    }
  }

  const tailIds = new Set(tailNodes.map((node) => node.id));
  const keptBefore = contentNodes.slice(0, startIndex);
  const titlePage = sequence.find(isScreenplayTitlePageNode);
  const manuscriptId =
    (typeof tailNodes[0]?.data?.manuscriptId === "string" && tailNodes[0].data.manuscriptId.trim()) ||
    tailNodes[0]?.id ||
    "";
  const now = Date.now();
  const hasTitle = Boolean(titlePage);
  const manusFolderId =
    (flow?.links || []).find(
      (link) =>
        link.data?.relation === "folder-membership" &&
        (link.target === anchorNodeId || (tailNodes.length > 0 && link.target === tailNodes[0].id))
    )?.source || undefined;

  const newTailNodes: NodeFlowNode[] = [];
  const createdNodeIds: string[] = [];
  reflowed.forEach((chunk, index) => {
    const body = chunk.body;
    const stats = analyzeScreenplay(body).stats;
    const existing = tailNodes[index];
    const pageNumber = hasTitle ? startIndex + index + 2 : startIndex + index + 1;
    if (existing) {
      newTailNodes.push({
        ...existing,
        data: {
          ...existing.data,
          title: existing.data?.title || "未命名剧本",
          text: body,
          content: body,
          documentKind: "script",
          format: "fountain",
          preview: createScreenplayPreview(body),
          screenplayStats: stats,
          pinnedBreak: chunk.pinned,
          pageNumber,
          revision:
            typeof existing.data?.revision === "number" ? existing.data.revision + 1 : 1,
          updatedAt: now,
        },
      } as NodeFlowNode);
      return;
    }
    const prevNode = newTailNodes[newTailNodes.length - 1] || tailNodes[tailNodes.length - 1];
    const nodeId = `script-page-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}-${index}`;
    createdNodeIds.push(nodeId);
    newTailNodes.push({
      id: nodeId,
      type: "scriptPage",
      position: {
        x: (prevNode?.position?.x ?? 0) + 380,
        y: prevNode?.position?.y ?? 0,
      },
      style: prevNode?.style,
      data: {
        title: "未命名剧本",
        text: body,
        content: body,
        documentId: nodeId,
        documentKind: "script",
        format: "fountain",
        manuscriptId,
        pageNumber,
        preview: createScreenplayPreview(body),
        screenplayStats: stats,
        pinnedBreak: chunk.pinned,
        revision: 1,
        updatedAt: now,
      },
    } as NodeFlowNode);
  });

  const changed =
    newTailNodes.length !== tailNodes.length ||
    newTailNodes.some((node, index) => {
      const previous = tailNodes[index];
      if (!previous) return true;
      const previousBody = String(previous.data?.content || previous.data?.text || "");
      const normalize = (value: string) => value.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
      return (
        normalize(String(node.data?.content || node.data?.text || "")) !== normalize(previousBody) ||
        node.data?.pinnedBreak !== (previous.data?.pinnedBreak === true)
      );
    });

  const keptIds = new Set([
    ...(titlePage ? [titlePage.id] : []),
    ...keptBefore.map((node) => node.id),
  ]);
  const flowNodes = [
    ...(flow?.flowNodes || []).filter((node) => !tailIds.has(node.id)),
    ...newTailNodes,
  ];

  const orderedIds = [
    ...(titlePage ? [titlePage.id] : []),
    ...keptBefore.map((node) => node.id),
    ...newTailNodes.map((node) => node.id),
  ];
  const orderedIdSet = new Set(orderedIds);
  const links = (flow?.links || []).filter(
    (link) =>
      !(
        link.data?.relation === SCREENPLAY_PAGE_RELATION &&
        orderedIdSet.has(link.source) &&
        orderedIdSet.has(link.target)
      ) &&
      !(link.data?.relation === "folder-membership" && tailIds.has(link.target))
  );
  for (let index = 0; index < orderedIds.length - 1; index += 1) {
    const source = orderedIds[index];
    const target = orderedIds[index + 1];
    links.push({
      id: `screenplay-page-${source}-${target}`,
      source,
      target,
      sourceHandle: "text",
      targetHandle: "text",
      data: { relation: SCREENPLAY_PAGE_RELATION },
    });
  }
  if (manusFolderId) {
    createdNodeIds.forEach((nodeId) => {
      links.push({
        id: `folder-membership-${manusFolderId}-${nodeId}`,
        source: manusFolderId,
        target: nodeId,
        data: { relation: "folder-membership", folderKind: "manus" },
      });
    });
  }

  return {
    projectData: {
      ...projectData,
      flow: { ...flow, flowNodes, links },
    },
    changed,
    contentNodeIds: newTailNodes.map((node) => node.id),
    chunkBodies: reflowed.map((chunk) => chunk.body),
    cursor,
  };
};
