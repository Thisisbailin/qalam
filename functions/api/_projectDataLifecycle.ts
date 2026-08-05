import { createClient } from "@supabase/supabase-js";
import {
  notifyAccountProjectCatalogChanged,
  type AccountRealtimeEnv,
} from "./_accountRealtime";
import {
  createProjectDeletionCapability,
  hashProjectDeletionCapability,
  type ProjectDeletionQueueMessage,
} from "../../collaboration/projectDeletionProtocol";

export type ProjectLifecycleEnv = AccountRealtimeEnv & {
  DB: any;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  PROJECT_REALTIME?: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
  PROJECT_DELETION_QUEUE?: {
    send(message: ProjectDeletionQueueMessage): Promise<unknown>;
  };
};

type ResetPlan = {
  table: string;
  resultKey?: string;
  sql: string;
  projectScoped?: boolean;
};

const PROJECT_RESET_PLANS: ResetPlan[] = [
  { table: "agent_spans", sql: "DELETE FROM agent_spans WHERE user_id = ?1", projectScoped: true },
  { table: "agent_traces", sql: "DELETE FROM agent_traces WHERE user_id = ?1", projectScoped: true },
  { table: "agent_sessions", sql: "DELETE FROM agent_sessions WHERE user_id = ?1", projectScoped: true },
  { table: "agent_turn_leases", sql: "DELETE FROM agent_turn_leases WHERE user_id = ?1", projectScoped: true },
  { table: "user_seedance_assets", sql: "DELETE FROM user_seedance_assets WHERE user_id = ?1", projectScoped: true },
  { table: "user_project_documents", sql: "DELETE FROM user_project_documents WHERE user_id = ?1", projectScoped: true },
  { table: "user_project_visibility", sql: "DELETE FROM user_project_visibility WHERE user_id = ?1", projectScoped: true },
  { table: "user_profile_visits", resultKey: "user_profile_visits_inbound", sql: "DELETE FROM user_profile_visits WHERE owner_user_id = ?1", projectScoped: true },
];

const ACCOUNT_RESET_PLANS: ResetPlan[] = [
  { table: "user_project_catalog", sql: "DELETE FROM user_project_catalog WHERE user_id = ?1" },
  { table: "user_profile_visits", resultKey: "user_profile_visits_outbound", sql: "DELETE FROM user_profile_visits WHERE viewer_user_id = ?1" },
  { table: "user_sync_audit", sql: "DELETE FROM user_sync_audit WHERE user_id = ?1" },
  { table: "user_profile", sql: "DELETE FROM user_profile WHERE user_id = ?1" },
  { table: "user_secrets", sql: "DELETE FROM user_secrets WHERE user_id = ?1" },
];

const STORAGE_BUCKETS = ["assets", "public-assets"] as const;
const STORAGE_LIST_LIMIT = 100;
const STORAGE_DELETE_CHUNK_LIMIT = 100;
const STORAGE_DELETE_LIST_LIMIT = 12;
const STORAGE_DELETE_MAX_PENDING_FOLDERS = 2_048;

export type ProjectStorageDeletionCursor = {
  bucketIndex: number;
  folders: string[];
};

const getExistingTables = async (env: ProjectLifecycleEnv) => {
  const tableRows = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  ).all();
  return new Set<string>(
    (tableRows?.results || [])
      .map((row: { name?: unknown }) => typeof row.name === "string" ? row.name : "")
      .filter(Boolean),
  );
};

