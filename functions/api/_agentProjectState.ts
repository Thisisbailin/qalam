import type { ProjectData } from "../../types";
import type { NodeFlowFile } from "../../node-workspace/types";
import { parseNodeFlowFile } from "../../node-workspace/nodeflow/schema";
import type { D1DatabaseLike } from "./_types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const parseRecord = (value: unknown) => {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};
const asNumber = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export const buildAgentProjectStateFromRealtimeDocument = (
  projectId: string,
  value: unknown,
  updatedAt: number,
  serverSeq = 0,
): { projectData: ProjectData; nodeFlow: NodeFlowFile; updatedAt: number; serverSeq: number } => {
  const projectRecord = parseRecord(value);
  if (!Object.keys(projectRecord).length) {
    throw new Error("云端实时项目文档为空，请等待项目同步完成后重试。");
  }
  const projectData = projectRecord as unknown as ProjectData;
  const flowProjects = Array.isArray(projectData.flowProjects) ? projectData.flowProjects : [];
  const activeProject = flowProjects.find((project) => project.id === projectId) || flowProjects[0];
  const flow = activeProject?.flow || projectData.flow || {};
  const canvas = isRecord(projectData.canvas) ? projectData.canvas : {};
  const viewport = isRecord(canvas.viewport) ? canvas.viewport : undefined;
  const projectTitle = activeProject?.title?.trim() || projectData.fileName?.trim() || "Stylo Flow Workspace";
  const roles = Array.isArray(projectData.roles) ? projectData.roles : [];
  const designAssets = Array.isArray(projectData.designAssets) ? projectData.designAssets : [];
  const nodes = Array.isArray(flow.flowNodes) ? flow.flowNodes : [];

  const nodeFlow = parseNodeFlowFile({
    version: 2,
    revision: Math.max(0, Math.trunc(asNumber(flow.revision))),
    name: projectTitle.slice(0, 256),
    nodes,
    links: Array.isArray(flow.links) ? flow.links : [],
    graphLinks: Array.isArray(flow.graphLinks) ? flow.graphLinks : [],
    linkStyle: flow.linkStyle,
    globalAssetHistory: Array.isArray(flow.globalAssetHistory) ? flow.globalAssetHistory : [],
    nodeFlowContext: {
      rawScript: typeof projectData.rawScript === "string" ? projectData.rawScript : "",
      episodes: Array.isArray(projectData.episodes) ? projectData.episodes : [],
      roles,
      designAssets,
    },
    viewport,
    activeView: typeof flow.activeView === "string" ? flow.activeView : null,
  });

  return { projectData, nodeFlow, updatedAt, serverSeq };
};

export const loadAgentProjectState = async (
  db: D1DatabaseLike,
  userId: string,
  projectId: string,
) => {
  const row = await db.prepare(
    `SELECT project_data, updated_at, server_seq
     FROM user_project_documents
     WHERE user_id = ?1 AND project_id = ?2`,
  ).bind(userId, projectId).first<Record<string, unknown>>();
  if (!row) {
    throw new Error("云端实时项目尚未建立，请等待项目同步完成后重试。");
  }
  return buildAgentProjectStateFromRealtimeDocument(
    projectId,
    row.project_data,
    asNumber(row.updated_at),
    asNumber(row.server_seq),
  );
};
