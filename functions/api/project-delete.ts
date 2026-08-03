import { getUserId, jsonResponse } from "./_auth";
import { requireRequestProjectId } from "./_projectScope";
import {
  permanentlyDeleteProject,
  type ProjectLifecycleEnv,
} from "./_projectDataLifecycle";

type Env = ProjectLifecycleEnv & {
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
};

export const onRequestDelete = async (context: { request: Request; env: Env }) => {
  try {
    const userId = await getUserId(context.request, context.env);
    const projectId = requireRequestProjectId(context.request);
    const result = await permanentlyDeleteProject(context.env, userId, projectId);
    return jsonResponse({ ok: true, projectId, ...result }, {
      status: result.cleanupStatus === "queued" ? 202 : 200,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("DELETE /api/project-delete error", error);
    const unavailable = error instanceof Error
      && error.message === "Project storage administration is unavailable";
    return jsonResponse({
      error: unavailable
        ? "Project storage administration is unavailable"
        : "Failed to permanently delete project",
      code: unavailable
        ? "PROJECT_STORAGE_UNAVAILABLE"
        : "PROJECT_DELETE_FAILED",
    }, { status: unavailable ? 503 : 500 });
  }
};
