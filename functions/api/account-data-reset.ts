import { getUserId, jsonResponse } from "./_auth";
import { requireRequestProjectId } from "./_projectScope";
import { readJsonRequest } from "./_request";
import {
  deleteStorageUserData,
  listResetProjectIds,
  markProjectsDeleted,
  resetD1UserData,
  resetRealtimeRooms,
  type ProjectLifecycleEnv,
} from "./_projectDataLifecycle";
import { notifyAccountProjectCatalogChanged } from "./_accountRealtime";

type Env = ProjectLifecycleEnv & {
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
};

export { resetD1UserData } from "./_projectDataLifecycle";

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  try {
    const userId = await getUserId(context.request, context.env);
    const body = await readJsonRequest<{ scope?: unknown }>(context.request, 4 * 1024);
    const scope = body?.scope === "all" ? "all" as const : "project" as const;
    const includeAccountSettings = scope === "all";
    const projectId = includeAccountSettings
      ? undefined
      : requireRequestProjectId(context.request);
    const projectIds = await listResetProjectIds(context.env, userId, projectId);

    // A full account wipe must fence every former project ID before rooms are
    // closed. Keeping these tombstones prevents an offline stale client from
    // reconnecting later and resurrecting data the user explicitly erased.
    if (includeAccountSettings) {
      await markProjectsDeleted(context.env, userId, projectIds);
    }

    await resetRealtimeRooms(
      context.env,
      userId,
      projectIds,
      includeAccountSettings ? "delete" : "reset",
    );
    const d1 = await resetD1UserData(
      context.env,
      userId,
      includeAccountSettings,
      projectId,
    );

    const warnings: string[] = [];
    let storage: Awaited<ReturnType<typeof deleteStorageUserData>>;
    try {
      storage = await deleteStorageUserData(context.env, userId, projectId);
    } catch (error) {
      console.error("Account storage cleanup failed after D1 reset", error);
      warnings.push("Project state was reset, but some object storage cleanup must be retried.");
      storage = {
        skipped: true,
        reason: "Storage cleanup failed after project reset",
        buckets: {},
      };
    }
    await notifyAccountProjectCatalogChanged(context.env, userId).catch((error) => {
      console.warn("Account catalog realtime notification failed after reset", error);
    });

    return jsonResponse({
      ok: true,
      scope,
      d1,
      storage,
      ...(warnings.length ? { warnings } : {}),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Account data reset failed", error);
    return jsonResponse({
      error: "Failed to reset account data",
      code: "ACCOUNT_DATA_RESET_FAILED",
    }, { status: 500 });
  }
};
