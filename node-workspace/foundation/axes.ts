import type { NodeType } from "../types";

export type FoundationAxis = "time" | "space";
export type FoundationWeightedAxis = Exclude<FoundationAxis, "time">;

export type FoundationAxisDefinition = {
  id: FoundationAxis;
  label: string;
  blockLabel: string;
  layoutY: number;
  accepts: "document" | "media";
  sizing: "duration" | "weight";
};

export const FOUNDATION_AXIS_DEFINITIONS: readonly FoundationAxisDefinition[] = [
  { id: "time", label: "时间轴", blockLabel: "时间区块", layoutY: 500, accepts: "document", sizing: "duration" },
  { id: "space", label: "空间轴", blockLabel: "空间区块", layoutY: 1020, accepts: "document", sizing: "weight" },
] as const;

export const FOUNDATION_AXES = FOUNDATION_AXIS_DEFINITIONS.map((definition) => definition.id);
export const FOUNDATION_WEIGHTED_AXES = FOUNDATION_AXES.filter(
  (axis): axis is FoundationWeightedAxis => axis !== "time"
);

const FOUNDATION_AXIS_BY_ID = new Map(FOUNDATION_AXIS_DEFINITIONS.map((definition) => [definition.id, definition]));

const DOCUMENT_NODE_TYPES = new Set<NodeType>(["scriptPage", "mdText", "text"]);
const MEDIA_NODE_TYPES = new Set<NodeType>(["imageInput", "audioInput", "videoInput", "pdfInput"]);

export const isFoundationAxis = (value: unknown): value is FoundationAxis =>
  typeof value === "string" && FOUNDATION_AXIS_BY_ID.has(value as FoundationAxis);

export const getFoundationAxisDefinition = (axis: FoundationAxis) => FOUNDATION_AXIS_BY_ID.get(axis)!;

export const getNextFoundationAxis = (axis: FoundationAxis) => {
  const index = FOUNDATION_AXES.indexOf(axis);
  return FOUNDATION_AXES[(index + 1) % FOUNDATION_AXES.length];
};

export const isNodeTypeAllowedInFoundationAxis = (axis: FoundationAxis, nodeType: NodeType) => {
  const definition = getFoundationAxisDefinition(axis);
  return definition.accepts === "document"
    ? DOCUMENT_NODE_TYPES.has(nodeType)
    : MEDIA_NODE_TYPES.has(nodeType);
};
