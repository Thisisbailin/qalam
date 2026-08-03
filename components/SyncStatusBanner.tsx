import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { SyncChannelState, SyncState } from "../types";

type Props = {
  syncState: SyncState;
  isSignedIn: boolean;
};

type VisibleSyncStatus = {
  key: string;
  label: string;
  tone: "activity" | "success" | "warning" | "error";
  title?: string;
};

const SUCCESS_VISIBLE_MS = 1600;
const CONNECTION_DELAY_MS = 240;

const compactError = (message?: string) => {
  const normalized = message?.replace(/\s+/g, " ").trim();
  if (!normalized) return "同步失败 · 更改仍保存在本机";
  if (/sourceHandle|targetHandle|连接端口/i.test(normalized)) {
    return "同步失败 · 节点连接数据异常";
  }
  if (/401|unauthori[sz]ed|登录|token/i.test(normalized)) {
    return "登录已过期 · 等待重新连接";
  }
  if (/network|fetch|socket|timeout|超时|网络/i.test(normalized)) {
    return "网络异常 · 等待重新同步";
  }
  const shortMessage = normalized.length > 34 ? `${normalized.slice(0, 34)}…` : normalized;
  return `同步失败 · ${shortMessage}`;
};

const resolveActiveStatus = (project: SyncChannelState): VisibleSyncStatus | null => {
  switch (project.status) {
    case "loading":
      return { key: "loading", label: "正在连接云端…", tone: "activity" };
    case "syncing": {
      const pendingOps = Math.max(0, project.pendingOps ?? 0);
      const retryCount = Math.max(0, project.retryCount ?? 0);
      if (pendingOps === 0) return null;
      if (retryCount > 0) {
        return {
          key: `retry-${retryCount}`,
          label: `正在重试同步 · 第 ${retryCount} 次`,
          tone: "warning",
        };
      }
      return {
        key: "syncing",
        label: pendingOps > 1
          ? `正在同步 ${Math.min(pendingOps, 99)} 项更改…`
          : "正在同步更改…",
        tone: "activity",
      };
    }
    case "conflict":
      return { key: "merging", label: "正在合并远端更改…", tone: "warning" };
    case "offline":
      return {
        key: "offline",
        label: (project.pendingOps ?? 0) > 0
          ? "当前离线 · 更改将在联网后同步"
          : "云端连接已中断",
        tone: "warning",
      };
    case "error":
      return {
        key: "error",
        label: compactError(project.lastError),
        tone: "error",
        title: project.lastError,
      };
    default:
      return null;
  }
};

export const SyncStatusBanner: React.FC<Props> = ({ syncState, isSignedIn }) => {
  const project = syncState.project;
  const reduceMotion = useReducedMotion();
  const [visibleStatus, setVisibleStatus] = useState<VisibleSyncStatus | null>(null);
  const hadVisibleActivityRef = useRef(false);

  useEffect(() => {
    if (!isSignedIn || project.status === "disabled" || project.status === "idle") {
      hadVisibleActivityRef.current = false;
      setVisibleStatus(null);
      return undefined;
    }

    if (project.status === "synced") {
      if (!hadVisibleActivityRef.current) {
        setVisibleStatus(null);
        return undefined;
      }
      hadVisibleActivityRef.current = false;
      setVisibleStatus({ key: "synced", label: "已保存到云端", tone: "success" });
      const timer = window.setTimeout(() => setVisibleStatus(null), SUCCESS_VISIBLE_MS);
      return () => window.clearTimeout(timer);
    }

    const nextStatus = resolveActiveStatus(project);
    if (!nextStatus) {
      setVisibleStatus(null);
      return undefined;
    }

    const show = () => {
      hadVisibleActivityRef.current = project.status === "syncing"
        || project.status === "conflict";
      setVisibleStatus(nextStatus);
    };

    // A quick initial handshake should not make the title flicker. User edits,
    // retries, offline state, and failures are reported immediately.
    if (project.status === "loading") {
      const timer = window.setTimeout(show, CONNECTION_DELAY_MS);
      return () => window.clearTimeout(timer);
    }

    show();
    return undefined;
  }, [isSignedIn, project.lastError, project.pendingOps, project.retryCount, project.status]);

  const isError = visibleStatus?.tone === "error";

  return (
    <span
      className="pointer-events-none inline-flex min-w-0 items-center"
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <AnimatePresence initial={false} mode="wait">
        {visibleStatus ? (
          <motion.span
            key={visibleStatus.key}
            data-sync-tone={visibleStatus.tone}
            title={visibleStatus.title}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -2 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-[min(44vw,360px)] truncate text-[10px] font-medium leading-none tracking-[0.015em] text-[var(--app-text-muted)] data-[sync-tone=error]:text-rose-500 data-[sync-tone=warning]:text-[var(--app-text-secondary)]"
          >
            {visibleStatus.label}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
};
