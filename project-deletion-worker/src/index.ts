/// <reference types="@cloudflare/workers-types" />

import {
  createProjectDeletionCapability,
  hashProjectDeletionCapability,
  normalizeProjectDeletionQueueMessage,
  type ProjectDeletionQueueMessage,
} from "../../collaboration/projectDeletionProtocol";
import { notifyAccountProjectCatalogChanged } from "../../functions/api/_accountRealtime";
import {
  deleteStorageProjectChunk,
  resetD1UserData,
  resetRealtimeRooms,
  type ProjectLifecycleEnv,
} from "../../functions/api/_projectDataLifecycle";

type Env = Omit<ProjectLifecycleEnv, "DB" | "PROJECT_DELETION_QUEUE"> & {
  DB: D1Database;
  PROJECT_DELETION_QUEUE: Queue<ProjectDeletionQueueMessage>;
  SUPABASE_URL: string;
};

type DeletionJobRow = {
  job_id: string;
  user_id: string;
  project_id: string;
  status: "fencing" | "queued" | "cleaning" | "complete";
  cursor_json: string;
  attempts: number;
  removed_objects: number;
  lease_token: string | null;
  lease_until: number | null;
  updated_at: number;
};

const LEASE_MS = 120_000;
const FENCING_RECOVERY_AFTER_MS = 60_000;
const QUEUED_RECOVERY_AFTER_MS = 5 * 60_000;
const RECOVERY_LIMIT = 25;

const boundedError = (error: unknown) => (
  error instanceof Error ? error.message : String(error)
).slice(0, 512);

const log = (event: string, fields: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ event, ...fields }));
};

const claimJob = async (
  env: Env,
  message: ProjectDeletionQueueMessage,
  capabilityHash: string,
) => {
  const now = Date.now();
  const leaseToken = crypto.randomUUID();
  const row = await env.DB.prepare(
    `UPDATE project_deletion_jobs
     SET status = 'cleaning', attempts = attempts + 1,
         lease_token = ?1, lease_until = ?2, updated_at = ?3
     WHERE job_id = ?4
       AND capability_hash = ?5
       AND status IN ('queued', 'cleaning')
       AND (lease_until IS NULL OR lease_until < ?3)
     RETURNING job_id, user_id, project_id, status, cursor_json, attempts,
               removed_objects, lease_token, lease_until, updated_at`,
  ).bind(
    leaseToken,
    now + LEASE_MS,
    now,
    message.jobId,
    capabilityHash,
  ).first<DeletionJobRow>();
  return row ? { row, leaseToken } : null;
};

const processDeletionMessage = async (
  message: Message<ProjectDeletionQueueMessage>,
  env: Env,
) => {
  const payload = normalizeProjectDeletionQueueMessage(message.body);
  if (!payload) {
    log("project_deletion_message_rejected");
    message.ack();
    return;
  }
  const capabilityHash = await hashProjectDeletionCapability(payload.capability);
  const claimed = await claimJob(env, payload, capabilityHash);
  if (!claimed) {
    // A stale duplicate, a forged capability, an active lease, or an already
    // completed job must never extend the retry storm.
    message.ack();
    return;
  }
  const { row, leaseToken } = claimed;
  try {
    let cursor: unknown = {};
    try {
      cursor = JSON.parse(row.cursor_json || "{}");
    } catch {
      cursor = {};
    }
    const chunk = await deleteStorageProjectChunk(
      env,
      row.user_id,
      row.project_id,
      cursor,
    );
    const now = Date.now();
    if (chunk.done) {
      await env.DB.prepare(
        `UPDATE project_deletion_jobs
         SET status = 'complete', cursor_json = ?1,
             removed_objects = removed_objects + ?2,
             last_error = NULL, lease_token = NULL, lease_until = NULL,
             completed_at = ?3, updated_at = ?3
         WHERE job_id = ?4 AND lease_token = ?5`,
      ).bind(JSON.stringify(chunk.cursor), chunk.removed, now, row.job_id, leaseToken).run();
      log("project_deletion_complete", {
        jobId: row.job_id,
        attempts: row.attempts,
        removedInChunk: chunk.removed,
      });
      message.ack();
      return;
    }

    const advanced = await env.DB.prepare(
      `UPDATE project_deletion_jobs
       SET status = 'queued', cursor_json = ?1,
           removed_objects = removed_objects + ?2,
           last_error = NULL, lease_token = NULL, lease_until = NULL,
           updated_at = ?3
       WHERE job_id = ?4 AND lease_token = ?5`,
    ).bind(JSON.stringify(chunk.cursor), chunk.removed, now, row.job_id, leaseToken).run();
    if (Number(advanced.meta.changes || 0) !== 1) {
      throw new Error("Project deletion lease was lost before cursor persistence");
    }
    // Keep the same capability for continuation. If this send fails, retrying
    // the current message can reclaim the durable cursor without a lost-secret
    // window; the scheduled sweeper remains the final recovery boundary.
    await env.PROJECT_DELETION_QUEUE.send(payload);
    message.ack();
  } catch (error) {
    await env.DB.prepare(
      `UPDATE project_deletion_jobs
       SET status = 'queued', last_error = ?1,
           lease_token = NULL, lease_until = NULL, updated_at = ?2
       WHERE job_id = ?3 AND lease_token = ?4`,
    ).bind(boundedError(error), Date.now(), row.job_id, leaseToken).run().catch(() => undefined);
    console.error(JSON.stringify({
      event: "project_deletion_chunk_failed",
      jobId: row.job_id,
      attempt: message.attempts,
      error: boundedError(error),
    }));
    message.retry({ delaySeconds: Math.min(30 * (2 ** Math.min(message.attempts, 5)), 900) });
  }
};

