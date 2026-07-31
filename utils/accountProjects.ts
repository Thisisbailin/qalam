import type { FlowState, ProjectData } from "../types";
import {
  FOUNDATION_ROOT_NODE_PREFIX,
  applyFoundationTimelineToGraph,
  createEmptyProjectFlow,
  ensureFoundationGraphSkeleton,
  parseFoundationGraph,
  recalculateTimelineBlocks,
  saveActiveFlowIntoProjects,
} from "../node-workspace/foundation/scaffold";
import { normalizeFlowProjectDuration } from "./flowProject";

export const ACCOUNT_PROJECT_LIMIT = 24;
const PROJECT_COLORS = ["amber", "moss", "blue", "rose", "violet", "slate"];

export const createAccountProjectId = () => {
  const randomId = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `flow-project-${randomId}`;
};

const ensureFlow = (flow?: FlowState): FlowState => ({
  revision: typeof flow?.revision === "number" ? flow.revision : 0,
  flowNodes: Array.isArray(flow?.flowNodes) ? flow.flowNodes : [],
  graphLinks: Array.isArray(flow?.graphLinks) ? flow.graphLinks : [],
  globalAssetHistory: Array.isArray(flow?.globalAssetHistory) ? flow.globalAssetHistory : [],
  linkStyle: flow?.linkStyle || "curved",
  activeView: flow?.activeView ?? null,
  links: Array.isArray(flow?.links) ? flow.links : [],
});

export const switchAccountProject = (previous: ProjectData, projectId: string): ProjectData => {
  const projects = saveActiveFlowIntoProjects(previous, Date.now());
  const target = projects.find((project) => project.id === projectId);
  if (!target) return previous;
  return {
    ...previous,
    fileName: target.title || previous.fileName,
    activeFlowProjectId: target.id,
    flow: ensureFlow(target.flow),
    roles: target.roles || [],
    designAssets: target.designAssets || [],
    rawScript: target.rawScript || "",
    episodes: target.episodes || [],
    canvas: target.canvas || { viewport: null },
    phase5Usage: target.phase5Usage,
    stats: target.stats || { context: { total: 0, success: 0, error: 0 } },
    flowProjects: projects,
  };
};

export const createAccountProject = (
  previous: ProjectData,
  input: { projectId?: string; title: string; durationMin: number },
): ProjectData => {
  const projects = saveActiveFlowIntoProjects(previous, Date.now());
  if (projects.length >= ACCOUNT_PROJECT_LIMIT) return previous;
  const now = Date.now();
  const id = input.projectId?.trim() || createAccountProjectId();
  if (projects.some((project) => project.id === id)) return previous;
  const title = input.title.trim() || `项目 ${projects.length + 1}`;
  const durationMin = normalizeFlowProjectDuration(input.durationMin);
  const rootNodeId = `${FOUNDATION_ROOT_NODE_PREFIX}${id}`;
  const flow = createEmptyProjectFlow(durationMin, title, rootNodeId);
  const project = {
    id,
    title,
    color: PROJECT_COLORS[projects.length % PROJECT_COLORS.length],
    durationMin,
    rootNodeId,
    createdAt: now,
    updatedAt: now,
    roles: [],
    designAssets: [],
    rawScript: "",
    episodes: [],
    canvas: { viewport: null },
    phase5Usage: { promptTokens: 0, responseTokens: 0, totalTokens: 0 },
    stats: { context: { total: 0, success: 0, error: 0 } },
    flow,
  };
  return {
    ...previous,
    fileName: title,
    activeFlowProjectId: id,
    flow,
    roles: [],
    designAssets: [],
    rawScript: "",
    episodes: [],
    canvas: { viewport: null },
    phase5Usage: { promptTokens: 0, responseTokens: 0, totalTokens: 0 },
    stats: { context: { total: 0, success: 0, error: 0 } },
    flowProjects: [...projects, project],
  };
};

export const updateAccountProject = (
  previous: ProjectData,
  projectId: string,
  patch: { title: string; durationMin: number },
): ProjectData => {
  const projects = saveActiveFlowIntoProjects(previous, Date.now());
  const current = projects.find((project) => project.id === projectId);
  if (!current) return previous;
  const title = patch.title.trim() || current.title;
  const durationMin = normalizeFlowProjectDuration(patch.durationMin, current.durationMin);
  const currentDescriptor = {
    rootNodeId: current.rootNodeId,
    title: current.title,
    durationMin: current.durationMin,
  };
  const nextDescriptor = { rootNodeId: current.rootNodeId, title, durationMin };
  const currentFlow = ensureFoundationGraphSkeleton(ensureFlow(current.flow), currentDescriptor);
  const timeline = parseFoundationGraph(currentFlow, currentDescriptor).timeline;
  const nextFlow = ensureFoundationGraphSkeleton(
    applyFoundationTimelineToGraph(currentFlow, nextDescriptor, {
      ...timeline,
      durationMin,
      blocks: recalculateTimelineBlocks(timeline.blocks, durationMin),
    }),
    nextDescriptor,
  );
  const nextProjects = projects.map((project) => project.id === projectId
    ? { ...project, title, durationMin, updatedAt: Date.now(), flow: nextFlow }
    : project);
  const active = previous.activeFlowProjectId === projectId;
  return {
    ...previous,
    fileName: active ? title : previous.fileName,
    flow: active ? nextFlow : previous.flow,
    flowProjects: nextProjects,
  };
};

export const removeAccountProject = (previous: ProjectData, projectId: string): ProjectData => {
  const projects = saveActiveFlowIntoProjects(previous, Date.now());
  if (projects.length <= 1) return previous;
  const index = projects.findIndex((project) => project.id === projectId);
  if (index < 0) return previous;
  const remaining = projects.filter((project) => project.id !== projectId);
  const activeId = previous.activeFlowProjectId || projects[0]?.id;
  const next = activeId === projectId
    ? remaining[Math.min(index, remaining.length - 1)]
    : remaining.find((project) => project.id === activeId) || remaining[0];
  return {
    ...previous,
    fileName: next.title || previous.fileName,
    activeFlowProjectId: next.id,
    flow: ensureFlow(next.flow),
    roles: next.roles || [],
    designAssets: next.designAssets || [],
    rawScript: next.rawScript || "",
    episodes: next.episodes || [],
    canvas: next.canvas || { viewport: null },
    phase5Usage: next.phase5Usage,
    stats: next.stats || { context: { total: 0, success: 0, error: 0 } },
    flowProjects: remaining,
  };
};
