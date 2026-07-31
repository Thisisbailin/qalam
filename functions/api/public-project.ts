import { getUserId, jsonResponse } from "./_auth";
import { normalizeProjectId } from "./_projectScope";
import {
  readProjectVisibility,
  readPublicProfileByUsername,
  recordProfileVisit,
} from "./_publicAccess";
import {
  ensureRealtimeProjectProjectionExists,
  type RealtimeProjectionEnv,
} from "./_realtimeProjection";

type Env = RealtimeProjectionEnv & {
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
};

export const onRequestGet = async (context: { request: Request; env: Env }) => {
  try {
    const viewerUserId = await getUserId(context.request, context.env);
    const url = new URL(context.request.url);
    const projectId = normalizeProjectId(url.searchParams.get("projectId"));
    const profile = await readPublicProfileByUsername(context.env.DB, url.searchParams.get("username"));
    if (!profile || !projectId) return jsonResponse({ error: "Public project not found" }, { status: 404 });
    const access = await readProjectVisibility(context.env.DB, profile.user_id, projectId);
    if (!access.visible) return jsonResponse({ error: "Public project not found" }, { status: 404 });

    const exists = await ensureRealtimeProjectProjectionExists(
      context.env,
      profile.user_id,
      projectId,
    );
    if (!exists) return jsonResponse({ error: "Public project not found" }, { status: 404 });
    const row = await context.env.DB.prepare(
      `SELECT project_data, server_seq, updated_at
       FROM user_project_documents
       WHERE user_id = ?1 AND project_id = ?2`,
    ).bind(profile.user_id, projectId).first();
    if (!row) return jsonResponse({ error: "Public project not found" }, { status: 404 });

    await recordProfileVisit(context.env.DB, {
      viewerUserId,
      ownerUserId: profile.user_id,
      projectId,
      visitSessionId: url.searchParams.get("visitSession"),
    });
    return jsonResponse({
      projectId,
      projectData: JSON.parse(String(row.project_data || "{}")),
      serverSeq: Number(row.server_seq) || 0,
      updatedAt: Number(row.updated_at) || 0,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("GET /api/public-project error", error);
    return jsonResponse({ error: "Failed to load public project" }, { status: 500 });
  }
};
