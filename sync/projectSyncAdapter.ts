import type { ProjectData } from "../types";
import { dropFileReplacer, isProjectEmpty } from "../utils/persistence";
import { normalizeProjectData } from "../utils/projectData";
import { toCloudProjectData } from "../utils/cloudProjectData";
import { buildStyloScopedProjectData } from "../agents/runtime/projectScope";
import { validateProjectData } from "../utils/validation";
import type { SyncCodec } from "./realtimeSyncTypes";
import type { ProjectNodeGeometryPatch } from "./projectMutationBus";
import type {
  ProjectNodeTextDerivedField,
  ProjectNodeTextMutation,
} from "./projectMutationBus";

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
    // Snapshot normalization and the active-project mirror may clone an
    // otherwise unchanged position/data container. Semantic equality is safe
    // here because this function only classifies a narrow typed fast path; any
    // real value difference still forces the generic CRDT delta path.
    if (
      leftValue
      && rightValue
      && typeof leftValue === "object"
      && typeof rightValue === "object"
    ) {
      try {
        if (JSON.stringify(leftValue) === JSON.stringify(rightValue)) continue;
      } catch {
        // Non-serializable values are never eligible for a typed mutation.
      }
    }
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

const isFlowNodeTextOnlyChange = (
  previous: NonNullable<ProjectData["flow"]>,
  next: NonNullable<ProjectData["flow"]>,
  intents: ProjectNodeTextMutation[],
) => {
  if (!sameShallowValuesExcept(
    previous as unknown as Record<string, unknown>,
    next as unknown as Record<string, unknown>,
    new Set(["flowNodes", "revision"]),
  )) return false;
  const beforeNodes = previous.flowNodes || [];
  const afterNodes = next.flowNodes || [];
  if (beforeNodes.length !== afterNodes.length) return false;
  const intentsById = new Map(intents.map((intent) => [intent.nodeId, intent]));
  const seen = new Set<string>();
  for (let index = 0; index < beforeNodes.length; index += 1) {
    const beforeNode = beforeNodes[index];
    const afterNode = afterNodes[index];
    if (beforeNode.id !== afterNode.id) return false;
    const intent = intentsById.get(beforeNode.id);
    if (!intent) {
      if (!sameShallowValuesExcept(
        beforeNode as unknown as Record<string, unknown>,
        afterNode as unknown as Record<string, unknown>,
        new Set(),
      )) return false;
      continue;
    }
    seen.add(intent.nodeId);
    if (!sameShallowValuesExcept(
      beforeNode as unknown as Record<string, unknown>,
      afterNode as unknown as Record<string, unknown>,
      new Set(["data"]),
    )) return false;
    const ignoredDataFields = new Set<string>(["text", ...intent.derivedFields]);
    if (!sameShallowValuesExcept(
      (beforeNode.data || {}) as unknown as Record<string, unknown>,
      (afterNode.data || {}) as unknown as Record<string, unknown>,
      ignoredDataFields,
    )) return false;
    if (beforeNode.data?.text !== intent.previousText || afterNode.data?.text !== intent.nextText) return false;
  }
  return seen.size === intentsById.size;
};

export const isNodeTextOnlyProjectChange = (
  previous: ProjectData,
  next: ProjectData,
  projectId: string,
  intents: ProjectNodeTextMutation[],
) => {
  if (!intents.length || intents.some((intent) => intent.projectId !== projectId)) return false;
  if (!sameShallowValuesExcept(
    previous as unknown as Record<string, unknown>,
    next as unknown as Record<string, unknown>,
    new Set(["flow", "flowProjects"]),
  )) return false;
  if (!previous.flow || !next.flow || !isFlowNodeTextOnlyChange(previous.flow, next.flow, intents)) return false;
  const previousProjects = previous.flowProjects || [];
  const nextProjects = next.flowProjects || [];
  if (previousProjects.length !== nextProjects.length) return false;
  let foundProject = false;
  for (let index = 0; index < previousProjects.length; index += 1) {
    const before = previousProjects[index];
    const after = nextProjects[index];
    if (before.id !== after.id) return false;
    if (before.id !== projectId) {
      if (before !== after) return false;
      continue;
    }
    foundProject = true;
    if (!sameShallowValuesExcept(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
      new Set(["flow", "updatedAt"]),
    )) return false;
    if (!isFlowNodeTextOnlyChange(before.flow, after.flow, intents)) return false;
  }
  return foundProject;
};

export const patchProjectSyncSnapshotText = (
  snapshot: ProjectData,
  nextInput: ProjectData,
  projectId: string,
  intents: ProjectNodeTextMutation[],
) => {
  const intentsById = new Map(intents.map((intent) => [intent.nodeId, intent]));
  const nextProject = nextInput.flowProjects?.find((project) => project.id === projectId);
  if (!nextProject) return snapshot;
  const patchFlow = (
    flow: ProjectData["flow"],
    source: ProjectData["flow"],
  ) => flow && source
    ? {
        ...flow,
        revision: source.revision,
        flowNodes: (flow.flowNodes || []).map((node) => {
          const intent = intentsById.get(node.id);
          if (!intent) return node;
          const sourceNode = source.flowNodes?.find((candidate) => candidate.id === node.id);
          if (!sourceNode) return node;
          const data = { ...(node.data || {}), text: sourceNode.data?.text } as Record<string, unknown>;
          intent.derivedFields.forEach((field: ProjectNodeTextDerivedField) => {
            if (Object.hasOwn(sourceNode.data || {}, field)) data[field] = sourceNode.data?.[field];
            else delete data[field];
          });
          return { ...node, data: data as typeof node.data };
        }),
      }
    : flow;
  return {
    ...snapshot,
    flow: patchFlow(snapshot.flow, nextInput.flow),
    flowProjects: snapshot.flowProjects?.map((project) => project.id === projectId
      ? {
          ...project,
          updatedAt: nextProject.updatedAt,
          flow: patchFlow(project.flow, nextProject.flow)!,
        }
      : project),
  };
};
