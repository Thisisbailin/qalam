import { getUserId } from "./_auth";
import { readWebSocketCredential } from "../../utils/websocketAuth";

type Env = {
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
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
    const token = readWebSocketCredential(context.request.headers.get("sec-websocket-protocol"));
    const authenticated = new Request(context.request, {
      headers: {
        ...Object.fromEntries(context.request.headers.entries()),
        authorization: token ? `Bearer ${token}` : "",
      },
    });
    const userId = await getUserId(authenticated, context.env);
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
