import type { ProjectData } from "../types";
import { dropFileReplacer, isProjectEmpty } from "../utils/persistence";
import { normalizeProjectData } from "../utils/projectData";
import { toCloudProjectData } from "../utils/cloudProjectData";
import { buildStyloScopedProjectData } from "../agents/runtime/projectScope";
import { validateProjectData } from "../utils/validation";
import type { SyncCodec } from "./realtimeSyncTypes";

const hashString = (value: string) => {
  let left = 2166136261;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 16777619);
    right = Math.imul(right ^ code, 2246822519);
  }
  return `${(left >>> 0).toString(36)}:${(right >>> 0).toString(36)}:${value.length}`;
};

const serializedSnapshotCache = new WeakMap<ProjectData, string>();

const serializeCloudProject = (value: ProjectData) => {
  const cached = serializedSnapshotCache.get(value);
  if (cached !== undefined) return cached;
  const serialized = JSON.stringify(toCloudProjectData(value), dropFileReplacer) || "{}";
  // Sync snapshots are immutable values owned by the engine. Caching here lets
  // fingerprinting and byte-limit enforcement share one serialization pass.
  serializedSnapshotCache.set(value, serialized);
  return serialized;
};

export const readActiveFlowRevision = (data: ProjectData | null | undefined) => {
  if (!data) return null;
  const activeProject = Array.isArray(data.flowProjects)
    ? data.flowProjects.find((project) => project.id === data.activeFlowProjectId) || data.flowProjects[0]
    : undefined;
  const revision = activeProject?.flow?.revision ?? data.flow?.revision;
  return typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0
    ? revision
    : null;
};

export const projectSyncCodec: SyncCodec<ProjectData> = {
  snapshot(value) {
    return normalizeProjectData(JSON.parse(serializeCloudProject(value)) as ProjectData);
  },
  fingerprint(value) {
    return hashString(serializeCloudProject(value));
  },
  byteLength(value) {
    return new TextEncoder().encode(serializeCloudProject(value)).byteLength;
  },
  validate(value) {
    const validation = validateProjectData(value);
    return validation.ok ? null : `项目数据未通过同步校验：${validation.error}`;
  },
  isEmpty: isProjectEmpty,
  revision: readActiveFlowRevision,
};

export const createProjectSyncCodec = (projectId: string): SyncCodec<ProjectData> => ({
  ...projectSyncCodec,
  snapshot(value) {
    return projectSyncCodec.snapshot(buildStyloScopedProjectData(value, projectId));
  },
});
