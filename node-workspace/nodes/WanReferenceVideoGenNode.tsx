import React, { useEffect, useMemo, useRef, useState } from "react";
import { BaseNode } from "./BaseNode";
import { VideoGenNodeData } from "../types";
import { useNodeFlowStore } from "../store/nodeFlowStore";
import { useNodeFlowExecutor } from "../store/useNodeFlowExecutor";
import { RefreshCw, Film, AlertCircle, Download, X, Video, Image as ImageIcon, AudioLines, Mic } from "lucide-react";
import { QWEN_WAN_REFERENCE_VIDEO_MODEL } from "../../constants";
import { buildApiUrl } from "../../utils/api";
import { buildAuthorizedJsonHeaders } from "../../utils/authToken";

type Props = {
  id: string;
  data: VideoGenNodeData;
};

type ManualReferenceAsset = {
  url: string;
  kind: "video" | "image";
};

type VoiceTargetOption = {
  value: string;
  label: string;
  source: string;
};

const clampDuration = (value: number) => Math.max(2, Math.min(10, Math.round(value)));

export const WanReferenceVideoGenNode: React.FC<Props & { selected?: boolean }> = ({ id, data, selected }) => {
  const { updateNodeData, getConnectedInputs, nodeFlowContext } = useNodeFlowStore();
  const { runVideoGen } = useNodeFlowExecutor();
  const [progress, setProgress] = useState(0);
  const [isUploadingVideoRefs, setIsUploadingVideoRefs] = useState(false);
  const [isUploadingImageRefs, setIsUploadingImageRefs] = useState(false);
  const [isUploadingVoiceRef, setIsUploadingVoiceRef] = useState(false);
  const [isUploadingFirstFrame, setIsUploadingFirstFrame] = useState(false);
  const refVideoInputRef = useRef<HTMLInputElement>(null);
  const refImageInputRef = useRef<HTMLInputElement>(null);
  const refVoiceInputRef = useRef<HTMLInputElement>(null);
  const firstFrameInputRef = useRef<HTMLInputElement>(null);

  const { images: connectedImages, videos: connectedVideos, audios: connectedAudios, atMentions } = getConnectedInputs(id);
  const referenceVideos = Array.isArray(data.referenceVideos) ? data.referenceVideos.filter(Boolean) : [];
  const referenceImages = Array.isArray(data.referenceImages) ? data.referenceImages.filter(Boolean) : [];
  const referenceAudios = Array.isArray(data.referenceAudios) ? data.referenceAudios.filter(Boolean) : [];
  const firstFrameImage = typeof data.firstFrameImage === "string" ? data.firstFrameImage : null;
  const projectReferenceTargets = Array.isArray(data.projectReferenceTargets) ? data.projectReferenceTargets : [];
  const manualRefs = useMemo<ManualReferenceAsset[]>(
    () => [
      ...referenceVideos.map((url) => ({ url, kind: "video" as const })),
      ...referenceImages.map((url) => ({ url, kind: "image" as const })),
    ],
    [referenceImages, referenceVideos]
  );
  const availableProjectRefs = useMemo(() => {
    const latestByKey = new Map<string, { category: "identity"; refId: string; label: string; url: string; createdAt: number }>();
    (nodeFlowContext.designAssets || []).forEach((asset) => {
      if (!asset?.url || !asset?.refId) return;
      const key = `${asset.category}:${asset.refId}`;
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
    return Array.from(latestByKey.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [nodeFlowContext.designAssets]);
  const selectedProjectRefKeys = useMemo(
    () => new Set(projectReferenceTargets.map((target) => `${target.category}:${target.refId}`)),
    [projectReferenceTargets]
  );
  const voiceTargetOptions = useMemo<VoiceTargetOption[]>(() => {
    const videoOptions = [...referenceVideos, ...connectedVideos.filter(Boolean)].slice(0, 3).map((_, index) => ({
      value: `video:${index + 1}`,
      label: `视频${index + 1}`,
      source: index < referenceVideos.length ? "手动/上传视频参考" : "连接的视频参考",
    }));
    const imageCapacity = Math.max(0, 5 - videoOptions.length);
    const imageSources = [
      ...projectReferenceTargets.map((target) => ({
        source: target.label ? `项目卡片 · ${target.label}` : "项目卡片参考",
      })),
      ...referenceImages.map(() => ({ source: "手动/上传图片参考" })),
      ...connectedImages.filter(Boolean).map(() => ({ source: "连接的图片参考" })),
    ].slice(0, imageCapacity);
    const imageOptions = imageSources.map((item, index) => ({
      value: `image:${index + 1}`,
      label: `图片${index + 1}`,
      source: item.source,
    }));
    return [...videoOptions, ...imageOptions];
  }, [connectedImages, connectedVideos, projectReferenceTargets, referenceImages, referenceVideos]);
  const selectedVoiceTargetValue =
    typeof data.referenceVoiceTarget === "string" && voiceTargetOptions.some((item) => item.value === data.referenceVoiceTarget)
      ? data.referenceVoiceTarget
      : (voiceTargetOptions[0]?.value ?? "");
  const selectedVoiceTargetLabel =
    voiceTargetOptions.find((item) => item.value === selectedVoiceTargetValue)?.label ?? null;
  const mentionHints = useMemo(
    () =>
      (atMentions || [])
        .filter((mention) => mention.status === "match" && mention.kind === "identity")
        .map((mention) => ({
          label: mention.mention ? `@${mention.mention}` : mention.name,
          kind: mention.roleKind === "scene" ? "scene" : "person",
        })),
    [atMentions]
  );
  const hasConnectedImages = connectedImages.length > 0;
  const totalReferenceCount = manualRefs.length + connectedImages.length + projectReferenceTargets.length;
  const effectiveVoiceCount = referenceAudios.length > 0 || connectedAudios.length > 0 ? 1 : 0;
  const isLoading = data.status === "loading";
  const currentModel = QWEN_WAN_REFERENCE_VIDEO_MODEL;
  const currentResolution = (data.resolution || "1080P").toUpperCase();
  const aspectRatioOptions: Record<string, { value: string; label: string }[]> = {
    "720P": [
      { value: "16:9", label: "16:9 Landscape" },
      { value: "9:16", label: "9:16 Portrait" },
      { value: "1:1", label: "1:1 Square" },
      { value: "4:3", label: "4:3 Standard" },
      { value: "3:4", label: "3:4 Portrait" },
    ],
    "1080P": [
      { value: "16:9", label: "16:9 Landscape" },
      { value: "9:16", label: "9:16 Portrait" },
      { value: "1:1", label: "1:1 Square" },
      { value: "4:3", label: "4:3 Standard" },
      { value: "3:4", label: "3:4 Portrait" },
    ],
  };
  const allowedAspectOptions = aspectRatioOptions[currentResolution] || aspectRatioOptions["1080P"];
  const currentAspect =
    allowedAspectOptions.find((opt) => opt.value === data.aspectRatio)?.value || allowedAspectOptions[0].value;
  const currentDuration = clampDuration(Number.parseInt((data.duration || "5s").replace("s", ""), 10) || 5);

  useEffect(() => {
    const next: Partial<VideoGenNodeData> = {};
    if (data.model !== currentModel) {
      next.model = currentModel;
    }
    if (data.resolution && data.resolution !== currentResolution) {
      next.resolution = currentResolution;
    }
    if (!allowedAspectOptions.some((opt) => opt.value === data.aspectRatio)) {
      next.aspectRatio = currentAspect;
    }
    if (!Array.isArray(data.referenceVideos)) {
      next.referenceVideos = [];
    }
    if (!Array.isArray(data.referenceImages)) {
      next.referenceImages = [];
    }
    if (!Array.isArray(data.projectReferenceTargets)) {
      next.projectReferenceTargets = [];
    }
    if (Object.keys(next).length > 0) {
      updateNodeData(id, next);
    }
  }, [
    allowedAspectOptions,
    currentAspect,
    currentModel,
    currentResolution,
    data.aspectRatio,
    data.model,
    data.projectReferenceTargets,
    data.referenceImages,
    data.referenceVideos,
    data.resolution,
    id,
    updateNodeData,
  ]);

  useEffect(() => {
    if (!isLoading) {
      setProgress(0);
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - start;
      const eased = 1 - Math.exp(-elapsed / 14000);
      setProgress(Math.min(95, Math.round(eased * 100)));
    }, 500);
    return () => clearInterval(timer);
  }, [isLoading]);

  useEffect(() => {
    if (effectiveVoiceCount <= 0) {
      if (data.referenceVoiceTarget) {
        updateNodeData(id, { referenceVoiceTarget: null });
      }
      return;
    }
    if (!voiceTargetOptions.length) {
      if (data.referenceVoiceTarget) {
        updateNodeData(id, { referenceVoiceTarget: null });
      }
      return;
    }
    if (!data.referenceVoiceTarget || !voiceTargetOptions.some((item) => item.value === data.referenceVoiceTarget)) {
      updateNodeData(id, { referenceVoiceTarget: voiceTargetOptions[0].value });
    }
  }, [data.referenceVoiceTarget, effectiveVoiceCount, id, updateNodeData, voiceTargetOptions]);

  const handleGenerate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await runVideoGen(id);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!data.videoUrl) return;
    const link = document.createElement("a");
    link.href = data.videoUrl;
    link.download = "wan-reference-video.mp4";
    link.rel = "noreferrer";
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const uploadReferenceAsset = async (
    file: File,
    options: { prefix: string; fallbackType: string }
  ) => {
    const projectId = nodeFlowContext.projectId || "";
    if (!projectId) throw new Error("当前 Wan 节点尚未绑定云端项目。");
    const safeName = file.name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").toLowerCase();
    const contentType = file.type || options.fallbackType;
    const payload = {
      fileName: `${options.prefix}/${Date.now()}-${safeName}`,
      bucket: "assets",
      contentType,
      fileSize: file.size,
      projectId,
    };
    const res = await fetch(buildApiUrl("/api/upload-url"), {
      method: "POST",
      headers: await buildAuthorizedJsonHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Upload URL error ${res.status}`);
    }
    const dataRes = await res.json() as {
      signedUrl?: string;
      publicUrl?: string;
      path?: string;
      bucket?: string;
    };
    if (!dataRes?.signedUrl) {
      throw new Error("Missing signedUrl");
    }

    const uploadRes = await fetch(dataRes.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file,
    });
    if (!uploadRes.ok) {
      const txt = await uploadRes.text();
      throw new Error(`Upload failed ${uploadRes.status}: ${txt}`);
    }

    let url = dataRes.publicUrl || "";
    if (!url && dataRes.path) {
      const signedRes = await fetch(buildApiUrl("/api/download-url"), {
        method: "POST",
        headers: await buildAuthorizedJsonHeaders(),
        body: JSON.stringify({
          projectId,
          path: dataRes.path,
          bucket: dataRes.bucket || "assets",
        }),
      });
      if (signedRes.ok) {
        const signedData = await signedRes.json() as { signedUrl?: string };
        url = signedData.signedUrl || "";
      }
    }
    if (!url) {
      throw new Error("Missing reference asset URL");
    }
    return url;
  };

  const handleReferenceVoiceFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setIsUploadingVoiceRef(true);
    try {
      const file = files[0];
      const uploaded = await uploadReferenceAsset(file, { prefix: "wan-reference-voice", fallbackType: "audio/mpeg" });
      updateNodeData(id, {
        referenceAudios: [uploaded],
        referenceVoiceTarget: selectedVoiceTargetValue || voiceTargetOptions[0]?.value || null,
        error: null,
      });
    } catch (e: any) {
      updateNodeData(id, { error: e?.message || "参考音色上传失败。" });
    } finally {
      setIsUploadingVoiceRef(false);
      if (refVoiceInputRef.current) {
        refVoiceInputRef.current.value = "";
      }
    }
  };

  const handleFirstFrameFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setIsUploadingFirstFrame(true);
    try {
      const file = files[0];
      const uploaded = await uploadReferenceAsset(file, { prefix: "wan-first-frame", fallbackType: "image/png" });
      updateNodeData(id, {
        firstFrameImage: uploaded,
        error: null,
      });
    } catch (e: any) {
      updateNodeData(id, { error: e?.message || "首帧图片上传失败。" });
    } finally {
      setIsUploadingFirstFrame(false);
      if (firstFrameInputRef.current) {
        firstFrameInputRef.current.value = "";
      }
    }
  };

  const handleReferenceVideoFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const remainingVideoSlots = Math.max(0, 3 - referenceVideos.length);
    const remainingTotalSlots = Math.max(0, 5 - manualRefs.length);
    const capacity = Math.min(remainingVideoSlots, remainingTotalSlots);
    if (capacity === 0) {
      updateNodeData(id, { error: "参考素材上限为 5，其中视频最多 3 个。" });
      return;
    }

    setIsUploadingVideoRefs(true);
    try {
      const selected = Array.from(files).slice(0, capacity);
      const uploaded: string[] = [];
      for (const file of selected) {
        uploaded.push(await uploadReferenceAsset(file, { prefix: "wan-reference-video", fallbackType: "video/mp4" }));
      }
      updateNodeData(id, {
        referenceVideos: [...referenceVideos, ...uploaded],
        error: null,
      });
    } catch (e: any) {
      updateNodeData(id, { error: e?.message || "参考视频上传失败。" });
    } finally {
      setIsUploadingVideoRefs(false);
      if (refVideoInputRef.current) {
        refVideoInputRef.current.value = "";
      }
    }
  };

  const handleReferenceImageFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const remainingImageSlots = Math.max(0, 5 - referenceImages.length);
    const remainingTotalSlots = Math.max(0, 5 - manualRefs.length);
    const capacity = Math.min(remainingImageSlots, remainingTotalSlots);
    if (capacity === 0) {
      updateNodeData(id, { error: "参考素材上限为 5，其中图片与视频总数不能超过 5。" });
      return;
    }

    setIsUploadingImageRefs(true);
    try {
      const selected = Array.from(files).slice(0, capacity);
      const uploaded: string[] = [];
      for (const file of selected) {
        uploaded.push(await uploadReferenceAsset(file, { prefix: "wan-reference-image", fallbackType: "image/png" }));
      }
      updateNodeData(id, {
        referenceImages: [...referenceImages, ...uploaded],
        error: null,
      });
    } catch (e: any) {
      updateNodeData(id, { error: e?.message || "参考图片上传失败。" });
    } finally {
      setIsUploadingImageRefs(false);
      if (refImageInputRef.current) {
        refImageInputRef.current.value = "";
      }
    }
  };

  const handleRemoveReference = (asset: ManualReferenceAsset, index: number) => {
    if (asset.kind === "video") {
      updateNodeData(id, {
        referenceVideos: referenceVideos.filter((_, itemIndex) => itemIndex !== index),
      });
      return;
    }
    updateNodeData(id, {
      referenceImages: referenceImages.filter((_, itemIndex) => itemIndex !== index),
    });
  };

  const handleToggleProjectReference = (target: { category: "identity"; refId: string; label: string }) => {
    const exists = projectReferenceTargets.some(
      (item) => item.category === target.category && item.refId === target.refId
    );
    if (exists) {
      updateNodeData(id, {
        projectReferenceTargets: projectReferenceTargets.filter(
          (item) => !(item.category === target.category && item.refId === target.refId)
        ),
      });
      return;
    }
    updateNodeData(id, {
      projectReferenceTargets: [
        ...projectReferenceTargets,
        { category: target.category, refId: target.refId, label: target.label },
      ],
    });
  };

  return (
    <BaseNode
      title={data.title || "WAN Ref Vid"}
      onTitleChange={(title) => updateNodeData(id, { title })}
      inputs={["image", "video", "audio", "text"]}
      selected={selected}
    >
      <div className="space-y-4 flex-1 flex flex-col">
        {data.videoUrl ? (
          <div className="node-surface relative overflow-hidden rounded-[20px] shadow-[0_18px_40px_rgba(0,0,0,0.45)]">
            <video
              controls
              playsInline
              disablePictureInPicture
              disableRemotePlayback
              controlsList="nodownload noplaybackrate noremoteplayback"
              className="w-full aspect-video transition-transform duration-700 bg-black/40 nodrag"
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <source src={data.videoUrl} />
            </video>
          </div>
        ) : (
          <div
            onClick={handleGenerate}
            className={`node-surface node-surface--dashed w-full aspect-video rounded-[20px] flex flex-col items-center justify-center transition-all duration-500 ${
              data.status === "loading"
                ? "border-amber-500/40 bg-amber-500/[0.02]"
                : "hover:border-fuchsia-500/30 hover:bg-fuchsia-500/[0.02]"
            }`}
          >
            {data.status === "loading" ? (
              <div className="flex flex-col items-center gap-3">
                <RefreshCw size={24} className="text-[var(--node-accent)] animate-spin" />
                <span className="text-[10px] opacity-50 uppercase tracking-[0.2em] font-black">Generating...</span>
                <div className="w-full max-w-[180px] space-y-2">
                  <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full bg-amber-400 transition-all" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="text-[9px] font-semibold text-amber-300/80 text-center">{progress}%</div>
                </div>
              </div>
            ) : (
              <>
                <div className="h-14 w-14 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-center mb-4 transition-all duration-500 shadow-inner">
                  <Film className="text-[var(--node-text-secondary)]" size={28} />
                </div>
                <div className="flex flex-col items-center gap-1">
                  <span className="text-[10px] opacity-40 uppercase tracking-[0.2em] font-black transition-all duration-500 text-white">GENERATE</span>
                  <span className="text-[8px] opacity-20 uppercase tracking-[0.1em] font-bold transition-all duration-500">
                    Wan 2.7 reference video
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {data.videoUrl && (
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-3 py-2 rounded-full text-[10px] font-semibold uppercase tracking-widest text-[var(--node-text-secondary)] bg-white/5 hover:bg-white/10 transition"
            >
              <Download size={12} />
              下载
            </button>
            <div className="flex-1" />
            {isLoading ? (
              <div className="flex items-center gap-2 text-[9px] font-semibold text-amber-300/90">
                <div className="h-1 w-24 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full bg-amber-400 transition-all" style={{ width: `${progress}%` }} />
                </div>
                <span>{progress}%</span>
              </div>
            ) : (
              <button
                onClick={handleGenerate}
                className="flex items-center gap-2 px-3 py-2 rounded-full text-[10px] font-semibold uppercase tracking-widest text-white bg-emerald-500/80 hover:bg-emerald-500 transition"
                title="Regenerate"
              >
                <RefreshCw size={12} />
                重试
              </button>
            )}
          </div>
        )}

	        <div className="grid grid-cols-4 gap-2 text-[10px] uppercase tracking-[0.18em] font-black text-[var(--node-text-secondary)]/70">
	          <div>{referenceVideos.length} video</div>
	          <div className="text-center">{referenceImages.length} image</div>
	          <div className="text-center">{projectReferenceTargets.length} card</div>
	          <div className="text-right">{connectedImages.length} linked</div>
	        </div>

          <div className="grid grid-cols-2 gap-2 text-[10px] uppercase tracking-[0.18em] font-black text-[var(--node-text-secondary)]/70">
            <div>{effectiveVoiceCount} voice</div>
            <div className="text-right">{firstFrameImage ? "first frame" : "no first frame"}</div>
          </div>

        <div className="node-panel space-y-3 p-3 nodrag">
          <div className="space-y-1">
            <label className="text-[8px] font-black uppercase tracking-widest text-[var(--node-text-secondary)] opacity-70">
              身份引用
            </label>
            <div className="text-[9px] leading-5 text-[var(--node-text-secondary)]">
              支持图像或视频。执行时会优先把 prompt 里的 <span className="text-[var(--node-text-primary)] font-semibold">@身份证</span> 自动映射成
              <span className="text-[var(--node-text-primary)] font-semibold"> 图片1 / 图片2 / ...</span>，并从项目卡片设计图中取图。
            </div>
          </div>

          {mentionHints.length ? (
            <div className="flex flex-wrap gap-1.5">
              {mentionHints.map((mention) => (
                <span
                  key={`${mention.kind}-${mention.label}`}
                  className="inline-flex items-center rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-1 text-[8px] font-bold uppercase tracking-[0.14em] text-emerald-200"
                >
                  {mention.label}
                </span>
              ))}
            </div>
          ) : (
            <div className="rounded-[16px] border border-dashed border-[var(--node-border)] px-3 py-2 text-[9px] leading-5 text-[var(--node-text-secondary)]">
              提示词里插入 <span className="text-[var(--node-text-primary)] font-semibold">@男主</span> 或 <span className="text-[var(--node-text-primary)] font-semibold">@男主_受伤形态</span> 这类身份证，
              会自动使用项目卡片中的设计图作为引用，并改写成对应的 <span className="text-[var(--node-text-primary)] font-semibold">图片编号</span>。
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[8px] font-black uppercase tracking-widest text-[var(--node-text-secondary)] opacity-70">
                项目卡片引用
              </div>
              <div className="text-[9px] text-[var(--node-text-secondary)]">
                {projectReferenceTargets.length} selected
              </div>
            </div>
            {availableProjectRefs.length ? (
              <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
                {availableProjectRefs.map((asset) => {
                  const assetKey = `${asset.category}:${asset.refId}`;
                  const active = selectedProjectRefKeys.has(assetKey);
                  return (
                    <button
                      key={assetKey}
                      type="button"
                      onClick={() => handleToggleProjectReference(asset)}
                      className={`rounded-[16px] border p-2 text-left transition ${
                        active
                          ? "border-[var(--node-accent)] bg-[var(--node-surface-strong)]"
                          : "border-[var(--node-border)] bg-[var(--node-surface)] hover:border-[var(--node-border-strong)]"
                      }`}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <div className="flex gap-2">
                        <div className="h-12 w-12 overflow-hidden rounded-[12px] bg-black/20 shrink-0">
                          <img src={asset.url} alt={asset.label} className="h-full w-full object-cover" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[10px] font-semibold text-[var(--node-text-primary)]">
                            {asset.label}
                          </div>
                          <div className="mt-1 text-[8px] uppercase tracking-[0.14em] text-[var(--node-text-secondary)]">
                            Identity Card
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[16px] border border-dashed border-[var(--node-border)] px-3 py-2 text-[9px] text-[var(--node-text-secondary)]">
                项目卡片还没有可用设计图。
              </div>
            )}
          </div>

	          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => refVideoInputRef.current?.click()}
              disabled={isUploadingVideoRefs || referenceVideos.length >= 3 || manualRefs.length >= 5}
              className="node-button node-button-primary h-9 px-3 flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-[0.16em] disabled:opacity-60 nodrag"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Video size={12} />
              {isUploadingVideoRefs ? "Uploading" : "Add Video"}
            </button>
            <button
              type="button"
              onClick={() => refImageInputRef.current?.click()}
              disabled={isUploadingImageRefs || manualRefs.length >= 5}
              className="node-button h-9 px-3 flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-[0.16em] nodrag disabled:opacity-60"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <ImageIcon size={12} />
              {isUploadingImageRefs ? "Uploading" : "Add Image"}
            </button>
            <input
              ref={refVideoInputRef}
              type="file"
              accept="video/mp4,video/quicktime,.mp4,.mov"
              multiple
              className="hidden"
              onChange={(e) => handleReferenceVideoFiles(e.target.files)}
            />
	            <input
	              ref={refImageInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/bmp,image/webp,.jpg,.jpeg,.png,.bmp,.webp"
              multiple
              className="hidden"
	              onChange={(e) => handleReferenceImageFiles(e.target.files)}
	            />
	          </div>

	          <div className="grid grid-cols-2 gap-2">
	            <button
	              type="button"
	              onClick={() => firstFrameInputRef.current?.click()}
	              disabled={isUploadingFirstFrame}
	              className="node-button h-9 px-3 flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-[0.16em] nodrag disabled:opacity-60"
	              onMouseDown={(e) => e.stopPropagation()}
	            >
	              <ImageIcon size={12} />
	              {isUploadingFirstFrame ? "Uploading" : "Add First Frame"}
	            </button>
	            <button
	              type="button"
	              onClick={() => refVoiceInputRef.current?.click()}
	              disabled={isUploadingVoiceRef}
	              className="node-button h-9 px-3 flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-[0.16em] nodrag disabled:opacity-60"
	              onMouseDown={(e) => e.stopPropagation()}
	            >
	              <AudioLines size={12} />
	              {isUploadingVoiceRef ? "Uploading" : "Add Voice"}
	            </button>
	            <input
	              ref={firstFrameInputRef}
	              type="file"
	              accept="image/jpeg,image/jpg,image/png,image/bmp,image/webp,.jpg,.jpeg,.png,.bmp,.webp"
	              className="hidden"
	              onChange={(e) => handleFirstFrameFiles(e.target.files)}
	            />
	            <input
	              ref={refVoiceInputRef}
	              type="file"
	              accept="audio/mpeg,audio/mp3,audio/wav,.mp3,.wav"
	              className="hidden"
	              onChange={(e) => handleReferenceVoiceFiles(e.target.files)}
	            />
	          </div>

	          {(firstFrameImage || effectiveVoiceCount > 0) && (
	            <div className="grid grid-cols-2 gap-2">
	              <div className="rounded-[14px] border border-white/10 bg-black/20 p-2">
	                <div className="mb-2 text-[8px] font-bold uppercase tracking-[0.16em] text-white/60">first frame</div>
	                {firstFrameImage ? (
	                  <div className="relative overflow-hidden rounded-[12px] bg-black/30 aspect-[4/5]">
	                    <img
	                      src={firstFrameImage}
	                      alt="first frame"
	                      className="h-full w-full object-cover nodrag"
	                      onMouseDown={(e) => e.stopPropagation()}
	                      onPointerDown={(e) => e.stopPropagation()}
	                    />
	                    <button
	                      type="button"
	                      onClick={() => updateNodeData(id, { firstFrameImage: null })}
	                      className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/45 text-white/80 transition hover:bg-black/65"
	                      onMouseDown={(e) => e.stopPropagation()}
	                    >
	                      <X size={10} />
	                    </button>
	                  </div>
	                ) : (
	                  <div className="rounded-[12px] border border-dashed border-[var(--node-border)] px-2 py-3 text-[8px] text-[var(--node-text-secondary)]">
	                    未设置首帧。
	                  </div>
	                )}
	              </div>
	              <div className="rounded-[14px] border border-white/10 bg-black/20 p-2">
	                <div className="mb-2 text-[8px] font-bold uppercase tracking-[0.16em] text-white/60">reference voice</div>
	                {effectiveVoiceCount > 0 ? (
	                  <div className="space-y-2">
	                    <div className="flex items-center gap-2 rounded-[12px] border border-white/10 bg-white/5 px-2 py-2 text-[9px] text-[var(--node-text-primary)]">
	                      <Mic size={12} className="text-emerald-300" />
	                      <span className="min-w-0 flex-1 truncate">
	                        {referenceAudios.length > 0 ? "manual voice" : "linked audio"}
	                        {selectedVoiceTargetLabel ? ` -> ${selectedVoiceTargetLabel}` : ""}
	                      </span>
	                      {referenceAudios.length > 0 ? (
	                        <button
	                          type="button"
	                          onClick={() => updateNodeData(id, { referenceAudios: [], referenceVoiceTarget: null })}
	                          className="flex h-5 w-5 items-center justify-center rounded-full bg-black/45 text-white/80 transition hover:bg-black/65"
	                          onMouseDown={(e) => e.stopPropagation()}
	                        >
	                          <X size={10} />
	                        </button>
	                      ) : null}
	                    </div>
                      {voiceTargetOptions.length > 0 ? (
                        <div className="space-y-1">
                          <div className="text-[8px] uppercase tracking-[0.14em] text-[var(--node-text-secondary)]">
                            绑定目标
                          </div>
                          <select
                            className="node-control node-control--tight w-full text-[9px] font-semibold px-2 text-[var(--node-text-primary)] nodrag"
                            value={selectedVoiceTargetValue}
                            onChange={(e) => updateNodeData(id, { referenceVoiceTarget: e.target.value })}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            {voiceTargetOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label} · {option.source}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div className="rounded-[12px] border border-dashed border-[var(--node-border)] px-2 py-2 text-[8px] text-[var(--node-text-secondary)]">
                          请先添加至少一个图片或视频参考，再绑定参考音色。
                        </div>
                      )}
	                  </div>
	                ) : (
	                  <div className="rounded-[12px] border border-dashed border-[var(--node-border)] px-2 py-3 text-[8px] text-[var(--node-text-secondary)]">
	                    未设置参考音色。
	                  </div>
	                )}
	              </div>
	            </div>
	          )}

          {manualRefs.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {manualRefs.map((asset, index) => {
                const videoIndex = asset.kind === "video"
                  ? referenceVideos.findIndex((url) => url === asset.url)
                  : -1;
                const imageIndex = asset.kind === "image"
                  ? referenceImages.findIndex((url) => url === asset.url)
                  : -1;
                return (
                  <div
                    key={`${asset.kind}-${asset.url}-${index}`}
                    className="relative overflow-hidden rounded-[14px] border border-white/10 bg-black/20 aspect-[4/5]"
                  >
                    {asset.kind === "video" ? (
                      <video
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover nodrag"
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <source src={asset.url} />
                      </video>
                    ) : (
                      <img
                        src={asset.url}
                        alt={`character${index + 1}`}
                        className="h-full w-full object-cover nodrag"
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                      />
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/72 to-transparent px-2 pb-2 pt-5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[8px] font-bold uppercase tracking-[0.16em] text-white/90">
                            manual ref
                          </div>
                          <div className="text-[8px] uppercase tracking-[0.12em] text-white/60">
                            {asset.kind}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveReference(asset, asset.kind === "video" ? videoIndex : imageIndex)}
                          className="flex h-5 w-5 items-center justify-center rounded-full bg-black/45 text-white/80 transition hover:bg-black/65"
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <X size={10} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {hasConnectedImages && (
          <div className="text-[10px] uppercase tracking-[0.2em] font-black text-[var(--node-text-secondary)]/70">
            linked images act as fallback refs after project cards and manual uploads
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className={`h-1.5 w-1.5 rounded-full ${
                  data.status === "complete"
                    ? "bg-emerald-500 shadow-[0_0_8px_var(--accent-green)]"
                    : data.status === "loading"
                      ? "bg-amber-500 animate-pulse"
                      : "bg-[var(--node-text-secondary)] opacity-20"
                }`}
              />
              <span className="text-[9px] font-black uppercase tracking-widest text-[var(--node-text-secondary)]">
                {data.status}
              </span>
            </div>
            <div className="text-[9px] font-black uppercase tracking-widest text-[var(--node-text-secondary)]">
              WAN R2V
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5 nodrag">
            <select
              className="node-control node-control--tight text-[9px] font-bold px-2 text-[var(--node-text-secondary)] outline-none appearance-none cursor-pointer transition-colors w-full nodrag"
              value={currentModel}
              onChange={(e) => updateNodeData(id, { model: e.target.value })}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <option value={QWEN_WAN_REFERENCE_VIDEO_MODEL}>wan2.7-r2v</option>
            </select>

            <div
              className="node-control node-control--tight flex items-center justify-center px-2 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--node-text-secondary)]"
              onMouseDown={(e) => e.stopPropagation()}
            >
              图片N / 视频N
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5 nodrag">
            <select
              className="node-control node-control--tight text-[9px] font-bold px-2 text-[var(--node-text-secondary)] outline-none appearance-none cursor-pointer transition-colors w-full nodrag"
              value={currentResolution}
              onChange={(e) => {
                const nextResolution = e.target.value.toUpperCase();
                const nextOptions = aspectRatioOptions[nextResolution] || allowedAspectOptions;
                const nextAspect = nextOptions.some((opt) => opt.value === data.aspectRatio)
                  ? data.aspectRatio
                  : nextOptions[0].value;
                updateNodeData(id, { resolution: nextResolution, aspectRatio: nextAspect });
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <option value="720P">720P</option>
              <option value="1080P">1080P</option>
            </select>

            <select
              className="node-control node-control--tight text-[9px] font-bold px-2 text-[var(--node-text-secondary)] outline-none appearance-none cursor-pointer transition-colors w-full nodrag"
              value={currentAspect}
              onChange={(e) => updateNodeData(id, { aspectRatio: e.target.value })}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {allowedAspectOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-1.5 nodrag">
            <div className="node-control node-control--tight flex items-center gap-2 px-2">
              <Video size={11} className="text-[var(--node-text-secondary)]" />
              <input
                type="number"
                min={2}
                max={10}
                className="w-full bg-transparent text-[9px] font-semibold text-[var(--node-text-primary)] outline-none nodrag"
                value={currentDuration}
                onChange={(e) => {
                  const next = clampDuration(Number(e.target.value) || 5);
                  updateNodeData(id, { duration: `${next}s` });
                }}
                onMouseDown={(e) => e.stopPropagation()}
              />
            </div>
            <div className="node-control node-control--tight w-full px-2 text-[var(--node-text-secondary)] text-[9px] font-bold text-center uppercase tracking-wide truncate">
              refs {totalReferenceCount}/5
            </div>
          </div>
        </div>

        <div className="node-panel space-y-2 p-3 nodrag">
          <label className="text-[8px] font-black uppercase tracking-widest text-[var(--node-text-secondary)] opacity-70">
            WAN 参数
          </label>
          <div className="flex items-center justify-between text-[9px] font-semibold text-[var(--node-text-secondary)]">
            <span>添加水印</span>
            <button
              className={`h-5 w-9 rounded-full border transition-all ${data.watermark ? "bg-emerald-500/20 border-emerald-400/40" : "bg-white/5 border-white/10"}`}
              onClick={() => updateNodeData(id, { watermark: !data.watermark })}
            >
              <span className={`block h-4 w-4 rounded-full bg-white/70 transition-all ${data.watermark ? "translate-x-4" : "translate-x-1"}`} />
            </button>
          </div>
          <div className="space-y-1">
            <label className="text-[8px] uppercase tracking-widest text-[var(--node-text-secondary)]">随机种子</label>
            <input
              type="number"
              min={0}
              className="node-control node-control--tight w-full text-[9px] font-semibold px-2 text-[var(--node-text-primary)] nodrag"
              value={data.seed ?? ""}
              onChange={(e) => {
                const next = e.target.value === "" ? undefined : Number(e.target.value);
                updateNodeData(id, { seed: Number.isFinite(next) ? next : undefined });
              }}
              onMouseDown={(e) => e.stopPropagation()}
            />
          </div>
          <div className="rounded-[14px] border border-dashed border-[var(--node-border)] px-3 py-2 text-[9px] leading-5 text-[var(--node-text-secondary)]">
            Wan 2.7 会按输入顺序理解参考素材。视频按 <span className="text-[var(--node-text-primary)] font-semibold">视频1 / 视频2</span> 编号，图片按
            <span className="text-[var(--node-text-primary)] font-semibold"> 图片1 / 图片2</span> 编号。
          </div>
        </div>

        {data.error && (
          <div className="node-alert p-3 flex gap-2 items-start animate-in fade-in slide-in-from-top-2">
            <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
            <span className="text-[10px] text-red-500/90 font-bold uppercase tracking-tight leading-tight">
              {data.error}
            </span>
          </div>
        )}
      </div>
    </BaseNode>
  );
};
