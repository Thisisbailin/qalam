import { getUserId, jsonResponse } from "./_auth";
import type { D1DatabaseLike } from "./_types";

export const AGENT_ACCESS_TOKEN_PREFIX = "stylo_agent_";
export const DEVICE_CODE_PREFIX = "stylo_device_";
export const AGENT_ACCESS_TTL_MS = 8 * 60 * 60 * 1_000;
export const PAIRING_TTL_MS = 10 * 60 * 1_000;

type AgentAccessEnv = {
  DB: D1DatabaseLike;
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
};

export type AgentAuthentication = {
  userId: string;
  kind: "clerk" | "agent_access";
  tokenHash?: string;
  scope: "project_read";
};

const encoder = new TextEncoder();

export const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

export const randomSecret = (prefix: string, byteLength = 32) => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return `${prefix}${toBase64Url(bytes)}`;
};

export const sha256Base64Url = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toBase64Url(new Uint8Array(digest));
};

const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const createUserCode = () => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const raw = Array.from(bytes, (byte) => USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
};

export const normalizeUserCode = (value: unknown) => {
  const raw = typeof value === "string" ? value.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : "";
};

export const extractBearer = (request: Request) => {
  const header = request.headers.get("authorization") || "";
  return header.match(/^Bearer\s+([^\s]+)$/i)?.[1] || "";
};

export const authenticateAgentRequest = async (
  request: Request,
  env: AgentAccessEnv,
): Promise<AgentAuthentication> => {
  const token = extractBearer(request);
  if (!token.startsWith(AGENT_ACCESS_TOKEN_PREFIX)) {
    return {
      userId: await getUserId(request, env),
      kind: "clerk",
      scope: "project_read",
    };
  }

  const tokenHash = await sha256Base64Url(token);
  const row = await env.DB.prepare(
    `SELECT user_id, scope, expires_at, revoked_at
     FROM agent_access_tokens
     WHERE token_hash = ?1
     LIMIT 1`,
  ).bind(tokenHash).first<{
    user_id?: unknown;
    scope?: unknown;
    expires_at?: unknown;
    revoked_at?: unknown;
  }>();
  const now = Date.now();
  if (
    !row ||
    typeof row.user_id !== "string" ||
    row.scope !== "project_read" ||
    Number(row.expires_at) <= now ||
    row.revoked_at !== null
  ) {
    throw jsonResponse({ error: "Unauthorized", detail: "Agent access token is invalid or expired" }, { status: 401 });
  }
  return {
    userId: row.user_id,
    kind: "agent_access",
    tokenHash,
    scope: "project_read",
  };
};

