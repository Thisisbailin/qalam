export const REALTIME_TYPED_MUTATION_CAPABILITY = "typed-mutation.v2";
export const REALTIME_NODE_GEOMETRY_CAPABILITY = "node-geometry.v1";
export const REALTIME_NODE_TEXT_CAPABILITY = "node-text.v1";

export type RealtimeNodeGeometryPatch = {
  nodeId: string;
  position?: { x: number; y: number };
  measured?: { width?: number; height?: number };
};

export type RealtimeNodeGeometryMutation = {
  version: 2;
  kind: "node.geometry";
  projectId: string;
  updatedAt: number;
  patches: RealtimeNodeGeometryPatch[];
};

export type RealtimeNodeTextDerivedField = "atMentions" | "entityBindings";

export type RealtimeNodeTextPatch = {
  nodeId: string;
  field: "text";
  derivedFields?: RealtimeNodeTextDerivedField[];
};

export type RealtimeNodeTextMutation = {
  version: 2;
  kind: "node.text";
  projectId: string;
  updatedAt: number;
  revision: number;
  patches: RealtimeNodeTextPatch[];
};

export type RealtimeMutationEnvelope = RealtimeNodeGeometryMutation | RealtimeNodeTextMutation;

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_PATCHES = 512;
const MAX_ID_LENGTH = 256;
const MAX_COORDINATE = 1_000_000_000;
const MAX_MEASURED_SIZE = 1_000_000;
const MAX_TEXT_PATCHES = 128;
const TEXT_DERIVED_FIELDS = new Set<RealtimeNodeTextDerivedField>(["atMentions", "entityBindings"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) => {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
};

const isId = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= MAX_ID_LENGTH;

const isCoordinate = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;

const isMeasuredSize = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_MEASURED_SIZE;

export const parseRealtimeMutationEnvelope = (
  value: unknown,
  expectedProjectId?: string,
): ValidationResult<RealtimeMutationEnvelope> => {
  if (!isRecord(value)) {
    return { ok: false, error: "Realtime mutation envelope is invalid" };
  }
  if (value.version !== 2 || !isId(value.projectId)) {
    return { ok: false, error: "Realtime mutation type or project scope is invalid" };
  }
  if (expectedProjectId && value.projectId !== expectedProjectId) {
    return { ok: false, error: "Realtime mutation project does not match the room" };
  }
  if (!Number.isSafeInteger(value.updatedAt) || Number(value.updatedAt) < 0) {
    return { ok: false, error: "Realtime mutation timestamp is invalid" };
  }
  if (value.kind === "node.text") {
    if (!hasOnlyKeys(value, ["version", "kind", "projectId", "updatedAt", "revision", "patches"])) {
      return { ok: false, error: "Realtime text mutation envelope is invalid" };
    }
    if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) {
      return { ok: false, error: "Realtime text mutation revision is invalid" };
    }
    if (!Array.isArray(value.patches) || value.patches.length === 0 || value.patches.length > MAX_TEXT_PATCHES) {
      return { ok: false, error: "Realtime text mutation patch count is invalid" };
    }
    const ids = new Set<string>();
    const patches: RealtimeNodeTextPatch[] = [];
    for (const candidate of value.patches) {
      if (!isRecord(candidate) || !hasOnlyKeys(candidate, ["nodeId", "field", "derivedFields"])) {
        return { ok: false, error: "Realtime text patch is invalid" };
      }
      if (!isId(candidate.nodeId) || ids.has(candidate.nodeId) || candidate.field !== "text") {
        return { ok: false, error: "Realtime text patch target is invalid" };
      }
      ids.add(candidate.nodeId);
      let derivedFields: RealtimeNodeTextDerivedField[] | undefined;
      if (candidate.derivedFields !== undefined) {
        if (
          !Array.isArray(candidate.derivedFields)
          || candidate.derivedFields.length === 0
          || candidate.derivedFields.length > TEXT_DERIVED_FIELDS.size
          || new Set(candidate.derivedFields).size !== candidate.derivedFields.length
          || !candidate.derivedFields.every(
            (field): field is RealtimeNodeTextDerivedField =>
              typeof field === "string" && TEXT_DERIVED_FIELDS.has(field as RealtimeNodeTextDerivedField),
          )
        ) return { ok: false, error: "Realtime text patch derived fields are invalid" };
        derivedFields = candidate.derivedFields;
      }
      patches.push({
        nodeId: candidate.nodeId,
        field: "text",
        ...(derivedFields ? { derivedFields } : {}),
      });
    }
    return {
      ok: true,
      value: {
        version: 2,
        kind: "node.text",
        projectId: value.projectId,
        updatedAt: value.updatedAt as number,
        revision: value.revision as number,
        patches,
      },
    };
  }
  if (value.kind !== "node.geometry" || !hasOnlyKeys(value, ["version", "kind", "projectId", "updatedAt", "patches"])) {
    return { ok: false, error: "Realtime mutation type is invalid" };
  }
  if (!Array.isArray(value.patches) || value.patches.length === 0 || value.patches.length > MAX_PATCHES) {
    return { ok: false, error: "Realtime geometry mutation patch count is invalid" };
  }
  const ids = new Set<string>();
  const patches: RealtimeNodeGeometryPatch[] = [];
  for (const candidate of value.patches) {
    if (!isRecord(candidate) || !hasOnlyKeys(candidate, ["nodeId", "position", "measured"])) {
      return { ok: false, error: "Realtime geometry patch is invalid" };
    }
    if (!isId(candidate.nodeId) || ids.has(candidate.nodeId)) {
      return { ok: false, error: "Realtime geometry patch node identity is invalid" };
    }
    ids.add(candidate.nodeId);
    let position: RealtimeNodeGeometryPatch["position"];
    if (candidate.position !== undefined) {
      if (
        !isRecord(candidate.position)
        || !hasOnlyKeys(candidate.position, ["x", "y"])
        || !isCoordinate(candidate.position.x)
        || !isCoordinate(candidate.position.y)
      ) return { ok: false, error: "Realtime geometry patch position is invalid" };
      position = { x: candidate.position.x as number, y: candidate.position.y as number };
    }
    let measured: RealtimeNodeGeometryPatch["measured"];
    if (candidate.measured !== undefined) {
      if (!isRecord(candidate.measured) || !hasOnlyKeys(candidate.measured, ["width", "height"])) {
        return { ok: false, error: "Realtime geometry patch measured size is invalid" };
      }
      if (
        (candidate.measured.width !== undefined && !isMeasuredSize(candidate.measured.width))
        || (candidate.measured.height !== undefined && !isMeasuredSize(candidate.measured.height))
        || (candidate.measured.width === undefined && candidate.measured.height === undefined)
      ) return { ok: false, error: "Realtime geometry patch measured size is invalid" };
      measured = {
        ...(candidate.measured.width !== undefined ? { width: candidate.measured.width as number } : {}),
        ...(candidate.measured.height !== undefined ? { height: candidate.measured.height as number } : {}),
      };
    }
    if (!position && !measured) return { ok: false, error: "Realtime geometry patch is empty" };
    patches.push({ nodeId: candidate.nodeId, ...(position ? { position } : {}), ...(measured ? { measured } : {}) });
  }
  return {
    ok: true,
    value: {
      version: 2,
      kind: "node.geometry",
      projectId: value.projectId,
      updatedAt: value.updatedAt as number,
      patches,
    },
  };
};