export const resetD1UserData = async (
  env: ProjectLifecycleEnv,
  userId: string,
  includeAccountSettings: boolean,
  projectId?: string,
  deleteProjectCatalog = false,
) => {
  const existingTables = await getExistingTables(env);
  const plans = [
    ...PROJECT_RESET_PLANS,
    ...(includeAccountSettings ? ACCOUNT_RESET_PLANS : []),
    ...(!includeAccountSettings && deleteProjectCatalog
      ? [{
          table: "user_project_catalog",
          sql: "DELETE FROM user_project_catalog WHERE user_id = ?1",
          projectScoped: true,
        }]
      : []),
  ].filter((plan) =>
    existingTables.has(plan.table)
    && (includeAccountSettings || plan.projectScoped)
  );
  if (!plans.length) return {};

  const results = await env.DB.batch(
    plans.map((plan) => plan.projectScoped && !includeAccountSettings
      ? env.DB.prepare(`${plan.sql} AND project_id = ?2`).bind(userId, projectId)
      : env.DB.prepare(plan.sql).bind(userId)),
  );
  return Object.fromEntries(
    plans.map((plan, index) => [
      plan.resultKey || plan.table,
      Number(results?.[index]?.meta?.changes || 0),
    ]),
  );
};

export const getSupabaseAdmin = (env: ProjectLifecycleEnv) => {
  const serviceRole = env.SUPABASE_SERVICE_ROLE
    || env.SUPABASE_SERVICE_ROLE_KEY
    || env.SUPABASE_SECRET_KEY;
  if (!env.SUPABASE_URL || !serviceRole) return null;
  return createClient(env.SUPABASE_URL, serviceRole);
};

const normalizeDeletionCursor = (
  value: unknown,
  prefix: string,
): ProjectStorageDeletionCursor => {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const bucketIndex = Number(record.bucketIndex);
  const folders = Array.isArray(record.folders)
    ? Array.from(new Set(record.folders.filter((folder): folder is string =>
        typeof folder === "string"
        && (folder === prefix || folder.startsWith(`${prefix}/`))
        && folder.length <= 512)))
      .slice(0, STORAGE_DELETE_MAX_PENDING_FOLDERS)
    : [];
  const safeBucketIndex = Number.isInteger(bucketIndex)
    ? Math.max(0, Math.min(STORAGE_BUCKETS.length, bucketIndex))
    : 0;
  return {
    bucketIndex: safeBucketIndex,
    folders: folders.length || safeBucketIndex >= STORAGE_BUCKETS.length
      ? folders
      : [prefix],
  };
};

/** Removes at most one bounded storage chunk. Re-running from an old cursor is
 * safe because Storage removal is idempotent and every listing starts at zero
 * after earlier files have been removed. */
export const deleteStorageProjectChunk = async (
  env: ProjectLifecycleEnv,
  userId: string,
  projectId: string,
  cursorValue: unknown,
) => {
  const supabase = getSupabaseAdmin(env);
  if (!supabase) throw new Error("Project storage administration is unavailable");
  const prefix = `users/${userId}/projects/${projectId}`;
  const cursor = normalizeDeletionCursor(cursorValue, prefix);
  let removed = 0;
  let listCalls = 0;

  while (
    cursor.bucketIndex < STORAGE_BUCKETS.length
    && removed < STORAGE_DELETE_CHUNK_LIMIT
    && listCalls < STORAGE_DELETE_LIST_LIMIT
  ) {
    if (!cursor.folders.length) {
      cursor.bucketIndex += 1;
      if (cursor.bucketIndex < STORAGE_BUCKETS.length) cursor.folders = [prefix];
      continue;
    }
    const folder = cursor.folders.pop()!;
    const bucket = STORAGE_BUCKETS[cursor.bucketIndex];
    const { data, error } = await supabase.storage.from(bucket).list(folder, {
      limit: STORAGE_LIST_LIMIT,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    });
    listCalls += 1;
    if (error) throw error;
    const items = data || [];
    const childFolders: string[] = [];
    const filePaths: string[] = [];
    for (const item of items) {
      const path = `${folder}/${item.name}`.replace(/^\/+/, "");
      if (item.id === null) childFolders.push(path);
      else filePaths.push(path);
    }
    const remaining = STORAGE_DELETE_CHUNK_LIMIT - removed;
    const removalBatch = filePaths.slice(0, remaining);
    if (filePaths.length > removalBatch.length || items.length >= STORAGE_LIST_LIMIT) {
      cursor.folders.push(folder);
    }
    for (let index = childFolders.length - 1; index >= 0; index -= 1) {
      if (
        cursor.folders.length < STORAGE_DELETE_MAX_PENDING_FOLDERS
        && !cursor.folders.includes(childFolders[index])
      ) cursor.folders.push(childFolders[index]);
    }
    if (removalBatch.length) {
      const { data: deleted, error: deleteError } = await supabase.storage
        .from(bucket)
        .remove(removalBatch);
      if (deleteError) throw deleteError;
      removed += Array.isArray(deleted) ? deleted.length : removalBatch.length;
    }
  }
  while (cursor.bucketIndex < STORAGE_BUCKETS.length && !cursor.folders.length) {
    cursor.bucketIndex += 1;
    if (cursor.bucketIndex < STORAGE_BUCKETS.length) cursor.folders = [prefix];
  }
  return {
    done: cursor.bucketIndex >= STORAGE_BUCKETS.length,
    cursor,
    removed,
    listCalls,
  };
};

