import * as Y from "yjs";

type TextChangeRange = {
  start: number;
  end: number;
};

const applyTextSnapshot = (text: Y.Text, next: string) => {
  const previous = text.toString();
  if (previous === next) return;
  let prefix = 0;
  const maxPrefix = Math.min(previous.length, next.length);
  while (prefix < maxPrefix && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  const maxSuffix = Math.min(previous.length - prefix, next.length - prefix);
  while (
    suffix < maxSuffix
    && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) suffix += 1;
  const deleteLength = previous.length - prefix - suffix;
  if (deleteLength > 0) text.delete(prefix, deleteLength);
  const inserted = next.slice(prefix, next.length - suffix);
  if (inserted) text.insert(prefix, inserted);
};

const readChangeRange = (base: string, next: string): TextChangeRange | null => {
  if (base === next) return null;
  let prefix = 0;
  const maxPrefix = Math.min(base.length, next.length);
  while (prefix < maxPrefix && base[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  const maxSuffix = Math.min(base.length - prefix, next.length - prefix);
  while (
    suffix < maxSuffix
    && base[base.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) suffix += 1;
  return { start: prefix, end: base.length - suffix };
};

const rangesOverlap = (left: TextChangeRange, right: TextChangeRange) => {
  const leftDeletes = left.end > left.start;
  const rightDeletes = right.end > right.start;
  if (leftDeletes && rightDeletes) {
    return left.start < right.end && right.start < left.end;
  }
  if (leftDeletes) return right.start > left.start && right.start < left.end;
  if (rightDeletes) return left.start > right.start && left.start < right.end;
  // Concurrent insertions at the same boundary are safe: the CRDT gives them a
  // stable order and retains both insertions.
  return false;
};

export const canAutoMergeConcurrentText = (
  base: string,
  local: string,
  remote: string,
) => {
  const localRange = readChangeRange(base, local);
  const remoteRange = readChangeRange(base, remote);
  return !localRange || !remoteRange || !rangesOverlap(localRange, remoteRange);
};

/**
 * Reconstructs two deterministic Y.Text branches from a common semantic base
 * and merges their character operations. Fixed client ids make the result
 * stable on every device during a cross-epoch semantic rebase.
 */
export const mergeConcurrentText = (base: string, local: string, remote: string) => {
  if (local === base) return remote;
  if (remote === base || local === remote) return local;

  const baseDoc = new Y.Doc();
  const localDoc = new Y.Doc();
  const remoteDoc = new Y.Doc();
  // These documents are ephemeral and contain only this one merge. Stable,
  // distinct ids avoid device-specific insertion ordering.
  baseDoc.clientID = 1;
  localDoc.clientID = 2;
  remoteDoc.clientID = 3;
  try {
    const baseText = baseDoc.getText("value");
    if (base) baseText.insert(0, base);
    const baseState = Y.encodeStateAsUpdate(baseDoc);
    const baseVector = Y.encodeStateVector(baseDoc);
    Y.applyUpdate(localDoc, baseState);
    Y.applyUpdate(remoteDoc, baseState);
    applyTextSnapshot(localDoc.getText("value"), local);
    applyTextSnapshot(remoteDoc.getText("value"), remote);
    Y.applyUpdate(localDoc, Y.encodeStateAsUpdate(remoteDoc, baseVector));
    return localDoc.getText("value").toString();
  } finally {
    baseDoc.destroy();
    localDoc.destroy();
    remoteDoc.destroy();
  }
};
