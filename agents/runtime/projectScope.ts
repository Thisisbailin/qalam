import type { ProjectData } from "../../types";

export const DEFAULT_STYLO_PROJECT_ID = "flow-project-main";
export const STYLO_CONVERSATION_STORAGE_PREFIX = "stylo_conversations_v2";
export const STYLO_ACTIVITY_STORAGE_PREFIX = "stylo_agent_tool_activity_v2";

const normalizeScopePart = (value: string | undefined, fallback: string) => {
  const normalized = (value || "").trim();
  return normalized || fallback;
};

const encodeScopePart = (value: string) => encodeURIComponent(value);

export const resolveStyloProjectId = (projectData: Pick<ProjectData, "activeFlowProjectId" | "flowProjects">) =>
  normalizeScopePart(
    projectData.activeFlowProjectId || projectData.flowProjects?.[0]?.id,
    DEFAULT_STYLO_PROJECT_ID
  );

export const buildStyloScopedProjectData = (projectData: ProjectData, projectId: string): ProjectData => {
  const normalizedProjectId = assertStyloProjectScope(projectId, projectData);
  const activeProject = projectData.flowProjects?.find((project) => project.id === normalizedProjectId);
  const scopedFlow = activeProject?.flow || projectData.flow;
  return {
    ...projectData,
    fileName: activeProject?.title || projectData.fileName,
    rawScript: activeProject?.rawScript ?? projectData.rawScript,
    episodes: activeProject?.episodes ?? projectData.episodes,
    canvas: activeProject?.canvas ?? projectData.canvas,
    phase5Usage: activeProject?.phase5Usage ?? projectData.phase5Usage,
    stats: activeProject?.stats ?? projectData.stats,
    activeFlowProjectId: normalizedProjectId,
    flow: scopedFlow,
    roles: activeProject?.roles || projectData.roles || [],
    designAssets: activeProject?.designAssets || projectData.designAssets || [],
    flowProjects: activeProject
      ? [{ ...activeProject, flow: scopedFlow || activeProject.flow }]
      : projectData.flowProjects?.filter((project) => project.id === normalizedProjectId),
  };
};

export const mergeStyloScopedProjectData = (
  local: ProjectData,
  remote: ProjectData,
  projectId: string,
): ProjectData => {
  const normalizedProjectId = assertStyloProjectScope(projectId, remote);
  const remoteProject = remote.flowProjects?.find((project) => project.id === normalizedProjectId);
  if (!remoteProject) {
    throw new Error(`云端项目 ${normalizedProjectId} 缺少对应的 Flow 数据。`);
  }
  const localProjects = Array.isArray(local.flowProjects) ? local.flowProjects : [];
  const existingIndex = localProjects.findIndex((project) => project.id === normalizedProjectId);
  const mergedProjects = [...localProjects];
  if (existingIndex >= 0) mergedProjects[existingIndex] = remoteProject;
  else mergedProjects.push(remoteProject);

  if (resolveStyloProjectId(local) !== normalizedProjectId) {
    return { ...local, flowProjects: mergedProjects };
  }
  return {
    ...remote,
    activeFlowProjectId: normalizedProjectId,
    flow: remoteProject.flow || remote.flow,
    flowProjects: mergedProjects,
  };
};

export const resetStyloScopedProjectData = (
  local: ProjectData,
  emptyTemplate: ProjectData,
  projectId: string,
): ProjectData => {
  const normalizedProjectId = assertStyloProjectScope(projectId);
  const localProjects = Array.isArray(local.flowProjects) ? local.flowProjects : [];
  const existing = localProjects.find((project) => project.id === normalizedProjectId);
  const template = emptyTemplate.flowProjects?.[0];
  if (!existing || !template) {
    throw new Error(`无法为项目 ${normalizedProjectId} 创建空白投影。`);
  }
  const resetProject = {
    ...template,
    id: normalizedProjectId,
    title: existing.title,
    color: existing.color,
    rootNodeId: existing.rootNodeId,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
    roles: [],
    designAssets: [],
  };
  return {
    ...emptyTemplate,
    fileName: existing.title || emptyTemplate.fileName,
    activeFlowProjectId: normalizedProjectId,
    flow: resetProject.flow,
    flowProjects: localProjects.map((project) =>
      project.id === normalizedProjectId ? resetProject : project
    ),
  };
};

