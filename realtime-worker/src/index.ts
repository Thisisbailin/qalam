/// <reference types="@cloudflare/workers-types" />

import * as Y from "yjs";
import {
  applyProjectSnapshot,
  decodeUpdateBase64,
  encodeUpdateBase64,
  readProjectSnapshot,
} from "../../collaboration/yProjectDocument";
import {
  REALTIME_PROJECT_MAX_BYTES,
  REALTIME_UPDATE_MAX_BYTES,
} from "../../collaboration/realtimeLimits";

type RoomEnv = { DB: D1Database };
type RoomIdentity = { userId: string; projectId: string };
type RoomAccess = "edit" | "view";
type RoomClientIdentity = RoomIdentity & { access: RoomAccess; viewerUserId: string };
type ClientMessage = {
  type?: unknown;
  actorId?: unknown;
  opId?: unknown;
  update?: unknown;
  projectBytes?: unknown;
  epoch?: unknown;
};
type ResetMode = "reset" | "delete";
type RoomMetaRow = {
  user_id: string;
  project_id: string;
  server_seq: number;
  checkpoint_seq: number;
  checkpoint: ArrayBuffer;
  projected_seq: number;
  pending_bytes: number;
  epoch: number;
  epoch_reason: "rebase" | "reset";
  material_bytes: number;
};
type RoomUpdateRow = {
  server_seq: number;
  actor_id: string;
  op_id: string;
  update_blob: ArrayBuffer;
};
type RoomCheckpointRow = {
  chunk_blob: ArrayBuffer;
};

const REALTIME_PROTOCOL = "stylo-realtime.v1";
const MAX_SQL_BLOB_BYTES = 1_500_000;
const MAX_UPDATE_BYTES = REALTIME_UPDATE_MAX_BYTES;
const MAX_PENDING_BYTES = 8_000_000;
const MAX_PROJECT_BYTES = REALTIME_PROJECT_MAX_BYTES;
const MAX_UPDATE_BASE64_CHARS = Math.ceil(MAX_UPDATE_BYTES / 3) * 4 + 4;
const MAX_REALTIME_MESSAGE_CHARS = MAX_UPDATE_BASE64_CHARS + 2_048;
const SOCKET_RATE_WINDOW_MS = 60_000;
const SOCKET_RATE_MAX_MESSAGES = 600;
const SOCKET_RATE_MAX_CHARS = 64 * 1024 * 1024;
const PROJECTION_BYTE_THRESHOLD = 512_000;
const PROJECTION_DEBOUNCE_MS = 450;
const RETAINED_OPERATION_IDS = 2_000;
const REBASE_MIN_CHECKPOINT_BYTES = 768_000;
const REBASE_HISTORY_RATIO = 3;
const MAX_ACCOUNT_CATALOG_SOCKETS = 8;
const MAX_PROJECT_ROOM_SOCKETS = 256;
const MAX_OWNER_EDIT_SOCKETS = 8;
const MAX_VIEWER_SOCKETS = 4;

const normalizeId = (value: unknown, max = 180) =>
  typeof value === "string" && value.trim().length >= 8 && value.trim().length <= max
    ? value.trim()
    : "";

const toBytes = (value: ArrayBuffer | ArrayLike<number>) =>
  value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value);

const toArrayBuffer = (bytes: Uint8Array) => new Uint8Array(bytes).buffer;

const splitBytes = (bytes: Uint8Array, chunkSize = MAX_SQL_BLOB_BYTES) => {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    chunks.push(bytes.slice(offset, Math.min(offset + chunkSize, bytes.byteLength)));
  }
  return chunks;
};

const joinBytes = (chunks: Uint8Array[]) => {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
};

const websocketPair = () => {
  const Pair = (globalThis as unknown as { WebSocketPair: new () => {
    0: WebSocket;
    1: WebSocket;
  } }).WebSocketPair;
  return new Pair();
};

type HibernatingWebSocket = WebSocket & {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
};

export class AccountCatalogRoom {
  private identityPromise: Promise<string> | null = null;

  constructor(
    private readonly state: DurableObjectState,
  ) {}

