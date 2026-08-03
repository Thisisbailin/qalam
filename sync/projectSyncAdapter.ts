import type { ProjectData } from "../types";
import { dropFileReplacer, isProjectEmpty } from "../utils/persistence";
import { normalizeProjectData } from "../utils/projectData";
import { toCloudProjectData } from "../utils/cloudProjectData";
import { buildStyloScopedProjectData } from "../agents/runtime/projectScope";
import { validateProjectData } from "../utils/validation";
import type { SyncCodec } from "./realtimeSyncTypes";
import type { ProjectNodeGeometryPatch } from "./projectMutationBus";

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

const sameShallowValuesExcept = (
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  ignored: Set<string>,
) => {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (ignored.has(key) || Object.is(left[key], right[key])) continue;
    const leftValue = left[key];
    const rightValue = right[key];
    // React Flow commonly returns a fresh array container whose members are
    // unchanged (for example links.filter(...) during a node drag). Treating
    // that as authored project content forced geometry-only gestures back
    // through whole-project snapshot serialization.
    if (
      Array.isArray(leftValue)
      && Array.isArray(rightValue)
      && leftValue.length === rightValue.length
      && leftValue.every((entry, index) => Object.is(entry, rightValue[index]))
    ) continue;
    return false;
  }
  return true;
};

export const isNodeGeometryOnlyProjectChange = (
  previous: ProjectData,
  next: ProjectData,
  projectId: string,
  patches: ProjectNodeGeometryPatch[],
) => {
  const patchIds = new Set(patches.map((patch) => patch.nodeId));
  if (!patchIds.size) return false;
  if (!sameShallowValuesExcept(
    previous as unknown as Record<string, unknown>,
    next as unknown as Record<string, unknown>,
    new Set(["flow", "flowProjects"]),
  )) return false;
  const previousProjects = previous.flowProjects || [];
  const nextProjects = next.flowProjects || [];
  if (previousProjects.length !== nextProjects.length) return false;
  for (let index = 0; index < previousProjects.length; index += 1) {
    const before = previousProjects[index];
    const after = nextProjects[index];
    if (before.id !== after.id) return false;
    if (before.id !== projectId) {
      if (!sameShallowValuesExcept(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>,
        new Set(),
      )) return false;
      continue;
    }
    if (!sameShallowValuesExcept(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
      new Set(["flow", "updatedAt"]),
    )) return false;
    if (!sameShallowValuesExcept(
      before.flow as unknown as Record<string, unknown>,
      after.flow as unknown as Record<string, unknown>,
      new Set(["flowNodes"]),
    )) return false;
    const beforeNodes = before.flow.flowNodes || [];
    const afterNodes = after.flow.flowNodes || [];
    if (beforeNodes.length !== afterNodes.length) return false;
    for (let nodeIndex = 0; nodeIndex < beforeNodes.length; nodeIndex += 1) {
      const beforeNode = beforeNodes[nodeIndex];
      const afterNode = afterNodes[nodeIndex];
      if (beforeNode.id !== afterNode.id) return false;
      if (patchIds.has(beforeNode.id)) {
        if (!sameShallowValuesExcept(
          beforeNode as unknown as Record<string, unknown>,
          afterNode as unknown as Record<string, unknown>,
          new Set(["position", "measured"]),
        )) return false;
      } else if (beforeNode !== afterNode) {
        return false;
      }
    }
  }
  return true;
};

export const patchProjectSyncSnapshotGeometry = (
  snapshot: ProjectData,
  nextInput: ProjectData,
  projectId: string,
  patches: ProjectNodeGeometryPatch[],
) => {
  const patchIds = new Set(patches.map((patch) => patch.nodeId));
  const nextProject = nextInput.flowProjects?.find((project) => project.id === projectId);
  if (!nextProject) return snapshot;
  const patchFlow = (flow: ProjectData["flow"]) => flow
    ? {
        ...flow,
        flowNodes: (flow.flowNodes || []).map((node) => {
          if (!patchIds.has(node.id)) return node;
          const source = nextProject.flow.flowNodes?.find((candidate) => candidate.id === node.id);
          return source
            ? { ...node, position: source.position, measured: source.measured }
            : node;
        }),
      }
    : flow;
  return {
    ...snapshot,
    flow: patchFlow(snapshot.flow),
    flowProjects: snapshot.flowProjects?.map((project) => project.id === projectId
      ? { ...project, updatedAt: nextProject.updatedAt, flow: patchFlow(project.flow)! }
      : project),
  };
};
