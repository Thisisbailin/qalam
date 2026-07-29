import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("project editing is authenticated and multi-writer without a device lease", () => {
  const app = read("App.tsx");
  const hook = read("hooks/useCloudSync.ts");
  const endpoint = read("functions/api/project-realtime.ts");
  const migration = read("migrations/0004_realtime_collaboration.sql");

  assert.doesNotMatch(app, /ProjectEditLease|projectEditLease|ProjectEditLeaseModal/);
  assert.doesNotMatch(hook, /project-lease|x-project-edit-lease|status === 423/);
  assert.equal(existsSync("hooks/useProjectEditLease.ts"), false);
  assert.equal(existsSync("components/ProjectEditLeaseModal.tsx"), false);
  assert.equal(existsSync("functions/api/project-lease.ts"), false);

  assert.match(endpoint, /readWebSocketCredential/);
  assert.match(endpoint, /getUserId\(authenticated, context\.env\)/);
  assert.match(endpoint, /idFromName\(`\$\{userId\}:\$\{projectId\}`\)/);
  assert.match(migration, /DROP TABLE IF EXISTS user_project_edit_leases/);
  assert.match(migration, /PRIMARY KEY \(user_id, project_id\)/);
  assert.match(migration, /UNIQUE \(user_id, project_id, op_id\)/);
});

test("the realtime room durably appends only incremental edits before ACK", () => {
  const worker = read("realtime-worker/src/index.ts");

  assert.match(worker, /deserializeAttachment/);
  assert.match(worker, /await this\.ensureLoaded\(attachedIdentity\)/);
  assert.match(worker, /CREATE TABLE IF NOT EXISTS room_updates/);
  assert.match(worker, /CREATE TABLE IF NOT EXISTS room_operations/);
  assert.match(worker, /CREATE TABLE IF NOT EXISTS _sql_schema_migrations/);
  assert.match(worker, /CREATE TABLE IF NOT EXISTS room_checkpoint_chunks/);
  assert.match(worker, /CREATE TABLE IF NOT EXISTS room_update_chunks/);
  assert.match(worker, /private writeCheckpointChunks/);
  assert.match(worker, /private readCheckpoint/);
  assert.match(worker, /MAX_SQL_BLOB_BYTES = 1_500_000/);
  assert.match(worker, /MAX_PROJECT_BYTES = REALTIME_PROJECT_MAX_BYTES/);
  assert.match(worker, /projectBytes > MAX_PROJECT_BYTES/);
  assert.match(worker, /SELECT server_seq FROM room_operations/);
  assert.match(worker, /INSERT INTO room_updates/);
  assert.match(worker, /INSERT INTO room_operations/);
  assert.match(worker, /this\.state\.storage\.transactionSync/);
  assert.match(worker, /this\.state\.waitUntil\(this\.scheduleProjection\(\)\)/);
  assert.match(worker, /async alarm\(\)[\s\S]*this\.flushProjection\(\)/);
  assert.match(worker, /INSERT INTO user_project_documents/);
  assert.match(worker, /ON CONFLICT\(user_id, project_id\) DO UPDATE/);
  assert.doesNotMatch(worker, /SELECT server_seq FROM user_project_updates/);
  assert.doesNotMatch(worker, /INSERT INTO user_project_updates/);
  assert.doesNotMatch(worker, /const candidate = new Y\.Doc\(\)/);
  assert.match(worker, /for \(const peer of this\.state\.getWebSockets\(\)\)/);
  assert.match(worker, /this\.sendSocketMessage\(peer, broadcast\)/);
  assert.match(worker, /realtime_socket_send_failed/);
  assert.match(worker, /stateVector: encodeUpdateBase64\(Y\.encodeStateVector\(this\.doc\)\)/);
});

