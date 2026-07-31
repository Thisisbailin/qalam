import React, { useEffect, useMemo, useRef, useState } from "react";
import { BaseNode } from "./BaseNode";
import { SeedanceVideoGenNodeData } from "../types";
import { useNodeFlowStore } from "../store/nodeFlowStore";
import { useNodeFlowExecutor } from "../store/useNodeFlowExecutor";
import {
  AlertCircle,
  AudioLines,
  Download,
  Film,
  Image as ImageIcon,
  RefreshCw,
  Upload,
  Video,
  X,
} from "lucide-react";
import {
  SEEDANCE_DEFAULT_MODEL,
  SEEDANCE_FAST_MODEL,
} from "../../constants";
import { buildApiUrl } from "../../utils/api";
import { buildAuthorizedJsonHeaders } from "../../utils/authToken";

type Props = {
  id: string;
  data: SeedanceVideoGenNodeData;
  selected?: boolean;
};

const clampDuration = (value: number) => Math.max(4, Math.min(15, Math.round(value)));

export const SeedanceVideoGenNode: React.FC<Props> = ({ id, data, selected }) => {
  const { updateNodeData, getConnectedInputs, nodeFlowContext } = useNodeFlowStore();
  const projectId = nodeFlowContext.projectId || "";
  const { runVideoGen } = useNodeFlowExecutor();
  const [progress, setProgress] = useState(0);
  const [isUploadingVideoRefs, setIsUploadingVideoRefs] = useState(false);
  const refVideoInputRef = useRef<HTMLInputElement>(null);

  const { images: connectedImages, audios: connectedAudios, text: connectedText } = getConnectedInputs(id);
  const referenceVideos = Array.isArray(data.referenceVideos) ? data.referenceVideos.filter(Boolean) : [];
  const isLoading = data.status === "loading";
  const currentDuration = clampDuration(typeof data.duration === "number" ? data.duration : 5);

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

  const handleGenerate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await runVideoGen(id);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!data.videoUrl) return;
    const link = document.createElement("a");
    link.href = data.videoUrl;
    link.download = "seedance-video.mp4";
    link.rel = "noreferrer";
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const uploadReferenceVideo = async (file: File) => {
    if (!projectId) throw new Error("当前 Seedance 节点尚未绑定云端项目。");
    const safeName = file.name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").toLowerCase();
    const payload = {
      fileName: `seedance-reference-video/${Date.now()}-${safeName}`,
      bucket: "assets",
      contentType: file.type || "video/mp4",
      fileSize: file.size,
      projectId,
    };
    const res = await fetch(buildApiUrl("/api/upload-url"), {
      method: "POST",
      headers: await buildAuthorizedJsonHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const message = await res.text();
      throw new Error(`Upload URL error ${res.status}: ${message || "unknown error"}`);
    }
    const dataRes = await res.json() as {
      signedUrl?: string;
      publicUrl?: string;
      path?: string;
      bucket?: string;
    };
    if (!dataRes?.signedUrl) throw new Error("Missing signedUrl");

    const uploadRes = await fetch(dataRes.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": payload.contentType },
      body: file,
    });
    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      throw new Error(`Upload failed ${uploadRes.status}: ${text}`);
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
    if (!url) throw new Error("Missing uploaded video URL");
    return url;
  };

  const handleReferenceVideos = async (files: FileList | null) => {
    if (!files?.length) return;
    const capacity = Math.max(0, 3 - referenceVideos.length);
    if (capacity === 0) {
      updateNodeData(id, { error: "Seedance 最多支持 3 个参考视频。" });
      return;
    }
    setIsUploadingVideoRefs(true);
    try {
      const selected = Array.from(files).slice(0, capacity);
      const uploaded: string[] = [];
      for (const file of selected) {
        uploaded.push(await uploadReferenceVideo(file));
      }
      updateNodeData(id, {
        referenceVideos: [...referenceVideos, ...uploaded],
        error: null,
      });
    } catch (e: any) {
      updateNodeData(id, { error: e?.message || "参考视频上传失败。" });
    } finally {
      setIsUploadingVideoRefs(false);
      if (refVideoInputRef.current) refVideoInputRef.current.value = "";
    }
  };

  const modeSummary = useMemo(
    () =>
      "多模态参考生视频：输入参考图片（0~9）+参考视频（0~3）+ 参考音频（0~3）+ 文本提示词（可选）生成 1 个目标视频。支持生成全新视频、编辑视频、延长视频。注意：不可单独输入音频，应至少包含 1 个参考视频或图片。",
    []
  );

  return (
    <BaseNode
      title={data.title || "Seedance"}
      onTitleChange={(title) => updateNodeData(id, { title })}
      inputs={["image", "text", "audio"]}
      selected={selected}
    >
      <div className="space-y-4 flex-1 flex flex-col">
        {data.videoUrl ? (
          <div className="node-surface relative overflow-hidden rounded-[20px] shadow-[0_18px_40px_rgba(0,0,0,0.45)]">
            <video
              controls
              playsInline
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
                : "hover:border-sky-500/30 hover:bg-sky-500/[0.02]"
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
                <div className="h-14 w-14 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-center mb-4 shadow-inner">
                  <Film className="text-[var(--node-text-secondary)]" size={28} />
                </div>
                <div className="flex flex-col items-center gap-1 text-center px-8">
                  <span className="text-[10px] opacity-40 uppercase tracking-[0.2em] font-black text-white">
                    Seedance
                  </span>
                  <span className="text-[8px] opacity-30 uppercase tracking-[0.12em] font-bold text-white/80">
                    Multimodal Reference Video
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
              >
                <RefreshCw size={12} />
                重试
              </button>
            )}
          </div>
        )}

        <div className="node-panel space-y-3 p-3 nodrag">
          <div className="space-y-1">
            <div className="text-[8px] font-black uppercase tracking-widest text-[var(--node-text-secondary)] opacity-70">
              模式
            </div>
            <div className="rounded-[16px] border border-[var(--node-border)] bg-[var(--node-surface)] px-3 py-2">
              <div className="text-[10px] font-semibold text-[var(--node-text-primary)]">多模态参考生视频</div>
              <div className="mt-1 text-[9px] leading-5 text-[var(--node-text-secondary)]">{modeSummary}</div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 text-[10px] uppercase tracking-[0.18em] font-black text-[var(--node-text-secondary)]/70">
            <div className="flex items-center gap-1">
              <ImageIcon size={11} />
              {connectedImages.length}
            </div>
            <div className="flex items-center justify-center gap-1">
              <Video size={11} />
              {referenceVideos.length}
            </div>
            <div className="flex items-center justify-center gap-1">
              <AudioLines size={11} />
              {connectedAudios.length}
            </div>
            <div className="text-right">{connectedText ? "prompt" : "no text"}</div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <select
              className="node-control node-control--tight text-[9px] font-bold px-2 text-[var(--node-text-secondary)] outline-none appearance-none cursor-pointer transition-colors w-full nodrag"
              value={data.model || SEEDANCE_DEFAULT_MODEL}
              onChange={(e) => updateNodeData(id, { model: e.target.value as SeedanceVideoGenNodeData["model"] })}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <option value={SEEDANCE_DEFAULT_MODEL}>Seedance 2.0</option>
              <option value={SEEDANCE_FAST_MODEL}>Seedance 2.0 Fast</option>
            </select>

            <select
              className="node-control node-control--tight text-[9px] font-bold px-2 text-[var(--node-text-secondary)] outline-none appearance-none cursor-pointer transition-colors w-full nodrag"
              value={data.resolution || "720p"}
              onChange={(e) => updateNodeData(id, { resolution: e.target.value as SeedanceVideoGenNodeData["resolution"] })}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <option value="480p">480p</option>
              <option value="720p">720p</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <select
              className="node-control node-control--tight text-[9px] font-bold px-2 text-[var(--node-text-secondary)] outline-none appearance-none cursor-pointer transition-colors w-full nodrag"
              value={data.ratio || "adaptive"}
              onChange={(e) => updateNodeData(id, { ratio: e.target.value as SeedanceVideoGenNodeData["ratio"] })}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <option value="adaptive">Adaptive</option>
              <option value="16:9">16:9</option>
              <option value="4:3">4:3</option>
              <option value="1:1">1:1</option>
              <option value="3:4">3:4</option>
              <option value="9:16">9:16</option>
              <option value="21:9">21:9</option>
            </select>

            <div className="node-control node-control--tight flex items-center gap-2 px-2">
              <Video size={11} className="text-[var(--node-text-secondary)]" />
              <input
                type="number"
                min={4}
                max={15}
                className="w-full bg-transparent text-[9px] font-semibold text-[var(--node-text-primary)] outline-none nodrag"
                value={currentDuration}
                onChange={(e) => updateNodeData(id, { duration: clampDuration(Number(e.target.value) || 5) })}
                onMouseDown={(e) => e.stopPropagation()}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => refVideoInputRef.current?.click()}
              disabled={isUploadingVideoRefs || referenceVideos.length >= 3}
              className="node-button h-9 px-3 flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-[0.16em] nodrag disabled:opacity-60"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Upload size={12} />
              {isUploadingVideoRefs ? "Uploading" : "Add Video"}
            </button>
            <div className="node-control node-control--tight w-full px-2 text-[var(--node-text-secondary)] text-[9px] font-bold text-center uppercase tracking-wide truncate">
              refs {referenceVideos.length}/3
            </div>
            <input
              ref={refVideoInputRef}
              type="file"
              accept="video/mp4,video/quicktime,.mp4,.mov"
              multiple
              className="hidden"
              onChange={(e) => handleReferenceVideos(e.target.files)}
            />
          </div>

          {referenceVideos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {referenceVideos.map((url, index) => (
                <div
                  key={`${url}-${index}`}
                  className="relative overflow-hidden rounded-[14px] border border-white/10 bg-black/20 aspect-[4/5]"
                >
                  <video
                    muted
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-cover nodrag"
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <source src={url} />
                  </video>
                  <button
                    type="button"
                    onClick={() =>
                      updateNodeData(id, {
                        referenceVideos: referenceVideos.filter((_, itemIndex) => itemIndex !== index),
                      })
                    }
                    className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/45 text-white/80 transition hover:bg-black/65"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="node-panel space-y-2 p-3 nodrag">
          <label className="text-[8px] font-black uppercase tracking-widest text-[var(--node-text-secondary)] opacity-70">
            输出设置
          </label>
          <div className="flex items-center justify-between text-[9px] font-semibold text-[var(--node-text-secondary)]">
            <span>生成同步音频</span>
            <button
              className={`h-5 w-9 rounded-full border transition-all ${
                data.generateAudio !== false ? "bg-emerald-500/20 border-emerald-400/40" : "bg-white/5 border-white/10"
              }`}
              onClick={() => updateNodeData(id, { generateAudio: data.generateAudio === false })}
            >
              <span
                className={`block h-4 w-4 rounded-full bg-white/70 transition-all ${
                  data.generateAudio !== false ? "translate-x-4" : "translate-x-1"
                }`}
              />
            </button>
          </div>
          <div className="flex items-center justify-between text-[9px] font-semibold text-[var(--node-text-secondary)]">
            <span>添加水印</span>
            <button
              className={`h-5 w-9 rounded-full border transition-all ${
                data.watermark ? "bg-emerald-500/20 border-emerald-400/40" : "bg-white/5 border-white/10"
              }`}
              onClick={() => updateNodeData(id, { watermark: !data.watermark })}
            >
              <span
                className={`block h-4 w-4 rounded-full bg-white/70 transition-all ${
                  data.watermark ? "translate-x-4" : "translate-x-1"
                }`}
              />
            </button>
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
