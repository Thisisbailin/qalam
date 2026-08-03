import type { CSSProperties } from "react";
import { DesignAssetItem, Episode, ProjectRoleIdentity, SeedanceModel, ViduReferenceMode } from "../../types";

export type HandleType = "image" | "text" | "audio" | "video" | "multi" | "contains";

export const NODE_TYPES = [
  "pinoard",
  "scriptPage",
  "mdText",
  "folder",
  "imageInput",
  "audioInput",
  "videoInput",
  "pdfInput",
  "annotation",
  "text",
  "scriptBoard",
  "lookbook",
  /** @deprecated Legacy name. New identity wrappers use `lookbook`. */
  "identityCard",
  "imageGen",
  "nanoBananaImageGen",
  "wanImageGen",
  "wanReferenceVideoGen",
  "viduVideoGen",
  "seedanceVideoGen",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export type NodeStatus = "idle" | "loading" | "complete" | "error";

export type NodeCardColor = "none" | "rose" | "amber" | "moss" | "blue" | "slate";

export type LookbookMediaFit = "cover" | "contain";

export interface LookbookLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  fit: LookbookMediaFit;
}

export interface LookbookBookEntry {
  nodeId: string;
  spreadIndex: number;
  layout: LookbookLayout;
}

export interface LookbookBookState {
  version: 1;
  /** Number of explicitly created interior pages. Missing in legacy projects. */
  pageCount?: number;
  entries: LookbookBookEntry[];
}

export interface BaseNodeData extends Record<string, unknown> {
  label?: string;
  title?: string;
  styloNodeRef?: string;
  foundationContainerId?: string;
  lookbookIdentityId?: string;
  lookbookRole?: "index" | "member";
  /** @deprecated Legacy per-node layout. New layouts live on the Lookbook index document. */
  lookbookLayout?: LookbookLayout;
  lookbookBook?: LookbookBookState;
  /** Persisted wrapper state. Missing means expanded for legacy projects. */
  wrapperCollapsed?: boolean;
  /** Runtime-only projection used by physical wrapper node visuals. */
  wrapperMemberCount?: number;
  /** Runtime-only marker for the root page of a multi-page screenplay. */
  wrapperRoot?: boolean;
  /** Runtime-only content sample rendered on physical wrapper covers. */
  wrapperPreview?: string;
  /** Optional visual marker applied from the input-node context menu. */
  cardColor?: NodeCardColor;
}

export interface ImageInputNodeData extends BaseNodeData {
  image: string | null;
  filename: string | null;
  mimeType?: string | null;
  storageBucket?: "assets" | "public-assets" | null;
  storagePath?: string | null;
  dimensions: { width: number; height: number } | null;
  hasAlpha?: boolean;
  assetAuditStatus?: "idle" | "uploading" | "submitting" | "processing" | "active" | "failed" | "error";
  assetAuditMessage?: string | null;
  assetAuditCheckedAt?: number | null;
  assetId?: string | null;
  assetUri?: string | null;
  assetGroupId?: string | null;
  assetSourceUrl?: string | null;
  assetSourceBucket?: "assets" | "public-assets" | null;
  assetSourcePath?: string | null;
  identityTag?: string;
  identityId?: string;
  label?: string;
  atMentions?: TextNodeData['atMentions'];
  entityBindings?: EntityBinding[];
}

export interface AudioInputNodeData extends BaseNodeData {
  audio: string | null;
  filename: string | null;
  storageBucket?: "assets" | "public-assets" | null;
  storagePath?: string | null;
  mimeType?: string | null;
  durationMs?: number | null;
  label?: string;
}

export interface VideoInputNodeData extends BaseNodeData {
  video: string | null;
  filename: string | null;
  storageBucket?: string | null;
  storagePath?: string | null;
  mimeType?: string | null;
  durationMs?: number | null;
  dimensions?: { width: number; height: number } | null;
  aspectRatio?: string | null;
  resolution?: string | null;
  model?: string | null;
  label?: string;
}

export type PdfHighlightColor = "yellow" | "green" | "blue";

export interface PdfHighlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfHighlightAnnotation {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rects?: PdfHighlightRect[];
  quote?: string;
  textStart?: number;
  textEnd?: number;
  noteNodeId?: string;
  color: PdfHighlightColor;
  createdAt: number;
}

export interface PdfInputNodeData extends BaseNodeData {
  pdf: string | null;
  filename: string | null;
  storageBucket?: "assets" | "public-assets" | null;
  storagePath?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  highlights: PdfHighlightAnnotation[];
  label?: string;
}

export type ShapeType = "rectangle" | "circle" | "arrow" | "freehand" | "text";

export interface BaseShape {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  stroke: string;
  strokeWidth: number;
  opacity: number;
}

