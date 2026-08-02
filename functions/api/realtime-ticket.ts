import { getUserId, jsonResponse } from "./_auth";
import { enforceRateLimit } from "./_rateLimit";
import { issueRealtimeTicket } from "./_realtimeTicket";
import { readJsonRequest } from "./_request";
import type { D1DatabaseLike } from "./_types";

type Env = {
  DB: D1DatabaseLike;
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
};

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  try {
    const userId = await getUserId(context.request, context.env);
    await enforceRateLimit({
      db: context.env.DB,
      namespace: "realtime-ticket-minute",
      subject: userId,
      limit: 60,
      windowSeconds: 60,
    });
    await enforceRateLimit({
      db: context.env.DB,
      namespace: "realtime-ticket-hour",
      subject: userId,
      limit: 600,
      windowSeconds: 3_600,
    });
    const body = await readJsonRequest<{ path?: unknown }>(context.request, 4 * 1024);
    const issued = await issueRealtimeTicket(context.env.DB, userId, body?.path);
    return jsonResponse(issued, {
      headers: { "cache-control": "no-store, private" },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("POST /api/realtime-ticket error", error);
    return jsonResponse({
      error: "Unable to issue realtime connection ticket",
      code: "REALTIME_TICKET_FAILED",
    }, { status: 500 });
  }
};
