import React, { useRef, useLayoutEffect, useState, useEffect, useMemo, useCallback } from "react";
import { BaseNode } from "./BaseNode";
import { TextNodeData } from "../types";
import { useNodeFlowStore } from "../store/nodeFlowStore";
import { AtSign, FileDiff } from "lucide-react";
import {
    buildMentionIndex,
    buildMentionTargets,
    computeMentionData,
    MentionTarget,
    resolveMentionTarget,
    toSearch,
} from "../utils/entityBindings";

type Props = {
    id: string;
    data: TextNodeData;
};

const escapeHtml = (value: string) =>
    value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

const escapeAttr = (value: string) => escapeHtml(value).replace(/\n/g, "&#10;");

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getPlainText = (el: HTMLElement) => (el.innerText || "").replace(/\u200B/g, "").replace(/\r/g, "");

const getRangeTextLength = (range: Range) => {
    const fragment = range.cloneContents();
    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
    let length = 0;
    let node = walker.nextNode();
    while (node) {
        if (node.nodeType === Node.TEXT_NODE) {
            length += (node.textContent || "").length;
        } else if ((node as HTMLElement).tagName === "BR") {
            length += 1;
        }
        node = walker.nextNode();
    }
    return length;
};

const getCaretOffset = (el: HTMLElement) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return 0;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.startContainer)) return 0;
    const preRange = range.cloneRange();
    preRange.selectNodeContents(el);
    preRange.setEnd(range.startContainer, range.startOffset);
    return getRangeTextLength(preRange);
};

const setCaretOffset = (el: HTMLElement, offset: number) => {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
    let current = 0;
    let node = walker.nextNode();
    while (node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent || "";
            const next = current + text.length;
            if (offset <= next) {
                range.setStart(node, Math.max(0, offset - current));
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
                return;
            }
            current = next;
        } else if ((node as HTMLElement).tagName === "BR") {
            const next = current + 1;
            if (offset <= next) {
                range.setStartAfter(node);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
                return;
            }
            current = next;
        }
        node = walker.nextNode();
    }
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
};

const getSelectionOffsets = (el: HTMLElement, fallback: number) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return { start: fallback, end: fallback };
    const range = selection.getRangeAt(0);
    if (!el.contains(range.startContainer)) return { start: fallback, end: fallback };
    const preStart = range.cloneRange();
    preStart.selectNodeContents(el);
    preStart.setEnd(range.startContainer, range.startOffset);
    const start = getRangeTextLength(preStart);
    const preEnd = range.cloneRange();
    preEnd.selectNodeContents(el);
    preEnd.setEnd(range.endContainer, range.endOffset);
    const end = getRangeTextLength(preEnd);
    return { start, end };
};

const getCaretRect = (el: HTMLElement) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.startContainer)) return null;
    if (!range.collapsed) return range.getBoundingClientRect();
    const rects = range.getClientRects();
    if (rects.length > 0) return rects[0];
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    const clone = range.cloneRange();
    clone.insertNode(marker);
    const rect = marker.getBoundingClientRect();
    marker.parentNode?.removeChild(marker);
    return rect;
};

