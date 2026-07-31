import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import {
  applyProjectSnapshot,
  encodeUpdateBase64,
  readProjectSnapshot,
} from "../collaboration/yProjectDocument";
import { REALTIME_PROJECT_MAX_BYTES } from "../collaboration/realtimeLimits";
import { RealtimeProjectSyncEngine } from "../sync/realtimeProjectSyncEngine";
import type { SyncCodec } from "../sync/realtimeSyncTypes";
import type { ProjectData, SyncStatus } from "../types";

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const project = (revision: number, x: number): ProjectData => ({
  activeFlowProjectId: "project-main",
  fileName: "Project",
  rawScript: "",
  episodes: [],
  roles: [],
  designAssets: [],
  canvas: { viewport: { x: 0, y: 0, zoom: 1 } },
  stats: { context: { total: 0, success: 0, error: 0 } },
  flow: {
    revision,
    flowNodes: [{
      id: "node-1",
      type: "text",
      position: { x, y: 20 },
      data: { title: "文本", markdown: "hello" },
    }],
    links: [],
    graphLinks: [],
    globalAssetHistory: [],
  },
  flowProjects: [],
});

const codec = (onSnapshot?: () => void): SyncCodec<ProjectData> => ({
  snapshot(value) {
    onSnapshot?.();
    return structuredClone(value);
  },
  fingerprint: (value) => JSON.stringify(value),
  validate: () => null,
  isEmpty: (value) => !value.flow?.flowNodes?.length,
  revision: (value) => value.flow?.revision ?? null,
});

class FakeSocket {
  readyState: number = WebSocket.OPEN;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: Array<Record<string, unknown>> = [];
  throwOnSend = false;

  send(raw: string) {
    if (this.throwOnSend) throw new Error("socket send failed");
    this.sent.push(JSON.parse(raw) as Record<string, unknown>);
  }

  close() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.onclose?.();
  }

  emit(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }
}

const serverSync = (value: ProjectData, serverSeq = 0) => {
  const doc = new Y.Doc();
  applyProjectSnapshot(doc, value as unknown as Record<string, unknown>, "server");
  return serverSyncFromDocument(doc, serverSeq);
};

const serverSyncFromDocument = (doc: Y.Doc, serverSeq = 0) => {
  return {
    type: "sync",
    serverSeq,
    update: encodeUpdateBase64(Y.encodeStateAsUpdate(doc)),
    stateVector: encodeUpdateBase64(Y.encodeStateVector(doc)),
  };
};

const createEngine = (input: {
  socket: FakeSocket;
  syncCodec?: SyncCodec<ProjectData>;
  persisted?: Uint8Array | null;
  onApplyRemote?: (value: ProjectData) => void;
  onStatusChange?: (status: SyncStatus) => void;
}) => new RealtimeProjectSyncEngine({
  accountScope: "user-account-1",
  projectId: "project-main",
  session: {
    deviceId: "device-test-1",
    openWebSocket: async () => input.socket as unknown as WebSocket,
  } as any,
  codec: input.syncCodec || codec(),
  debounceMs: 0,
  stageDebounceMs: 0,
  persistenceDebounceMs: 0,
  onApplyRemote: input.onApplyRemote || (() => undefined),
  onStatusChange: input.onStatusChange,
  documentStore: {
    read: async () => input.persisted || null,
    write: async () => undefined,
    delete: async () => undefined,
  },
});

test("a stale local Yjs checkpoint cannot overwrite a newer visible project at startup", async () => {
  const persistedDoc = new Y.Doc();
  applyProjectSnapshot(
    persistedDoc,
    project(1, 10) as unknown as Record<string, unknown>,
    "persisted",
  );
  const socket = new FakeSocket();
  const applied: ProjectData[] = [];
  const engine = createEngine({
    socket,
    persisted: Y.encodeStateAsUpdate(persistedDoc),
    onApplyRemote: (value) => applied.push(value),
  });

  await engine.start(project(2, 84));

  const snapshot = readProjectSnapshot<ProjectData & Record<string, unknown>>(
    (engine as any).doc,
  );
  assert.equal(snapshot.flow?.revision, 2);
  assert.equal(snapshot.flow?.flowNodes?.[0]?.position.x, 84);
  assert.equal(applied.length, 0);
  engine.dispose();
});

