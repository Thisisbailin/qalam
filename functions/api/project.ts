import { getUserId, jsonResponse } from "./_auth";
import { requireRequestProjectId } from "./_projectScope";
import {
  flushRealtimeProjectProjection,
  type RealtimeProjectionEnv,
} from "./_realtimeProjection";
import { hasProjectCatalogEntry } from "./_projectCatalog";

type Env = RealtimeProjectionEnv & {
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
};
export const onRequestGet = async (context: { request: Request; env: Env }) => {
  try {
    const userId = await getUserId(context.request, context.env);
    const projectId = requireRequestProjectId(context.request);
    if (!await hasProjectCatalogEntry(context.env.DB, userId, projectId)) {
      return new Response("Not Found", { status: 404 });
    }
    await flushRealtimeProjectProjection(context.env, userId, projectId);
    const row = await context.env.DB.prepare(
      `SELECT project_data, updated_at, server_seq
       FROM user_project_documents
       WHERE user_id = ?1 AND project_id = ?2`,
    ).bind(userId, projectId).first();
    if (!row) return new Response("Not Found", { status: 404 });

    let projectData: Record<string, unknown>;
    try {
      projectData = JSON.parse(String(row.project_data || "{}")) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: "Realtime project document is invalid" }, { status: 500 });
    }
    if (!Object.keys(projectData).length) return new Response("Not Found", { status: 404 });

    const updatedAt = Number(row.updated_at) || 0;
    return jsonResponse({
      projectData,
      updatedAt,
      serverSeq: Number(row.server_seq) || 0,
    }, {
      headers: {
        "cache-control": "no-store",
        etag: String(updatedAt),
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("GET /api/project error", error);
    return jsonResponse({ error: "Failed to load realtime project" }, { status: 500 });
  }
};

export const onRequestPut = async (context: { request: Request; env: Env }) => {
  try {
    await getUserId(context.request, context.env);
    const projectId = requireRequestProjectId(context.request);
    return jsonResponse({
      error: "Snapshot project writes have been retired; connect through project realtime sync.",
      code: "REALTIME_PROJECT_SYNC_REQUIRED",
      projectId,
    }, { status: 410 });
  } catch (error) {
    return error instanceof Response
      ? error
      : jsonResponse({ error: "Realtime project sync required" }, { status: 410 });
  }
};