export const TextNode: React.FC<Props & { selected?: boolean }> = ({ data, id, selected }) => {
    const { updateNodeData, nodeFlowContext } = useNodeFlowStore();
    const editorRef = useRef<HTMLDivElement>(null);
    const shellRef = useRef<HTMLDivElement>(null);
    const isComposingRef = useRef(false);
    const lastHtmlRef = useRef<string>("");
    const pendingSelectionRef = useRef<number | null>(null);
    const baseStyleRef = useRef<{ height?: string; minHeight?: string } | null>(null);
    const isLocalUpdateRef = useRef(false);
    const skipNextCursorUpdateRef = useRef(false);
    const skipBeforeInputRef = useRef(false);
    const [draftText, setDraftText] = useState(data.text || "");
    const [cursorPos, setCursorPos] = useState((data.text || "").length);
    const [isFocused, setIsFocused] = useState(false);
    const [pickerPos, setPickerPos] = useState<{ left: number; top: number } | null>(null);
    const isScriptDocument = data.documentKind === "script" || data.format === "fountain";
    const nodeTitle = isScriptDocument
        ? data.title || "剧本文档"
        : !data.title || data.title === "Markdown 文本"
            ? "文本"
            : data.title;
    const storedScriptPreview = (data as TextNodeData & { preview?: string }).preview;
    const scriptPreview = useMemo(() => {
        const fullText = (data.text || "").replace(/\s+/g, " ").trim();
        const source = storedScriptPreview?.trim() || fullText;
        const clipped = source.slice(0, 180).trimEnd();
        return `${clipped}${fullText.length > clipped.length ? "…" : ""}`;
    }, [data.text, storedScriptPreview]);
    const mentionTargets = useMemo(() => {
        const roles = nodeFlowContext?.roles || [];
        return buildMentionTargets(roles);
    }, [nodeFlowContext?.roles]);

    const mentionIndex = useMemo(() => {
        return buildMentionIndex(mentionTargets.all);
    }, [mentionTargets]);

    const resolveMention = useCallback(
        (name: string) => {
            return resolveMentionTarget(name, mentionIndex);
        },
        [mentionIndex]
    );

    const computeMentionMeta = useCallback(
        (text: string) => {
            return computeMentionData(text, mentionIndex);
        },
        [mentionIndex]
    );

    const mentionState = useMemo(() => {
        const pos = Math.min(cursorPos, draftText.length);
        const textBefore = draftText.slice(0, pos);
        const match = textBefore.match(/@([\w\u4e00-\u9fa5\-\/]*)$/);
        if (!match) return null;
        const prevChar = textBefore.length > 1 ? textBefore[textBefore.length - match[0].length - 1] : "";
        if (prevChar && !/\s|[\(\[\{,，。:：;；"“”'‘’]/.test(prevChar)) return null;
        return {
            query: match[1] || "",
            start: textBefore.lastIndexOf("@"),
            end: pos,
        };
    }, [draftText, cursorPos]);

    const filteredMentions = useMemo(() => {
        if (!mentionState) {
            return mentionTargets;
        }
        const query = toSearch(mentionState.query.trim());
        if (!query) {
            return mentionTargets;
        }
        const filterList = (list: MentionTarget[]) => list.filter((item) => item.search.includes(query));
        return {
            persons: filterList(mentionTargets.persons),
            scenes: filterList(mentionTargets.scenes),
            identities: filterList(mentionTargets.identities),
            all: filterList(mentionTargets.all),
        };
    }, [mentionState, mentionTargets]);

    const showMentionPicker = isFocused && !!mentionState;
    const isDocumentTextNode = typeof data.episodeId === "number" || typeof data.documentId === "string";
    const isReadOnly = data.readOnly === true;
    const isAgentReviewPending = data.agentReviewPending === true;

    const renderedHtml = useMemo(() => {
        if (isScriptDocument || !draftText) return "";
        const parts: string[] = [];
        let lastIndex = 0;
        const regex = /@([\w\u4e00-\u9fa5\-\/]+)/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(draftText))) {
            const start = match.index;
            const end = start + match[0].length;
            parts.push(escapeHtml(draftText.slice(lastIndex, start)));
            const name = match[1];
            const hit = resolveMention(name);
            const kind = hit?.kind || "unknown";
            const status = hit ? "match" : "missing";
            const tooltipRaw = (hit?.detail || hit?.summary || "").trim();
            const tooltip = tooltipRaw ? escapeAttr(tooltipRaw) : "";
            const tooltipAttr = tooltip ? ` data-tooltip="${tooltip}"` : "";
            parts.push(
                `<span class="text-mention" data-kind="${kind}" data-status="${status}"${tooltipAttr}>${escapeHtml(match[0])}</span>`
            );
            lastIndex = end;
        }
        parts.push(escapeHtml(draftText.slice(lastIndex)));
        return parts.join("").replace(/\n/g, "<br />");
    }, [draftText, isScriptDocument, resolveMention]);

    const updateCursor = useCallback(() => {
        const el = editorRef.current;
        if (!el) return;
        const pos = getCaretOffset(el);
        setCursorPos(pos);
    }, []);

    const insertNewline = useCallback(() => {
        const el = editorRef.current;
        if (!el) return;
        const { start, end } = getSelectionOffsets(el, cursorPos);
        const next = `${draftText.slice(0, start)}\n${draftText.slice(end)}`;
        const nextPos = start + 1;
        setDraftText(next);
        setCursorPos(nextPos);
        pendingSelectionRef.current = nextPos;
        isLocalUpdateRef.current = true;
        skipNextCursorUpdateRef.current = true;
        const mentions = computeMentionMeta(next);
        updateNodeData(id, { text: next, atMentions: mentions.atMentions, entityBindings: mentions.entityBindings });
        requestAnimationFrame(() => {
            if (!el) return;
            el.focus();
            setCaretOffset(el, nextPos);
        });
    }, [computeMentionMeta, cursorPos, draftText, id, updateNodeData]);

    const handleInput = useCallback(() => {
        const el = editorRef.current;
        if (!el) return;
        const value = getPlainText(el);
        const pos = getCaretOffset(el);
        setDraftText(value);
        setCursorPos(pos);
        pendingSelectionRef.current = pos;
        if (!isComposingRef.current) {
            isLocalUpdateRef.current = true;
            const mentions = computeMentionMeta(value);
            updateNodeData(id, { text: value, atMentions: mentions.atMentions, entityBindings: mentions.entityBindings });
        }
    }, [computeMentionMeta, id, updateNodeData]);

    const insertMention = (target: MentionTarget) => {
        const start = mentionState ? mentionState.start : cursorPos;
        const end = mentionState ? mentionState.end : cursorPos;
        const before = draftText.slice(0, start);
        const after = draftText.slice(end);
        const insertion = `@${target.name} `;
        const next = `${before}${insertion}${after}`;
        const nextPos = start + insertion.length;
        setDraftText(next);
        setCursorPos(nextPos);
        pendingSelectionRef.current = nextPos;
        isLocalUpdateRef.current = true;
        const mentions = computeMentionMeta(next);
        updateNodeData(id, { text: next, atMentions: mentions.atMentions, entityBindings: mentions.entityBindings });
        requestAnimationFrame(() => {
            const el = editorRef.current;
            if (!el) return;
            el.focus();
            setCaretOffset(el, nextPos);
        });
    };

    const updatePickerPosition = useCallback(() => {
        if (!showMentionPicker) return;
        const shell = shellRef.current;
        const editor = editorRef.current;
        if (!shell || !editor) return;
        const caretRect = getCaretRect(editor);
        const shellRect = shell.getBoundingClientRect();
        const editorRect = editor.getBoundingClientRect();
        const anchorLeft = caretRect ? caretRect.left : editorRect.left + 12;
        const anchorBottom = caretRect ? caretRect.bottom : editorRect.top + 28;
        const pickerWidth = 300;
        const left = clamp(anchorLeft - shellRect.left, 12, Math.max(12, shellRect.width - pickerWidth - 12));
        const top = anchorBottom - shellRect.top + 8;
        setPickerPos({ left, top });
    }, [showMentionPicker]);

    useLayoutEffect(() => {
        const el = editorRef.current;
        if (!el || isComposingRef.current) return;
        const html = renderedHtml;
        if (html !== lastHtmlRef.current) {
            el.innerHTML = html;
            lastHtmlRef.current = html;
        }
        if (document.activeElement === el) {
            const targetPos = pendingSelectionRef.current ?? cursorPos;
            setCaretOffset(el, Math.min(targetPos, draftText.length));
            pendingSelectionRef.current = null;
        }
        updatePickerPosition();
    }, [renderedHtml, draftText, cursorPos, updatePickerPosition]);

    useEffect(() => {
        const shell = shellRef.current;
        if (!shell) return;
        const nodeEl = shell.closest(".react-flow__node") as HTMLElement | null;
        if (!nodeEl) return;
        const cardEl = nodeEl.querySelector(".node-card-base") as HTMLElement | null;
        if (cardEl) {
            const hasContent = draftText.trim().length > 0;
            if (hasContent) cardEl.dataset.hasContent = "true";
            else delete cardEl.dataset.hasContent;
        }
        if (!baseStyleRef.current) {
            baseStyleRef.current = {
                height: typeof nodeEl.style.height === "string" ? nodeEl.style.height : undefined,
                minHeight: typeof nodeEl.style.minHeight === "string" ? nodeEl.style.minHeight : undefined,
            };
        }
        if (isScriptDocument) {
            nodeEl.style.removeProperty("height");
            nodeEl.style.removeProperty("min-height");
            return;
        }
        const trim = draftText.trim();
        if (!trim) {
            if (baseStyleRef.current.height !== undefined) nodeEl.style.height = baseStyleRef.current.height;
            else nodeEl.style.removeProperty("height");
            if (baseStyleRef.current.minHeight !== undefined) nodeEl.style.minHeight = baseStyleRef.current.minHeight;
            else nodeEl.style.removeProperty("min-height");
            return;
        }
        const editor = editorRef.current;
        if (!editor) return;
        const paddingY = editor.clientHeight - editor.scrollHeight;
        const desired = editor.scrollHeight + Math.max(0, paddingY);
        const next = Math.max(nodeEl.offsetHeight || 0, desired);
        nodeEl.style.height = `${next}px`;
        nodeEl.style.minHeight = `${next}px`;
    }, [draftText, isScriptDocument]);

    useEffect(() => {
        if (isComposingRef.current) return;
        if (isLocalUpdateRef.current) {
            isLocalUpdateRef.current = false;
            return;
        }
        if ((data.text || "") === draftText) return;
        const next = data.text || "";
        setDraftText(next);
        setCursorPos(next.length);
        pendingSelectionRef.current = next.length;
    }, [data.text]);

    useEffect(() => {
        if (isScriptDocument) return;
        if (isComposingRef.current) return;
        const text = data.text || draftText;
        if (!text.includes("@")) return;
        const mentions = computeMentionMeta(text);
        updateNodeData(id, { atMentions: mentions.atMentions, entityBindings: mentions.entityBindings });
    }, [computeMentionMeta, data.text, draftText, id, isScriptDocument, mentionTargets, updateNodeData]);

    useEffect(() => {
        if (showMentionPicker) return;
        setPickerPos(null);
    }, [showMentionPicker]);

    useEffect(() => {
        if (!showMentionPicker) return;
        const handleScroll = () => updatePickerPosition();
        window.addEventListener("scroll", handleScroll, true);
        window.addEventListener("resize", handleScroll);
        return () => {
            window.removeEventListener("scroll", handleScroll, true);
            window.removeEventListener("resize", handleScroll);
        };
    }, [showMentionPicker, updatePickerPosition]);

    return (
        <BaseNode
            title={nodeTitle}
            onTitleChange={isReadOnly ? undefined : (title) => updateNodeData(id, { title })}
            inputs={isDocumentTextNode
                ? isScriptDocument
                    ? ["image", "text", { id: "contains", hidden: true, top: "18%" }]
                    : ["image", "text"]
                : ["text"]}
            outputs={["text"]}
            selected={selected}
            variant="text"
            nodeType={isScriptDocument ? "script-document" : isDocumentTextNode ? "text-document" : "text"}
            cardColor={data.cardColor}
            headerActions={
                isAgentReviewPending ? (
                    <span className="text-node-review-status" title="Stylo 修改待审核">
                        <FileDiff size={12} strokeWidth={1.9} />
                        <span>待审核</span>
                    </span>
                ) : undefined
            }
        >
            <div
                ref={shellRef}
                className={`text-node-shell relative flex-1 ${isScriptDocument ? "script-node-preview-shell" : ""}`}
                data-has-content={draftText.trim().length > 0 ? "true" : "false"}
            >
                {isScriptDocument ? (
                    <div
                        className="script-manuscript-node is-single-sheet is-open"
                        aria-label={`${data.title || "剧本文档"}，单张稿纸`}
                        data-wrapper-state="open"
                        data-wrapper-members="0"
                    >
                        <div className="script-manuscript-node__head">
                            <strong>{data.title || "剧本文档"}</strong>
                            <span>SINGLE SHEET</span>
                        </div>
                        <div className="script-node-preview" title={scriptPreview || "剧本内容为空"}>
                            {scriptPreview || "剧本内容为空"}
                        </div>
                        <span className="script-manuscript-node__format">FOUNTAIN MANUSCRIPT</span>
                    </div>
                ) : (
                  <div
                    ref={editorRef}
                    className="text-node-editor nodrag"
                    contentEditable={!isReadOnly}
                    suppressContentEditableWarning
                    data-placeholder="使用 Markdown 记录文本…"
                    onInput={handleInput}
                    onBeforeInput={(e) => {
                        if (isComposingRef.current) return;
                        const native = e.nativeEvent as InputEvent;
                        if (!native || typeof native.inputType !== "string") return;
                        if (skipBeforeInputRef.current) {
                            skipBeforeInputRef.current = false;
                            return;
                        }
                        if (native.inputType === "insertParagraph" || native.inputType === "insertLineBreak") {
                            e.preventDefault();
                            insertNewline();
                        }
                    }}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") {
                            e.preventDefault();
                            if (!isComposingRef.current) {
                                insertNewline();
                            }
                            skipBeforeInputRef.current = true;
                        }
                    }}
                    onKeyUp={() => {
                        if (skipNextCursorUpdateRef.current) {
                            skipNextCursorUpdateRef.current = false;
                            return;
                        }
                        updateCursor();
                        updatePickerPosition();
                    }}
                    onClick={() => {
                        updateCursor();
                        updatePickerPosition();
                    }}
                    onFocus={() => {
                        setIsFocused(true);
                        updateCursor();
                        updatePickerPosition();
                    }}
                    onBlur={() => {
                        setIsFocused(false);
                        if (!isComposingRef.current && draftText !== data.text) {
                            isLocalUpdateRef.current = true;
                            const mentions = computeMentionMeta(draftText);
                            updateNodeData(id, { text: draftText, atMentions: mentions.atMentions, entityBindings: mentions.entityBindings });
                        }
                    }}
                    onCompositionStart={() => {
                        isComposingRef.current = true;
                    }}
                    onCompositionEnd={() => {
                        isComposingRef.current = false;
                        handleInput();
                    }}
                  />
                )}

                {!isScriptDocument && showMentionPicker && pickerPos && (
                    <div
                        className="mention-picker animate-in fade-in slide-in-from-top-1 absolute z-30"
                        style={{ left: pickerPos.left, top: pickerPos.top, width: 280 }}
                    >
                        <div className="mention-picker-header">
                            <AtSign size={10} /> 数据绑定
                        </div>
                        {filteredMentions.persons.length > 0 && (
                            <div className="mention-picker-section">
                                <div className="mention-picker-title">人物身份证</div>
                                <div className="mention-picker-grid">
                                    {filteredMentions.persons.map((f) => (
                                        <button
                                            key={`identity-person-${f.name}-${f.identityId}`}
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => insertMention(f)}
                                            className="mention-picker-item"
                                        >
                                            {f.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {filteredMentions.scenes.length > 0 && (
                            <div className="mention-picker-section">
                                <div className="mention-picker-title">场景身份证</div>
                                <div className="mention-picker-grid">
                                    {filteredMentions.scenes.map((c) => (
                                        <button
                                            key={`identity-scene-${c.name}-${c.identityId}`}
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => insertMention(c)}
                                            className="mention-picker-item"
                                        >
                                            {c.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {filteredMentions.identities.length === 0 && (
                            <div className="mention-picker-section">
                                <div className="mention-picker-title">未找到可绑定身份证</div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </BaseNode>
    );
};
