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

export type ProjectNodeTextDerivedField = "atMentions" | "entityBindings";

export type ProjectNodeTextMutation = {
  projectId: string;
  nodeId: string;
  previousText: string;
  nextText: string;
  derivedFields: ProjectNodeTextDerivedField[];
};

type GeometryListener = (mutation: ProjectNodeGeometryMutation) => void;
type TextListener = (mutation: ProjectNodeTextMutation) => void;
const geometryListeners = new Set<GeometryListener>();
const textListeners = new Set<TextListener>();

export const publishProjectNodeGeometryMutation = (
  mutation: ProjectNodeGeometryMutation,
) => {
  if (!mutation.patches.length) return;
  geometryListeners.forEach((listener) => listener(mutation));
};

export const subscribeProjectNodeGeometryMutations = (listener: GeometryListener) => {
  geometryListeners.add(listener);
  return () => geometryListeners.delete(listener);
};

export const publishProjectNodeTextMutation = (mutation: ProjectNodeTextMutation) => {
  if (!mutation.projectId || !mutation.nodeId || mutation.previousText === mutation.nextText) return;
  textListeners.forEach((listener) => listener(mutation));
};

export const subscribeProjectNodeTextMutations = (listener: TextListener) => {
  textListeners.add(listener);
  return () => textListeners.delete(listener);
};