  private ensureIdentity(requestedUserId: string) {
    if (this.identityPromise) return this.identityPromise;
    this.identityPromise = this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<string>("userId");
      if (stored && stored !== requestedUserId) {
        throw new Error("Account catalog room identity mismatch");
      }
      if (!stored) await this.state.storage.put("userId", requestedUserId);
      return stored || requestedUserId;
    });
    return this.identityPromise;
  }

  private send(socket: WebSocket, payload: Record<string, unknown>) {
    try {
      socket.send(JSON.stringify(payload));
    } catch (error) {
      console.error(JSON.stringify({
        event: "account_catalog_socket_send_failed",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async fetch(request: Request) {
    const userId = normalizeId(request.headers.get("x-stylo-user-id"));
    if (!userId) return new Response("Missing trusted account identity", { status: 401 });
    await this.ensureIdentity(userId);
    const pathname = new URL(request.url).pathname;
    if (request.method === "POST" && pathname === "/notify") {
      const message = {
        type: "catalog-changed",
        changedAt: Date.now(),
      };
      for (const peer of this.state.getWebSockets()) this.send(peer, message);
      return new Response(null, { status: 204 });
    }
    if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    if (this.state.getWebSockets().length >= MAX_ACCOUNT_CATALOG_SOCKETS) {
      return new Response("Too many account catalog connections", {
        status: 429,
        headers: { "retry-after": "30" },
      });
    }
    const pair = websocketPair();
    const client = pair[0];
    const server = pair[1] as HibernatingWebSocket;
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ userId });
    this.send(server, { type: "catalog-ready" });
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "sec-websocket-protocol": REALTIME_PROTOCOL },
    } as ResponseInit & { webSocket: WebSocket });
  }

  webSocketMessage(socket: WebSocket) {
    try {
      socket.close(1008, "Account catalog channel is server-push only");
    } catch {
      // The peer is already gone.
    }
  }

  webSocketClose(socket: WebSocket, code: number, reason: string) {
    try {
      socket.close(code, reason);
    } catch {
      // Hibernating sockets may already be closed.
    }
  }

  webSocketError(socket: WebSocket) {
    try {
      socket.close(1011, "Account catalog channel error");
    } catch {
      // The peer is already gone.
    }
  }
}

/**
 * The Durable Object SQLite database is the realtime authority for one
 * (user_id, project_id) room:
 *
 * - every edit appends exactly one compact Yjs update and advances server_seq;
 * - D1 user_project_documents is a read projection, not the acknowledgement path;
 * - an event-triggered alarm compacts a burst into one full checkpoint;
 * - strong readers call /flush before reading the D1 projection.
 */
