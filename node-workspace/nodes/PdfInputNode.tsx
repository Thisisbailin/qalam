import React, { useEffect, useRef, useState } from "react";
import {
  CloudArrowUp,
  FilePdf,
  Info,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import { BaseNode } from "./BaseNode";
import type { PdfInputNodeData } from "../types";
import { useNodeFlowStore } from "../store/nodeFlowStore";
import {
  collectOwnedStorageObjects,
  deleteOwnedStorageObjects,
  resolvePrivateStorageUrl,
  uploadStorageFile,
} from "../nodeflow/storageObjects";

type Props = {
  id: string;
  data: PdfInputNodeData;
  selected?: boolean;
};

const MAX_PDF_BYTES = 64 * 1024 * 1024;

const formatBytes = (value?: number | null) => {
  if (!value || !Number.isFinite(value)) return null;
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
};

const buildPdfStorageName = (filename: string) => {
  const safeBase = filename
    .replace(/\.pdf$/i, "")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 64) || "document";
  return `pdf-inputs/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeBase}.pdf`;
};

const isPdfFile = (file: File) =>
  file.type === "application/pdf" || file.name.toLocaleLowerCase().endsWith(".pdf");

export const PdfInputNode: React.FC<Props> = ({ id, data, selected }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { updateNodeData, nodeFlowContext } = useNodeFlowStore();
  const projectId = nodeFlowContext.projectId || "";
  const [isUploading, setIsUploading] = useState(false);
  const [storageMessage, setStorageMessage] = useState<string | null>(null);
  const [resolvedStorageUrl, setResolvedStorageUrl] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState(data.label || "");
  const displayPdf = resolvedStorageUrl || data.pdf;
  const displayName =
    data.label?.trim() ||
    data.filename?.replace(/\.pdf$/i, "") ||
    (data.title && data.title !== "PDF Input" ? data.title : "") ||
    "未命名 PDF";

  useEffect(() => {
    setLabelDraft(data.label || "");
  }, [data.label]);

  useEffect(() => {
    setResolvedStorageUrl(null);
    if (!data.storagePath || !projectId) return;
    let cancelled = false;
    setStorageMessage("正在刷新 PDF 访问地址…");
    resolvePrivateStorageUrl({
      bucket: data.storageBucket || "assets",
      path: data.storagePath,
    }, projectId)
      .then((url) => {
        if (!cancelled && url) setResolvedStorageUrl(url);
        if (!cancelled) setStorageMessage(null);
      })
      .catch((error) => {
        if (!cancelled) {
          setStorageMessage(error instanceof Error ? error.message.replaceAll("图片", "PDF") : "PDF 访问地址刷新失败。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [data.storageBucket, data.storagePath, projectId]);

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    if (!isPdfFile(file)) {
      setStorageMessage("请选择 PDF 文件。");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setStorageMessage("PDF 超过 64 MB 项目资源上限。");
      return;
    }
    if (!projectId) {
      setStorageMessage("当前项目缺少资源作用域，无法保存 PDF。");
      return;
    }

    setIsUploading(true);
    setStorageMessage("正在保存至项目资源…");
    try {
      const uploaded = await uploadStorageFile(file, {
        fileName: buildPdfStorageName(file.name),
        bucket: "assets",
        contentType: "application/pdf",
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
      const baseName = file.name.replace(/\.pdf$/i, "") || "PDF";
      updateNodeData(id, {
        pdf: uploaded.url,
        filename: file.name,
        storageBucket: uploaded.object.bucket,
        storagePath: uploaded.object.path,
        mimeType: "application/pdf",
        fileSize: file.size,
        highlights: [],
        title: data.title && data.title !== "PDF Input" ? data.title : baseName,
        label: data.label || baseName,
      });
      setStorageMessage(null);
    } catch (error) {
      setStorageMessage(error instanceof Error ? error.message.replaceAll("图片", "PDF") : "PDF 上传失败。");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleClear = async () => {
    if (projectId) {
      const objects = collectOwnedStorageObjects([{ data }]);
      if (objects.length) {
        try {
          await deleteOwnedStorageObjects(objects, projectId);
        } catch (error) {
          setStorageMessage(error instanceof Error ? error.message.replaceAll("图片", "PDF") : "PDF 资源删除失败。");
          return;
        }
      }
    }
    updateNodeData(id, {
      pdf: null,
      filename: null,
      storageBucket: null,
      storagePath: null,
      mimeType: "application/pdf",
      fileSize: null,
      highlights: [],
    });
    setStorageMessage(null);
  };

  const commitLabel = () => {
    const nextLabel = labelDraft.trim();
    if (nextLabel !== (data.label || "")) updateNodeData(id, { label: nextLabel });
  };

  const details = [
    formatBytes(data.fileSize),
    data.highlights.length ? `${data.highlights.length} 条高亮` : "无标注",
  ].filter(Boolean);

  return (
    <BaseNode
      title={displayName}
      inputs={["text"]}
      selected={selected}
      variant="media"
      nodeType="pdfInput"
      cardColor={data.cardColor}
    >
      <div className="pdf-input-shell">
        {displayPdf ? (
          <>
            <div className="pdf-input-page" aria-label={`${displayName}，双击打开 PDF 文稿`}>
              <div className="pdf-input-page__masthead">
                <FilePdf size={14} weight="duotone" aria-hidden="true" />
                <span>PDF DOCUMENT</span>
              </div>
              <div className="pdf-input-page__body">
                <span>PROJECT RESOURCE</span>
                <strong>{displayName}</strong>
                <i aria-hidden="true" />
                <i aria-hidden="true" />
                <i aria-hidden="true" />
                <small>双击打开文稿</small>
              </div>
              <div className="pdf-input-page__folio">
                <span>{data.filename || "document.pdf"}</span>
                <span>{details.join(" · ")}</span>
              </div>
            </div>

            {selected ? (
              <aside
                className="pdf-input-properties nodrag nowheel"
                aria-label="PDF 节点属性"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="pdf-input-properties__heading">
                  <Info size={15} weight="duotone" aria-hidden="true" />
                  <span>
                    <strong>PDF 属性</strong>
                    <small>{data.storagePath ? "项目私有资源" : "本地或旧版资源"}</small>
                  </span>
                </div>
                <label>
                  <span>Label</span>
                  <input
                    value={labelDraft}
                    placeholder={data.filename?.replace(/\.pdf$/i, "") || "未命名 PDF"}
                    onChange={(event) => setLabelDraft(event.target.value)}
                    onBlur={commitLabel}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitLabel();
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </label>
                <div className="pdf-input-properties__meta">
                  <span>{data.filename}</span>
                  <span>{details.join(" · ")}</span>
                  {storageMessage ? <span role="status">{storageMessage}</span> : null}
                </div>
                <div className="pdf-input-properties__actions">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                  >
                    {isUploading
                      ? <CloudArrowUp size={14} weight="duotone" aria-hidden="true" />
                      : <UploadSimple size={14} weight="duotone" aria-hidden="true" />}
                    {isUploading ? "上传中" : "替换"}
                  </button>
                  <button
                    type="button"
                    className="is-destructive"
                    onClick={() => void handleClear()}
                    aria-label="移除 PDF"
                    title="移除 PDF"
                  >
                    <Trash size={14} aria-hidden="true" />
                  </button>
                </div>
              </aside>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              fileInputRef.current?.click();
            }}
            className="pdf-input-empty"
            disabled={isUploading}
          >
            <FilePdf size={24} weight="duotone" aria-hidden="true" />
            <strong>{isUploading ? "正在保存 PDF" : "选择 PDF 文稿"}</strong>
            <span>{storageMessage || "PDF · 最大 64 MB"}</span>
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
      </div>
    </BaseNode>
  );
};
