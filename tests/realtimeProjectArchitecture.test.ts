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
  assert.match(endpoint, /consumeRealtimeTicket/);
  assert.doesNotMatch(endpoint, /authorization:/);
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
  assert.match(worker, /this\.inspectCandidate\(candidate, attachedIdentity\.projectId\)/);
  assert.match(worker, /validateRealtimeProjectSnapshot/);
  assert.match(worker, /socket\.close\(1012, "Realtime stream interrupted; reconnect required"\)/);
  assert.match(worker, /raw\.length > MAX_REALTIME_MESSAGE_CHARS/);
  assert.match(worker, /SOCKET_RATE_MAX_MESSAGES/);
  assert.match(worker, /SOCKET_RATE_MAX_CHARS/);
  assert.match(worker, /MAX_PROJECT_ROOM_SOCKETS/);
  assert.match(worker, /MAX_OWNER_EDIT_SOCKETS/);
  assert.match(worker, /MAX_VIEWER_SOCKETS/);
  assert.match(worker, /for \(const peer of this\.state\.getWebSockets\(\)\.filter\(isOpenSocket\)\)/);
  assert.match(worker, /this\.sendSocketMessage\(peer, broadcast\)/);
  assert.match(worker, /realtime_socket_send_failed/);
  assert.match(worker, /stateVector: encodeUpdateBase64\(Y\.encodeStateVector\(this\.doc\)\)/);
});