const jsonEqual = (left: unknown, right: unknown) => {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
};

const sameRecordExcept = (
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  ignored: ReadonlySet<string>,
) => {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (ignored.has(key)) continue;
    if (!jsonEqual(before[key], after[key])) return false;
  }
  return true;
};

const validateRealtimeNodeTextEffect = (
  beforeValue: Record<string, unknown>,
  afterValue: Record<string, unknown>,
  mutation: RealtimeNodeTextMutation,
): { ok: true } | { ok: false; error: string } => {
  if (!sameRecordExcept(beforeValue, afterValue, new Set(["flowProjects"]))) {
    return { ok: false, error: "Typed text update changed fields outside flowProjects" };
  }
  const beforeProjects = beforeValue.flowProjects;
  const afterProjects = afterValue.flowProjects;
  if (!Array.isArray(beforeProjects) || !Array.isArray(afterProjects) || beforeProjects.length !== afterProjects.length) {
    return { ok: false, error: "Typed text update changed the project collection" };
  }
  const patchById = new Map(mutation.patches.map((patch) => [patch.nodeId, patch]));
  const seenPatchIds = new Set<string>();
  for (let projectIndex = 0; projectIndex < beforeProjects.length; projectIndex += 1) {
    const beforeProject = beforeProjects[projectIndex];
    const afterProject = afterProjects[projectIndex];
    if (!isRecord(beforeProject) || !isRecord(afterProject) || beforeProject.id !== afterProject.id) {
      return { ok: false, error: "Typed text update reordered or replaced a project" };
    }
    if (beforeProject.id !== mutation.projectId) {
      if (!jsonEqual(beforeProject, afterProject)) return { ok: false, error: "Typed text update changed another project" };
      continue;
    }
    if (!sameRecordExcept(beforeProject, afterProject, new Set(["flow", "updatedAt"]))) {
      return { ok: false, error: "Typed text update changed project metadata" };
    }
    if (afterProject.updatedAt !== mutation.updatedAt) {
      return { ok: false, error: "Typed text update timestamp does not match its intent" };
    }
    const beforeFlow = beforeProject.flow;
    const afterFlow = afterProject.flow;
    if (!isRecord(beforeFlow) || !isRecord(afterFlow)) return { ok: false, error: "Typed text update target Flow is missing" };
    if (!sameRecordExcept(beforeFlow, afterFlow, new Set(["flowNodes", "revision"]))) {
      return { ok: false, error: "Typed text update changed non-node Flow state" };
    }
    if (afterFlow.revision !== mutation.revision) {
      return { ok: false, error: "Typed text update revision does not match its intent" };
    }
    const beforeNodes = beforeFlow.flowNodes;
    const afterNodes = afterFlow.flowNodes;
    if (!Array.isArray(beforeNodes) || !Array.isArray(afterNodes) || beforeNodes.length !== afterNodes.length) {
      return { ok: false, error: "Typed text update changed the node collection" };
    }
    for (let nodeIndex = 0; nodeIndex < beforeNodes.length; nodeIndex += 1) {
      const beforeNode = beforeNodes[nodeIndex];
      const afterNode = afterNodes[nodeIndex];
      if (!isRecord(beforeNode) || !isRecord(afterNode) || beforeNode.id !== afterNode.id) {
        return { ok: false, error: "Typed text update reordered or replaced a node" };
      }
      const patch = typeof beforeNode.id === "string" ? patchById.get(beforeNode.id) : undefined;
      if (!patch) {
        if (!jsonEqual(beforeNode, afterNode)) return { ok: false, error: "Typed text update changed an undeclared node" };
        continue;
      }
      seenPatchIds.add(patch.nodeId);
      if (!sameRecordExcept(beforeNode, afterNode, new Set(["data"]))) {
        return { ok: false, error: "Typed text update changed node structure" };
      }
      const beforeData = beforeNode.data;
      const afterData = afterNode.data;
      if (!isRecord(beforeData) || !isRecord(afterData) || typeof afterData.text !== "string") {
        return { ok: false, error: "Typed text update target data is invalid" };
      }
      const allowedFields = new Set<string>([patch.field, ...(patch.derivedFields || [])]);
      if (!sameRecordExcept(beforeData, afterData, allowedFields)) {
        return { ok: false, error: "Typed text update changed undeclared node data" };
      }
    }
  }
  if (seenPatchIds.size !== patchById.size) {
    return { ok: false, error: "Typed text update targets a missing node or project" };
  }
  return { ok: true };
};

