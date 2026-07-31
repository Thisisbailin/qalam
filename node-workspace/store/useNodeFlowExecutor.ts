import { captureNodeFlowAccountExecution, useNodeFlowStore } from "./nodeFlowStore";
import * as MultimodalService from "../../services/multimodalService";
import * as SeedanceVideoService from "../../services/seedanceVideoService";
import * as ViduService from "../../services/viduService";
import * as WuyinkejiService from "../../services/wuyinkejiService";
import * as SeedreamService from "../../services/seedreamService";
import * as WanService from "../../services/wanService";
import {
  INITIAL_VIDU_CONFIG,
  NANOBANANA_PRO_ENDPOINT,
  NANOBANANA_IDENTITY_PROMPT,
  NANOBANANA_PRO_MODEL,
  QWEN_WAN_IMAGE_ENDPOINT,
  QWEN_WAN_IMAGE_MODEL,
  QWEN_WAN_VIDEO_ENDPOINT,
  QWEN_WAN_REFERENCE_VIDEO_MODEL,
  SEEDANCE_DEFAULT_BASE_URL,
  SEEDANCE_DEFAULT_MODEL,
} from "../../constants";
import { useCallback } from "react";
import type { DesignAssetItem, ProjectRoleIdentity, SeedanceContentItem, SeedanceModel, ViduSubject } from "../../types";
import { buildApiUrl } from "../../utils/api";
import { buildAuthorizedJsonHeaders, captureApiAuthLease } from "../../utils/authToken";
import type { EntityBinding } from "../types";
import { applyRolePortraits } from "../../utils/projectRoles";

type MentionData = {
  name: string;
  status: "match" | "missing";
  kind?: "identity" | "unknown";
  identityId?: string;
  portraitId?: string;
  mention?: string;
  aliasValue?: string;
};

type ProjectReferenceTargetData = {
  category: "identity";
  refId: string;
  label?: string;
};

type ProjectReferenceAsset = {
  category: "identity";
  refId: string;
  label: string;
  url: string;
  createdAt: number;
};

type BoundIdentityRef = {
  rawText: string;
  identityId: string;
  portraitId?: string;
  mention: string;
};

const parseAtMentions = (text: string): string[] => {
  const matches = text.match(/@([\w\u4e00-\u9fa5\-\/]+)/g) || [];
  const names = matches.map((m) => m.slice(1));
  const unique: string[] = [];
  names.forEach((n) => {
    if (!unique.includes(n)) unique.push(n);
  });
  return unique;
};

const escapeRegex = (str: string) => str.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

const captureExecutorLease = () => {
  const nodeFlow = captureNodeFlowAccountExecution();
  const auth = captureApiAuthLease();
  const signal = AbortSignal.any([nodeFlow.signal, auth.signal]);
  return {
    accountGeneration: nodeFlow.accountGeneration,
    projectId: nodeFlow.projectId,
    authGeneration: auth.generation,
    signal,
    isCurrent: () => nodeFlow.isCurrent() && auth.isCurrent() && !signal.aborted,
    assertCurrent: () => {
      nodeFlow.assertCurrent();
      auth.assertCurrent();
      if (signal.aborted) throw signal.reason;
    },
  };
};

type ExecutorLease = ReturnType<typeof captureExecutorLease>;

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(signal?.reason);
    return;
  }
  const onAbort = () => {
    window.clearTimeout(timer);
    reject(signal?.reason);
  };
  const timer = window.setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  signal?.addEventListener("abort", onAbort, { once: true });
});

const getViduStateLabel = (state?: string) => {
  const normalized = (state || "").toLowerCase();
  if (normalized.includes("success") || normalized.includes("succeed") || normalized.includes("complete")) return "生成完成";
  if (normalized.includes("fail") || normalized.includes("error")) return "生成失败";
  if (normalized.includes("cancel")) return "已取消";
  if (normalized.includes("queue") || normalized.includes("schedule") || normalized.includes("pending") || normalized.includes("wait")) return "排队中";
  if (normalized.includes("create") || normalized.includes("submit")) return "已提交";
  if (normalized.includes("process") || normalized.includes("run") || normalized.includes("generat")) return "生成中";
  return "处理中";
};

const VIDU_PROCESSING_TIMEOUT_MS = 30 * 60 * 1000;
const VIDU_PROCESSING_PROGRESS_ESTIMATE_MS = 10 * 60 * 1000;

const getViduPollDelayMs = (state?: string) => {
  const normalized = (state || "").toLowerCase();
  if (normalized.includes("success") || normalized.includes("fail") || normalized.includes("cancel")) return 0;
  if (normalized.includes("process") || normalized.includes("run") || normalized.includes("generat")) return 4500;
  if (normalized.includes("queue") || normalized.includes("schedule") || normalized.includes("pending") || normalized.includes("wait")) return 3500;
  return 3000;
};

const getViduProgressSnapshot = (options: {
  state?: string;
  processingElapsedMs: number;
}) => {
  const label = getViduStateLabel(options.state);
  const normalized = (options.state || "").toLowerCase();

  if (normalized.includes("success") || normalized.includes("succeed") || normalized.includes("complete")) {
    return {
      progressPercent: 100,
      progressLabel: "生成完成",
      progressHint: "Vidu 已返回最终视频结果。",
      taskState: options.state || "success",
    };
  }

  if (normalized.includes("fail") || normalized.includes("error")) {
    return {
      progressPercent: 100,
      progressLabel: "生成失败",
      progressHint: "Vidu 已返回失败状态。",
      taskState: options.state || "failed",
    };
  }

  if (normalized.includes("queue") || normalized.includes("schedule") || normalized.includes("pending") || normalized.includes("wait") || normalized.includes("create") || normalized.includes("submit")) {
    return {
      progressPercent: null,
      progressLabel: "排队中...",
      progressHint: "当前阶段没有可用的官方百分比进度；错峰模式会在算力空闲后开始生成，排队时间不计入超时。",
      taskState: options.state || "scheduled",
    };
  }

  const workRatio = Math.max(0, Math.min(1, options.processingElapsedMs / VIDU_PROCESSING_PROGRESS_ESTIMATE_MS));
  return {
    progressPercent: Math.max(4, Math.min(95, Math.round(4 + workRatio * 91))),
    progressLabel: label,
    progressHint: "当前接口只返回任务状态，不返回精确百分比；这里按 10 分钟生成时长做阶段性估算。",
    taskState: options.state || "processing",
  };
};

const formatDurationMs = (ms: number) => {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
};

const isProcessingTaskState = (state?: string | null) => {
  const normalized = (state || "").toLowerCase();
  return (
    normalized.includes("process") ||
    normalized.includes("run") ||
    normalized.includes("generat")
  );
};

const buildViduNonSubjectPrompt = (prompt: string, imageCount: number) => {
  if (imageCount <= 0) return prompt;
  const imageRefs = Array.from({ length: imageCount }, (_, index) => `图${index + 1}=第${index + 1}张输入参考图`).join("，");
  const prefix = `参考图顺序说明：${imageRefs}。若提示词中提到“图1 / 图2 / 图3”等编号，请按对应输入顺序理解，不要互换。`;
  return `${prefix}\n\n${prompt}`;
};

const parseWanReferenceVoiceTarget = (value: unknown) => {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(video|image):(\d+)$/);
  if (!match) return null;
  const index = Number.parseInt(match[2], 10);
  if (!Number.isFinite(index) || index < 1) return null;
  return {
    kind: match[1] as "video" | "image",
    index,
  };
};

