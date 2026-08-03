import React, { useEffect, useRef, useState } from "react";
import { BaseNode } from "./BaseNode";
import { VideoInputNodeData } from "../types";
import { useNodeFlowStore } from "../store/nodeFlowStore";
import { FilmStrip, UploadSimple, X } from "@phosphor-icons/react";
import { buildApiUrl } from "../../utils/api";
import { buildAuthorizedJsonHeaders } from "../../utils/authToken";

type Props = {
  id: string;
  data: VideoInputNodeData;
  selected?: boolean;
};

type UploadedVideo = {
  url: string;
  bucket: string;
  path: string;
};

const resolveSignedVideoUrl = async (path: string, bucket: string, projectId: string) => {
  const downloadRes = await fetch(buildApiUrl("/api/download-url"), {
    method: "POST",
    headers: await buildAuthorizedJsonHeaders(),
    body: JSON.stringify({ projectId, path, bucket }),
  });
  if (!downloadRes.ok) {
    const err = await downloadRes.text();
    throw new Error(`Video download URL error (${downloadRes.status}): ${err}`);
  }
  const downloadData = await downloadRes.json() as { signedUrl?: string };
  if (!downloadData?.signedUrl) {
    throw new Error("Video download failed: missing signedUrl.");
  }
  return downloadData.signedUrl as string;
};

const uploadVideoFile = async (file: File, projectId: string) => {
  const contentType = file.type || "video/mp4";
  const ext = file.name.split(".").pop() || contentType.split("/")[1] || "mp4";
  const fileName = `video-inputs/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const signedRes = await fetch(buildApiUrl("/api/upload-url"), {
    method: "POST",
    headers: await buildAuthorizedJsonHeaders(),
    body: JSON.stringify({
      projectId,
      fileName,
      bucket: "assets",
      contentType,
      fileSize: file.size,
    }),
  });
  if (!signedRes.ok) {
    const err = await signedRes.text();
    throw new Error(`Video upload URL error (${signedRes.status}): ${err}`);
  }

  const signedData = await signedRes.json() as {
    signedUrl?: string;
    bucket?: string;
    path?: string;
    publicUrl?: string;
  };
  if (!signedData?.signedUrl) {
    throw new Error("Video upload failed: missing signedUrl.");
  }

  const uploadRes = await fetch(signedData.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file,
  });
  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Video upload failed (${uploadRes.status}): ${err}`);
  }

  const bucket = signedData.bucket || "assets";
  const path = signedData.path || "";
  if (signedData.publicUrl) {
    return { url: signedData.publicUrl as string, bucket, path };
  }
  if (signedData.path) {
    return {
      url: await resolveSignedVideoUrl(signedData.path, bucket, projectId),
      bucket,
      path,
    } satisfies UploadedVideo;
  }
  throw new Error("Video upload failed: missing accessible URL.");
};

