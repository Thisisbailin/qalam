import * as Y from "yjs";

const KIND_KEY = "__stylo_kind";
const ID_ARRAY_KIND = "id-array";
const ITEMS_KEY = "items";
const ORDER_KEY = "order";
const ID_ARRAY_KEYS = new Set([
  "designAssets",
  "episodes",
  "flowNodes",
  "flowProjects",
  "graphLinks",
  "links",
  "roles",
  "scenes",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stableJson = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
};

const isIdArray = (value: unknown[]): value is Array<Record<string, unknown> & { id: string }> =>
  value.length > 0 && value.every((item) => isRecord(item) && typeof item.id === "string" && item.id.length > 0);

const isIdArrayValue = (
  key: string | undefined,
  value: unknown[],
): value is Array<Record<string, unknown> & { id: string }> =>
  isIdArray(value) || (value.length === 0 && Boolean(key && ID_ARRAY_KEYS.has(key)));

const readSharedValue = (value: unknown): unknown => {
  if (value instanceof Y.Text) return value.toString();
  if (value instanceof Y.Array) return value.toArray().map(readSharedValue);
  if (value instanceof Y.Map) {
    if (value.get(KIND_KEY) === ID_ARRAY_KIND) {
      const items = value.get(ITEMS_KEY);
      const order = value.get(ORDER_KEY);
      if (!(items instanceof Y.Map) || !(order instanceof Y.Array)) return [];
      const emitted = new Set<string>();
      const result: unknown[] = [];
      const append = (id: string) => {
        if (emitted.has(id)) return;
        const item = items.get(id);
        if (item === undefined) return;
        emitted.add(id);
        result.push(readSharedValue(item));
      };
      order.toArray().forEach((id) => {
        if (typeof id === "string") append(id);
      });
      Array.from(items.keys()).sort().forEach(append);
      return result;
    }
    const object: Record<string, unknown> = {};
    value.forEach((entry, key) => {
      if (key === KIND_KEY || key === ITEMS_KEY || key === ORDER_KEY) return;
      object[key] = readSharedValue(entry);
    });
    return object;
  }
  return value;
};

const syncText = (text: Y.Text, next: string) => {
  const previous = text.toString();
  if (previous === next) return;
  let prefix = 0;
  const maxPrefix = Math.min(previous.length, next.length);
  while (prefix < maxPrefix && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  const maxSuffix = Math.min(previous.length - prefix, next.length - prefix);
  while (
    suffix < maxSuffix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) suffix += 1;
  const deleteLength = previous.length - prefix - suffix;
  if (deleteLength > 0) text.delete(prefix, deleteLength);
  const inserted = next.slice(prefix, next.length - suffix);
  if (inserted) text.insert(prefix, inserted);
};

const createSharedObject = (value: Record<string, unknown>) => {
  const map = new Y.Map<unknown>();
  // Match JSON object semantics: undefined means that the property is absent.
  // Explicit null remains a stored value, and undefined array slots still
  // become null through createSharedValue just like JSON.stringify.
  Object.entries(value).forEach(([key, entry]) => {
    if (entry === undefined) return;
    map.set(key, createSharedValue(entry, key));
  });
  return map;
};

const createIdArray = (value: Array<Record<string, unknown> & { id: string }>) => {
  const wrapper = new Y.Map<unknown>();
  const items = new Y.Map<unknown>();
  const order = new Y.Array<string>();
  wrapper.set(KIND_KEY, ID_ARRAY_KIND);
  wrapper.set(ITEMS_KEY, items);
  wrapper.set(ORDER_KEY, order);
  value.forEach((item) => items.set(item.id, createSharedObject(item)));
  order.insert(0, value.map((item) => item.id));
  return wrapper;
};

const createSharedArray = (value: unknown[], key?: string) => {
  if (isIdArrayValue(key, value)) return createIdArray(value);
  const array = new Y.Array<unknown>();
  if (value.length) array.insert(0, value.map((entry) => createSharedValue(entry)));
  return array;
};

const createSharedValue = (value: unknown, key?: string): unknown => {
  if (typeof value === "string") {
    const text = new Y.Text();
    if (value) text.insert(0, value);
    return text;
  }
  if (Array.isArray(value)) return createSharedArray(value, key);
  if (isRecord(value)) return createSharedObject(value);
  return value ?? null;
};

const syncIdArray = (
  wrapper: Y.Map<unknown>,
  value: Array<Record<string, unknown> & { id: string }>,
) => {
  let items = wrapper.get(ITEMS_KEY);
  let order = wrapper.get(ORDER_KEY);
  if (!(items instanceof Y.Map)) {
    items = new Y.Map<unknown>();
    wrapper.set(ITEMS_KEY, items);
  }
  if (!(order instanceof Y.Array)) {
    order = new Y.Array<string>();
    wrapper.set(ORDER_KEY, order);
  }
  const itemMap = items as Y.Map<unknown>;
  const orderArray = order as Y.Array<string>;
  if (wrapper.get(KIND_KEY) !== ID_ARRAY_KIND) wrapper.set(KIND_KEY, ID_ARRAY_KIND);
  const nextIds = new Set(value.map((item) => item.id));
  Array.from(itemMap.keys()).forEach((id) => {
    if (!nextIds.has(id)) itemMap.delete(id);
  });
  value.forEach((item) => {
    const existing = itemMap.get(item.id);
    if (existing instanceof Y.Map && existing.get(KIND_KEY) !== ID_ARRAY_KIND) {
      syncMap(existing, item);
    } else {
      itemMap.set(item.id, createSharedObject(item));
    }
  });
  const nextOrder = value.map((item) => item.id);
  const currentOrder = orderArray.toArray().filter((id): id is string => typeof id === "string");
  if (stableJson(currentOrder) !== stableJson(nextOrder)) {
    if (orderArray.length) orderArray.delete(0, orderArray.length);
    if (nextOrder.length) orderArray.insert(0, nextOrder);
  }
};

const syncArray = (array: Y.Array<unknown>, value: unknown[]) => {
  const current = readSharedValue(array);
  if (stableJson(current) === stableJson(value)) return;
  if (array.length) array.delete(0, array.length);
  if (value.length) array.insert(0, value.map((entry) => createSharedValue(entry)));
};

const syncMapValue = (map: Y.Map<unknown>, key: string, value: unknown) => {
  if (value === undefined) {
    map.delete(key);
    return;
  }
  const existing = map.get(key);
  if (typeof value === "string") {
    if (existing instanceof Y.Text) syncText(existing, value);
    else map.set(key, createSharedValue(value));
    return;
  }
  if (Array.isArray(value)) {
    if (isIdArrayValue(key, value)) {
      if (existing instanceof Y.Map && existing.get(KIND_KEY) === ID_ARRAY_KIND) {
        syncIdArray(existing, value);
      } else {
        map.set(key, createIdArray(value));
      }
      return;
    }
    if (existing instanceof Y.Array) syncArray(existing, value);
    else map.set(key, createSharedArray(value, key));
    return;
  }
  if (isRecord(value)) {
    if (existing instanceof Y.Map && existing.get(KIND_KEY) !== ID_ARRAY_KIND) syncMap(existing, value);
    else map.set(key, createSharedObject(value));
    return;
  }
  if (!Object.is(existing, value ?? null)) map.set(key, value ?? null);
};

const syncMap = (map: Y.Map<unknown>, value: Record<string, unknown>) => {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  const nextKeys = new Set(entries.map(([key]) => key));
  Array.from(map.keys()).forEach((key) => {
    if (!nextKeys.has(key)) map.delete(key);
  });
  entries.forEach(([key, entry]) => syncMapValue(map, key, entry));
};

const valuesEqual = (left: unknown, right: unknown) =>
  Object.is(left, right) || stableJson(left) === stableJson(right);

const syncIdArrayDelta = (
  wrapper: Y.Map<unknown>,
  previous: Array<Record<string, unknown> & { id: string }>,
  next: Array<Record<string, unknown> & { id: string }>,
) => {
  let items = wrapper.get(ITEMS_KEY);
  let order = wrapper.get(ORDER_KEY);
  if (!(items instanceof Y.Map)) {
    items = new Y.Map<unknown>();
    wrapper.set(ITEMS_KEY, items);
  }
  if (!(order instanceof Y.Array)) {
    order = new Y.Array<string>();
    wrapper.set(ORDER_KEY, order);
  }
  const itemMap = items as Y.Map<unknown>;
  const orderArray = order as Y.Array<string>;
  if (wrapper.get(KIND_KEY) !== ID_ARRAY_KIND) wrapper.set(KIND_KEY, ID_ARRAY_KIND);

  const previousById = new Map(previous.map((item) => [item.id, item]));
  const nextById = new Map(next.map((item) => [item.id, item]));
  previousById.forEach((_item, id) => {
    if (!nextById.has(id)) itemMap.delete(id);
  });
  nextById.forEach((item, id) => {
    const previousItem = previousById.get(id);
    if (previousItem && valuesEqual(previousItem, item)) return;
    const existing = itemMap.get(id);
    if (previousItem && existing instanceof Y.Map && existing.get(KIND_KEY) !== ID_ARRAY_KIND) {
      syncMapDelta(existing, previousItem, item);
    } else {
      itemMap.set(id, createSharedObject(item));
    }
  });

  const previousOrder = previous.map((item) => item.id);
  const nextOrder = next.map((item) => item.id);
  if (!valuesEqual(previousOrder, nextOrder)) {
    const nextIds = new Set(nextOrder);
    const previousIds = new Set(previousOrder);
    const remoteOnly = orderArray.toArray().filter(
      (id): id is string => typeof id === "string" && !previousIds.has(id) && !nextIds.has(id) && itemMap.has(id),
    );
    const mergedOrder = [...nextOrder, ...remoteOnly];
    if (orderArray.length) orderArray.delete(0, orderArray.length);
    if (mergedOrder.length) orderArray.insert(0, mergedOrder);
  }
};

const syncMapDelta = (
  map: Y.Map<unknown>,
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
) => {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  keys.forEach((key) => {
    const previousHasKey = Object.hasOwn(previous, key) && previous[key] !== undefined;
    const nextHasKey = Object.hasOwn(next, key) && next[key] !== undefined;
    if (!nextHasKey) {
      if (previousHasKey) map.delete(key);
      return;
    }
    const previousValue = previous[key];
    const nextValue = next[key];
    if (previousHasKey && valuesEqual(previousValue, nextValue)) return;

    const existing = map.get(key);
    if (
      previousHasKey &&
      isRecord(previousValue) &&
      isRecord(nextValue) &&
      existing instanceof Y.Map &&
      existing.get(KIND_KEY) !== ID_ARRAY_KIND
    ) {
      syncMapDelta(existing, previousValue, nextValue);
      return;
    }
    if (
      previousHasKey &&
      Array.isArray(previousValue) &&
      Array.isArray(nextValue) &&
      isIdArrayValue(key, previousValue) &&
      isIdArrayValue(key, nextValue) &&
      existing instanceof Y.Map &&
      existing.get(KIND_KEY) === ID_ARRAY_KIND
    ) {
      syncIdArrayDelta(existing, previousValue, nextValue);
      return;
    }
    syncMapValue(map, key, nextValue);
  });
};

export const applyProjectSnapshot = (
  doc: Y.Doc,
  project: Record<string, unknown>,
  origin: unknown,
) => {
  doc.transact(() => syncMap(doc.getMap("project"), project), origin);
};

/**
 * Applies only changes authored between two application snapshots. Remote
 * fields and id-array members absent from both snapshots remain untouched.
 * Deletion is therefore explicit (present before, absent after) instead of
 * being inferred from a stale client's incomplete project image.
 */
export const applyProjectSnapshotDelta = (
  doc: Y.Doc,
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  origin: unknown,
) => {
  doc.transact(() => syncMapDelta(doc.getMap("project"), previous, next), origin);
};

export type ProjectNodeGeometryPatch = {
  nodeId: string;
  position?: { x: number; y: number };
  measured?: { width?: number; height?: number };
};

export type ProjectNodeTextPatch = {
  nodeId: string;
  text: string;
  derived?: Partial<Record<"atMentions" | "entityBindings", unknown>>;
};

export const applyProjectNodeGeometryPatches = (
  doc: Y.Doc,
  projectId: string,
  patches: ProjectNodeGeometryPatch[],
  updatedAt: number,
  origin: unknown,
) => {
  const projects = doc.getMap("project").get("flowProjects");
  if (!(projects instanceof Y.Map) || projects.get(KIND_KEY) !== ID_ARRAY_KIND) return false;
  const projectItems = projects.get(ITEMS_KEY);
  if (!(projectItems instanceof Y.Map)) return false;
  const project = projectItems.get(projectId);
  if (!(project instanceof Y.Map)) return false;
  const flow = project.get("flow");
  if (!(flow instanceof Y.Map)) return false;
  const nodes = flow.get("flowNodes");
  if (!(nodes instanceof Y.Map) || nodes.get(KIND_KEY) !== ID_ARRAY_KIND) return false;
  const nodeItems = nodes.get(ITEMS_KEY);
  if (!(nodeItems instanceof Y.Map)) return false;

  let applied = false;
  doc.transact(() => {
    for (const patch of patches) {
      const node = nodeItems.get(patch.nodeId);
      if (!(node instanceof Y.Map)) continue;
      if (patch.position) syncMapValue(node, "position", patch.position);
      if (patch.measured) syncMapValue(node, "measured", patch.measured);
      applied = true;
    }
    if (applied) syncMapValue(project, "updatedAt", updatedAt);
  }, origin);
  return applied;
};

export const applyProjectNodeTextPatches = (
  doc: Y.Doc,
  projectId: string,
  patches: ProjectNodeTextPatch[],
  updatedAt: number,
  revision: number,
  origin: unknown,
) => {
  const projects = doc.getMap("project").get("flowProjects");
  if (!(projects instanceof Y.Map) || projects.get(KIND_KEY) !== ID_ARRAY_KIND) return false;
  const projectItems = projects.get(ITEMS_KEY);
  if (!(projectItems instanceof Y.Map)) return false;
  const project = projectItems.get(projectId);
  if (!(project instanceof Y.Map)) return false;
  const flow = project.get("flow");
  if (!(flow instanceof Y.Map)) return false;
  const nodes = flow.get("flowNodes");
  if (!(nodes instanceof Y.Map) || nodes.get(KIND_KEY) !== ID_ARRAY_KIND) return false;
  const nodeItems = nodes.get(ITEMS_KEY);
  if (!(nodeItems instanceof Y.Map)) return false;

  const targets = patches.map((patch) => {
    const node = nodeItems.get(patch.nodeId);
    const data = node instanceof Y.Map ? node.get("data") : null;
    return data instanceof Y.Map ? { patch, data } : null;
  });
  // Typed application is all-or-nothing. A stale intent must fall back to the
  // generic snapshot delta rather than partially applying a multi-node edit.
  if (!targets.length || targets.some((target) => !target)) return false;

  doc.transact(() => {
    targets.forEach((target) => {
      if (!target) return;
      syncMapValue(target.data, "text", target.patch.text);
      if (target.patch.derived) {
        (["atMentions", "entityBindings"] as const).forEach((field) => {
          if (Object.hasOwn(target.patch.derived!, field)) {
            syncMapValue(target.data, field, target.patch.derived![field]);
          }
        });
      }
    });
    syncMapValue(flow, "revision", revision);
    syncMapValue(project, "updatedAt", updatedAt);
  }, origin);
  return true;
};

export const readProjectSnapshot = <T extends Record<string, unknown>>(doc: Y.Doc): T =>
  readSharedValue(doc.getMap("project")) as T;

export const isProjectDocumentEmpty = (doc: Y.Doc) => doc.getMap("project").size === 0;

export const encodeUpdateBase64 = (update: Uint8Array) => {
  let binary = "";
  update.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};

export const decodeUpdateBase64 = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};