/**
 * Proves that a client-authored Yjs update changed exactly the geometry named
 * by its typed envelope. The original update is still persisted so every peer
 * keeps the same CRDT causal history.
 */
export const validateRealtimeMutationEffect = (
  beforeValue: unknown,
  afterValue: unknown,
  mutation: RealtimeMutationEnvelope,
): { ok: true } | { ok: false; error: string } => {
  if (!isRecord(beforeValue) || !isRecord(afterValue)) {
    return { ok: false, error: "Realtime mutation candidate is not a project object" };
  }
  if (mutation.kind === "node.text") {
    return validateRealtimeNodeTextEffect(beforeValue, afterValue, mutation);
  }
  if (!sameRecordExcept(beforeValue, afterValue, new Set(["flowProjects"]))) {
    return { ok: false, error: "Typed geometry update changed fields outside flowProjects" };
  }
  const beforeProjects = beforeValue.flowProjects;
  const afterProjects = afterValue.flowProjects;
  if (!Array.isArray(beforeProjects) || !Array.isArray(afterProjects) || beforeProjects.length !== afterProjects.length) {
    return { ok: false, error: "Typed geometry update changed the project collection" };
  }
  const patchById = new Map(mutation.patches.map((patch) => [patch.nodeId, patch]));
  const seenPatchIds = new Set<string>();
  for (let projectIndex = 0; projectIndex < beforeProjects.length; projectIndex += 1) {
    const beforeProject = beforeProjects[projectIndex];
    const afterProject = afterProjects[projectIndex];
    if (!isRecord(beforeProject) || !isRecord(afterProject) || beforeProject.id !== afterProject.id) {
      return { ok: false, error: "Typed geometry update reordered or replaced a project" };
    }
    if (beforeProject.id !== mutation.projectId) {
      if (!jsonEqual(beforeProject, afterProject)) {
        return { ok: false, error: "Typed geometry update changed another project" };
      }
      continue;
    }
    if (!sameRecordExcept(beforeProject, afterProject, new Set(["flow", "updatedAt"]))) {
      return { ok: false, error: "Typed geometry update changed project metadata" };
    }
    if (afterProject.updatedAt !== mutation.updatedAt) {
      return { ok: false, error: "Typed geometry update timestamp does not match its intent" };
    }
    const beforeFlow = beforeProject.flow;
    const afterFlow = afterProject.flow;
    if (!isRecord(beforeFlow) || !isRecord(afterFlow)) {
      return { ok: false, error: "Typed geometry update target Flow is missing" };
    }
    if (!sameRecordExcept(beforeFlow, afterFlow, new Set(["flowNodes"]))) {
      return { ok: false, error: "Typed geometry update changed non-node Flow state" };
    }
    const beforeNodes = beforeFlow.flowNodes;
    const afterNodes = afterFlow.flowNodes;
    if (!Array.isArray(beforeNodes) || !Array.isArray(afterNodes) || beforeNodes.length !== afterNodes.length) {
      return { ok: false, error: "Typed geometry update changed the node collection" };
    }
    for (let nodeIndex = 0; nodeIndex < beforeNodes.length; nodeIndex += 1) {
      const beforeNode = beforeNodes[nodeIndex];
      const afterNode = afterNodes[nodeIndex];
      if (!isRecord(beforeNode) || !isRecord(afterNode) || beforeNode.id !== afterNode.id) {
        return { ok: false, error: "Typed geometry update reordered or replaced a node" };
      }
      const patch = typeof beforeNode.id === "string" ? patchById.get(beforeNode.id) : undefined;
      if (!patch) {
        if (!jsonEqual(beforeNode, afterNode)) return { ok: false, error: "Typed geometry update changed an undeclared node" };
        continue;
      }
      seenPatchIds.add(patch.nodeId);
      if (!sameRecordExcept(beforeNode, afterNode, new Set(["position", "measured"]))) {
        return { ok: false, error: "Typed geometry update changed node content" };
      }
      if (patch.position ? !jsonEqual(afterNode.position, patch.position) : !jsonEqual(beforeNode.position, afterNode.position)) {
        return { ok: false, error: "Typed geometry update position does not match its intent" };
      }
      if (patch.measured ? !jsonEqual(afterNode.measured, patch.measured) : !jsonEqual(beforeNode.measured, afterNode.measured)) {
        return { ok: false, error: "Typed geometry update measured size does not match its intent" };
      }
    }
  }
  if (seenPatchIds.size !== patchById.size) {
    return { ok: false, error: "Typed geometry update targets a missing node or project" };
  }
  return { ok: true };
};