export interface RectangleShape extends BaseShape {
  type: "rectangle";
  width: number;
  height: number;
  fill: string | null;
}

export interface CircleShape extends BaseShape {
  type: "circle";
  radiusX: number;
  radiusY: number;
  fill: string | null;
}

export interface ArrowShape extends BaseShape {
  type: "arrow";
  points: number[];
}

export interface FreehandShape extends BaseShape {
  type: "freehand";
  points: number[];
}

export interface TextShape extends BaseShape {
  type: "text";
  text: string;
  fontSize: number;
  fill: string;
}

export type AnnotationShape =
  | RectangleShape
  | CircleShape
  | ArrowShape
  | FreehandShape
  | TextShape;

export interface AnnotationNodeData extends BaseNodeData {
  sourceImage: string | null;
  annotations: AnnotationShape[];
  outputImage: string | null;
}

export interface EntityBinding {
  id: string;
  rawText: string;
  status: "resolved" | "missing";
  entityType: "identity" | "unknown";
  entityId?: string;
  identityId?: string;
  portraitId?: string;
  mention?: string;
  aliasValue?: string;
  summary?: string;
  detail?: string;
  tone?: "emerald" | "sky";
  roleKind?: "person" | "scene";
  start: number;
  end: number;
  resolutionSource?: "manual" | "auto";
  version?: number;
}

export interface TextNodeData extends BaseNodeData {
  title: string;
  text: string;
  documentId?: string;
  documentKind?: "script" | "archive" | "note";
  format?: "fountain" | "markdown" | "plain";
  refId?: string;
  atMentions?: {
    name: string;
    status: 'match' | 'missing';
    kind?: 'identity' | 'unknown';
    identityId?: string;
    portraitId?: string;
    mention?: string;
    summary?: string;
    image?: string;
    detail?: string;
    tone?: "emerald" | "sky";
    roleKind?: "person" | "scene";
  }[];
  entityBindings?: EntityBinding[];
}

export interface ScriptPageNodeData extends TextNodeData {
  title: string;
  episodeId?: number;
  text: string;
  documentId?: string;
  documentKind?: "script";
  format?: "fountain";
  preview?: string;
  screenplayStats?: {
    lines: number;
    scenes: number;
    characters: number;
    locations: number;
    words: number;
    glyphs: number;
    estimatedPages: number;
    estimatedMinutes: number;
    dialoguePercent: number;
  };
  revision?: number;
  manuscriptId?: string;
  pageNumber?: number;
}

export interface MarkdownTextNodeData extends TextNodeData {
  title: string;
  text: string;
  content?: string;
  documentId?: string;
  documentKind?: "archive";
  format?: "markdown";
  preview?: string;
}

export interface FolderNodeData extends BaseNodeData {
  title: string;
  folderKind?: "generic" | "foundation" | "manus";
  systemManaged?: boolean;
  manuscriptId?: string;
}

export interface ScriptBoardNodeData extends BaseNodeData {
  title: string;
  episodeId?: number;
  sceneId?: string;
}

export interface IdentityCardNodeData extends BaseNodeData {
  title: string;
  identityId?: string;
  lookbookIndexNodeId?: string;
  avatarOverrides?: Record<string, string>;
}

export type LookbookNodeData = IdentityCardNodeData;

export interface PinoardNodeData extends BaseNodeData {
  title: string;
}

export interface ImageGenNodeData extends BaseNodeData {
  inputImages: string[];
  outputImage: string | null;
  versionHistory?: Array<{
    id: string;
    src: string;
    createdAt: number;
  }>;
  status: 'idle' | 'loading' | 'complete' | 'error';
  error: string | null;
  model?: string;
  aspectRatio: string;
  quality?: string;
  enableInterleave?: boolean;
  outputCount?: number;
  maxImages?: number;
  seed?: number;
  watermark?: boolean;
  size?: string;
  designCategory?: "identity";
  designRefId?: string;
  identityTag?: string;
  identityId?: string;
  taskRequestedAt?: number | null;
  taskSubmittedAt?: number | null;
  processingStartedAt?: number | null;
  taskCompletedAt?: number | null;
  taskState?: string | null;
  progressPercent?: number | null;
  progressLabel?: string | null;
  progressHint?: string | null;
}

export interface VideoGenNodeData extends BaseNodeData {
  inputImages: string[];
  referenceImages?: string[];
  referenceVideos?: string[];
  referenceAudios?: string[];
  referenceVoiceTarget?: string | null;
  firstFrameImage?: string | null;
  projectReferenceTargets?: {
    category: "identity";
    refId: string;
    label?: string;
  }[];
  videoId?: string;
  videoUrl?: string; // For polling result
  status: 'idle' | 'loading' | 'complete' | 'error';
  error: string | null;
  aspectRatio: string;
  duration?: string;
  model?: string;
  quality?: string;
  resolution?: string;
  size?: string;
  seed?: number;
  watermark?: boolean;
  audioEnabled?: boolean;
  audioUrl?: string;
}