const finishFencingJob = async (env: Env, row: DeletionJobRow) => {
  await resetRealtimeRooms(env, row.user_id, [row.project_id], "delete");
  await resetD1UserData(env, row.user_id, false, row.project_id, true);
  const capability = createProjectDeletionCapability();
  const capabilityHash = await hashProjectDeletionCapability(capability);
  const now = Date.now();
  const updated = await env.DB.prepare(
    `UPDATE project_deletion_jobs
     SET capability_hash = ?1, status = 'queued', last_error = NULL,
         lease_token = NULL, lease_until = NULL, updated_at = ?2
     WHERE job_id = ?3 AND status = 'fencing'`,
  ).bind(capabilityHash, now, row.job_id).run();
  if (Number(updated.meta.changes || 0) !== 1) return;
  await env.PROJECT_DELETION_QUEUE.send({ jobId: row.job_id, capability });
  await notifyAccountProjectCatalogChanged(env, row.user_id).catch(() => undefined);
  log("project_deletion_fence_recovered", { jobId: row.job_id });
};

const recoverQueuedJob = async (env: Env, row: DeletionJobRow) => {
  const capability = createProjectDeletionCapability();
  const capabilityHash = await hashProjectDeletionCapability(capability);
  const now = Date.now();
  const updated = await env.DB.prepare(
    `UPDATE project_deletion_jobs
     SET capability_hash = ?1, status = 'queued',
         lease_token = NULL, lease_until = NULL, updated_at = ?2
     WHERE job_id = ?3
       AND status IN ('queued', 'cleaning')
       AND (lease_until IS NULL OR lease_until < ?2)`,
  ).bind(capabilityHash, now, row.job_id).run();
  if (Number(updated.meta.changes || 0) !== 1) return;
  await env.PROJECT_DELETION_QUEUE.send({ jobId: row.job_id, capability });
  log("project_deletion_queue_recovered", { jobId: row.job_id });
};

const recoverDeletionJobs = async (env: Env) => {
  const now = Date.now();
  const rows = await env.DB.prepare(
    `SELECT job_id, user_id, project_id, status, cursor_json, attempts,
            removed_objects, lease_token, lease_until, updated_at
     FROM project_deletion_jobs
     WHERE (status = 'fencing' AND updated_at < ?1)
        OR (status = 'queued' AND updated_at < ?2)
        OR (status = 'cleaning' AND lease_until < ?3)
     ORDER BY updated_at ASC
     LIMIT ?4`,
  ).bind(
    now - FENCING_RECOVERY_AFTER_MS,
    now - QUEUED_RECOVERY_AFTER_MS,
    now,
    RECOVERY_LIMIT,
  ).all<DeletionJobRow>();
  for (const row of rows.results || []) {
    try {
      if (row.status === "fencing") await finishFencingJob(env, row);
      else await recoverQueuedJob(env, row);
    } catch (error) {
      await env.DB.prepare(
        `UPDATE project_deletion_jobs
         SET last_error = ?1, updated_at = ?2 WHERE job_id = ?3`,
      ).bind(boundedError(error), Date.now(), row.job_id).run().catch(() => undefined);
      console.error(JSON.stringify({
        event: "project_deletion_recovery_failed",
        jobId: row.job_id,
        error: boundedError(error),
      }));
    }
  }
};

export default {
  async queue(batch, env): Promise<void> {
    for (const message of batch.messages) {
      await processDeletionMessage(message, env);
    }
  },
  async scheduled(_controller, env, context): Promise<void> {
    context.waitUntil(recoverDeletionJobs(env));
  },
} satisfies ExportedHandler<Env, ProjectDeletionQueueMessage>;
