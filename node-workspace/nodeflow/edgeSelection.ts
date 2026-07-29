export type EdgeSelectionUpdate =
  | { id: string; selected: boolean }
  | { id: string; removed: true };

export const applyEdgeSelectionUpdates = (
  current: ReadonlySet<string>,
  updates: readonly EdgeSelectionUpdate[]
) => {
  if (!updates.length) return current;
  const next = new Set(current);
  updates.forEach((update) => {
    if ("removed" in update || !update.selected) next.delete(update.id);
    else next.add(update.id);
  });
  if (
    next.size === current.size &&
    Array.from(next).every((edgeId) => current.has(edgeId))
  ) {
    return current;
  }
  return next;
};
