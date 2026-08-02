import * as Y from "yjs";
import type { ProjectData, SyncStatus } from "../types";
import {
  applyProjectSnapshot,
  applyProjectNodeGeometryPatches,
  decodeUpdateBase64,
  encodeUpdateBase64,
  isProjectDocumentEmpty,
  readProjectSnapshot,
} from "../collaboration/yProjectDocument";
import { REALTIME_PROJECT_MAX_BYTES } from "../collaboration/realtimeLimits";
import type { AccountApiSession } from "./authenticatedFetch";
import type { RealtimeSyncLease, SyncCodec, SyncStatusDetail } from "./realtimeSyncTypes";
import {
  deleteRealtimeDocument,
  readRealtimeConfirmedDocument,
  readRealtimeDocument,
  readRealtimeDocumentEpoch,
  readRealtimeDocumentOutbox,
  writeRealtimeDocument,
  writeRealtimeDocumentEpoch,
  writeRealtimeDocumentOutbox,
  writeRealtimeDocumentState,
  type RealtimeStoredOutboxEntry,
} from "./realtimeDocumentStore";
import { mergeProjectSnapshotsAcrossEpoch } from "./projectThreeWayMerge";
import type { ProjectNodeGeometryPatch } from "./projectMutationBus";
import {
  isNodeGeometryOnlyProjectChange,
  patchProjectSyncSnapshotGeometry,
} from "./projectSyncAdapter";

const REALTIME_PROTOCOL = "stylo-realtime.v1";
const LOCAL_ORIGIN = Symbol("stylo-local-project");
const REMOTE_ORIGIN = Symbol("stylo-remote-project");
const PERSISTED_ORIGIN = Symbol("stylo-persisted-project");
const HEARTBEAT_INTERVAL_MS = 25_000;
const HEARTBEAT_TIMEOUT_MS = 12_000;

type ServerMessage = {
  type?: "sync" | "update" | "ack" | "error" | "reset";
  opId?: string;
  actorId?: string;
  serverSeq?: number;
  update?: string;
  stateVector?: string;
  error?: string;
  mode?: "reset" | "delete";
  epoch?: number;
  epochReason?: "rebase" | "reset";
};

type PendingAck = {
  update: Uint8Array;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (serverSeq: number) => void;
  reject: (error: Error) => void;
};