test("an epoch change persists the replacement checkpoint and epoch atomically", async () => {
  const initial = project(1, 10);
  const persistedDoc = new Y.Doc();
  applyProjectSnapshot(
    persistedDoc,
    initial as unknown as Record<string, unknown>,
    "persisted",
  );
  const remote = project(2, 84);
  const remoteDoc = new Y.Doc();
  applyProjectSnapshot(
    remoteDoc,
    remote as unknown as Record<string, unknown>,
    "remote",
  );
  const socket = new FakeSocket();
  const writes: Array<{ checkpoint: Uint8Array; epoch: number }> = [];
  let splitEpochWrites = 0;
  const engine = new RealtimeProjectSyncEngine({
    accountScope: "user-account-1",
    projectId: "project-main",
    session: {
      deviceId: "device-test-1",
      openWebSocket: async () => socket as unknown as WebSocket,
    } as any,
    codec: codec(),
    debounceMs: 0,
    stageDebounceMs: 0,
    persistenceDebounceMs: 0,
    onApplyRemote: () => undefined,
    documentStore: {
      read: async () => Y.encodeStateAsUpdate(persistedDoc),
      write: async () => undefined,
      delete: async () => undefined,
      readEpoch: async () => 1,
      writeEpoch: async () => {
        splitEpochWrites += 1;
      },
      writeState: async (_key, checkpoint, epoch) => {
        writes.push({ checkpoint, epoch });
      },
    },
  });

  await engine.start(initial);
  socket.emit({ ...serverSyncFromDocument(remoteDoc, 2), epoch: 2 });
  await wait(10);

  assert.equal(splitEpochWrites, 0);
  assert.equal(writes.at(-1)?.epoch, 2);
  const checkpoint = new Y.Doc();
  Y.applyUpdate(checkpoint, writes.at(-1)!.checkpoint);
  assert.equal(
    readProjectSnapshot<ProjectData & Record<string, unknown>>(checkpoint)
      .flow?.flowNodes?.[0]?.position.x,
    84,
  );
  engine.dispose();
  persistedDoc.destroy();
  remoteDoc.destroy();
  checkpoint.destroy();
});

test("an idle server rebase preserves offline edits without overwriting unrelated remote edits", async () => {
  const base = project(1, 10);
  const baseDoc = new Y.Doc();
  applyProjectSnapshot(baseDoc, base as unknown as Record<string, unknown>, "base");
  const local = project(2, 84);
  const remote = project(2, 10);
  remote.flow!.flowNodes![0].data.markdown = "edited remotely";
  const remoteDoc = new Y.Doc();
  applyProjectSnapshot(remoteDoc, remote as unknown as Record<string, unknown>, "remote");
  const socket = new FakeSocket();
  const engine = new RealtimeProjectSyncEngine({
    accountScope: "user-account-1",
    projectId: "project-main",
    session: {
      deviceId: "device-test-1",
      openWebSocket: async () => socket as unknown as WebSocket,
    } as any,
    codec: codec(),
    debounceMs: 0,
    stageDebounceMs: 0,
    persistenceDebounceMs: 0,
    onApplyRemote: () => undefined,
    documentStore: {
      read: async () => Y.encodeStateAsUpdate(baseDoc),
      readConfirmed: async () => Y.encodeStateAsUpdate(baseDoc),
      readEpoch: async () => 1,
      write: async () => undefined,
      writeState: async () => undefined,
      delete: async () => undefined,
    },
  });

  await engine.start(base);
  engine.stage(local);
  await wait(10);
  socket.emit({
    ...serverSyncFromDocument(remoteDoc, 2),
    epoch: 2,
    epochReason: "rebase",
  });
  await wait(10);

  const merged = readProjectSnapshot<ProjectData & Record<string, unknown>>(
    (engine as any).doc,
  );
  assert.equal(merged.flow?.flowNodes?.[0]?.position.x, 84);
  assert.equal(merged.flow?.flowNodes?.[0]?.data.markdown, "edited remotely");
  assert.ok(socket.sent.some((message) =>
    message.type === "update" && message.epoch === 2
  ));
  engine.dispose();
  baseDoc.destroy();
  remoteDoc.destroy();
});