export const buildStyloConversationStorageKey = (projectId: string) =>
  `${STYLO_CONVERSATION_STORAGE_PREFIX}:${encodeScopePart(normalizeScopePart(projectId, DEFAULT_STYLO_PROJECT_ID))}`;

export const buildStyloActivityStorageKey = (projectId: string) =>
  `${STYLO_ACTIVITY_STORAGE_PREFIX}:${encodeScopePart(normalizeScopePart(projectId, DEFAULT_STYLO_PROJECT_ID))}`;

export const buildStyloSessionPrefix = (projectId: string) =>
  `stylo:${encodeScopePart(normalizeScopePart(projectId, DEFAULT_STYLO_PROJECT_ID))}:`;

export const buildStyloSessionId = (projectId: string, conversationId: string) =>
  `${buildStyloSessionPrefix(projectId)}${encodeScopePart(normalizeScopePart(conversationId, "default"))}`;

const qualifyStyloAccountScopePart = (
  accountScope: string,
  value: string | undefined,
  fallback: string
) => {
  const normalizedAccountScope = normalizeScopePart(accountScope, "guest");
  const normalizedValue = normalizeScopePart(value, fallback);
  return `${normalizedAccountScope}:${normalizedValue}`;
};

/**
 * Local Agent records are account data. Keep their storage namespace distinct
 * even when two Clerk accounts use the same project id on the same device.
 */
export const buildStyloAccountStorageKeys = (accountScope: string, projectId: string) => {
  const storageProjectScope = qualifyStyloAccountScopePart(
    accountScope,
    projectId,
    DEFAULT_STYLO_PROJECT_ID
  );
  return {
    conversationStorageKey: buildStyloConversationStorageKey(storageProjectScope),
    activityStorageKey: buildStyloActivityStorageKey(storageProjectScope),
  };
};

/**
 * Server sessions remain project-scoped for bridge validation, while the
 * conversation segment carries the account scope used by the local UI.
 */
export const buildStyloAccountSessionId = (
  accountScope: string,
  projectId: string,
  conversationId: string
) =>
  buildStyloSessionId(
    projectId,
    qualifyStyloAccountScopePart(accountScope, conversationId, "default")
  );

export const buildStyloAccountSessionPrefix = (
  accountScope: string,
  projectId: string
) =>
  `${buildStyloSessionPrefix(projectId)}${encodeScopePart(normalizeScopePart(accountScope, "guest"))}%3A`;

export const isStyloAccountSessionInProject = (
  sessionId: string,
  accountScope: string,
  projectId: string
) => sessionId.startsWith(buildStyloAccountSessionPrefix(accountScope, projectId));

export const isStyloSessionInProject = (sessionId: string, projectId: string) =>
  sessionId.startsWith(buildStyloSessionPrefix(projectId));

export const assertStyloProjectScope = (projectId: string, projectData?: Pick<ProjectData, "activeFlowProjectId">) => {
  const normalizedProjectId = normalizeScopePart(projectId, "");
  if (!normalizedProjectId) {
    throw new Error("Stylo 请求缺少 projectId，已拒绝执行以避免跨项目混淆。");
  }
  const activeProjectId = (projectData?.activeFlowProjectId || "").trim();
  if (activeProjectId && activeProjectId !== normalizedProjectId) {
    throw new Error(
      `Stylo 项目作用域不匹配：请求项目 ${normalizedProjectId}，当前快照项目 ${activeProjectId}。`
    );
  }
  return normalizedProjectId;
};
