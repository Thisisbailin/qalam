import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  CaretLeft,
  CaretRight,
  GridFour,
  ImageSquare,
  NotePencil,
  Plus,
  SpinnerGap,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { ProjectData } from "../../../types";
import type { LookbookLayout } from "../../types";
import {
  LOOKBOOK_SPREAD_HEIGHT,
  addLookbookPage,
  addLookbookImageAssets,
  addLookbookTextCard,
  getLookbookPageCount,
  getLookbookPageIndexForLayout,
  getLookbookSpreadCount,
  moveLookbookNodeToPage,
  moveLookbookNodeToSpread,
  projectLookbookBoardItems,
  reflowLookbookLayouts,
  sanitizeLookbookLayout,
  updateLookbookNodeLayout,
  updateLookbookTextCard,
} from "../../../utils/lookbookWorkspace";
import { isLookbookNodeType } from "../../../utils/lookbookIdentities";
import { inspectLookbookImageFiles } from "../../lookbook/imageFiles";
import {
  deleteOwnedStorageObjects,
  resolvePrivateStorageUrl,
  uploadStorageFile,
  type OwnedStorageObject,
} from "../../nodeflow/storageObjects";
import { saveActiveFlowIntoProjects } from "../../foundation/scaffold";
import { LookbookBoardItemView } from "./LookbookBoardItem";
import "../../styles/lookbook-studio.css";

type Props = {
  projectData: ProjectData;
  setProjectData: React.Dispatch<React.SetStateAction<ProjectData>>;
  identityNodeId: string;
  onClose: () => void;
};

type ContextMenuState = {
  x: number;
  y: number;
  nodeId: string | null;
  pageIndex: number | null;
};

type BookView =
  | { kind: "front" }
  | { kind: "spread"; index: number }
  | { kind: "back" };

const readString = (value: unknown) => typeof value === "string" ? value : "";

const createLocalNodeId = (prefix: string) => {
  const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  return `${prefix}-${suffix}`;
};

const cloudImageFileName = (file: File, index: number) => {
  const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "img";
  const base = file.name
    .replace(/\.[^/.]+$/, "")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 48) || "lookbook";
  return `lookbook/${Date.now()}-${index + 1}-${Math.random().toString(36).slice(2, 8)}-${base}.${extension}`;
};

