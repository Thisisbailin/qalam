
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { isClerkConfigured, useUser, useClerk, useAuth } from './lib/auth';
import { FlowState, ProjectData, SyncState, SyncStatus } from './types';
import { INITIAL_PROJECT_DATA } from './constants';
import { normalizeProjectData } from './utils/projectData';
import { getDeviceId } from './utils/device';
import { buildApiUrl } from './utils/api';
import { setApiAuthTokenProvider } from './utils/authToken';
import { usePersistedState } from './hooks/usePersistedState';
import { useCloudSync } from './hooks/useCloudSync';
import { useConfig } from './hooks/useConfig';
import { useTheme } from './hooks/useTheme';
import { useSecretsSync } from './hooks/useSecretsSync';
import { AppShell } from './components/layout/AppShell';
import { CloudAccountGate } from './components/CloudAccountGate';
import { CreativeWorkspace } from './node-workspace/components/CreativeWorkspace';
import { resetNodeFlowAccountState, resetNodeFlowProjectState } from './node-workspace/store/nodeFlowStore';
import type { ProjectSettingsPanelKey } from './node-workspace/components/ProjectSettingsPanel';
import { GlassEffectLab } from './node-workspace/components/GlassEffectLab';
import type { ModuleKey } from './node-workspace/components/ModuleBar';
import {
  resolveStyloProjectId,
  resetStyloScopedProjectData,
} from './agents/runtime/projectScope';
import { resetStyloProjectAgentStorage } from './agents/runtime/projectReset';
import { AccountApiSession, parseJsonResponse, requireOkResponse } from './sync/authenticatedFetch';
import {
  deleteCloudProject,
  hydrateCloudProjectCatalog,
  loadCloudProject,
  loadCloudProjectCatalog,
  removeDeletedCatalogProjects,
  updateCloudProjectCatalog,
} from './sync/projectCatalog';
import { deleteRealtimeDocument, resetRealtimeDocuments } from './sync/realtimeDocumentStore';

const AgentLab = React.lazy(() =>
  import('./node-workspace/components/AgentLab').then((module) => ({ default: module.AgentLab }))
);
const CineworLab = React.lazy(() =>
  import('./node-workspace/components/CineworLab').then((module) => ({ default: module.CineworLab }))
);
const DesignSystemLab = React.lazy(() =>
  import('./node-workspace/components/DesignSystemLab').then((module) => ({ default: module.DesignSystemLab }))
);

type LabModalKey = ModuleKey;

const PROJECT_STORAGE_KEY = 'stylo_project_v1';
const CONFIG_STORAGE_KEY = 'stylo_config_v1';
const THEME_STORAGE_KEY = 'stylo_theme_v1';
const AVATAR_STORAGE_KEY = 'stylo_avatar_url';
const REALTIME_RESET_MARKER = 'stylo_realtime_reset_2026_07_20';
const PROJECT_CACHE_PREFIXES = [
  `${PROJECT_STORAGE_KEY}:`,
  'stylo_local_backup:',
  'stylo_remote_backup:',
  'stylo_force_cloud_clear',
  'stylo_conversations_v2:',
  'stylo_agent_tool_activity_v2:',
];

type AccountScope = `user:${string}`;
type ProfileResponse = {
  avatarUrl?: unknown;
  username?: unknown;
};
type UploadUrlResponse = {
  signedUrl?: unknown;
  publicUrl?: unknown;
  path?: unknown;
};

const buildAccountStorageKey = (baseKey: string, accountScope: AccountScope) =>
  `${baseKey}:${encodeURIComponent(accountScope)}`;

const decodeJwtExpiry = (token: string) => {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const normalized = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
    const decoded = JSON.parse(atob(normalized));
    return typeof decoded?.exp === "number" ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
};

const decodeJwtSubject = (token: string) => {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
    const decoded = JSON.parse(atob(normalized));
    return typeof decoded?.sub === "string" ? decoded.sub : null;
  } catch {
    return null;
  }
};

const isJwtExpiredOrNearExpiry = (token: string, leewayMs = 30_000) => {
  const expiresAt = decodeJwtExpiry(token);
  if (!expiresAt) return false;
  return expiresAt - Date.now() <= leewayMs;
};

