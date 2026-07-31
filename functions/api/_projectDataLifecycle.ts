import { createClient } from "@supabase/supabase-js";
import {
  notifyAccountProjectCatalogChanged,
  type AccountRealtimeEnv,
} from "./_accountRealtime";

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

const getSupabaseAdmin = (env: ProjectLifecycleEnv) => {
  const serviceRole = env.SUPABASE_SERVICE_ROLE
    || env.SUPABASE_SERVICE_ROLE_KEY
    || env.SUPABASE_SECRET_KEY;
  if (!env.SUPABASE_URL || !serviceRole) return null;
  return createClient(env.SUPABASE_URL, serviceRole);
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
  // Delete object storage first. If that fails, all authoritative D1 state
  // remains intact and the operation can safely be retried.
  const storage = await deleteStorageUserData(env, userId, projectId);
  if (storage.skipped) {
    throw new Error("Project storage administration is unavailable");
  }
  // From this point on, stale clients must be unable to recreate the ID.
  await markProjectDeleted(env, userId, projectId);
  await resetRealtimeRooms(env, userId, [projectId], "delete");
  const d1 = await resetD1UserData(env, userId, false, projectId, true);
  await notifyAccountProjectCatalogChanged(env, userId).catch((error) => {
    console.warn("Account catalog realtime notification failed after project deletion", error);
  });
  return { d1, storage };
};
