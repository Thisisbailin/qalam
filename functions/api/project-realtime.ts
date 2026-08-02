import { requireRequestProjectId } from "./_projectScope";
import { readWebSocketCredential } from "../../utils/websocketAuth";
import { admitProjectCatalogEntry } from "./_projectCatalog";
import type { D1DatabaseLike } from "./_types";
import { consumeRealtimeTicket } from "./_realtimeTicket";

type Env = {
  DB: D1DatabaseLike;
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
    const ticket = readWebSocketCredential(context.request.headers.get("sec-websocket-protocol"));
    const userId = await consumeRealtimeTicket(context.env.DB, ticket, context.request.url);
    if (!userId) return new Response("Realtime ticket is invalid or expired", { status: 401 });
    const projectId = requireRequestProjectId(context.request);
    const admission = await admitProjectCatalogEntry(context.env.DB, userId, projectId);
    if (admission === "deleted") {
      return new Response("Project was permanently deleted", { status: 410 });
    }
    if (admission === "limit") {
      return new Response("Account project limit reached", { status: 409 });
    }
    const roomId = context.env.PROJECT_REALTIME.idFromName(`${userId}:${projectId}`);
    const headers = new Headers(context.request.headers);
    headers.set("x-stylo-user-id", userId);
    headers.set("x-stylo-project-id", projectId);
    headers.set("x-stylo-access-mode", "edit");
    headers.set("x-stylo-viewer-id", userId);
    headers.set("sec-websocket-protocol", REALTIME_PROTOCOL);
    headers.delete("authorization");
    return context.env.PROJECT_REALTIME.get(roomId).fetch(new Request(context.request, { headers }));
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("GET /api/project-realtime error", error);
    return new Response("Realtime project connection failed", { status: 500 });
  }
};
