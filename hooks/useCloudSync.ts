import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ProjectData, SyncStatus } from "../types";
import type { AccountApiSession } from "../sync/authenticatedFetch";
import { createProjectSyncCodec } from "../sync/projectSyncAdapter";
import { mergeStyloScopedProjectData } from "../agents/runtime/projectScope";
import type { RealtimeSyncLease, SyncStatusDetail } from "../sync/realtimeSyncTypes";
import { RealtimeProjectSyncEngine } from "../sync/realtimeProjectSyncEngine";
import {
  subscribeProjectNodeGeometryMutations,
  subscribeProjectNodeTextMutations,
} from "../sync/projectMutationBus";

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
  const engineRef = useRef<{
    projectId: string;
    engine: RealtimeProjectSyncEngine;
  } | null>(null);
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
        if (engineRef.current?.engine === engine) {
          callbacksRef.current.onStatusChange?.(status, detail);
        }
      },
      onApplyRemote: (remote) => {
        // Project switches commit before passive-effect cleanup. A draining
        // socket from the previous project must never project into the newly
        // selected project render.
        if (engineRef.current?.engine !== engine) return;
        callbacksRef.current.setProjectData((local) => {
          const merged = mergeStyloScopedProjectData(local, remote, projectId);
          projectDataRef.current = merged;
          return merged;
        });
      },
      onError: (error) => {
        if (engineRef.current?.engine === engine) callbacksRef.current.onError?.(error);
      },
      onReset: (mode) => {
        if (engineRef.current?.engine === engine) callbacksRef.current.onRemoteReset?.(mode);
      },
    });
    const scopedEngine = { projectId, engine };
    engineRef.current = scopedEngine;
    const unsubscribeGeometryMutations = subscribeProjectNodeGeometryMutations((mutation) => {
      if (mutation.projectId === projectId) {
        engine.expectNodeGeometryMutation(mutation.patches, mutation.updatedAt);
      }
    });
    const unsubscribeTextMutations = subscribeProjectNodeTextMutations((mutation) => {
      if (mutation.projectId === projectId) engine.expectNodeTextMutation(mutation);
    });
    void engine.start(projectDataRef.current).catch((error) => {
      if (engineRef.current === scopedEngine && !isAbortError(error)) {
        callbacksRef.current.onError?.(error);
      }
    });

    return () => {
      if (engineRef.current === scopedEngine) engineRef.current = null;
      unsubscribeGeometryMutations();
      unsubscribeTextMutations();
      engine.dispose();
    };
  }, [accountScope, accountSession, isLoaded, isSignedIn, projectId, saveDebounceMs, sessionGeneration]);

  // Enter every committed local edit into Yjs before the browser can deliver a
  // WebSocket message that might otherwise replace the just-rendered state.
  // A passive effect left a real data-loss window between React commit and the
  // next task on the event loop.
  useLayoutEffect(() => {
    const scopedEngine = engineRef.current;
    // On a project switch React runs this layout effect before it disposes the
    // previous project's passive-effect session. Scope the write explicitly;
    // otherwise buildStyloScopedProjectData throws during the render commit
    // and React can lose the entire workspace to an error boundary/white page.
    if (!suspendedRef.current && scopedEngine?.projectId === projectId) {
      scopedEngine.engine.stage(projectData);
    }
  }, [projectData, projectId]);

  const flushProjectSync = useCallback<EnsureProjectSynced>(async (snapshot, expectedRevision) => {
    const scopedEngine = engineRef.current;
    if (!scopedEngine || scopedEngine.projectId !== projectId) {
      throw new Error("当前账户的实时项目会话尚未就绪，Agent 请求未发送。");
    }
    return scopedEngine.engine.acquire(snapshot, expectedRevision);
  }, [projectId]);

  const suspendProjectSync = useCallback((): ResumeProjectSync => {
    if (suspendedRef.current) throw new Error("项目同步会话已处于重置状态。");
    suspendedRef.current = true;
    const scopedEngine = engineRef.current;
    engineRef.current = null;
    scopedEngine?.engine.dispose();
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
