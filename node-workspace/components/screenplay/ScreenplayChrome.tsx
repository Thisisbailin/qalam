import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowsInSimple,
  ArrowsDownUp,
  ArrowsLeftRight,
  CaretDown,
  Check,
  CheckCircle,
  CircleNotch,
  FileDashed,
  FilePlus,
  FilmStrip,
  FilmSlate,
  Crosshair,
  Info,
  MapPin,
  MagnifyingGlass,
  ShareNetwork,
  Translate,
  User,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { ProjectRoleIdentity } from "../../../types";
import {
  SCREENPLAY_FORMAT_LABELS,
  type ScreenplayAnalysis,
  type ScreenplayLine,
} from "../../screenplay/fountainEngine";

export type SaveState = "idle" | "saving" | "saved" | "conflict" | "error";
export type ScreenplayPageArrangement = "vertical" | "horizontal" | "filmstrip";

type HeaderProps = {
  saveState: SaveState;
  isFocusMode: boolean;
  isInspectorOpen: boolean;
  onToggleFocus: () => void;
  onToggleInspector: () => void;
  onShare: () => void;
  onClose: () => void;
  pageIndex: number;
  pageCount: number;
  isCoverPage?: boolean;
  pageArrangement: ScreenplayPageArrangement;
  autoPagination: boolean;
  isTranslatorOpen?: boolean;
  onToggleTranslator?: () => void;
  onPageArrangementChange: (arrangement: ScreenplayPageArrangement) => void;
  onCreatePage: () => void;
  onToggleAutoPagination: () => void;
};

const SAVE_LABELS: Record<SaveState, string> = {
  idle: "未保存",
  saving: "正在保存",
  saved: "已保存",
  conflict: "检测到外部修改",
  error: "保存失败",
};

