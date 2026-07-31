import type { CanvasMeasuredSize, CanvasPosition } from "../types";

export type ProjectNodeGeometryPatch = {
  nodeId: string;
  position?: CanvasPosition;
  measured?: CanvasMeasuredSize;
};

export type ProjectNodeGeometryMutation = {
  projectId: string;
  patches: ProjectNodeGeometryPatch[];
  updatedAt: number;
};

type Listener = (mutation: ProjectNodeGeometryMutation) => void;
const listeners = new Set<Listener>();

export const publishProjectNodeGeometryMutation = (
  mutation: ProjectNodeGeometryMutation,
) => {
  if (!mutation.patches.length) return;
  listeners.forEach((listener) => listener(mutation));
};

export const subscribeProjectNodeGeometryMutations = (listener: Listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
