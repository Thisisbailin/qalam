import { authenticateAgentRequest } from "./_agentAccess";
import { jsonResponse } from "./_auth";
import { enforceRateLimit } from "./_rateLimit";
import type { D1DatabaseLike, PagesContext } from "./_types";

type Env = {
  DB: D1DatabaseLike;
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
};

export const onRequestGet = async (context: PagesContext<Env>) => {
  try {
    const auth = await authenticateAgentRequest(context.request, context.env);
    await enforceRateLimit({
      db: context.env.DB,
      namespace: "agent-projects",
      subject: auth.userId,
      limit: 60,
      windowSeconds: 60,
    });
    const rows = await context.env.DB.prepare(
      `SELECT c.project_id, c.title, c.updated_at,
              CASE WHEN d.project_id IS NULL THEN 0 ELSE 1 END AS has_document
       FROM user_project_catalog c
       LEFT JOIN user_project_documents d
         ON d.user_id = c.user_id AND d.project_id = c.project_id
       WHERE c.user_id = ?1
       ORDER BY c.updated_at DESC, c.project_id ASC
       LIMIT 100`,
    ).bind(auth.userId).all();
    return jsonResponse({
      projects: (rows.results || []).map((row: Record<string, unknown>) => ({
        projectId: String(row.project_id || ""),
        title: String(row.title || row.project_id || ""),
        updatedAt: Number(row.updated_at) || 0,
        hasDocument: Number(row.has_document) === 1,
      })).filter((item: { projectId: string }) => Boolean(item.projectId)),
    });
  } catch (error) {
    return error instanceof Response
      ? error
      : jsonResponse({ error: "Failed to list Agent projects" }, { status: 500 });
  }
};

