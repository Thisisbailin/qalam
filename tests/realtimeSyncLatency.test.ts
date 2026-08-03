import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as Y from "yjs";
import type { ProjectData } from "../types";
import { applyProjectSnapshot } from "../collaboration/yProjectDocument";
import { areProjectDocumentsSemanticallyEqual } from "../sync/realtimeProjectSyncEngine";
import type { SyncCodec } from "../sync/realtimeSyncTypes";

const codec: SyncCodec<ProjectData> = {
  snapshot: (value) => structuredClone(value),
  fingerprint: (value) => JSON.stringify(value),
  validate: () => null,
  isEmpty: (value) => Object.keys(value as unknown as Record<string, unknown>).length === 0,
};

const project = (x: number) => ({
  activeFlowProjectId: "project-1",
  flow: {
    revision: 1,
    flowNodes: [{ id: "node-1", type: "text", position: { x, y: 20 }, data: { title: "文本" } }],
    links: [],
  },
}) as unknown as ProjectData;

test("independent Yjs histories with equal project content are a startup no-op", () => {
  const local = new Y.Doc();
  const server = new Y.Doc();
  applyProjectSnapshot(local, project(10) as unknown as Record<string, unknown>, "local-seed");
  applyProjectSnapshot(server, project(10) as unknown as Record<string, unknown>, "server-seed");

  assert.ok(Y.encodeStateAsUpdate(local, Y.encodeStateVector(server)).byteLength > 2);
  assert.equal(areProjectDocumentsSemanticallyEqual(local, server, codec), true);
});

test("an offline node-position edit remains a semantic difference", () => {
  const local = new Y.Doc();
  const server = new Y.Doc();
  applyProjectSnapshot(local, project(84) as unknown as Record<string, unknown>, "local-edit");
  applyProjectSnapshot(server, project(10) as unknown as Record<string, unknown>, "server-seed");

  assert.equal(areProjectDocumentsSemanticallyEqual(local, server, codec), false);
});

test("client checkpoint persistence is coalesced and sync errors leave syncing", () => {
  const engine = readFileSync("sync/realtimeProjectSyncEngine.ts", "utf8");

  assert.match(engine, /latestLocalFingerprint/);
  assert.match(engine, /if \(fingerprint === this\.latestLocalFingerprint\) return/);
  assert.match(engine, /areProjectDocumentsSemanticallyEqual/);
  assert.match(engine, /scheduleDocumentPersistence/);
  assert.match(engine, /persistenceDebounceMs \?\? 240/);
  assert.doesNotMatch(engine, /persistTail/);
  assert.match(engine, /message\.type === "error"[\s\S]*onStatusChange\?\.\("error"/);
  assert.match(engine, /确认超时[\s\S]*onStatusChange\?\.\("error"/);
  assert.match(engine, /pendingOperationCount\(\) === 0[\s\S]*onStatusChange\?\.\("synced"/);
});

test("sync activity lives beside the Stylo title and reports the full lifecycle", () => {
  const banner = readFileSync("components/SyncStatusBanner.tsx", "utf8");
  const app = readFileSync("App.tsx", "utf8");
  const workspace = readFileSync("node-workspace/components/CreativeWorkspace.tsx", "utf8");
  const agent = readFileSync("node-workspace/components/StyloAgent.tsx", "utf8");

  assert.match(banner, /project\.status === "syncing"/);
  assert.match(banner, /if \(pendingOps === 0\) return null/);
  assert.match(banner, /正在连接云端/);
  assert.match(banner, /正在同步更改/);
  assert.match(banner, /已保存到云端/);
  assert.match(banner, /同步失败/);
  assert.match(banner, /SUCCESS_VISIBLE_MS = 1600/);
  assert.doesNotMatch(banner, /fixed left-1\/2 top-4|<button|backdrop-blur|rounded-full/);
  assert.match(workspace, /titleStatus=\{/);
  assert.match(agent, /flex min-w-0 flex-col items-start/);
  assert.match(agent, /\{titleStatus\}/);
  assert.doesNotMatch(app, /<SyncStatusBanner/);
  assert.match(app, /usePersistedState<ProjectData>[\s\S]*debounceMs: 240/);
});

test("realtime room ACK path is incremental and compacts only after an edit burst", () => {
  const worker = readFileSync("realtime-worker/src/index.ts", "utf8");

  assert.match(worker, /CREATE TABLE IF NOT EXISTS room_updates/);
  assert.match(worker, /INSERT INTO room_updates/);
  assert.match(worker, /pending_bytes = pending_bytes \+ \?2/);
  assert.match(worker, /PROJECTION_DEBOUNCE_MS = 450/);
  assert.match(worker, /setAlarm\(Date\.now\(\) \+ delay\)/);
  assert.match(worker, /async alarm\(\)[\s\S]*flushProjection/);
  assert.match(worker, /PROJECTION_BYTE_THRESHOLD = 512_000/);
  assert.match(worker, /WHERE user_project_documents\.server_seq <= excluded\.server_seq/);
  assert.doesNotMatch(worker, /await this\.env\.DB\.(?:batch|prepare)[\s\S]{0,800}socket\.send\(JSON\.stringify\(\{ type: "ack"/);
});
