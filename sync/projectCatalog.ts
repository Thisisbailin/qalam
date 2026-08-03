import type { ProjectData } from "../types";
import { mergeStyloScopedProjectData } from "../agents/runtime/projectScope";
import { normalizeProjectData } from "../utils/projectData";
import { isProjectEmpty } from "../utils/persistence";
import { createEmptyProjectFlow } from "../node-workspace/foundation/scaffold";
import { switchAccountProject } from "../utils/accountProjects";
import type { AccountApiSession } from "./authenticatedFetch";
import { parseJsonResponse, requireOkResponse } from "./authenticatedFetch";

export type CloudProjectCatalogEntry = {
  projectId: string;
  title: string;
  color: string;
  durationMin: number;
  rootNodeId: string;
  createdAt: number;
  updatedAt: number;
  hasDocument: boolean;
};

export type CloudProjectCatalogManifest = Omit<
  CloudProjectCatalogEntry,
  "updatedAt" | "hasDocument"
>;

export type CloudProjectCatalog = {
  projects: CloudProjectCatalogEntry[];
  deletedProjectIds: string[];
};

const DEFAULT_PROJECT_TITLES = new Set(["", "主项目", "项目"]);

const reconcileCatalogDescriptor = (
  local: NonNullable<ProjectData["flowProjects"]>[number],
  entry: CloudProjectCatalogEntry,
) => {
  const localTitle = local.title.trim();
  const catalogTitle = entry.title.trim();
  // Catalog hydration is allowed to repair a synthetic local label, but it
  // must not let an older default catalog row overwrite a meaningful name.
  if (DEFAULT_PROJECT_TITLES.has(localTitle) && !DEFAULT_PROJECT_TITLES.has(catalogTitle)) {
    return { ...local, title: catalogTitle };
  }
  return local;
};

export const loadCloudProjectCatalog = async (session: AccountApiSession) => {
  const response = await session.request("/api/projects");
  await requireOkResponse(response, "加载云端项目目录失败");
  const payload = await parseJsonResponse<{
    projects?: CloudProjectCatalogEntry[];
    deletedProjectIds?: string[];
  }>(
    response,
    "加载云端项目目录失败",
  );
  return {
    projects: Array.isArray(payload.projects) ? payload.projects.slice(0, 100) : [],
    deletedProjectIds: Array.isArray(payload.deletedProjectIds)
      ? payload.deletedProjectIds.filter((id): id is string => typeof id === "string")
      : [],
  } satisfies CloudProjectCatalog;
};

export const updateCloudProjectCatalog = async (
  session: AccountApiSession,
  projects: CloudProjectCatalogManifest[],
) => {
  const response = await session.request("/api/projects", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projects }),
  });
  await requireOkResponse(response, "更新云端项目目录失败");
  return parseJsonResponse<{ rejectedProjectIds?: string[] }>(
    response,
    "更新云端项目目录失败",
  );
};

export const removeDeletedCatalogProjects = (
  local: ProjectData,
  deletedProjectIds: string[],
) => {
  if (!deletedProjectIds.length) return local;
  const deleted = new Set(deletedProjectIds);
  const projects = (local.flowProjects || []).filter((project) => !deleted.has(project.id));
  if (projects.length === (local.flowProjects || []).length || !projects.length) return local;
  const activeId = local.activeFlowProjectId;
  const nextId = activeId && !deleted.has(activeId) ? activeId : projects[0].id;
  return switchAccountProject({ ...local, flowProjects: projects }, nextId);
};

export const loadCloudProject = async (session: AccountApiSession, projectId: string) => {
  const response = await session.request(`/api/project?projectId=${encodeURIComponent(projectId)}`);
  if (response.status === 404) return null;
  await requireOkResponse(response, "加载云端项目失败");
  const payload = await parseJsonResponse<{ projectData?: ProjectData | { projectData?: ProjectData } }>(
    response,
    "加载云端项目失败",
  );
  const candidate = payload.projectData && "projectData" in payload.projectData
    ? payload.projectData.projectData
    : payload.projectData;
  return candidate ? normalizeProjectData(candidate) : null;
};

export const mergeMissingCloudProjects = (
  local: ProjectData,
  remoteProjects: Array<{ projectId: string; data: ProjectData }>,
) => remoteProjects.reduce(
  (current, remote) => mergeStyloScopedProjectData(current, remote.data, remote.projectId),
  local,
);

export const hydrateCloudProjectCatalog = (
  local: ProjectData,
  catalog: CloudProjectCatalogEntry[],
  remoteProjects: Array<{ projectId: string; data: ProjectData }>,
) => {
  if (!catalog.length) return local;
  const discardSyntheticLocal = isProjectEmpty(local)
    && !catalog.some((entry) => entry.projectId === local.activeFlowProjectId);
  const localProjects = discardSyntheticLocal ? [] : [...(local.flowProjects || [])];
  const byId = new Map(localProjects.map((project) => [project.id, project]));
  for (const entry of catalog) {
    const existing = byId.get(entry.projectId);
    if (existing) {
      byId.set(entry.projectId, reconcileCatalogDescriptor(existing, entry));
      continue;
    }
    byId.set(entry.projectId, {
      id: entry.projectId,
      title: entry.title,
      color: entry.color || "amber",
      durationMin: entry.durationMin || 120,
      rootNodeId: entry.rootNodeId || `project-root-${entry.projectId}`,
      createdAt: entry.createdAt || entry.updatedAt || Date.now(),
      updatedAt: entry.updatedAt || Date.now(),
      roles: [],
      designAssets: [],
      rawScript: "",
      episodes: [],
      canvas: { viewport: null },
      phase5Usage: { promptTokens: 0, responseTokens: 0, totalTokens: 0 },
      stats: { context: { total: 0, success: 0, error: 0 } },
      flow: createEmptyProjectFlow(
        entry.durationMin || 120,
        entry.title || "项目",
        entry.rootNodeId || `project-root-${entry.projectId}`,
      ),
    });
  }
  let merged: ProjectData = {
    ...local,
    flowProjects: Array.from(byId.values()),
  };
  merged = mergeMissingCloudProjects(merged, remoteProjects);
  if (discardSyntheticLocal || !merged.activeFlowProjectId || !byId.has(merged.activeFlowProjectId)) {
    merged = switchAccountProject(merged, catalog[0].projectId);
  }
  return normalizeProjectData(merged);
};

export const deleteCloudProject = async (
  session: AccountApiSession,
  projectId: string,
) => {
  const response = await session.request(`/api/project-delete?projectId=${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });
  await requireOkResponse(response, "永久删除项目失败");
};