const formatDuration = (durationMs?: number | null) => {
  if (!durationMs || !Number.isFinite(durationMs)) return null;
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

export const VideoInputNode: React.FC<Props> = ({ id, data, selected }) => {
  const { updateNodeData, nodeFlowContext } = useNodeFlowStore();
  const projectId = nodeFlowContext.projectId || "";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRefreshingUrl, setIsRefreshingUrl] = useState(false);
  const [resolvedStorageUrl, setResolvedStorageUrl] = useState<string | null>(null);
  const displayVideo = resolvedStorageUrl || data.video;
  const nodeTitle = data.title && data.title !== "Video Input" ? data.title : "video";

  useEffect(() => {
    setResolvedStorageUrl(null);
    if (!data.storagePath) return;
    let cancelled = false;
    setIsRefreshingUrl(true);
    if (!projectId) return;
    resolveSignedVideoUrl(data.storagePath, data.storageBucket || "assets", projectId)
      .then((url) => {
        if (!cancelled && url) setResolvedStorageUrl(url);
      })
      .catch((error) => {
        console.warn("Refresh video signed URL failed", error);
      })
      .finally(() => {
        if (!cancelled) setIsRefreshingUrl(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data.storageBucket, data.storagePath, projectId]);

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    if (!projectId) return;
    setIsUploading(true);
    try {
      const uploaded = await uploadVideoFile(file, projectId);
      updateNodeData(id, {
        video: uploaded.url,
        filename: file.name,
        storageBucket: uploaded.bucket,
        storagePath: uploaded.path,
        mimeType: file.type || "video/mp4",
        durationMs: null,
        dimensions: null,
        model: null,
        resolution: null,
        aspectRatio: null,
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleVideoClick = (event: React.MouseEvent<HTMLVideoElement>) => {
    event.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  };

  const infoItems = [
    data.filename || null,
    data.model ? `model ${data.model}` : null,
    data.resolution || null,
    data.aspectRatio ? `ratio ${data.aspectRatio}` : null,
    formatDuration(data.durationMs),
    data.dimensions?.width && data.dimensions?.height ? `${data.dimensions.width}×${data.dimensions.height}` : null,
  ].filter(Boolean);

  return (
    <BaseNode
      title={nodeTitle}
      onTitleChange={(title) => updateNodeData(id, { title })}
      outputs={["video"]}
      selected={selected}
      variant="media"
      nodeType="videoInput"
      cardColor={data.cardColor}
    >
      <div className="media-input-frame flex-1">
        {displayVideo ? (
          <>
            <video
              ref={videoRef}
              src={displayVideo}
              className="video-input-media media-input-asset block w-full aspect-video bg-black nodrag cursor-pointer"
              playsInline
              preload="metadata"
              onClick={handleVideoClick}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onLoadedMetadata={(event) => {
                const duration = event.currentTarget.duration;
                updateNodeData(id, {
                  durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : data.durationMs ?? null,
                  dimensions:
                    event.currentTarget.videoWidth && event.currentTarget.videoHeight
                      ? { width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight }
                      : data.dimensions ?? null,
                });
              }}
            />

            <div className="media-input-info">
              <div className="min-w-0 truncate text-[12px] font-semibold text-[var(--node-text-primary)]">
                {data.filename || "untitled-video"}
              </div>
              {infoItems.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {infoItems.map((item, index) => (
                    <span
                      key={`${item}-${index}`}
                      className="rounded-full border border-[var(--node-border)] bg-white/5 px-2 py-1 text-[10px] text-[var(--node-text-secondary)]"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-[9px] leading-5 text-[var(--node-text-secondary)]">
                点击视频播放 / 暂停。替换文件请使用下方按钮。
              </div>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="node-button h-9 px-3 flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-[0.16em] nodrag"
                >
                  <UploadSimple size={12} />
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateNodeData(id, {
                      video: null,
                      filename: null,
                      storageBucket: null,
                      storagePath: null,
                      mimeType: null,
                      durationMs: null,
                      dimensions: null,
                      model: null,
                      resolution: null,
                      aspectRatio: null,
                    })
                  }
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--node-border)] text-[var(--node-text-secondary)] transition hover:border-[var(--node-border-strong)] hover:text-[var(--node-text-primary)]"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="media-input-empty"
          >
            <div className="media-input-empty-icon">
              <FilmStrip size={22} weight="duotone" />
            </div>
            <div className="media-input-empty-copy">
              <div className="media-input-empty-kicker">Video Input</div>
              <div className="media-input-empty-title">
                {isUploading ? "Uploading video…" : isRefreshingUrl ? "Refreshing video…" : "Drop or choose video"}
              </div>
              <div className="media-input-empty-subtitle">MP4, MOV, WebM · click to upload</div>
            </div>
            <div className="media-input-empty-cta">Select File</div>
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
          className="hidden"
          onChange={(event) => handleFile(event.target.files?.[0])}
        />
      </div>
    </BaseNode>
  );
};