test("startup merge preserves unrelated remote edits instead of replaying a full local snapshot", async () => {
  const base = project(1, 10);
  const baseDoc = new Y.Doc();
  applyProjectSnapshot(baseDoc, base as unknown as Record<string, unknown>, "base");
  const persisted = Y.encodeStateAsUpdate(baseDoc);

  const serverDoc = new Y.Doc();
  Y.applyUpdate(serverDoc, persisted);
  const remote = project(2, 10);
  remote.flow!.flowNodes![0].data.markdown = "edited on another device";
  applyProjectSnapshot(serverDoc, remote as unknown as Record<string, unknown>, "remote");

  const local = project(2, 84);
  const socket = new FakeSocket();
  const engine = createEngine({ socket, persisted });
  await engine.start(local);
  socket.emit(serverSyncFromDocument(serverDoc, 1));
  await wait();

  const merged = readProjectSnapshot<ProjectData & Record<string, unknown>>(
    (engine as any).doc,
  );
  assert.equal(merged.flow?.flowNodes?.[0]?.position.x, 84);
  assert.equal(
    merged.flow?.flowNodes?.[0]?.data.markdown,
    "edited on another device",
  );
  engine.dispose();
});

test("a newer visible local project survives when its Yjs checkpoint is missing", async () => {
  const socket = new FakeSocket();
  const engine = createEngine({ socket, persisted: null });
  const local = project(4, 84);
  await engine.start(local);

  socket.emit(serverSync(project(3, 10), 3));
  await wait(10);

  const merged = readProjectSnapshot<ProjectData & Record<string, unknown>>(
    (engine as any).doc,
  );
  assert.equal(merged.flow?.revision, 4);
  assert.equal(merged.flow?.flowNodes?.[0]?.position.x, 84);
  assert.ok(socket.sent.some((message) => message.type === "update"));
  engine.dispose();
});

test("Agent acquisition waits for an update that was already awaiting ACK", async () => {
  const socket = new FakeSocket();
  const engine = createEngine({ socket });
  const initial = project(1, 10);
  const changed = project(2, 84);
  await engine.start(initial);
  socket.emit(serverSync(initial));

  engine.stage(changed);
  await wait(10);
  const updateMessage = socket.sent.find((message) => message.type === "update");
  assert.ok(updateMessage);
  assert.equal(typeof updateMessage.projectBytes, "number");

  let acquired = false;
  const acquisition = engine.acquire(changed, 2).then((receipt) => {
    acquired = true;
    return receipt;
  });
  await wait();
  assert.equal(acquired, false);

  socket.emit({
    type: "ack",
    opId: updateMessage.opId,
    serverSeq: 1,
  });
  const receipt = await acquisition;
  assert.equal(receipt.remoteVersion, 1);
  engine.dispose();
});

test("an oversized materialized project is rejected before a realtime write", async () => {
  const socket = new FakeSocket();
  const statuses: SyncStatus[] = [];
  const measuredCodec = codec();
  measuredCodec.byteLength = (value) => (value.flow?.revision || 0) >= 2
    ? REALTIME_PROJECT_MAX_BYTES + 1
    : 100;
  const engine = createEngine({
    socket,
    syncCodec: measuredCodec,
    onStatusChange: (status) => statuses.push(status),
  });
  const initial = project(1, 10);
  await engine.start(initial);
  socket.emit(serverSync(initial));
  engine.stage(project(2, 84));
  await wait(10);

  assert.equal(socket.sent.some((message) => message.type === "update"), false);
  assert.ok(statuses.includes("error"));
  engine.dispose();
});

test("pointer-frame staging performs one expensive snapshot after the burst", async () => {
  let snapshots = 0;
  const socket = new FakeSocket();
  const engine = createEngine({
    socket,
    syncCodec: codec(() => {
      snapshots += 1;
    }),
  });
  await engine.start(project(1, 10));
  const startupSnapshots = snapshots;

  for (let index = 0; index < 30; index += 1) {
    engine.stage(project(2 + index, 20 + index));
  }
  assert.equal(snapshots, startupSnapshots);
  await wait(10);
  assert.equal(snapshots, startupSnapshots + 1);
  engine.dispose();
});

