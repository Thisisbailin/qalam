export type RealtimeProjectValidationResult =
  | { ok: true }
  | { ok: false; error: string };

const MAX_FLOW_PROJECTS = 24;
const MAX_FLOW_NODES = 2_000;
const MAX_FLOW_LINKS = 5_000;
const MAX_GRAPH_LINKS = 5_000;
const MAX_GLOBAL_ASSETS = 5_000;
const MAX_COLLECTION_ITEMS = 10_000;
const MAX_OBJECT_FIELDS = 1_000;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_VALUES = 250_000;
const MAX_STRING_LENGTH = 10_000_000;
const MAX_ID_LENGTH = 512;
const MAX_COORDINATE = 1_000_000_000;
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const fail = (error: string): RealtimeProjectValidationResult => ({ ok: false, error });

const isBoundedId = (value: unknown, max = MAX_ID_LENGTH): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;

const isFiniteCoordinate = (value: unknown) =>
  typeof value === "number"
  && Number.isFinite(value)
  && Math.abs(value) <= MAX_COORDINATE;

const validateJsonEnvelope = (root: unknown): RealtimeProjectValidationResult => {
  const stack: Array<{ value: unknown; path: string; depth: number }> = [
    { value: root, path: "projectData", depth: 0 },
  ];
  let visited = 0;
  while (stack.length) {
    const { value, path, depth } = stack.pop()!;
    visited += 1;
    if (visited > MAX_JSON_VALUES) return fail("projectData is too structurally complex");
    if (depth > MAX_JSON_DEPTH) return fail(`${path} exceeds the maximum nesting depth`);
    if (value === null || typeof value === "boolean") continue;
    if (typeof value === "string") {
      if (value.length > MAX_STRING_LENGTH) return fail(`${path} contains an oversized string`);
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return fail(`${path} contains a non-finite number`);
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_COLLECTION_ITEMS) return fail(`${path} contains too many items`);
      value.forEach((entry, index) => stack.push({
        value: entry,
        path: `${path}[${index}]`,
        depth: depth + 1,
      }));
      continue;
    }
    if (!isRecord(value)) return fail(`${path} contains a non-JSON value`);
    const entries = Object.entries(value);
    if (entries.length > MAX_OBJECT_FIELDS) return fail(`${path} contains too many fields`);
    for (const [key, entry] of entries) {
      if (UNSAFE_KEYS.has(key)) return fail(`${path} contains an unsafe field name`);
      stack.push({ value: entry, path: `${path}.${key}`, depth: depth + 1 });
    }
  }
  return { ok: true };
};

