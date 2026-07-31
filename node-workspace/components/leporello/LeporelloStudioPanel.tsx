import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowsInSimple, ArrowsOutSimple, Check, PencilSimple, Plus, UploadSimple, X } from "@phosphor-icons/react";
import type { ProjectData } from "../../../types";
import { inspectLookbookImageFile } from "../../lookbook/imageFiles";
import { resolvePrivateStorageUrl, uploadStorageFile } from "../../nodeflow/storageObjects";
import {
  LEPORELLO_MAX_PAGES,
  addLeporelloPanel,
  getLeporelloBook,
  getLeporelloNode,
  getLeporelloPageImage,
  resolveLeporelloProjectName,
  setLeporelloPageImage,
} from "../../../utils/leporelloWorkspace";
import { saveActiveFlowIntoProjects } from "../../foundation/scaffold";
import "../../styles/leporello-studio.css";

type Props = {
  projectData: ProjectData;
  setProjectData: React.Dispatch<React.SetStateAction<ProjectData>>;
  leporelloNodeId: string;
  onClose: () => void;
};

type SketchStartResult = { ok: boolean; sessionId?: string; message?: string };
type SketchCompleteResult = {
  ok: boolean;
  message?: string;
  name?: string;
  dataUrl?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  hasAlpha?: boolean;
};
type DesktopSketchApi = {
  isDesktop?: boolean;
  platform?: string;
  startLeporelloSketch?: (payload: { projectName: string; pageId: string }) => Promise<SketchStartResult>;
  completeLeporelloSketch?: (sessionId: string) => Promise<SketchCompleteResult>;
  cancelLeporelloSketch?: (sessionId: string) => Promise<void>;
};

const cloudLeporelloFileName = (name: string) => {
  const extension = name.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "img";
  const base = name
    .replace(/\.[^/.]+$/, "")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 48) || "leporello";
  return `leporello/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${base}.${extension}`;
};

const getDesktopSketchApi = () => {
  if (typeof window === "undefined") return null;
  const scoped = window as Window & { styloDesktop?: DesktopSketchApi; qalamDesktop?: DesktopSketchApi };
  return scoped.styloDesktop || scoped.qalamDesktop || null;
};