export class ProjectRealtimeRoom {
  private doc = new Y.Doc();
  private identity: RoomIdentity | null = null;
  private serverSeq = 0;
  private loadPromise: Promise<void> | null = null;
  private flushPromise: Promise<number> | null = null;
  private resetting = false;
  private readonly socketRate = new WeakMap<WebSocket, {
    startedAt: number;
    messages: number;
    chars: number;
  }>();
  private readonly schemaReady: Promise<void>;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: RoomEnv,
  ) {
    this.schemaReady = this.state.blockConcurrencyWhile(async () => {
      this.migrateSchema();
    });
  }

  private migrateSchema() {
    this.state.storage.transactionSync(() => {
      this.state.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
           id INTEGER PRIMARY KEY,
           applied_at INTEGER NOT NULL
         )`,
      );
      let currentVersion = Number(
        this.state.storage.sql.exec(
          "SELECT COALESCE(MAX(id), 0) AS version FROM _sql_schema_migrations",
        ).toArray()[0]?.version,
      ) || 0;
      if (currentVersion < 1) {
        this.state.storage.sql.exec(
          `CREATE TABLE IF NOT EXISTS room_meta (
             singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
             user_id TEXT NOT NULL,
             project_id TEXT NOT NULL,
             server_seq INTEGER NOT NULL DEFAULT 0,
             checkpoint_seq INTEGER NOT NULL DEFAULT 0,
             checkpoint BLOB NOT NULL,
             projected_seq INTEGER NOT NULL DEFAULT 0,
             pending_bytes INTEGER NOT NULL DEFAULT 0
           )`,
        );
        this.state.storage.sql.exec(
          `CREATE TABLE IF NOT EXISTS room_updates (
             server_seq INTEGER PRIMARY KEY,
             actor_id TEXT NOT NULL,
             op_id TEXT NOT NULL,
             update_blob BLOB NOT NULL,
             created_at INTEGER NOT NULL
           )`,
        );
        this.state.storage.sql.exec(
          `CREATE TABLE IF NOT EXISTS room_operations (
             op_id TEXT PRIMARY KEY,
             server_seq INTEGER NOT NULL,
             created_at INTEGER NOT NULL
           )`,
        );
        this.state.storage.sql.exec(
          "INSERT INTO _sql_schema_migrations (id, applied_at) VALUES (1, ?1)",
          Date.now(),
        );
        currentVersion = 1;
      }
      if (currentVersion < 2) {
        this.state.storage.sql.exec(
          `CREATE TABLE IF NOT EXISTS room_checkpoint_chunks (
             chunk_index INTEGER PRIMARY KEY,
             checkpoint_seq INTEGER NOT NULL,
             chunk_blob BLOB NOT NULL
           )`,
        );
        const legacyMeta = this.state.storage.sql.exec(
          "SELECT checkpoint, checkpoint_seq FROM room_meta WHERE singleton = 1",
        ).toArray()[0] as { checkpoint?: ArrayBuffer; checkpoint_seq?: number } | undefined;
        const legacyCheckpoint = legacyMeta?.checkpoint
          ? toBytes(legacyMeta.checkpoint)
          : new Uint8Array();
        if (legacyMeta && legacyCheckpoint.byteLength) {
          this.writeCheckpointChunks(legacyCheckpoint, Number(legacyMeta.checkpoint_seq) || 0);
          this.state.storage.sql.exec(
            "UPDATE room_meta SET checkpoint = ?1 WHERE singleton = 1",
            toArrayBuffer(new Uint8Array()),
          );
        }
        this.state.storage.sql.exec(
          "INSERT INTO _sql_schema_migrations (id, applied_at) VALUES (2, ?1)",
          Date.now(),
        );
        currentVersion = 2;
      }
      if (currentVersion < 3) {
        this.state.storage.sql.exec(
          `CREATE TABLE IF NOT EXISTS room_update_chunks (
             server_seq INTEGER NOT NULL,
             chunk_index INTEGER NOT NULL,
             chunk_blob BLOB NOT NULL,
             PRIMARY KEY (server_seq, chunk_index)
           )`,
        );
        this.state.storage.sql.exec(
          "INSERT INTO _sql_schema_migrations (id, applied_at) VALUES (3, ?1)",
          Date.now(),
        );
        currentVersion = 3;
      }
      if (currentVersion < 4) {
        this.state.storage.sql.exec(
          "ALTER TABLE room_meta ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0",
        );
        this.state.storage.sql.exec(
          "ALTER TABLE room_meta ADD COLUMN material_bytes INTEGER NOT NULL DEFAULT 0",
        );
        this.state.storage.sql.exec(
          "INSERT INTO _sql_schema_migrations (id, applied_at) VALUES (4, ?1)",
          Date.now(),
        );
        currentVersion = 4;
      }
      if (currentVersion < 5) {
        this.state.storage.sql.exec(
          "ALTER TABLE room_meta ADD COLUMN epoch_reason TEXT NOT NULL DEFAULT 'rebase'",
        );
        this.state.storage.sql.exec(
          "INSERT INTO _sql_schema_migrations (id, applied_at) VALUES (5, ?1)",
          Date.now(),
        );
      }
    });
  }

  private logError(event: string, error: unknown, detail: Record<string, unknown> = {}) {
    console.error(JSON.stringify({
      event,
      error: error instanceof Error ? error.message : String(error),
      serverSeq: this.serverSeq,
      ...detail,
    }));
  }

  private sendSocketMessage(socket: WebSocket, message: string) {
    try {
      socket.send(message);
      return true;
    } catch (error) {
      this.logError("realtime_socket_send_failed", error);
      return false;
    }
  }

  private readRoomMeta() {
    return (this.state.storage.sql.exec(
      `SELECT user_id, project_id, server_seq, checkpoint_seq,
              checkpoint, projected_seq, pending_bytes, epoch, epoch_reason, material_bytes
       FROM room_meta WHERE singleton = 1`,
    ).toArray() as RoomMetaRow[])[0] || null;
  }

  private readCheckpoint(meta: RoomMetaRow) {
    const chunks = this.state.storage.sql.exec(
      `SELECT chunk_blob FROM room_checkpoint_chunks
       WHERE checkpoint_seq = ?1 ORDER BY chunk_index ASC`,
      Number(meta.checkpoint_seq) || 0,
    ).toArray() as RoomCheckpointRow[];
    if (chunks.length) return joinBytes(chunks.map((row) => toBytes(row.chunk_blob)));
    return toBytes(meta.checkpoint);
  }

  private writeCheckpointChunks(checkpoint: Uint8Array, checkpointSeq: number) {
    this.state.storage.sql.exec("DELETE FROM room_checkpoint_chunks");
    splitBytes(checkpoint).forEach((chunk, index) => {
      this.state.storage.sql.exec(
        `INSERT INTO room_checkpoint_chunks
           (chunk_index, checkpoint_seq, chunk_blob)
         VALUES (?1, ?2, ?3)`,
        index,
        checkpointSeq,
        toArrayBuffer(chunk),
      );
    });
  }

  private readRoomUpdate(row: RoomUpdateRow) {
    const inline = toBytes(row.update_blob);
    if (inline.byteLength) return inline;
    const chunks = this.state.storage.sql.exec(
      `SELECT chunk_blob FROM room_update_chunks
       WHERE server_seq = ?1 ORDER BY chunk_index ASC`,
      Number(row.server_seq) || 0,
    ).toArray() as RoomCheckpointRow[];
    if (!chunks.length) {
      throw new Error(`Realtime update ${row.server_seq} is missing its stored chunks`);
    }
    return joinBytes(chunks.map((chunk) => toBytes(chunk.chunk_blob)));
  }

  private writeRoomUpdate(serverSeq: number, update: Uint8Array) {
    if (update.byteLength <= MAX_SQL_BLOB_BYTES) return toArrayBuffer(update);
    splitBytes(update).forEach((chunk, index) => {
      this.state.storage.sql.exec(
        `INSERT INTO room_update_chunks
           (server_seq, chunk_index, chunk_blob)
         VALUES (?1, ?2, ?3)`,
        serverSeq,
        index,
        toArrayBuffer(chunk),
      );
    });
    return toArrayBuffer(new Uint8Array());
  }

  private assertRoomIdentity(identity: RoomIdentity) {
    if (
      this.identity
      && (this.identity.userId !== identity.userId || this.identity.projectId !== identity.projectId)
    ) {
      throw new Error("Durable Object room identity mismatch");
    }
  }

  private ensureLoaded(identity?: RoomIdentity) {
    if (identity) this.assertRoomIdentity(identity);
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = this.state.blockConcurrencyWhile(async () => {
      await this.schemaReady;
      const stored = this.readRoomMeta();
      const resolvedIdentity = identity || (stored
        ? { userId: String(stored.user_id), projectId: String(stored.project_id) }
        : null);
      if (!resolvedIdentity) throw new Error("Realtime room identity is unavailable");
      this.assertRoomIdentity(resolvedIdentity);
      this.identity = resolvedIdentity;

      if (stored) {
        const checkpoint = this.readCheckpoint(stored);
        if (checkpoint.byteLength) Y.applyUpdate(this.doc, checkpoint, "room-checkpoint");
        const updates = this.state.storage.sql.exec(
          `SELECT server_seq, actor_id, op_id, update_blob
           FROM room_updates
           WHERE server_seq > ?1
           ORDER BY server_seq ASC`,
          Number(stored.checkpoint_seq) || 0,
        ).toArray() as RoomUpdateRow[];
        for (const row of updates) {
          Y.applyUpdate(this.doc, this.readRoomUpdate(row), `actor:${row.actor_id}`);
        }
        this.serverSeq = Number(stored.server_seq) || 0;
        return;
      }

      // One-time bootstrap for rooms created before the incremental authority
      // rollout. All subsequent edit durability is local to the Durable Object.
      const legacy = await this.env.DB.prepare(
        `SELECT y_state, server_seq FROM user_project_documents
         WHERE user_id = ?1 AND project_id = ?2`,
      ).bind(resolvedIdentity.userId, resolvedIdentity.projectId).first<{
        y_state: ArrayBuffer | null;
        server_seq: number | null;
      }>();
      if (legacy?.y_state) {
        Y.applyUpdate(this.doc, toBytes(legacy.y_state), "d1-bootstrap");
      }
      this.serverSeq = Number(legacy?.server_seq) || 0;
      const checkpoint = Y.encodeStateAsUpdate(this.doc);
      this.state.storage.sql.exec(
        `INSERT INTO room_meta
           (singleton, user_id, project_id, server_seq, checkpoint_seq,
            checkpoint, projected_seq, pending_bytes)
         VALUES (1, ?1, ?2, ?3, ?3, ?4, ?3, 0)`,
        resolvedIdentity.userId,
        resolvedIdentity.projectId,
        this.serverSeq,
        toArrayBuffer(new Uint8Array()),
      );
      this.writeCheckpointChunks(checkpoint, this.serverSeq);
    });
    return this.loadPromise;
  }

  private readSocketIdentity(socket: WebSocket): RoomClientIdentity | null {
    const attachment = (socket as HibernatingWebSocket).deserializeAttachment?.();
    if (!attachment || typeof attachment !== "object") return null;
    const candidate = attachment as Partial<RoomClientIdentity>;
    const userId = normalizeId(candidate.userId);
    const projectId = normalizeId(candidate.projectId);
    const viewerUserId = normalizeId(candidate.viewerUserId);
    const access = candidate.access === "view" ? "view" : candidate.access === "edit" ? "edit" : null;
    return userId && projectId && viewerUserId && access
      ? { userId, projectId, viewerUserId, access }
      : null;
  }

  private scheduleProjection(delay = PROJECTION_DEBOUNCE_MS) {
    return this.state.storage.setAlarm(Date.now() + delay);
  }

  private async projectToD1() {
    await this.ensureLoaded();
    if (!this.identity) throw new Error("Realtime room identity is unavailable");
    const meta = this.readRoomMeta();
    if (!meta || Number(meta.projected_seq) >= this.serverSeq) return this.serverSeq;

    const projectionSeq = this.serverSeq;
    const materialized = readProjectSnapshot<Record<string, unknown>>(this.doc);
    const serialized = JSON.stringify(materialized);
    const materialBytes = new TextEncoder().encode(serialized).byteLength;
    if (materialBytes > MAX_PROJECT_BYTES) {
      throw new Error("Realtime project exceeds the maximum projected size");
    }
    const checkpoint = Y.encodeStateAsUpdate(this.doc);
    const now = Date.now();
    const activeProject = Array.isArray(materialized.flowProjects)
      ? materialized.flowProjects.find((project) =>
          project && typeof project === "object"
          && (project as Record<string, unknown>).id === this.identity!.projectId)
        || materialized.flowProjects[0]
      : null;
    const descriptor = activeProject && typeof activeProject === "object"
      ? activeProject as Record<string, unknown>
      : {};
    await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO user_project_documents
         (user_id, project_id, y_state, project_data, server_seq, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(user_id, project_id) DO UPDATE SET
           y_state = excluded.y_state,
           project_data = excluded.project_data,
           server_seq = excluded.server_seq,
           updated_at = excluded.updated_at
         WHERE user_project_documents.server_seq <= excluded.server_seq`,
      ).bind(
        this.identity.userId,
        this.identity.projectId,
        toArrayBuffer(new Uint8Array()),
        serialized,
        projectionSeq,
        now,
      ),
      this.env.DB.prepare(
        `INSERT INTO user_project_catalog
           (user_id, project_id, title, color, duration_min, root_node_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(user_id, project_id) DO UPDATE SET
           title = excluded.title,
           color = excluded.color,
           duration_min = excluded.duration_min,
           root_node_id = excluded.root_node_id,
           updated_at = excluded.updated_at`,
      ).bind(
        this.identity.userId,
        this.identity.projectId,
        typeof descriptor.title === "string" && descriptor.title.trim()
          ? descriptor.title.trim().slice(0, 200)
          : this.identity.projectId,
        typeof descriptor.color === "string" ? descriptor.color.slice(0, 32) : "amber",
        Number(descriptor.durationMin) || 120,
        typeof descriptor.rootNodeId === "string"
          ? descriptor.rootNodeId.slice(0, 240)
          : `project-root-${this.identity.projectId}`,
        Number(descriptor.createdAt) || now,
        now,
      ),
    ]);

    this.state.storage.transactionSync(() => {
      this.writeCheckpointChunks(checkpoint, projectionSeq);
      this.state.storage.sql.exec(
        `UPDATE room_meta SET
           checkpoint = ?1,
           checkpoint_seq = MAX(checkpoint_seq, ?2),
           projected_seq = MAX(projected_seq, ?2),
           material_bytes = ?3,
           pending_bytes = COALESCE((
             SELECT SUM(
               LENGTH(update_blob) + COALESCE((
                 SELECT SUM(LENGTH(chunk_blob))
                 FROM room_update_chunks
                 WHERE room_update_chunks.server_seq = room_updates.server_seq
               ), 0)
             )
             FROM room_updates WHERE server_seq > ?2
           ), 0)
         WHERE singleton = 1`,
        toArrayBuffer(new Uint8Array()),
        projectionSeq,
        materialBytes,
      );
      this.state.storage.sql.exec(
        "DELETE FROM room_update_chunks WHERE server_seq <= ?1",
        projectionSeq,
      );
      this.state.storage.sql.exec(
        "DELETE FROM room_updates WHERE server_seq <= ?1",
        projectionSeq,
      );
      this.state.storage.sql.exec(
        "DELETE FROM room_operations WHERE server_seq <= ?1",
        Math.max(0, projectionSeq - RETAINED_OPERATION_IDS),
      );
    });
    if (this.serverSeq > projectionSeq) {
      this.state.waitUntil(this.scheduleProjection());
    }
    return projectionSeq;
  }

  private async flushProjection(requiredSeq = this.serverSeq) {
    while ((Number(this.readRoomMeta()?.projected_seq) || 0) < requiredSeq) {
      if (!this.flushPromise) {
        this.flushPromise = this.projectToD1().finally(() => {
          this.flushPromise = null;
        });
      }
      await this.flushPromise;
    }
    return Number(this.readRoomMeta()?.projected_seq) || 0;
  }

  private compactIdleHistory() {
    if (this.state.getWebSockets().length !== 0) return false;
    const meta = this.readRoomMeta();
    if (!meta || Number(meta.projected_seq) < this.serverSeq) return false;
    const checkpoint = Y.encodeStateAsUpdate(this.doc);
    const materialBytes = Number(meta.material_bytes) || new TextEncoder().encode(
      JSON.stringify(readProjectSnapshot<Record<string, unknown>>(this.doc)),
    ).byteLength;
    if (
      checkpoint.byteLength < REBASE_MIN_CHECKPOINT_BYTES
      || checkpoint.byteLength < Math.max(
        materialBytes * REBASE_HISTORY_RATIO,
        REBASE_MIN_CHECKPOINT_BYTES,
      )
    ) return false;
    const canonical = new Y.Doc();
    applyProjectSnapshot(
      canonical,
      readProjectSnapshot<Record<string, unknown>>(this.doc),
      "server-idle-rebase",
    );
    const canonicalCheckpoint = Y.encodeStateAsUpdate(canonical);
    this.state.storage.transactionSync(() => {
      this.writeCheckpointChunks(canonicalCheckpoint, this.serverSeq);
      this.state.storage.sql.exec(
        `UPDATE room_meta SET
           checkpoint = ?1,
           checkpoint_seq = ?2,
           epoch = epoch + 1,
           epoch_reason = 'rebase',
           material_bytes = ?3
         WHERE singleton = 1`,
        toArrayBuffer(new Uint8Array()),
        this.serverSeq,
        materialBytes,
      );
    });
    this.doc.destroy();
    this.doc = canonical;
    return true;
  }

  private projectInBackground(requiredSeq: number) {
    this.state.waitUntil(
      this.flushProjection(requiredSeq).catch(async (error) => {
        this.logError("realtime_project_projection_failed", error, { requiredSeq });
        await this.scheduleProjection(2_000);
      }),
    );
  }

  private async resetProject(identity: RoomIdentity, mode: ResetMode) {
    this.resetting = true;
    try {
      await this.ensureLoaded(identity);
      if (this.flushPromise) await this.flushPromise.catch(() => undefined);
      const previousEpoch = Number(this.readRoomMeta()?.epoch) || 0;
      this.doc.destroy();
      this.doc = new Y.Doc();
      const checkpoint = Y.encodeStateAsUpdate(this.doc);
      this.state.storage.transactionSync(() => {
        this.state.storage.sql.exec("DELETE FROM room_update_chunks");
        this.state.storage.sql.exec("DELETE FROM room_updates");
        this.state.storage.sql.exec("DELETE FROM room_operations");
        this.state.storage.sql.exec("DELETE FROM room_checkpoint_chunks");
        this.state.storage.sql.exec("DELETE FROM room_meta");
        this.state.storage.sql.exec(
          `INSERT INTO room_meta
             (singleton, user_id, project_id, server_seq, checkpoint_seq,
              checkpoint, projected_seq, pending_bytes, epoch, epoch_reason, material_bytes)
           VALUES (1, ?1, ?2, 0, 0, ?3, 0, 0, ?4, 'reset', 0)`,
          identity.userId,
          identity.projectId,
          toArrayBuffer(new Uint8Array()),
          previousEpoch + 1,
        );
        this.writeCheckpointChunks(checkpoint, 0);
      });
      this.serverSeq = 0;
      await this.state.storage.deleteAlarm();
      await this.env.DB.prepare(
        `DELETE FROM user_project_documents
         WHERE user_id = ?1 AND project_id = ?2`,
      ).bind(identity.userId, identity.projectId).run();
    } finally {
      this.resetting = false;
    }

    const message = JSON.stringify({
      type: "reset",
      mode,
      serverSeq: 0,
      epoch: Number(this.readRoomMeta()?.epoch) || 0,
      epochReason: "reset",
    });
    for (const peer of this.state.getWebSockets()) {
      this.sendSocketMessage(peer, message);
      if (mode === "delete") {
        try {
          peer.close(4004, "Project permanently deleted");
        } catch (error) {
          this.logError("realtime_socket_close_failed", error);
        }
      }
    }
  }

  async fetch(request: Request) {
    const userId = normalizeId(request.headers.get("x-stylo-user-id"));
    const projectId = normalizeId(request.headers.get("x-stylo-project-id"));
    const accessHeader = request.headers.get("x-stylo-access-mode");
    const access: RoomAccess = accessHeader === "view" ? "view" : "edit";
    const viewerUserId = normalizeId(request.headers.get("x-stylo-viewer-id"))
      || (!accessHeader ? userId : "");
    if (!userId || !projectId) return new Response("Missing trusted room identity", { status: 401 });

    const pathname = new URL(request.url).pathname;
    if (request.method === "POST" && pathname === "/flush") {
      await this.ensureLoaded({ userId, projectId });
      const serverSeq = await this.flushProjection(this.serverSeq);
      return Response.json({ serverSeq });
    }
    if (request.method === "POST" && pathname === "/reset") {
      const mode = request.headers.get("x-stylo-reset-mode") === "delete" ? "delete" : "reset";
      await this.resetProject({ userId, projectId }, mode);
      return new Response(null, { status: 204 });
    }
    if (request.method === "POST" && pathname === "/revoke-viewers") {
      for (const peer of this.state.getWebSockets()) {
        if (this.readSocketIdentity(peer)?.access === "view") {
          try {
            peer.close(4003, "Project visibility changed");
          } catch (error) {
            this.logError("realtime_viewer_revoke_failed", error);
          }
        }
      }
      return new Response(null, { status: 204 });
    }
    if (!viewerUserId) return new Response("Missing trusted viewer identity", { status: 401 });
    if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    await this.ensureLoaded({ userId, projectId });

    const peers = this.state.getWebSockets();
    const identitySocketCount = peers.reduce((count, peer) => {
      const identity = this.readSocketIdentity(peer);
      return count + (identity?.viewerUserId === viewerUserId && identity.access === access ? 1 : 0);
    }, 0);
    const identityLimit = access === "edit" ? MAX_OWNER_EDIT_SOCKETS : MAX_VIEWER_SOCKETS;
    if (peers.length >= MAX_PROJECT_ROOM_SOCKETS || identitySocketCount >= identityLimit) {
      return new Response("Too many realtime project connections", {
        status: 429,
        headers: { "retry-after": "30" },
      });
    }

    const pair = websocketPair();
    const client = pair[0];
    const server = pair[1] as HibernatingWebSocket;
    this.state.acceptWebSocket(server);
      server.serializeAttachment({ userId, projectId, access, viewerUserId });
    const meta = this.readRoomMeta();
    this.sendSocketMessage(server, JSON.stringify({
      type: "sync",
      serverSeq: this.serverSeq,
      epoch: Number(meta?.epoch) || 0,
      epochReason: meta?.epoch_reason === "reset" ? "reset" : "rebase",
      update: encodeUpdateBase64(Y.encodeStateAsUpdate(this.doc)),
      stateVector: encodeUpdateBase64(Y.encodeStateVector(this.doc)),
    }));
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "sec-websocket-protocol": REALTIME_PROTOCOL },
    } as ResponseInit & { webSocket: WebSocket });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer) {
    const attachedIdentity = this.readSocketIdentity(socket);
    if (!attachedIdentity) {
      socket.close(1008, "Missing project room identity");
      return;
    }
    await this.ensureLoaded(attachedIdentity);
    if (typeof raw !== "string" || !this.identity) return;
    if (raw.length > MAX_REALTIME_MESSAGE_CHARS) {
      this.sendSocketMessage(socket, JSON.stringify({
        type: "error",
        error: "Realtime message is too large",
      }));
      socket.close(1009, "Realtime message is too large");
      return;
    }
    const now = Date.now();
    const previousRate = this.socketRate.get(socket);
    const rate = !previousRate || now - previousRate.startedAt >= SOCKET_RATE_WINDOW_MS
      ? { startedAt: now, messages: 0, chars: 0 }
      : previousRate;
    rate.messages += 1;
    rate.chars += raw.length;
    this.socketRate.set(socket, rate);
    if (
      rate.messages > SOCKET_RATE_MAX_MESSAGES
      || rate.chars > SOCKET_RATE_MAX_CHARS
    ) {
      this.sendSocketMessage(socket, JSON.stringify({
        type: "error",
        error: "Realtime update rate limit exceeded",
      }));
      socket.close(1008, "Realtime update rate limit exceeded");
      return;
    }
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      this.sendSocketMessage(socket, JSON.stringify({ type: "error", error: "Invalid realtime message" }));
      return;
    }
    if (message.type !== "update") return;
    if (this.resetting) {
      this.sendSocketMessage(socket, JSON.stringify({ type: "error", error: "Project reset is in progress" }));
      return;
    }
    if (attachedIdentity.access !== "edit" || attachedIdentity.viewerUserId !== attachedIdentity.userId) {
      this.sendSocketMessage(socket, JSON.stringify({ type: "error", error: "Public project connections are read-only" }));
      return;
    }
    const actorId = normalizeId(message.actorId);
    const opId = normalizeId(message.opId);
    const projectBytes = Number(message.projectBytes);
    const clientEpoch = Number(message.epoch);
    const roomEpoch = Number(this.readRoomMeta()?.epoch) || 0;
    if (
      !actorId
      || !opId
      || typeof message.update !== "string"
      || message.update.length > MAX_UPDATE_BASE64_CHARS
      || !Number.isSafeInteger(projectBytes)
      || projectBytes < 0
      || projectBytes > MAX_PROJECT_BYTES
      || !Number.isSafeInteger(clientEpoch)
      || clientEpoch !== roomEpoch
    ) {
      this.sendSocketMessage(socket, JSON.stringify({ type: "error", opId, error: "Invalid realtime update" }));
      return;
    }
    let update: Uint8Array;
    try {
      update = decodeUpdateBase64(message.update);
      const validationDoc = new Y.Doc();
      Y.applyUpdate(validationDoc, update, "validate");
      validationDoc.destroy();
    } catch {
      this.sendSocketMessage(socket, JSON.stringify({ type: "error", opId, error: "Invalid realtime update encoding" }));
      return;
    }
    if (update.byteLength === 0 || update.byteLength > MAX_UPDATE_BYTES) {
      this.sendSocketMessage(socket, JSON.stringify({ type: "error", opId, error: "Realtime update is too large" }));
      return;
    }

    try {
      const duplicate = (this.state.storage.sql.exec(
        "SELECT server_seq FROM room_operations WHERE op_id = ?1",
        opId,
      ).toArray() as Array<{ server_seq: number }>)[0];
      if (duplicate) {
        this.sendSocketMessage(socket, JSON.stringify({
          type: "ack",
          opId,
          serverSeq: Number(duplicate.server_seq) || 0,
        }));
        return;
      }

      const meta = this.readRoomMeta();
      const pendingBytes = Number(meta?.pending_bytes) || 0;
      const materialBytes = Number(meta?.material_bytes) || 0;
      if (
        materialBytes <= 0
        || materialBytes + ((pendingBytes + update.byteLength) * 8) > MAX_PROJECT_BYTES
      ) {
        const candidate = new Y.Doc();
        try {
          Y.applyUpdate(candidate, Y.encodeStateAsUpdate(this.doc), "size-base");
          Y.applyUpdate(candidate, update, "size-candidate");
          const candidateBytes = new TextEncoder().encode(
            JSON.stringify(readProjectSnapshot<Record<string, unknown>>(candidate)),
          ).byteLength;
          if (candidateBytes > MAX_PROJECT_BYTES) {
            this.sendSocketMessage(socket, JSON.stringify({
              type: "error",
              opId,
              error: "Realtime project exceeds the maximum projected size",
            }));
            return;
          }
        } finally {
          candidate.destroy();
        }
      }
      if (pendingBytes + update.byteLength > MAX_PENDING_BYTES) {
        this.projectInBackground(this.serverSeq);
        this.sendSocketMessage(socket, JSON.stringify({
          type: "error",
          opId,
          error: "Realtime room is compacting; retry the update",
        }));
        return;
      }

      const serverSeq = this.serverSeq + 1;
      const now = Date.now();
      this.state.storage.transactionSync(() => {
        this.state.storage.sql.exec(
          `INSERT INTO room_operations (op_id, server_seq, created_at)
           VALUES (?1, ?2, ?3)`,
          opId,
          serverSeq,
          now,
        );
        this.state.storage.sql.exec(
          `INSERT INTO room_updates
             (server_seq, actor_id, op_id, update_blob, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5)`,
          serverSeq,
          actorId,
          opId,
          this.writeRoomUpdate(serverSeq, update),
          now,
        );
        this.state.storage.sql.exec(
          `UPDATE room_meta
           SET server_seq = ?1, pending_bytes = pending_bytes + ?2
           WHERE singleton = 1`,
          serverSeq,
          update.byteLength,
        );
      });
      Y.applyUpdate(this.doc, update, `actor:${actorId}`);
      this.serverSeq = serverSeq;
      if (pendingBytes + update.byteLength >= PROJECTION_BYTE_THRESHOLD) {
        this.projectInBackground(serverSeq);
      } else {
        this.state.waitUntil(this.scheduleProjection());
      }

      this.sendSocketMessage(socket, JSON.stringify({ type: "ack", opId, serverSeq }));
      const broadcast = JSON.stringify({
        type: "update",
        opId,
        actorId,
        serverSeq,
        epoch: roomEpoch,
        update: message.update,
      });
      for (const peer of this.state.getWebSockets()) {
        if (peer !== socket) this.sendSocketMessage(peer, broadcast);
      }
    } catch (error) {
      this.logError("realtime_project_update_failed", error);
      this.sendSocketMessage(socket, JSON.stringify({
        type: "error",
        opId,
        error: "Realtime project update failed",
      }));
    }
  }

  async alarm() {
    await this.flushProjection();
    this.compactIdleHistory();
  }

  webSocketClose(socket: WebSocket, code: number, reason: string) {
    try {
      socket.close(code, reason);
    } catch (error) {
      this.logError("realtime_socket_close_callback_failed", error, { code });
    }
    this.state.waitUntil(this.scheduleProjection(250));
  }

  webSocketError(socket: WebSocket) {
    try {
      socket.close(1011, "Realtime room error");
    } catch (error) {
      this.logError("realtime_socket_error_callback_failed", error);
    }
  }
}

export default {
  fetch() {
    return new Response("Stylo realtime rooms are accessible through authenticated Pages Functions only.", {
      status: 404,
    });
  },
};
