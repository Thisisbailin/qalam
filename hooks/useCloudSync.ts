import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectData, SyncStatus } from "../types";
import type { AccountApiSession } from "../sync/authenticatedFetch";
import { createProjectSyncCodec } from "../sync/projectSyncAdapter";
import { mergeStyloScopedProjectData } from "../agents/runtime/projectScope";
import type { RealtimeSyncLease, SyncStatusDetail } from "../sync/realtimeSyncTypes";
import { RealtimeProjectSyncEngine } from "../sync/realtimeProjectSyncEngine";
import { subscribeProjectNodeGeometryMutations } from "../sync/projectMutationBus";

type UseCloudSyncOptions = {
  accountScope: string;
  projectId: string;
  isSignedIn: boolean;
  isLoaded: boolean;
  accountSession: AccountApiSession;
  projectData: ProjectData;
  setProjectData: React.Dispatch<React.SetStateAction<ProjectData>>;
  onError?: (error: unknown) => void;
  saveDebounceMs?: number;
  onStatusChange?: (status: SyncStatus, detail?: SyncStatusDetail) => void;
  onRemoteReset?: (mode: "reset" | "delete") => void;
};

export type ProjectSyncLease = RealtimeSyncLease;
export type EnsureProjectSynced = (
  snapshot: ProjectData,
  expectedRevision: number,
) => Promise<ProjectSyncLease>;
export type ResumeProjectSync = () => void;

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

export const useCloudSync = ({
  accountScope,
  projectId,
  isSignedIn,
  isLoaded,
  accountSession,
  projectData,
  setProjectData,
  onError,
  saveDebounceMs = 180,
  onStatusChange,
  onRemoteReset,
}: UseCloudSyncOptions) => {
  const engineRef = useRef<RealtimeProjectSyncEngine | null>(null);
  const suspendedRef = useRef(false);
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const projectDataRef = useRef(projectData);
  const callbacksRef = useRef({ onError, onStatusChange, onRemoteReset, setProjectData });

  projectDataRef.current = projectData;
  callbacksRef.current = { onError, onStatusChange, onRemoteReset, setProjectData };

  useEffect(() => {
    if (!isSignedIn || !isLoaded || suspendedRef.current) {
      callbacksRef.current.onStatusChange?.("disabled", { pendingOps: 0, retryCount: 0 });
      return undefined;
    }

    const engine = new RealtimeProjectSyncEngine({
      accountScope,
      projectId,
      session: accountSession,
      codec: createProjectSyncCodec(projectId),
      debounceMs: saveDebounceMs,
      onStatusChange: (status, detail) => {
        if (engineRef.current === engine) {
          callbacksRef.current.onStatusChange?.(status, detail);
        }
      },
      onApplyRemote: (remote) => {
        callbacksRef.current.setProjectData((local) => {
          const merged = mergeStyloScopedProjectData(local, remote, projectId);
          projectDataRef.current = merged;
          return merged;
        });
      },
      onError: (error) => {
        if (engineRef.current === engine) callbacksRef.current.onError?.(error);
      },
      onReset: (mode) => {
        if (engineRef.current === engine) callbacksRef.current.onRemoteReset?.(mode);
      },
    });
    engineRef.current = engine;
    const unsubscribeMutations = subscribeProjectNodeGeometryMutations((mutation) => {
      if (mutation.projectId === projectId) {
        engine.expectNodeGeometryMutation(mutation.patches, mutation.updatedAt);
      }
    });
    void engine.start(projectDataRef.current).catch((error) => {
      if (!isAbortError(error)) callbacksRef.current.onError?.(error);
    });

    return () => {
      if (engineRef.current === engine) engineRef.current = null;
      unsubscribeMutations();
      engine.dispose();
    };
  }, [accountScope, accountSession, isLoaded, isSignedIn, projectId, saveDebounceMs, sessionGeneration]);

  useEffect(() => {
    if (!suspendedRef.current) engineRef.current?.stage(projectData);
  }, [projectData]);

  const flushProjectSync = useCallback<EnsureProjectSynced>(async (snapshot, expectedRevision) => {
    const engine = engineRef.current;
    if (!engine) throw new Error("当前账户的实时项目会话尚未就绪，Agent 请求未发送。");
    return engine.acquire(snapshot, expectedRevision);
  }, []);

  const suspendProjectSync = useCallback((): ResumeProjectSync => {
    if (suspendedRef.current) throw new Error("项目同步会话已处于重置状态。");
    suspendedRef.current = true;
    const engine = engineRef.current;
    engineRef.current = null;
    engine?.dispose();
    callbacksRef.current.onStatusChange?.("syncing", {
      pendingOps: 1,
      retryCount: 0,
      lastAttemptAt: Date.now(),
    });

    let resumed = false;
    return () => {
      if (resumed) return;
      resumed = true;
      suspendedRef.current = false;
      setSessionGeneration((generation) => generation + 1);
    };
  }, []);

  return { flushProjectSync, suspendProjectSync };
};