export const LeporelloStudioPanel: React.FC<Props> = ({
  projectData,
  setProjectData,
  leporelloNodeId,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUnfolded, setIsUnfolded] = useState(true);
  const [selectedPageId, setSelectedPageId] = useState("panel-1");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [sketchSessionId, setSketchSessionId] = useState<string | null>(null);
  const [sketchMessage, setSketchMessage] = useState("");
  const [resolvedMediaUrls, setResolvedMediaUrls] = useState<Record<string, string>>({});
  const wrapperNode = useMemo(
    () => getLeporelloNode(projectData, leporelloNodeId),
    [leporelloNodeId, projectData]
  );
  const book = useMemo(
    () => getLeporelloBook(projectData, leporelloNodeId),
    [leporelloNodeId, projectData]
  );
  const projectName = wrapperNode?.data.title as string || resolveLeporelloProjectName(projectData);
  const selectedPage = book.pages.find((page) => page.id === selectedPageId && page.kind === "panel")
    || book.pages.find((page) => page.kind === "panel")
    || null;
  const desktopApi = getDesktopSketchApi();
  const canUseSystemSketch = Boolean(
    desktopApi?.isDesktop &&
    desktopApi.platform === "darwin" &&
    desktopApi.startLeporelloSketch &&
    desktopApi.completeLeporelloSketch
  );
  const visiblePages = isUnfolded ? book.pages : book.pages.slice(0, 2);

  useEffect(() => {
    const projectId = projectData.activeFlowProjectId;
    if (!projectId) {
      setResolvedMediaUrls({});
      return;
    }
    const nodeById = new Map((projectData.flow?.flowNodes || []).map((node) => [node.id, node]));
    const media = book.pages.flatMap((page) => {
      const node = page.imageNodeId ? nodeById.get(page.imageNodeId) : undefined;
      const path = typeof node?.data.storagePath === "string" ? node.data.storagePath : "";
      return node && path ? [{ nodeId: node.id, path, bucket: node.data.storageBucket }] : [];
    });
    let cancelled = false;
    void Promise.all(media.map(async (item) => [
      item.nodeId,
      await resolvePrivateStorageUrl({
        bucket: item.bucket === "public-assets" ? "public-assets" : "assets",
        path: item.path,
      }, projectId),
    ] as const)).then((entries) => {
      if (!cancelled) setResolvedMediaUrls(Object.fromEntries(entries));
    }).catch((reason) => {
      if (!cancelled) {
        console.warn("Leporello media URL refresh failed", reason);
        setResolvedMediaUrls({});
      }
    });
    return () => {
      cancelled = true;
    };
  }, [book.pages, projectData.activeFlowProjectId, projectData.flow?.flowNodes]);

  const commitProjectMutation = useCallback((updater: (previous: ProjectData) => ProjectData) => {
    setProjectData((previous) => {
      const next = updater(previous);
      if (next === previous) return previous;
      return {
        ...next,
        flowProjects: previous.flowProjects?.length ? saveActiveFlowIntoProjects(next) : previous.flowProjects,
      };
    });
  }, [setProjectData]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (sketchSessionId) return;
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, sketchSessionId]);

  useEffect(() => () => {
    if (sketchSessionId) void desktopApi?.cancelLeporelloSketch?.(sketchSessionId);
  }, [desktopApi, sketchSessionId]);

  const importFile = useCallback(async (file?: File | null) => {
    if (!file || !selectedPage) return;
    setIsProcessing(true);
    setError("");
    try {
      const asset = await inspectLookbookImageFile(file);
      const projectId = projectData.activeFlowProjectId;
      if (!projectId) throw new Error("当前 Leporello 尚未绑定云端项目，无法导入图片。");
      const uploaded = await uploadStorageFile(file, {
        fileName: cloudLeporelloFileName(asset.name),
        bucket: "assets",
        contentType: asset.mimeType,
        projectId,
      });
      commitProjectMutation((previous) =>
        setLeporelloPageImage(previous, leporelloNodeId, selectedPage.id, {
          ...asset,
          dataUrl: uploaded.url,
          storageBucket: uploaded.object.bucket,
          storagePath: uploaded.object.path,
        })
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "图片导入失败");
    } finally {
      setIsProcessing(false);
    }
  }, [
    commitProjectMutation,
    leporelloNodeId,
    projectData.activeFlowProjectId,
    selectedPage,
  ]);

  const addPanel = useCallback(() => {
    const now = Date.now();
    const pageId = `panel-${now.toString(36)}`;
    commitProjectMutation((previous) => addLeporelloPanel(previous, leporelloNodeId, now));
    setSelectedPageId(pageId);
    setIsUnfolded(true);
  }, [commitProjectMutation, leporelloNodeId]);

  const startSystemSketch = useCallback(async () => {
    if (!selectedPage || !canUseSystemSketch || !desktopApi?.startLeporelloSketch) return;
    setIsProcessing(true);
    setError("");
    try {
      const result = await desktopApi.startLeporelloSketch({ projectName, pageId: selectedPage.id });
      if (!result.ok || !result.sessionId) throw new Error(result.message || "无法启动系统速绘");
      setSketchSessionId(result.sessionId);
      setSketchMessage(result.message || "已在 Finder 中准备 21:9 画纸。完成系统标记后返回 Stylo。 ");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法启动系统速绘");
    } finally {
      setIsProcessing(false);
    }
  }, [canUseSystemSketch, desktopApi, projectName, selectedPage]);

  const completeSystemSketch = useCallback(async () => {
    if (!sketchSessionId || !selectedPage || !desktopApi?.completeLeporelloSketch) return;
    setIsProcessing(true);
    setError("");
    try {
      const result = await desktopApi.completeLeporelloSketch(sketchSessionId);
      if (!result.ok || !result.dataUrl || !result.name || !result.mimeType || !result.width || !result.height) {
        throw new Error(result.message || "系统速绘文件尚未就绪");
      }
      const projectId = projectData.activeFlowProjectId;
      if (!projectId) throw new Error("当前 Leporello 尚未绑定云端项目，无法保存速绘。");
      const response = await fetch(result.dataUrl);
      const uploaded = await uploadStorageFile(await response.blob(), {
        fileName: cloudLeporelloFileName(result.name),
        bucket: "assets",
        contentType: result.mimeType,
        projectId,
      });
      commitProjectMutation((previous) => setLeporelloPageImage(previous, leporelloNodeId, selectedPage.id, {
        name: result.name!,
        dataUrl: uploaded.url,
        mimeType: result.mimeType!,
        width: result.width!,
        height: result.height!,
        hasAlpha: Boolean(result.hasAlpha),
        storageBucket: uploaded.object.bucket,
        storagePath: uploaded.object.path,
      }));
      setSketchSessionId(null);
      setSketchMessage("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法导入系统速绘");
    } finally {
      setIsProcessing(false);
    }
  }, [
    commitProjectMutation,
    desktopApi,
    leporelloNodeId,
    projectData.activeFlowProjectId,
    selectedPage,
    sketchSessionId,
  ]);

  if (!wrapperNode) {
    return (
      <section className="leporello-studio" role="dialog" aria-modal="true" aria-label="Leporello 无法打开">
        <div className="leporello-studio__missing">
          <strong>Leporello 已不存在</strong>
          <button type="button" onClick={onClose}>返回 Flow</button>
        </div>
      </section>
    );
  }

  return (
    <section className="leporello-studio" role="dialog" aria-modal="true" aria-label={`${projectName} Leporello 故事板`}>
      <div className="leporello-studio__controls">
        <div className="leporello-studio__identity">
          <span>LEPORELLO / 21:9</span>
          <strong>{projectName}</strong>
        </div>
        <div className="leporello-studio__actions">
          <button type="button" onClick={() => setIsUnfolded((current) => !current)} aria-pressed={isUnfolded}>
            {isUnfolded ? <ArrowsInSimple size={17} /> : <ArrowsOutSimple size={17} />}
            <span>{isUnfolded ? "收起" : "展开"}</span>
          </button>
          <button type="button" onClick={addPanel} disabled={book.pages.length >= LEPORELLO_MAX_PAGES}>
            <Plus size={17} />
            <span>新增折页</span>
          </button>
          <button type="button" className="is-close" onClick={onClose} aria-label="关闭 Leporello">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className={`leporello-studio__viewport ${isUnfolded ? "is-unfolded" : "is-folded"}`}>
        <div
          className="leporello-studio__strip"
          data-visible-pages={isUnfolded ? Math.min(3, book.pages.length) : visiblePages.length}
          style={{ "--leporello-pages": book.pages.length } as React.CSSProperties}
        >
          {visiblePages.map((page, index) => {
            const image = page.imageNodeId
              ? resolvedMediaUrls[page.imageNodeId] || getLeporelloPageImage(projectData, page)
              : "";
            const isSelected = selectedPage?.id === page.id;
            return (
              <button
                key={page.id}
                type="button"
                className={`leporello-sheet is-${page.kind} is-${page.face} ${isSelected ? "is-selected" : ""}`}
                style={{ "--leporello-index": index } as React.CSSProperties}
                onClick={() => page.kind === "panel" && setSelectedPageId(page.id)}
                aria-label={page.kind === "cover" ? `${projectName} 封面` : page.kind === "back" ? "Leporello 封底 FIN" : `折页 ${index}`}
              >
                <span className="leporello-sheet__face">{page.face === "lit" ? "受光面" : "背光面"}</span>
                {image ? <img src={image} alt={`折页 ${index} 内容`} draggable={false} /> : null}
                {page.kind === "cover" ? (
                  <span className="leporello-sheet__cover-copy"><small>STYLO STORYBOARD</small><strong>{projectName}</strong><b>LEPORELLO / 01</b></span>
                ) : null}
                {page.kind === "panel" && !image ? (
                  <span className="leporello-sheet__empty"><b>空白画纸</b><small>21:9 / {page.face === "lit" ? "受光面" : "背光面"}</small></span>
                ) : null}
                {page.kind === "back" ? <span className="leporello-sheet__fin">FIN</span> : null}
                <span className="leporello-sheet__number">{String(index + 1).padStart(2, "0")}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="leporello-studio__footer">
        <div className="leporello-studio__status">
          <span>{isUnfolded ? "三页展开 · 明暗折面连续纸带" : "双页收起 · 21:9 对页装帧"}</span>
          <strong>{book.pages.length} 页 / {Math.max(1, book.pages.length - 2)} 个内容面</strong>
        </div>
        <div className="leporello-studio__page-tools">
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!selectedPage || isProcessing || !isUnfolded}>
            <UploadSimple size={16} />
            <span>{getLeporelloPageImage(projectData, selectedPage!) ? "替换图片" : "上传图片"}</span>
          </button>
          <button
            type="button"
            onClick={startSystemSketch}
            disabled={!selectedPage || !isUnfolded || isProcessing || !canUseSystemSketch || Boolean(sketchSessionId)}
            title={canUseSystemSketch ? "调用 macOS 连续互通标记" : desktopApi?.isDesktop ? "当前桌面系统不支持连续互通速绘" : "网页端不提供手绘能力"}
          >
            <PencilSimple size={16} />
            <span>{desktopApi?.isDesktop ? "系统速绘" : "速绘仅桌面 App"}</span>
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="leporello-studio__file-input"
        onChange={(event) => {
          void importFile(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />

      {sketchSessionId ? (
        <div className="leporello-sketch-session" role="status">
          <div>
            <span>MACOS CONTINUITY MARKUP</span>
            <strong>在 Finder 中右键画纸，选择“快速操作 → 标记”，再选择附近的 iPad 或 iPhone。</strong>
            <p>{sketchMessage}</p>
          </div>
          <button type="button" onClick={completeSystemSketch} disabled={isProcessing}>
            <Check size={17} />
            <span>完成并导入</span>
          </button>
        </div>
      ) : null}

      {isProcessing ? <div className="leporello-studio__processing" role="status">正在处理画纸…</div> : null}
      {error ? <div className="leporello-studio__error" role="alert">{error}</div> : null}
    </section>
  );
};
