import type { D1DatabaseLike } from "./_types";
import { normalizeRealtimeTicketScope } from "../../utils/realtimeTicketScope";

const TICKET_BYTES = 32;
const TICKET_TTL_MS = 30_000;
const CONSUMED_TICKET_RETENTION_MS = 5 * 60_000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const issueRealtimeTicket = async (
  db: D1DatabaseLike,
  userId: string,
  requestedPath: unknown,
) => {
  const scope = normalizeRealtimeTicketScope(requestedPath);
  if (!scope) throw new Response("Realtime ticket scope is invalid", { status: 400 });
  const bytes = new Uint8Array(TICKET_BYTES);
  crypto.getRandomValues(bytes);
  const ticket = toBase64Url(bytes);
  const tokenHash = await sha256Hex(ticket);
  const now = Date.now();
  const expiresAt = now + TICKET_TTL_MS;
  await db.batch([
    db.prepare(
      `DELETE FROM realtime_connection_tickets
       WHERE expires_at < ?1 OR (consumed_at IS NOT NULL AND consumed_at < ?2)`,
    ).bind(now, now - CONSUMED_TICKET_RETENTION_MS),
    db.prepare(
      `INSERT INTO realtime_connection_tickets
         (token_hash, user_id, scope, issued_at, expires_at, consumed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, NULL)`,
    ).bind(tokenHash, userId, scope, now, expiresAt),
  ]);
  return { ticket, expiresAt, scope };
};

export const consumeRealtimeTicket = async (
  db: D1DatabaseLike,
  ticket: string,
  requestedPath: string,
) => {
  let scopeInput = requestedPath;
  if (!requestedPath.startsWith("/")) {
    try {
      const url = new URL(requestedPath);
      scopeInput = `${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  }
  const scope = normalizeRealtimeTicketScope(scopeInput);
  if (!scope || !TOKEN_PATTERN.test(ticket)) return null;
  const tokenHash = await sha256Hex(ticket);
  const now = Date.now();
  const row = await db.prepare(
    `UPDATE realtime_connection_tickets
     SET consumed_at = ?1
     WHERE token_hash = ?2
       AND scope = ?3
       AND consumed_at IS NULL
       AND expires_at >= ?1
     RETURNING user_id`,
  ).bind(now, tokenHash, scope).first<{ user_id?: unknown }>();
  return typeof row?.user_id === "string" && row.user_id ? row.user_id : null;
};
