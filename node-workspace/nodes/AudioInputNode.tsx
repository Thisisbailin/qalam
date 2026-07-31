import React, { useEffect, useRef, useState } from "react";
import { BaseNode } from "./BaseNode";
import { AudioInputNodeData } from "../types";
import { useNodeFlowStore } from "../store/nodeFlowStore";
import { UploadSimple, Waveform, X } from "@phosphor-icons/react";
import {
  collectOwnedStorageObjects,
  deleteOwnedStorageObjects,
  resolvePrivateStorageUrl,
  uploadStorageFile,
} from "../nodeflow/storageObjects";

type Props = {
  id: string;
  data: AudioInputNodeData;
  selected?: boolean;
};

const buildAudioStorageName = (file: File) => {
  const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "")
    || file.type.split("/")[1]?.replace(/[^a-z0-9]/gi, "")
    || "audio";
  const base = file.name
    .replace(/\.[^/.]+$/, "")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 48) || "audio";
  return `audio-inputs/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${base}.${extension}`;
};

export const AudioInputNode: React.FC<Props> = ({ id, data, selected }) => {
  const { updateNodeData, nodeFlowContext } = useNodeFlowStore();
  const projectId = nodeFlowContext.projectId || "";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [resolvedStorageUrl, setResolvedStorageUrl] = useState<string | null>(null);
  const displayAudio = resolvedStorageUrl || data.audio;
  const nodeTitle = data.title && data.title !== "Audio Input" ? data.title : "audio";

  useEffect(() => {
    setResolvedStorageUrl(null);
    if (!data.storagePath || !projectId) return;
    let cancelled = false;
    resolvePrivateStorageUrl({
      bucket: data.storageBucket || "assets",
      path: data.storagePath,
    }, projectId)
      .then((url) => {
        if (!cancelled && url) setResolvedStorageUrl(url);
      })
      .catch((error) => {
        if (!cancelled) console.warn("Refresh audio signed URL failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, [data.storageBucket, data.storagePath, projectId]);

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    if (!projectId) return;
    setIsLoading(true);
    try {
      const uploaded = await uploadStorageFile(file, {
        fileName: buildAudioStorageName(file),
        bucket: "assets",
        contentType: file.type || "audio/mpeg",
        projectId,
      });
      const previousObjects = collectOwnedStorageObjects([{ data }]);
      if (previousObjects.length) {
        try {
          await deleteOwnedStorageObjects(previousObjects, projectId);
        } catch (error) {
          await deleteOwnedStorageObjects([uploaded.object], projectId).catch(() => undefined);
          throw error;
        }
      }
      updateNodeData(id, {
        audio: uploaded.url,
        filename: file.name,
        storageBucket: uploaded.object.bucket,
        storagePath: uploaded.object.path,
        mimeType: file.type || "audio/mpeg",
      });
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <BaseNode
      title={nodeTitle}
      onTitleChange={(title) => updateNodeData(id, { title })}
      outputs={["audio"]}
      selected={selected}
      variant="media"
      nodeType="audioInput"
    >
      <div className="media-input-frame flex-1">
        {displayAudio ? (
          <>
            <div className="audio-input-media media-input-asset">
              <div className="audio-input-icon">
                <Waveform className="text-[var(--node-text-secondary)]" size={28} />
              </div>
              <div className="audio-input-kicker">Audio Reference</div>
            </div>
            <div className="media-input-info">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 truncate text-[12px] font-semibold text-[var(--node-text-primary)]">
                  {data.filename || "untitled-audio"}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const objects = collectOwnedStorageObjects([{ data }]);
                    if (objects.length && projectId) {
                      void deleteOwnedStorageObjects(objects, projectId).catch((error) => {
                        console.warn("Delete audio storage object failed", error);
                      });
                    }
                    updateNodeData(id, {
                      audio: null,
                      filename: null,
                      storageBucket: null,
                      storagePath: null,
                      mimeType: null,
                      durationMs: null,
                    });
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--node-border)] text-[var(--node-text-secondary)] transition hover:border-[var(--node-border-strong)] hover:text-[var(--node-text-primary)]"
                >
                  <X size={12} />
                </button>
              </div>
            <audio
              controls
              preload="metadata"
              className="w-full nodrag"
              onLoadedMetadata={(event) => {
                const duration = event.currentTarget.duration;
                if (Number.isFinite(duration)) {
                  updateNodeData(id, { durationMs: Math.round(duration * 1000) });
                }
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <source src={displayAudio} type={data.mimeType || undefined} />
            </audio>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="node-button h-9 px-3 flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-[0.16em] nodrag"
                >
                  <UploadSimple size={12} />
                  Replace
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
              <Waveform size={22} weight="duotone" />
            </div>
            <div className="media-input-empty-copy">
              <div className="media-input-empty-kicker">Audio Input</div>
              <div className="media-input-empty-title">{isLoading ? "Reading audio…" : "Drop or choose audio"}</div>
              <div className="media-input-empty-subtitle">MP3, WAV · click to upload</div>
            </div>
            <div className="media-input-empty-cta">Select File</div>
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,.mp3,.wav"
          className="hidden"
          onChange={(event) => handleFile(event.target.files?.[0])}
        />
      </div>
    </BaseNode>
  );
};
