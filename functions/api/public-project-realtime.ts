import { getUserId } from "./_auth";
import { normalizeProjectId } from "./_projectScope";
import {
  readProjectVisibility,
  readPublicProfileByUsername,
  recordProfileVisit,
} from "./_publicAccess";
import { readWebSocketCredential } from "../../utils/websocketAuth";
import { ensureRealtimeProjectProjectionExists } from "./_realtimeProjection";
import type { D1DatabaseLike } from "./_types";

type Env = {
  DB: D1DatabaseLike;
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
  PROJECT_REALTIME: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
};

const REALTIME_PROTOCOL = "stylo-realtime.v1";

export const onRequestGet = async (context: { request: Request; env: Env }) => {
  try {
    if ((context.request.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    const token = readWebSocketCredential(context.request.headers.get("sec-websocket-protocol"));
    const authenticated = new Request(context.request, {
      headers: {
        ...Object.fromEntries(context.request.headers.entries()),
        authorization: token ? `Bearer ${token}` : "",
      },
    });
    const viewerUserId = await getUserId(authenticated, context.env);
    const url = new URL(context.request.url);
    const profile = await readPublicProfileByUsername(context.env.DB, url.searchParams.get("username"));
    const projectId = normalizeProjectId(url.searchParams.get("projectId"));
    if (!profile || !projectId) return new Response("Public project not found", { status: 404 });
    const access = await readProjectVisibility(context.env.DB, profile.user_id, projectId);
    if (!access.visible) return new Response("Public project not found", { status: 404 });
    const exists = await ensureRealtimeProjectProjectionExists(
      context.env,
      profile.user_id,
      projectId,
    );
    if (!exists) return new Response("Public project not found", { status: 404 });

    await recordProfileVisit(context.env.DB, {
      viewerUserId,
      ownerUserId: profile.user_id,
      projectId,
      visitSessionId: url.searchParams.get("visitSession"),
    });

    const roomId = context.env.PROJECT_REALTIME.idFromName(`${profile.user_id}:${projectId}`);
    const headers = new Headers(context.request.headers);
    headers.set("x-stylo-user-id", profile.user_id);
    headers.set("x-stylo-project-id", projectId);
    headers.set("x-stylo-access-mode", "view");
    headers.set("x-stylo-viewer-id", viewerUserId);
    headers.set("sec-websocket-protocol", REALTIME_PROTOCOL);
    headers.delete("authorization");
    return context.env.PROJECT_REALTIME.get(roomId).fetch(new Request(context.request, { headers }));
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("GET /api/public-project-realtime error", error);
    return new Response("Public project realtime connection failed", { status: 500 });
  }
};