const uploadReferenceFile = async (
  source: string,
  options: { bucket?: string; prefix?: string } | undefined,
  execution: ExecutorLease
) => {
  execution.assertCurrent();
  if (!execution.projectId) throw new Error("当前节点执行未绑定云端项目。");
  const response = await fetch(source, { signal: execution.signal });
  const blob = await response.blob();
  const contentType = blob.type || "image/png";
  const ext = contentType.split("/")[1] || "png";
  const fileName = `${options?.prefix || "wan-inputs/"}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const bucket = options?.bucket || "assets";

  const signedRes = await fetch(buildApiUrl("/api/upload-url"), {
    method: "POST",
    headers: await buildAuthorizedJsonHeaders(undefined, execution.authGeneration),
    body: JSON.stringify({
      projectId: execution.projectId,
      fileName,
      bucket,
      contentType,
      fileSize: blob.size,
    }),
    signal: execution.signal,
  });
  if (!signedRes.ok) {
    const err = await signedRes.text();
    throw new Error(`Reference upload URL error (${signedRes.status}): ${err}`);
  }
  const signedData = await signedRes.json() as {
    signedUrl?: string;
    publicUrl?: string;
    path?: string;
    bucket?: string;
  };
  if (!signedData?.signedUrl) {
    throw new Error("Reference upload failed: missing signedUrl.");
  }

  const uploadRes = await fetch(signedData.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
    signal: execution.signal,
  });
  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Reference upload failed (${uploadRes.status}): ${err}`);
  }

  if (signedData.publicUrl) return signedData.publicUrl as string;
  if (signedData.path) {
    const downloadRes = await fetch(buildApiUrl("/api/download-url"), {
      method: "POST",
      headers: await buildAuthorizedJsonHeaders(undefined, execution.authGeneration),
      body: JSON.stringify({
        projectId: execution.projectId,
        path: signedData.path,
        bucket: signedData.bucket || bucket,
      }),
      signal: execution.signal,
    });
    if (!downloadRes.ok) {
      const err = await downloadRes.text();
      throw new Error(`Reference download URL error (${downloadRes.status}): ${err}`);
    }
    const downloadData = await downloadRes.json() as { signedUrl?: string };
    if (downloadData?.signedUrl) return downloadData.signedUrl as string;
  }

  throw new Error("Reference upload failed: no accessible URL returned.");
};

const normalizeWanImages = async (sources: string[], execution: ExecutorLease) => {
  const results: string[] = [];
  for (const src of sources) {
    if (!src) continue;
    if (src.startsWith("http://") || src.startsWith("https://")) {
      results.push(src);
      continue;
    }
    if (src.startsWith("data:") || src.startsWith("blob:")) {
      const uploaded = await uploadReferenceFile(src, { bucket: "assets", prefix: "wan-inputs/" }, execution);
      results.push(uploaded);
      continue;
    }
    results.push(src);
  }
  return results;
};

const normalizeWanAudio = async (source: string | undefined, execution: ExecutorLease) => {
  if (!source) return undefined;
  if (source.startsWith("http://") || source.startsWith("https://")) return source;
  if (source.startsWith("data:") || source.startsWith("blob:")) {
    return uploadReferenceFile(source, { bucket: "assets", prefix: "wan-audio/" }, execution);
  }
  try {
    const downloadRes = await fetch(buildApiUrl("/api/download-url"), {
      method: "POST",
      headers: await buildAuthorizedJsonHeaders(undefined, execution.authGeneration),
      body: JSON.stringify({ projectId: execution.projectId, path: source, bucket: "assets" }),
      signal: execution.signal,
    });
    if (!downloadRes.ok) {
      const err = await downloadRes.text();
      throw new Error(err);
    }
    const data = await downloadRes.json() as { signedUrl?: string };
    if (data?.signedUrl) return data.signedUrl as string;
  } catch (e) {
    if (execution.signal.aborted) throw execution.signal.reason;
    console.warn("Failed to resolve audio URL", e);
  }
  return source;
};

const normalizeWanReferenceVideos = async (sources: string[], execution: ExecutorLease) => {
  const results: string[] = [];
  for (const src of sources) {
    if (!src) continue;
    if (src.startsWith("http://") || src.startsWith("https://")) {
      results.push(src);
      continue;
    }
    if (src.startsWith("data:") || src.startsWith("blob:")) {
      const uploaded = await uploadReferenceFile(src, { bucket: "assets", prefix: "wan-reference-video/" }, execution);
      results.push(uploaded);
      continue;
    }
    results.push(src);
  }
  return results;
};

const normalizeSeedanceVideos = async (sources: string[], execution: ExecutorLease) => {
  const results: string[] = [];
  for (const src of sources) {
    if (!src) continue;
    if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("asset://")) {
      results.push(src);
      continue;
    }
    if (src.startsWith("data:") || src.startsWith("blob:")) {
      results.push(await uploadReferenceFile(src, { bucket: "assets", prefix: "seedance-reference-video/" }, execution));
      continue;
    }
    results.push(src);
  }
  return results;
};

const normalizeSeedanceImages = async (sources: string[], execution: ExecutorLease) => {
  const results: string[] = [];
  for (const src of sources) {
    if (!src) continue;
    if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("asset://")) {
      results.push(src);
      continue;
    }
    if (src.startsWith("data:") || src.startsWith("blob:")) {
      results.push(await uploadReferenceFile(src, { bucket: "assets", prefix: "seedance-reference-image/" }, execution));
      continue;
    }
    try {
      const downloadRes = await fetch(buildApiUrl("/api/download-url"), {
        method: "POST",
        headers: await buildAuthorizedJsonHeaders(undefined, execution.authGeneration),
        body: JSON.stringify({ projectId: execution.projectId, path: src, bucket: "assets" }),
        signal: execution.signal,
      });
      if (downloadRes.ok) {
        const downloadData = await downloadRes.json() as { signedUrl?: string };
        if (downloadData?.signedUrl) {
          results.push(downloadData.signedUrl as string);
          continue;
        }
      }
    } catch (e) {
      if (execution.signal.aborted) throw execution.signal.reason;
      console.warn("Failed to resolve Seedance image URL", e);
    }
    results.push(src);
  }
  return results;
};

const normalizeSeedanceAudios = async (sources: string[], execution: ExecutorLease) => {
  const results: string[] = [];
  for (const src of sources) {
    if (!src) continue;
    if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("asset://")) {
      results.push(src);
      continue;
    }
    if (src.startsWith("data:audio/") || src.startsWith("blob:")) {
      results.push(await uploadReferenceFile(src, { bucket: "assets", prefix: "seedance-reference-audio/" }, execution));
      continue;
    }
    try {
      const downloadRes = await fetch(buildApiUrl("/api/download-url"), {
        method: "POST",
        headers: await buildAuthorizedJsonHeaders(undefined, execution.authGeneration),
        body: JSON.stringify({ projectId: execution.projectId, path: src, bucket: "assets" }),
        signal: execution.signal,
      });
      if (downloadRes.ok) {
        const downloadData = await downloadRes.json() as { signedUrl?: string };
        if (downloadData?.signedUrl) {
          results.push(downloadData.signedUrl as string);
          continue;
        }
      }
    } catch (e) {
      if (execution.signal.aborted) throw execution.signal.reason;
      console.warn("Failed to resolve Seedance audio URL", e);
    }
    results.push(src);
  }
  return results;
};

const normalizeViduImages = async (sources: string[], execution: ExecutorLease) => {
  const results: string[] = [];
  for (const src of sources) {
    if (!src) continue;
    if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("asset://")) {
      results.push(src);
      continue;
    }
    if (src.startsWith("data:") || src.startsWith("blob:")) {
      results.push(await uploadReferenceFile(src, { bucket: "assets", prefix: "vidu-reference-image/" }, execution));
      continue;
    }
    try {
      const downloadRes = await fetch(buildApiUrl("/api/download-url"), {
        method: "POST",
        headers: await buildAuthorizedJsonHeaders(undefined, execution.authGeneration),
        body: JSON.stringify({ projectId: execution.projectId, path: src, bucket: "assets" }),
        signal: execution.signal,
      });
      if (downloadRes.ok) {
        const downloadData = await downloadRes.json() as { signedUrl?: string };
        if (downloadData?.signedUrl) {
          results.push(downloadData.signedUrl as string);
          continue;
        }
      }
    } catch (e) {
      if (execution.signal.aborted) throw execution.signal.reason;
      console.warn("Failed to resolve Vidu image URL", e);
    }
    results.push(src);
  }
  return results;
};

const normalizeViduVideos = async (sources: string[], execution: ExecutorLease) => {
  const results: string[] = [];
  for (const src of sources) {
    if (!src) continue;
    if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("asset://")) {
      results.push(src);
      continue;
    }
    if (src.startsWith("data:") || src.startsWith("blob:")) {
      results.push(await uploadReferenceFile(src, { bucket: "assets", prefix: "vidu-reference-video/" }, execution));
      continue;
    }
    try {
      const downloadRes = await fetch(buildApiUrl("/api/download-url"), {
        method: "POST",
        headers: await buildAuthorizedJsonHeaders(undefined, execution.authGeneration),
        body: JSON.stringify({ projectId: execution.projectId, path: src, bucket: "assets" }),
        signal: execution.signal,
      });
      if (downloadRes.ok) {
        const downloadData = await downloadRes.json() as { signedUrl?: string };
        if (downloadData?.signedUrl) {
          results.push(downloadData.signedUrl as string);
          continue;
        }
      }
    } catch (e) {
      if (execution.signal.aborted) throw execution.signal.reason;
      console.warn("Failed to resolve Vidu video URL", e);
    }
    results.push(src);
  }
  return results;
};

