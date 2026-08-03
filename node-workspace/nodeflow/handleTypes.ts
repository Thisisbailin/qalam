export const NODE_FLOW_HANDLE_TYPES = [
  "image",
  "text",
  "audio",
  "video",
  "multi",
  "contains",
] as const;

export type NodeFlowHandleType = (typeof NODE_FLOW_HANDLE_TYPES)[number];

const NODE_FLOW_HANDLE_TYPE_SET = new Set<string>(NODE_FLOW_HANDLE_TYPES);

export const isNodeFlowHandleType = (value: unknown): value is NodeFlowHandleType =>
  typeof value === "string" && NODE_FLOW_HANDLE_TYPE_SET.has(value);
