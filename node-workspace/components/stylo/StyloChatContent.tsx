import React, { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { CaretRight, Check, Checks, X } from "@phosphor-icons/react";
import type { ApprovalChoice, ApprovalMessage, ChatMessage, Message, StatusMessage, ToolMessage, ToolPayload } from "./types";
import {
  buildStyloMessageTimeline,
  type StyloDisplayMessage as DisplayMessageItem,
  type ToolMessageThread as ToolThread,
} from "./messageTimeline";
import { renderStyloInlineMarkdown, renderStyloMarkdown } from "./StyloMarkdown";
import { renderStyloToolOutput } from "./StyloToolOutput";
import { findStyloToolDescriptor } from "../../../agents/runtime/toolCatalog";
import { resolveToolDisplayOutcome, type ToolDisplayOutcome } from "./toolDisplayOutcome";
import { StyloMessageIcon } from "./StyloMessageIcon";
import {
  STYLO_PRIMARY_MESSAGE_VISUALS,
  resolveStyloToolMessageVisual,
} from "./messageVisualPolicy";

type Props = {
  messages: Message[];
  isSending: boolean;
  onApprovalChoice?: (approval: ApprovalMessage["approval"], choice: ApprovalChoice) => void;
  className?: string;
  style?: React.CSSProperties;
  revealMode?: "scroll" | "latest";
  latestBlockMaxHeight?: number;
};

const toolStatusLabel: Record<ToolDisplayOutcome, string> = {
  queued: "等待中",
  running: "执行中",
  success: "成功",
  error: "失败",
  skipped: "已跳过",
  no_change: "未变更",
};

const toolStatusClass: Record<ToolDisplayOutcome, string> = {
  queued: "stylo-tool-status stylo-tool-status--queued",
  running: "stylo-tool-status stylo-tool-status--running",
  success: "stylo-tool-status stylo-tool-status--success",
  error: "stylo-tool-status stylo-tool-status--error",
  skipped: "stylo-tool-status stylo-tool-status--skipped",
  no_change: "stylo-tool-status stylo-tool-status--no-change",
};

const lineSummaryClass =
  "stylo-work-detail-row w-full px-1 py-1 text-[12px] text-[var(--app-text-muted)]";

const styloBodyTextClass =
  "text-[15px] leading-7 text-[var(--app-text-primary)] md:text-[13px] md:leading-relaxed";

const styloSecondaryTextClass =
  "text-[14px] leading-6 text-[var(--app-text-secondary)] md:text-[12px] md:leading-relaxed";

const renderFoldoutSurface = (title: string, children: React.ReactNode) => (
  <div className="ml-3 mt-2 border-l-2 border-[var(--app-border)] pl-4">
    <div className="text-[11px] font-medium text-[var(--app-text-muted)]">{title}</div>
    <div className="mt-2 space-y-2 text-[var(--app-text-secondary)]">{children}</div>
  </div>
);

const formatThoughtDuration = (durationMs: number) => {
  const totalSeconds = Math.max(0.1, durationMs / 1000);
  if (totalSeconds < 10) return `${totalSeconds.toFixed(1)} 秒`;
  if (totalSeconds < 60) return `${Math.round(totalSeconds)} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
};

const trimToolSummary = (summary?: string, fallback?: string) => {
  if (!summary?.trim()) return fallback || "工具";
  const cleaned = summary.replace(/^[^：:]+[：:]\s*/, "").trim();
  return cleaned || summary;
};

const buildToolActionLabel = (tool: ToolPayload) => {
  const descriptor = findStyloToolDescriptor(tool.name);
  if (!tool.summary?.trim()) return descriptor?.label || tool.name;
  const subject = trimToolSummary(tool.summary, descriptor?.label || tool.name);
  const interaction = descriptor?.interaction;
  if (interaction === "read") return `查阅 ${subject}`;
  if (interaction === "edit") return `编辑 ${subject}`;
  if (interaction === "approve") return `确认 ${subject}`;
  return `操作 ${subject}`;
};

const renderDisclosureHeader = ({
  icon,
  label,
  meta,
  expandable,
}: {
  icon: React.ReactNode;
  label: string;
  meta?: React.ReactNode;
  expandable?: boolean;
}) => (
  <div className="inline-flex max-w-full items-center gap-2 align-top">
    {icon}
    <span className="stylo-disclosure-label shrink min-w-0 text-[13px] font-medium text-[var(--app-text-primary)]">{label}</span>
    {meta ? <span className="stylo-disclosure-meta shrink-0 text-[11px] font-medium">{meta}</span> : null}
    {expandable ? (
      <CaretRight
        size={14}
        className="stylo-disclosure-caret shrink-0 text-[var(--app-text-muted)] transition-transform duration-200 group-open:rotate-90"
        weight="bold"
      />
    ) : null}
  </div>
);

const buildToolDetailsText = (thread: ToolThread) => {
  const chunks: string[] = [];
  if (thread.request?.tool.summary?.trim()) {
    chunks.push(thread.request.tool.summary.trim());
  }
  if (
    thread.result?.tool.summary?.trim() &&
    thread.result.tool.summary.trim() !== thread.request?.tool.summary?.trim()
  ) {
    chunks.push(thread.result.tool.summary.trim());
  }
  if (thread.result?.tool.evidence?.length) {
    chunks.push(thread.result.tool.evidence.join("\n"));
  }
  if (thread.result?.tool.output?.trim()) {
    try {
      const parsed = JSON.parse(thread.result.tool.output);
      chunks.push(JSON.stringify(parsed, null, 2));
    } catch {
      chunks.push(thread.result.tool.output.trim());
    }
  }
  return chunks.join("\n\n").trim();
};

const renderThinkingExpansion = (status: StatusMessage["statusCard"]) => {
  const content = (status.summary || status.detail || "").trim();
  const stepDetails = status.steps
    .map((step) => [step.label, step.detail].filter(Boolean).join(" · ").trim())
    .filter(Boolean);
  const lines = [content, ...stepDetails].filter(Boolean);
  if (!lines.length) return null;
  return (
    <div className="mt-2 border-l-2 border-[var(--app-border)] pl-4">
      <div className={`space-y-2 ${styloSecondaryTextClass}`}>
        {lines.map((line, index) => (
          <div key={`${index}-${line.slice(0, 16)}`} className="whitespace-pre-wrap">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
};

const renderToolExpansion = (thread: ToolThread) => {
  const toolOutputView = thread.result?.tool ? renderStyloToolOutput(thread.result.tool) : null;
  const content = buildToolDetailsText(thread);
  if (!toolOutputView && !content) return null;
  return (
    <div className="mt-2 space-y-2">
      {toolOutputView ? (
        <div className="stylo-tool-detail-surface px-3.5 py-3">
          {toolOutputView}
        </div>
      ) : null}
      {content ? (
        <pre className="stylo-tool-detail-surface max-h-[280px] overflow-auto px-3.5 py-3 text-[11.5px] leading-6 text-[var(--app-text-secondary)] whitespace-pre-wrap">
          <code>{content}</code>
        </pre>
      ) : null}
    </div>
  );
};

const renderToolThread = (thread: ToolThread) => {
  const effectiveTool = thread.result?.tool || thread.request?.tool;
  if (!effectiveTool) return null;
  const hasDetails =
    !!thread.result?.tool.output ||
    !!thread.result?.tool.summary ||
    !!thread.result?.tool.evidence?.length;
  const actionLabel = buildToolActionLabel(effectiveTool);
  const status = resolveToolDisplayOutcome(thread.request?.tool, thread.result?.tool);
  const statusText = toolStatusLabel[status];
  const visual = resolveStyloToolMessageVisual(effectiveTool.name);

  if (!hasDetails && !thread.result) {
    return (
      <div className={`${lineSummaryClass} stylo-work-detail-row--tool`}>
        <div className="inline-flex max-w-full items-center gap-2">
          {renderDisclosureHeader({
            icon: <StyloMessageIcon visual={visual} status={status} compact active={status === "running"} />,
            label: actionLabel,
            meta: <span className={toolStatusClass[status]}>{statusText}</span>,
          })}
        </div>
      </div>
    );
  }

  return (
    <details className={`${lineSummaryClass} stylo-work-detail-row--tool group`}>
      <summary className="list-none cursor-pointer py-1 text-left [&::-webkit-details-marker]:hidden">
        {renderDisclosureHeader({
          icon: <StyloMessageIcon visual={visual} status={status} compact active={status === "running"} />,
          label: actionLabel,
          meta: <span className={toolStatusClass[status]}>{statusText}</span>,
          expandable: true,
        })}
      </summary>
      {renderToolExpansion(thread)}
    </details>
  );
};

const buildThinkingLabel = (status: StatusMessage["statusCard"]) => {
  if (!status.isThinking) return status.headline;
  const duration = Math.max(0, status.updatedAt - status.startedAt);
  if (status.status === "running") return "思考中";
  return `思考了 ${formatThoughtDuration(duration)}`;
};

const renderStatusLine = (message: StatusMessage, options?: { expanded?: boolean }) => {
  const expanded = options?.expanded || false;
  const status = message.statusCard;
  const visual = status.isThinking
    ? STYLO_PRIMARY_MESSAGE_VISUALS.thinking
    : STYLO_PRIMARY_MESSAGE_VISUALS.response;

  if (!status.steps.length && !status.detail) {
    return (
      <div className={`${lineSummaryClass} stylo-work-detail-row--status`}>
        <div className="inline-flex max-w-full items-center gap-2">
          {renderDisclosureHeader({
            icon: (
              <StyloMessageIcon
                visual={visual}
                status={status.status}
                compact
                active={status.status === "running"}
              />
            ),
            label: buildThinkingLabel(status),
          })}
        </div>
      </div>
    );
  }

  return (
    <details className={`${lineSummaryClass} stylo-work-detail-row--status group`} open={expanded || undefined}>
      <summary className="list-none cursor-pointer py-1 text-left [&::-webkit-details-marker]:hidden">
        {renderDisclosureHeader({
          icon: (
            <StyloMessageIcon
              visual={visual}
              status={status.status}
              compact
              active={status.status === "running"}
            />
          ),
          label: buildThinkingLabel(status),
          expandable: true,
        })}
      </summary>
      {renderThinkingExpansion(status)}
    </details>
  );
};

const renderAssistantPanel = (message: ChatMessage) => {
  const planItems = message.meta?.planItems || [];
  const searchEnabled = message.meta?.searchEnabled;
  const searchUsed = message.meta?.searchUsed;
  const searchQueries = message.meta?.searchQueries || [];
  return (
    <div className="w-full space-y-3 px-1">
      {(searchEnabled || searchUsed) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="stylo-assistant-tag inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
            {searchUsed ? "已搜索" : "搜索开启"}
          </span>
        </div>
      )}
      {searchQueries.length > 0 && (
        <details className={styloSecondaryTextClass}>
          <summary className="cursor-pointer marker:text-[var(--app-text-muted)]">
            搜索记录
          </summary>
          {renderFoldoutSurface(
            "搜索记录",
            <ul className={`list-disc space-y-1 pl-5 ${styloSecondaryTextClass}`}>
              {searchQueries.map((q, idx) => (
                <li key={`${idx}-${q.slice(0, 8)}`}>{q}</li>
              ))}
            </ul>
          )}
        </details>
      )}
      {planItems.length > 0 ? (
        <details className={styloSecondaryTextClass}>
          <summary className="cursor-pointer marker:text-[var(--app-text-muted)]">查看计划</summary>
          {renderFoldoutSurface(
            "计划",
            <ul className={`list-decimal space-y-1 pl-5 ${styloBodyTextClass}`}>
              {planItems.map((item, idx) => (
                <li key={`${idx}-${item.slice(0, 8)}`}>{renderStyloInlineMarkdown(item)}</li>
              ))}
            </ul>
          )}
        </details>
      ) : null}
      {message.text ? (
        message.meta?.isStreaming
          ? <div className={`${styloBodyTextClass} whitespace-pre-wrap break-words`}>{message.text}</div>
          : renderStyloMarkdown(message.text)
      ) : null}
      {message.meta?.isStreaming ? (
        <div className="inline-flex items-center gap-2 text-[11px] text-[var(--app-text-muted)]" role="status">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" aria-hidden="true" />
          正在生成
        </div>
      ) : null}
    </div>
  );
};

const renderApprovalPanel = (
  message: ApprovalMessage,
  onApprovalChoice?: (approval: ApprovalMessage["approval"], choice: ApprovalChoice) => void
) => {
  const { approval } = message;
  const pending = approval.status === "pending";
  const statusLabel =
    approval.status === "completed"
      ? "已完成"
      : approval.status === "failed"
        ? "已失败"
        : approval.status === "approved"
      ? "已批准"
      : approval.status === "rejected"
        ? "已拒绝"
        : approval.status === "executing"
          ? "执行中"
          : "待确认";
  const statusTone = `stylo-approval-status stylo-approval-status--${approval.status}`;
  return (
    <div className="stylo-approval-panel w-full space-y-3 px-4 py-3" data-status={approval.status}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <StyloMessageIcon
            visual={STYLO_PRIMARY_MESSAGE_VISUALS.approval}
            status={approval.status === "failed" ? "error" : approval.status === "completed" ? "success" : "idle"}
          />
          <div className="min-w-0">
            <div className="text-[10px] font-medium text-[var(--app-text-muted)]">
              {approval.action === "video_generation" ? "视频生成" : "图片生成"}
            </div>
            <div className="mt-1 text-[13px] font-semibold text-[var(--app-text-primary)]">
              {approval.action === "video_generation" ? "是否批准启动视频生成任务？" : "是否批准启动图片生成任务？"}
            </div>
          </div>
        </div>
        <div className={`shrink-0 text-[10px] font-black uppercase tracking-[0.16em] ${statusTone}`}>{statusLabel}</div>
      </div>
      <div className="space-y-1 text-[12px] text-[var(--app-text-secondary)]">
        <div><span className="text-[var(--app-text-muted)]">节点：</span>{approval.nodeTitle}</div>
        <div><span className="text-[var(--app-text-muted)]">模型：</span>{approval.providerLabel} · {approval.modelLabel}</div>
        {approval.promptPreview ? (
          <div className="stylo-approval-inset px-3 py-2 text-[var(--app-text-primary)]">
            {approval.promptPreview}
          </div>
        ) : null}
        {approval.inputSummary?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {approval.inputSummary.map((item) => (
              <span
                key={item}
                className="stylo-approval-chip px-2 py-1 text-[10px] text-[var(--app-text-primary)]"
              >
                {item}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {approval.summary ? (
        <div className="stylo-approval-inset px-3 py-2 text-[12px] leading-relaxed text-[var(--app-text-primary)]">
          {approval.summary}
        </div>
      ) : null}
      {approval.steps?.length ? (
        <div className="stylo-approval-steps space-y-2 px-3 py-3">
          {approval.steps.map((step, index) => (
            <div key={step.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`mt-0.5 h-2.5 w-2.5 rounded-full ${
                    step.status === "success"
                      ? "bg-emerald-400"
                      : step.status === "error"
                        ? "bg-rose-400"
                        : step.status === "running"
                          ? "bg-sky-400"
                          : "bg-[var(--app-border-strong)]"
                  }`}
                />
                {index < approval.steps.length - 1 ? <span className="mt-1 h-full w-px bg-[var(--app-border)]" /> : null}
              </div>
              <div className="min-w-0 flex-1 pb-2">
                <div className="text-[11px] font-semibold text-[var(--app-text-primary)]">{step.label}</div>
                {step.detail ? (
                  <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--app-text-secondary)]">{step.detail}</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {pending ? (
        <div className="stylo-approval-actions flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            onClick={() => onApprovalChoice?.(approval, "approve_once")}
            className="stylo-approval-action stylo-approval-action--primary inline-flex items-center gap-1.5 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-transform active:translate-y-px"
          >
            <Check size={12} />
            同意一次
          </button>
          <button
            type="button"
            onClick={() => onApprovalChoice?.(approval, "approve_always")}
            className="stylo-approval-action stylo-approval-action--secondary inline-flex items-center gap-1.5 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-transform active:translate-y-px"
          >
            <Checks size={12} />
            以后都同意
          </button>
          <button
            type="button"
            onClick={() => onApprovalChoice?.(approval, "reject_once")}
            className="stylo-approval-action inline-flex items-center gap-1.5 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-transform active:translate-y-px"
          >
            <X size={12} />
            拒绝本次
          </button>
        </div>
      ) : null}
    </div>
  );
};

const areDisplayMessagesEqual = (left: DisplayMessageItem, right: DisplayMessageItem) => {
  if (left.kind !== right.kind || left.key !== right.key || left.order !== right.order) return false;
  if (left.kind === "chat" && right.kind === "chat") return left.message === right.message;
  if (left.kind === "status" && right.kind === "status") return left.message === right.message;
  if (left.kind === "approval" && right.kind === "approval") return left.message === right.message;
  if (left.kind === "tool" && right.kind === "tool") {
    return left.thread.request === right.thread.request && left.thread.result === right.thread.result;
  }
  return false;
};

type MessageItemViewProps = {
  item: DisplayMessageItem;
  expanded: boolean;
  attachRef: boolean;
  currentItemRef: React.MutableRefObject<HTMLDivElement | null>;
  onApprovalChoice?: (approval: ApprovalMessage["approval"], choice: ApprovalChoice) => void;
};

const MessageItemView = memo(function MessageItemView({
  item,
  expanded,
  attachRef,
  currentItemRef,
  onApprovalChoice,
}: MessageItemViewProps) {
  const isUser = item.kind === "chat" && item.message.role === "user";
  const isAssistantPanel = item.kind === "chat" && !isUser;

  return (
    <div
      ref={attachRef ? currentItemRef : null}
      className={`stylo-message-item flex ${isUser ? "justify-end" : "justify-start"} ${isAssistantPanel ? "w-full" : ""}`}
      data-current={attachRef}
      data-message-kind={item.kind}
    >
      {item.kind === "status" ? (
        renderStatusLine(item.message, { expanded })
      ) : item.kind === "tool" ? (
        renderToolThread(item.thread)
      ) : item.kind === "approval" ? (
        renderApprovalPanel(item.message, onApprovalChoice)
      ) : isUser ? (
        <div className="flex max-w-[92%] items-end md:max-w-[86%]">
          <div className="stylo-user-message px-1 py-2 text-[15px] leading-7 text-[var(--app-text-primary)] md:text-[13px] md:leading-relaxed">
            {item.message.text}
          </div>
        </div>
      ) : (
        <div className="stylo-assistant-answer flex w-full items-start">
          <div className="min-w-0 flex-1 space-y-3">
            {renderAssistantPanel(item.message)}
          </div>
        </div>
      )}
    </div>
  );
}, (previous, next) =>
  previous.expanded === next.expanded &&
  previous.attachRef === next.attachRef &&
  previous.currentItemRef === next.currentItemRef &&
  previous.onApprovalChoice === next.onApprovalChoice &&
  areDisplayMessagesEqual(previous.item, next.item)
);

export const StyloChatContent: React.FC<Props> = ({
  messages,
  isSending,
  onApprovalChoice,
  className = "",
  style,
  revealMode = "scroll",
  latestBlockMaxHeight,
}) => {
  const messagesRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const currentItemRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const displayMessages = useMemo(() => buildStyloMessageTimeline(messages), [messages]);

  const latestRevealItem = useMemo(() => {
    if (!displayMessages.length) return null;
    return displayMessages[displayMessages.length - 1];
  }, [displayMessages]);

  const getCurrentAnchorScrollTop = useCallback(
    (node: HTMLDivElement, currentNode: HTMLDivElement) => {
      const topInset = revealMode === "latest" ? 2 : 6;
      const headerTarget = Math.max(0, currentNode.offsetTop - topInset);
      const bottomTarget = Math.max(0, currentNode.offsetTop + currentNode.offsetHeight - node.clientHeight);
      return currentNode.offsetHeight + topInset <= node.clientHeight ? headerTarget : bottomTarget;
    },
    [revealMode]
  );

  const followLatestContent = useCallback(() => {
    if (!isSending) return;
    if (revealMode !== "scroll" && revealMode !== "latest") return;
    if (scrollFrameRef.current != null) cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const node = messagesRef.current;
      const currentNode = currentItemRef.current;
      if (!node || !currentNode) return;
      node.scrollTop = getCurrentAnchorScrollTop(node, currentNode);
    });
  }, [getCurrentAnchorScrollTop, isSending, revealMode]);

  useEffect(() => {
    if (!isSending) {
      if (scrollFrameRef.current != null) cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
      return;
    }
    followLatestContent();
  }, [displayMessages.length, followLatestContent, isSending, latestRevealItem?.key, messages]);

  useEffect(() => {
    if (!isSending) return;
    const listNode = messageListRef.current;
    const currentNode = currentItemRef.current;
    if (!listNode || !currentNode) return;
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(followLatestContent);
    resizeObserver?.observe(listNode);
    resizeObserver?.observe(currentNode);
    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(followLatestContent);
    mutationObserver?.observe(currentNode, { childList: true, characterData: true, subtree: true });
    followLatestContent();
    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [followLatestContent, isSending, latestRevealItem?.key]);

  useEffect(() => () => {
    if (scrollFrameRef.current != null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  return (
    <div
      ref={messagesRef}
      role="log"
      aria-live={isSending ? "off" : "polite"}
      aria-relevant="additions text"
      aria-busy={isSending}
      aria-label="Stylo Agent 对话"
      className={`stylo-scrollbar stylo-scroll-fade min-h-0 overflow-y-auto ${revealMode === "latest" ? "px-4 pt-2 pb-5 md:pt-1 md:pb-4" : "px-4 py-5 md:py-4"} ${className}`}
      style={{
        ...style,
        maxHeight: revealMode === "latest" && latestBlockMaxHeight ? `${latestBlockMaxHeight}px` : style?.maxHeight,
      }}
    >
      <div ref={messageListRef} className="space-y-3">
        {displayMessages.length === 0 ? (
          <div className="stylo-agent-empty" role="note">
            <strong>从一个目标开始</strong>
            <span>描述你想创建、整理或修改的内容。</span>
          </div>
        ) : displayMessages.map((item) => {
          const isCurrentReveal = isSending && revealMode === "latest" && latestRevealItem
            ? item.key === latestRevealItem.key
            : false;
          const isLatestListItem = item === displayMessages[displayMessages.length - 1];
          const shouldAttachRef = isSending && (revealMode === "latest" ? isCurrentReveal : isLatestListItem);
          return (
            <MessageItemView
              key={item.key}
              item={item}
              expanded={isCurrentReveal}
              attachRef={shouldAttachRef}
              currentItemRef={currentItemRef}
              onApprovalChoice={onApprovalChoice}
            />
          );
        })}
      </div>
    </div>
  );
};