const mapWanVideoSize = (aspectRatio?: string, resolution?: string) => {
  const ratio = (aspectRatio || "16:9").trim();
  const res = (resolution || "720P").toUpperCase();
  const sizeMap: Record<string, Record<string, string>> = {
    "480P": {
      "16:9": "832*480",
      "9:16": "480*832",
      "1:1": "624*624",
    },
    "720P": {
      "16:9": "1280*720",
      "9:16": "720*1280",
      "1:1": "960*960",
      "4:3": "1088*832",
      "3:4": "832*1088",
    },
    "1080P": {
      "16:9": "1920*1080",
      "9:16": "1080*1920",
      "1:1": "1440*1440",
      "4:3": "1632*1248",
      "3:4": "1248*1632",
    },
  };
  const normalizedRatio = ["16:9", "9:16", "1:1", "4:3", "3:4"].includes(ratio) ? ratio : "16:9";
  return sizeMap[res]?.[normalizedRatio] || "1280*720";
};

const makeProjectRefKey = (category: "identity", refId: string) => `${category}:${refId}`;
const makeRoleRefId = (roleId: string) => roleId;
const makePortraitRefId = (portraitId: string) => `portrait:${portraitId}`;

const buildProjectReferenceIndex = (roles: ProjectRoleIdentity[], designAssets: DesignAssetItem[]) => {
  const latestByKey = new Map<string, ProjectReferenceAsset>();
  roles.forEach((role) => {
    const primaryPortrait = role.portraits?.find((portrait) => portrait.isPrimary) || role.portraits?.[0];
    if (primaryPortrait?.imageUrl) {
      latestByKey.set(makeProjectRefKey("identity", makeRoleRefId(role.id)), {
        category: "identity",
        refId: makeRoleRefId(role.id),
        label: `@${role.mention}`,
        url: primaryPortrait.imageUrl,
        createdAt: primaryPortrait.createdAt || 0,
      });
    }
    (role.portraits || []).forEach((portrait) => {
      if (!portrait.imageUrl) return;
      latestByKey.set(makeProjectRefKey("identity", makePortraitRefId(portrait.id)), {
        category: "identity",
        refId: makePortraitRefId(portrait.id),
        label: `@${portrait.mention}`,
        url: portrait.imageUrl,
        createdAt: portrait.createdAt || 0,
      });
    });
  });
  designAssets.forEach((asset) => {
    if (!asset?.url || !asset?.refId) return;
    const key = makeProjectRefKey(asset.category, asset.refId);
    const current = latestByKey.get(key);
    if (!current || (asset.createdAt || 0) >= current.createdAt) {
      latestByKey.set(key, {
        category: asset.category,
        refId: asset.refId,
        label: asset.label || asset.refId,
        url: asset.url,
        createdAt: asset.createdAt || 0,
      });
    }
  });
  return latestByKey;
};

const resolveMentionReferenceAsset = (
  mention: MentionData | EntityBinding,
  roles: ProjectRoleIdentity[],
  latestByKey: Map<string, ProjectReferenceAsset>
) => {
  const identityId = "entityType" in mention ? mention.identityId : mention.identityId;
  const portraitId = "entityType" in mention ? mention.portraitId : mention.portraitId;
  if (portraitId) {
    const exactPortrait = latestByKey.get(makeProjectRefKey("identity", makePortraitRefId(portraitId)));
    if (exactPortrait) return exactPortrait;
  }
  if (identityId) {
    const exact = latestByKey.get(makeProjectRefKey("identity", makeRoleRefId(identityId)));
    if (exact) return exact;
  }

  const fallbackMention = (("mention" in mention ? mention.mention : undefined) || ("name" in mention ? mention.name : mention.rawText.replace(/^@/, "")) || "").replace(/^@/, "").toLowerCase();
  if (!fallbackMention) return undefined;
  const role = roles.find((item) => {
    if (item.mention.toLowerCase() === fallbackMention) return true;
    if (item.name.toLowerCase() === fallbackMention) return true;
    return (item.portraits || []).some((portrait) => portrait.mention.toLowerCase() === fallbackMention);
  });
  if (role) {
    const portrait = (role.portraits || []).find((item) => item.mention.toLowerCase() === fallbackMention);
    if (portrait) {
      const exactPortrait = latestByKey.get(makeProjectRefKey("identity", makePortraitRefId(portrait.id)));
      if (exactPortrait) return exactPortrait;
    }
    const exact = latestByKey.get(makeProjectRefKey("identity", makeRoleRefId(role.id)));
    if (exact) return exact;
  }
  return Array.from(latestByKey.values()).find((asset) => asset.label.toLowerCase().includes(fallbackMention));
};

const resolvePromptProjectReferences = (
  prompt: string,
  atMentions: MentionData[] | undefined,
  entityBindings: EntityBinding[] | undefined,
  roles: ProjectRoleIdentity[],
  latestByKey: Map<string, ProjectReferenceAsset>
) => {
  const refs: ProjectReferenceAsset[] = [];
  const slotByKey = new Map<string, number>();
  const replacements: Array<{ rawText: string; refKey: string }> = [];

  const candidates = (entityBindings?.length
    ? entityBindings.filter((binding) => binding.status === "resolved" && binding.entityType === "identity")
    : (atMentions || []).filter((mention) => mention.status === "match" && mention.kind === "identity")) as Array<MentionData | EntityBinding>;

  candidates
    .forEach((mention) => {
      const candidate = resolveMentionReferenceAsset(mention, roles, latestByKey);
      if (!candidate) return;
      const key = makeProjectRefKey(candidate.category, candidate.refId);
      let slot = slotByKey.get(key);
      if (!slot) {
        refs.push(candidate);
        slot = refs.length;
        slotByKey.set(key, slot);
      }
      const rawText = "rawText" in mention ? mention.rawText : `@${mention.name}`;
      replacements.push({ rawText, refKey: key });
    });

  return { refs, replacements };
};

const rewriteWanReferencePrompt = (
  prompt: string,
  options: {
    replacements?: Array<{ rawText: string; refKey: string }>;
    imageSlotByRefKey?: Map<string, number>;
    imageCount: number;
    videoCount: number;
  }
) => {
  let rewrittenPrompt = prompt;
  (options.replacements || []).forEach((item) => {
    const imageIndex = options.imageSlotByRefKey?.get(item.refKey);
    if (!imageIndex) return;
    rewrittenPrompt = rewrittenPrompt.replace(new RegExp(escapeRegex(item.rawText), "g"), `图片${imageIndex}`);
  });

  const referenceHints: string[] = [];
  if (options.videoCount > 0) {
    referenceHints.push(`视频参考按输入顺序编号为 视频1${options.videoCount > 1 ? ` 到 视频${options.videoCount}` : ""}`);
  }
  if (options.imageCount > 0) {
    referenceHints.push(`图片参考按输入顺序编号为 图片1${options.imageCount > 1 ? ` 到 图片${options.imageCount}` : ""}`);
  }
  if (!referenceHints.length) return rewrittenPrompt;
  return `参考素材编号规则：${referenceHints.join("；")}。若提示词提到“图片1 / 视频1”等编号，请严格按对应输入顺序理解。\n\n${rewrittenPrompt}`;
};

const resolveBoundIdentities = (
  entityBindings: EntityBinding[] | undefined,
  atMentions: MentionData[] | undefined
): BoundIdentityRef[] => {
  const resolved: BoundIdentityRef[] = [];
  const pushUnique = (item: BoundIdentityRef | null | undefined) => {
    if (!item) return;
    if (
      resolved.find(
        (entry) =>
          entry.identityId === item.identityId &&
          (entry.portraitId || "") === (item.portraitId || "") &&
          entry.mention === item.mention
      )
    ) {
      return;
    }
    resolved.push(item);
  };

  (entityBindings || []).forEach((binding) => {
    if (binding.status !== "resolved") return;
    if (binding.entityType === "identity" && binding.identityId) {
      pushUnique({
        rawText: binding.rawText,
        identityId: binding.identityId,
        portraitId: binding.portraitId,
        mention: binding.mention || binding.rawText.replace(/^@/, ""),
      });
    }
  });

  if (resolved.length) return resolved;

  (atMentions || []).forEach((mention) => {
    if (mention.status !== "match" || mention.kind !== "identity" || !mention.identityId) return;
    pushUnique({
      rawText: `@${mention.name}`,
      identityId: mention.identityId,
      portraitId: mention.portraitId,
      mention: mention.mention || mention.name,
    });
  });

  return resolved;
};

