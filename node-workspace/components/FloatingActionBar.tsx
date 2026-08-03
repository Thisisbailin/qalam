import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, FilePdf, GearSix, LinkSimple, SquaresFour, UsersThree } from "@phosphor-icons/react";
import {
  Plus,
  User,
  MessageSquare,
  Image as ImageIcon,
  Sparkles,
  Video,
  SquareStack,
  Library,
  ChevronRight,
  FileText,
  Trash2,
  LogOut,
  Upload,
  Share,
} from "lucide-react";

type AccountInfo = {
  isLoaded: boolean;
  isSignedIn: boolean;
  name?: string;
  email?: string;
  avatarUrl?: string;
  onSignIn?: () => void;
  onSignOut?: () => void;
  onUploadAvatar?: () => void;
  onOpenAccountWorkspace?: () => void;
  onOpenUserSquare?: () => void;
  onConnectCodex?: () => void;
};

type Props = {
  onAddText: () => void;
  onAddIdentityCard: () => void;
  onAddImage: () => void;
  onAddAudio: () => void;
  onAddVideo: () => void;
  onAddPdf: () => void;
  onAddNanoBananaImageGen: () => void;
  onAddWanImageGen: () => void;
  onAddViduVideoGen: () => void;
  onAddWanReferenceVideoGen: () => void;
  onAddSeedanceVideoGen: () => void;
  onImport: () => void;
  onExport: () => void;
  onRun: () => void;
  floating?: boolean;
  syncIndicator?: { label: string; color: string } | null;
  onResetProject?: () => void;
  onSignOut?: () => void;
  accountInfo?: AccountInfo;
  onOpenStylo?: () => void;
  onOpenSettings?: () => void;
  variant?: "dock" | "embedded";
  onAssetLoad?: (type: "script", content: string, fileName?: string) => void;
  showGlobalAccountTrigger?: boolean;
  globalAccountHostId?: string;
  showToolbar?: boolean;
  accountThemeControls?: React.ReactNode;
};

