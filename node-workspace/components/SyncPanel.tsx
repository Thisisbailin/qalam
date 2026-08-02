import React, { useEffect, useState } from "react";
import { AlertCircle, Cloud, Shield, Trash2 } from "lucide-react";
import type { AppConfig, SyncState } from "../../types";
import type { AccountApiSession } from "../../sync/authenticatedFetch";
import { parseJsonResponse } from "../../sync/authenticatedFetch";

type Props = {
  config: AppConfig;
  onConfigChange: (config: AppConfig) => void;
  isSignedIn?: boolean;
  accountSession?: AccountApiSession;
  syncState?: SyncState;
  onResetProject?: () => void;
  initialSection?: SyncSectionKey;
  activeSection?: SyncSectionKey;
  onActiveSectionChange?: (section: SyncSectionKey) => void;
  showSidebar?: boolean;
};

export type SyncSectionKey = "status" | "history";
type AuditEntry = {
  id: number;
  action: string;
  status: string;
  createdAt: number;
  detail: Record<string, unknown>;
};
type AuditResponse = {
  entries?: AuditEntry[];
};

const formatTime = (timestamp?: number) =>
  timestamp ? new Date(timestamp).toLocaleString() : "—";

const statusLabel = (status?: string) => {
  switch (status) {
    case "synced":
      return "Realtime connected";
    case "syncing":
      return "Saving changes";
    case "loading":
      return "Connecting";
    case "conflict":
      return "Applying updates";
    case "error":
      return "Connection interrupted";
    case "offline":
      return "Offline · changes queued";
    case "disabled":
      return "Not connected";
    case "idle":
    default:
      return "Ready";
  }
};