const upsertPrimaryPortrait = (role: ProjectRoleIdentity, imageUrl: string): ProjectRoleIdentity => {
  const portraits = [...(role.portraits || [])];
  const primaryIndex = portraits.findIndex((portrait) => portrait.isPrimary);
  const normalIndex = portraits.findIndex((portrait) => (portrait.name || "").toLowerCase() === "normal");
  const targetIndex = primaryIndex >= 0 ? primaryIndex : normalIndex;

  if (targetIndex >= 0) {
    portraits[targetIndex] = {
      ...portraits[targetIndex],
      imageUrl,
      isPrimary: true,
      summary: portraits[targetIndex].summary || "Nano Banana 自动生成定妆照",
    };
  } else {
    portraits.unshift({
      id: `portrait-${Date.now()}`,
      name: "normal",
      mention: `${role.mention}_normal`,
      imageUrl,
      createdAt: Date.now(),
      isPrimary: true,
      summary: "Nano Banana 自动生成定妆照",
    });
  }

  return applyRolePortraits(role, portraits);
};

const buildImageVersionHistory = (
  currentImage: string | null | undefined,
  nextImage: string | null | undefined,
  currentHistory: Array<{ id: string; src: string; createdAt: number }> | undefined
) => {
  const normalizedHistory = Array.isArray(currentHistory) ? currentHistory : [];
  const dedupedHistory = normalizedHistory.filter((item) => item?.src && item.src !== nextImage);

  if (!currentImage || currentImage === nextImage) {
    return dedupedHistory.slice(0, 12);
  }

  return [
    {
      id: `imgver-${Date.now()}`,
      src: currentImage,
      createdAt: Date.now(),
    },
    ...dedupedHistory.filter((item) => item.src !== currentImage),
  ].slice(0, 12);
};

const EXECUTOR_MUTATING_STORE_METHODS = new Set<PropertyKey>([
  "updateNodeData",
  "addToGlobalHistory",
  "mutateProjectRole",
  "clearExecutionApproval",
]);

const createAccountScopedExecutorStore = (execution: ExecutorLease) => {
  const snapshot = useNodeFlowStore.getState();
  const isCurrent = execution.isCurrent;

  return new Proxy(snapshot, {
    get(target, property) {
      const snapshotValue = Reflect.get(target, property);
      if (typeof snapshotValue !== "function") return snapshotValue;

      return (...args: unknown[]) => {
        if (!isCurrent()) return undefined;
        const currentValue = Reflect.get(useNodeFlowStore.getState(), property);
        if (typeof currentValue !== "function") return undefined;
        if (EXECUTOR_MUTATING_STORE_METHODS.has(property) && !isCurrent()) return undefined;
        return currentValue(...args);
      };
    },
  });
};