export const FloatingActionBar: React.FC<Props> = ({
  onAddText,
  onAddIdentityCard,
  onAddImage,
  onAddAudio,
  onAddVideo,
  onAddPdf,
  onAddNanoBananaImageGen,
  onAddWanImageGen,
  onAddViduVideoGen,
  onAddWanReferenceVideoGen,
  onAddSeedanceVideoGen,
  onImport,
  onExport,
  onRun,
  floating = true,
  syncIndicator,
  onResetProject,
  onSignOut,
  accountInfo,
  onOpenStylo,
  onOpenSettings,
  variant = "dock",
  onAssetLoad,
  showGlobalAccountTrigger = false,
  globalAccountHostId,
  showToolbar = true,
  accountThemeControls,
}) => {
  const isEmbedded = variant === "embedded";
  const [showPalette, setShowPalette] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [ioPane, setIoPane] = useState<"project" | "export">("project");
  const [nodePaletteMode, setNodePaletteMode] = useState<"panels" | "workflow">("workflow");
  const scriptInputRef = useRef<HTMLInputElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const nodesButtonRef = useRef<HTMLButtonElement>(null);
  const fileMenuPanelRef = useRef<HTMLDivElement>(null);
  const palettePanelRef = useRef<HTMLDivElement>(null);
  const [accountAnchorRect, setAccountAnchorRect] = useState<DOMRect | null>(null);
  const [globalAccountHost, setGlobalAccountHost] = useState<HTMLElement | null>(null);
  const [nodesAnchorRect, setNodesAnchorRect] = useState<DOMRect | null>(null);
  const legacyScriptImportDisabled = true;
  const rootClass = !showToolbar
    ? "contents"
    : isEmbedded
    ? "relative z-30 w-full"
    : floating
      ? "fixed bottom-4 right-4 z-30"
      : "relative z-30";
  const panelClass = "rounded-[24px] app-panel overflow-hidden";
  const panelStyle: React.CSSProperties = {
    backgroundColor: "var(--app-panel)",
    borderColor: "var(--app-border)",
    boxShadow: "var(--app-shadow)",
  };
  const sectionEyebrowClass =
    "text-[10px] font-black uppercase tracking-[0.24em] text-[var(--app-text-secondary)]";
  const sectionCardClass =
    "rounded-[26px] border border-[var(--app-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-4";
  const utilityButtonClass =
    "group flex min-h-[60px] items-center gap-3 rounded-[18px] border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-3 text-left transition hover:border-[var(--app-border-strong)] hover:bg-[var(--app-panel-soft)] active:translate-y-px";
  const docButtonClass =
    "group w-full rounded-[18px] border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-3 text-left transition hover:border-[var(--app-border-strong)] hover:bg-[var(--app-panel-soft)] disabled:cursor-not-allowed disabled:text-[var(--app-text-muted)] disabled:hover:border-[var(--app-border)] disabled:hover:bg-[var(--app-panel-muted)]";
  const compactTabClass =
    "inline-flex h-7 items-center justify-center rounded-full border px-2.5 text-[10px] font-semibold transition active:translate-y-px";
  const embeddedLabelClass =
    "group inline-flex h-8 items-center gap-2 rounded-full border border-[var(--app-border)] bg-[linear-gradient(180deg,var(--app-panel-strong),var(--app-panel))] px-3 text-[11px] font-medium tracking-[-0.01em] text-[var(--app-text-secondary)] shadow-[0_10px_24px_-18px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-xl transition hover:border-[var(--app-border-strong)] hover:bg-[linear-gradient(180deg,var(--app-panel-strong),var(--app-panel-soft))] hover:text-[var(--app-text-primary)] active:translate-y-px";
  const toolbarChipClass =
    "group inline-flex h-9 items-center gap-2 rounded-full border border-[var(--app-border)] bg-[linear-gradient(180deg,var(--app-panel-strong),var(--app-panel))] px-3.5 text-[11px] font-semibold tracking-[0.01em] text-[var(--app-text-secondary)] shadow-[0_10px_24px_-18px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-xl transition duration-200 hover:border-[var(--app-border-strong)] hover:bg-[linear-gradient(180deg,var(--app-panel-strong),var(--app-panel-soft))] hover:text-[var(--app-text-primary)] active:translate-y-px";
  const globalAccountButtonClass =
    "group inline-flex h-11 items-center gap-1.5 rounded-full border border-[var(--app-border)] bg-[linear-gradient(180deg,var(--app-panel-strong),var(--app-panel))] px-2.5 text-[11px] font-semibold text-[var(--app-text-secondary)] shadow-[0_14px_34px_-20px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition duration-200 hover:border-[var(--app-border-strong)] hover:bg-[linear-gradient(180deg,var(--app-panel-strong),var(--app-panel-soft))] hover:text-[var(--app-text-primary)] active:translate-y-px";
  const getPopoverStyle = (anchorRect: DOMRect | null, desiredWidth: number): React.CSSProperties | undefined => {
    if (typeof window === "undefined") return undefined;
    if (!anchorRect) {
      return {
        right: 24,
        bottom: 80,
        width: `min(${desiredWidth}px,calc(100vw-24px))`,
      };
    }
    const viewportPadding = 12;
    const width = Math.min(desiredWidth, window.innerWidth - viewportPadding * 2);
    const left = Math.max(
      viewportPadding,
      Math.min(anchorRect.left + anchorRect.width / 2 - width / 2, window.innerWidth - viewportPadding - width)
    );
    const gap = 12;
    if (anchorRect.top < window.innerHeight / 2) {
      return {
        position: "fixed",
        left,
        top: Math.min(anchorRect.bottom + gap, window.innerHeight - viewportPadding),
        width,
        maxWidth: `calc(100vw - ${viewportPadding * 2}px)`,
      };
    }
    const bottom = Math.max(16, window.innerHeight - anchorRect.top + gap);
    return {
      position: "fixed",
      left,
      bottom,
      width,
      maxWidth: `calc(100vw - ${viewportPadding * 2}px)`,
    };
  };
  const palettePopoverStyle = useMemo(() => getPopoverStyle(nodesAnchorRect, 580), [nodesAnchorRect]);
  const fileMenuPopoverStyle = useMemo((): React.CSSProperties | undefined => {
    if (typeof window === "undefined") return undefined;
    const viewportPadding = 12;
    const fixedWidth = 360;
    const width = Math.min(fixedWidth, window.innerWidth - viewportPadding * 2);
    if (!accountAnchorRect) {
      return {
        position: "fixed",
        left: viewportPadding,
        bottom: 72,
        width,
        maxWidth: `calc(100vw - ${viewportPadding * 2}px)`,
      };
    }
    const left = Math.max(
      viewportPadding,
      Math.min(
        accountAnchorRect.left + accountAnchorRect.width / 2 - width / 2,
        window.innerWidth - viewportPadding - width
      )
    );
    return {
      position: "fixed",
      left,
      bottom: Math.max(viewportPadding + accountAnchorRect.height + 10, window.innerHeight - accountAnchorRect.top + 10),
      width,
      maxWidth: `calc(100vw - ${viewportPadding * 2}px)`,
    };
  }, [accountAnchorRect]);

  useEffect(() => {
    if (!showGlobalAccountTrigger || !globalAccountHostId || typeof document === "undefined") {
      setGlobalAccountHost(null);
      return;
    }

    const nextHost = document.getElementById(globalAccountHostId);
    setGlobalAccountHost((current) => (current === nextHost ? current : nextHost));
  });

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (!showFileMenu && !showPalette) return undefined;

    const updateAnchors = () => {
      if (showFileMenu && accountButtonRef.current) {
        setAccountAnchorRect(accountButtonRef.current.getBoundingClientRect());
      }
      if (showPalette && nodesButtonRef.current) {
        setNodesAnchorRect(nodesButtonRef.current.getBoundingClientRect());
      }
    };

    updateAnchors();
    window.addEventListener("resize", updateAnchors);
    window.addEventListener("scroll", updateAnchors, true);

    return () => {
      window.removeEventListener("resize", updateAnchors);
      window.removeEventListener("scroll", updateAnchors, true);
    };
  }, [showFileMenu, showPalette]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    if (!showFileMenu && !showPalette) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      const insideOpenPanel =
        (showFileMenu && fileMenuPanelRef.current?.contains(target)) ||
        (showPalette && palettePanelRef.current?.contains(target));

      if (insideOpenPanel) return;

      const insideTrigger =
        accountButtonRef.current?.contains(target) ||
        nodesButtonRef.current?.contains(target);

      if (insideTrigger) return;
      closeMenus();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [showFileMenu, showPalette]);

  const panelActions = [
    { label: "Lookbook", hint: "由剧本中的角色或场景自动创建", meta: "自动", onClick: onAddIdentityCard, Icon: BookOpen, tone: "text-emerald-300", surface: "bg-emerald-500/12", disabled: true, disabledHint: "解析身份后自动生成" },
  ];
  const nodeActions = [
    { label: "文本", hint: "提示词、备忘与结构片段", meta: "文本", onClick: onAddText, Icon: MessageSquare, tone: "text-slate-200", surface: "bg-white/5" },
    { label: "图片", hint: "上传参考图或剧照", meta: "输入", onClick: onAddImage, Icon: ImageIcon, tone: "text-emerald-300", surface: "bg-emerald-500/12" },
    { label: "音频", hint: "上传声音参考", meta: "输入", onClick: onAddAudio, Icon: Upload, tone: "text-cyan-300", surface: "bg-cyan-500/12" },
    { label: "视频", hint: "上传视频参考", meta: "输入", onClick: onAddVideo, Icon: Video, tone: "text-rose-300", surface: "bg-rose-500/12" },
    { label: "PDF", hint: "阅读、高亮与关联 Markdown 笔记", meta: "输入", onClick: onAddPdf, Icon: FilePdf, tone: "text-amber-300", surface: "bg-amber-500/12" },
    { label: "Nano Banana", hint: "图像生成", meta: "图像", onClick: onAddNanoBananaImageGen, Icon: Sparkles, tone: "text-amber-300", surface: "bg-amber-500/12" },
    { label: "WAN 图像", hint: "Wan 2.6 图像工作流", meta: "图像", onClick: onAddWanImageGen, Icon: Sparkles, tone: "text-teal-300", surface: "bg-teal-500/12" },
    { label: "Vidu", hint: "参考生成视频", meta: "视频", onClick: onAddViduVideoGen, Icon: Video, tone: "text-cyan-300", surface: "bg-cyan-500/12" },
    { label: "WAN 视频", hint: "Wan 参考生视频", meta: "视频", onClick: onAddWanReferenceVideoGen, Icon: Video, tone: "text-fuchsia-300", surface: "bg-fuchsia-500/12" },
    { label: "Seedance", hint: "多模态参考视频", meta: "视频", onClick: onAddSeedanceVideoGen, Icon: Video, tone: "text-sky-300", surface: "bg-sky-500/12" },
  ];
  const accountLoaded = accountInfo?.isLoaded ?? true;
  const accountSignedIn = accountLoaded && !!accountInfo?.isSignedIn;
  const providedAccountName = accountInfo?.name?.trim() || "";
  const providedAccountEmail = accountInfo?.email?.trim() || "";
  const accountName = providedAccountName || providedAccountEmail || "Stylo User";
  const accountEmail = providedAccountEmail && providedAccountEmail !== accountName ? providedAccountEmail : "";
  const handleSignOut = accountInfo?.onSignOut || onSignOut;
  const handleUploadAvatar = accountInfo?.onUploadAvatar;
  const closeMenus = () => {
    setShowPalette(false);
    setShowFileMenu(false);
  };

  const handleAssetFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    type: "script"
  ) => {
    if (legacyScriptImportDisabled) {
      event.target.value = "";
      return;
    }
    const file = event.target.files?.[0];
    if (!file || !onAssetLoad) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      if (content) onAssetLoad(type, content, file.name);
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const ioActions: { label: string; desc: string; Icon: any; onClick?: () => void; color: string }[] = [];

  const renderIoPanel = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-start">
        <div className="flex items-center gap-1 rounded-full border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-1">
          <button
            type="button"
            onClick={() => setIoPane("project")}
            className={`${compactTabClass} ${ioPane === "project" ? "border-[var(--app-border-strong)] bg-[var(--app-panel-soft)] text-[var(--app-text-primary)]" : "border-transparent text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]"}`}
          >
            Files
          </button>
          <button
            type="button"
            onClick={() => setIoPane("export")}
            className={`${compactTabClass} ${ioPane === "export" ? "border-[var(--app-border-strong)] bg-[var(--app-panel-soft)] text-[var(--app-text-primary)]" : "border-transparent text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]"}`}
          >
            Export
          </button>
        </div>
      </div>

      {ioActions.length > 0 && (
        <div className="rounded-[22px] app-card overflow-hidden divide-y divide-white/8">
          {ioActions.map((item) => {
            const disabled = !item.onClick;
            return (
              <button
                key={item.label}
                onClick={() => {
                  if (item.onClick) item.onClick();
                  closeMenus();
                }}
                disabled={disabled}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition ${disabled
                    ? "bg-transparent text-[var(--app-text-muted)] cursor-not-allowed"
                    : "hover:bg-[var(--app-panel-muted)] text-[var(--app-text-primary)]"
                  }`}
              >
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-[16px] border border-[var(--app-border)]"
                  style={{ background: disabled ? "rgba(255,255,255,0.06)" : item.color }}
                >
                  <item.Icon size={16} className={disabled ? "text-[var(--app-text-secondary)]" : "text-black"} />
                </span>
                <div className="flex-1">
                  <div className="text-sm font-semibold">{item.label}</div>
                  <div className="text-[11px] text-[var(--app-text-secondary)]">{item.desc}</div>
                </div>
                <ChevronRight size={14} className="text-[var(--app-text-muted)]" />
              </button>
            );
          })}
        </div>
      )}

      {ioPane === "project" && (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              onImport();
              closeMenus();
            }}
            className={docButtonClass}
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-[var(--app-border)] bg-sky-500/10 text-sky-300">
                <SquareStack size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold text-[var(--app-text-primary)]">Project</span>
                <span className="mt-0.5 block text-[10px] text-[var(--app-text-secondary)]">项目包</span>
              </span>
            </div>
          </button>
          <input
            ref={scriptInputRef}
            type="file"
            accept=".txt"
            className="hidden"
            onChange={(e) => handleAssetFileChange(e, "script")}
          />
          <button
            type="button"
            onClick={() => {
              if (!legacyScriptImportDisabled) scriptInputRef.current?.click();
            }}
            disabled={legacyScriptImportDisabled || !onAssetLoad}
            className={docButtonClass}
            title="Script import is disabled"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-[var(--app-border)] bg-[var(--app-panel-muted)] text-[var(--app-text-muted)]">
                <FileText size={16} />
              </span>
              <span>
                <span className="block text-[12px] font-semibold text-[var(--app-text-muted)]">Script</span>
                <span className="mt-0.5 block text-[10px] text-[var(--app-text-muted)]">Import disabled</span>
              </span>
            </div>
          </button>
        </div>
      )}

      {ioPane === "export" && (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              onExport();
              closeMenus();
            }}
            className={docButtonClass}
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-[var(--app-border)] bg-emerald-500/10 text-emerald-300">
                <Share size={16} />
              </span>
              <span>
                <span className="block text-[12px] font-semibold text-[var(--app-text-primary)]">Project</span>
                <span className="mt-0.5 block text-[10px] text-[var(--app-text-secondary)]">项目包</span>
              </span>
            </div>
          </button>
        </div>
      )}
    </div>
  );

  const globalAccountTrigger = showGlobalAccountTrigger ? (
    <div
      className={
        globalAccountHostId
          ? "script-foundation-account-control"
          : "pointer-events-none fixed right-4 bottom-4 z-[60]"
      }
    >
      <button
        ref={accountButtonRef}
        data-account-trigger
        type="button"
        onClick={(event) => {
          setAccountAnchorRect(event.currentTarget.getBoundingClientRect());
          setShowFileMenu((v) => !v);
          setShowPalette(false);
        }}
        className={`${globalAccountButtonClass} pointer-events-auto ${showFileMenu ? "border-[var(--app-border-strong)] bg-[var(--app-panel-soft)] text-[var(--app-text-primary)]" : ""}`}
        title="Account"
        aria-label="Account"
      >
        {accountInfo?.avatarUrl ? (
          <img
            src={accountInfo.avatarUrl}
            alt={accountName}
            className="h-7 w-7 rounded-full border border-[var(--app-border)] object-cover"
          />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-panel-muted)] text-[var(--app-text-secondary)]">
            <User size={14} />
          </span>
        )}
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: syncIndicator?.color || "rgba(142, 142, 147, 0.82)" }}
        />
      </button>
    </div>
  ) : null;


  return (
    <div className={rootClass}>
      {typeof document !== "undefined" && (showPalette || showFileMenu)
        ? createPortal(<div className="fixed inset-0 z-[58]" onClick={closeMenus} />, document.body)
        : null}

      <div className="relative z-20 flex justify-center">
        {globalAccountHostId
          ? globalAccountHost && globalAccountTrigger
            ? createPortal(globalAccountTrigger, globalAccountHost)
            : null
          : globalAccountTrigger}

        {/* Plus Palette */}
        {typeof document !== "undefined" && showPalette ? (
          createPortal(
            <div
            ref={palettePanelRef}
            className={`fixed z-[59] animate-in fade-in duration-200 ${panelClass}`}
            style={{ ...panelStyle, ...palettePopoverStyle }}
          >
              <div className="max-h-[min(58vh,520px)] space-y-3 overflow-y-auto p-3">
              <div className="flex items-start justify-between gap-3 px-1">
                <div>
                  <div className="text-[11px] font-bold tracking-[-0.02em] text-[var(--app-text-primary)]">添加节点</div>
                  <div className="mt-1 max-w-[34ch] text-[11px] leading-5 text-[var(--app-text-secondary)]">
                    {nodePaletteMode === "panels"
                      ? "添加角色、场景与项目档案节点。"
                      : "添加输入、生成与参考节点。"}
                  </div>
                </div>
                <div className="inline-flex items-center gap-1 rounded-full border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-1">
                  <button
                    type="button"
                    onClick={() => setNodePaletteMode("panels")}
                    className={`${compactTabClass} ${
                      nodePaletteMode === "panels"
                        ? "border-[var(--app-border-strong)] bg-[var(--app-panel-soft)] text-[var(--app-text-primary)]"
                        : "border-transparent text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]"
                    }`}
                  >
                    档案
                  </button>
                  <button
                    type="button"
                    onClick={() => setNodePaletteMode("workflow")}
                    className={`${compactTabClass} ${
                      nodePaletteMode === "workflow"
                        ? "border-[var(--app-border-strong)] bg-[var(--app-panel-soft)] text-[var(--app-text-primary)]"
                        : "border-transparent text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]"
                    }`}
                  >
                    Flow
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <div className={sectionEyebrowClass}>{nodePaletteMode === "panels" ? "Archive" : "Nodes"}</div>
                  <div className="text-[10px] text-[var(--app-text-muted)]">
                    {nodePaletteMode === "panels" ? `${panelActions.length} 类` : `${nodeActions.length} 类`}
                  </div>
                </div>
                {nodePaletteMode === "panels" ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between px-1">
                        <div className={sectionEyebrowClass}>Archive</div>
                        <div className="text-[10px] text-[var(--app-text-muted)]">{panelActions.length} 类</div>
                      </div>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        {panelActions.map(({ label, hint, meta, onClick, Icon, tone, surface, disabled, disabledHint }) => (
                          <button
                            key={label}
                            type="button"
                            disabled={disabled}
                            title={disabled ? disabledHint : undefined}
                            onClick={() => {
                              if (disabled) return;
                              onClick();
                              closeMenus();
                            }}
                            className="group/node relative overflow-hidden rounded-[16px] border border-[var(--app-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent)] px-3 py-3 text-left transition-all duration-200 enabled:hover:-translate-y-0.5 enabled:hover:border-[var(--app-border-strong)] enabled:hover:bg-[var(--app-panel-soft)] enabled:active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            <div className={`flex h-9 w-9 items-center justify-center rounded-[13px] border border-[var(--app-border)] ${surface} ${tone}`}>
                              <Icon size={16} />
                            </div>
                            <div className="mt-2.5">
                              <div className="text-[13px] font-semibold tracking-[-0.02em] text-[var(--app-text-primary)]">{label}</div>
                              <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-[var(--app-text-secondary)]">{disabled ? disabledHint : hint}</div>
                            </div>
                            <div className="mt-2.5">
                              <span className="inline-flex rounded-full border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                                {meta}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    {nodeActions.map(({ label, hint, meta, onClick, Icon, tone, surface }) => (
                      <button
                        key={label}
                        onClick={() => {
                          onClick();
                          closeMenus();
                        }}
                        className="group/node relative overflow-hidden rounded-[16px] border border-[var(--app-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent)] px-3 py-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--app-border-strong)] hover:bg-[var(--app-panel-soft)] active:translate-y-0"
                      >
                        <div className={`flex h-8 w-8 items-center justify-center rounded-[12px] border border-[var(--app-border)] ${surface} ${tone}`}>
                          <Icon size={15} />
                        </div>
                        <div className="mt-2 min-w-0">
                          <div className="truncate text-[12px] font-semibold tracking-[-0.02em] text-[var(--app-text-primary)]">{label}</div>
                          <div className="mt-0.5 line-clamp-1 text-[10px] leading-4 text-[var(--app-text-secondary)]">{hint}</div>
                        </div>
                        <div className="mt-2.5 flex items-center justify-between">
                          <span className="inline-flex rounded-full border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
                            {meta}
                          </span>
                          <ChevronRight size={13} className="text-[var(--app-text-muted)] transition-transform group-hover/node:translate-x-0.5" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              </div>
            </div>,
            document.body
          )
        ) : null}

        {/* File Menu */}
        {typeof document !== "undefined" && showFileMenu ? (
          createPortal(
            <div
            ref={fileMenuPanelRef}
            className={`fixed z-[59] animate-in fade-in duration-200 overflow-hidden ${panelClass}`}
            style={{ ...panelStyle, ...fileMenuPopoverStyle }}
          >
            <div className="max-h-[min(74vh,640px)] space-y-4 overflow-y-auto p-4">
              <div className="space-y-3">
                {!accountLoaded ? (
                  <div className="flex items-center gap-3 animate-pulse">
                    <div className="h-14 w-14 rounded-[18px] bg-[var(--app-panel-soft)]" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-32 rounded-full bg-[var(--app-panel-soft)]" />
                      <div className="h-3 w-24 rounded-full bg-[var(--app-panel-muted)]" />
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div className="h-[60px] rounded-[18px] bg-[var(--app-panel-soft)]" />
                        <div className="h-[60px] rounded-[18px] bg-[var(--app-panel-muted)]" />
                      </div>
                    </div>
                  </div>
                ) : accountSignedIn ? (
                    <div className="space-y-3">
                      <div className="flex items-start gap-3.5">
                        {accountInfo?.avatarUrl ? (
                        <img
                          src={accountInfo.avatarUrl}
                          alt="Avatar"
                          className="h-14 w-14 rounded-[18px] object-cover border border-[var(--app-border)]"
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-[18px] border border-[var(--app-border)] bg-[var(--app-panel-muted)] text-[var(--app-text-secondary)]">
                          <User size={18} />
                        </div>
                      )}
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex min-w-0 items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-[15px] font-semibold tracking-[-0.02em] text-[var(--app-text-primary)]">{accountName}</div>
                                {accountEmail && <div className="truncate text-[12px] leading-6 text-[var(--app-text-secondary)]">{accountEmail}</div>}
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                {onOpenSettings ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      closeMenus();
                                      onOpenSettings();
                                    }}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-panel-muted)] text-[var(--app-text-secondary)] transition hover:border-[var(--app-border-strong)] hover:bg-[var(--app-panel-soft)] hover:text-[var(--app-text-primary)] active:translate-y-px"
                                    title="打开设置"
                                    aria-label="打开设置"
                                  >
                                    <GearSix size={14} weight="regular" />
                                  </button>
                                ) : null}
                                {handleUploadAvatar ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleUploadAvatar();
                                      closeMenus();
                                    }}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-panel-muted)] text-[var(--app-text-secondary)] transition hover:border-[var(--app-border-strong)] hover:bg-[var(--app-panel-soft)] hover:text-[var(--app-text-primary)] active:translate-y-px"
                                    title="Upload avatar"
                                    aria-label="Upload avatar"
                                  >
                                    <Upload size={14} />
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleSignOut?.();
                                    closeMenus();
                                  }}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-panel-muted)] text-[var(--app-text-secondary)] transition hover:border-[var(--app-border-strong)] hover:bg-[var(--app-panel-soft)] hover:text-[var(--app-text-primary)] active:translate-y-px"
                                  title="Sign out"
                                  aria-label="Sign out"
                                >
                                  <LogOut size={14} />
                                </button>
                              </div>
                            </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 divide-x divide-[var(--app-border)] border-y border-[var(--app-border)]">
                      <button
                        type="button"
                        onClick={() => {
                          accountInfo?.onOpenAccountWorkspace?.();
                          closeMenus();
                        }}
                        className="flex items-center gap-2 px-2 py-3 text-left text-[11px] text-[var(--app-text-secondary)] transition hover:bg-[var(--app-panel-muted)] hover:text-[var(--app-text-primary)] active:translate-y-px"
                      >
                        <SquaresFour size={15} weight="thin" />
                        <span>账户与项目</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          accountInfo?.onOpenUserSquare?.();
                          closeMenus();
                        }}
                        className="flex items-center gap-2 px-3 py-3 text-left text-[11px] text-[var(--app-text-secondary)] transition hover:bg-[var(--app-panel-muted)] hover:text-[var(--app-text-primary)] active:translate-y-px"
                      >
                        <UsersThree size={15} weight="thin" />
                        <span>用户广场</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          accountInfo?.onConnectCodex?.();
                          closeMenus();
                        }}
                        className="flex items-center gap-2 px-3 py-3 text-left text-[11px] text-[var(--app-text-secondary)] transition hover:bg-[var(--app-panel-muted)] hover:text-[var(--app-text-primary)] active:translate-y-px"
                      >
                        <LinkSimple size={15} weight="thin" />
                        <span>连接 Codex</span>
                      </button>
                    </div>
                    {accountThemeControls ? (
                      <div className="rounded-[18px] border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-2">
                        {accountThemeControls}
                      </div>
                    ) : null}
                    </div>
                  ) : (
                    <div className="space-y-3">
                    <div className="flex items-start gap-3.5">
                      <div className="flex h-14 w-14 items-center justify-center rounded-[18px] border border-dashed border-[var(--app-border-strong)] bg-[var(--app-panel-muted)] text-[var(--app-text-secondary)]">
                        <User size={18} />
                      </div>
                      <div className="flex-1 space-y-1.5">
                        <div className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--app-text-primary)]">未登录</div>
                        <div className="text-[12px] leading-6 text-[var(--app-text-secondary)]">登录后可启用 workspace 同步能力、主题偏好与项目管理。</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      <button
                        type="button"
                        className={`${utilityButtonClass} border-transparent bg-[linear-gradient(180deg,rgba(122,183,160,0.18),rgba(122,183,160,0.08))] hover:border-[var(--app-border-strong)]`}
                        onClick={() => {
                          accountInfo?.onSignIn?.();
                          closeMenus();
                        }}
                      >
                        <span className="flex h-10 w-10 items-center justify-center rounded-[16px] border border-white/10 bg-white/10 text-[#d9efe5]">
                          <User size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] font-semibold text-[var(--app-text-primary)]">Sign in</span>
                          <span className="mt-0.5 block text-[10px] text-[var(--app-text-secondary)]">登录并启用同步</span>
                        </span>
                      </button>
                      {accountThemeControls ? (
                        <div className="rounded-[18px] border border-[var(--app-border)] bg-[var(--app-panel-muted)] p-2">
                          {accountThemeControls}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-3 border-t border-[var(--app-border)] pt-4">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--app-text-secondary)]">
                    Project Files
                  </div>
                  <div className="mt-1 text-[11px] leading-5 text-[var(--app-text-secondary)]">
                    Import or export Flow snapshots.
                  </div>
                </div>
                {renderIoPanel()}
              </div>
              </div>
            </div>,
            document.body
          )
        ) : null}

        {/* Main Bar */}
        {showToolbar ? (isEmbedded ? (
          <div className="w-full">
            <div className="flex flex-wrap items-center gap-2">
              <button
                ref={nodesButtonRef}
                data-nodes-trigger
                onClick={(event) => {
                  setNodesAnchorRect(event.currentTarget.getBoundingClientRect());
                  setShowPalette((v) => !v);
                  setShowFileMenu(false);
                }}
                className={`${toolbarChipClass} ${showPalette ? "border-[var(--app-border-strong)] bg-[var(--app-panel-soft)] text-[var(--app-text-primary)]" : ""}`}
                title="Nodes"
              >
                <Plus size={13} className={`transition-transform ${showPalette ? "rotate-45" : ""}`} />
                <span>Nodes</span>
              </button>

            </div>
          </div>
        ) : (
          <div
            className="w-[min(500px,calc(100vw-96px))] rounded-[28px] border border-[var(--app-border)] bg-[linear-gradient(180deg,var(--app-panel-strong),var(--app-panel))] p-3 shadow-[0_20px_38px_-28px_rgba(0,0,0,0.28)] backdrop-blur-xl"
            style={{ boxShadow: "var(--app-shadow)" }}
          >
            <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
              <button
                ref={nodesButtonRef}
                data-nodes-trigger
                onClick={(event) => {
                  setNodesAnchorRect(event.currentTarget.getBoundingClientRect());
                  setShowPalette((v) => !v);
                  setShowFileMenu(false);
                }}
                className={`${embeddedLabelClass} ${showPalette ? "border-[var(--app-border-strong)] bg-[var(--app-panel-soft)] text-[var(--app-text-primary)]" : ""}`}
                title="Nodes"
              >
                <Plus size={13} className={`transition-transform ${showPalette ? "rotate-45" : ""}`} />
                <span>Nodes</span>
              </button>

            </div>

            <button
              type="button"
              onClick={onOpenStylo}
              className="group flex min-h-[72px] w-full items-center gap-3 rounded-[22px] border border-[var(--app-border)] bg-[linear-gradient(180deg,var(--app-panel),var(--app-panel-soft))] px-4 py-3 text-left transition hover:border-[var(--app-border-strong)] hover:bg-[linear-gradient(180deg,var(--app-panel-strong),var(--app-panel-soft))] active:translate-y-px"
              title="Open Stylo"
            >
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-[14px] border border-[var(--app-border)] bg-[var(--app-panel-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <img className="h-full w-full object-cover" src="/icon-128.png" alt="" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                  Stylo
                </div>
                <div className="mt-1 text-[13px] font-medium tracking-[-0.01em] text-[var(--app-text-primary)]">
                  Ask, revise, or build on the canvas
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="block h-1.5 w-14 rounded-full bg-[var(--app-accent-soft)]" />
                  <span className="block h-1.5 w-9 rounded-full bg-[var(--app-panel-muted)]" />
                  <span className="block h-1.5 w-6 rounded-full bg-[var(--app-panel-muted)]" />
                </div>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-panel-strong)] text-[var(--app-text-secondary)] transition group-hover:text-[var(--app-text-primary)]">
                <ChevronRight size={15} />
              </div>
            </button>
          </div>
        )) : null}

      </div>
    </div>
  );
};