export const LookbookStudioPanel: React.FC<Props> = ({
  projectData,
  setProjectData,
  identityNodeId,
  onClose,
}) => {
  const spreadRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingImportPageRef = useRef<number | null>(null);
  const dragTargetPageRef = useRef<number | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [bookView, setBookView] = useState<BookView>({ kind: "front" });
  const [turnDirection, setTurnDirection] = useState<-1 | 0 | 1>(0);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragTargetPageIndex, setDragTargetPageIndex] = useState<number | null>(null);
  const [resolvedMediaUrls, setResolvedMediaUrls] = useState<Record<string, string>>({});

  const identityNode = useMemo(
    () => projectData.flow?.flowNodes?.find((node) => node.id === identityNodeId && isLookbookNodeType(node.type)),
    [identityNodeId, projectData.flow?.flowNodes]
  );
  const identityId = readString(identityNode?.data.identityId);
  const identity = useMemo(
    () => (projectData.roles || []).find((role) => role.id === identityId),
    [identityId, projectData.roles]
  );
  const items = useMemo(
    () => projectLookbookBoardItems(projectData, identityNodeId),
    [identityNodeId, projectData]
  );
  const pageCount = useMemo(
    () => getLookbookPageCount(projectData, identityNodeId),
    [identityNodeId, projectData]
  );
  const spreadCount = useMemo(() => getLookbookSpreadCount(items, pageCount), [items, pageCount]);
  const spreadIndex = bookView.kind === "spread"
    ? Math.max(0, Math.min(spreadCount - 1, bookView.index))
    : bookView.kind === "back"
      ? Math.max(0, spreadCount - 1)
      : 0;
  const displayItems = useMemo(() => items.map((item) => {
    const resolved = resolvedMediaUrls[item.node.id];
    if (!resolved || item.node.type !== "imageInput") return item;
    return {
      ...item,
      node: {
        ...item.node,
        data: { ...item.node.data, image: resolved },
      },
    };
  }), [items, resolvedMediaUrls]);
  const visibleDisplayItems = useMemo(
    () => displayItems.filter((item) => item.spreadIndex === spreadIndex),
    [displayItems, spreadIndex],
  );
  const selectedItem = useMemo(
    () => items.find((item) => item.node.id === selectedNodeId) || null,
    [items, selectedNodeId]
  );
  const contextItem = useMemo(
    () => items.find((item) => item.node.id === contextMenu?.nodeId) || null,
    [contextMenu?.nodeId, items]
  );

  useEffect(() => {
    if (selectedNodeId && !items.some((item) => item.node.id === selectedNodeId)) setSelectedNodeId(null);
  }, [items, selectedNodeId]);

  useEffect(() => {
    const projectId = projectData.activeFlowProjectId;
    if (!projectId) {
      setResolvedMediaUrls({});
      return;
    }
    let cancelled = false;
    const storageItems = items.filter((item) =>
      item.node.type === "imageInput"
      && typeof item.node.data.storagePath === "string"
      && item.node.data.storagePath,
    );
    void Promise.all(storageItems.map(async (item) => {
      const url = await resolvePrivateStorageUrl({
        bucket: item.node.data.storageBucket === "public-assets" ? "public-assets" : "assets",
        path: item.node.data.storagePath as string,
      }, projectId);
      return [item.node.id, url] as const;
    })).then((entries) => {
      if (!cancelled) setResolvedMediaUrls(Object.fromEntries(entries));
    }).catch((error) => {
      if (!cancelled) {
        console.warn("Lookbook media URL refresh failed", error);
        setResolvedMediaUrls({});
      }
    });
    return () => {
      cancelled = true;
    };
  }, [items, projectData.activeFlowProjectId]);

  useEffect(() => {
    if (bookView.kind !== "spread" || bookView.index < spreadCount) return;
    setBookView({ kind: "spread", index: Math.max(0, spreadCount - 1) });
  }, [bookView, spreadCount]);

  const commitProjectMutation = useCallback((mutation: (previous: ProjectData) => ProjectData) => {
    setProjectData((previous) => {
      const next = mutation(previous);
      if (next === previous) return previous;
      return { ...next, flowProjects: saveActiveFlowIntoProjects(next) };
    });
  }, [setProjectData]);

  const commitLayout = useCallback((nodeId: string, layout: LookbookLayout) => {
    commitProjectMutation((previous) => updateLookbookNodeLayout(previous, nodeId, layout));
  }, [commitProjectMutation]);

  const commitText = useCallback((nodeId: string, patch: { title?: string; text?: string }) => {
    commitProjectMutation((previous) => updateLookbookTextCard(previous, nodeId, patch));
  }, [commitProjectMutation]);

  const importFiles = useCallback(async (files: File[], targetPageIndex: number | null = null) => {
    if (!files.length || isImporting) return;
    setIsImporting(true);
    setErrorMessage("");
    const uploadedObjects: OwnedStorageObject[] = [];
    try {
      const inspected = await inspectLookbookImageFiles(files);
      const projectId = projectData.activeFlowProjectId;
      if (!projectId) throw new Error("当前 Lookbook 尚未绑定云端项目，无法导入图片。");
      const assets = await Promise.all(inspected.map(async (asset, index) => {
        const uploaded = await uploadStorageFile(files[index], {
          fileName: cloudImageFileName(files[index], index),
          bucket: "assets",
          contentType: asset.mimeType,
          projectId,
        });
        uploadedObjects.push(uploaded.object);
        return {
          ...asset,
          id: createLocalNodeId("lookbook-image"),
          dataUrl: uploaded.url,
          storageBucket: uploaded.object.bucket,
          storagePath: uploaded.object.path,
        };
      }));
      commitProjectMutation((previous) => {
        let next = addLookbookImageAssets(previous, identityNodeId, assets);
        if (targetPageIndex !== null) {
          assets.forEach((asset) => {
            next = moveLookbookNodeToPage(next, identityNodeId, asset.id!, targetPageIndex);
          });
        }
        return next;
      });
      setSelectedNodeId(assets.at(-1)?.id || null);
      setBookView({
        kind: "spread",
        index: targetPageIndex === null
          ? Math.floor((items.length + assets.length - 1) / 6)
          : Math.floor(targetPageIndex / 2),
      });
    } catch (error) {
      const projectId = projectData.activeFlowProjectId;
      if (projectId && uploadedObjects.length) {
        await deleteOwnedStorageObjects(uploadedObjects, projectId).catch(() => undefined);
      }
      setErrorMessage(error instanceof Error ? error.message : "图片导入失败");
    } finally {
      setIsImporting(false);
      setIsDraggingFiles(false);
    }
  }, [
    commitProjectMutation,
    identityNodeId,
    isImporting,
    items.length,
    projectData.activeFlowProjectId,
  ]);

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const targetPageIndex = pendingImportPageRef.current;
    pendingImportPageRef.current = null;
    void importFiles(Array.from(event.target.files || []), targetPageIndex);
    event.target.value = "";
  };

  const addTextCard = useCallback((targetPageIndex: number | null = null) => {
    const nodeId = createLocalNodeId("lookbook-note");
    commitProjectMutation((previous) => {
      const created = addLookbookTextCard(previous, identityNodeId, Date.now(), nodeId).projectData;
      return targetPageIndex === null
        ? created
        : moveLookbookNodeToPage(created, identityNodeId, nodeId, targetPageIndex);
    });
    setSelectedNodeId(nodeId);
    setBookView({
      kind: "spread",
      index: targetPageIndex === null ? Math.floor(items.length / 6) : Math.floor(targetPageIndex / 2),
    });
  }, [commitProjectMutation, identityNodeId, items.length]);

  const addPage = useCallback(() => {
    const nextPageCount = pageCount + 1;
    commitProjectMutation((previous) => addLookbookPage(previous, identityNodeId));
    setBookView({ kind: "spread", index: Math.max(0, Math.ceil(nextPageCount / 2) - 1) });
    setSelectedNodeId(null);
  }, [commitProjectMutation, identityNodeId, pageCount]);

  const currentPosition = bookView.kind === "front" ? -1 : bookView.kind === "back" ? spreadCount : spreadIndex;
  const turnTo = useCallback((nextPosition: number) => {
    const bounded = Math.max(-1, Math.min(spreadCount, nextPosition));
    if (bounded === currentPosition || turnDirection !== 0) return;
    setTurnDirection(bounded > currentPosition ? 1 : -1);
    setBookView(
      bounded < 0
        ? { kind: "front" }
        : bounded >= spreadCount
          ? { kind: "back" }
          : { kind: "spread", index: bounded }
    );
    setSelectedNodeId(null);
  }, [currentPosition, spreadCount, turnDirection]);

  const setDragTargetPage = useCallback((pageIndex: number | null) => {
    dragTargetPageRef.current = pageIndex;
    setDragTargetPageIndex(pageIndex);
  }, []);

  const handleItemDragStart = useCallback((nodeId: string) => {
    setDraggingNodeId(nodeId);
    setDragTargetPage(null);
  }, [setDragTargetPage]);

  const handleItemDragMove = useCallback((_nodeId: string, point: { x: number; y: number }) => {
    const target = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>("[data-lookbook-page-index]");
    const rawPageIndex = target?.dataset.lookbookPageIndex;
    const nextPageIndex = rawPageIndex === undefined ? Number.NaN : Number(rawPageIndex);
    setDragTargetPage(Number.isFinite(nextPageIndex) ? nextPageIndex : null);
  }, [setDragTargetPage]);

  const handleItemDragEnd = useCallback((nodeId: string, layout: LookbookLayout) => {
    const targetPageIndex = dragTargetPageRef.current;
    if (targetPageIndex === null) {
      commitLayout(nodeId, layout);
    } else {
      commitProjectMutation((previous) => moveLookbookNodeToPage(previous, identityNodeId, nodeId, targetPageIndex));
      setBookView({ kind: "spread", index: Math.floor(targetPageIndex / 2) });
      setSelectedNodeId(nodeId);
    }
    setDraggingNodeId(null);
    setDragTargetPage(null);
  }, [commitLayout, commitProjectMutation, identityNodeId, setDragTargetPage]);

  useEffect(() => {
    if (turnDirection === 0) return;
    const timer = window.setTimeout(() => setTurnDirection(0), 360);
    return () => window.clearTimeout(timer);
  }, [turnDirection]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      const eventTarget = event.target as HTMLElement | null;
      const isEditingText = eventTarget?.matches("input, textarea, [contenteditable='true']") === true;
      if (event.key === "Escape") {
        if (contextMenu) setContextMenu(null);
        else if (selectedNodeId) setSelectedNodeId(null);
        else onClose();
      }
      if (event.key === "ArrowRight" && !isEditingText) turnTo(currentPosition + 1);
      if (event.key === "ArrowLeft" && !isEditingText) turnTo(currentPosition - 1);
    };
    const dismissMenu = () => setContextMenu(null);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", dismissMenu);
    window.addEventListener("blur", dismissMenu);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", dismissMenu);
      window.removeEventListener("blur", dismissMenu);
    };
  }, [contextMenu, currentPosition, onClose, selectedNodeId, turnTo]);

  const updateContextLayout = (patch: Partial<LookbookLayout>) => {
    if (!contextItem) return;
    commitLayout(contextItem.node.id, sanitizeLookbookLayout({ ...contextItem.layout, ...patch }));
    setContextMenu(null);
  };

  const maxZIndex = items.reduce((maximum, item) => Math.max(maximum, item.layout.zIndex), 1);
  const name = identity?.displayName || identity?.name || readString(identityNode?.data.title) || "Lookbook";
  const mention = identity?.mention || name;
  const identityLabel = identity?.kind === "scene" ? "SCENE STUDY" : "CHARACTER STUDY";
  const issue = String(Math.max(1, (projectData.roles || []).findIndex((role) => role.id === identityId) + 1)).padStart(2, "0");
  const coverImageUrls = displayItems
    .filter((item) => item.node.type === "imageInput")
    .map((item) => readString(item.node.data.image))
    .filter(Boolean)
    .slice(0, 1);
  const pageItemCounts = useMemo(() => {
    const counts = new Map<number, number>();
    items.forEach((item) => {
      const pageIndex = getLookbookPageIndexForLayout(item.spreadIndex, item.layout);
      counts.set(pageIndex, (counts.get(pageIndex) || 0) + 1);
    });
    return counts;
  }, [items]);
  const leftPageIndex = spreadIndex * 2;
  const rightPageIndex = leftPageIndex + 1;
  const hasLeftPage = leftPageIndex < pageCount;
  const hasRightPage = rightPageIndex < pageCount;

  if (!identityNode || !identity) {
    return (
      <section className="lookbook-studio" role="dialog" aria-modal="true" aria-label="Lookbook 无法打开">
        <div className="lookbook-studio__missing">
          <WarningCircle size={28} weight="light" />
          <p>身份索引已失去绑定，无法打开 Lookbook。</p>
          <button type="button" onClick={onClose}>返回 Flow</button>
        </div>
      </section>
    );
  }

  return (
    <section className="lookbook-studio" role="dialog" aria-modal="true" aria-label={`${name} Lookbook 编辑器`}>
      <button type="button" className="lookbook-studio__close" onClick={onClose} aria-label="关闭 Lookbook">
        <X size={18} weight="bold" />
      </button>

      <main
        className={`lookbook-studio__stage ${isDraggingFiles ? "is-dragging-files" : ""}`}
        onContextMenu={(event) => {
          const eventTarget = event.target as HTMLElement;
          if (eventTarget.closest("input, textarea, [contenteditable='true']")) return;
          event.preventDefault();
          const nodeElement = eventTarget.closest<HTMLElement>("[data-node-id]");
          const spreadBounds = spreadRef.current?.getBoundingClientRect();
          const pageIndex = bookView.kind === "spread" && pageCount > 0 && spreadBounds &&
            event.clientX >= spreadBounds.left && event.clientX <= spreadBounds.right &&
            event.clientY >= spreadBounds.top && event.clientY <= spreadBounds.bottom
            ? Math.min(
                pageCount - 1,
                spreadIndex * 2 + (event.clientX >= spreadBounds.left + spreadBounds.width / 2 ? 1 : 0)
              )
            : null;
          const width = 220;
          const height = nodeElement ? 360 : 264;
          setContextMenu({
            x: Math.max(10, Math.min(window.innerWidth - width - 10, event.clientX)),
            y: Math.max(56, Math.min(window.innerHeight - height - 10, event.clientY)),
            nodeId: nodeElement?.dataset.nodeId || null,
            pageIndex,
          });
          if (nodeElement?.dataset.nodeId) setSelectedNodeId(nodeElement.dataset.nodeId);
        }}
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setIsDraggingFiles(true);
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setIsDraggingFiles(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          const spreadBounds = spreadRef.current?.getBoundingClientRect();
          const targetPageIndex = bookView.kind === "spread" && spreadBounds &&
            event.clientX >= spreadBounds.left && event.clientX <= spreadBounds.right &&
            event.clientY >= spreadBounds.top && event.clientY <= spreadBounds.bottom
            ? Math.min(
                Math.max(0, pageCount - 1),
                spreadIndex * 2 + (event.clientX >= spreadBounds.left + spreadBounds.width / 2 ? 1 : 0)
              )
            : null;
          void importFiles(Array.from(event.dataTransfer.files), targetPageIndex);
        }}
      >
        <div className="lookbook-studio__book-viewport">
        <AnimatePresence initial={false} mode="sync">
          {bookView.kind === "front" ? (
            <motion.button
              key="front-cover"
              type="button"
              className="lookbook-book-cover"
              onClick={() => turnTo(0)}
              initial={{ opacity: 0, x: -22 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -18 }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              aria-label={`打开 ${name} Lookbook`}
            >
              <span className="lookbook-book-cover__issue">({issue})</span>
              <span className="lookbook-book-cover__title">{name}</span>
              <span className="lookbook-book-cover__images" data-count={coverImageUrls.length || 0}>
                {coverImageUrls.length
                  ? <img src={coverImageUrls[0]} alt="" draggable={false} />
                  : <span className="lookbook-book-cover__empty" />}
              </span>
              <span className="lookbook-book-cover__meta"><b>@{mention}</b><b>{identityLabel}</b><b>STYLO ARCHIVE</b></span>
            </motion.button>
          ) : bookView.kind === "back" ? (
            <motion.button
              key="back-cover"
              type="button"
              className="lookbook-book-cover lookbook-book-cover--back"
              onClick={() => turnTo(spreadCount - 1)}
              initial={{ opacity: 0, x: 22 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 18 }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              aria-label={`返回 ${name} Lookbook 最后一页`}
            >
              <span className="lookbook-book-cover__issue">END / {issue}</span>
              <span className="lookbook-book-cover__back-mark">{name}</span>
              <span className="lookbook-book-cover__meta"><b>STYLO LOOKBOOK</b><b>@{mention}</b></span>
            </motion.button>
          ) : (
            <motion.div
              key={`spread-${spreadIndex}`}
              className="lookbook-book-shell"
              initial={{ opacity: 0, x: turnDirection >= 0 ? 24 : -24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: turnDirection >= 0 ? -20 : 20 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <button
                type="button"
                className="lookbook-book-shell__turn is-previous"
                aria-label={spreadIndex === 0 ? "合上为 Lookbook 封面" : "上一跨页"}
                disabled={turnDirection !== 0}
                onClick={() => turnTo(spreadIndex - 1)}
              ><CaretLeft size={20} /></button>

              <div
                ref={spreadRef}
                className="lookbook-book-spread"
                style={{ aspectRatio: `1 / ${LOOKBOOK_SPREAD_HEIGHT}` }}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) setSelectedNodeId(null);
                }}
              >
                <div className={["lookbook-book-spread__page is-left", hasLeftPage ? "" : "is-uncreated"].join(" ")} aria-hidden="true" />
                <div className={["lookbook-book-spread__page is-right", hasRightPage ? "" : "is-uncreated"].join(" ")} aria-hidden="true" />
                <div className="lookbook-book-spread__gutter" aria-hidden="true" />
                <div className="lookbook-book-spread__running-head is-left">{name} / {identityLabel}</div>
                <div className="lookbook-book-spread__running-head is-right">STYLO LOOKBOOK / {issue}</div>

                {visibleDisplayItems.map((item, index) => (
                  <LookbookBoardItemView
                    key={item.node.id}
                    item={item}
                    boardRef={spreadRef}
                    worldHeight={LOOKBOOK_SPREAD_HEIGHT}
                    pageCount={pageCount}
                    selected={selectedNodeId === item.node.id}
                    index={index}
                    onSelect={setSelectedNodeId}
                    onCommitLayout={commitLayout}
                    onCommitText={commitText}
                    onItemDragStart={handleItemDragStart}
                    onItemDragMove={handleItemDragMove}
                    onItemDragEnd={handleItemDragEnd}
                  />
                ))}

                {!visibleDisplayItems.length && !isImporting ? (
                  <div className="lookbook-book-spread__empty">
                    <span>{pageCount ? "EMPTY PAGES / " + String(spreadIndex + 1).padStart(2, "0") : "NO INNER PAGES"}</span>
                    <strong>{pageCount ? "在纸面右键添加内容" : "这本 Lookbook 目前只有封面"}</strong>
                    <small>{pageCount ? "也可以把 PNG、JPEG 或 WebP 直接拖进书册" : "点击下方“新增页”开始编排"}</small>
                  </div>
                ) : null}

                {hasLeftPage ? <span className="lookbook-book-spread__page-number is-left">{leftPageIndex + 1}</span> : null}
                {hasRightPage ? <span className="lookbook-book-spread__page-number is-right">{rightPageIndex + 1}</span> : null}

              </div>

              <button
                type="button"
                className="lookbook-book-shell__turn is-next"
                aria-label={spreadIndex >= spreadCount - 1 ? "合上为 Lookbook 封底" : "下一跨页"}
                disabled={turnDirection !== 0}
                onClick={() => turnTo(spreadIndex + 1)}
              ><CaretRight size={20} /></button>
            </motion.div>
          )}
        </AnimatePresence>
        </div>

        {bookView.kind === "spread" && pageCount > 0 ? (
          <nav
            className={`lookbook-page-strip ${draggingNodeId ? "is-dragging" : ""}`}
            aria-label="Lookbook 页缩略图"
          >
            <span className="lookbook-page-strip__label">{draggingNodeId ? "拖到目标页后释放" : "页面"}</span>
            <div className="lookbook-page-strip__rail">
              {Array.from({ length: pageCount }, (_, pageIndex) => {
                const itemCount = pageItemCounts.get(pageIndex) || 0;
                const isCurrent = Math.floor(pageIndex / 2) === spreadIndex;
                return (
                  <button
                    key={pageIndex}
                    type="button"
                    className={`${isCurrent ? "is-current" : ""} ${dragTargetPageIndex === pageIndex ? "is-drop-target" : ""}`}
                    data-lookbook-page-index={pageIndex}
                    aria-label={`跳转到第 ${pageIndex + 1} 页${itemCount ? `，${itemCount} 个内容` : "，空页"}`}
                    onClick={() => turnTo(Math.floor(pageIndex / 2))}
                  >
                    <span className="lookbook-page-strip__paper" data-items={Math.min(itemCount, 3)}>
                      {Array.from({ length: Math.min(itemCount, 3) }, (_, index) => <i key={index} />)}
                    </span>
                    <b>{pageIndex + 1}</b>
                  </button>
                );
              })}
            </div>
          </nav>
        ) : null}

        <div className="lookbook-studio__hint">
          <span>{bookView.kind === "front"
            ? "FRONT COVER"
            : bookView.kind === "back"
              ? "BACK COVER"
              : pageCount + " PAGES · " + String(spreadIndex + 1).padStart(2, "0") + " / " + String(spreadCount).padStart(2, "0")}</span>
          <button type="button" className="lookbook-studio__add-page" onClick={addPage}>
            <Plus size={13} weight="bold" />
            <span>新增页</span>
          </button>
          <span>{bookView.kind === "front"
            ? "单击封面打开"
            : bookView.kind === "back"
              ? "单击封底返回最后一页"
              : "右键添加与编排 · 拖动移动 · 选中后拖拽边角缩放"}</span>
        </div>

        <input
          ref={fileInputRef}
          className="lookbook-studio__file-input"
          type="file"
          aria-label="选择 Lookbook 图片文件"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          onChange={handleFileInput}
        />

        {isImporting ? (
          <div className="lookbook-studio__processing" role="status">
            <SpinnerGap size={18} />
            <span>正在解析图片尺寸与透明通道</span>
          </div>
        ) : null}

        {isDraggingFiles ? (
          <div className="lookbook-studio__drop-target" role="status">
            <ImageSquare size={26} weight="light" />
            <strong>释放以创建并连接图片节点</strong>
            <span>透明 PNG 将作为无底色贴纸保留</span>
          </div>
        ) : null}
      </main>

      {contextMenu ? (
        <div
          className="lookbook-context-menu"
          role="menu"
          aria-label="Lookbook 操作"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {contextItem ? (
            <>
              <span className="lookbook-context-menu__label">所选内容</span>
              <button type="button" role="menuitem" onClick={() => updateContextLayout({ fit: contextItem.layout.fit === "contain" ? "cover" : "contain" })}>
                <GridFour size={15} /><span>{contextItem.layout.fit === "contain" ? "填充裁切" : "完整显示"}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => updateContextLayout({ rotation: contextItem.layout.rotation - 1 })}>
                <CaretLeft size={15} /><span>逆时针旋转 1°</span>
              </button>
              <button type="button" role="menuitem" onClick={() => updateContextLayout({ rotation: contextItem.layout.rotation + 1 })}>
                <CaretRight size={15} /><span>顺时针旋转 1°</span>
              </button>
              <button type="button" role="menuitem" onClick={() => updateContextLayout({ zIndex: maxZIndex + 1 })}>
                <ArrowRight size={15} /><span>移到最上层</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={contextItem.spreadIndex === 0}
                onClick={() => {
                  commitProjectMutation((previous) => moveLookbookNodeToSpread(previous, identityNodeId, contextItem.node.id, contextItem.spreadIndex - 1));
                  setContextMenu(null);
                }}
              ><ArrowLeft size={15} /><span>移至前一跨页</span></button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  commitProjectMutation((previous) => moveLookbookNodeToSpread(previous, identityNodeId, contextItem.node.id, contextItem.spreadIndex + 1));
                  setContextMenu(null);
                }}
              ><ArrowRight size={15} /><span>移至后一跨页</span></button>
              <div className="lookbook-context-menu__separator" />
            </>
          ) : null}

          <button type="button" role="menuitem" onClick={() => {
            pendingImportPageRef.current = contextMenu.pageIndex;
            fileInputRef.current?.click();
            setContextMenu(null);
          }}>
            <ImageSquare size={15} /><span>导入图片</span>
          </button>
          <button type="button" role="menuitem" onClick={() => { addTextCard(contextMenu.pageIndex); setContextMenu(null); }}>
            <NotePencil size={15} /><span>添加文本</span>
          </button>
          <button type="button" role="menuitem" onClick={() => { addPage(); setContextMenu(null); }}>
            <Plus size={15} /><span>新增一页</span>
          </button>
          <button type="button" role="menuitem" disabled={!items.length} onClick={() => {
            commitProjectMutation((previous) => reflowLookbookLayouts(previous, identityNodeId));
            setContextMenu(null);
          }}>
            <GridFour size={15} /><span>自动编排整本</span>
          </button>
          <div className="lookbook-context-menu__separator" />
          <button type="button" role="menuitem" onClick={() => {
            turnTo(bookView.kind === "spread" ? -1 : bookView.kind === "back" ? spreadCount - 1 : 0);
            setContextMenu(null);
          }}>
            {bookView.kind === "spread" ? <CaretLeft size={15} /> : <CaretRight size={15} />}
            <span>{bookView.kind === "spread" ? "合上为封面" : "打开书册"}</span>
          </button>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="lookbook-studio__error" role="alert">
          <WarningCircle size={16} />
          <span>{errorMessage}</span>
          <button type="button" onClick={() => setErrorMessage("")}>关闭</button>
        </div>
      ) : null}
    </section>
  );
};