export const useNodeFlowExecutor = () => {
  const store = useNodeFlowStore();
  const config = store.appConfig;

  const extractImageUrl = (content: string): string | null => {
    const match = content.match(/!\[[^\]]*\]\(([^)]+)\)/);
    return match ? match[1] : null;
  };

  const executeImageGen = useCallback(async (nodeId: string) => {
    const execution = captureExecutorLease();
    const store = createAccountScopedExecutorStore(execution);
    const node = store.getNodeById(nodeId);
    if (!node) return;
    const { images, text: connectedText, atMentions, entityBindings, imageRefs, connectedIdentity } = store.getConnectedInputs(nodeId);
    const data = node.data as any; // Cast for easier access to new fields
    const text = (connectedText || "").trim();
    const isNanoBananaNode = node.type === "nanoBananaImageGen";
    const isWanImageNode = node.type === "wanImageGen";
    const activeIdentityId = connectedIdentity?.identityId || data.identityId;
    const activeIdentityMention = connectedIdentity?.mention || data.identityTag;
    const fixedIdentityPrompt = isNanoBananaNode && connectedIdentity
      ? NANOBANANA_IDENTITY_PROMPT
      : "";
    const finalPrompt = [fixedIdentityPrompt, text].filter(Boolean).join("\n\n").trim();

    if (!finalPrompt && images.length === 0) {
      store.updateNodeData(nodeId, { status: "error", error: "Missing text input (connect a text node)." });
      return;
    }

    if (!config) {
      store.updateNodeData(nodeId, { status: "error", error: "Configuration not loaded." });
      return;
    }

    const taskRequestedAt = Date.now();
    store.updateNodeData(nodeId, {
      status: "loading",
      error: null,
      progressPercent: null,
      progressLabel: null,
      progressHint: null,
      taskState: "submitting",
      taskRequestedAt,
      taskSubmittedAt: null,
      processingStartedAt: null,
      taskCompletedAt: null,
    });
    try {
      const aspectRatio = data.aspectRatio || "1:1";
      const modelOverride = isNanoBananaNode
        ? NANOBANANA_PRO_MODEL
        : isWanImageNode
          ? QWEN_WAN_IMAGE_MODEL
          : data.model;

      // Use node-specific model or fallback to config
      const configToUse = {
        ...config.multimodalConfig,
        model: modelOverride || config.multimodalConfig.model
      };
      if (isNanoBananaNode) {
        configToUse.provider = "nanobanana";
        configToUse.baseUrl = NANOBANANA_PRO_ENDPOINT;
      }
      if (isWanImageNode) {
        configToUse.provider = "wan";
        configToUse.baseUrl = QWEN_WAN_IMAGE_ENDPOINT;
        configToUse.apiKey = "";
      }

      if (configToUse.provider === 'wuyinkeji' || configToUse.provider === 'nanobanana') {
        const refImage = images.find((src) => src.startsWith("http")) || connectedIdentity?.primaryPortraitUrl || undefined;
        const { id } = await WuyinkejiService.submitImageTask(finalPrompt || "Generate an image", configToUse, {
          aspectRatio,
          inputImageUrl: refImage,
          size: data.size,
          signal: execution.signal,
        });
        let processingStartedAt: number | null = null;
        const taskSubmittedAt = Date.now();

        store.updateNodeData(nodeId, {
          status: "loading",
          taskId: id,
          error: null,
          taskRequestedAt,
          taskSubmittedAt,
          processingStartedAt: null,
          taskCompletedAt: null,
          taskState: "queued",
        });

        const maxAttempts = 60;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          const result = await WuyinkejiService.checkImageTaskStatus(id, configToUse, execution.signal);
          if (!processingStartedAt && result.status === "processing") {
            processingStartedAt = Date.now();
          }
          if (result.status === "succeeded") {
            const nextVersionHistory = buildImageVersionHistory(
              data.outputImage,
              result.url,
              data.versionHistory
            );
            store.updateNodeData(nodeId, {
              status: "complete",
              outputImage: result.url,
              versionHistory: nextVersionHistory,
              error: null,
              model: configToUse.model,
              taskRequestedAt,
              taskSubmittedAt,
              processingStartedAt,
              taskCompletedAt: Date.now(),
              taskState: "succeeded",
              identityId: activeIdentityId,
              identityTag: activeIdentityMention,
              designCategory: activeIdentityId ? "identity" : data.designCategory,
              designRefId: activeIdentityId || data.designRefId,
            });

            if (isNanoBananaNode && activeIdentityId && result.url) {
              store.mutateProjectRole(activeIdentityId, (role) => upsertPrimaryPortrait(role, result.url!));
            }

            // Add to global history for reuse
            store.addToGlobalHistory({
              type: "image",
              src: result.url!,
              prompt: finalPrompt || "Image Input",
              model: configToUse.model,
              aspectRatio
            });
            return;
          }
          if (result.status === "failed") {
            store.updateNodeData(nodeId, {
              status: "error",
              error: result.errorMsg || "Image generation failed.",
              taskRequestedAt,
              taskSubmittedAt,
              processingStartedAt,
              taskCompletedAt: Date.now(),
              taskState: "failed",
            });
            return;
          }
          store.updateNodeData(nodeId, {
            status: "loading",
            error: null,
            taskRequestedAt,
            taskSubmittedAt,
            processingStartedAt,
            taskCompletedAt: null,
            taskState: result.status,
          });
          // Wait 5 seconds between polls
          await wait(5000, execution.signal);
        }

        store.updateNodeData(nodeId, {
          status: "error",
          error: "Image generation timed out.",
          taskRequestedAt,
          taskSubmittedAt,
          processingStartedAt,
          taskCompletedAt: Date.now(),
          taskState: processingStartedAt ? "processing" : "queued",
        });
        return;
      }

      if (configToUse.provider === 'seedream') {
        const refImage = images.find((src) => src.startsWith("http")) || undefined;
        store.updateNodeData(nodeId, { status: "loading", error: null });

        try {
          const url = await SeedreamService.generateSeedreamImage(text || "Generate an image", configToUse, {
            aspectRatio,
            inputImageUrl: refImage,
            signal: execution.signal,
          });

          store.updateNodeData(nodeId, {
            status: "complete",
            outputImage: url,
            error: null,
            model: configToUse.model
          });

          store.addToGlobalHistory({
            type: "image",
            src: url,
            prompt: text || "Image Input",
            model: configToUse.model,
            aspectRatio
          });
    } catch (e: any) {
      store.updateNodeData(nodeId, {
        status: "error",
        error: e.message || "Seedream generation failed.",
        taskCompletedAt: Date.now(),
      });
    }
    return;
  }

      if (configToUse.provider === 'wan') {
        if (!text) {
          store.updateNodeData(nodeId, { status: "error", error: "Wan 图片需要提示词。" });
          return;
        }
        const normalizedImages = await normalizeWanImages(images, execution);
        const { id, url } = await WanService.submitWanImageTask(text || "Generate an image", configToUse, {
          aspectRatio,
          inputImages: normalizedImages,
          enableInterleave: data.enableInterleave,
          outputCount: data.outputCount,
          maxImages: data.maxImages,
          seed: data.seed,
          watermark: data.watermark,
          size: data.size,
          signal: execution.signal,
        });

        if (url) {
          store.updateNodeData(nodeId, {
            status: "complete",
            outputImage: url,
            error: null,
            model: configToUse.model,
          });
          store.addToGlobalHistory({
            type: "image",
            src: url,
            prompt: text || "Image Input",
            model: configToUse.model,
            aspectRatio,
          });
          return;
        }

        if (!id) {
          store.updateNodeData(nodeId, { status: "error", error: "Wan 任务创建失败。" });
          return;
        }

        store.updateNodeData(nodeId, { status: "loading", taskId: id, error: null });

        const maxAttempts = 60;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          const result = await WanService.checkWanTaskStatus(id, configToUse.apiKey, execution.signal);
          if (result.status === "succeeded") {
            store.updateNodeData(nodeId, {
              status: "complete",
              outputImage: result.url,
              error: null,
              model: configToUse.model,
            });
            if (result.url) {
              store.addToGlobalHistory({
                type: "image",
                src: result.url,
                prompt: text || "Image Input",
                model: configToUse.model,
                aspectRatio,
              });
            }
            return;
          }
          if (result.status === "failed") {
            store.updateNodeData(nodeId, { status: "error", error: result.errorMsg || "Wan 图像生成失败。" });
            return;
          }
          await wait(15000, execution.signal);
        }

        store.updateNodeData(nodeId, { status: "error", error: "Wan 图像生成超时。" });
        return;
      }

      // --- Standard Flow (OpenAI compatible) ---
      let promptContent = text || "Generate an image based on the input";

      // Removed Style Preset injection as per user request for clean multimodal prompts
      promptContent = `${promptContent}\n\n[Aspect Ratio]: ${aspectRatio}`;

      if (images.length > 0) {
        const refs = images.map((img: string, i: number) => `![ref ${i}](${img})`).join('\n');
        promptContent = `${promptContent}\n\n${refs}`;
      }

      const res = await MultimodalService.sendMessage(
        [{ role: "user", content: promptContent }],
        configToUse,
        execution.signal
      );

      const url = extractImageUrl(res.content) || res.content.trim();

      // Basic validation if it's a URL or base64
      if (!url || (!url.startsWith('http') && !url.startsWith('data:image'))) {
        throw new Error("No image URL could be extracted from response. Response was: " + res.content.substring(0, 100));
      }

      store.updateNodeData(nodeId, {
        status: "complete",
        outputImage: url,
        error: null,
        model: configToUse.model // store used model for reference
      });

      // Add to global history for reuse
      store.addToGlobalHistory({
        type: "image",
        src: url,
        prompt: text || "Image Input",
        model: configToUse.model,
        aspectRatio
      });

    } catch (e: any) {
      store.updateNodeData(nodeId, { status: "error", error: e.message || "Image gen failed" });
    }
  }, [config?.multimodalConfig, store]);

  const runViduVideoGen = useCallback(async (nodeId: string) => {
    const execution = captureExecutorLease();
    const store = createAccountScopedExecutorStore(execution);
    const node = store.getNodeById(nodeId);
    if (!node || !config) return;
    const { images, text: connectedText, atMentions, entityBindings, imageRefs } = store.getConnectedInputs(nodeId);
    const data = node.data as any;
    const prompt = (connectedText || "").trim();

    if (!prompt) {
      store.updateNodeData(nodeId, { status: "error", error: "Missing text input (connect a text node)." });
      return;
    }

    const viduConfig = {
      ...(config.viduConfig || INITIAL_VIDU_CONFIG),
      baseUrl: config.viduConfig?.baseUrl || INITIAL_VIDU_CONFIG.baseUrl,
      defaultModel: config.viduConfig?.defaultModel || INITIAL_VIDU_CONFIG.defaultModel || "viduq3",
    };
    const model = data.model || viduConfig.defaultModel || "viduq3";
    const requestedMode =
      data.mode === "audioVideo"
        ? "subject"
        : data.mode === "videoOnly"
          ? "nonSubject"
          : (data.mode || "subject");
    const normalizedMode = model === "viduq3-mix" ? "nonSubject" : requestedMode;
    const useCharacters = data.useCharacters !== false;
    const audioEnabled = data.audioEnabled !== false;

    const resolvedIdentities = resolveBoundIdentities(entityBindings, atMentions as MentionData[] | undefined);
    const mentions = resolvedIdentities.length ? resolvedIdentities.map((item) => item.mention) : parseAtMentions(prompt);
    const resolvedIdentityByMention = new Map(resolvedIdentities.map((item) => [item.mention.toLowerCase(), item]));

    const identityImageMap = new Map<string, string[]>();
    (imageRefs || []).forEach((ref) => {
      const key = ref.identityId || (ref.identityTag ? ref.identityTag.toLowerCase() : "");
      if (key) {
        const arr = identityImageMap.get(key) || [];
        arr.push(ref.src);
        identityImageMap.set(key, arr);
      }
    });

    const chunkImagesForSubjects = (count: number) => {
      if (!images.length || count === 0) return Array.from({ length: count }, () => [] as string[]);
      const chunkSize = Math.max(1, Math.ceil(images.length / count));
      const buckets: string[][] = [];
      for (let i = 0; i < count; i++) {
        buckets.push(images.slice(i * chunkSize, (i + 1) * chunkSize));
      }
      return buckets;
    };

    const defaultSubjectImages = [
      "https://prod-ss-images.s3.cn-northwest-1.amazonaws.com.cn/vidu-maas/template/image2video.png",
      "https://prod-ss-images.s3.cn-northwest-1.amazonaws.com.cn/vidu-maas/template/reference2video-1.png",
      "https://prod-ss-images.s3.cn-northwest-1.amazonaws.com.cn/vidu-maas/template/reference2video-2.png",
    ];
    const manualSubjects: ViduSubject[] = Array.isArray(data.subjects)
      ? data.subjects
          .filter((item: any) => item && typeof item.name === "string" && item.name.trim())
          .map((item: any) => ({
            name: item.name.trim(),
            images: Array.isArray(item.images) ? item.images.filter(Boolean).slice(0, 3) : [],
            videos: Array.isArray(item.videos) ? item.videos.filter(Boolean).slice(0, 1) : [],
            voiceId: item.voiceId || data.voiceId,
            serverId: item.serverId,
          }))
      : [];

    const subjectPromptResult: { prompt: string; subjects: ViduSubject[] } = useCharacters && mentions.length > 0
      ? mentions.reduce<{ prompt: string; subjects: ViduSubject[] }>(
          (acc, mention, idx) => {
            const slotName = String(idx + 1);
            const hit = resolvedIdentityByMention.get(mention.toLowerCase());
            const mappedImages = identityImageMap.get(hit?.identityId || mention.toLowerCase()) || [];
            const bucketFallback = chunkImagesForSubjects(mentions.length)[idx] || [];
            const subjectImages = (mappedImages.length ? mappedImages : bucketFallback).filter(Boolean).slice(0, 3);
            const nextPrompt = acc.prompt
              .replace(new RegExp(`\\[@${escapeRegex(mention)}\\]`, "g"), `[@${slotName}]`)
              .replace(new RegExp(`@${escapeRegex(mention)}`, "g"), `[@${slotName}]`);
            return {
              prompt: nextPrompt,
              subjects: [
                ...acc.subjects,
                {
                  name: slotName,
                  images: subjectImages,
                  voiceId: data.voiceId,
                },
              ],
            };
          },
          { prompt, subjects: [] }
        )
      : { prompt, subjects: [] };

    const subjectCandidates =
      subjectPromptResult.subjects.length > 0 ? subjectPromptResult.subjects : manualSubjects;

    const hydratedSubjects = subjectCandidates.map((subject, idx) => {
      const subjectImages = Array.isArray(subject.images) ? subject.images.filter(Boolean).slice(0, 3) : [];
      const subjectVideos = Array.isArray(subject.videos) ? subject.videos.filter(Boolean).slice(0, 1) : [];
      if (subjectImages.length > 0 || subjectVideos.length > 0 || subject.serverId) return subject;
      const pool = images.length ? images : defaultSubjectImages;
      const fallbackImg = pool[idx % pool.length];
      return { ...subject, images: fallbackImg ? [fallbackImg] : defaultSubjectImages.slice(0, 1) };
    });

    const normalizedHydratedSubjects = await Promise.all(
      hydratedSubjects.map(async (subject) => ({
        ...subject,
        images: Array.isArray(subject.images) ? await normalizeViduImages(subject.images.filter(Boolean).slice(0, 3), execution) : subject.images,
        videos: Array.isArray(subject.videos) ? await normalizeViduVideos(subject.videos.filter(Boolean).slice(0, 1), execution) : subject.videos,
      }))
    );

    const nonSubjectImages = await normalizeViduImages(images.filter(Boolean).slice(0, 7), execution);

    if (normalizedMode === "subject" && normalizedHydratedSubjects.length === 0) {
      store.updateNodeData(nodeId, {
        status: "error",
        error: "Q3 主体调用需要至少 1 个主体。请连接身份图片，或切换到非主体调用。",
      });
      return;
    }

    if (normalizedMode === "nonSubject" && nonSubjectImages.length === 0) {
      store.updateNodeData(nodeId, {
        status: "error",
        error: "Q3 非主体调用至少需要 1 张参考图。",
      });
      return;
    }

    store.updateNodeData(nodeId, { status: "loading", error: null });

    try {
      const promptWithImageOrder = buildViduNonSubjectPrompt(prompt, nonSubjectImages.length);
      const request = normalizedMode === "subject"
        ? {
          mode: "subject" as const,
          subjectParams: {
            model,
            autoSubjects: data.autoSubjects === true,
            subjects: normalizedHydratedSubjects,
            prompt: subjectPromptResult.prompt,
            duration: data.duration ?? 5,
            audio: audioEnabled,
            seed: data.seed ?? 0,
            aspectRatio: data.aspectRatio || "16:9",
            resolution: data.resolution || "720p",
            offPeak: model === "viduq3" && data.offPeak === true,
            watermark: data.watermark === true,
          },
        }
        : {
          mode: "nonSubject" as const,
          nonSubjectParams: {
            model,
            images: nonSubjectImages,
            prompt: promptWithImageOrder,
            bgm: false,
            duration: data.duration ?? 5,
            aspectRatio: data.aspectRatio || "16:9",
            resolution: data.resolution || "720p",
            seed: data.seed ?? 0,
            offPeak: model === "viduq3" && audioEnabled ? data.offPeak === true : false,
            audio: audioEnabled,
            watermark: data.watermark === true,
          },
        };

      const taskRequestedAt = Date.now();
      store.updateNodeData(nodeId, {
        status: "loading",
        videoId: undefined,
        videoUrl: undefined,
        error: null,
        progressPercent: null,
        progressLabel: "提交中",
        progressHint: "正在向 Vidu 提交任务。",
        taskState: "submitting",
        taskRequestedAt,
        taskSubmittedAt: null,
        processingStartedAt: null,
        taskCompletedAt: null,
        lastCreditsCost: data.lastCreditsCost ?? null,
      });

      const { taskId, credits } = await ViduService.createReferenceVideo(
        request as any,
        viduConfig,
        execution.signal
      );

      const taskSubmittedAt = Date.now();
      let processingStartedAt: number | null = null;

      store.updateNodeData(nodeId, {
        status: "loading",
        videoId: taskId,
        videoUrl: undefined,
        error: null,
        progressPercent: null,
        progressLabel: null,
        progressHint: null,
        taskState: null,
        taskRequestedAt,
        taskSubmittedAt,
        processingStartedAt: null,
        taskCompletedAt: null,
        lastCreditsCost: typeof credits === "number" ? credits : data.lastCreditsCost ?? null,
      });

      while (true) {
        const result = await ViduService.fetchTaskResult(taskId, viduConfig, execution.signal);
        const rawState = result.rawState || result.state;
        const normalizedRawState = rawState.toLowerCase();
        if (!processingStartedAt && isProcessingTaskState(normalizedRawState)) {
          processingStartedAt = Date.now();
        }
        const snapshot = getViduProgressSnapshot({
          state: rawState,
          processingElapsedMs: processingStartedAt ? Date.now() - processingStartedAt : 0,
        });
        const hasCreation = (result.creations || []).some((item) => Boolean(item?.url || item?.watermarked_url));

        if (result.state === "success" || hasCreation) {
          const url = result.creations?.[0]?.url || result.creations?.[0]?.watermarked_url;
          store.updateNodeData(nodeId, {
            status: "complete",
            videoUrl: url,
            error: null,
            progressPercent: 100,
            progressLabel: "生成完成",
            progressHint: "Vidu 已返回最终视频结果。",
            taskState: rawState,
            taskRequestedAt,
            processingStartedAt,
            taskCompletedAt: Date.now(),
          });
          return;
        }
        if (result.state === "failed" || result.state === "canceled") {
          store.updateNodeData(nodeId, {
            status: "error",
            error: result.err_code || (result.state === "canceled" ? "Vidu 任务已取消" : "Vidu 生成失败"),
            progressPercent: snapshot.progressPercent,
            progressLabel: snapshot.progressLabel,
            progressHint: snapshot.progressHint,
            taskState: rawState,
            taskRequestedAt,
            processingStartedAt,
            taskCompletedAt: Date.now(),
          });
          return;
        }

        store.updateNodeData(nodeId, {
          status: "loading",
          error: null,
          progressPercent: snapshot.progressPercent,
          progressLabel: snapshot.progressLabel,
          progressHint: snapshot.progressHint,
          taskState: rawState,
          taskRequestedAt,
          taskSubmittedAt,
          processingStartedAt,
          taskCompletedAt: null,
        });

        if (processingStartedAt && Date.now() - processingStartedAt >= VIDU_PROCESSING_TIMEOUT_MS) {
          const processingWaitedMs = Date.now() - processingStartedAt;
          store.updateNodeData(nodeId, {
            status: "error",
            error: `Vidu 生成超时：进入生成中后已等待 ${formatDurationMs(processingWaitedMs)}。排队阶段不计入超时。`,
            progressPercent: 95,
            progressLabel: "生成中",
            progressHint: `本次任务在生成阶段已等待 ${formatDurationMs(processingWaitedMs)}，当前固定超时上限为 30 分钟。`,
            taskState: rawState,
            taskRequestedAt,
            taskSubmittedAt,
            processingStartedAt,
            taskCompletedAt: Date.now(),
          });
          return;
        }

        await wait(getViduPollDelayMs(rawState), execution.signal);
      }
    } catch (e: any) {
      store.updateNodeData(nodeId, {
        status: "error",
        error: e.message || "Vidu 提交失败",
        progressLabel: "请求失败",
        progressHint: "提交或轮询时发生错误。",
        taskCompletedAt: Date.now(),
      });
    }
  }, [config, store]);

  const runSeedanceVideoGen = useCallback(async (nodeId: string) => {
    const execution = captureExecutorLease();
    const store = createAccountScopedExecutorStore(execution);
    const node = store.getNodeById(nodeId);
    if (!node || !config) return;

    const { images, audios, videos, text: connectedText } = store.getConnectedInputs(nodeId);
    const data = node.data as any;
    const prompt = (connectedText || "").trim();
    const referenceVideos = Array.from(
      new Set([...(Array.isArray(data.referenceVideos) ? data.referenceVideos.filter(Boolean) : []), ...(videos || []).filter(Boolean)])
    );

    if (images.length === 0 && referenceVideos.length === 0) {
      store.updateNodeData(nodeId, {
        status: "error",
        error: "Seedance 多模态参考生视频至少需要 1 个参考图片或参考视频。",
      });
      return;
    }

    store.updateNodeData(nodeId, { status: "loading", error: null });

    try {
      const normalizedVideos = await normalizeSeedanceVideos(referenceVideos.slice(0, 3), execution);
      const normalizedAudios = await normalizeSeedanceAudios(audios.slice(0, 3), execution);
      const normalizedImages = await normalizeSeedanceImages(images.filter(Boolean).slice(0, 9), execution);

      const content: SeedanceContentItem[] = [];
      if (prompt) {
        content.push({ type: "text", text: prompt });
      }
      normalizedImages.forEach((url) => {
        content.push({
          type: "image_url",
          image_url: { url },
          role: "reference_image",
        });
      });
      normalizedVideos.forEach((url) => {
        content.push({
          type: "video_url",
          video_url: { url },
          role: "reference_video",
        });
      });
      normalizedAudios.forEach((url) => {
        content.push({
          type: "audio_url",
          audio_url: { url },
          role: "reference_audio",
        });
      });

      const configToUse = {
        ...config.videoConfig,
        baseUrl: SEEDANCE_DEFAULT_BASE_URL,
        model: (data.model || SEEDANCE_DEFAULT_MODEL) as SeedanceModel,
      };

      const task = await SeedanceVideoService.createSeedanceTask(
        {
          model: configToUse.model,
          content,
          generateAudio: data.generateAudio !== false,
          resolution: data.resolution || "720p",
          ratio: data.ratio || "adaptive",
          duration:
            typeof data.duration === "number" && Number.isFinite(data.duration)
              ? Math.max(4, Math.min(15, Math.round(data.duration)))
              : 5,
          watermark: data.watermark === true,
        },
        configToUse,
        execution.signal
      );

      store.updateNodeData(nodeId, {
        status: "loading",
        videoId: task.id,
        videoUrl: undefined,
        error: null,
      });

      const maxAttempts = 60;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const result = await SeedanceVideoService.getSeedanceTask(task.id, configToUse, execution.signal);
        if (result.status === "succeeded") {
          store.updateNodeData(nodeId, {
            status: "complete",
            videoUrl: result.url,
            error: null,
          });
          return;
        }
        if (result.status === "failed") {
          store.updateNodeData(nodeId, {
            status: "error",
            error: result.errorMsg || "Seedance 生成失败。",
          });
          return;
        }
        await wait(5000, execution.signal);
      }

      store.updateNodeData(nodeId, { status: "error", error: "Seedance 生成超时。" });
    } catch (e: any) {
      store.updateNodeData(nodeId, {
        status: "error",
        error: e?.message || "Seedance 提交失败。",
      });
    }
  }, [config, store]);

  const executeVideoGen = useCallback(async (nodeId: string) => {
    const execution = captureExecutorLease();
    const store = createAccountScopedExecutorStore(execution);
    const node = store.getNodeById(nodeId);
    if (!node || !config) return;
    if (node.type === "viduVideoGen") {
      return runViduVideoGen(nodeId);
    }
    if (node.type === "seedanceVideoGen") {
      return runSeedanceVideoGen(nodeId);
    }
    const { images, audios, videos, text: connectedText, atMentions, entityBindings } = store.getConnectedInputs(nodeId);
    const data = node.data as any;
    const prompt = (connectedText || "").trim();
    const isWanReferenceVideoNode = node.type === "wanReferenceVideoGen";
    if (!isWanReferenceVideoNode) {
      store.updateNodeData(nodeId, { status: "error", error: "Unsupported video node type." });
      return;
    }
    const referenceImages = Array.isArray(data.referenceImages) ? data.referenceImages.filter(Boolean) : [];
    const referenceVideos = Array.from(
      new Set([...(Array.isArray(data.referenceVideos) ? data.referenceVideos.filter(Boolean) : []), ...(videos || []).filter(Boolean)])
    );
    const referenceAudios = Array.from(
      new Set([...(Array.isArray(data.referenceAudios) ? data.referenceAudios.filter(Boolean) : []), ...(audios || []).filter(Boolean)])
    );
    const firstFrameImage = typeof data.firstFrameImage === "string" ? data.firstFrameImage.trim() : "";
    const referenceVoiceTarget = parseWanReferenceVoiceTarget(data.referenceVoiceTarget);
    const projectReferenceTargets = Array.isArray(data.projectReferenceTargets)
      ? (data.projectReferenceTargets as ProjectReferenceTargetData[])
      : [];
    const hasManualReferenceAssets = referenceImages.length > 0 || referenceVideos.length > 0 || projectReferenceTargets.length > 0;

    if (images.length === 0 && !prompt && !(isWanReferenceVideoNode && hasManualReferenceAssets)) {
      store.updateNodeData(nodeId, { status: "error", error: "Missing text input (prompt required)." });
      return;
    }

    const isWanLegacyVideo = !isWanReferenceVideoNode && (config.videoConfig.baseUrl || "").includes("/api/v1/services/aigc/video-generation/");
    if (!isWanLegacyVideo && !isWanReferenceVideoNode && (!config.videoConfig.baseUrl || !config.videoConfig.apiKey)) {
      store.updateNodeData(nodeId, { status: "error", error: "Missing video API configuration." });
      return;
    }

    if (isWanLegacyVideo && images.length === 0) {
      store.updateNodeData(nodeId, { status: "error", error: "Wan 视频需要至少一张参考图。" });
      return;
    }
    if (isWanLegacyVideo && !prompt) {
      store.updateNodeData(nodeId, { status: "error", error: "Wan 视频需要提示词。" });
      return;
    }
    if (isWanReferenceVideoNode && referenceVideos.length === 0 && referenceImages.length === 0 && images.length === 0) {
      store.updateNodeData(nodeId, { status: "error", error: "Wan 参考生视频需要至少 1 个角色参考（图像或视频）。" });
      return;
    }
    if (isWanReferenceVideoNode && !prompt) {
      store.updateNodeData(nodeId, { status: "error", error: "Wan 参考生视频需要提示词。" });
      return;
    }

    store.updateNodeData(nodeId, { status: "loading", error: null });

    try {
      const normalizedImages = (isWanLegacyVideo || isWanReferenceVideoNode) ? await normalizeWanImages(images, execution) : images;
      const refImage =
        normalizedImages.find((src) => src.startsWith("http")) ||
        (isWanLegacyVideo ? normalizedImages[0] : undefined);
      const params: any = {
        aspectRatio: data.aspectRatio || "16:9",
        duration: data.duration || "5s",
        quality: data.quality || "standard",
        inputImageUrl: refImage,
      };
      if (isWanLegacyVideo) {
        const fallbackResolution = data.quality === "high" ? "1080P" : "720P";
        const resolution = data.resolution || fallbackResolution;
        params.size = mapWanVideoSize(data.aspectRatio, resolution);
        params.watermark = data.watermark;
        params.seed = data.seed;
        if (data.audioEnabled && data.audioUrl) {
          const audioUrl = data.audioUrl.trim();
          params.audioUrl = await normalizeWanAudio(audioUrl, execution);
        }
      }
      let promptForRequest = prompt;
      if (isWanReferenceVideoNode) {
        const roles = store.nodeFlowContext.roles || [];
        const latestProjectRefs = buildProjectReferenceIndex(roles, store.nodeFlowContext.designAssets || []);
        const { refs: promptDrivenRefs, replacements: promptDrivenReplacements } = resolvePromptProjectReferences(
          prompt,
          atMentions as MentionData[] | undefined,
          entityBindings,
          roles,
          latestProjectRefs
        );
        const normalizedVideos = await normalizeWanReferenceVideos(referenceVideos, execution);
        const normalizedReferenceImages = await normalizeWanImages(referenceImages, execution);
        const normalizedReferenceAudios = await Promise.all(referenceAudios.slice(0, 1).map((item) => normalizeWanAudio(item, execution)));
        const referenceVoiceUrl = normalizedReferenceAudios.find(Boolean);
        const normalizedFirstFrame = firstFrameImage ? await normalizeWanImages([firstFrameImage], execution) : [];
        const explicitProjectRefs = projectReferenceTargets
          .map((target) => latestProjectRefs.get(makeProjectRefKey(target.category, target.refId)))
          .filter((item): item is ProjectReferenceAsset => !!item);
        const orderedProjectRefs = Array.from(
          [...promptDrivenRefs, ...explicitProjectRefs].reduce((map, item) => {
            map.set(makeProjectRefKey(item.category, item.refId), item);
            return map;
          }, new Map<string, ProjectReferenceAsset>()).values()
        );
        const cappedVideos = normalizedVideos.slice(0, 3);
        const imageSlotBudget = Math.max(0, 5 - cappedVideos.length);
        if (promptDrivenRefs.length > imageSlotBudget) {
          throw new Error(`Wan 2.7 参考生视频最多还能容纳 ${imageSlotBudget} 张图片参考，当前提示词身份引用过多。`);
        }
        const imageMedia: Array<{ kind: "image"; url: string; refKey?: string }> = [];
        const seenImageUrls = new Set<string>();
        orderedProjectRefs.forEach((item) => {
          if (!item.url || seenImageUrls.has(item.url) || imageMedia.length >= imageSlotBudget) return;
          seenImageUrls.add(item.url);
          imageMedia.push({
            kind: "image",
            url: item.url,
            refKey: makeProjectRefKey(item.category, item.refId),
          });
        });
        normalizedReferenceImages.forEach((url) => {
          if (!url || seenImageUrls.has(url) || imageMedia.length >= imageSlotBudget) return;
          seenImageUrls.add(url);
          imageMedia.push({ kind: "image", url });
        });
        normalizedImages.forEach((url) => {
          if (!url || seenImageUrls.has(url) || imageMedia.length >= imageSlotBudget) return;
          seenImageUrls.add(url);
          imageMedia.push({ kind: "image", url });
        });
        const imageSlotByRefKey = new Map<string, number>();
        imageMedia.forEach((item, index) => {
          if (item.refKey) {
            imageSlotByRefKey.set(item.refKey, index + 1);
          }
        });
        promptForRequest = rewriteWanReferencePrompt(prompt, {
          replacements: promptDrivenReplacements,
          imageSlotByRefKey,
          imageCount: imageMedia.length,
          videoCount: cappedVideos.length,
        });
        if (referenceVoiceUrl && referenceVoiceTarget) {
          const targetCount = referenceVoiceTarget.kind === "video" ? cappedVideos.length : imageMedia.length;
          if (referenceVoiceTarget.index > targetCount) {
            const label = `${referenceVoiceTarget.kind === "video" ? "视频" : "图片"}${referenceVoiceTarget.index}`;
            throw new Error(`参考音色绑定目标 ${label} 不存在，请重新选择。`);
          }
        }
        params.aspectRatio = data.aspectRatio || "16:9";
        params.resolution = data.resolution || "1080P";
        params.watermark = data.watermark;
        params.seed = data.seed;
        params.media = [
          ...cappedVideos.map((url, index) => ({
            kind: "video" as const,
            url,
            referenceVoiceUrl: referenceVoiceUrl
              ? referenceVoiceTarget
                ? (referenceVoiceTarget.kind === "video" && referenceVoiceTarget.index === index + 1 ? referenceVoiceUrl : undefined)
                : (index === 0 ? referenceVoiceUrl : undefined)
              : undefined,
          })),
          ...imageMedia.map((item, index) => ({
            kind: "image" as const,
            url: item.url,
            referenceVoiceUrl: referenceVoiceUrl
              ? referenceVoiceTarget
                ? (referenceVoiceTarget.kind === "image" && referenceVoiceTarget.index === index + 1 ? referenceVoiceUrl : undefined)
                : (cappedVideos.length === 0 && index === 0 ? referenceVoiceUrl : undefined)
              : undefined,
          })),
        ];
        params.firstFrameUrl = normalizedFirstFrame[0];
        if (params.media.length === 0) {
          throw new Error("Wan 参考生视频未找到可用的项目卡片或引用素材。");
        }
      }

      // Use node-specific model or fallback to config
      const configToUse = {
        ...config.videoConfig,
        model: data.model || config.videoConfig.model
      };
      if (isWanReferenceVideoNode) {
        configToUse.baseUrl =
          config.videoConfig.baseUrl?.includes("/api/v1/services/aigc/video-generation/video-synthesis")
            ? config.videoConfig.baseUrl
            : QWEN_WAN_VIDEO_ENDPOINT;
        configToUse.model = data.model || QWEN_WAN_REFERENCE_VIDEO_MODEL;
      }

      if (isWanLegacyVideo) {
        params.signal = execution.signal;
        const { id, url } = await WanService.submitWanVideoTask(prompt || "Animate this", configToUse, params);
        if (url) {
          store.updateNodeData(nodeId, { status: "complete", videoUrl: url, error: null });
          return;
        }
        if (!id) {
          store.updateNodeData(nodeId, { status: "error", error: "Wan 视频任务创建失败。" });
          return;
        }

        store.updateNodeData(nodeId, { status: "loading", videoId: id, videoUrl: undefined, error: null });

        const maxAttempts = 60;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          const result = await WanService.checkWanTaskStatus(id, configToUse.apiKey, execution.signal);
          if (result.status === "succeeded") {
            store.updateNodeData(nodeId, { status: "complete", videoUrl: result.url, error: null });
            return;
          }
          if (result.status === "failed") {
            store.updateNodeData(nodeId, { status: "error", error: result.errorMsg || "Wan 视频生成失败。" });
            return;
          }
          await wait(15000, execution.signal);
        }

        store.updateNodeData(nodeId, { status: "error", error: "Wan 视频生成超时。" });
        return;
      }

      if (isWanReferenceVideoNode) {
        params.signal = execution.signal;
        const { id, url } = await WanService.submitWanReferenceVideoTask(promptForRequest || "Animate this", configToUse, params);
        if (url) {
          store.updateNodeData(nodeId, { status: "complete", videoUrl: url, error: null });
          return;
        }
        if (!id) {
          store.updateNodeData(nodeId, { status: "error", error: "Wan 参考生视频任务创建失败。" });
          return;
        }

        store.updateNodeData(nodeId, { status: "loading", videoId: id, videoUrl: undefined, error: null });

        const maxAttempts = 60;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          const result = await WanService.checkWanTaskStatus(id, configToUse.apiKey, execution.signal);
          if (result.status === "succeeded") {
            store.updateNodeData(nodeId, { status: "complete", videoUrl: result.url, error: null });
            return;
          }
          if (result.status === "failed") {
            store.updateNodeData(nodeId, { status: "error", error: result.errorMsg || "Wan 参考生视频生成失败。" });
            return;
          }
          await wait(5000, execution.signal);
        }

        store.updateNodeData(nodeId, { status: "error", error: "Wan 参考生视频生成超时。" });
        return;
      }

    } catch (e: any) {
      store.updateNodeData(nodeId, { status: "error", error: e.message || "Video submit failed" });
    }
  }, [config?.videoConfig, runSeedanceVideoGen, runViduVideoGen, store]);

  const runImageGen = useCallback(async (nodeId: string) => {
    await executeImageGen(nodeId);
  }, [executeImageGen]);

  const runVideoGen = useCallback(async (nodeId: string) => {
    await executeVideoGen(nodeId);
  }, [executeVideoGen]);

  const approveExecution = useCallback(async (nodeId: string) => {
    const proposal = store.pendingExecutionApprovals[nodeId];
    if (!proposal) return;
    store.clearExecutionApproval(nodeId);
    if (proposal.action === "image_generation") {
      await executeImageGen(nodeId);
      return;
    }
    await executeVideoGen(nodeId);
  }, [executeImageGen, executeVideoGen, store]);

  const dismissExecutionApproval = useCallback((nodeId: string) => {
    store.clearExecutionApproval(nodeId);
  }, [store]);

  return {
    runImageGen,
    runVideoGen,
    approveExecution,
    dismissExecutionApproval,
  };
};