type RealtimeDocumentStore = {
  read(key: string): Promise<Uint8Array | null>;
  write(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  readEpoch?(key: string): Promise<number>;
  readConfirmed?(key: string): Promise<Uint8Array | null>;
  readOutbox?(key: string): Promise<RealtimeStoredOutboxEntry[]>;
  writeEpoch?(key: string, epoch: number): Promise<void>;
  writeOutbox?(key: string, entries: RealtimeStoredOutboxEntry[]): Promise<void>;
  writeState?(
    key: string,
    value: Uint8Array,
    epoch: number,
    confirmedValue?: Uint8Array,
  ): Promise<void>;
};

type Options = {
  accountScope: string;
  projectId: string;
  session: AccountApiSession;
  codec: SyncCodec<ProjectData>;
  onApplyRemote: (project: ProjectData) => void;
  onStatusChange?: (status: SyncStatus, detail?: SyncStatusDetail) => void;
  onError?: (error: unknown) => void;
  onReset?: (mode: "reset" | "delete") => void;
  debounceMs?: number;
  stageDebounceMs?: number;
  persistenceDebounceMs?: number;
  documentStore?: RealtimeDocumentStore;
};

const createId = () => globalThis.crypto.randomUUID();

export const areProjectDocumentsSemanticallyEqual = (
  left: Y.Doc,
  right: Y.Doc,
  codec: SyncCodec<ProjectData>,
) => {
  const leftEmpty = isProjectDocumentEmpty(left);
  const rightEmpty = isProjectDocumentEmpty(right);
  if (leftEmpty && rightEmpty) return true;
  if (leftEmpty !== rightEmpty) {
    const populated = leftEmpty ? right : left;
    const snapshot = codec.snapshot(
      readProjectSnapshot<ProjectData & Record<string, unknown>>(populated),
    );
    return codec.isEmpty(snapshot);
  }
  const leftSnapshot = codec.snapshot(
    readProjectSnapshot<ProjectData & Record<string, unknown>>(left),
  );
  const rightSnapshot = codec.snapshot(
    readProjectSnapshot<ProjectData & Record<string, unknown>>(right),
  );
  return codec.fingerprint(leftSnapshot) === codec.fingerprint(rightSnapshot);
};

export class RealtimeProjectSyncEngine {
  private doc = new Y.Doc();
  private confirmedDoc = new Y.Doc();
  private readonly actorId: string;
  private readonly storageKey: string;
  private socket: WebSocket | null = null;
  private disposed = false;
  private detached = false;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private ready = false;
  private serverSeq = 0;
  private epoch = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private stageApplyTimer: ReturnType<typeof setTimeout> | null = null;
  private stageTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private latestInput: ProjectData | null = null;
  private stagedLocalInput: ProjectData | null = null;
  private latestLocal: ProjectData | null = null;
  private latestLocalFingerprint: string | null = null;
  private latestLocalByteLength = 0;
  private expectedGeometryPatches: ProjectNodeGeometryPatch[] = [];
  private bootstrapLocalDirty = false;
  private bootstrapWithoutPersistedBase = false;
  private pendingOfflineUpdate: Uint8Array | null = null;
  private pendingOfflineOpId: string | null = null;
  private pendingAcks = new Map<string, PendingAck>();
  private persistDirty = false;
  private confirmedPersistDirty = false;
  private persistInFlight: Promise<void> | null = null;
  private outboxPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private outboxPersistDirty = false;
  private outboxPersistInFlight: Promise<void> | null = null;
  private lastLocalSend: Promise<number> | null = null;
  private readonly inFlightSends = new Set<Promise<number>>();
  private readonly documentStore: RealtimeDocumentStore;

  constructor(private readonly options: Options) {
    this.actorId = `${options.session.deviceId}:${createId()}`.slice(0, 180);
    this.storageKey = `${options.accountScope}:${options.projectId}`;
    this.documentStore = options.documentStore || {
      read: readRealtimeDocument,
      write: writeRealtimeDocument,
      delete: deleteRealtimeDocument,
      readEpoch: readRealtimeDocumentEpoch,
      readConfirmed: readRealtimeConfirmedDocument,
      readOutbox: readRealtimeDocumentOutbox,
      writeEpoch: writeRealtimeDocumentEpoch,
      writeOutbox: writeRealtimeDocumentOutbox,
      writeState: writeRealtimeDocumentState,
    };
    this.doc.on("update", this.handleDocumentUpdate);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
  }

  async start(local: ProjectData) {
    this.latestInput = local;
    const initialLocal = this.options.codec.snapshot(local);
    const initialFingerprint = this.options.codec.fingerprint(initialLocal);
    const initialByteLength = this.assertSnapshotCanSync(initialLocal);
    this.latestLocal = initialLocal;
    this.latestLocalFingerprint = initialFingerprint;
    this.latestLocalByteLength = initialByteLength;
    const [persisted, persistedEpoch, confirmed, recoveredOutbox] = await Promise.all([
      this.documentStore.read(this.storageKey).catch(() => null),
      this.documentStore.readEpoch?.(this.storageKey).catch(() => 0) ?? Promise.resolve(0),
      this.documentStore.readConfirmed?.(this.storageKey).catch(() => null) ?? Promise.resolve(null),
      this.documentStore.readOutbox?.(this.storageKey).catch(() => []) ?? Promise.resolve([]),
    ]);
    this.epoch = Number.isSafeInteger(persistedEpoch) && persistedEpoch >= 0 ? persistedEpoch : 0;
    if (persisted?.byteLength) Y.applyUpdate(this.doc, persisted, PERSISTED_ORIGIN);
    if (confirmed?.byteLength) {
      Y.applyUpdate(this.confirmedDoc, confirmed, PERSISTED_ORIGIN);
    }
    if (recoveredOutbox.length) {
      const recoveredUpdate = recoveredOutbox.length === 1
        ? recoveredOutbox[0].update
        : Y.mergeUpdates(recoveredOutbox.map((entry) => entry.update));
      Y.applyUpdate(this.doc, recoveredUpdate, PERSISTED_ORIGIN);
      this.pendingOfflineUpdate = recoveredUpdate;
      this.pendingOfflineOpId = recoveredOutbox.length === 1
        ? recoveredOutbox[0].opId
        : createId();
      this.bootstrapLocalDirty = true;
    }
    if (!isProjectDocumentEmpty(this.doc)) {
      const persistedProject = this.options.codec.snapshot(
        readProjectSnapshot<ProjectData & Record<string, unknown>>(this.doc),
      );
      const persistedFingerprint = this.options.codec.fingerprint(persistedProject);
      if (persistedFingerprint !== initialFingerprint) {
        if (recoveredOutbox.length) {
          // The outbox is an explicit record of edits that were accepted by
          // this client but not yet acknowledged by the server. It is newer
          // than a separately debounced localStorage snapshot even when an
          // action (for example geometry) did not advance the project revision.
          this.applyDocumentToApp();
        } else {
          const initialIsEmpty = this.options.codec.isEmpty(initialLocal);
          const persistedIsEmpty = this.options.codec.isEmpty(persistedProject);
          const initialRevision = this.options.codec.revision?.(initialLocal) ?? null;
          const persistedRevision = this.options.codec.revision?.(persistedProject) ?? null;
          const persistedIsNewer = initialIsEmpty && !persistedIsEmpty
            || (
              !persistedIsEmpty
              && initialRevision !== null
              && persistedRevision !== null
              && persistedRevision > initialRevision
            );
          if (persistedIsNewer) {
            this.applyDocumentToApp();
          } else {
            this.bootstrapLocalDirty = true;
            applyProjectSnapshot(
              this.doc,
              initialLocal as unknown as Record<string, unknown>,
              LOCAL_ORIGIN,
            );
          }
        }
      }
    } else if (!this.options.codec.isEmpty(initialLocal)) {
      // The primary local project store can survive while the Yjs checkpoint
      // store is unavailable or cleared. Defer reconciliation until the server
      // revision is known instead of silently discarding that local snapshot.
      this.bootstrapWithoutPersistedBase = true;
    }
    await this.connect();
  }

  stage(local: ProjectData) {
    if (this.disposed) return;
    if (local === this.latestInput && !this.stagedLocalInput) return;
    if (
      this.latestInput
      && this.latestLocal
      && this.expectedGeometryPatches.length
      && isNodeGeometryOnlyProjectChange(
        this.latestInput,
        local,
        this.options.projectId,
        this.expectedGeometryPatches,
      )
    ) {
      const nextProject = local.flowProjects?.find((project) => project.id === this.options.projectId);
      const patches = this.expectedGeometryPatches;
      this.expectedGeometryPatches = [];
      this.latestInput = local;
      this.latestLocal = patchProjectSyncSnapshotGeometry(
        this.latestLocal,
        local,
        this.options.projectId,
        patches,
      );
      this.latestLocalFingerprint = null;
      if (nextProject) {
        applyProjectNodeGeometryPatches(
          this.doc,
          this.options.projectId,
          patches,
          nextProject.updatedAt,
          LOCAL_ORIGIN,
        );
      }
      return;
    }
    this.expectedGeometryPatches = [];
    this.latestInput = local;
    this.stagedLocalInput = local;
    if (this.stageApplyTimer) clearTimeout(this.stageApplyTimer);
    this.stageApplyTimer = setTimeout(() => {
      this.stageApplyTimer = null;
      this.applyStagedLocal();
    }, this.options.stageDebounceMs ?? 48);
  }

  expectNodeGeometryMutation(patches: ProjectNodeGeometryPatch[], updatedAt: number) {
    const merged = new Map(this.expectedGeometryPatches.map((patch) => [patch.nodeId, patch]));
    patches.forEach((patch) => merged.set(patch.nodeId, patch));
    this.expectedGeometryPatches = Array.from(merged.values());
    // Apply the high-frequency action directly to the CRDT. The subsequent
    // normalized React snapshot remains the validation/fallback path, but the
    // network payload for a drag contains only the touched node geometry.
    applyProjectNodeGeometryPatches(
      this.doc,
      this.options.projectId,
      patches,
      updatedAt,
      LOCAL_ORIGIN,
    );
  }

  private applyStagedLocal() {
    const local = this.stagedLocalInput;
    this.stagedLocalInput = null;
    if (!local || this.disposed) return;
    const next = this.options.codec.snapshot(local);
    const nextByteLength = this.measureSnapshot(next);
    const validationError = this.snapshotSyncError(next, nextByteLength);
    if (validationError) {
      this.options.onStatusChange?.("error", {
        error: validationError.message,
        pendingOps: this.pendingOperationCount(),
        retryCount: this.reconnectAttempt,
      });
      this.options.onError?.(validationError);
      return;
    }
    const fingerprint = this.options.codec.fingerprint(next);
    if (fingerprint === this.latestLocalFingerprint) return;
    this.latestLocal = next;
    this.latestLocalFingerprint = fingerprint;
    this.latestLocalByteLength = nextByteLength;
    if (!this.ready) {
      this.bootstrapLocalDirty = true;
      // A real edit made while the socket is connecting is still an offline
      // edit: apply and checkpoint it immediately. The initial React effect is
      // filtered above by fingerprint, so it no longer creates a false upload.
      applyProjectSnapshot(
        this.doc,
        this.latestLocal as unknown as Record<string, unknown>,
        LOCAL_ORIGIN,
      );
      return;
    }
    applyProjectSnapshot(
      this.doc,
      this.latestLocal as unknown as Record<string, unknown>,
      LOCAL_ORIGIN,
    );
  }

  async acquire(local: ProjectData, expectedRevision: number): Promise<RealtimeSyncLease> {
    const snapshot = this.options.codec.snapshot(local);
    this.assertSnapshotCanSync(snapshot);
    const revision = this.options.codec.revision?.(snapshot) ?? null;
    if (revision !== expectedRevision) {
      throw new Error(`实时项目修订 ${revision ?? "missing"} 与 Agent 请求 ${expectedRevision} 不一致。`);
    }
    const receipt = await this.applyAndWait(snapshot);
    return { expectedRevision, remoteVersion: receipt, release: () => undefined };
  }

  dispose() {
    if (this.disposed || this.detached) return;
    if (this.stageApplyTimer) {
      clearTimeout(this.stageApplyTimer);
      this.stageApplyTimer = null;
      this.applyStagedLocal();
    }
    this.detached = true;
    if (this.stageTimer) clearTimeout(this.stageTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.clearHeartbeat();
    this.stageTimer = null;
    this.reconnectTimer = null;
    this.drainTimer = setTimeout(() => this.finalizeDispose(), 8_000);
    (this.drainTimer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
    if (this.ready && this.socket?.readyState === WebSocket.OPEN) {
      const drain = this.flushPendingUpdate();
      void drain.finally(() => {
        if (this.pendingOperationCount() === 0) this.finalizeDispose();
      });
    }
  }

  private finalizeDispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    if (this.drainTimer) clearTimeout(this.drainTimer);
    if (this.persistTimer) clearTimeout(this.persistTimer);
    if (this.outboxPersistTimer) clearTimeout(this.outboxPersistTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.drainTimer = null;
    this.persistTimer = null;
    this.outboxPersistTimer = null;
    this.reconnectTimer = null;
    if (this.persistDirty) void this.flushDocumentPersistence();
    if (this.outboxPersistDirty) void this.flushOutboxPersistence();
    this.socket?.close(1000, "Project sync disposed");
    this.socket = null;
    this.pendingAcks.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error("实时项目同步已停止。"));
    });
    this.pendingAcks.clear();
    this.doc.off("update", this.handleDocumentUpdate);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
    this.confirmedDoc.destroy();
  }

  private async connect() {
    if (this.disposed) return;
    this.options.onStatusChange?.("loading", { pendingOps: this.pendingOperationCount() });
    try {
      const socket = await this.options.session.openWebSocket(
        `/api/project-realtime?projectId=${encodeURIComponent(this.options.projectId)}`,
        REALTIME_PROTOCOL,
      );
      if (this.disposed) {
        socket.close();
        return;
      }
      const superseded = this.socket;
      this.socket = socket;
      if (superseded && superseded !== socket) {
        superseded.onmessage = null;
        superseded.onclose = null;
        superseded.onerror = null;
        this.requeuePendingAcks(new Error("实时连接已替换，未确认的更改将在新连接重发。"));
        try {
          superseded.close(1000, "Realtime connection superseded");
        } catch {
          // The previous transport is already gone.
        }
      }
      socket.onmessage = (event) => {
        if (this.socket !== socket) return;
        this.handleSocketMessage(event);
      };
      socket.onclose = (event) => {
        // A superseded socket can finish its close handshake after a newer
        // connection has already become active. It must never demote or drain
        // the current connection's state.
        if (this.socket !== socket) return;
        this.socket = null;
        this.ready = false;
        this.clearHeartbeat();
        this.requeuePendingAcks(new Error("实时连接已中断，未确认的更改将在重连后重发。"));
        this.options.onStatusChange?.("offline", {
          error: `Realtime connection closed (${event.code}${event.reason ? `: ${event.reason}` : ""}).`,
          pendingOps: this.pendingOperationCount(),
          retryCount: this.reconnectAttempt,
          lastAttemptAt: Date.now(),
        });
        if (!this.disposed) this.reconnect();
      };
      socket.onerror = () => {
        if (this.socket !== socket) return;
        if (isProjectDocumentEmpty(this.doc) && this.latestLocal) {
          applyProjectSnapshot(this.doc, this.latestLocal as unknown as Record<string, unknown>, LOCAL_ORIGIN);
        }
      };
    } catch (error) {
      if (isProjectDocumentEmpty(this.doc) && this.latestLocal) {
        applyProjectSnapshot(this.doc, this.latestLocal as unknown as Record<string, unknown>, LOCAL_ORIGIN);
      }
      this.options.onError?.(error);
      this.reconnect();
    }
  }

  private reconnect() {
    if (this.disposed || this.reconnectTimer) return;
    const delay = Math.min(1_000 * (2 ** this.reconnectAttempt), 15_000);
    this.reconnectAttempt += 1;
    this.options.onStatusChange?.("offline", {
      pendingOps: this.pendingOperationCount(),
      retryCount: this.reconnectAttempt,
      lastAttemptAt: Date.now(),
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private handleSocketMessage(event: MessageEvent) {
    if (typeof event.data !== "string") return;
    if (event.data === "pong") {
      if (this.heartbeatDeadlineTimer) clearTimeout(this.heartbeatDeadlineTimer);
      this.heartbeatDeadlineTimer = null;
      this.scheduleHeartbeat();
      return;
    }
    let message: ServerMessage;
    try {
      message = JSON.parse(event.data) as ServerMessage;
    } catch {
      return;
    }
    if ((message.type === "sync" || message.type === "update") && typeof message.update === "string") {
      // React has committed the visible edit and stage() has captured it, but
      // the normal snapshot conversion may still be inside its short debounce.
      // Materialize it before applying a remote operation so a whole-project
      // UI projection can never erase that just-committed local edit.
      if (this.stageApplyTimer) {
        clearTimeout(this.stageApplyTimer);
        this.stageApplyTimer = null;
        this.applyStagedLocal();
      }
      let remoteUpdate: Uint8Array;
      const serverDoc = message.type === "sync" ? new Y.Doc() : null;
      const serverEpoch = Number(message.epoch);
      const epochChanged = message.type === "sync"
        && Number.isSafeInteger(serverEpoch)
        && serverEpoch !== this.epoch;
      try {
        remoteUpdate = decodeUpdateBase64(message.update);
        if (serverDoc) Y.applyUpdate(serverDoc, remoteUpdate, REMOTE_ORIGIN);
        if (epochChanged) {
          const hadLocalChanges = Boolean(
            this.pendingOfflineUpdate
            || this.pendingAcks.size
            || this.bootstrapLocalDirty
            || this.bootstrapWithoutPersistedBase
          );
          const oldLocal = hadLocalChanges && !isProjectDocumentEmpty(this.doc)
            ? this.options.codec.snapshot(
              readProjectSnapshot<ProjectData & Record<string, unknown>>(this.doc),
            )
            : null;
          const oldConfirmed = hadLocalChanges && !isProjectDocumentEmpty(this.confirmedDoc)
            ? this.options.codec.snapshot(
              readProjectSnapshot<ProjectData & Record<string, unknown>>(this.confirmedDoc),
            )
            : null;
          this.pendingOfflineUpdate = null;
          this.pendingOfflineOpId = null;
          this.discardPendingAcks(new Error("项目实时文档已进入新的同步世代。"));
          this.replaceDocument(remoteUpdate);
          this.replaceConfirmedDocument(remoteUpdate);
          this.epoch = serverEpoch;
          this.bootstrapLocalDirty = false;
          this.bootstrapWithoutPersistedBase = false;
          const resetGeneration = message.epochReason === "reset"
            || Boolean(serverDoc && isProjectDocumentEmpty(serverDoc));
          if (resetGeneration) {
            this.latestLocal = null;
            this.latestLocalFingerprint = null;
            this.options.onReset?.("reset");
          } else if (serverDoc && oldLocal && hadLocalChanges) {
            const remote = this.options.codec.snapshot(
              readProjectSnapshot<ProjectData & Record<string, unknown>>(serverDoc),
            );
            const rebased = mergeProjectSnapshotsAcrossEpoch(
              oldConfirmed || remote,
              oldLocal,
              remote,
            );
            this.latestLocal = rebased;
            this.latestLocalFingerprint = this.options.codec.fingerprint(rebased);
            this.latestLocalByteLength = this.measureSnapshot(rebased);
            applyProjectSnapshot(
              this.doc,
              rebased as unknown as Record<string, unknown>,
              LOCAL_ORIGIN,
            );
          }
        } else {
          Y.applyUpdate(this.doc, remoteUpdate, REMOTE_ORIGIN);
          if (message.type === "sync") this.replaceConfirmedDocument(remoteUpdate);
          else {
            Y.applyUpdate(this.confirmedDoc, remoteUpdate, REMOTE_ORIGIN);
            this.confirmedPersistDirty = true;
            this.scheduleDocumentPersistence();
          }
        }
      } catch (cause) {
        serverDoc?.destroy();
        this.handleProtocolError("云端返回了无法解析的实时项目数据。", cause);
        return;
      }
      this.serverSeq = epochChanged
        ? Number(message.serverSeq) || 0
        : Math.max(this.serverSeq, Number(message.serverSeq) || 0);
      if (message.type === "sync") {
        this.ready = true;
        this.reconnectAttempt = 0;
        this.scheduleHeartbeat();
        const serverProject = serverDoc && !isProjectDocumentEmpty(serverDoc)
          ? this.options.codec.snapshot(
            readProjectSnapshot<ProjectData & Record<string, unknown>>(serverDoc),
          )
          : null;
        const localRevision = this.latestLocal
          ? this.options.codec.revision?.(this.latestLocal) ?? null
          : null;
        const serverRevision = serverProject
          ? this.options.codec.revision?.(serverProject) ?? null
          : null;
        const restoreUncheckpointedLocal = this.bootstrapWithoutPersistedBase
          && this.latestLocal
          && (
            !serverProject
            || (
              localRevision !== null
              && serverRevision !== null
              && localRevision > serverRevision
            )
          );
        if ((isProjectDocumentEmpty(this.doc) || restoreUncheckpointedLocal) && this.latestLocal) {
          applyProjectSnapshot(this.doc, this.latestLocal as unknown as Record<string, unknown>, LOCAL_ORIGIN);
        }
        // A visible local snapshot staged before the handshake has already
        // produced field-level Yjs operations against the persisted base.
        // Re-applying the full snapshot here would overwrite unrelated edits
        // that arrived from another client in this server sync.
        this.bootstrapLocalDirty = false;
        this.bootstrapWithoutPersistedBase = false;
      }
      this.applyDocumentToApp();
      if (message.type === "sync" && serverDoc) {
        let serverStateVector: Uint8Array;
        try {
          serverStateVector = typeof message.stateVector === "string"
            ? decodeUpdateBase64(message.stateVector)
            : Y.encodeStateVector(serverDoc);
        } catch (cause) {
          serverDoc.destroy();
          this.handleProtocolError("云端返回了无法解析的实时同步状态。", cause);
          return;
        }
        if (this.hasSemanticDifferenceFrom(serverDoc)) {
          if (!this.pendingRetryRecreatesLocalProject(serverDoc)) {
            this.queueUpdate(Y.encodeStateAsUpdate(this.doc, serverStateVector));
          }
        } else if (this.pendingAcks.size === 0) {
          // State vectors also contain CRDT client history. A persisted local
          // document can therefore have a non-empty structural delta even when
          // its materialized project is byte-for-byte equivalent to the server.
          // Do not upload that history as an authored project change.
          this.pendingOfflineUpdate = null;
          this.pendingOfflineOpId = null;
          this.scheduleOutboxPersistence();
        }
        serverDoc.destroy();
        if (this.stageTimer) {
          clearTimeout(this.stageTimer);
          this.stageTimer = null;
        }
        const hadPendingUpdate = Boolean(this.pendingOfflineUpdate);
        void this.flushPendingUpdate().catch((error) => this.options.onError?.(error));
        if (!hadPendingUpdate) {
          this.options.onStatusChange?.("synced", {
            lastSyncAt: Date.now(),
            pendingOps: 0,
            retryCount: 0,
          });
        }
        if (this.detached && this.pendingOperationCount() === 0) {
          this.finalizeDispose();
        }
      }
      return;
    }
    if (message.type === "reset") {
      if (this.stageTimer) {
        clearTimeout(this.stageTimer);
        this.stageTimer = null;
      }
      this.pendingOfflineUpdate = null;
      this.pendingOfflineOpId = null;
      this.discardPendingAcks(new Error("项目已在另一台设备重置。"));
      this.pendingOfflineUpdate = null;
      this.pendingOfflineOpId = null;
      this.scheduleOutboxPersistence();
      this.replaceDocument(new Uint8Array());
      this.replaceConfirmedDocument(new Uint8Array());
      if (Number.isSafeInteger(Number(message.epoch))) {
        this.epoch = Number(message.epoch);
      }
      this.serverSeq = Number(message.serverSeq) || 0;
      this.latestLocal = null;
      void this.documentStore.delete(this.storageKey).catch(() => undefined);
      this.options.onReset?.(message.mode === "delete" ? "delete" : "reset");
      this.options.onStatusChange?.("synced", {
        lastSyncAt: Date.now(),
        pendingOps: 0,
        retryCount: 0,
      });
      return;
    }
    if (message.type === "ack" && message.opId) {
      const pending = this.pendingAcks.get(message.opId);
      if (!pending) return;
      this.pendingAcks.delete(message.opId);
      clearTimeout(pending.timeout);
      Y.applyUpdate(this.confirmedDoc, pending.update, REMOTE_ORIGIN);
      this.confirmedPersistDirty = true;
      this.scheduleDocumentPersistence();
      this.scheduleOutboxPersistence();
      this.serverSeq = Math.max(this.serverSeq, Number(message.serverSeq) || 0);
      pending.resolve(this.serverSeq);
      if (this.pendingOfflineUpdate && !this.stageTimer) {
        this.lastLocalSend = this.flushPendingUpdate();
        void this.lastLocalSend.catch((error) => this.options.onError?.(error));
      }
      if (this.pendingOperationCount() === 0) {
        this.options.onStatusChange?.("synced", {
          lastSyncAt: Date.now(),
          pendingOps: 0,
          retryCount: 0,
        });
        if (this.detached) this.finalizeDispose();
      }
      return;
    }
    if (message.type === "error") {
      const error = new Error(message.error || "实时项目同步失败。");
      if (message.opId) {
        const pending = this.pendingAcks.get(message.opId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingAcks.delete(message.opId);
          this.queueUpdate(pending.update, message.opId);
          pending.reject(error);
        }
      }
      this.options.onStatusChange?.("error", {
        error: error.message,
        pendingOps: this.pendingOperationCount(),
        retryCount: this.reconnectAttempt,
      });
      this.options.onError?.(error);
      this.ready = false;
      this.socket?.close(1011, "Realtime update rejected");
    }
  }

  private handleProtocolError(message: string, cause: unknown) {
    const error = cause instanceof Error
      ? new Error(message, { cause })
      : new Error(message);
    this.options.onStatusChange?.("error", {
      error: error.message,
      pendingOps: this.pendingOperationCount(),
      retryCount: this.reconnectAttempt,
    });
    this.options.onError?.(error);
    this.ready = false;
    this.socket?.close(1002, "Invalid realtime protocol payload");
  }

  private readonly handleVisibilityChange = () => {
    if (typeof document === "undefined" || document.visibilityState !== "visible") return;
    if (!this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.clearHeartbeat();
    this.sendHeartbeat();
  };

  private clearHeartbeat() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (this.heartbeatDeadlineTimer) clearTimeout(this.heartbeatDeadlineTimer);
    this.heartbeatTimer = null;
    this.heartbeatDeadlineTimer = null;
  }

  private scheduleHeartbeat() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        this.scheduleHeartbeat();
        return;
      }
      this.sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private sendHeartbeat() {
    if (!this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    try {
      this.socket.send("ping");
    } catch {
      this.socket.close(4000, "Realtime heartbeat send failed");
      return;
    }
    if (this.heartbeatDeadlineTimer) clearTimeout(this.heartbeatDeadlineTimer);
    this.heartbeatDeadlineTimer = setTimeout(() => {
      this.heartbeatDeadlineTimer = null;
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.close(4000, "Realtime heartbeat timeout");
      }
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private readonly handleDocumentUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === PERSISTED_ORIGIN) return;
    this.scheduleDocumentPersistence();
    if (origin === REMOTE_ORIGIN) return;
    this.queueUpdate(update);
    if (this.stageTimer) clearTimeout(this.stageTimer);
    this.stageTimer = setTimeout(() => {
      this.stageTimer = null;
      this.lastLocalSend = this.flushPendingUpdate();
      void this.lastLocalSend.catch((error) => this.options.onError?.(error));
    }, this.options.debounceMs ?? 180);
  };

  private queueUpdate(update: Uint8Array, retryOpId: string | null = null) {
    // Yjs encodes an empty update as two bytes. Do not turn a connection
    // handshake or a semantically unchanged React render into a network write.
    if (update.byteLength <= 2) return;
    if (this.pendingOfflineUpdate) {
      this.pendingOfflineUpdate = Y.mergeUpdates([this.pendingOfflineUpdate, update]);
      // Once separately identified operations are merged, the result needs a
      // new id because a server may have persisted only part of the merge.
      this.pendingOfflineOpId = createId();
    } else {
      this.pendingOfflineUpdate = update;
      this.pendingOfflineOpId = retryOpId || createId();
    }
    this.scheduleOutboxPersistence();
    if (!this.ready || this.socket?.readyState !== WebSocket.OPEN) {
      this.options.onStatusChange?.("offline", {
        pendingOps: this.pendingOperationCount(),
        retryCount: this.reconnectAttempt,
      });
    }
  }

  private async flushPendingUpdate() {
    if (!this.pendingOfflineUpdate) return Promise.resolve(this.serverSeq);
    // Keep one authoritative operation in flight. This makes the durable
    // client outbox a simple ordered boundary and prevents ACK reordering from
    // clearing newer edits.
    if (this.pendingAcks.size > 0) return this.lastLocalSend || this.serverSeq;
    if (!this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return this.serverSeq;
    }
    const update = this.pendingOfflineUpdate;
    const opId = this.pendingOfflineOpId || createId();
    // A server ACK must never be the only surviving copy of an edit. Persist
    // the operation locally before putting it on the wire.
    await this.flushOutboxPersistence();
    if (!this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return this.serverSeq;
    }
    this.pendingOfflineUpdate = null;
    this.pendingOfflineOpId = null;
    return this.sendUpdate(update, opId);
  }

  private sendUpdate(update: Uint8Array, retryOpId: string | null = null) {
    if (!this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.queueUpdate(update, retryOpId);
      return Promise.resolve(this.serverSeq);
    }
    const opId = retryOpId || createId();
    const promise = new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pendingAcks.get(opId);
        if (!pending) return;
        this.pendingAcks.delete(opId);
        this.queueUpdate(pending.update, opId);
        const error = new Error("实时项目写入确认超时，更改将在重连后重发。");
        pending.reject(error);
        this.options.onStatusChange?.("error", {
          error: error.message,
          pendingOps: this.pendingOperationCount(),
          retryCount: this.reconnectAttempt,
        });
        this.socket?.close(1012, "Realtime acknowledgement timeout");
      }, 15_000);
      this.pendingAcks.set(opId, { update, timeout, resolve, reject });
    });
    this.scheduleOutboxPersistence();
    this.inFlightSends.add(promise);
    void promise.then(
      () => this.inFlightSends.delete(promise),
      () => this.inFlightSends.delete(promise),
    );
    try {
      this.socket.send(JSON.stringify({
        type: "update",
        actorId: this.actorId,
        opId,
        update: encodeUpdateBase64(update),
        projectBytes: this.latestLocalByteLength,
        epoch: this.epoch,
      }));
    } catch (cause) {
      const pending = this.pendingAcks.get(opId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingAcks.delete(opId);
        this.queueUpdate(pending.update, opId);
        pending.reject(cause instanceof Error ? cause : new Error("实时项目更新发送失败。"));
      }
      this.ready = false;
      this.socket?.close(1011, "Realtime update send failed");
      return promise;
    }
    this.options.onStatusChange?.("syncing", {
      pendingOps: this.pendingOperationCount(),
      retryCount: 0,
      lastAttemptAt: Date.now(),
    });
    return promise;
  }

  private requeuePendingAcks(error: Error) {
    if (!this.pendingAcks.size) return;
    const pending = Array.from(this.pendingAcks.entries());
    this.pendingAcks.clear();
    pending.forEach(([opId, entry]) => {
      clearTimeout(entry.timeout);
      this.queueUpdate(entry.update, opId);
      entry.reject(error);
    });
  }

  private discardPendingAcks(error: Error) {
    if (!this.pendingAcks.size) return;
    const pending = Array.from(this.pendingAcks.values());
    this.pendingAcks.clear();
    pending.forEach((entry) => {
      clearTimeout(entry.timeout);
      entry.reject(error);
    });
    this.scheduleOutboxPersistence();
  }

  private pendingOperationCount() {
    return this.pendingAcks.size + (this.pendingOfflineUpdate ? 1 : 0);
  }

  private currentOutboxEntries(): RealtimeStoredOutboxEntry[] {
    const entries = Array.from(this.pendingAcks.entries()).map(([opId, pending]) => ({
      opId,
      update: pending.update,
    }));
    if (this.pendingOfflineUpdate) {
      if (!this.pendingOfflineOpId) this.pendingOfflineOpId = createId();
      entries.push({
        opId: this.pendingOfflineOpId,
        update: this.pendingOfflineUpdate,
      });
    }
    return entries;
  }

  private scheduleOutboxPersistence() {
    if (!this.documentStore.writeOutbox) return;
    this.outboxPersistDirty = true;
    if (this.outboxPersistTimer) return;
    this.outboxPersistTimer = setTimeout(() => {
      this.outboxPersistTimer = null;
      void this.flushOutboxPersistence().catch((error) => {
        this.options.onError?.(error);
      });
    }, 32);
  }

  private async flushOutboxPersistence(): Promise<void> {
    if (!this.documentStore.writeOutbox) return;
    if (this.outboxPersistTimer) {
      clearTimeout(this.outboxPersistTimer);
      this.outboxPersistTimer = null;
    }
    if (this.outboxPersistInFlight) await this.outboxPersistInFlight;
    while (this.outboxPersistDirty) {
      this.outboxPersistDirty = false;
      const entries = this.currentOutboxEntries();
      const task = this.documentStore.writeOutbox(this.storageKey, entries);
      this.outboxPersistInFlight = task;
      try {
        await task;
      } catch (cause) {
        this.outboxPersistDirty = true;
        const error = cause instanceof Error
          ? new Error("无法持久化实时项目待发更改，已暂停网络发送。", { cause })
          : new Error("无法持久化实时项目待发更改，已暂停网络发送。");
        this.options.onStatusChange?.("error", {
          error: error.message,
          pendingOps: this.pendingOperationCount(),
          retryCount: this.reconnectAttempt,
        });
        throw error;
      } finally {
        if (this.outboxPersistInFlight === task) this.outboxPersistInFlight = null;
      }
    }
  }

  private hasSemanticDifferenceFrom(serverDoc: Y.Doc) {
    return !areProjectDocumentsSemanticallyEqual(this.doc, serverDoc, this.options.codec);
  }

  private pendingRetryRecreatesLocalProject(serverDoc: Y.Doc) {
    if (!this.pendingOfflineUpdate || !this.pendingOfflineOpId) return false;
    const candidate = new Y.Doc();
    try {
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(serverDoc), REMOTE_ORIGIN);
      Y.applyUpdate(candidate, this.pendingOfflineUpdate, LOCAL_ORIGIN);
      return areProjectDocumentsSemanticallyEqual(
        candidate,
        this.doc,
        this.options.codec,
      );
    } catch {
      return false;
    } finally {
      candidate.destroy();
    }
  }

  private scheduleDocumentPersistence() {
    this.persistDirty = true;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.flushDocumentPersistence();
    }, this.options.persistenceDebounceMs ?? 240);
  }

  private replaceDocument(update: Uint8Array) {
    this.doc.off("update", this.handleDocumentUpdate);
    this.doc.destroy();
    this.doc = new Y.Doc();
    this.doc.on("update", this.handleDocumentUpdate);
    if (update.byteLength) Y.applyUpdate(this.doc, update, REMOTE_ORIGIN);
    this.scheduleDocumentPersistence();
  }

  private replaceConfirmedDocument(update: Uint8Array) {
    this.confirmedDoc.destroy();
    this.confirmedDoc = new Y.Doc();
    if (update.byteLength) Y.applyUpdate(this.confirmedDoc, update, REMOTE_ORIGIN);
    this.confirmedPersistDirty = true;
    this.scheduleDocumentPersistence();
  }

  private flushDocumentPersistence(): Promise<void> {
    if (this.persistInFlight) return this.persistInFlight;
    if (!this.persistDirty) return Promise.resolve();
    this.persistDirty = false;
    const persistConfirmed = this.confirmedPersistDirty;
    this.confirmedPersistDirty = false;
    const checkpoint = Y.encodeStateAsUpdate(this.doc);
    const confirmedCheckpoint = persistConfirmed
      ? Y.encodeStateAsUpdate(this.confirmedDoc)
      : undefined;
    const task = (
      this.documentStore.writeState
        ? this.documentStore.writeState(
          this.storageKey,
          checkpoint,
          this.epoch,
          confirmedCheckpoint,
        )
        : this.documentStore.write(this.storageKey, checkpoint).then(() =>
            this.documentStore.writeEpoch?.(this.storageKey, this.epoch))
    ).catch(() => {
      this.persistDirty = true;
      if (persistConfirmed) this.confirmedPersistDirty = true;
    });
    this.persistInFlight = task;
    void task.finally(() => {
      if (this.persistInFlight === task) this.persistInFlight = null;
      if (!this.persistDirty || this.disposed) return;
      this.scheduleDocumentPersistence();
    });
    return task;
  }

  private async applyAndWait(snapshot: ProjectData) {
    if (!this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("实时项目连接尚未就绪，Agent 请求未发送。");
    }
    if (this.stageApplyTimer) {
      clearTimeout(this.stageApplyTimer);
      this.stageApplyTimer = null;
    }
    this.stagedLocalInput = null;
    this.latestInput = snapshot;
    this.latestLocal = snapshot;
    this.latestLocalFingerprint = this.options.codec.fingerprint(snapshot);
    this.latestLocalByteLength = this.measureSnapshot(snapshot);
    if (this.stageTimer) {
      clearTimeout(this.stageTimer);
      this.stageTimer = null;
    }
    applyProjectSnapshot(this.doc, snapshot as unknown as Record<string, unknown>, LOCAL_ORIGIN);
    if (this.stageTimer) {
      clearTimeout(this.stageTimer);
      this.stageTimer = null;
    }
    this.lastLocalSend = this.flushPendingUpdate();
    const sendsAtBoundary = Array.from(this.inFlightSends);
    if (!sendsAtBoundary.length) return this.serverSeq;
    const receipts = await Promise.all(sendsAtBoundary);
    return Math.max(this.serverSeq, ...receipts);
  }

  private applyDocumentToApp() {
    if (isProjectDocumentEmpty(this.doc)) return;
    const candidate = readProjectSnapshot<ProjectData & Record<string, unknown>>(this.doc);
    const snapshot = this.options.codec.snapshot(candidate);
    this.latestInput = snapshot;
    this.latestLocal = snapshot;
    this.latestLocalFingerprint = this.options.codec.fingerprint(snapshot);
    this.latestLocalByteLength = this.measureSnapshot(snapshot);
    if (!this.detached) this.options.onApplyRemote(snapshot);
  }

  private measureSnapshot(snapshot: ProjectData) {
    if (this.options.codec.byteLength) return this.options.codec.byteLength(snapshot);
    return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
  }

  private snapshotSyncError(snapshot: ProjectData, byteLength = this.measureSnapshot(snapshot)) {
    const validationError = this.options.codec.validate(snapshot);
    if (validationError) return new Error(validationError);
    if (byteLength > REALTIME_PROJECT_MAX_BYTES) {
      return new Error(
        `项目云端数据为 ${byteLength} 字节，超过实时同步上限 ${REALTIME_PROJECT_MAX_BYTES} 字节。`,
      );
    }
    return null;
  }

  private assertSnapshotCanSync(snapshot: ProjectData) {
    const byteLength = this.measureSnapshot(snapshot);
    const error = this.snapshotSyncError(snapshot, byteLength);
    if (error) throw error;
    return byteLength;
  }
}
