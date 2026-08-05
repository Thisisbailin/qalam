import type { D1DatabaseLike } from "./_types";

const TURN_LEASE_MS = 6 * 60_000;

const changedRows = (result: any) => Number(result?.meta?.changes ?? result?.changes ?? 0);

export const acquireAgentTurnLease = async ({
  db,
  sessionKey,
  turnId,
  idempotencyKey,
  userId,
  projectId,
  now = Date.now(),
}: {
  db: D1DatabaseLike;
  sessionKey: string;
  turnId: string;
  idempotencyKey: string;
  userId: string;
  projectId: string;
  now?: number;
}) => {
  try {
    const result = await db.prepare(
      `INSERT INTO agent_turn_leases
         (session_key, turn_id, idempotency_key, user_id, project_id, acquired_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(session_key) DO UPDATE SET
         turn_id = excluded.turn_id,
         idempotency_key = excluded.idempotency_key,
         user_id = excluded.user_id,
         project_id = excluded.project_id,
         acquired_at = excluded.acquired_at,
         expires_at = excluded.expires_at
       WHERE agent_turn_leases.expires_at <= ?6`
    ).bind(
      sessionKey,
      turnId,
      idempotencyKey,
      userId,
      projectId,
      now,
      now + TURN_LEASE_MS,
    ).run();
    return changedRows(result) > 0;
  } catch (error) {
    if (/UNIQUE constraint failed: agent_turn_leases\.(?:idempotency_key|user_id)/i.test(String(error))) {
      return false;
    }
    throw error;
  }
};

export const releaseAgentTurnLease = async (
  db: D1DatabaseLike,
  sessionKey: string,
  turnId: string,
) => {
  await db.prepare(
    "DELETE FROM agent_turn_leases WHERE session_key = ?1 AND turn_id = ?2"
  ).bind(sessionKey, turnId).run();
};