export const SyncPanel: React.FC<Props> = ({
  config,
  onConfigChange,
  isSignedIn,
  accountSession,
  syncState,
  onResetProject,
  initialSection = "status",
  activeSection,
  onActiveSectionChange,
  showSidebar = true,
}) => {
  const [internalActive, setInternalActive] = useState<SyncSectionKey>(initialSection);
  const active = activeSection ?? internalActive;
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);
  const [auditMessage, setAuditMessage] = useState<string | null>(null);

  const selectSection = (section: SyncSectionKey) => {
    if (activeSection === undefined) setInternalActive(section);
    onActiveSectionChange?.(section);
  };

  const fetchAuditLogs = async () => {
    if (!accountSession || !isSignedIn) {
      setAuditMessage("Sign in to view realtime activity.");
      return;
    }
    setIsLoadingAudit(true);
    setAuditMessage(null);
    try {
      const response = await accountSession.request("/api/sync-audit");
      if (!response.ok) throw new Error(`Failed to load activity (${response.status})`);
      const data = await parseJsonResponse<AuditResponse>(response, "Failed to load realtime activity");
      setAuditEntries(Array.isArray(data?.entries) ? data.entries : []);
    } catch (error) {
      setAuditMessage(error instanceof Error ? error.message : "Failed to load realtime activity.");
    } finally {
      setIsLoadingAudit(false);
    }
  };

  useEffect(() => {
    if (active === "history") void fetchAuditLogs();
  }, [active]);

  return (
    <div className="text-[var(--app-text-primary)]">
      <div className={`grid grid-cols-1 gap-6 ${showSidebar ? "lg:grid-cols-[220px_1fr]" : ""}`}>
        {showSidebar ? (
          <nav className="border-r border-[var(--app-border)] pr-5" aria-label="同步设置">
            {[
              { key: "status" as const, label: "Realtime & Keys", Icon: Shield },
              { key: "history" as const, label: "Realtime Activity", Icon: Cloud },
            ].map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => selectSection(key)}
                className={`flex w-full items-center gap-2 border-b px-1 py-3 text-left text-[11px] transition-colors ${
                  active === key
                    ? "border-[var(--app-text-primary)] text-[var(--app-text-primary)]"
                    : "border-[var(--app-border)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]"
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </nav>
        ) : null}

        <div className="space-y-6">
          {active === "status" ? (
            <>
              <section className="space-y-1 border-b border-[var(--app-border)] pb-5">
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                  Project collaboration
                </div>
                <div className="text-[15px] font-semibold tracking-[-0.02em]">
                  {statusLabel(syncState?.project.status)}
                </div>
                <p className="max-w-xl text-[11px] leading-5 text-[var(--app-text-secondary)]">
                  Project changes are sent when content changes and received instantly over the realtime connection.
                  Idle projects do not poll or repeatedly upload.
                </p>
                <div className="pt-2 text-[10px] text-[var(--app-text-muted)]">
                  Last acknowledgement {formatTime(syncState?.project.lastSyncAt)}
                  {(syncState?.project.pendingOps ?? 0) > 0
                    ? ` · ${syncState?.project.pendingOps} queued`
                    : ""}
                </div>
                {syncState?.project.status !== "synced" && syncState?.project.lastError ? (
                  <div className="max-w-xl pt-1 text-[10px] leading-4 text-rose-400">
                    {syncState.project.lastError}
                  </div>
                ) : null}
              </section>

              <section className="divide-y divide-[var(--app-border)] border-y border-[var(--app-border)]">
                {[
                  {
                    id: "rememberKeys",
                    label: "Store API keys locally",
                    description: "Keep keys in this browser.",
                    checked: Boolean(config.rememberApiKeys),
                    onChange: (checked: boolean) =>
                      onConfigChange({ ...config, rememberApiKeys: checked }),
                  },
                  {
                    id: "syncKeys",
                    label: "Sync API keys to account vault",
                    description: "Changed settings save in the background without a version-choice dialog.",
                    checked: Boolean(config.syncApiKeys),
                    onChange: (checked: boolean) =>
                      onConfigChange({ ...config, syncApiKeys: checked }),
                  },
                ].map((item) => (
                  <label key={item.id} htmlFor={item.id} className="flex items-center justify-between gap-5 py-4">
                    <span>
                      <span className="block text-[12px] font-medium">{item.label}</span>
                      <span className="mt-1 block text-[10px] text-[var(--app-text-secondary)]">
                        {item.description}
                      </span>
                    </span>
                    <input
                      id={item.id}
                      type="checkbox"
                      checked={item.checked}
                      onChange={(event) => item.onChange(event.target.checked)}
                      className="h-4 w-4 shrink-0 accent-emerald-500"
                    />
                  </label>
                ))}
              </section>

              <section className="flex items-start justify-between gap-5 border-b border-rose-400/30 pb-5">
                <div>
                  <div className="flex items-center gap-2 text-[12px] font-medium text-rose-400">
                    <Trash2 size={14} />
                    Reset current project
                  </div>
                  <p className="mt-1 text-[10px] leading-5 text-[var(--app-text-secondary)]">
                    Explicitly clears the current project on this device and in its realtime cloud room.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onResetProject}
                  className="shrink-0 border-b border-rose-400 px-1 py-1 text-[10px] font-medium text-rose-400 transition-colors hover:text-rose-300"
                >
                  Reset
                </button>
              </section>
            </>
          ) : (
            <section>
              <div className="flex items-end justify-between gap-4 border-b border-[var(--app-border)] pb-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                    Realtime activity
                  </div>
                  <div className="mt-1 text-[12px] text-[var(--app-text-secondary)]">
                    Operational history only — not selectable project versions.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void fetchAuditLogs()}
                  disabled={isLoadingAudit}
                  className="border-b border-[var(--app-border-strong)] px-1 py-1 text-[10px] text-[var(--app-text-secondary)] transition-colors hover:text-[var(--app-text-primary)] disabled:opacity-50"
                >
                  {isLoadingAudit ? "Loading…" : "Refresh"}
                </button>
              </div>

              {auditMessage ? (
                <div className="flex items-center gap-2 border-b border-rose-400/30 py-3 text-[10px] text-rose-400">
                  <AlertCircle size={12} />
                  {auditMessage}
                </div>
              ) : null}

              <div className="divide-y divide-[var(--app-border)]">
                {auditEntries.length === 0 && !isLoadingAudit ? (
                  <div className="py-5 text-[11px] text-[var(--app-text-secondary)]">No activity yet.</div>
                ) : (
                  auditEntries.map((entry) => (
                    <div key={entry.id} className="grid grid-cols-[1fr_auto] gap-4 py-3">
                      <div>
                        <div className="text-[11px] font-medium">
                          {entry.action} · {entry.status}
                        </div>
                        {Object.keys(entry.detail || {}).length > 0 ? (
                          <div className="mt-1 line-clamp-1 text-[9px] text-[var(--app-text-muted)]">
                            {JSON.stringify(entry.detail)}
                          </div>
                        ) : null}
                      </div>
                      <time className="text-[9px] text-[var(--app-text-muted)]">
                        {formatTime(entry.createdAt)}
                      </time>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
