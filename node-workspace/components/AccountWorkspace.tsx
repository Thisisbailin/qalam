import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import * as Y from "yjs";
import {
  ArrowRight,
  Check,
  CircleNotch,
  ClockCounterClockwise,
  Eye,
  FilmStrip,
  Folder,
  Footprints,
  GlobeHemisphereWest,
  Lock,
  MagnifyingGlass,
  MapTrifold,
  PencilSimple,
  Plus,
  SquaresFour,
  Trash,
  UserCircle,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import type { ProjectData, FlowProject } from "../../types";
import type { AccountApiSession } from "../../sync/authenticatedFetch";
import { requireOkResponse, SyncTransportError } from "../../sync/authenticatedFetch";
import { decodeUpdateBase64, readProjectSnapshot } from "../../collaboration/yProjectDocument";
import {
  getFlowProjectsForState,
  getWeightedAxisBlocks,
  parseFoundationGraph,
  saveActiveFlowIntoProjects,
} from "../foundation/scaffold";
import {
  ACCOUNT_PROJECT_LIMIT,
  createAccountProject,
  createAccountProjectId,
  removeAccountProject,
  switchAccountProject,
  updateAccountProject,
} from "../../utils/accountProjects";
import { DEFAULT_FLOW_PROJECT_DURATION } from "../../utils/flowProject";

export type AccountWorkspaceView = "projects" | "square" | "traces";

type Props = {
  isOpen: boolean;
  initialView?: AccountWorkspaceView;
  onClose: () => void;
  accountSession: AccountApiSession;
  projectData: ProjectData;
  setProjectData: React.Dispatch<React.SetStateAction<ProjectData>>;
  onDeleteCloudProject?: (projectId: string) => Promise<void>;
  accountInfo: { name: string; username?: string; email?: string; avatarUrl?: string };
};

type PublicationProject = {
  projectId: string;
  title: string;
  updatedAt: number;
  visibility: "inherit" | "public" | "private";
};

type PublicationPayload = {
  profile: {
    username: string | null;
    displayName: string | null;
    bio: string;
    avatarUrl: string | null;
    accountVisibility: "public" | "private";
    searchable: boolean;
    updatedAt: number;
  };
  projects: PublicationProject[];
};

type DirectoryUser = {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  accountPublic: boolean;
};

type PublicProfilePayload = {
  profile: DirectoryUser & { bio: string; updatedAt: number };
  projects: Array<{ projectId: string; title: string; updatedAt: number; visibility: "public" | "account" }>;
};

type TraceItem = {
  id: number;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  projectId: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
  viewCount: number;
  current: boolean;
};

type TracePayload = {
  inboundCurrent: TraceItem[];
  inboundHistory: TraceItem[];
  outboundHistory: TraceItem[];
};

type ProjectDraft = {
  mode: "create" | "edit";
  projectId?: string;
  title: string;
  durationMin: number;
};

const REALTIME_PROTOCOL = "stylo-realtime.v1";
const panelTransition = { type: "spring" as const, stiffness: 190, damping: 25 };

const formatRelative = (timestamp: number) => {
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return new Date(timestamp).toLocaleDateString();
};

const Avatar: React.FC<{ src?: string | null; name: string; size?: "sm" | "md" | "lg" }> = ({ src, name, size = "md" }) => {
  const dimensions = size === "lg" ? "h-16 w-16" : size === "sm" ? "h-8 w-8" : "h-11 w-11";
  return src ? (
    <img src={src} alt={`${name} avatar`} className={`${dimensions} shrink-0 rounded-[28%] border border-[var(--app-border)] object-cover`} />
  ) : (
    <span className={`${dimensions} flex shrink-0 items-center justify-center rounded-[28%] border border-[var(--app-border)] bg-[var(--app-panel-muted)] text-[var(--app-text-secondary)]`}>
      <UserCircle size={size === "lg" ? 28 : size === "sm" ? 15 : 20} weight="thin" />
    </span>
  );
};

const Toggle: React.FC<{ checked: boolean; onChange: () => void; disabled?: boolean; label: string }> = ({ checked, onChange, disabled, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={onChange}
    className={`relative h-7 w-12 rounded-full border transition-[background-color,border-color,transform] duration-300 ease-[cubic-bezier(.16,1,.3,1)] active:scale-[0.98] disabled:opacity-45 ${checked ? "border-emerald-600/50 bg-emerald-600/70" : "border-[var(--app-border-strong)] bg-[var(--app-panel-muted)]"}`}
  >
    <span className={`absolute top-[3px] h-5 w-5 rounded-full bg-[#f7f7f4] shadow-[0_2px_5px_rgba(18,24,20,0.2)] transition-transform duration-300 ease-[cubic-bezier(.16,1,.3,1)] ${checked ? "translate-x-[22px]" : "translate-x-[3px]"}`} />
  </button>
);

const ProjectOutline: React.FC<{ project: FlowProject; liveLabel?: string }> = ({ project, liveLabel }) => {
  const outline = useMemo(() => {
    try {
      const timeline = parseFoundationGraph(project.flow, {
        rootNodeId: project.rootNodeId,
        title: project.title,
        durationMin: project.durationMin,
      }).timeline;
      return {
        time: timeline.blocks,
        space: getWeightedAxisBlocks(timeline, "space"),
      };
    } catch {
      return { time: [], space: [] };
    }
  }, [project]);
  const nodes = project.flow.flowNodes?.filter((node) => !(node.data as any)?.foundationRole) || [];
  const axes = [
    { key: "time", title: "时间轴", meta: `${project.durationMin} min`, Icon: FilmStrip, items: outline.time.map((item) => item.title) },
    { key: "space", title: "空间轴", meta: `${outline.space.length} blocks`, Icon: MapTrifold, items: outline.space.map((item) => item.title) },
  ];
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--app-border)] pb-5">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--app-text-muted)]">Project hierarchy</div>
          <h2 className="mt-2 text-[28px] font-semibold tracking-[-0.045em] text-[var(--app-text-primary)]">{project.title}</h2>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-[var(--app-text-secondary)]">
          {liveLabel ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> : null}
          {liveLabel || `${nodes.length} content nodes`}
        </div>
      </div>
      <div className="divide-y divide-[var(--app-border)]">
        {axes.map(({ key, title, meta, Icon, items }) => (
          <section key={key} className="grid grid-cols-[34px_minmax(0,1fr)] gap-4 py-5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--app-border)] text-[var(--app-text-secondary)]"><Icon size={15} weight="thin" /></span>
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-4">
                <strong className="text-[13px] font-semibold text-[var(--app-text-primary)]">{title}</strong>
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">{meta}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                {items.length ? items.slice(0, 12).map((item, index) => (
                  <span key={`${item}-${index}`} className="text-[11px] text-[var(--app-text-secondary)]">{String(index + 1).padStart(2, "0")} / {item}</span>
                )) : <span className="text-[11px] text-[var(--app-text-muted)]">尚未建立内容</span>}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

export const AccountWorkspace: React.FC<Props> = ({
  isOpen,
  initialView = "projects",
  onClose,
  accountSession,
  projectData,
  setProjectData,
  onDeleteCloudProject,
  accountInfo,
}) => {
  const [view, setView] = useState<AccountWorkspaceView>(initialView);
  const [publication, setPublication] = useState<PublicationPayload | null>(null);
  const [publicationLoading, setPublicationLoading] = useState(false);
  const [publicationError, setPublicationError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState(projectData.activeFlowProjectId || "");
  const [draft, setDraft] = useState<ProjectDraft | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ username: "", bio: "" });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<PublicProfilePayload | null>(null);
  const [selectedUserLoading, setSelectedUserLoading] = useState(false);
  const [selectedPublicProjectId, setSelectedPublicProjectId] = useState<string | null>(null);
  const [publicProjectData, setPublicProjectData] = useState<ProjectData | null>(null);
  const [publicProjectStatus, setPublicProjectStatus] = useState<"idle" | "loading" | "live" | "reconnecting" | "error">("idle");
  const [traces, setTraces] = useState<TracePayload | null>(null);
  const [tracesLoading, setTracesLoading] = useState(false);
  const [tracesError, setTracesError] = useState<string | null>(null);
  const visitSessionsRef = useRef(new Map<string, string>());
  const selectActiveAfterMutationRef = useRef(false);

  const projects = useMemo(() => saveActiveFlowIntoProjects(projectData, Date.now()), [projectData]);
  const selectedProject = projects.find((item) => item.id === selectedProjectId) || projects[0] || null;
  const publicationByProject = useMemo(
    () => new Map((publication?.projects || []).map((item) => [item.projectId, item])),
    [publication?.projects],
  );

  const visitSession = useCallback((username: string, projectId?: string | null) => {
    const key = `${username}:${projectId || "profile"}`;
    const existing = visitSessionsRef.current.get(key);
    if (existing) return existing;
    const value = crypto.randomUUID();
    visitSessionsRef.current.set(key, value);
    return value;
  }, []);

  useEffect(() => {
    if (!selectActiveAfterMutationRef.current || !projectData.activeFlowProjectId) return;
    selectActiveAfterMutationRef.current = false;
    setSelectedProjectId(projectData.activeFlowProjectId);
  }, [projectData.activeFlowProjectId]);

  const loadPublication = useCallback(async () => {
    setPublicationLoading(true);
    setPublicationError(null);
    try {
      const response = await accountSession.request("/api/publication");
      await requireOkResponse(response, "加载账户公开设置失败");
      const payload = await response.json() as PublicationPayload;
      setPublication(payload);
      setProfileDraft({
        username: payload.profile.username || accountInfo.username || "",
        bio: payload.profile.bio || "",
      });
    } catch (error) {
      setPublicationError(error instanceof Error ? error.message : "加载账户公开设置失败");
    } finally {
      setPublicationLoading(false);
    }
  }, [accountInfo.username, accountSession]);

  const loadTraces = useCallback(async () => {
    setTracesLoading(true);
    setTracesError(null);
    try {
      const response = await accountSession.request("/api/view-traces");
      await requireOkResponse(response, "加载踪迹失败");
      setTraces(await response.json() as TracePayload);
    } catch (error) {
      setTracesError(error instanceof Error ? error.message : "加载踪迹失败");
    } finally {
      setTracesLoading(false);
    }
  }, [accountSession]);

  useEffect(() => {
    if (!isOpen) return;
    setView(initialView);
    void loadPublication();
  }, [initialView, isOpen, loadPublication]);

  useEffect(() => {
    if (!isOpen || view !== "traces") return;
    void loadTraces();
    const timer = window.setInterval(() => void loadTraces(), 15_000);
    return () => window.clearInterval(timer);
  }, [isOpen, loadTraces, view]);

  useEffect(() => {
    if (!isOpen || view !== "square") return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setDirectoryLoading(true);
      setDirectoryError(null);
      void accountSession.request(`/api/public-directory?q=${encodeURIComponent(query.trim())}`, {}, controller.signal)
        .then(async (response) => {
          await requireOkResponse(response, "搜索用户失败");
          const payload = await response.json() as { users?: DirectoryUser[] };
          setDirectory(payload.users || []);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setDirectoryError(error instanceof Error ? error.message : "搜索用户失败");
        })
        .finally(() => setDirectoryLoading(false));
    }, 240);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [accountSession, isOpen, query, view]);

  useEffect(() => {
    const username = selectedUser?.profile.username;
    if (!isOpen || view !== "square" || !username) return;
    const session = visitSession(username, selectedPublicProjectId);
    const beat = () => void accountSession.request("/api/view-traces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, projectId: selectedPublicProjectId || undefined, visitSession: session }),
    }).catch(() => undefined);
    beat();
    const timer = window.setInterval(beat, 25_000);
    return () => window.clearInterval(timer);
  }, [accountSession, isOpen, selectedPublicProjectId, selectedUser?.profile.username, view, visitSession]);

  useEffect(() => {
    const username = selectedUser?.profile.username;
    const projectId = selectedPublicProjectId;
    if (!isOpen || view !== "square" || !username || !projectId) {
      setPublicProjectData(null);
      setPublicProjectStatus("idle");
      return;
    }
    let disposed = false;
    let accessDenied = false;
    let reconnectAttempt = 0;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    const doc = new Y.Doc();
    const session = visitSession(username, projectId);
    const applyDoc = () => {
      if (disposed) return;
      setPublicProjectData(readProjectSnapshot<ProjectData & Record<string, unknown>>(doc));
    };
    const connect = async () => {
      if (disposed || accessDenied) return;
      setPublicProjectStatus((current) => current === "loading" ? current : "reconnecting");
      try {
        socket = await accountSession.openWebSocket(
          `/api/public-project-realtime?username=${encodeURIComponent(username)}&projectId=${encodeURIComponent(projectId)}&visitSession=${encodeURIComponent(session)}`,
          REALTIME_PROTOCOL,
        );
        socket.onmessage = (event) => {
          if (typeof event.data !== "string") return;
          try {
            const message = JSON.parse(event.data) as { type?: string; update?: string };
            if ((message.type === "sync" || message.type === "update") && message.update) {
              Y.applyUpdate(doc, decodeUpdateBase64(message.update), "public-room");
              applyDoc();
              reconnectAttempt = 0;
              setPublicProjectStatus("live");
            }
          } catch {
            setPublicProjectStatus("error");
          }
        };
        socket.onclose = (event) => {
          if (disposed || accessDenied) return;
          if (event.code === 4003) {
            accessDenied = true;
            setPublicProjectStatus("error");
            return;
          }
          setPublicProjectStatus("reconnecting");
          const retryDelay = Math.min(30_000, 2_000 * (2 ** Math.min(reconnectAttempt, 4)));
          reconnectAttempt += 1;
          reconnectTimer = window.setTimeout(() => void connect(), retryDelay);
        };
        socket.onerror = () => setPublicProjectStatus("reconnecting");
      } catch {
        if (disposed) return;
        setPublicProjectStatus("reconnecting");
        const retryDelay = Math.min(30_000, 2_000 * (2 ** Math.min(reconnectAttempt, 4)));
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(() => void connect(), retryDelay);
      }
    };
    setPublicProjectStatus("loading");
    void accountSession.request(
      `/api/public-project?username=${encodeURIComponent(username)}&projectId=${encodeURIComponent(projectId)}&visitSession=${encodeURIComponent(session)}`,
    ).then(async (response) => {
      await requireOkResponse(response, "加载公开项目失败");
      const payload = await response.json() as { projectData: ProjectData };
      if (!disposed) setPublicProjectData(payload.projectData);
    }).catch((error) => {
      if (disposed) return;
      if (error instanceof SyncTransportError && [401, 403, 404].includes(error.status || 0)) {
        accessDenied = true;
        socket?.close(1000, "Public access unavailable");
      }
      setPublicProjectStatus("error");
    });
    void connect();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close(1000, "Public viewer closed");
      doc.destroy();
    };
  }, [accountSession, isOpen, selectedPublicProjectId, selectedUser?.profile.username, view, visitSession]);

  const saveProfile = async () => {
    setProfileSaving(true);
    setProfileMessage(null);
    try {
      const response = await accountSession.request("/api/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: profileDraft.username,
          bio: profileDraft.bio,
        }),
      });
      await requireOkResponse(response, "保存账户资料失败");
      setProfileMessage("资料已保存");
      await loadPublication();
      setIsProfileEditorOpen(false);
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : "保存账户资料失败");
    } finally {
      setProfileSaving(false);
    }
  };

  const updateAccountVisibility = async () => {
    if (!publication) return;
    const next = publication.profile.accountVisibility === "public" ? "private" : "public";
    setPublication({ ...publication, profile: { ...publication.profile, accountVisibility: next } });
    try {
      const response = await accountSession.request("/api/publication", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountVisibility: next }),
      });
      await requireOkResponse(response, "更新账户公开状态失败");
    } catch (error) {
      setPublication({ ...publication, profile: { ...publication.profile, accountVisibility: next === "public" ? "private" : "public" } });
      setPublicationError(error instanceof Error ? error.message : "更新账户公开状态失败");
    }
  };

  const updateProjectVisibility = async (projectId: string, visibility: PublicationProject["visibility"]) => {
    if (!publication) return;
    const previous = publication;
    const existing = publication.projects.find((item) => item.projectId === projectId);
    const nextItem: PublicationProject = existing
      ? { ...existing, visibility }
      : { projectId, title: projects.find((item) => item.id === projectId)?.title || projectId, updatedAt: Date.now(), visibility };
    setPublication({ ...publication, projects: [...publication.projects.filter((item) => item.projectId !== projectId), nextItem] });
    try {
      const response = await accountSession.request("/api/publication", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, visibility }),
      });
      await requireOkResponse(response, "更新项目公开状态失败");
    } catch (error) {
      setPublication(previous);
      setPublicationError(error instanceof Error ? error.message : "更新项目公开状态失败");
    }
  };

  const openUser = async (user: DirectoryUser) => {
    setSelectedUserLoading(true);
    setSelectedUser(null);
    setSelectedPublicProjectId(null);
    try {
      const session = visitSession(user.username);
      const response = await accountSession.request(
        `/api/public-profile?username=${encodeURIComponent(user.username)}&visitSession=${encodeURIComponent(session)}`,
      );
      await requireOkResponse(response, "加载用户主页失败");
      setSelectedUser(await response.json() as PublicProfilePayload);
    } catch (error) {
      setDirectoryError(error instanceof Error ? error.message : "加载用户主页失败");
    } finally {
      setSelectedUserLoading(false);
    }
  };

  const submitDraft = () => {
    if (!draft?.title.trim()) return;
    if (draft.mode === "create") {
      selectActiveAfterMutationRef.current = true;
      setProjectData((current) => createAccountProject(current, draft));
    } else if (draft.projectId) {
      setProjectData((current) => updateAccountProject(current, draft.projectId!, draft));
    }
    setDraft(null);
  };

  const confirmDelete = async () => {
    if (!pendingDeleteId || deletePending) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      if (!onDeleteCloudProject) throw new Error("项目删除服务暂不可用");
      await onDeleteCloudProject(pendingDeleteId);
      setProjectData((current) => removeAccountProject(current, pendingDeleteId));
      if (selectedProjectId === pendingDeleteId) selectActiveAfterMutationRef.current = true;
      setPendingDeleteId(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "永久删除项目失败");
    } finally {
      setDeletePending(false);
    }
  };

  const remoteProject = useMemo(() => {
    if (!publicProjectData) return null;
    return getFlowProjectsForState(publicProjectData).find((item) => item.id === selectedPublicProjectId)
      || getFlowProjectsForState(publicProjectData)[0]
      || null;
  }, [publicProjectData, selectedPublicProjectId]);

  if (!isOpen) return null;
  const nav = [
    { key: "projects" as const, label: "账户与项目", Icon: SquaresFour },
    { key: "square" as const, label: "用户广场", Icon: UsersThree },
    { key: "traces" as const, label: "踪迹", Icon: Footprints },
  ];

  return (
    <motion.section
      initial={{ opacity: 0, scale: 0.992 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.995 }}
      transition={panelTransition}
      className="fixed inset-0 z-[92] min-h-[100dvh] overflow-hidden bg-[var(--app-bg)] text-[var(--app-text-primary)]"
      role="dialog"
      aria-modal="true"
      aria-label="账户工作台"
    >
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[250px_minmax(0,1fr)] md:grid-rows-1">
        <aside className="flex items-center justify-between gap-4 border-b border-[var(--app-border)] px-4 py-3 md:flex-col md:items-stretch md:border-b-0 md:border-r md:px-5 md:py-6">
          <div className="flex min-w-0 items-center gap-3 md:block">
            <Avatar src={publication?.profile.avatarUrl || accountInfo.avatarUrl} name={publication?.profile.username || accountInfo.name} />
            <div className="min-w-0 md:mt-4">
              <div className="truncate text-[14px] font-semibold tracking-[-0.025em]">{publication?.profile.username || accountInfo.username || "设置用户名"}</div>
              <div className="mt-1 flex items-center gap-1.5 truncate font-mono text-[9px] text-[var(--app-text-muted)]">
                <Lock size={10} weight="fill" />
                <span className="truncate">{accountInfo.email || "登录邮箱仅自己可见"}</span>
              </div>
            </div>
          </div>
          <div className="hidden border-y border-[var(--app-border)] py-4 md:block">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold">公开账户</div>
                <div className="mt-1 text-[9px] leading-4 text-[var(--app-text-muted)]">项目默认跟随此设置</div>
              </div>
              {publicationLoading ? (
                <span className="h-7 w-12 animate-pulse rounded-full bg-[var(--app-panel-muted)]" />
              ) : publication ? (
                <Toggle
                  checked={publication.profile.accountVisibility === "public"}
                  onChange={() => void updateAccountVisibility()}
                  disabled={!publication.profile.username}
                  label="公开账户"
                />
              ) : <span className="h-7 w-12 animate-pulse rounded-full bg-[var(--app-panel-muted)]" />}
            </div>
            {!publication?.profile.username ? <div className="mt-3 text-[9px] leading-4 text-amber-700">设置用户名后才能公开。</div> : null}
            {publicationError ? <div className="mt-3 border-l-2 border-rose-500 pl-2 text-[9px] leading-4 text-rose-600">{publicationError}</div> : null}
            <button type="button" onClick={() => { setProfileMessage(null); setIsProfileEditorOpen(true); }} className="mt-4 inline-flex items-center gap-2 text-[10px] font-semibold text-[var(--app-text-secondary)] transition hover:text-[var(--app-text-primary)]">
              <PencilSimple size={13} />
              编辑账户资料
            </button>
          </div>
          <nav className="flex gap-1 md:mt-8 md:flex-col" aria-label="账户工作台导航">
            {nav.map(({ key, label, Icon }) => (
              <button key={key} type="button" onClick={() => setView(key)} className={`flex min-h-10 items-center gap-3 rounded-xl px-3 text-left text-[12px] transition active:scale-[0.98] ${view === key ? "bg-[var(--app-panel-soft)] text-[var(--app-text-primary)]" : "text-[var(--app-text-secondary)] hover:bg-[var(--app-panel-muted)]"}`}>
                <Icon size={17} weight={view === key ? "fill" : "thin"} />
                <span className="hidden md:inline">{label}</span>
              </button>
            ))}
          </nav>
          <div className="hidden md:block md:mt-auto">
            <div className="border-t border-[var(--app-border)] pt-4 text-[10px] leading-5 text-[var(--app-text-muted)]">邮箱只用于登录且不会公开。公开访问必须登录，并会显示在双方踪迹中。</div>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭账户工作台" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] text-[var(--app-text-secondary)] transition hover:bg-[var(--app-panel-muted)] active:scale-[0.96] md:absolute md:right-5 md:top-5"><X size={15} /></button>
        </aside>

        <main className="min-h-0 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            {view === "projects" ? (
              <motion.div key="projects" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={panelTransition} className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
                <section className="min-h-0 overflow-y-auto border-b border-[var(--app-border)] lg:border-b-0 lg:border-r">
                  <div className="sticky top-0 border-b border-[var(--app-border)] bg-[var(--app-bg)] px-5 py-5">
                    <div className="flex items-center justify-between gap-3">
                      <div><div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--app-text-muted)]">Account projects</div><div className="mt-1 font-mono text-[10px] text-[var(--app-text-secondary)]">{projects.length}/{ACCOUNT_PROJECT_LIMIT}</div></div>
                      <button type="button" onClick={() => setDraft({ mode: "create", projectId: createAccountProjectId(), title: `项目 ${projects.length + 1}`, durationMin: DEFAULT_FLOW_PROJECT_DURATION })} disabled={projects.length >= ACCOUNT_PROJECT_LIMIT} aria-label="新建项目" className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--app-border)] transition hover:bg-[var(--app-panel-muted)] active:scale-[0.96] disabled:opacity-40"><Plus size={15} /></button>
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--app-border)] pt-4 md:hidden">
                      <button type="button" onClick={() => { setProfileMessage(null); setIsProfileEditorOpen(true); }} className="min-w-0 text-left">
                        <div className="truncate text-[11px] font-semibold">{publication?.profile.username || accountInfo.username || "设置用户名"}</div>
                        <div className="mt-1 flex items-center gap-1 truncate font-mono text-[8px] text-[var(--app-text-muted)]"><Lock size={9} weight="fill" />{accountInfo.email || "登录邮箱仅自己可见"}</div>
                      </button>
                      {publication ? <Toggle checked={publication.profile.accountVisibility === "public"} onChange={() => void updateAccountVisibility()} disabled={!publication.profile.username} label="公开账户" /> : <span className="h-7 w-12 animate-pulse rounded-full bg-[var(--app-panel-muted)]" />}
                    </div>
                  </div>
                  <div className="divide-y divide-[var(--app-border)]">
                    {projects.map((project, index) => {
                      const active = project.id === selectedProject?.id;
                      const live = project.id === projectData.activeFlowProjectId;
                      const visibility = publicationByProject.get(project.id)?.visibility || "inherit";
                      return (
                        <div key={project.id} className={`group px-5 py-4 transition ${active ? "bg-[var(--app-panel-soft)]" : "hover:bg-[var(--app-panel-muted)]"}`}>
                          <button type="button" onClick={() => setSelectedProjectId(project.id)} className="w-full text-left">
                            <div className="flex items-start gap-3">
                              <span className="pt-0.5 font-mono text-[9px] text-[var(--app-text-muted)]">{String(index + 1).padStart(2, "0")}</span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2"><strong className="truncate text-[12px] font-semibold">{project.title}</strong>{live ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="当前编辑" /> : null}</div>
                                <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--app-text-muted)]">{project.durationMin} min</div>
                              </div>
                              <ArrowRight size={13} className={`mt-1 transition-transform ${active ? "translate-x-1" : "group-hover:translate-x-0.5"}`} />
                            </div>
                          </button>
                          <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--app-border)] pt-3">
                            <span className="text-[9px] text-[var(--app-text-muted)]">项目公开范围</span>
                            <select
                              aria-label={`${project.title}公开范围`}
                              value={visibility}
                              onChange={(event) => void updateProjectVisibility(project.id, event.target.value as PublicationProject["visibility"])}
                              disabled={!publication}
                              className="max-w-[150px] bg-transparent text-right text-[10px] font-semibold outline-none disabled:opacity-45"
                            >
                              <option value="inherit">跟随账户</option>
                              <option value="public" disabled={!publication?.profile.username}>公开</option>
                              <option value="private">私密</option>
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="min-h-0 overflow-y-auto px-5 py-6 md:px-8 md:py-8">
                  {selectedProject ? (
                    <>
                      <ProjectOutline project={selectedProject} />
                      <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-[var(--app-border)] pt-5">
                        <button type="button" onClick={() => setProjectData((current) => switchAccountProject(current, selectedProject.id))} disabled={selectedProject.id === projectData.activeFlowProjectId} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--app-border)] px-4 text-[11px] font-semibold transition hover:bg-[var(--app-panel-muted)] active:scale-[0.98] disabled:opacity-45"><Check size={14} />{selectedProject.id === projectData.activeFlowProjectId ? "正在编辑" : "切换并编辑"}</button>
                        <button type="button" onClick={() => setDraft({ mode: "edit", projectId: selectedProject.id, title: selectedProject.title, durationMin: selectedProject.durationMin })} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--app-border)] px-4 text-[11px] transition hover:bg-[var(--app-panel-muted)] active:scale-[0.98]"><PencilSimple size={14} />编辑资料</button>
                        <button type="button" onClick={() => { setDeleteError(null); setPendingDeleteId(selectedProject.id); }} disabled={projects.length <= 1} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--app-border)] px-4 text-[11px] text-rose-600 transition hover:bg-rose-500/5 active:scale-[0.98] disabled:opacity-40"><Trash size={14} />删除</button>
                      </div>
                    </>
                  ) : <div className="flex min-h-64 items-center justify-center text-[12px] text-[var(--app-text-muted)]">尚无项目</div>}
                </section>
              </motion.div>
            ) : view === "square" ? (
              <motion.div key="square" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={panelTransition} className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
                <section className="min-h-0 overflow-y-auto border-b border-[var(--app-border)] lg:border-b-0 lg:border-r">
                  <div className="sticky top-0 bg-[var(--app-bg)] px-5 py-5"><div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--app-text-muted)]">User square</div><label className="mt-4 flex h-11 items-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 focus-within:border-[var(--app-border-strong)]"><MagnifyingGlass size={15} className="text-[var(--app-text-muted)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索用户名" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" /></label></div>
                  {directoryError ? <div className="mx-5 mb-4 border-l-2 border-rose-500 pl-3 text-[11px] text-rose-600">{directoryError}</div> : null}
                  <div className="divide-y divide-[var(--app-border)] border-t border-[var(--app-border)]">
                    {directoryLoading ? Array.from({ length: 4 }).map((_, index) => <div key={index} className="flex animate-pulse gap-3 px-5 py-4"><div className="h-10 w-10 rounded-xl bg-[var(--app-panel-muted)]" /><div className="flex-1 space-y-2"><div className="h-3 w-24 rounded bg-[var(--app-panel-muted)]" /><div className="h-2 w-16 rounded bg-[var(--app-panel-soft)]" /></div></div>) : directory.length ? directory.map((user) => <button key={user.username} type="button" onClick={() => void openUser(user)} className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-[var(--app-panel-muted)] active:bg-[var(--app-panel-soft)]"><Avatar src={user.avatarUrl} name={user.username} size="sm" /><div className="min-w-0 flex-1"><div className="truncate text-[12px] font-semibold">{user.username}</div><div className="mt-1 font-mono text-[9px] text-[var(--app-text-muted)]">@{user.username}</div></div>{user.accountPublic ? <GlobeHemisphereWest size={14} className="text-emerald-600" /> : <Lock size={14} className="text-[var(--app-text-muted)]" />}</button>) : <div className="px-5 py-12 text-center text-[11px] leading-6 text-[var(--app-text-muted)]">{query ? "没有匹配的用户名" : "尚无公开账户"}</div>}
                  </div>
                </section>
                <section className="min-h-0 overflow-y-auto px-5 py-6 md:px-8 md:py-8">
                  {selectedUserLoading ? <div className="space-y-5 animate-pulse"><div className="h-20 w-72 rounded-2xl bg-[var(--app-panel-muted)]" /><div className="h-52 rounded-2xl bg-[var(--app-panel-muted)]" /></div> : selectedUser ? (
                    <div className="mx-auto max-w-[1120px]"><header className="flex flex-wrap items-start gap-5 border-b border-[var(--app-border)] pb-6"><Avatar src={selectedUser.profile.avatarUrl} name={selectedUser.profile.username} size="lg" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-3"><h2 className="text-[26px] font-semibold tracking-[-0.04em]">{selectedUser.profile.username}</h2>{selectedUser.profile.accountPublic ? <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/25 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-700"><GlobeHemisphereWest size={12} />public</span> : <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--app-border)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--app-text-muted)]"><Lock size={12} />normal</span>}</div><div className="mt-1 font-mono text-[10px] text-[var(--app-text-muted)]">@{selectedUser.profile.username}</div>{selectedUser.profile.bio ? <p className="mt-3 max-w-[60ch] text-[12px] leading-6 text-[var(--app-text-secondary)]">{selectedUser.profile.bio}</p> : null}</div></header>
                      <div className="grid gap-6 pt-6 xl:grid-cols-[230px_minmax(0,1fr)]"><aside><div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--app-text-muted)]">Public projects</div><div className="mt-3 divide-y divide-[var(--app-border)] border-y border-[var(--app-border)]">{selectedUser.projects.length ? selectedUser.projects.map((project) => <button key={project.projectId} type="button" onClick={() => setSelectedPublicProjectId(project.projectId)} className={`w-full py-3 text-left transition ${selectedPublicProjectId === project.projectId ? "text-[var(--app-text-primary)]" : "text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]"}`}><div className="flex items-center justify-between gap-2"><span className="truncate text-[11px] font-semibold">{project.title}</span><Eye size={13} /></div><div className="mt-1 font-mono text-[8px] uppercase tracking-[0.12em] text-[var(--app-text-muted)]">{project.visibility} · {formatRelative(project.updatedAt)}</div></button>) : <div className="py-8 text-[11px] leading-5 text-[var(--app-text-muted)]">该用户没有公开项目。</div>}</div></aside><div>{remoteProject ? <ProjectOutline project={remoteProject} liveLabel={publicProjectStatus === "live" ? "LIVE / READ ONLY" : publicProjectStatus === "reconnecting" ? "RECONNECTING" : "READ ONLY"} /> : selectedPublicProjectId && publicProjectStatus === "error" ? <div className="flex min-h-64 items-center justify-center border border-dashed border-[var(--app-border)] text-[11px] text-rose-600">公开项目暂时无法读取</div> : <div className="flex min-h-64 flex-col items-center justify-center border border-dashed border-[var(--app-border)] text-center"><Eye size={24} weight="thin" className="text-[var(--app-text-muted)]" /><div className="mt-3 text-[11px] text-[var(--app-text-secondary)]">选择一个公开项目查看实时结构</div><div className="mt-1 text-[10px] text-[var(--app-text-muted)]">只读访问会记录在双方踪迹中</div></div>}</div></div>
                    </div>
                  ) : <div className="flex h-full min-h-72 flex-col items-center justify-center text-center"><UsersThree size={30} weight="thin" className="text-[var(--app-text-muted)]" /><div className="mt-4 text-[13px] font-semibold">从用户名进入一个人的主页</div><div className="mt-2 max-w-[36ch] text-[11px] leading-6 text-[var(--app-text-muted)]">普通账户只显示最小身份；公开账户或单独公开的项目会显示实时只读内容。</div></div>}
                </section>
              </motion.div>
            ) : (
              <motion.div key="traces" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={panelTransition} className="h-full min-h-0 overflow-y-auto px-5 py-6 md:px-8 md:py-8">
                <div className="mx-auto max-w-[1120px]"><header className="border-b border-[var(--app-border)] pb-6"><div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--app-text-muted)]">Account traces</div><h2 className="mt-2 text-[28px] font-semibold tracking-[-0.045em]">踪迹</h2><p className="mt-2 max-w-[64ch] text-[11px] leading-6 text-[var(--app-text-secondary)]">记录别人查看我的账户和项目，以及我查看过的其他账户。当前状态由最近 45 秒内的已认证心跳判定，历史显示最近 90 天。</p></header>
                  {tracesLoading && !traces ? <div className="mt-6 space-y-3 animate-pulse"><div className="h-20 bg-[var(--app-panel-muted)]" /><div className="h-40 bg-[var(--app-panel-muted)]" /></div> : tracesError ? <div className="mt-6 border-l-2 border-rose-500 pl-3 text-[11px] text-rose-600">{tracesError}</div> : traces ? <div className="grid gap-8 pt-7 xl:grid-cols-[0.9fr_1.1fr]"><div><div className="flex items-center justify-between"><div className="flex items-center gap-2 text-[11px] font-semibold"><Eye size={15} />正在看我</div><span className="font-mono text-[10px] text-[var(--app-text-muted)]">{traces.inboundCurrent.length}</span></div><div className="mt-3 divide-y divide-[var(--app-border)] border-y border-[var(--app-border)]">{traces.inboundCurrent.length ? traces.inboundCurrent.map((item) => <TraceRow key={`current-${item.id}`} item={item} current />) : <div className="py-10 text-[11px] text-[var(--app-text-muted)]">当前没有其他用户正在查看。</div>}</div><div className="mt-8 flex items-center justify-between"><div className="flex items-center gap-2 text-[11px] font-semibold"><ClockCounterClockwise size={15} />看过我的</div><span className="font-mono text-[10px] text-[var(--app-text-muted)]">{traces.inboundHistory.length}</span></div><div className="mt-3 divide-y divide-[var(--app-border)] border-y border-[var(--app-border)]">{traces.inboundHistory.length ? traces.inboundHistory.map((item) => <TraceRow key={`in-${item.id}`} item={item} />) : <div className="py-10 text-[11px] text-[var(--app-text-muted)]">还没有查看记录。</div>}</div></div><div><div className="flex items-center justify-between"><div className="flex items-center gap-2 text-[11px] font-semibold"><Footprints size={15} />我看过的</div><span className="font-mono text-[10px] text-[var(--app-text-muted)]">{traces.outboundHistory.length}</span></div><div className="mt-3 divide-y divide-[var(--app-border)] border-y border-[var(--app-border)]">{traces.outboundHistory.length ? traces.outboundHistory.map((item) => <TraceRow key={`out-${item.id}`} item={item} />) : <div className="py-10 text-[11px] text-[var(--app-text-muted)]">尚未查看其他用户。</div>}</div></div></div> : null}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      <AnimatePresence>
        {isProfileEditorOpen ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[96] flex items-center justify-center bg-zinc-950/30 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !profileSaving) setIsProfileEditorOpen(false); }}>
            <motion.form initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 8, opacity: 0 }} transition={panelTransition} onSubmit={(event) => { event.preventDefault(); void saveProfile(); }} className="w-full max-w-md rounded-[24px] border border-[var(--app-border)] bg-[var(--app-panel)] p-5 shadow-[0_28px_70px_rgba(20,24,22,0.18)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--app-text-muted)]">Account profile</div>
                  <h3 className="mt-1 text-[18px] font-semibold">账户资料</h3>
                </div>
                <button type="button" disabled={profileSaving} onClick={() => setIsProfileEditorOpen(false)} aria-label="关闭" className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--app-border)] disabled:opacity-40"><X size={13} /></button>
              </div>
              <div className="mt-5 border-y border-[var(--app-border)] py-4">
                <div className="text-[10px] text-[var(--app-text-secondary)]">登录邮箱</div>
                <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-[var(--app-text-primary)]"><Lock size={12} weight="fill" />{accountInfo.email || "未提供"}</div>
                <p className="mt-2 text-[9px] leading-5 text-[var(--app-text-muted)]">邮箱由登录账户管理，仅用于认证，不会显示给其他用户。</p>
              </div>
              <div className="mt-5 space-y-4">
                <label className="block">
                  <span className="text-[10px] text-[var(--app-text-secondary)]">用户名</span>
                  <input autoFocus value={profileDraft.username} onChange={(event) => setProfileDraft((current) => ({ ...current, username: event.target.value.toLowerCase() }))} placeholder="username" maxLength={30} className="mt-1.5 h-11 w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 font-mono text-[11px] outline-none focus:border-[var(--app-border-strong)]" />
                  <span className="mt-1.5 block text-[9px] leading-4 text-[var(--app-text-muted)]">这是对外显示和搜索的唯一名称。</span>
                </label>
                <label className="block">
                  <span className="text-[10px] text-[var(--app-text-secondary)]">简介</span>
                  <textarea value={profileDraft.bio} onChange={(event) => setProfileDraft((current) => ({ ...current, bio: event.target.value.slice(0, 320) }))} rows={4} className="mt-1.5 w-full resize-none rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 py-2 text-[11px] leading-5 outline-none focus:border-[var(--app-border-strong)]" />
                </label>
              </div>
              {profileMessage ? <div className="mt-4 border-l-2 border-[var(--app-border-strong)] pl-3 text-[10px] leading-5 text-[var(--app-text-secondary)]">{profileMessage}</div> : null}
              <div className="mt-6 flex justify-end gap-2">
                <button type="button" disabled={profileSaving} onClick={() => setIsProfileEditorOpen(false)} className="h-10 rounded-xl border border-[var(--app-border)] px-4 text-[11px] disabled:opacity-40">取消</button>
                <button type="submit" disabled={profileSaving || !profileDraft.username.trim()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--app-text-primary)] px-4 text-[11px] font-semibold text-[var(--app-bg)] disabled:opacity-40">{profileSaving ? <CircleNotch size={14} className="animate-spin" /> : <Check size={14} />}保存</button>
              </div>
            </motion.form>
          </motion.div>
        ) : null}
        {draft ? <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[96] flex items-center justify-center bg-zinc-950/30 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setDraft(null); }}><motion.form initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} transition={panelTransition} onSubmit={(event) => { event.preventDefault(); submitDraft(); }} className="w-full max-w-md rounded-[24px] border border-[var(--app-border)] bg-[var(--app-panel)] p-5 shadow-[0_28px_70px_rgba(20,24,22,0.18)]"><div className="flex items-center justify-between"><div><div className="text-[10px] uppercase tracking-[0.2em] text-[var(--app-text-muted)]">{draft.mode === "create" ? "New project" : "Project profile"}</div><h3 className="mt-1 text-[18px] font-semibold">{draft.mode === "create" ? "新建项目" : "编辑项目"}</h3></div><button type="button" onClick={() => setDraft(null)} aria-label="关闭" className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--app-border)]"><X size={13} /></button></div><div className="mt-5 space-y-4"><label className="block"><span className="text-[10px] text-[var(--app-text-secondary)]">项目名称</span><input autoFocus value={draft.title} onChange={(event) => setDraft((current) => current ? { ...current, title: event.target.value } : current)} maxLength={80} className="mt-1.5 h-11 w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 text-[12px] outline-none focus:border-[var(--app-border-strong)]" /></label><label className="block"><span className="text-[10px] text-[var(--app-text-secondary)]">预估时长</span><div className="mt-1.5 flex items-center gap-3"><input type="range" min={1} max={450} value={draft.durationMin} onChange={(event) => setDraft((current) => current ? { ...current, durationMin: Number(event.target.value) } : current)} className="min-w-0 flex-1" /><input type="number" min={1} max={450} value={draft.durationMin} onChange={(event) => setDraft((current) => current ? { ...current, durationMin: Number(event.target.value) } : current)} className="h-10 w-20 rounded-xl border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-2 font-mono text-[11px]" /></div></label></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setDraft(null)} className="h-10 rounded-xl border border-[var(--app-border)] px-4 text-[11px]">取消</button><button type="submit" disabled={!draft.title.trim()} className="h-10 rounded-xl bg-[var(--app-text-primary)] px-4 text-[11px] font-semibold text-[var(--app-bg)] disabled:opacity-40">{draft.mode === "create" ? "创建并打开" : "保存"}</button></div></motion.form></motion.div> : null}
        {pendingDeleteId ? <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[96] flex items-center justify-center bg-zinc-950/30 p-4"><motion.div initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={panelTransition} className="w-full max-w-sm rounded-[24px] border border-[var(--app-border)] bg-[var(--app-panel)] p-5"><div className="text-[10px] uppercase tracking-[0.2em] text-rose-600">Delete project</div><h3 className="mt-2 text-[18px] font-semibold">永久删除“{projects.find((item) => item.id === pendingDeleteId)?.title}”？</h3><p className="mt-2 text-[11px] leading-6 text-[var(--app-text-secondary)]">将删除此项目在本机、云端实时文档、Agent 记录和媒体存储中的全部数据，不会影响账户或其他项目。此操作不可撤销。</p>{deleteError ? <div className="mt-4 border-l-2 border-rose-500 pl-3 text-[10px] leading-5 text-rose-600">{deleteError}</div> : null}<div className="mt-6 flex justify-end gap-2"><button type="button" disabled={deletePending} onClick={() => { setPendingDeleteId(null); setDeleteError(null); }} className="h-10 rounded-xl border border-[var(--app-border)] px-4 text-[11px] disabled:opacity-40">取消</button><button type="button" disabled={deletePending} onClick={() => void confirmDelete()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-rose-700 px-4 text-[11px] font-semibold text-white disabled:opacity-55">{deletePending ? <CircleNotch size={14} className="animate-spin" /> : <Trash size={14} />}永久删除</button></div></motion.div></motion.div> : null}
      </AnimatePresence>
    </motion.section>
  );
};

const TraceRow: React.FC<{ item: TraceItem; current?: boolean }> = ({ item, current }) => {
  const name = item.username || item.displayName || "未知用户";
  return <div className="flex items-center gap-3 py-3"><Avatar src={item.avatarUrl} name={name} size="sm" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong className="truncate text-[11px]">{name}</strong>{current ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> : null}</div><div className="mt-1 truncate font-mono text-[9px] text-[var(--app-text-muted)]">@{item.username || "unknown"}{item.projectId ? ` / ${item.projectId}` : " / profile"}</div></div><div className="text-right"><div className="font-mono text-[9px] text-[var(--app-text-secondary)]">{current ? "NOW" : formatRelative(item.lastSeenAt)}</div><div className="mt-1 font-mono text-[8px] text-[var(--app-text-muted)]">{item.viewCount} views</div></div></div>;
};