export const ScreenplayHeader: React.FC<HeaderProps> = ({
  saveState,
  isFocusMode,
  isInspectorOpen,
  onToggleFocus,
  onToggleInspector,
  onShare,
  onClose,
  pageIndex,
  pageCount,
  isCoverPage = false,
  pageArrangement,
  autoPagination,
  isTranslatorOpen = false,
  onToggleTranslator,
  onPageArrangementChange,
  onCreatePage,
  onToggleAutoPagination,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const collapseTimerRef = useRef<number | null>(null);

  const cancelCollapse = useCallback(() => {
    if (collapseTimerRef.current === null) return;
    window.clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = null;
  }, []);

  const reveal = useCallback(() => {
    cancelCollapse();
    setIsExpanded(true);
  }, [cancelCollapse]);

  const scheduleCollapse = useCallback((delay = 1400) => {
    cancelCollapse();
    collapseTimerRef.current = window.setTimeout(() => {
      collapseTimerRef.current = null;
      setIsExpanded(false);
    }, delay);
  }, [cancelCollapse]);

  useEffect(() => cancelCollapse, [cancelCollapse]);

  return (
    <header
      className={`screenplay-header ${isExpanded ? "is-expanded" : ""}`}
      onPointerEnter={reveal}
      onPointerLeave={() => scheduleCollapse()}
      onFocusCapture={reveal}
      onBlurCapture={() => scheduleCollapse()}
    >
      <span className="screenplay-header__hot-zone" aria-hidden="true" />
      <div className="screenplay-header__actions" aria-hidden={!isExpanded}>
        <div
          className={`screenplay-save-state is-${saveState}`}
          role="status"
          aria-live="polite"
          aria-label={SAVE_LABELS[saveState]}
          title={SAVE_LABELS[saveState]}
        >
          {saveState === "saved" ? <CheckCircle size={14} weight="fill" /> : null}
          {saveState === "saving" || saveState === "idle" ? <CircleNotch size={14} /> : null}
          {saveState === "conflict" || saveState === "error" ? <WarningCircle size={14} weight="fill" /> : null}
        </div>
        <span className="screenplay-header__divider" />
        <div className="screenplay-header__page-controls" aria-label="稿纸排列">
          <small>{isCoverPage ? "C" : pageIndex + 1}/{Math.max(1, pageCount)}</small>
          <button type="button" className={pageArrangement === "vertical" ? "is-active" : ""} onClick={() => onPageArrangementChange("vertical")} title="纵向稿纸队列" aria-label="纵向稿纸队列">
            <ArrowsDownUp size={16} />
          </button>
          <button type="button" className={pageArrangement === "horizontal" ? "is-active" : ""} onClick={() => onPageArrangementChange("horizontal")} title="横向稿纸队列" aria-label="横向稿纸队列">
            <ArrowsLeftRight size={16} />
          </button>
          <button type="button" className={pageArrangement === "filmstrip" ? "is-active" : ""} onClick={() => onPageArrangementChange("filmstrip")} title="底部缩略队列" aria-label="底部缩略队列">
            <FilmStrip size={16} />
          </button>
        </div>
        <button type="button" onClick={onCreatePage} title="新增稿纸" aria-label="新增稿纸">
          <FilePlus size={18} />
        </button>
        <button type="button" className={autoPagination ? "is-active" : ""} onClick={onToggleAutoPagination} title={autoPagination ? "关闭自动分页" : "开启自动分页"} aria-label="切换自动分页">
          <FileDashed size={18} weight={autoPagination ? "fill" : "regular"} />
        </button>
        <span className="screenplay-header__divider" />
        <button type="button" className={isFocusMode ? "is-active" : ""} onClick={onToggleFocus} title="专注模式" aria-label="切换专注模式">
          <Crosshair size={18} />
        </button>
        <button type="button" className={isInspectorOpen ? "is-active" : ""} onClick={onToggleInspector} title="Manus 信息" aria-label="打开 Manus 信息">
          <Info size={18} />
        </button>
        <button
          type="button"
          className={isTranslatorOpen ? "is-active" : ""}
          onClick={onToggleTranslator}
          title="翻译器"
          aria-label="打开翻译器"
        >
          <Translate size={18} />
        </button>
        <button type="button" onClick={onShare} title="分享 Fountain" aria-label="分享 Fountain">
          <ShareNetwork size={18} />
        </button>
        <span className="screenplay-header__divider" />
        <button type="button" onClick={onClose} title="退出全屏编辑" aria-label="退出全屏编辑">
          <ArrowsInSimple size={18} />
        </button>
      </div>
    </header>
  );
};

export type ScreenplayIdentityEntry = {
  role: ProjectRoleIdentity;
  identityNodeId: string | null;
};

type IdentityDockProps = {
  entries: ScreenplayIdentityEntry[];
  recentIdentityId: string | null;
  onOpenIdentity: (identityNodeId: string) => void;
};

const getIdentityImage = (role: ProjectRoleIdentity) =>
  role.portraits?.find((portrait) => portrait.isPrimary)?.imageUrl ||
  role.portraits?.[0]?.imageUrl ||
  role.avatarUrl ||
  "";

const getIdentityInitials = (role: ProjectRoleIdentity) =>
  Array.from((role.displayName || role.name || "?").trim()).slice(0, 2).join("").toUpperCase();

const sortIdentityEntries = (entries: ScreenplayIdentityEntry[]) => entries.slice().sort((left, right) => {
  const leftPriority = left.role.isMain || left.role.isCore ? 0 : 1;
  const rightPriority = right.role.isMain || right.role.isCore ? 0 : 1;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  return (left.role.displayName || left.role.name).localeCompare(
    right.role.displayName || right.role.name,
    "zh-Hans-CN"
  );
});

const IdentityAvatar: React.FC<{ role: ProjectRoleIdentity; size?: "tile" | "arrival" }> = ({ role, size = "tile" }) => {
  const imageUrl = getIdentityImage(role);
  return (
    <span className={`screenplay-identity-avatar is-${role.kind} is-${size}`}>
      {imageUrl ? <img src={imageUrl} alt="" draggable={false} /> : <span>{getIdentityInitials(role)}</span>}
    </span>
  );
};

export const ScreenplayIdentityDock: React.FC<IdentityDockProps> = ({
  entries,
  recentIdentityId,
  onOpenIdentity,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const characters = useMemo(
    () => sortIdentityEntries(entries.filter((entry) => entry.role.kind === "person")),
    [entries]
  );
  const scenes = useMemo(
    () => sortIdentityEntries(entries.filter((entry) => entry.role.kind === "scene")),
    [entries]
  );
  const recentEntry = useMemo(
    () => entries.find((entry) => entry.role.id === recentIdentityId) || null,
    [entries, recentIdentityId]
  );
  const railEntries = useMemo(() => [...characters, ...scenes].slice(0, 5), [characters, scenes]);

  useEffect(() => {
    if (!recentIdentityId) return;
    setIsOpen(false);
  }, [recentIdentityId]);

  const renderSection = (
    label: string,
    sectionEntries: ScreenplayIdentityEntry[],
    Icon: typeof User
  ) => (
    <section className="screenplay-identity-dock__section">
      <header>
        <Icon size={13} />
        <span>{label}</span>
        <small>{sectionEntries.length}</small>
      </header>
      {sectionEntries.length ? (
        <div className="screenplay-identity-grid">
          {sectionEntries.map((entry) => {
            const name = entry.role.displayName || entry.role.name;
            return (
              <button
                key={entry.role.id}
                type="button"
                className={entry.role.id === recentIdentityId ? "is-recent" : ""}
                onClick={() => entry.identityNodeId && onOpenIdentity(entry.identityNodeId)}
                disabled={!entry.identityNodeId}
                title={entry.identityNodeId ? `打开 ${name} 的 LookBook` : `${name} 的 LookBook 尚未就绪`}
                aria-label={entry.identityNodeId ? `打开 ${name} 的 LookBook` : `${name} 的 LookBook 尚未就绪`}
              >
                <IdentityAvatar role={entry.role} />
                <span>{name}</span>
              </button>
            );
          })}
        </div>
      ) : <div className="screenplay-identity-dock__empty">尚未收录</div>}
    </section>
  );

  return (
    <aside className={`screenplay-identity-dock ${isOpen ? "is-open" : ""}`} aria-label="角色与场景 LookBook">
      <AnimatePresence mode="wait">
        {recentEntry ? (
          <motion.div
            key={recentEntry.role.id}
            className="screenplay-identity-arrival"
            initial={{ opacity: 0, y: 16, scale: 0.82 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, y: 36, scale: 0.74 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
          >
            <IdentityAvatar role={recentEntry.role} size="arrival" />
            <span>
              <small>{recentEntry.role.kind === "person" ? "新角色" : "新场景"}</small>
              <strong>{recentEntry.role.displayName || recentEntry.role.name}</strong>
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="screenplay-identity-dock__surface">
        {isOpen ? (
            <div className="screenplay-identity-dock__panel">
              <div className="screenplay-identity-dock__heading">
                <span>LOOKBOOK</span>
                <button type="button" onClick={() => setIsOpen(false)} aria-label="收起资料格" title="收起资料格">
                  <X size={13} />
                </button>
              </div>
              <div className="screenplay-identity-dock__content">
                {renderSection("角色", characters, User)}
                {renderSection("场景", scenes, MapPin)}
              </div>
            </div>
          ) : (
            <div className="screenplay-identity-dock__rail">
              {railEntries.map((entry) => {
                const name = entry.role.displayName || entry.role.name;
                return (
                  <button
                    key={entry.role.id}
                    type="button"
                    className={entry.role.id === recentIdentityId ? "is-recent" : ""}
                    onClick={() => entry.identityNodeId ? onOpenIdentity(entry.identityNodeId) : setIsOpen(true)}
                    title={entry.identityNodeId ? `打开 ${name} 的 LookBook` : `查看 ${name}`}
                    aria-label={entry.identityNodeId ? `打开 ${name} 的 LookBook` : `查看 ${name}`}
                  >
                    <IdentityAvatar role={entry.role} />
                  </button>
                );
              })}
              <button
                type="button"
                className="screenplay-identity-dock__toggle"
                onClick={() => setIsOpen(true)}
                aria-expanded={false}
                aria-label="展开角色与场景资料格"
                title="展开角色与场景"
              >
                <CaretDown size={15} weight="bold" />
              </button>
            </div>
          )}
      </div>
    </aside>
  );
};

type NavigatorProps = {
  analysis: ScreenplayAnalysis;
  activeLineIndex: number;
  onNavigate: (lineIndex: number) => void;
  onClose?: () => void;
  embedded?: boolean;
};

export const ScreenplayNavigator: React.FC<NavigatorProps> = ({ analysis, activeLineIndex, onNavigate, onClose, embedded = false }) => {
  const [query, setQuery] = useState("");
  const filteredScenes = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return analysis.scenes;
    return analysis.scenes.filter((scene) =>
      [scene.location, scene.boundary, scene.time, scene.synopsis, ...scene.characterNames]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [analysis.scenes, query]);
  const activeScene = [...analysis.scenes].reverse().find((scene) => scene.lineIndex <= activeLineIndex);

  return (
    <aside className={`screenplay-navigator ${embedded ? "is-embedded" : ""}`} aria-label="场景导航">
      <div className="screenplay-panel-heading">
        <div>
          <span>OUTLINE</span>
          <strong>场景导航</strong>
        </div>
        <div className="screenplay-panel-heading__actions">
          <small>{analysis.scenes.length}</small>
          {onClose ? <button type="button" onClick={onClose} aria-label="关闭场景导航"><X size={13} /></button> : null}
        </div>
      </div>
      <label className="screenplay-search">
        <MagnifyingGlass size={14} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索地点、角色或梗概" />
        {query ? <button type="button" onClick={() => setQuery("")} aria-label="清空搜索"><X size={12} /></button> : null}
      </label>
      <div className="screenplay-scene-list">
        {filteredScenes.map((scene) => (
          <button
            key={scene.id}
            type="button"
            className={activeScene?.id === scene.id ? "is-active" : ""}
            onClick={() => onNavigate(scene.lineIndex)}
          >
            <span className="screenplay-scene-list__number">{String(scene.ordinal).padStart(2, "0")}</span>
            <span className="screenplay-scene-list__copy">
              <strong>{scene.location}</strong>
              <small>{scene.boundary} · {scene.time}</small>
              <em>{scene.synopsis}</em>
            </span>
          </button>
        ))}
        {!filteredScenes.length ? (
          <div className="screenplay-panel-empty">
            <FilmSlate size={22} />
            <strong>{query ? "没有匹配场景" : "还没有场景"}</strong>
            <span>{query ? "换一个关键词试试。" : "把任意一行切换为“场景”，它会出现在这里。"}</span>
          </div>
        ) : null}
      </div>
    </aside>
  );
};

type InspectorProps = {
  analysis: ScreenplayAnalysis;
  activeLine: ScreenplayLine;
  onNavigate: (lineIndex: number) => void;
};

export const ScreenplayInspector: React.FC<InspectorProps> = ({
  analysis,
  activeLine,
  onNavigate,
}) => {
  const activeScene = [...analysis.scenes].reverse().find((scene) => scene.lineIndex <= activeLine.index);
  return (
    <aside className="screenplay-inspector" aria-label="Manus 信息">
      <div className="screenplay-panel-heading">
        <div>
          <span>INFO</span>
          <strong>Manus 信息</strong>
        </div>
        <small>L{activeLine.index + 1}</small>
      </div>

      <section className="screenplay-inspector__section">
        <span className="screenplay-inspector__label">当前段落</span>
        <div className="screenplay-current-format">
          <strong>{SCREENPLAY_FORMAT_LABELS[activeLine.kind]}</strong>
          <span>{activeScene ? `场景 ${activeScene.ordinal} · ${activeScene.location}` : "场景前置内容"}</span>
        </div>
      </section>

      <section className="screenplay-inspector__section">
        <span className="screenplay-inspector__label">篇幅</span>
        <div className="screenplay-metrics">
          <div><strong>{analysis.stats.estimatedPages}</strong><span>估算页</span></div>
          <div><strong>{analysis.stats.estimatedMinutes}</strong><span>估算分钟</span></div>
          <div><strong>{analysis.stats.glyphs}</strong><span>有效字数</span></div>
          <div><strong>{analysis.stats.dialoguePercent}%</strong><span>对白占比</span></div>
        </div>
      </section>

      <section className="screenplay-inspector__section">
        <span className="screenplay-inspector__label">连续性检查</span>
        <div className="screenplay-diagnostics">
          {analysis.diagnostics.slice(0, 12).map((diagnostic) => (
            <button key={diagnostic.id} type="button" onClick={() => onNavigate(diagnostic.lineIndex)}>
              <WarningCircle size={15} />
              <span>{diagnostic.message}</span>
              <small>L{diagnostic.lineIndex + 1}</small>
            </button>
          ))}
          {!analysis.diagnostics.length ? (
            <div className="screenplay-diagnostics__clear">
              <Check size={16} />
              <span>未发现结构问题</span>
            </div>
          ) : null}
        </div>
      </section>

      <ScreenplayNavigator
        analysis={analysis}
        activeLineIndex={activeLine.index}
        onNavigate={onNavigate}
        embedded
      />
    </aside>
  );
};
