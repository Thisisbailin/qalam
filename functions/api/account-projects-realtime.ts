import { readWebSocketCredential } from "../../utils/websocketAuth";
import { consumeRealtimeTicket } from "./_realtimeTicket";
import type { D1DatabaseLike } from "./_types";

type Env = {
  DB: D1DatabaseLike;
  ACCOUNT_REALTIME: {
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
    const roomId = context.env.ACCOUNT_REALTIME.idFromName(userId);
    const headers = new Headers(context.request.headers);
    headers.set("x-stylo-user-id", userId);
    headers.set("sec-websocket-protocol", REALTIME_PROTOCOL);
    headers.delete("authorization");
    return context.env.ACCOUNT_REALTIME.get(roomId).fetch(
      new Request(context.request, { headers }),
    );
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("GET /api/account-projects-realtime error", error);
    return new Response("Account project realtime connection failed", { status: 500 });
  }
};
