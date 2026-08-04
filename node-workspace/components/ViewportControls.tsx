import React from "react";
import { createPortal } from "react-dom";
import { LibraryBig, LockKeyhole, Map, Minus, Plus, Rows3, UnlockKeyhole } from "lucide-react";
import type { NodeFlowReadingMode } from "../nodeflow/sessionState";

type Props = {
  zoom: number;
  minZoom: number;
  maxZoom: number;
  onZoomChange: (value: number) => void;
  isLocked?: boolean;
  onToggleLock?: () => void;
  showMiniMap?: boolean;
  onToggleMiniMap?: () => void;
  readingMode?: NodeFlowReadingMode;
  onToggleReadingMode?: () => void;
  variant?: "floating" | "dock";
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  trayHost?: HTMLElement | null;
};

export const ViewportControls: React.FC<Props> = ({
  zoom,
  minZoom,
  maxZoom,
  onZoomChange,
  isLocked,
  onToggleLock,
  showMiniMap,
  onToggleMiniMap,
  readingMode,
  onToggleReadingMode,
  variant = "floating",
  expanded,
  onExpandedChange,
  trayHost,
}) => {
  const [localDockExpanded, setLocalDockExpanded] = React.useState(false);
  const isDockExpanded = expanded ?? localDockExpanded;
  const setIsDockExpanded = (next: boolean) => {
    setLocalDockExpanded(next);
    onExpandedChange?.(next);
  };
  const step = 0.25;
  const lockDisabled = isLocked === true;

  const clamp = (value: number) => Math.min(maxZoom, Math.max(minZoom, value));
  const handleMinus = () => onZoomChange(clamp(zoom - step));
  const handlePlus = () => onZoomChange(clamp(zoom + step));
  const hasSecondaryControls = Boolean(onToggleLock || onToggleReadingMode || onToggleMiniMap);

  if (variant === "dock") {
    return (
      <div className="script-foundation-viewport-control" data-expanded={isDockExpanded}>
        <button
          type="button"
          onClick={() => setIsDockExpanded(!isDockExpanded)}
          className={`script-foundation-bar-label script-foundation-bar-label--viewport ${isDockExpanded ? "is-active" : ""}`}
          aria-label={isDockExpanded ? "收起视口控件" : "展开视口控件"}
          aria-expanded={isDockExpanded}
          title={isDockExpanded ? "收起视口控件" : "展开视口控件"}
        >
          <span className="script-foundation-bar-label__icon" aria-hidden="true">
            <LibraryBig size={15} strokeWidth={1.85} />
          </span>
        </button>

        {isDockExpanded ? (
          trayHost ? createPortal(
          <div className="script-foundation-viewport-tray-panel">
          <div className="script-foundation-viewport-actions">
            <button
              type="button"
              onClick={handleMinus}
              className="script-foundation-viewport-button"
              aria-label="缩小"
              title="缩小"
              disabled={lockDisabled}
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              onClick={handlePlus}
              className="script-foundation-viewport-button"
              aria-label="放大"
              title="放大"
              disabled={lockDisabled}
            >
              <Plus size={14} />
            </button>
            {hasSecondaryControls ? <span className="script-foundation-viewport-divider" aria-hidden="true" /> : null}
            {onToggleLock ? (
              <button
                type="button"
                onClick={onToggleLock}
                className={`script-foundation-viewport-button ${isLocked ? "is-active" : ""}`}
                aria-label={isLocked ? "解锁画布" : "锁定画布"}
                title={isLocked ? "解锁画布" : "锁定画布"}
              >
                {isLocked ? <LockKeyhole size={14} /> : <UnlockKeyhole size={14} />}
              </button>
            ) : null}
            {onToggleReadingMode ? (
              <button
                type="button"
                onClick={onToggleReadingMode}
                className={`script-foundation-viewport-button ${readingMode === "identity" ? "is-active" : ""}`}
                aria-label={readingMode === "identity" ? "切换到完整节点视图" : "切换到统一读取视图"}
                title={readingMode === "identity" ? "切换到完整节点视图" : "切换到统一读取视图"}
              >
                {readingMode === "identity" ? <Rows3 size={14} /> : <LibraryBig size={14} />}
              </button>
            ) : null}
            {onToggleMiniMap ? (
              <button
                type="button"
                onClick={onToggleMiniMap}
                className={`script-foundation-viewport-button ${showMiniMap ? "is-active" : ""}`}
                aria-label={showMiniMap ? "隐藏地图" : "显示地图"}
                title={showMiniMap ? "隐藏地图" : "显示地图"}
              >
                <Map size={14} />
              </button>
            ) : null}
          </div>
          </div>,
          trayHost
          ) : (
          <div className="script-foundation-viewport-actions">
            <button type="button" onClick={handleMinus} className="script-foundation-viewport-button" aria-label="缩小" title="缩小" disabled={lockDisabled}><Minus size={14} /></button>
            <button type="button" onClick={handlePlus} className="script-foundation-viewport-button" aria-label="放大" title="放大" disabled={lockDisabled}><Plus size={14} /></button>
          </div>
          )
        ) : null}
      </div>
    );
  }

  return (
    <div className="stylo-surface inline-flex w-11 flex-col items-center gap-1 rounded-full p-1">
      <button
        type="button"
        onClick={handleMinus}
        className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--app-text-secondary)] transition hover:bg-[var(--app-panel-soft)] hover:text-[var(--app-text-primary)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="缩小"
        disabled={lockDisabled}
      >
        <Minus size={14} className="text-[var(--app-text-secondary)]" />
      </button>
      <button
        type="button"
        onClick={handlePlus}
        className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--app-text-secondary)] transition hover:bg-[var(--app-panel-soft)] hover:text-[var(--app-text-primary)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="放大"
        disabled={lockDisabled}
      >
        <Plus size={14} className="text-[var(--app-text-secondary)]" />
      </button>
      {(onToggleLock || onToggleReadingMode || onToggleMiniMap) ? (
        <div className="my-0.5 h-px w-5 rounded-full bg-[var(--app-border)]" aria-hidden="true" />
      ) : null}
      {onToggleLock ? (
        <button
          type="button"
          onClick={onToggleLock}
          className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--app-text-secondary)] transition hover:bg-[var(--app-panel-soft)] hover:text-[var(--app-text-primary)] active:translate-y-px"
          aria-label={isLocked ? "解锁画布" : "锁定画布"}
        >
          {isLocked ? (
            <LockKeyhole size={14} className="text-[var(--app-accent-strong)]" />
          ) : (
            <UnlockKeyhole size={14} className="text-[var(--app-accent-strong)]" />
          )}
        </button>
      ) : null}
      {onToggleReadingMode ? (
        <button
          type="button"
          onClick={onToggleReadingMode}
          className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--app-text-secondary)] transition hover:bg-[var(--app-panel-soft)] hover:text-[var(--app-text-primary)] active:translate-y-px"
          aria-label={readingMode === "identity" ? "切换到完整节点视图" : "切换到统一读取视图"}
        >
          {readingMode === "identity" ? (
            <Rows3 size={14} className="text-[var(--app-accent-strong)]" />
          ) : (
            <LibraryBig size={14} className="text-[var(--app-text-secondary)]" />
          )}
        </button>
      ) : null}
      {onToggleMiniMap ? (
        <button
          type="button"
          onClick={onToggleMiniMap}
          className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--app-text-secondary)] transition hover:bg-[var(--app-panel-soft)] hover:text-[var(--app-text-primary)] active:translate-y-px"
          aria-label={showMiniMap ? "隐藏地图" : "显示地图"}
        >
          <Map size={14} className={showMiniMap ? "text-[var(--app-accent-strong)]" : "text-[var(--app-text-secondary)]"} />
        </button>
      ) : null}
    </div>
  );
};