export interface ViduVideoGenNodeData extends BaseNodeData {
  inputImages: string[];
  videoId?: string;
  videoUrl?: string;
  status: 'idle' | 'loading' | 'complete' | 'error';
  error: string | null;
  progressPercent?: number | null;
  progressLabel?: string | null;
  progressHint?: string | null;
  taskState?: string | null;
  taskRequestedAt?: number | null;
  taskSubmittedAt?: number | null;
  processingStartedAt?: number | null;
  taskCompletedAt?: number | null;
  lastCreditsCost?: number | null;
  authProbeStatus?: 'idle' | 'loading' | 'complete' | 'error';
  authProbeSummary?: string | null;
  authProbeDetail?: string | null;
  mode: ViduReferenceMode;
  useCharacters?: boolean;
  autoSubjects?: boolean;
  subjects?: { name: string; images?: string[]; videos?: string[]; voiceId?: string; serverId?: string }[];
  voiceId?: string;
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
  audioEnabled?: boolean;
  bgm?: boolean;
  offPeak?: boolean;
  watermark?: boolean;
  model?: string;
  seed?: number;
}

export interface SeedanceVideoGenNodeData extends BaseNodeData {
  inputImages: string[];
  referenceVideos: string[];
  referenceAudios: string[];
  videoId?: string;
  videoUrl?: string;
  status: "idle" | "loading" | "complete" | "error";
  error: string | null;
  model: SeedanceModel;
  mode: "multimodalReference";
  resolution?: "480p" | "720p";
  ratio?: "adaptive" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "21:9";
  duration?: number;
  generateAudio?: boolean;
  watermark?: boolean;
}

export interface OutputNodeData extends BaseNodeData {
  image: string | null;
  text?: string | null;
}

export interface NoteNodeData extends BaseNodeData {
  title?: string;
  text: string;
  color?: string;
}

export type NodeFlowNodeData =
  | ImageInputNodeData
  | AudioInputNodeData
  | VideoInputNodeData
  | PdfInputNodeData
  | AnnotationNodeData
  | TextNodeData
  | ScriptPageNodeData
  | MarkdownTextNodeData
  | FolderNodeData
  | ScriptBoardNodeData
  | IdentityCardNodeData
  | PinoardNodeData
  | ImageGenNodeData
  | VideoGenNodeData
  | ViduVideoGenNodeData
  | SeedanceVideoGenNodeData;

export type NodeFlowPosition = {
  x: number;
  y: number;
};

export type NodeFlowMeasured = {
  width?: number;
  height?: number;
};

export type NodeFlowNodeStyle = CSSProperties;

export interface NodeFlowNode {
  id: string;
  type: NodeType;
  position: NodeFlowPosition;
  data: NodeFlowNodeData;
  parentId?: string;
  extent?: "parent";
  style?: NodeFlowNodeStyle;
  measured?: NodeFlowMeasured;
  selected?: boolean;
  deletable?: boolean;
  draggable?: boolean;
  connectable?: boolean;
}

export interface NodeFlowLinkData extends Record<string, unknown> {
  hasPause?: boolean;
  relation?: "foundation-membership" | "folder-membership" | "lookbook-membership" | "pinoard-membership" | "screenplay-page";
}

export interface NodeFlowLink {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data?: NodeFlowLinkData;
  selected?: boolean;
  type?: string;
  markerEnd?: string;
}

export interface NodeFlowGraphLink {
  id: string;
  sourceRef: string;
  targetRef: string;
}

export type GlobalAssetType = "image" | "video" | "audio";

export type GlobalAssetHistoryItem = {
  id: string;
  type: GlobalAssetType;
  src: string;
  prompt: string;
  aspectRatio?: string;
  model?: string;
  timestamp: number;
  sourceId?: string;
};

export type NodeFlowContextSnapshot = {
  projectId?: string;
  rawScript: string;
  episodes: Episode[];
  designAssets: DesignAssetItem[];
  roles: ProjectRoleIdentity[];
};

export type NodeFlowViewport = {
  x: number;
  y: number;
  zoom: number;
};

export interface NodeFlowFile {
  version: number;
  revision: number;
  name: string;
  nodes: NodeFlowNode[];
  links: NodeFlowLink[];
  graphLinks?: NodeFlowGraphLink[];
  linkStyle?: "angular" | "curved";
  globalAssetHistory?: GlobalAssetHistoryItem[];
  nodeFlowContext?: NodeFlowContextSnapshot;
  viewport?: NodeFlowViewport;
  activeView?: string | null;
}
