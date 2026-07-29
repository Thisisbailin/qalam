import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  ChatCenteredDots,
  Copy,
  FilePdf,
  HighlighterCircle,
  Minus,
  NotePencil,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist/types/src/display/api";
import type {
  NodeFlowNode,
  PdfHighlightAnnotation,
  PdfHighlightColor,
  PdfHighlightRect,
  PdfInputNodeData,
  TextNodeData,
} from "../types";
import { useNodeFlowStore } from "../store/nodeFlowStore";
import {
  getPdfHighlightBounds,
  normalizePdfSelectionRects,
} from "../pdf/selectionGeometry";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type Props = {
  nodeId: string;
  onClose: () => void;
  onOpenAgent?: () => void;
  onSubmitAgentMessage?: (text: string) => void;
};

type PdfSelectionCommand = {
  page: number;
  quote: string;
  textStart: number;
  textEnd: number;
  rects: PdfHighlightRect[];
  anchorX: number;
  anchorY: number;
};

type LinkedNote = {
  node: NodeFlowNode;
  page: number | null;
};

const textNodeTypes = new Set(["text", "mdText", "scriptPage"]);
const HIGHLIGHT_COLORS: PdfHighlightColor[] = ["yellow", "green", "blue"];

const createId = (prefix: string) =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getTextSpan = (node: Node | null) => {
  if (!node) return null;
  const element = node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;
  return element?.closest<HTMLElement>("[data-pdf-text-index]") || null;
};

const getOffsetWithinSpan = (span: HTMLElement, node: Node, offset: number) => {
  try {
    const range = document.createRange();
    range.selectNodeContents(span);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return 0;
  }
};

const getTextOffset = (node: Node, offset: number) => {
  const span = getTextSpan(node);
  if (!span) return null;
  const base = Number(span.dataset.pdfTextStart || 0);
  return base + getOffsetWithinSpan(span, node, offset);
};

const buildQuoteMarkdown = (quote: string) => {
  const quoted = quote
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  return `${quoted}\n\n`;
};

