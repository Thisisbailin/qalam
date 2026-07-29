import type { Episode, Scene } from "../../types";
import { buildProjectIdentities, resolveLegacyIdentity } from "../../utils/identityCards";
import type {
  AnnotationNodeData,
  AudioInputNodeData,
  IdentityCardNodeData,
  ImageGenNodeData,
  ImageInputNodeData,
  NodeFlowContextSnapshot,
  NodeFlowLink,
  NodeFlowNode,
  ScriptBoardNodeData,
  TextNodeData,
  VideoInputNodeData,
  VideoGenNodeData,
} from "../types";
import { resolveEdgeHandleType } from "../utils/handles";
import { isFolderMembershipLink } from "../manus/folder";

export type NodeFlowConnectedInputs = {
  images: string[];
  audios: string[];
  videos: string[];
  text: string | null;
  atMentions?: TextNodeData["atMentions"];
  entityBindings?: TextNodeData["entityBindings"];
  imageRefs?: { src: string; identityTag?: string | null; identityId?: string | null }[];
  connectedIdentity?: {
    identityId: string;
    mention: string;
    name: string;
    description?: string;
    designPrompt?: string;
    primaryPortraitUrl?: string;
  };
};

const truncateText = (value: string, limit: number) => {
  const normalized = value.trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...`;
};

const findEpisodeBySceneId = (episodes: Episode[], sceneId?: string) =>
  episodes.find((episode) => episode.scenes.some((scene) => scene.id === sceneId));

const buildSceneLabel = (scene: Scene, index: number) =>
  `场景 ${index + 1} · ${scene.id}${scene.title ? ` · ${scene.title}` : ""}`;

const buildScriptBoardText = (data: ScriptBoardNodeData, episodes: Episode[]) => {
  if (!episodes.length) return null;
  const episode = episodes.find((item) => item.id === data.episodeId) ?? episodes[0];
  if (!episode) return null;
  const blocks = episode.scenes.map((scene, index) => {
    const header = buildSceneLabel(scene, index);
    return `${header}\n${scene.content?.trim() || "暂无场景正文"}`;
  });
  return [`剧本面板：第${episode.id}集`, ...blocks].filter(Boolean).join("\n\n");
};

const buildIdentityCardText = (data: IdentityCardNodeData, nodeFlowContext: NodeFlowContextSnapshot) => {
  const { roles, designAssets } = nodeFlowContext;
  const identities = buildProjectIdentities(roles || [], designAssets || []);
  const identity = resolveLegacyIdentity(identities, {
    identityId: data.identityId,
  });
  if (!identity) return null;
  return [
    `身份证：${identity.displayName}`,
    ...identity.detailLines,
    identity.title ? `身份名：${identity.title}` : "",
    identity.subtitle ? `区间：${identity.subtitle}` : "",
    identity.description,
  ]
    .filter(Boolean)
    .join("\n\n");
};

export const buildConnectedInputs = ({
  nodeId,
  nodes,
  links,
  nodeFlowContext,
}: {
  nodeId: string;
  nodes: NodeFlowNode[];
  links: NodeFlowLink[];
  nodeFlowContext: NodeFlowContextSnapshot;
}): NodeFlowConnectedInputs => {
  const images: string[] = [];
  const audios: string[] = [];
  const videos: string[] = [];
  const texts: string[] = [];
  const mentions: TextNodeData["atMentions"] = [];
  const entityBindings: TextNodeData["entityBindings"] = [];
  const imageRefs: { src: string; identityTag?: string | null; identityId?: string | null }[] = [];
  let connectedIdentity: NodeFlowConnectedInputs["connectedIdentity"] | undefined;
  const targetNode = nodes.find((node) => node.id === nodeId);
  const preferSeedanceAssetUri = targetNode?.type === "seedanceVideoGen";

  links
    .filter((link) => link.target === nodeId && !isFolderMembershipLink(link))
    .forEach((link) => {
      const sourceNode = nodes.find((node) => node.id === link.source);
      if (!sourceNode) return;
      const effectiveHandle = resolveEdgeHandleType({
        sourceHandle: link.sourceHandle,
        targetHandle: link.targetHandle,
        sourceNodeType: sourceNode.type,
      });
      if (effectiveHandle === "image") {
        if (sourceNode.type === "imageInput") {
          const imageData = sourceNode.data as ImageInputNodeData;
          const assetUri =
            preferSeedanceAssetUri && imageData.assetAuditStatus === "active" && imageData.assetUri
              ? imageData.assetUri
              : null;
          const src = assetUri || imageData.image;
          if (src) images.push(src);
          if (src) {
            imageRefs.push({
              src,
              identityTag: imageData.identityTag,
              identityId: imageData.identityId,
            });
          }
        } else if (sourceNode.type === "annotation") {
          const src = (sourceNode.data as AnnotationNodeData).outputImage;
          if (src) images.push(src);
          if (src) imageRefs.push({ src });
        } else if (
          sourceNode.type === "imageGen" ||
          sourceNode.type === "nanoBananaImageGen" ||
          sourceNode.type === "wanImageGen"
        ) {
          const src = (sourceNode.data as ImageGenNodeData).outputImage;
          if (src) images.push(src);
          if (src) {
            imageRefs.push({
              src,
              identityTag: (sourceNode.data as ImageGenNodeData).identityTag,
              identityId: (sourceNode.data as ImageGenNodeData).identityId,
            });
          }
        }
      }
      if (effectiveHandle === "audio" && sourceNode.type === "audioInput") {
        const src = (sourceNode.data as AudioInputNodeData).audio;
        if (src) audios.push(src);
      }
      if (effectiveHandle === "video" && sourceNode.type === "videoInput") {
        const src = (sourceNode.data as VideoInputNodeData).video;
        if (src) videos.push(src);
      }
      if (effectiveHandle === "text") {
        if (sourceNode.type === "text") {
          const value = (sourceNode.data as TextNodeData).text;
          if (value && value.trim()) texts.push(value.trim());
          const ats = (sourceNode.data as TextNodeData).atMentions;
          const bindings = (sourceNode.data as TextNodeData).entityBindings;
          if (ats?.length) {
            ats.forEach((mention) => {
              if (!mentions.find((item) => item?.name === mention.name)) mentions.push(mention);
            });
          }
          if (bindings?.length) {
            bindings.forEach((binding) => {
              if (!entityBindings.find((item) => item.id === binding.id)) entityBindings.push(binding);
            });
          }
        } else if (sourceNode.type === "scriptBoard") {
          const value = buildScriptBoardText(sourceNode.data as ScriptBoardNodeData, nodeFlowContext.episodes || []);
          if (value) texts.push(value);
        } else if (sourceNode.type === "lookbook" || sourceNode.type === "identityCard") {
          const value = buildIdentityCardText(sourceNode.data as IdentityCardNodeData, nodeFlowContext);
          if (value) texts.push(value);
          const identities = buildProjectIdentities(nodeFlowContext.roles || [], nodeFlowContext.designAssets || []);
          const identity = resolveLegacyIdentity(identities, {
            identityId: (sourceNode.data as IdentityCardNodeData).identityId,
          });
          if (identity && !connectedIdentity) {
            connectedIdentity = {
              identityId: identity.id,
              mention: identity.mention,
              name: identity.name,
              description: identity.description,
              designPrompt: identity.designPrompt,
              primaryPortraitUrl: identity.primaryPortraitUrl || identity.avatarUrl,
            };
          }
        }
      }
    });

  return {
    images,
    audios,
    videos,
    text: texts.length ? texts.join("\n\n") : null,
    atMentions: mentions.length ? mentions : undefined,
    entityBindings: entityBindings.length ? entityBindings : undefined,
    imageRefs: imageRefs.length ? imageRefs : undefined,
    connectedIdentity,
  };
};

export const validateNodeFlowState = ({
  nodes,
  links,
}: {
  nodes: NodeFlowNode[];
  links: NodeFlowLink[];
}) => {
  const errors: string[] = [];

  const hasIncomingHandleType = (nodeId: string, expectedHandle: "image" | "text" | "audio" | "video") =>
    links
      .filter((link) => link.target === nodeId && !isFolderMembershipLink(link))
      .some((link) => {
        const sourceNode = nodes.find((node) => node.id === link.source);
        return (
          resolveEdgeHandleType({
            sourceHandle: link.sourceHandle,
            targetHandle: link.targetHandle,
            sourceNodeType: sourceNode?.type,
          }) === expectedHandle
        );
      });

  if (nodes.length === 0) {
    errors.push("Flow is empty");
    return { valid: false, errors };
  }

  nodes
    .filter((node) => node.type === "imageGen" || node.type === "nanoBananaImageGen" || node.type === "wanImageGen")
    .forEach((node) => {
      if (!hasIncomingHandleType(node.id, "text")) {
        errors.push(`ImageGen node "${node.id}" missing text input`);
      }
    });

  nodes
    .filter((node) => node.type === "seedanceVideoGen")
    .forEach((node) => {
      const edgeInputTypes = links
        .filter((link) => link.target === node.id && !isFolderMembershipLink(link))
        .map((link) => {
          const sourceNode = nodes.find((candidate) => candidate.id === link.source);
          return resolveEdgeHandleType({
            sourceHandle: link.sourceHandle,
            targetHandle: link.targetHandle,
            sourceNodeType: sourceNode?.type,
          });
        });
      const imageConnected = edgeInputTypes.includes("image");
      const videoConnected = edgeInputTypes.includes("video");
      const audioConnected = edgeInputTypes.includes("audio");
      const nodeData = node.data as any;
      const refs =
        (Array.isArray(nodeData.referenceVideos) ? nodeData.referenceVideos.length : 0) +
        (imageConnected ? 1 : 0) +
        (videoConnected ? 1 : 0);
      if (refs === 0) errors.push(`Seedance node "${node.id}" requires at least 1 reference image or video`);
      if (audioConnected && refs === 0) {
        errors.push(`Seedance node "${node.id}" cannot use audio alone without image/video references`);
      }
    });

  nodes
    .filter((node) => node.type === "wanReferenceVideoGen")
    .forEach((node) => {
      const nodeData = node.data as VideoGenNodeData;
      const refs = ((nodeData.referenceVideos || []).length + (nodeData.referenceImages || []).length);
      if (!hasIncomingHandleType(node.id, "text")) {
        errors.push(`Wan reference video node "${node.id}" missing text input`);
      }
      if (refs === 0 && !hasIncomingHandleType(node.id, "image") && !hasIncomingHandleType(node.id, "video")) {
        errors.push(`Wan reference video node "${node.id}" missing reference assets`);
      }
    });

  nodes
    .filter((node) => node.type === "annotation")
    .forEach((node) => {
      const imageConnected = links.some((link) => link.target === node.id);
      const hasManualImage = (node.data as AnnotationNodeData).sourceImage !== null;
      if (!imageConnected && !hasManualImage) {
        errors.push(`Annotation node "${node.id}" missing image input`);
      }
    });

  return { valid: errors.length === 0, errors };
};