const ScopedApp: React.FC<{ accountScope: AccountScope }> = ({ accountScope }) => {
  // Clerk Auth Hooks
  const { isSignedIn: userSignedIn, user, isLoaded: isUserLoaded } = useUser();
  const { openSignIn, signOut } = useClerk();
  const { getToken, isLoaded: isAuthLoaded, isSignedIn: authSignedIn, userId: authUserId } = useAuth();
  const projectStorageKey = buildAccountStorageKey(PROJECT_STORAGE_KEY, accountScope);
  const configStorageKey = buildAccountStorageKey(CONFIG_STORAGE_KEY, accountScope);
  const avatarStorageKey = buildAccountStorageKey(AVATAR_STORAGE_KEY, accountScope);
  React.useLayoutEffect(() => {
    resetNodeFlowAccountState();
    return resetNodeFlowAccountState;
  }, [accountScope]);
  const getAuthToken = useCallback(async (options?: { skipCache?: boolean }) => {
    try {
      const expectedUserId = accountScope.startsWith("user:") ? accountScope.slice(5) : null;
      if (!expectedUserId || !authSignedIn || authUserId !== expectedUserId) return null;
      const token = await getToken({ template: "default", ...(options?.skipCache ? { skipCache: true } : {}) });
      if (!token || decodeJwtSubject(token) !== expectedUserId) return null;
      if (!options?.skipCache && isJwtExpiredOrNearExpiry(token)) {
        const refreshed = await getToken({ template: "default", skipCache: true });
        return refreshed && decodeJwtSubject(refreshed) === expectedUserId ? refreshed : null;
      }
      return token;
    } catch {
      return null;
    }
  }, [accountScope, authSignedIn, authUserId, getToken]);
  const accountSession = useMemo(
    () => new AccountApiSession(accountScope, getAuthToken, getDeviceId(), fetch, buildApiUrl),
    [accountScope, getAuthToken]
  );
  useEffect(() => accountSession.retain(), [accountSession]);
  useEffect(() => {
    setApiAuthTokenProvider(authSignedIn ? getAuthToken : null);
    return () => setApiAuthTokenProvider(null);
  }, [authSignedIn, getAuthToken]);
  const projectDataRef = useRef<ProjectData>(INITIAL_PROJECT_DATA);

  // Initialize state with Persisted hooks
  const [projectData, setProjectDataRaw] = usePersistedState<ProjectData>({
    key: projectStorageKey,
    initialValue: INITIAL_PROJECT_DATA,
    deserialize: (value) => normalizeProjectData(JSON.parse(value)),
    serialize: (value) => JSON.stringify(value),
    // React Flow publishes position changes at pointer-frame cadence. Keep the
    // canvas responsive, but serialize the large project snapshot only after
    // the gesture settles.
    debounceMs: 240,
  });
  const setProjectData = useCallback(
    (value: React.SetStateAction<ProjectData>) => {
      setProjectDataRaw((prev) =>
        normalizeProjectData(
          typeof value === 'function'
            ? (value as (prevState: ProjectData) => ProjectData)(prev)
            : value
        )
      );
    },
    [setProjectDataRaw]
  );
  // Catalog hydration runs before the later synchronization effects on the
  // first mounted frame. Keep the ref current during render so it never merges
  // cloud projects into the static initial value and overwrites local state.
  projectDataRef.current = projectData;

  const { config, setConfig } = useConfig(configStorageKey);

  const { isDarkMode, setIsDarkMode, toggleTheme } = useTheme(THEME_STORAGE_KEY, false);

  // Sync global theme classes for both Tailwind dark styles and CSS variable themes
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const themeClass = isDarkMode ? "theme-dark" : "theme-light";

    root.classList.remove("theme-light", "theme-dark");
    body.classList.remove("theme-light", "theme-dark");
    root.classList.add(themeClass);
    body.classList.add(themeClass);

    if (isDarkMode) {
      root.classList.add("dark");
      body.classList.add("dark");
    } else {
      root.classList.remove("dark");
      body.classList.remove("dark");
    }
  }, [isDarkMode]);

  const [syncState, setSyncState] = useState<SyncState>({
    project: { status: 'idle' },
    secrets: { status: 'disabled' }
  });
  const [isOnline, setIsOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine !== false,
  );
  const [isCloudProjectCatalogReady, setIsCloudProjectCatalogReady] = useState(false);
  const [cloudProjectCatalogRefresh, setCloudProjectCatalogRefresh] = useState(0);
  const [projectResetToken, setProjectResetToken] = useState(0);
  const publishedCatalogFingerprintRef = useRef("");

  const [openLabModal, setOpenLabModal] = useState<LabModalKey | null>(null);
  const [projectSettingsRequest, setProjectSettingsRequest] = useState<{ panel: ProjectSettingsPanelKey; nonce: number } | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = usePersistedState<string>({
    key: avatarStorageKey,
    initialValue: '',
    deserialize: (v) => JSON.parse(v),
    serialize: (v) => JSON.stringify(v)
  });
  const hasFetchedProfileAvatar = useRef(false);
  // A signed-in project is always cloud-backed.
  const isSyncFeatureEnabled = !!authSignedIn;
  const cloudProjectId = resolveStyloProjectId(projectData);

  useEffect(() => {
    let active = true;
    if (!isSyncFeatureEnabled) {
      setIsCloudProjectCatalogReady(true);
      return () => { active = false; };
    }
    if (cloudProjectCatalogRefresh === 0) setIsCloudProjectCatalogReady(false);
    void (async () => {
      try {
        const catalogResult = await loadCloudProjectCatalog(accountSession);
        const catalog = catalogResult.projects;
        const current = removeDeletedCatalogProjects(
          projectDataRef.current,
          catalogResult.deletedProjectIds,
        );
        if (!active) return;
        if (catalog.length === 0) {
          if (current !== projectDataRef.current) {
            projectDataRef.current = current;
            setProjectData(current);
          }
          return;
        }
        const localIds = new Set((current.flowProjects || []).map((project) => project.id));
        const missing = catalog.filter((entry) => entry.hasDocument && !localIds.has(entry.projectId));
        const loaded = (await Promise.all(missing.map(async (entry) => ({
          projectId: entry.projectId,
          data: await loadCloudProject(accountSession, entry.projectId),
        })))).filter((item): item is { projectId: string; data: ProjectData } => Boolean(item.data));
        if (!active) return;
        const merged = hydrateCloudProjectCatalog(current, catalog, loaded);
        projectDataRef.current = merged;
        setProjectData(merged);
      } catch (error) {
        console.warn("Cloud project catalog hydration failed", error);
      } finally {
        if (active) setIsCloudProjectCatalogReady(true);
      }
    })();
    return () => { active = false; };
  }, [
    accountScope,
    accountSession,
    cloudProjectCatalogRefresh,
    isSyncFeatureEnabled,
    setProjectData,
  ]);

  useEffect(() => {
    if (!isSyncFeatureEnabled) return;
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };
    const scheduleReconnect = () => {
      if (!active || reconnectTimer !== null) return;
      const delay = Math.min(30_000, 750 * (2 ** Math.min(reconnectAttempt, 5)));
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };
    const connect = async () => {
      if (!active || socket || navigator.onLine === false) return;
      try {
        const next = await accountSession.openWebSocket(
          "/api/account-projects-realtime",
          "stylo-realtime.v1",
        );
        if (!active) {
          next.close();
          return;
        }
        socket = next;
        next.onopen = () => {
          reconnectAttempt = 0;
        };
        next.onmessage = (event) => {
          if (typeof event.data !== "string") return;
          try {
            const message = JSON.parse(event.data) as { type?: unknown };
            if (message.type === "catalog-changed") {
              setCloudProjectCatalogRefresh((revision) => revision + 1);
            }
          } catch {
            // Ignore malformed invalidation packets and keep the live channel.
          }
        };
        next.onclose = () => {
          if (socket === next) socket = null;
          scheduleReconnect();
        };
        next.onerror = () => next.close();
      } catch {
        scheduleReconnect();
      }
    };
    const reconnectNow = () => {
      if (!active || navigator.onLine === false) return;
      clearReconnectTimer();
      if (!socket) void connect();
    };
    window.addEventListener("online", reconnectNow);
    window.addEventListener("focus", reconnectNow);
    void connect();
    return () => {
      active = false;
      clearReconnectTimer();
      window.removeEventListener("online", reconnectNow);
      window.removeEventListener("focus", reconnectNow);
      socket?.close();
      socket = null;
    };
  }, [accountSession, isSyncFeatureEnabled]);

  useEffect(() => {
    if (!isSyncFeatureEnabled || !isCloudProjectCatalogReady) return;
    const projects = (projectData.flowProjects || []).map((project) => ({
      projectId: project.id,
      title: project.title,
      color: project.color,
      durationMin: project.durationMin,
      rootNodeId: project.rootNodeId,
      createdAt: project.createdAt,
    }));
    const fingerprint = JSON.stringify(projects);
    if (!projects.length || fingerprint === publishedCatalogFingerprintRef.current) return;
    const timer = window.setTimeout(() => {
      void updateCloudProjectCatalog(accountSession, projects).then((result) => {
        publishedCatalogFingerprintRef.current = fingerprint;
        const rejected = Array.isArray(result.rejectedProjectIds)
          ? result.rejectedProjectIds
          : [];
        if (rejected.length) {
          setProjectData((current) => removeDeletedCatalogProjects(current, rejected));
        }
      }).catch((error) => {
        console.warn("Cloud project catalog update failed", error);
      });
    }, 320);
    return () => window.clearTimeout(timer);
  }, [
    accountSession,
    isCloudProjectCatalogReady,
    isSyncFeatureEnabled,
    projectData.flowProjects,
    setProjectData,
  ]);

  const openProjectSettings = useCallback((panel: ProjectSettingsPanelKey = "provider") => {
    setProjectSettingsRequest({ panel, nonce: Date.now() });
  }, []);
  const handleOpenLabModule = useCallback((key: ModuleKey) => {
    if (key === 'characters') {
      openProjectSettings("assets");
      return;
    }
    if (key === 'scenes') {
      openProjectSettings("assets");
      return;
    }
    setOpenLabModal(key);
  }, [openProjectSettings]);

  const closeLabModal = useCallback(() => {
    setOpenLabModal(null);
  }, []);

  // --- Cloud Sync Helpers ---

  useEffect(() => {
    projectDataRef.current = projectData;
  }, [projectData]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const projectEnabled = authSignedIn && isSyncFeatureEnabled;
    const secretsEnabled = authSignedIn && isSyncFeatureEnabled && config.syncApiKeys;
    setSyncState(prev => ({
      project: projectEnabled ? (prev.project.status === 'disabled' ? { status: 'loading' } : prev.project) : { status: 'disabled' },
      secrets: secretsEnabled
        ? (prev.secrets.status === 'disabled' ? { status: 'loading' } : prev.secrets)
        : { status: 'disabled' }
    }));
  }, [authSignedIn, config.syncApiKeys, isSyncFeatureEnabled]);

  const updateProjectSyncStatus = useCallback((status: SyncStatus, detail?: { lastSyncAt?: number; error?: string; pendingOps?: number; retryCount?: number; lastAttemptAt?: number }) => {
    setSyncState(prev => ({
      ...prev,
      project: {
        status,
        lastSyncAt: detail?.lastSyncAt ?? prev.project.lastSyncAt,
        lastError: status === 'synced' ? undefined : detail?.error ?? prev.project.lastError,
        pendingOps: detail?.pendingOps ?? (status === 'syncing' ? prev.project.pendingOps : 0),
        retryCount: detail?.retryCount ?? (status === 'offline' ? prev.project.retryCount : 0),
        lastAttemptAt: detail?.lastAttemptAt ?? prev.project.lastAttemptAt
      }
    }));
  }, []);

  const updateSecretsSyncStatus = useCallback((status: SyncStatus, detail?: { lastSyncAt?: number; error?: string; pendingOps?: number; retryCount?: number; lastAttemptAt?: number }) => {
    setSyncState(prev => ({
      ...prev,
      secrets: {
        status,
        lastSyncAt: detail?.lastSyncAt ?? prev.secrets.lastSyncAt,
        lastError: status === 'error' ? detail?.error ?? prev.secrets.lastError : status === 'synced' ? undefined : prev.secrets.lastError,
        pendingOps: detail?.pendingOps ?? prev.secrets.pendingOps,
        retryCount: detail?.retryCount ?? prev.secrets.retryCount,
        lastAttemptAt: detail?.lastAttemptAt ?? prev.secrets.lastAttemptAt
      }
    }));
  }, []);

  const handleCloudSyncError = useCallback((e: unknown) => {
    console.warn("Cloud sync error", e);
  }, []);

  const handleRemoteProjectReset = useCallback((mode: "reset" | "delete") => {
    setProjectData((local) => {
      if (mode === "reset") {
        return normalizeProjectData(resetStyloScopedProjectData(
          local,
          normalizeProjectData(structuredClone(INITIAL_PROJECT_DATA)),
          cloudProjectId,
        ));
      }
      const remainingProjects = (local.flowProjects || [])
        .filter((project) => project.id !== cloudProjectId);
      if (!remainingProjects.length) {
        return normalizeProjectData(structuredClone(INITIAL_PROJECT_DATA));
      }
      const activeProject = remainingProjects[0];
      return normalizeProjectData({
        ...local,
        fileName: activeProject.title || local.fileName,
        activeFlowProjectId: activeProject.id,
        flow: activeProject.flow,
        flowProjects: remainingProjects,
      });
    });
  }, [cloudProjectId, setProjectData]);

  // --- Cloud Sync (Clerk + Cloudflare Pages) ---
  const { flushProjectSync, suspendProjectSync } = useCloudSync({
    accountScope,
    projectId: cloudProjectId,
    isSignedIn: !!authSignedIn && isSyncFeatureEnabled && isCloudProjectCatalogReady,
    isLoaded: isAuthLoaded,
    accountSession,
    projectData,
    setProjectData,
    onError: handleCloudSyncError,
    onStatusChange: updateProjectSyncStatus,
    onRemoteReset: handleRemoteProjectReset,
    saveDebounceMs: 180
  });

  const handleExitProject = useCallback(async () => {
    await signOut();
  }, [signOut]);

  const handleDeleteFlowProject = useCallback(async (projectId: string) => {
    if (!isSyncFeatureEnabled) return;
    const resumeProjectSync = projectId === cloudProjectId ? suspendProjectSync() : null;
    let deleted = false;
    try {
      await deleteCloudProject(accountSession, projectId);
      resetStyloProjectAgentStorage(accountScope, projectId);
      await deleteRealtimeDocument(`${accountScope}:${projectId}`);
      deleted = true;
    } finally {
      if (resumeProjectSync) {
        if (deleted) window.setTimeout(resumeProjectSync, 0);
        else resumeProjectSync();
      }
    }
  }, [accountScope, accountSession, cloudProjectId, isSyncFeatureEnabled, suspendProjectSync]);

  useSecretsSync({
    accountScope,
    isSignedIn: !!authSignedIn && isSyncFeatureEnabled,
    isLoaded: isAuthLoaded,
    accountSession,
    config,
    setConfig,
    debounceMs: 1200,
    onStatusChange: updateSecretsSyncStatus,
  });

  // Fetch avatar from profile (account-scoped) once per session
  useEffect(() => {
    const fetchProfile = async () => {
      if (!authSignedIn || !isAuthLoaded || hasFetchedProfileAvatar.current) return;
      try {
        hasFetchedProfileAvatar.current = true;
        const res = await accountSession.request('/api/profile');
        if (res.ok) {
          const data = await parseJsonResponse<ProfileResponse>(res, '读取账户资料失败');
          if (typeof data.avatarUrl === 'string' && data.avatarUrl) setAvatarUrl(data.avatarUrl);
          if (!(typeof data.username === 'string' && data.username) && user?.username) {
            await accountSession.request('/api/profile', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                username: user.username,
              }),
            });
          }
        }
      } catch (e) {
        console.warn('Fetch profile avatar failed', e);
      }
    };
    fetchProfile();
  }, [accountSession, authSignedIn, isAuthLoaded, setAvatarUrl, user?.fullName, user?.username]);

  // --- Handlers ---

  const handleResetProject = async () => {
    if (window.confirm(`确认清空整个项目吗？\n\n这会清空本地与云端的项目数据（脚本、镜头、生成内容等），且不可恢复。`)) {
      const resumeProjectSync = suspendProjectSync();
      const resetProjectId = resolveStyloProjectId(projectDataRef.current);
      const emptyProject = normalizeProjectData(
        resetStyloScopedProjectData(
          projectDataRef.current,
          normalizeProjectData(structuredClone(INITIAL_PROJECT_DATA)),
          resetProjectId,
        ),
      );
      try {
        const response = await accountSession.request(`/api/account-data-reset?projectId=${encodeURIComponent(resetProjectId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: 'project' }),
        });
        await requireOkResponse(response, '清空云端项目失败');

        resetNodeFlowProjectState();
        resetStyloProjectAgentStorage(accountScope, resetProjectId);
        setProjectResetToken((token) => token + 1);
        projectDataRef.current = emptyProject;
        setProjectData(emptyProject);
        await deleteRealtimeDocument(`${accountScope}:${resetProjectId}`);

      } catch (error) {
        console.warn('Cloud project reset failed', error);
        window.alert(error instanceof Error ? error.message : '清空云端项目失败。');
      } finally {
        resumeProjectSync();
      }
    }
  };

  const handleAvatarUploadClick = () => {
    avatarFileInputRef.current?.click();
  };

  const uploadAvatarToSupabase = async (file: File) => {
    try {
      const safeName = file.name
        .normalize("NFKD")
        .replace(/[^\w.\-]+/g, "_")
        .toLowerCase();
      const payload = {
        fileName: `avatars/${Date.now()}-${safeName}`,
        bucket: 'public-assets',
        contentType: file.type,
        fileSize: file.size,
      };
      const res = await accountSession.request('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(`Upload URL error ${res.status}: ${message || 'unknown error'}`);
      }
      const data = await parseJsonResponse<UploadUrlResponse>(res, '读取上传地址失败');
      const signedUrl = typeof data.signedUrl === 'string' ? data.signedUrl : '';
      if (!signedUrl) throw new Error('No signedUrl returned');

      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file
      });
      if (!uploadRes.ok) {
        const txt = await uploadRes.text();
        throw new Error(`Upload failed ${uploadRes.status}: ${txt}`);
      }

      const publicUrl = typeof data.publicUrl === 'string' ? data.publicUrl : '';
      const path = typeof data.path === 'string' ? data.path : '';
      const storedUrl = publicUrl || path;
      if (!storedUrl) throw new Error('No public URL/path returned');
      setAvatarUrl(storedUrl);
      // Save to profile for multi-device sync
      try {
        await accountSession.request('/api/profile', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatarUrl: storedUrl })
        });
      } catch (e) {
        console.warn('Save profile avatar failed', e);
      }
      alert('头像已上传并应用（Supabase public-assets）');
    } catch (e: any) {
      alert(`上传头像失败: ${e.message || e}`);
    }
  };

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadAvatarToSupabase(file);
    e.target.value = '';
  };

  // --- Render Helpers ---
  const statusLabel = (status: SyncStatus) => {
    switch (status) {
      case "synced":
        return "已同步";
      case "syncing":
        return "同步中";
      case "loading":
        return "加载中";
      case "conflict":
        return "更新中";
      case "error":
        return "错误";
      case "offline":
        return "离线";
      case "disabled":
        return "未连接云端";
      case "idle":
      default:
        return "就绪";
    }
  };
  const aggregateSyncStatus = () => {
    if (!isOnline) return { state: "offline" as const, label: statusLabel("offline") };
    const statuses = [syncState.project.status, syncState.secrets.status].filter((s) => s !== "disabled");
    if (statuses.includes("error")) return { state: "error" as const, label: statusLabel("error") };
    if (statuses.includes("conflict")) return { state: "syncing" as const, label: statusLabel("syncing") };
    if (statuses.includes("syncing") || statuses.includes("loading")) return { state: "syncing" as const, label: statusLabel("syncing") };
    if (statuses.length === 0) return { state: "disabled" as const, label: statusLabel("disabled") };
    if (statuses.includes("idle")) return { state: "idle" as const, label: statusLabel("idle") };
    return { state: "synced" as const, label: statusLabel("synced") };
  };
  const syncIndicator = (() => {
    const agg = aggregateSyncStatus();
    const colorMap: Record<string, string> = {
      synced: "#34d399",
      syncing: "#38bdf8",
      loading: "#38bdf8",
      error: "#f87171",
      offline: "#9ca3af",
      disabled: "#9ca3af",
      idle: "#a5b4fc",
    };
    return { label: agg.label, color: colorMap[agg.state] || "#a5b4fc" };
  })();

  const handleLoadIdentityCard = useCallback((identityId: string) => {
    if (!identityId) return;
    setProjectData((prev) => {
      const flow: FlowState = {
        flowNodes: [],
        links: [],
        ...(prev.flow || {}),
      };
      const flowNodes = Array.isArray(flow.flowNodes) ? flow.flowNodes : [];
      const existing = flowNodes.find(
        (node) => (node.type === 'lookbook' || node.type === 'identityCard') && (node.data as any)?.identityId === identityId
      );
      if (existing) return prev;

      return {
        ...prev,
        flow: {
          ...flow,
          flowNodes: [
            ...flowNodes,
            {
              id: `identity-${identityId}`,
              type: 'lookbook',
              position: { x: 280, y: 180 },
              data: {
                identityId,
                title: (prev.roles || []).find((role) => role.id === identityId)?.displayName || 'Lookbook',
                avatarOverrides: {},
              },
            },
          ],
        },
      };
    });
  }, [setProjectData]);

  const renderMainContent = () => (
    <div className="h-full">
      <CreativeWorkspace
        accountScope={accountScope}
        projectData={projectData}
        setProjectData={setProjectData}
        config={config}
        setConfig={setConfig}
        isSignedIn={!!authSignedIn}
        getAuthToken={getAuthToken}
        accountSession={accountSession}
        syncState={syncState}
        ensureProjectSynced={flushProjectSync}
        externalProjectSettingsRequest={projectSettingsRequest}
        onOpenModule={handleOpenLabModule}
        syncIndicator={syncIndicator}
        onResetProject={handleResetProject}
        onDeleteFlowProject={handleDeleteFlowProject}
        projectResetToken={projectResetToken}
        onSignOut={handleExitProject}
        accountInfo={{
          isLoaded: isUserLoaded,
          isSignedIn: !!userSignedIn,
          name: user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress || "Stylo User",
          username: user?.username || undefined,
          email: user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress || undefined,
          avatarUrl: avatarUrl || user?.imageUrl || undefined,
          onSignIn: () => openSignIn(),
          onSignOut: handleExitProject,
          onUploadAvatar: handleAvatarUploadClick,
        }}
      />
    </div>
  );

  return (
    <>
      <AppShell
        isDarkMode={isDarkMode}
        header={null}
      >
        <input
          type="file"
          accept="image/*"
          ref={avatarFileInputRef}
          className="hidden"
          onChange={handleAvatarFileChange}
        />
        {renderMainContent()}
        <GlassEffectLab isOpen={openLabModal === "glassLab"} onClose={closeLabModal} />
        {openLabModal === "agentLab" ? (
          <React.Suspense fallback={null}>
            <AgentLab isOpen onClose={closeLabModal} />
          </React.Suspense>
        ) : null}
        {openLabModal === "cineworLab" ? (
          <React.Suspense fallback={null}>
            <CineworLab
              isOpen
              onClose={closeLabModal}
              projectData={projectData}
              setProjectData={setProjectData}
            />
          </React.Suspense>
        ) : null}
        {openLabModal === "designSystemLab" ? (
          <React.Suspense fallback={null}>
            <DesignSystemLab isOpen onClose={closeLabModal} />
          </React.Suspense>
        ) : null}
      </AppShell>
    </>
  );
};

const App: React.FC = () => {
  const { isSignedIn: userSignedIn, user, isLoaded: isUserLoaded } = useUser();
  const { isLoaded: isAuthLoaded, isSignedIn: authSignedIn, userId: authUserId } = useAuth();
  const { openSignIn } = useClerk();

  if (!isUserLoaded || !isAuthLoaded) return null;

  const userStateId = user?.id || null;
  const fullySignedOut = !userSignedIn && !authSignedIn && !userStateId && !authUserId;
  if (fullySignedOut) {
    return (
      <CloudAccountGate
        isConfigured={isClerkConfigured()}
        onSignIn={() => openSignIn()}
      />
    );
  }

  const identityIsConsistent = Boolean(
    userSignedIn &&
    authSignedIn &&
    userStateId &&
    authUserId &&
    userStateId === authUserId
  );
  if (!identityIsConsistent) return null;

  const accountScope: AccountScope = `user:${userStateId}`;
  return <OneTimeRealtimeResetGate accountScope={accountScope} />;
};

const OneTimeRealtimeResetGate: React.FC<{ accountScope: AccountScope }> = ({ accountScope }) => {
  const [ready, setReady] = useState(() => {
    try {
      return localStorage.getItem(REALTIME_RESET_MARKER) === 'done';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (ready) return;
    let active = true;
    void (async () => {
      try {
        const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
          .filter((key): key is string => Boolean(key));
        keys.forEach((key) => {
          if (
            PROJECT_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
            key === 'stylo_conversations_v1' ||
            key === 'stylo_messages_v1'
          ) {
            localStorage.removeItem(key);
          }
        });
        await resetRealtimeDocuments();
        localStorage.setItem(REALTIME_RESET_MARKER, 'done');
      } catch (error) {
        console.warn('One-time realtime project cache reset failed', error);
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => { active = false; };
  }, [ready]);

  return ready ? <ScopedApp key={accountScope} accountScope={accountScope} /> : null;
};

export default App;