test("realtime Worker enables sampled observability without logging project payloads", () => {
  const worker = read("realtime-worker/src/index.ts");
  const wrangler = read("realtime-worker/wrangler.toml");

  assert.match(wrangler, /\[observability\][\s\S]*enabled = true/);
  assert.match(wrangler, /\[observability\.logs\][\s\S]*head_sampling_rate = 1\.0/);
  assert.match(wrangler, /\[observability\.traces\][\s\S]*head_sampling_rate = 0\.05/);
  assert.match(worker, /console\.error\(JSON\.stringify\(\{/);
  assert.match(worker, /event,[\s\S]*serverSeq: this\.serverSeq/);
  assert.doesNotMatch(worker, /logError\([^)]*(?:serialized|checkpoint|message\.update)/);
});

test("project reset clears the active room before durable rows can be replayed", () => {
  const worker = read("realtime-worker/src/index.ts");
  const reset = read("functions/api/account-data-reset.ts");
  const lifecycle = read("functions/api/_projectDataLifecycle.ts");
  const engine = read("sync/realtimeProjectSyncEngine.ts");

  assert.match(worker, /private async resetProject/);
  assert.match(worker, /this\.doc\.getMap\("project"\)\.clear\(\)/);
  assert.match(worker, /DELETE FROM room_updates/);
  assert.match(worker, /DELETE FROM room_operations/);
  assert.match(worker, /DELETE FROM user_project_documents/);
  assert.match(worker, /JSON\.stringify\(\{ type: "reset", mode \}\)/);
  assert.match(reset, /await resetRealtimeRooms\(/);
  assert.match(lifecycle, /x-stylo-reset-mode/);
  assert.match(engine, /if \(message\.type === "reset"\)/);
  assert.match(engine, /this\.documentStore\.delete\(this\.storageKey\)/);
});

test("permanent deletion is project-scoped and prevents stale clients from reviving an ID", () => {
  const endpoint = read("functions/api/project-delete.ts");
  const lifecycle = read("functions/api/_projectDataLifecycle.ts");
  const gateway = read("functions/api/project-realtime.ts");
  const worker = read("realtime-worker/src/index.ts");
  const catalog = read("sync/projectCatalog.ts");
  const migration = read("migrations/0006_project_deletion_tombstones.sql");

  assert.match(endpoint, /permanentlyDeleteProject/);
  assert.match(endpoint, /Failed to permanently delete project/);
  assert.match(catalog, /\/api\/project-delete/);
  assert.doesNotMatch(catalog, /account-data-reset/);
  assert.match(lifecycle, /deleteStorageUserData[\s\S]*markProjectDeleted[\s\S]*resetRealtimeRooms[\s\S]*resetD1UserData/);
  assert.doesNotMatch(lifecycle, /user_project_write_guards/);
  assert.match(migration, /PRIMARY KEY \(user_id, project_id\)/);
  assert.match(migration, /CREATE TRIGGER IF NOT EXISTS deny_deleted_project_document_insert/);
  assert.match(migration, /CREATE TRIGGER IF NOT EXISTS deny_deleted_agent_session_insert/);
  assert.match(migration, /RAISE\(ABORT, 'PROJECT_DELETED'\)/);
  assert.match(gateway, /FROM user_project_deletions/);
  assert.match(gateway, /status: 410/);
  assert.match(worker, /mode === "delete"/);
  assert.match(worker, /peer\.close\(4004, "Project permanently deleted"\)/);
});

test("catalog, project reads, and Agent context share the realtime document authority", () => {
  const catalog = read("functions/api/projects.ts");
  const project = read("functions/api/project.ts");
  const agentState = read("functions/api/_agentProjectState.ts");
  const agent = read("functions/api/agent.ts");
  const projection = read("functions/api/_realtimeProjection.ts");
  const worker = read("realtime-worker/src/index.ts");

  assert.match(catalog, /FROM user_project_documents/);
  assert.match(project, /FROM user_project_documents/);
  assert.match(agentState, /FROM user_project_documents/);
  assert.match(agentState, /buildAgentProjectStateFromRealtimeDocument/);
  assert.match(project, /flushRealtimeProjectProjection/);
  assert.match(agent, /flushRealtimeProjectProjection/);
  assert.match(projection, /https:\/\/stylo\.internal\/flush/);
  assert.match(worker, /private async flushProjection\(requiredSeq = this\.serverSeq\)/);
  assert.match(worker, /while \(\(Number\(this\.readRoomMeta\(\)\?\.projected_seq\) \|\| 0\) < requiredSeq\)/);
});

test("local project changes enter Yjs immediately while network writes are coalesced", () => {
  const engine = read("sync/realtimeProjectSyncEngine.ts");

  assert.match(engine, /stage\(local: ProjectData\)[\s\S]*applyProjectSnapshot\(/);
  assert.match(engine, /this\.queueUpdate\(update\)/);
  assert.match(engine, /this\.stageTimer = setTimeout/);
  assert.match(engine, /latestLocalFingerprint/);
  assert.match(engine, /areProjectDocumentsSemanticallyEqual/);
  assert.match(engine, /scheduleDocumentPersistence/);
  assert.match(engine, /requeuePendingAcks/);
  assert.match(engine, /Y\.mergeUpdates/);
  assert.match(engine, /if \(update\.byteLength <= 2\) return/);
  assert.doesNotMatch(engine, /setInterval|\.refresh\(/);
  assert.doesNotMatch(read("hooks/useCloudSync.ts"), /refreshKey|forceCloudPull/);
});

test("legacy snapshot sync and version-choice UI are absent", () => {
  const app = read("App.tsx");
  const panel = read("node-workspace/components/SyncPanel.tsx");
  const settingsEngine = read("sync/accountSettingsSyncEngine.ts");
  const migration = read("migrations/0007_remove_snapshot_sync.sql");

  assert.equal(existsSync("sync/versionedSyncEngine.ts"), false);
  assert.equal(existsSync("components/ConflictModal.tsx"), false);
  assert.equal(existsSync("components/SecretsConflictModal.tsx"), false);
  assert.equal(existsSync("functions/api/project-snapshots.ts"), false);
  assert.equal(existsSync("functions/api/project-restore.ts"), false);
  assert.doesNotMatch(app, /onConflictConfirm|本地版本|云端版本|forceCloudPull/);
  assert.doesNotMatch(panel, /project-snapshots|project-restore|Sync now|Restore/);
  assert.match(settingsEngine, /mergeChangedFields/);
  assert.doesNotMatch(settingsEngine, /onConflict|setInterval/);
  assert.match(migration, /DROP TABLE IF EXISTS user_project_snapshots/);
});