test("switching projects drains a first local snapshot instead of abandoning it", async () => {
  const socket = new FakeSocket();
  const initial = project(1, 10);
  const engine = createEngine({ socket, persisted: null });
  await engine.start(initial);

  engine.dispose();
  socket.emit(serverSyncFromDocument(new Y.Doc()));
  await wait(10);
  const update = socket.sent.find((message) => message.type === "update");
  assert.ok(update?.opId);
  socket.emit({ type: "ack", opId: update.opId, serverSeq: 1 });
  await wait();
  assert.equal(socket.readyState, WebSocket.CLOSED);
});

test("a synchronous WebSocket send failure immediately requeues the update", async () => {
  const socket = new FakeSocket();
  const statuses: SyncStatus[] = [];
  const engine = createEngine({
    socket,
    onStatusChange: (status) => statuses.push(status),
  });
  const initial = project(1, 10);
  await engine.start(initial);
  socket.emit(serverSync(initial));
  socket.throwOnSend = true;

  engine.stage(project(2, 84));
  await wait(10);

  assert.equal((engine as any).pendingAcks.size, 0);
  assert.ok((engine as any).pendingOfflineUpdate);
  assert.notEqual(statuses.at(-1), "syncing");
  engine.dispose();
});

test("a malformed remote update is contained and reconnects without mutating the project", async () => {
  const socket = new FakeSocket();
  const statuses: SyncStatus[] = [];
  const errors: unknown[] = [];
  const initial = project(1, 10);
  const engine = new RealtimeProjectSyncEngine({
    accountScope: "user-account-1",
    projectId: "project-main",
    session: {
      deviceId: "device-test-1",
      openWebSocket: async () => socket as unknown as WebSocket,
    } as any,
    codec: codec(),
    debounceMs: 0,
    stageDebounceMs: 0,
    persistenceDebounceMs: 0,
    onApplyRemote: () => undefined,
    onStatusChange: (status) => statuses.push(status),
    onError: (error) => errors.push(error),
    documentStore: {
      read: async () => null,
      write: async () => undefined,
      delete: async () => undefined,
    },
  });
  await engine.start(initial);
  socket.emit(serverSync(initial));
  socket.emit({ type: "update", serverSeq: 2, update: "%%%not-base64%%%" });
  await wait();

  const snapshot = readProjectSnapshot<ProjectData & Record<string, unknown>>(
    (engine as any).doc,
  );
  assert.equal(snapshot.flow?.revision, 1);
  assert.ok(statuses.includes("error"));
  assert.equal(errors.length, 1);
  assert.equal(socket.readyState, WebSocket.CLOSED);
  engine.dispose();
});

test("a disconnected unacknowledged operation reuses its id after reconnect", async () => {
  const firstSocket = new FakeSocket();
  const secondSocket = new FakeSocket();
  const sockets = [firstSocket, secondSocket];
  const initial = project(1, 10);
  const authority = new Y.Doc();
  applyProjectSnapshot(
    authority,
    initial as unknown as Record<string, unknown>,
    "authority",
  );
  const engine = new RealtimeProjectSyncEngine({
    accountScope: "user-account-1",
    projectId: "project-main",
    session: {
      deviceId: "device-test-1",
      openWebSocket: async () => sockets.shift() as unknown as WebSocket,
    } as any,
    codec: codec(),
    debounceMs: 0,
    stageDebounceMs: 0,
    persistenceDebounceMs: 0,
    onApplyRemote: () => undefined,
    onError: () => undefined,
    documentStore: {
      read: async () => null,
      write: async () => undefined,
      delete: async () => undefined,
    },
  });
  await engine.start(initial);
  firstSocket.emit(serverSyncFromDocument(authority));
  engine.stage(project(2, 84));
  await wait(10);
  const firstUpdate = firstSocket.sent.find((message) => message.type === "update");
  assert.ok(firstUpdate?.opId);

  firstSocket.close();
  clearTimeout((engine as any).reconnectTimer);
  (engine as any).reconnectTimer = null;
  await (engine as any).connect();
  secondSocket.emit(serverSyncFromDocument(authority));
  await wait(10);

  const retriedUpdate = secondSocket.sent.find((message) => message.type === "update");
  assert.equal(retriedUpdate?.opId, firstUpdate.opId);
  engine.dispose();
});
