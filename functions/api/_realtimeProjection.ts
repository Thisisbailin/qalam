import { hasProjectCatalogEntry } from "./_projectCatalog";
import type { D1DatabaseLike } from "./_types";
import type { ProjectData } from "../../types";

export type RealtimeProjectionEnv = {
  DB: D1DatabaseLike;
  PROJECT_REALTIME?: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
};

export class RealtimeProjectRevisionConflict extends Error {
  constructor(
    public readonly currentRevision: number,
    message = "The Stylo project changed before this operation could be committed.",
    public readonly currentServerSeq = 0,
  ) {
    super(message);
    this.name = "RealtimeProjectRevisionConflict";
  }
}

export const applyRealtimeAgentProjectSnapshot = async (
  env: RealtimeProjectionEnv,
  userId: string,
  projectId: string,
  input: {
    expectedRevision: number;
    expectedServerSeq: number;
    projectData: ProjectData;
    actorId: string;
    operationId: string;
  },
) => {
  if (!env.PROJECT_REALTIME) throw new Error("Realtime project binding is unavailable");
  const roomId = env.PROJECT_REALTIME.idFromName(`${userId}:${projectId}`);
  const response = await env.PROJECT_REALTIME.get(roomId).fetch(
    new Request("https://stylo.internal/agent-apply", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-stylo-user-id": userId,
        "x-stylo-project-id": projectId,
      },
      body: JSON.stringify(input),
    }),
  );
  const payload = await response.json().catch(() => ({})) as {
    error?: unknown;
    currentRevision?: unknown;
    currentServerSeq?: unknown;
    revision?: unknown;
    serverSeq?: unknown;
  };
  if (response.status === 409) {
    throw new RealtimeProjectRevisionConflict(
      Number(payload.currentRevision) || 0,
      typeof payload.error === "string" ? payload.error : undefined,
      Number(payload.currentServerSeq) || 0,
    );
  }
  if (!response.ok) {
    throw new Error(typeof payload.error === "string"
      ? payload.error
      : `Realtime Agent write failed for project ${projectId}`);
  }
  return {
    revision: Number(payload.revision) || 0,
    serverSeq: Number(payload.serverSeq) || 0,
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