const PdfPageSurface: React.FC<{
  document: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  scrollRoot: HTMLElement | null;
  highlights: PdfHighlightAnnotation[];
  onVisible: (pageNumber: number) => void;
  onSelection: (pageNumber: number, pageElement: HTMLElement) => void;
}> = ({
  document: pdfDocument,
  pageNumber,
  zoom,
  scrollRoot,
  highlights,
  onVisible,
  onSelection,
}) => {
  const hostRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(pageNumber === 1);
  const [pageSize, setPageSize] = useState({ width: 738, height: 1044 });
  const [renderState, setRenderState] = useState<"idle" | "rendering" | "ready" | "error">("idle");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return undefined;
    }
    if (!scrollRoot) return undefined;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      const nextVisible = !!entry?.isIntersecting;
      setIsVisible(nextVisible);
      if (nextVisible && entry) {
        const rootRect = scrollRoot.getBoundingClientRect();
        if (
          entry.boundingClientRect.bottom > rootRect.top &&
          entry.boundingClientRect.top < rootRect.bottom
        ) {
          onVisible(pageNumber);
        }
      }
    }, {
      root: scrollRoot,
      rootMargin: "720px 0px",
      threshold: 0.01,
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [onVisible, pageNumber, scrollRoot]);

  useEffect(() => {
    if (!isVisible) {
      setRenderState("idle");
      return undefined;
    }
    let cancelled = false;
    let page: PDFPageProxy | null = null;
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayer | null = null;

    const render = async () => {
      const canvas = canvasRef.current;
      const textLayerElement = textLayerRef.current;
      if (!canvas || !textLayerElement) return;
      setRenderState("rendering");
      try {
        page = await pdfDocument.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 1.24 * (zoom / 100) });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        setPageSize({
          width: viewport.width / (zoom / 100),
          height: viewport.height / (zoom / 100),
        });

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        textLayerElement.replaceChildren();
        textLayerElement.style.width = `${viewport.width}px`;
        textLayerElement.style.height = `${viewport.height}px`;
        textLayerElement.style.setProperty("--scale-factor", String(viewport.scale));
        textLayerElement.style.setProperty("--total-scale-factor", String(viewport.scale));

        renderTask = page.render({
          canvas,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        textLayer = new TextLayer({
          textContentSource: page.streamTextContent({
            includeMarkedContent: true,
            disableNormalization: true,
          }),
          container: textLayerElement,
          viewport,
        });

        await Promise.all([renderTask.promise, textLayer.render()]);
        if (cancelled) return;

        let textStart = 0;
        textLayer.textDivs.forEach((element, index) => {
          element.dataset.pdfTextIndex = String(index);
          element.dataset.pdfTextStart = String(textStart);
          textStart += textLayer?.textContentItemsStr[index]?.length || 0;
        });
        setRenderState("ready");
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === "RenderingCancelledException")) return;
        setRenderState("error");
      }
    };

    void render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      page?.cleanup();
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      textLayerRef.current?.replaceChildren();
    };
  }, [isVisible, pageNumber, pdfDocument, zoom]);

  return (
    <article
      ref={hostRef}
      className="pdf-focus-page"
      data-page-number={pageNumber}
      data-render-state={renderState}
      style={{
        width: pageSize.width * (zoom / 100),
        height: pageSize.height * (zoom / 100),
      }}
      aria-label={`PDF 第 ${pageNumber} 页`}
      onMouseUp={(event) => onSelection(pageNumber, event.currentTarget)}
    >
      <canvas ref={canvasRef} className="pdf-focus-page__canvas" aria-hidden="true" />
      <div ref={textLayerRef} className="pdf-focus-text-layer textLayer" />
      <div className="pdf-focus-highlight-layer" aria-label={`第 ${pageNumber} 页高亮`}>
        {highlights.flatMap((highlight) => {
          const rects = highlight.rects?.length
            ? highlight.rects
            : [{ x: highlight.x, y: highlight.y, width: highlight.width, height: highlight.height }];
          return rects.map((rect, index) => (
            <span
              key={`${highlight.id}-${index}`}
              className="pdf-focus-highlight"
              data-color={highlight.color}
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`,
              }}
              aria-hidden="true"
            />
          ));
        })}
      </div>
      {renderState === "rendering" || renderState === "idle" ? (
        <div className="pdf-focus-page__skeleton" aria-label={`正在渲染第 ${pageNumber} 页`}>
          <i />
          <i />
          <i />
          <i />
        </div>
      ) : null}
      {renderState === "error" ? (
        <div className="pdf-focus-page__error" role="alert">第 {pageNumber} 页渲染失败</div>
      ) : null}
      <span className="pdf-focus-page__number">{pageNumber}</span>
    </article>
  );
};

export const PdfReaderOverlay: React.FC<Props> = ({
  nodeId,
  onClose,
  onOpenAgent,
  onSubmitAgentMessage,
}) => {
  const node = useNodeFlowStore((state) => state.nodes.find((item) => item.id === nodeId));
  const nodes = useNodeFlowStore((state) => state.nodes);
  const links = useNodeFlowStore((state) => state.links);
  const updateNodeData = useNodeFlowStore((state) => state.updateNodeData);
  const addNode = useNodeFlowStore((state) => state.addNode);
  const connectNodes = useNodeFlowStore((state) => state.connectNodes);
  const data = node?.data as PdfInputNodeData | undefined;
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadMessage, setLoadMessage] = useState("正在准备 PDF 文稿…");
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null);
  const [selectionCommand, setSelectionCommand] = useState<PdfSelectionCommand | null>(null);
  const [highlightColor, setHighlightColor] = useState<PdfHighlightColor>("yellow");
  const [isHighlightListOpen, setIsHighlightListOpen] = useState(false);
  const pageRefs = useRef(new Map<number, HTMLElement>());

  const highlights = Array.isArray(data?.highlights) ? data.highlights : [];
  const highlightsByPage = useMemo(() => {
    const map = new Map<number, PdfHighlightAnnotation[]>();
    highlights.forEach((highlight) => {
      const list = map.get(highlight.page) || [];
      list.push(highlight);
      map.set(highlight.page, list);
    });
    return map;
  }, [highlights]);

  const linkedNotes = useMemo<LinkedNote[]>(() => {
    const nodeById = new Map(nodes.map((item) => [item.id, item]));
    const pageByNoteId = new Map(
      highlights
        .filter((highlight) => highlight.noteNodeId)
        .map((highlight) => [highlight.noteNodeId!, highlight.page])
    );
    return links
      .filter((link) => link.target === nodeId)
      .map((link) => nodeById.get(link.source))
      .filter((item): item is NodeFlowNode => !!item && textNodeTypes.has(item.type))
      .map((item) => ({
        node: item,
        page: pageByNoteId.get(item.id) || null,
      }));
  }, [highlights, links, nodeId, nodes]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!data?.pdf) {
      setLoadState("error");
      setLoadMessage("此节点还没有 PDF 文稿。");
      return undefined;
    }
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    setLoadState("loading");
    setLoadMessage("正在解析 PDF 文稿…");
    setPdfDocument(null);

    try {
      loadingTask = getDocument({ url: data.pdf });
      loadingTask.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
        if (cancelled || !total) return;
        setLoadMessage(`正在解析 PDF 文稿 · ${Math.min(100, Math.round((loaded / total) * 100))}%`);
      };
      loadingTask.promise
        .then((document) => {
          if (cancelled) return;
          setPdfDocument(document);
          setLoadState("ready");
          setLoadMessage("");
        })
        .catch((error) => {
          if (cancelled) return;
          setLoadState("error");
          setLoadMessage(error instanceof Error ? error.message : "PDF 文稿解析失败。");
        });
    } catch (error) {
      setLoadState("error");
      setLoadMessage(error instanceof Error ? error.message : "PDF 文稿解析失败。");
    }

    return () => {
      cancelled = true;
      if (loadingTask) void loadingTask.destroy();
      setPdfDocument(null);
    };
  }, [data?.pdf]);

  const goToPage = useCallback((nextPage: number) => {
    const bounded = Math.min(Math.max(1, nextPage), pdfDocument?.numPages || 1);
    setPage(bounded);
    pageRefs.current.get(bounded)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [pdfDocument?.numPages]);

  const clearSelection = useCallback(() => {
    setSelectionCommand(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const handlePageSelection = useCallback((pageNumber: number, pageElement: HTMLElement) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setSelectionCommand(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const textLayer = pageElement.querySelector<HTMLElement>(".pdf-focus-text-layer");
    if (
      !textLayer ||
      !textLayer.contains(range.startContainer) ||
      !textLayer.contains(range.endContainer)
    ) {
      setSelectionCommand(null);
      return;
    }
    const textStart = getTextOffset(range.startContainer, range.startOffset);
    const textEnd = getTextOffset(range.endContainer, range.endOffset);
    const quote = selection.toString().trim();
    if (textStart === null || textEnd === null || !quote) {
      setSelectionCommand(null);
      return;
    }
    const pageRect = pageElement.getBoundingClientRect();
    const rects = normalizePdfSelectionRects(pageRect, range.getClientRects());
    if (!rects.length) {
      setSelectionCommand(null);
      return;
    }
    const anchorRect = Array.from(range.getClientRects()).at(-1) || pageRect;
    setSelectionCommand({
      page: pageNumber,
      quote,
      textStart: Math.min(textStart, textEnd),
      textEnd: Math.max(textStart, textEnd),
      rects,
      anchorX: Math.min(window.innerWidth - 252, Math.max(12, anchorRect.left)),
      anchorY: Math.max(12, anchorRect.top - 48),
    });
  }, []);

  const createHighlight = useCallback((
    command: PdfSelectionCommand,
    noteNodeId?: string
  ) => {
    const bounds = getPdfHighlightBounds(command.rects);
    const annotation: PdfHighlightAnnotation = {
      id: createId("pdf-highlight"),
      page: command.page,
      ...bounds,
      rects: command.rects,
      quote: command.quote,
      textStart: command.textStart,
      textEnd: command.textEnd,
      noteNodeId,
      color: highlightColor,
      createdAt: Date.now(),
    };
    updateNodeData(nodeId, { highlights: [...highlights, annotation] });
    return annotation;
  }, [highlightColor, highlights, nodeId, updateNodeData]);

  const handleHighlightSelection = useCallback(() => {
    if (!selectionCommand) return;
    createHighlight(selectionCommand);
    clearSelection();
  }, [clearSelection, createHighlight, selectionCommand]);

  const handleCopySelection = useCallback(async () => {
    if (!selectionCommand?.quote) return;
    try {
      await navigator.clipboard.writeText(selectionCommand.quote);
    } finally {
      clearSelection();
    }
  }, [clearSelection, selectionCommand?.quote]);

  const handleAskSelection = useCallback(() => {
    if (!selectionCommand) return;
    onOpenAgent?.();
    onSubmitAgentMessage?.(
      [
        "请基于以下 PDF 文稿选区回答：",
        `文件：${data?.filename || data?.label || data?.title || "PDF"}`,
        `页码：${selectionCommand.page}`,
        "",
        selectionCommand.quote,
      ].join("\n")
    );
    clearSelection();
  }, [clearSelection, data?.filename, data?.label, data?.title, onOpenAgent, onSubmitAgentMessage, selectionCommand]);

  const handleCreateNote = useCallback(() => {
    if (!selectionCommand || !node) return;
    const noteIndex = linkedNotes.length;
    const noteId = addNode(
      "text",
      {
        x: node.position.x + 304,
        y: node.position.y + noteIndex * 208,
      },
      undefined,
      {
        title: `第 ${selectionCommand.page} 页批注`,
        text: buildQuoteMarkdown(selectionCommand.quote),
        documentKind: "note",
        format: "markdown",
      } as Partial<TextNodeData>
    );
    connectNodes({
      source: noteId,
      target: nodeId,
      sourceHandle: "text",
      targetHandle: "text",
    });
    createHighlight(selectionCommand, noteId);
    clearSelection();
  }, [addNode, clearSelection, connectNodes, createHighlight, linkedNotes.length, node, nodeId, selectionCommand]);

  const removeHighlight = useCallback((highlightId: string) => {
    updateNodeData(nodeId, {
      highlights: highlights.filter((highlight) => highlight.id !== highlightId),
    });
  }, [highlights, nodeId, updateNodeData]);

  const updateNoteText = useCallback((note: NodeFlowNode, text: string) => {
    updateNodeData(note.id, {
      text,
      content: text,
      updatedAt: Date.now(),
    } as Partial<TextNodeData>);
  }, [updateNodeData]);

  if (typeof document === "undefined") return null;

  const content = (
    <section className="pdf-focus-workspace" role="dialog" aria-modal="true" aria-label="PDF 文稿聚焦视图">
      <div className="pdf-focus-title">
        <FilePdf size={17} weight="duotone" aria-hidden="true" />
        <span>
          <strong>{data?.label || data?.filename || data?.title || "PDF 文稿"}</strong>
          <small>{pdfDocument ? `${pdfDocument.numPages} 页` : loadMessage}</small>
        </span>
        <button
          type="button"
          className={isHighlightListOpen ? "is-active" : ""}
          onClick={() => setIsHighlightListOpen((open) => !open)}
          aria-expanded={isHighlightListOpen}
        >
          <HighlighterCircle size={15} weight="duotone" aria-hidden="true" />
          {highlights.length}
        </button>
        {isHighlightListOpen ? (
          <aside className="pdf-focus-highlight-list" aria-label="PDF 高亮列表">
            {highlights.length ? highlights.map((highlight) => (
              <div key={highlight.id}>
                <button type="button" onClick={() => goToPage(highlight.page)}>
                  <span data-color={highlight.color} />
                  <span>
                    <strong>第 {highlight.page} 页</strong>
                    <small>{highlight.quote || "旧版区域高亮"}</small>
                  </span>
                </button>
                <button type="button" onClick={() => removeHighlight(highlight.id)} aria-label="删除高亮">
                  <Trash size={13} aria-hidden="true" />
                </button>
              </div>
            )) : <p>尚无高亮</p>}
          </aside>
        ) : null}
      </div>

      <div className="pdf-focus-pagination" aria-label="PDF 页码">
        <button type="button" onClick={() => goToPage(page - 1)} disabled={page <= 1} aria-label="上一页">
          <ArrowLeft size={15} aria-hidden="true" />
        </button>
        <label>
          <input
            type="number"
            min={1}
            max={pdfDocument?.numPages || 1}
            value={page}
            onChange={(event) => goToPage(Number(event.target.value) || 1)}
            aria-label="当前页"
          />
          <span>/ {pdfDocument?.numPages || 1}</span>
        </label>
        <button
          type="button"
          onClick={() => goToPage(page + 1)}
          disabled={page >= (pdfDocument?.numPages || 1)}
          aria-label="下一页"
        >
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="pdf-focus-view-controls">
        <button type="button" onClick={() => setZoom((value) => Math.max(70, value - 10))} aria-label="缩小">
          <Minus size={14} aria-hidden="true" />
        </button>
        <span>{zoom}%</span>
        <button type="button" onClick={() => setZoom((value) => Math.min(170, value + 10))} aria-label="放大">
          <Plus size={14} aria-hidden="true" />
        </button>
        <i aria-hidden="true" />
        <button type="button" onClick={onClose} aria-label="关闭 PDF 文稿">
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      <main
        ref={setScrollRoot}
        className="pdf-focus-viewport"
        onScroll={() => setSelectionCommand(null)}
      >
        {loadState === "loading" ? (
          <div className="pdf-focus-loading" role="status">
            <div><i /><i /><i /><i /></div>
            <strong>{loadMessage}</strong>
          </div>
        ) : null}
        {loadState === "error" ? (
          <div className="pdf-focus-load-error" role="alert">
            <FilePdf size={28} weight="duotone" aria-hidden="true" />
            <strong>无法打开 PDF 文稿</strong>
            <span>{loadMessage}</span>
          </div>
        ) : null}
        {pdfDocument ? (
          <div className="pdf-focus-page-stack" style={{ "--pdf-focus-zoom": zoom / 100 } as React.CSSProperties}>
            {Array.from({ length: pdfDocument.numPages }, (_, index) => {
              const pageNumber = index + 1;
              return (
                <div
                  key={pageNumber}
                  ref={(element) => {
                    if (element) pageRefs.current.set(pageNumber, element);
                    else pageRefs.current.delete(pageNumber);
                  }}
                  className="pdf-focus-page-anchor"
                >
                  <PdfPageSurface
                    document={pdfDocument}
                    pageNumber={pageNumber}
                    zoom={zoom}
                    scrollRoot={scrollRoot}
                    highlights={highlightsByPage.get(pageNumber) || []}
                    onVisible={setPage}
                    onSelection={handlePageSelection}
                  />
                </div>
              );
            })}
          </div>
        ) : null}
      </main>

      <aside className="pdf-focus-notes" aria-label="PDF 关联批注">
        <header>
          <NotePencil size={15} weight="duotone" aria-hidden="true" />
          <span>
            <strong>关联批注</strong>
            <small>{linkedNotes.length} 个文本节点</small>
          </span>
        </header>
        <div className="pdf-focus-note-list">
          {linkedNotes.length ? linkedNotes.map(({ node: note, page: notePage }) => {
            const noteData = note.data as TextNodeData;
            return (
              <article key={note.id} className="pdf-focus-note-node">
                <button
                  type="button"
                  className="pdf-focus-note-node__heading"
                  onClick={() => notePage && goToPage(notePage)}
                  disabled={!notePage}
                >
                  <span>{notePage ? `P.${notePage}` : "NOTE"}</span>
                  <strong>{noteData.title || "Markdown 批注"}</strong>
                </button>
                <textarea
                  value={noteData.text || ""}
                  onChange={(event) => updateNoteText(note, event.target.value)}
                  placeholder="Markdown 批注"
                  aria-label={`${noteData.title || "PDF 批注"}内容`}
                />
              </article>
            );
          }) : (
            <div className="pdf-focus-notes__empty">
              选择 PDF 文字后点击批注，文本节点会出现在这里。
            </div>
          )}
        </div>
      </aside>

      {selectionCommand ? (
        <div
          className="pdf-focus-selection-command"
          style={{ left: selectionCommand.anchorX, top: selectionCommand.anchorY }}
          aria-label="PDF 文本选中操作"
        >
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => void handleCopySelection()} title="复制" aria-label="复制">
            <Copy size={15} aria-hidden="true" />
          </button>
          <div className="pdf-focus-highlight-colors">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                data-color={color}
                data-active={highlightColor === color}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setHighlightColor(color)}
                aria-label={`${color} 高亮颜色`}
              />
            ))}
          </div>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={handleHighlightSelection} title="高亮" aria-label="高亮">
            <HighlighterCircle size={15} aria-hidden="true" />
          </button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={handleAskSelection} title="询问 Stylo" aria-label="询问 Stylo">
            <ChatCenteredDots size={15} aria-hidden="true" />
          </button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={handleCreateNote} title="新增批注" aria-label="新增批注">
            <NotePencil size={15} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </section>
  );

  return createPortal(content, document.body);
};
