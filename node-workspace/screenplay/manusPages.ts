import type { ProjectData } from "../../types";
import type { NodeFlowNode } from "../types";
import {
  analyzeFountainLines,
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
  const normalizedBody = body.replace(/\r\n?/g, "\n");
  const lines = splitScreenplayLines(normalizedBody);
  const targetLineCount = Math.max(1, Math.floor(lineCount));
  if (lines.length >= targetLineCount) return normalizedBody;
  return [...lines, ...Array.from({ length: targetLineCount - lines.length }, () => "")].join("\n");
};

export const createBlankScreenplayPageBody = (
  lineCount = SCREENPLAY_PAGE_LINE_COUNT
) => ensureScreenplayPageLineGrid("", lineCount);

const getScriptNodes = (projectData: ProjectData) =>
  (projectData.flow?.flowNodes || []).filter((node) => node.type === "scriptPage");

const compareNodes = (left: NodeFlowNode, right: NodeFlowNode) =>
  left.position.y - right.position.y || left.position.x - right.position.x || left.id.localeCompare(right.id);

export const getConnectedScriptPageSequence = (
  projectData: ProjectData,
  anchorNodeId?: string | null
): NodeFlowNode[] => {
  const scriptNodes = getScriptNodes(projectData);
  if (!scriptNodes.length) return [];
  const nodeById = new Map(scriptNodes.map((node) => [node.id, node]));
  const anchor = (anchorNodeId && nodeById.get(anchorNodeId)) || scriptNodes[0];
  const links = (projectData.flow?.links || []).filter(
    (link) =>
      link.data?.relation === SCREENPLAY_PAGE_RELATION &&
      nodeById.has(link.source) &&
      nodeById.has(link.target)
  );
  if (!links.length) return [anchor];

  const neighbors = new Map<string, Set<string>>();
  links.forEach((link) => {
    if (!neighbors.has(link.source)) neighbors.set(link.source, new Set());
    if (!neighbors.has(link.target)) neighbors.set(link.target, new Set());
    neighbors.get(link.source)?.add(link.target);
    neighbors.get(link.target)?.add(link.source);
  });
  const component = new Set<string>();
  const queue = [anchor.id];
  while (queue.length) {
    const nodeId = queue.shift();
    if (!nodeId || component.has(nodeId)) continue;
    component.add(nodeId);
    neighbors.get(nodeId)?.forEach((neighborId) => {
      if (!component.has(neighborId)) queue.push(neighborId);
    });
  }

  const componentLinks = links.filter((link) => component.has(link.source) && component.has(link.target));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  component.forEach((nodeId) => {
    incoming.set(nodeId, 0);
    outgoing.set(nodeId, []);
  });
  componentLinks.forEach((link) => {
    incoming.set(link.target, (incoming.get(link.target) || 0) + 1);
    outgoing.get(link.source)?.push(link.target);
  });
  outgoing.forEach((targets) => targets.sort((left, right) => compareNodes(nodeById.get(left)!, nodeById.get(right)!)));

  const heads = Array.from(component)
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
  Array.from(component)
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
