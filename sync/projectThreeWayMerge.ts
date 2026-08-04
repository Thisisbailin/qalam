import type { ProjectData } from "../types";
import { mergeConcurrentText } from "../collaboration/threeWayTextMerge";

const MISSING = Symbol("stylo-missing");
type MergeValue = unknown | typeof MISSING;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isIdRecord = (value: unknown): value is Record<string, unknown> & { id: string } =>
  isRecord(value) && typeof value.id === "string" && value.id.length > 0;

const valuesEqual = (left: MergeValue, right: MergeValue): boolean => {
  if (Object.is(left, right)) return true;
  if (left === MISSING || right === MISSING) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length
      && left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key) =>
        Object.prototype.hasOwnProperty.call(right, key)
        && valuesEqual(left[key], right[key])
      );
  }
  return false;
};

const supportsIdMerge = (arrays: unknown[][]) => {
  const populated = arrays.filter((array) => array.length > 0);
  return populated.length > 0 && populated.every((array) => array.every(isIdRecord));
};

const mapById = (value: unknown[]) => new Map(
  value.filter(isIdRecord).map((entry) => [entry.id, entry]),
);

const mergeIdArrays = (
  base: unknown[],
  local: unknown[],
  remote: unknown[],
) => {
  const baseById = mapById(base);
  const localById = mapById(local);
  const remoteById = mapById(remote);
  const mergedById = new Map<string, unknown>();
  const ids = new Set([
    ...baseById.keys(),
    ...localById.keys(),
    ...remoteById.keys(),
  ]);
  ids.forEach((id) => {
    const merged = mergeValue(
      baseById.has(id) ? baseById.get(id) : MISSING,
      localById.has(id) ? localById.get(id) : MISSING,
      remoteById.has(id) ? remoteById.get(id) : MISSING,
    );
    if (merged !== MISSING) mergedById.set(id, merged);
  });

  const baseOrder = base.filter(isIdRecord).map((entry) => entry.id);
  const localOrder = local.filter(isIdRecord).map((entry) => entry.id);
  const remoteOrder = remote.filter(isIdRecord).map((entry) => entry.id);
  const localReordered = !valuesEqual(baseOrder, localOrder);
  const preferredOrder = localReordered ? localOrder : remoteOrder;
  const order = [
    ...preferredOrder,
    ...remoteOrder,
    ...localOrder,
    ...baseOrder,
  ];
  const emitted = new Set<string>();
  const result: unknown[] = [];
  order.forEach((id) => {
    if (emitted.has(id) || !mergedById.has(id)) return;
    emitted.add(id);
    result.push(mergedById.get(id));
  });
  return result;
};

const mergeValue = (
  base: MergeValue,
  local: MergeValue,
  remote: MergeValue,
): MergeValue => {
  if (valuesEqual(local, base)) return remote;
  if (valuesEqual(remote, base)) return local;
  if (local === MISSING) return MISSING;
  if (remote === MISSING) return local;

  if (typeof base === "string" && typeof local === "string" && typeof remote === "string") {
    return mergeConcurrentText(base, local, remote);
  }

  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    return supportsIdMerge([base, local, remote])
      ? mergeIdArrays(base, local, remote)
      : local;
  }
  if (isRecord(base) && isRecord(local) && isRecord(remote)) {
    const result: Record<string, unknown> = {};
    const keys = new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(remote),
    ]);
    keys.forEach((key) => {
      const merged = mergeValue(
        Object.prototype.hasOwnProperty.call(base, key) ? base[key] : MISSING,
        Object.prototype.hasOwnProperty.call(local, key) ? local[key] : MISSING,
        Object.prototype.hasOwnProperty.call(remote, key) ? remote[key] : MISSING,
      );
      if (merged !== MISSING) result[key] = merged;
    });
    return result;
  }
  // Both sides changed the same scalar. The offline local action is the only
  // edit not yet durably acknowledged, so it wins this individual field.
  return local;
};

/**
 * Replays only locally-authored semantic differences onto a canonical Yjs
 * generation. Unrelated edits already present on the new server generation
 * remain intact.
 */
export const mergeProjectSnapshotsAcrossEpoch = (
  confirmedBase: ProjectData,
  local: ProjectData,
  remote: ProjectData,
) => mergeValue(confirmedBase, local, remote) as ProjectData;
