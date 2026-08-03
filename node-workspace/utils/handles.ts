const IMAGE_SOURCE_NODE_TYPES = new Set([
  "imageInput",
  "annotation",
  "imageGen",
  "nanoBananaImageGen",
  "wanImageGen",
]);

const TEXT_SOURCE_NODE_TYPES = new Set([
  "pinoard",
  "scriptPage",
  "mdText",
  "folder",
  "text",
  "scriptBoard",
  "lookbook",
  "identityCard",
]);

const AUDIO_SOURCE_NODE_TYPES = new Set(["audioInput"]);
const VIDEO_SOURCE_NODE_TYPES = new Set(["videoInput"]);

export const isTypedHandle = (handle?: string | null): handle is "image" | "text" | "audio" | "video" =>
  handle === "image" || handle === "text" || handle === "audio" || handle === "video";

export const inferHandleTypeFromNodeType = (nodeType?: string | null): "image" | "text" | "audio" | "video" | null => {
  if (!nodeType) return null;
  if (IMAGE_SOURCE_NODE_TYPES.has(nodeType)) return "image";
  if (TEXT_SOURCE_NODE_TYPES.has(nodeType)) return "text";
  if (AUDIO_SOURCE_NODE_TYPES.has(nodeType)) return "audio";
  if (VIDEO_SOURCE_NODE_TYPES.has(nodeType)) return "video";
  return null;
};

export const resolveEdgeHandleType = ({
  sourceHandle,
  targetHandle,
  sourceNodeType,
}: {
  sourceHandle?: string | null;
  targetHandle?: string | null;
  sourceNodeType?: string | null;
}): "image" | "text" | "audio" | "video" | null => {
  if (isTypedHandle(targetHandle)) return targetHandle;
  if (targetHandle === "multi") {
    return isTypedHandle(sourceHandle) ? sourceHandle : inferHandleTypeFromNodeType(sourceNodeType);
  }
  if (isTypedHandle(sourceHandle)) return sourceHandle;
  return inferHandleTypeFromNodeType(sourceNodeType);
};

export const nodeSupportsHandle = (handles: string[], handle: string) => {
  if (handles.includes(handle)) return true;
  return isTypedHandle(handle) && handles.includes("multi");
};

export const getNodeHandles = (nodeType: string): { inputs: string[]; outputs: string[] } => {
  switch (nodeType) {
    case "pinoard":
      return { inputs: ["multi", "text"], outputs: ["text"] };
    case "imageInput":
      return { inputs: [], outputs: ["image"] };
    case "audioInput":
      return { inputs: [], outputs: ["audio"] };
    case "videoInput":
      return { inputs: ["multi", "image", "text", "audio", "video"], outputs: ["video"] };
    case "pdfInput":
      return { inputs: ["text"], outputs: [] };
    case "annotation":
      return { inputs: ["image"], outputs: ["image"] };
    case "prompt":
      return { inputs: [], outputs: ["text"] };
    case "text":
    case "folder":
      return { inputs: ["text"], outputs: ["text"] };
    case "scriptPage":
    case "mdText":
      return { inputs: ["text"], outputs: ["text"] };
    case "scriptBoard":
      return { inputs: [], outputs: ["text"] };
    case "lookbook":
    case "identityCard":
      return { inputs: ["multi", "image", "audio", "video", "text"], outputs: ["text"] };
    case "imageGen":
    case "nanoBananaImageGen":
      return { inputs: ["multi", "image", "text"], outputs: ["image"] };
    case "wanImageGen":
      return { inputs: ["multi", "image", "text"], outputs: ["image"] };
    case "wanReferenceVideoGen":
      return { inputs: ["multi", "image", "video", "audio", "text"], outputs: [] };
    case "viduVideoGen":
      return { inputs: ["multi", "image", "text"], outputs: [] };
    case "seedanceVideoGen":
      return { inputs: ["multi", "image", "video", "text", "audio"], outputs: [] };
    default:
      return { inputs: [], outputs: [] };
  }
};

export const isValidConnection = (connection: { sourceHandle?: string | null; targetHandle?: string | null }) => {
  const { sourceHandle, targetHandle } = connection;
  if (sourceHandle === "image" && targetHandle !== "image" && targetHandle !== "multi") return false;
  if (sourceHandle === "text" && targetHandle !== "text" && targetHandle !== "multi") return false;
  if (sourceHandle === "audio" && targetHandle !== "audio" && targetHandle !== "multi") return false;
  if (sourceHandle === "video" && targetHandle !== "video" && targetHandle !== "multi") return false;
  return true;
};