test("browser realtime authentication uses short-lived one-time scoped tickets", () => {
  const session = read("sync/authenticatedFetch.ts");
  const issuer = read("functions/api/realtime-ticket.ts");
  const tickets = read("functions/api/_realtimeTicket.ts");
  const migration = read("migrations/0010_realtime_connection_tickets.sql");
  const projectGateway = read("functions/api/project-realtime.ts");
  const catalogGateway = read("functions/api/account-projects-realtime.ts");
  const publicGateway = read("functions/api/public-project-realtime.ts");

  assert.match(session, /this\.request\("\/api\/realtime-ticket"/);
  assert.match(session, /encodeWebSocketCredential\(ticket\)/);
  assert.doesNotMatch(session, /encodeWebSocketCredential\(token\)/);
  assert.match(issuer, /getUserId\(context\.request, context\.env\)/);
  assert.match(issuer, /realtime-ticket-minute/);
  assert.match(tickets, /crypto\.getRandomValues/);
  assert.match(tickets, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(tickets, /consumed_at IS NULL/);
  assert.match(tickets, /RETURNING user_id/);
  assert.match(migration, /token_hash TEXT PRIMARY KEY/);
  for (const gateway of [projectGateway, catalogGateway, publicGateway]) {
    assert.match(gateway, /consumeRealtimeTicket/);
    assert.doesNotMatch(gateway, /authorization:/);
  }
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
  assert.match(worker, /const replacement = new Y\.Doc\(\)/);
  assert.match(worker, /this\.doc = replacement/);
  assert.match(worker, /projected_seq, pending_bytes[\s\S]*VALUES \(1, \?1, \?2, 0, 0, \?3, -1/);
  assert.match(worker, /previousEpoch \+ 1/);
  assert.match(worker, /DELETE FROM room_updates/);
  assert.match(worker, /DELETE FROM room_operations/);
  assert.match(worker, /DELETE FROM user_project_documents/);
  assert.match(worker, /type: "reset"[\s\S]*epoch:/);
  assert.match(reset, /await resetRealtimeRooms\(/);
  assert.match(reset, /await markProjectsDeleted\(/);
  assert.match(lifecycle, /x-stylo-reset-mode/);
  assert.match(lifecycle, /deleteProjectCatalog = false/);
  assert.match(engine, /if \(message\.type === "reset"\)/);
  assert.match(engine, /this\.documentStore\.delete\(this\.storageKey\)/);
});

test("permanent deletion is project-scoped and prevents stale clients from reviving an ID", () => {
  const endpoint = read("functions/api/project-delete.ts");
  const lifecycle = read("functions/api/_projectDataLifecycle.ts");
  const gateway = read("functions/api/project-realtime.ts");
  const catalogAdmission = read("functions/api/_projectCatalog.ts");
  const worker = read("realtime-worker/src/index.ts");
  const catalog = read("sync/projectCatalog.ts");
  const migration = read("migrations/0006_project_deletion_tombstones.sql");
  const jobMigration = read("migrations/0011_project_deletion_jobs.sql");
  const deletionWorker = read("project-deletion-worker/src/index.ts");
  const deletionWorkerConfig = read("project-deletion-worker/wrangler.jsonc");
  const pageConfig = read("wrangler.toml");

  assert.match(endpoint, /permanentlyDeleteProject/);
  assert.match(endpoint, /Failed to permanently delete project/);
  assert.match(catalog, /\/api\/project-delete/);
  assert.doesNotMatch(catalog, /account-data-reset/);
  assert.match(endpoint, /cleanupStatus === "queued" \? 202 : 200/);
  assert.match(lifecycle, /INSERT INTO user_project_deletions[\s\S]*INSERT INTO project_deletion_jobs/);
  assert.match(lifecycle, /resetRealtimeRooms[\s\S]*resetD1UserData[\s\S]*PROJECT_DELETION_QUEUE\.send/);
  assert.match(lifecycle, /deleteStorageProjectChunk/);
  assert.match(jobMigration, /UNIQUE \(user_id, project_id\)/);
  assert.match(jobMigration, /status IN \('fencing', 'queued', 'cleaning', 'complete'\)/);
  assert.match(deletionWorker, /lease_token/);
  assert.match(deletionWorker, /message\.ack\(\)/);
  assert.match(deletionWorker, /message\.retry\(/);
  assert.match(deletionWorker, /recoverDeletionJobs/);
  assert.match(deletionWorkerConfig, /"dead_letter_queue": "stylo-project-deletion-dlq"/);
  assert.match(deletionWorkerConfig, /"crons": \["\*\/10 \* \* \* \*"\]/);
  assert.match(pageConfig, /binding = "PROJECT_DELETION_QUEUE"/);
  assert.doesNotMatch(lifecycle, /user_project_write_guards/);
  assert.match(migration, /PRIMARY KEY \(user_id, project_id\)/);
  assert.match(migration, /CREATE TRIGGER IF NOT EXISTS deny_deleted_project_document_insert/);
  assert.match(migration, /CREATE TRIGGER IF NOT EXISTS deny_deleted_agent_session_insert/);
  assert.match(migration, /RAISE\(ABORT, 'PROJECT_DELETED'\)/);
  assert.match(gateway, /admitProjectCatalogEntry/);
  assert.match(catalogAdmission, /FROM user_project_deletions/);
  assert.match(catalogAdmission, /ACCOUNT_PROJECT_LIMIT = 24/);
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

  assert.match(catalog, /FROM user_project_catalog/);
  assert.match(catalog, /LEFT JOIN user_project_documents/);
  assert.match(project, /FROM user_project_documents/);
  assert.match(agentState, /FROM user_project_documents/);
  assert.match(agentState, /buildAgentProjectStateFromRealtimeDocument/);
  assert.match(project, /flushRealtimeProjectProjection/);
  assert.match(agent, /flushRealtimeProjectProjection/);
  assert.match(projection, /https:\/\/stylo\.internal\/flush/);
  assert.match(worker, /private async flushProjection\(requiredSeq = this\.serverSeq\)/);
  assert.match(worker, /while \(\(Number\(this\.readRoomMeta\(\)\?\.projected_seq\) \|\| 0\) < requiredSeq\)/);
});

test("account project discovery is event-driven across already-open devices", () => {
  const app = read("App.tsx");
  const endpoint = read("functions/api/account-projects-realtime.ts");
  const notifier = read("functions/api/_accountRealtime.ts");
  const catalog = read("functions/api/projects.ts");
  const worker = read("realtime-worker/src/index.ts");
  const pageConfig = read("wrangler.toml");
  const workerConfig = read("realtime-worker/wrangler.toml");

  assert.match(app, /\/api\/account-projects-realtime/);
  assert.match(app, /message\.type === "catalog-changed"/);
  assert.doesNotMatch(app, /setInterval\([^)]*loadCloudProjectCatalog/);
  assert.match(endpoint, /consumeRealtimeTicket/);
  assert.match(endpoint, /ACCOUNT_REALTIME\.idFromName\(userId\)/);
  assert.match(notifier, /https:\/\/stylo\.internal\/notify/);
  assert.match(catalog, /notifyAccountProjectCatalogChanged/);
  assert.match(worker, /export class AccountCatalogRoom/);
  assert.match(worker, /type: "catalog-changed"/);
  assert.match(workerConfig, /class_name = "AccountCatalogRoom"/);
  assert.match(pageConfig, /name = "ACCOUNT_REALTIME"/);
});

test("local project changes enter Yjs immediately while network writes are coalesced", () => {
  const engine = read("sync/realtimeProjectSyncEngine.ts");
  const hook = read("hooks/useCloudSync.ts");
  const store = read("sync/realtimeDocumentStore.ts");

  assert.match(engine, /stage\(local: ProjectData\)[\s\S]*applyProjectSnapshot\(/);
  assert.match(engine, /this\.queueUpdate\(update\)/);
  assert.match(engine, /this\.stageTimer = setTimeout/);
  assert.match(engine, /latestLocalFingerprint/);
  assert.match(engine, /areProjectDocumentsSemanticallyEqual/);
  assert.match(engine, /scheduleDocumentPersistence/);
  assert.match(engine, /requeuePendingAcks/);
  assert.match(engine, /Y\.mergeUpdates/);
  assert.match(engine, /if \(update\.byteLength <= 2\) return/);
  assert.match(engine, /await this\.flushOutboxPersistence\(\)/);
  assert.match(engine, /if \(this\.pendingAcks\.size > 0\)/);
  assert.match(engine, /if \(this\.socket !== socket\) return/);
  assert.match(engine, /event\.data === "pong"/);
  assert.match(hook, /useLayoutEffect\(\(\) => \{[\s\S]*scopedEngine\?\.projectId === projectId[\s\S]*scopedEngine\.engine\.stage\(projectData\)/);
  assert.match(hook, /if \(engineRef\.current\?\.engine !== engine\) return/);
  assert.match(store, /outboxKey/);
  assert.match(store, /readRealtimeDocumentOutbox/);
  assert.match(store, /writeRealtimeDocumentOutbox/);
  assert.match(store, /writeRealtimeDocumentSessionState/);
  assert.match(store, /readRealtimeRejectedUpdates/);
  assert.match(engine, /queueMicrotask/);
  assert.match(engine, /handleSequenceGap/);
  assert.doesNotMatch(engine, /setInterval|\.refresh\(/);
  assert.doesNotMatch(hook, /refreshKey|forceCloudPull/);
});

test("realtime connections recover from transient initialization and stale close events", () => {
  const worker = read("realtime-worker/src/index.ts");

  assert.match(worker, /new WebSocketRequestResponsePair\("ping", "pong"\)/);
  assert.match(worker, /if \(raw === "ping"\) \{[\s\S]*this\.sendSocketMessage\(socket, "pong"\)/);
  assert.match(worker, /getWebSockets\(\)\.filter\(isOpenSocket\)/);
  assert.match(worker, /this\.identityPromise === guarded[\s\S]*this\.identityPromise = null/);
  assert.match(worker, /this\.loadPromise === guarded[\s\S]*this\.loadPromise = null/);
  assert.match(worker, /Realtime room update log does not reach server sequence/);
});

test("refreshing private media URLs is runtime-only and cannot create phantom edits", () => {
  const image = read("node-workspace/nodes/ImageInputNode.tsx");
  const audio = read("node-workspace/nodes/AudioInputNode.tsx");
  const video = read("node-workspace/nodes/VideoInputNode.tsx");
  const pdf = read("node-workspace/nodes/PdfInputNode.tsx");
  const reader = read("node-workspace/components/PdfReaderOverlay.tsx");

  assert.match(image, /setResolvedStorageUrl\(url\)/);
  assert.match(audio, /setResolvedStorageUrl\(url\)/);
  assert.match(video, /setResolvedStorageUrl\(url\)/);
  assert.match(pdf, /setResolvedStorageUrl\(url\)/);
  assert.match(reader, /const pdfSource = resolvedStorageUrl/);
  for (const source of [image, audio, video, pdf]) {
    assert.doesNotMatch(source, /url !== data\.(?:image|audio|video|pdf)\)[\s\S]{0,80}updateNodeData/);
  }
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