export const mergeRealtimeMutations = (
  left: RealtimeMutationEnvelope | null,
  right: RealtimeMutationEnvelope | null,
): RealtimeMutationEnvelope | null => {
  if (!left || !right || left.kind !== right.kind) return null;
  if (left.projectId !== right.projectId) return null;
  if (left.kind === "node.text" && right.kind === "node.text") {
    const patches = new Map(left.patches.map((patch) => [patch.nodeId, patch]));
    for (const patch of right.patches) {
      const previous = patches.get(patch.nodeId);
      const derivedFields = Array.from(new Set([
        ...(previous?.derivedFields || []),
        ...(patch.derivedFields || []),
      ]));
      patches.set(patch.nodeId, {
        nodeId: patch.nodeId,
        field: "text",
        ...(derivedFields.length ? { derivedFields } : {}),
      });
    }
    if (patches.size > MAX_TEXT_PATCHES) return null;
    return {
      version: 2,
      kind: "node.text",
      projectId: left.projectId,
      updatedAt: right.updatedAt,
      revision: right.revision,
      patches: Array.from(patches.values()),
    };
  }
  if (left.kind === "node.geometry" && right.kind === "node.geometry") {
    const patches = new Map(left.patches.map((patch) => [patch.nodeId, patch]));
    for (const patch of right.patches) {
      const previous = patches.get(patch.nodeId);
      patches.set(patch.nodeId, {
        nodeId: patch.nodeId,
        ...(previous?.position ? { position: previous.position } : {}),
        ...(previous?.measured ? { measured: previous.measured } : {}),
        ...(patch.position ? { position: patch.position } : {}),
        ...(patch.measured ? { measured: patch.measured } : {}),
      });
    }
    if (patches.size > MAX_PATCHES) return null;
    return {
      version: 2,
      kind: "node.geometry",
      projectId: left.projectId,
      updatedAt: right.updatedAt,
      patches: Array.from(patches.values()),
    };
  }
  return null;
};