const collectStoragePaths = async (
  supabase: any,
  bucket: string,
  prefix: string,
): Promise<string[]> => {
  const paths: string[] = [];
  const walk = async (folder: string) => {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .list(folder, {
          limit: STORAGE_LIST_LIMIT,
          offset,
          sortBy: { column: "name", order: "asc" },
        });
      if (error) throw error;
      const items = data || [];
      for (const item of items) {
        const path = `${folder}/${item.name}`.replace(/^\/+/, "");
        if (item.id === null) await walk(path);
        else paths.push(path);
      }
      if (items.length < STORAGE_LIST_LIMIT) break;
      offset += STORAGE_LIST_LIMIT;
    }
  };
  await walk(prefix.replace(/\/+$/, ""));
  return paths;
};

const removeStoragePaths = async (supabase: any, bucket: string, paths: string[]) => {
  let removed = 0;
  for (let index = 0; index < paths.length; index += STORAGE_LIST_LIMIT) {
    const batch = paths.slice(index, index + STORAGE_LIST_LIMIT);
    if (!batch.length) continue;
    const { data, error } = await supabase.storage.from(bucket).remove(batch);
    if (error) throw error;
    removed += Array.isArray(data) ? data.length : batch.length;
  }
  return removed;
};

export const deleteStorageUserData = async (
  env: ProjectLifecycleEnv,
  userId: string,
  projectId?: string,
) => {
  const supabase = getSupabaseAdmin(env);
  if (!supabase) {
    return {
      skipped: true as const,
      reason: "Supabase admin env missing",
      buckets: {},
    };
  }

  const prefix = projectId
    ? `users/${userId}/projects/${projectId}`
    : `users/${userId}`;
  const buckets: Record<string, { prefixes: Record<string, { listed: number; removed: number }> }> = {};
  for (const bucket of STORAGE_BUCKETS) {
    const paths = await collectStoragePaths(supabase, bucket, prefix);
    const removed = await removeStoragePaths(supabase, bucket, paths);
    buckets[bucket] = {
      prefixes: {
        [prefix]: { listed: paths.length, removed },
      },
    };
  }
  return { skipped: false as const, prefix, buckets };
};

export const listResetProjectIds = async (
  env: ProjectLifecycleEnv,
  userId: string,
  requestedProjectId?: string,
) => {
  if (requestedProjectId) return [requestedProjectId];
  const rows = await env.DB.prepare(
    `SELECT project_id FROM user_project_catalog WHERE user_id = ?1
     UNION
     SELECT project_id FROM user_project_documents WHERE user_id = ?1`,
  ).bind(userId).all();
  return (rows?.results || [])
    .map((row: { project_id?: unknown }) => typeof row.project_id === "string" ? row.project_id : "")
    .filter(Boolean);
};

export const resetRealtimeRooms = async (
  env: ProjectLifecycleEnv,
  userId: string,
  projectIds: string[],
  mode: "reset" | "delete",
) => {
  if (!env.PROJECT_REALTIME) return;
  for (const projectId of projectIds) {
    const roomId = env.PROJECT_REALTIME.idFromName(`${userId}:${projectId}`);
    const response = await env.PROJECT_REALTIME.get(roomId).fetch(
      new Request("https://stylo.internal/reset", {
        method: "POST",
        headers: {
          "x-stylo-user-id": userId,
          "x-stylo-project-id": projectId,
          "x-stylo-reset-mode": mode,
        },
      }),
    );
    if (!response.ok) {
      throw new Error(`Realtime room reset failed for project ${projectId}`);
    }
  }
};