const validateFlow = (value: unknown, path: string): RealtimeProjectValidationResult => {
  if (value === undefined || value === null) return { ok: true };
  if (!isRecord(value)) return fail(`${path} must be an object`);
  if (
    value.revision !== undefined
    && (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0)
  ) return fail(`${path}.revision must be a non-negative safe integer`);

  const nodes = value.flowNodes === undefined ? [] : value.flowNodes;
  if (!Array.isArray(nodes) || nodes.length > MAX_FLOW_NODES) {
    return fail(`${path}.flowNodes exceeds the supported node limit`);
  }
  const nodeIds = new Set<string>();
  const parentByNode = new Map<string, string>();
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const nodePath = `${path}.flowNodes[${index}]`;
    if (!isRecord(node) || !isBoundedId(node.id, 256)) return fail(`${nodePath}.id is invalid`);
    if (nodeIds.has(node.id)) return fail(`${path}.flowNodes contains duplicate id ${node.id}`);
    nodeIds.add(node.id);
    if (!isBoundedId(node.type, 128)) return fail(`${nodePath}.type is invalid`);
    if (
      !isRecord(node.position)
      || !isFiniteCoordinate(node.position.x)
      || !isFiniteCoordinate(node.position.y)
    ) return fail(`${nodePath}.position is invalid`);
    if (!isRecord(node.data)) return fail(`${nodePath}.data must be an object`);
    if (node.parentId !== undefined) {
      if (!isBoundedId(node.parentId, 256)) return fail(`${nodePath}.parentId is invalid`);
      parentByNode.set(node.id, node.parentId);
    }
  }
  for (const [nodeId, parentId] of parentByNode) {
    if (nodeId === parentId || !nodeIds.has(parentId)) return fail(`${path} contains an invalid parent reference`);
    const visited = new Set([nodeId]);
    let current: string | undefined = parentId;
    while (current) {
      if (visited.has(current)) return fail(`${path} contains a parent cycle`);
      visited.add(current);
      current = parentByNode.get(current);
    }
  }

  const links = value.links === undefined ? [] : value.links;
  if (!Array.isArray(links) || links.length > MAX_FLOW_LINKS) {
    return fail(`${path}.links exceeds the supported link limit`);
  }
  const linkIds = new Set<string>();
  for (let index = 0; index < links.length; index += 1) {
    const link = links[index];
    const linkPath = `${path}.links[${index}]`;
    if (!isRecord(link)) return fail(`${linkPath} must be an object`);
    if (!isBoundedId(link.source, 256) || !isBoundedId(link.target, 256)) {
      return fail(`${linkPath} has an invalid endpoint`);
    }
    if (!nodeIds.has(link.source) || !nodeIds.has(link.target)) {
      return fail(`${linkPath} points to a missing node`);
    }
    if (link.id !== undefined) {
      if (!isBoundedId(link.id)) return fail(`${linkPath}.id is invalid`);
      if (linkIds.has(link.id)) return fail(`${path}.links contains duplicate id ${link.id}`);
      linkIds.add(link.id);
    }
    for (const key of ["sourceHandle", "targetHandle"] as const) {
      const handle = link[key];
      if (handle !== undefined && handle !== null && (typeof handle !== "string" || handle.length > 128)) {
        return fail(`${linkPath}.${key} is invalid`);
      }
    }
  }

  if (
    value.graphLinks !== undefined
    && (!Array.isArray(value.graphLinks) || value.graphLinks.length > MAX_GRAPH_LINKS)
  ) return fail(`${path}.graphLinks exceeds the supported limit`);
  if (
    value.globalAssetHistory !== undefined
    && (!Array.isArray(value.globalAssetHistory) || value.globalAssetHistory.length > MAX_GLOBAL_ASSETS)
  ) return fail(`${path}.globalAssetHistory exceeds the supported limit`);
  return { ok: true };
};

/**
 * Validates the materialized state that would become the cloud authority.
 * Empty rooms are valid; a non-empty room must remain scoped to its Durable
 * Object project and preserve graph referential integrity.
 */
export const validateRealtimeProjectSnapshot = (
  value: unknown,
  projectId: string,
): RealtimeProjectValidationResult => {
  if (!isRecord(value)) return fail("projectData must be an object");
  const envelope = validateJsonEnvelope(value);
  if (!envelope.ok) return envelope;
  if (Object.keys(value).length === 0) return { ok: true };

  if (value.activeFlowProjectId !== undefined && value.activeFlowProjectId !== projectId) {
    return fail("activeFlowProjectId does not match the realtime room");
  }
  if (value.episodes !== undefined && !Array.isArray(value.episodes)) {
    return fail("episodes must be an array");
  }
  if (value.roles !== undefined && !Array.isArray(value.roles)) return fail("roles must be an array");
  if (value.designAssets !== undefined && !Array.isArray(value.designAssets)) {
    return fail("designAssets must be an array");
  }

  const topFlow = validateFlow(value.flow, "flow");
  if (!topFlow.ok) return topFlow;
  if (value.flowProjects !== undefined) {
    if (!Array.isArray(value.flowProjects) || value.flowProjects.length > MAX_FLOW_PROJECTS) {
      return fail("flowProjects exceeds the supported project limit");
    }
    const projectIds = new Set<string>();
    for (let index = 0; index < value.flowProjects.length; index += 1) {
      const project = value.flowProjects[index];
      const path = `flowProjects[${index}]`;
      if (!isRecord(project) || !isBoundedId(project.id, 256)) return fail(`${path}.id is invalid`);
      if (projectIds.has(project.id)) return fail(`flowProjects contains duplicate id ${project.id}`);
      projectIds.add(project.id);
      const flow = validateFlow(project.flow, `${path}.flow`);
      if (!flow.ok) return flow;
      if (project.roles !== undefined && !Array.isArray(project.roles)) return fail(`${path}.roles must be an array`);
      if (project.designAssets !== undefined && !Array.isArray(project.designAssets)) {
        return fail(`${path}.designAssets must be an array`);
      }
    }
    if (value.flowProjects.length > 0 && !projectIds.has(projectId)) {
      return fail("flowProjects does not contain the realtime room project");
    }
  }
  return { ok: true };
};
