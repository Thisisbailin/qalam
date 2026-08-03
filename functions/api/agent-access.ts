import { authenticateAgentRequest } from "./_agentAccess";
import { jsonResponse } from "./_auth";
import type { D1DatabaseLike, PagesContext } from "./_types";

type Env = {
  DB: D1DatabaseLike;
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
};

export const onRequestDelete = async (context: PagesContext<Env>) => {
  try {
    const auth = await authenticateAgentRequest(context.request, context.env);
    if (auth.kind !== "agent_access" || !auth.tokenHash) {
      return jsonResponse({ error: "An external Agent token is required" }, { status: 400 });
    }
    await context.env.DB.prepare(
      `UPDATE agent_access_tokens
       SET revoked_at = ?2
       WHERE token_hash = ?1 AND revoked_at IS NULL`,
    ).bind(auth.tokenHash, Date.now()).run();
    return jsonResponse({ ok: true });
  } catch (error) {
    return error instanceof Response
      ? error
      : jsonResponse({ error: "Failed to revoke Agent access" }, { status: 500 });
  }
};