export const markProjectDeleted = async (
  env: ProjectLifecycleEnv,
  userId: string,
  projectId: string,
) => {
  await env.DB.prepare(
    `INSERT INTO user_project_deletions (user_id, project_id, deleted_at)
     VALUES (?1, ?2, ?3)
     ON CONFLICT(user_id, project_id) DO UPDATE SET
       deleted_at = excluded.deleted_at`,
  ).bind(userId, projectId, Date.now()).run();
};

export const markProjectsDeleted = async (
  env: ProjectLifecycleEnv,
  userId: string,
  projectIds: string[],
) => {
  if (!projectIds.length) return;
  const deletedAt = Date.now();
  await env.DB.batch(projectIds.map((projectId) => env.DB.prepare(
    `INSERT INTO user_project_deletions (user_id, project_id, deleted_at)
     VALUES (?1, ?2, ?3)
     ON CONFLICT(user_id, project_id) DO UPDATE SET
       deleted_at = excluded.deleted_at`,
  ).bind(userId, projectId, deletedAt)));
};

export const permanentlyDeleteProject = async (
  env: ProjectLifecycleEnv,
  userId: string,
  projectId: string,
) => {
  if (!env.PROJECT_DELETION_QUEUE || !getSupabaseAdmin(env)) {
    throw new Error("Project storage administration is unavailable");
  }
  const capability = createProjectDeletionCapability();
  const capabilityHash = await hashProjectDeletionCapability(capability);
  const candidateJobId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user_project_deletions (user_id, project_id, deleted_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(user_id, project_id) DO UPDATE SET deleted_at = excluded.deleted_at`,
    ).bind(userId, projectId, now),
    env.DB.prepare(
      `INSERT INTO project_deletion_jobs
         (job_id, user_id, project_id, capability_hash, status, cursor_json,
          attempts, removed_objects, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'fencing', '{}', 0, 0, ?5, ?5)
       ON CONFLICT(user_id, project_id) DO UPDATE SET
         capability_hash = excluded.capability_hash,
         status = CASE
           WHEN project_deletion_jobs.status = 'complete' THEN 'complete'
           ELSE 'fencing'
         END,
         last_error = NULL,
         lease_token = NULL,
         lease_until = NULL,
         updated_at = excluded.updated_at`,
    ).bind(candidateJobId, userId, projectId, capabilityHash, now),
  ]);
  const job = await env.DB.prepare(
    `SELECT job_id, status FROM project_deletion_jobs
     WHERE user_id = ?1 AND project_id = ?2`,
  ).bind(userId, projectId).first() as { job_id?: unknown; status?: unknown } | null;
  const jobId = typeof job?.job_id === "string" ? job.job_id : "";
  if (!jobId) throw new Error("Project deletion job was not created");
  if (job?.status === "complete") return { jobId, cleanupStatus: "complete" as const };

  // The tombstone is committed before the room is closed, so no reconnect or
  // upload signer can recreate the project while deletion is in progress.
  await resetRealtimeRooms(env, userId, [projectId], "delete");
  const d1 = await resetD1UserData(env, userId, false, projectId, true);
  await env.DB.prepare(
    `UPDATE project_deletion_jobs
     SET status = 'queued', updated_at = ?1
     WHERE job_id = ?2 AND status <> 'complete'`,
  ).bind(Date.now(), jobId).run();
  await env.PROJECT_DELETION_QUEUE.send({ jobId, capability });
  await notifyAccountProjectCatalogChanged(env, userId).catch((error) => {
    console.warn("Account catalog realtime notification failed after project deletion", error);
  });
  return { d1, jobId, cleanupStatus: "queued" as const };
};
