import type { D1DatabaseLike } from "./_types";

export const ACCOUNT_PROJECT_LIMIT = 24;

export type ProjectCatalogDb = Pick<D1DatabaseLike, "prepare">;

export type ProjectCatalogAdmission = "available" | "deleted" | "limit";

export const hasProjectCatalogEntry = async (
  db: ProjectCatalogDb,
  userId: string,
  projectId: string,
) => Boolean(await db.prepare(
  `SELECT 1 FROM user_project_catalog
   WHERE user_id = ?1 AND project_id = ?2`,
).bind(userId, projectId).first());

/**
 * A realtime room may be the first cloud request made for a newly-created
 * project. Admit that project atomically, but never let the realtime route
 * bypass the account limit or revive a tombstoned project ID.
 */
export const admitProjectCatalogEntry = async (
  db: ProjectCatalogDb,
  userId: string,
  projectId: string,
): Promise<ProjectCatalogAdmission> => {
  const deleted = await db.prepare(
    `SELECT 1 FROM user_project_deletions
     WHERE user_id = ?1 AND project_id = ?2`,
  ).bind(userId, projectId).first();
  if (deleted) return "deleted";
  if (await hasProjectCatalogEntry(db, userId, projectId)) return "available";

  const now = Date.now();
  await db.prepare(
    `INSERT OR IGNORE INTO user_project_catalog
       (user_id, project_id, title, color, duration_min, root_node_id, created_at, updated_at)
     SELECT ?1, ?2, ?2, 'amber', 120, ?3, ?4, ?4
     WHERE NOT EXISTS (
       SELECT 1 FROM user_project_deletions
       WHERE user_id = ?1 AND project_id = ?2
     )
       AND (
         SELECT COUNT(*) FROM user_project_catalog WHERE user_id = ?1
       ) < ?5`,
  ).bind(
    userId,
    projectId,
    `project-root-${projectId}`,
    now,
    ACCOUNT_PROJECT_LIMIT,
  ).run();

  if (await hasProjectCatalogEntry(db, userId, projectId)) return "available";
  const tombstonedAfterAdmission = await db.prepare(
    `SELECT 1 FROM user_project_deletions
     WHERE user_id = ?1 AND project_id = ?2`,
  ).bind(userId, projectId).first();
  return tombstonedAfterAdmission ? "deleted" : "limit";
};
