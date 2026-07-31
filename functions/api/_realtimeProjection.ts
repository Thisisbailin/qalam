import { hasProjectCatalogEntry } from "./_projectCatalog";
import type { D1DatabaseLike } from "./_types";

export type RealtimeProjectionEnv = {
  DB: D1DatabaseLike;
  PROJECT_REALTIME?: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
};

/**
 * Establishes a read barrier between the Durable Object's incremental
 * authority and the D1 JSON/Yjs projection consumed by HTTP and Agent routes.
 */
export const flushRealtimeProjectProjection = async (
  env: RealtimeProjectionEnv,
  userId: string,
  projectId: string,
) => {
  if (!env.PROJECT_REALTIME) {
    throw new Error("Realtime project binding is unavailable");
  }
  const roomId = env.PROJECT_REALTIME.idFromName(`${userId}:${projectId}`);
  const response = await env.PROJECT_REALTIME.get(roomId).fetch(
    new Request("https://stylo.internal/flush", {
      method: "POST",
      headers: {
        "x-stylo-user-id": userId,
        "x-stylo-project-id": projectId,
      },
    }),
  );
  if (!response.ok) {
    throw new Error(`Realtime projection flush failed for project ${projectId}`);
  }
  const result = await response.json() as { serverSeq?: unknown };
  return Number(result.serverSeq) || 0;
};

/**
 * Existence checks do not need to compact a room whose D1 projection already
 * exists. Only a brand-new project still inside the debounce window needs an
 * explicit flush before the check is repeated.
 */
export const ensureRealtimeProjectProjectionExists = async (
  env: RealtimeProjectionEnv,
  userId: string,
  projectId: string,
) => {
  if (!await hasProjectCatalogEntry(env.DB, userId, projectId)) return false;
  const readExisting = () => env.DB.prepare(
    "SELECT 1 FROM user_project_documents WHERE user_id = ?1 AND project_id = ?2",
  ).bind(userId, projectId).first();
  if (await readExisting()) return true;
  await flushRealtimeProjectProjection(env, userId, projectId);
  return Boolean(await readExisting());
};
