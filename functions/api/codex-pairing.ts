import {
  AGENT_ACCESS_TOKEN_PREFIX,
  AGENT_ACCESS_TTL_MS,
  DEVICE_CODE_PREFIX,
  PAIRING_TTL_MS,
  createUserCode,
  normalizeUserCode,
  randomSecret,
  sha256Base64Url,
} from "./_agentAccess";
import { getUserId, jsonResponse } from "./_auth";
import { enforceRateLimit } from "./_rateLimit";
import { readJsonRequest } from "./_request";
import type { D1DatabaseLike, PagesContext } from "./_types";

type Env = {
  DB: D1DatabaseLike;
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY?: string;
};

type PairingBody = {
  action?: unknown;
  userCode?: unknown;
  deviceCode?: unknown;
  label?: unknown;
};

const MAX_REQUEST_BYTES = 8 * 1_024;

const requestSubject = (request: Request) =>
  (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown")
    .split(",")[0]
    .trim()
    .slice(0, 128);

const startPairing = async (context: PagesContext<Env>) => {
  await enforceRateLimit({
    db: context.env.DB,
    namespace: "codex-pairing-start",
    subject: requestSubject(context.request),
    limit: 10,
    windowSeconds: 60,
  });
  const now = Date.now();
  const expiresAt = now + PAIRING_TTL_MS;
  const deviceCode = randomSecret(DEVICE_CODE_PREFIX);
  const deviceCodeHash = await sha256Base64Url(deviceCode);
  let userCode = "";
  let inserted = false;
  for (let attempt = 0; attempt < 4 && !inserted; attempt += 1) {
    userCode = createUserCode();
    try {
      await context.env.DB.prepare(
        `INSERT INTO codex_pairing_requests
           (device_code_hash, user_code, status, requested_at, expires_at)
         VALUES (?1, ?2, 'pending', ?3, ?4)`,
      ).bind(deviceCodeHash, userCode, now, expiresAt).run();
      inserted = true;
    } catch {
      // Human code collisions are improbable; retry with a fresh code.
    }
  }
  if (!inserted) {
    return jsonResponse({ error: "Could not allocate a pairing code" }, { status: 503 });
  }
  const verificationUrl = new URL(context.request.url);
  verificationUrl.pathname = "/";
  verificationUrl.search = "";
  verificationUrl.searchParams.set("app", "1");
  verificationUrl.searchParams.set("codex_pair", userCode);
  return jsonResponse({
    status: "pending",
    deviceCode,
    userCode,
    verificationUrl: verificationUrl.toString(),
    expiresAt,
    intervalSeconds: 2,
  });
};

const approvePairing = async (context: PagesContext<Env>, body: PairingBody) => {
  const userId = await getUserId(context.request, context.env);
  await enforceRateLimit({
    db: context.env.DB,
    namespace: "codex-pairing-approve",
    subject: userId,
    limit: 12,
    windowSeconds: 60,
  });
  const userCode = normalizeUserCode(body.userCode);
  if (!userCode) return jsonResponse({ error: "A valid pairing code is required" }, { status: 400 });
  const now = Date.now();
  const row = await context.env.DB.prepare(
    `UPDATE codex_pairing_requests
     SET status = 'approved', user_id = ?1, approved_at = COALESCE(approved_at, ?2)
     WHERE user_code = ?3
       AND expires_at > ?2
       AND status IN ('pending', 'approved')
       AND (user_id IS NULL OR user_id = ?1)
     RETURNING expires_at`,
  ).bind(userId, now, userCode).first<{ expires_at?: unknown }>();
  if (!row) {
    return jsonResponse({ error: "Pairing code is invalid, expired, or already used" }, { status: 409 });
  }
  return jsonResponse({ status: "approved", userCode, expiresAt: Number(row.expires_at) || 0 });
};

const pollPairing = async (context: PagesContext<Env>, body: PairingBody) => {
  const deviceCode = typeof body.deviceCode === "string" ? body.deviceCode.trim() : "";
  if (!deviceCode.startsWith(DEVICE_CODE_PREFIX) || deviceCode.length > 128) {
    return jsonResponse({ error: "A valid device code is required" }, { status: 400 });
  }
  const deviceCodeHash = await sha256Base64Url(deviceCode);
  await enforceRateLimit({
    db: context.env.DB,
    namespace: "codex-pairing-poll",
    subject: deviceCodeHash,
    limit: 40,
    windowSeconds: 60,
  });
  const now = Date.now();
  const pairing = await context.env.DB.prepare(
    `SELECT status, expires_at
     FROM codex_pairing_requests
     WHERE device_code_hash = ?1
     LIMIT 1`,
  ).bind(deviceCodeHash).first<{ status?: unknown; expires_at?: unknown }>();
  if (!pairing || Number(pairing.expires_at) <= now) {
    return jsonResponse({ error: "Pairing request expired" }, { status: 410 });
  }
  if (pairing.status === "pending") {
    return jsonResponse({ status: "pending", expiresAt: Number(pairing.expires_at), intervalSeconds: 2 }, { status: 202 });
  }
  if (pairing.status !== "approved") {
    return jsonResponse({ error: "Pairing request was already consumed" }, { status: 410 });
  }
  const claimed = await context.env.DB.prepare(
    `UPDATE codex_pairing_requests
     SET status = 'consumed', consumed_at = ?2
     WHERE device_code_hash = ?1
       AND status = 'approved'
       AND consumed_at IS NULL
       AND expires_at > ?2
     RETURNING user_id`,
  ).bind(deviceCodeHash, now).first<{ user_id?: unknown }>();
  if (!claimed || typeof claimed.user_id !== "string") {
    return jsonResponse({ error: "Pairing request was already consumed" }, { status: 410 });
  }
  const accessToken = randomSecret(AGENT_ACCESS_TOKEN_PREFIX);
  const accessTokenHash = await sha256Base64Url(accessToken);
  const expiresAt = now + AGENT_ACCESS_TTL_MS;
  const label = typeof body.label === "string" && body.label.trim()
    ? body.label.trim().slice(0, 120)
    : "Codex local MCP";
  await context.env.DB.prepare(
    `INSERT INTO agent_access_tokens
       (token_hash, user_id, scope, label, issued_at, expires_at)
     VALUES (?1, ?2, 'project_read', ?3, ?4, ?5)`,
  ).bind(accessTokenHash, claimed.user_id, label, now, expiresAt).run();
  return jsonResponse({
    status: "connected",
    accessToken,
    tokenType: "Bearer",
    scope: "project_read",
    expiresAt,
  });
};

export const onRequestPost = async (context: PagesContext<Env>) => {
  let body: PairingBody;
  try {
    body = await readJsonRequest<PairingBody>(context.request, MAX_REQUEST_BYTES);
    if (body.action === "start") return await startPairing(context);
    if (body.action === "approve") return await approvePairing(context, body);
    if (body.action === "poll") return await pollPairing(context, body);
    return jsonResponse({ error: "Unknown pairing action" }, { status: 400 });
  } catch (error) {
    return error instanceof Response
      ? error
      : jsonResponse({ error: "Codex pairing failed" }, { status: 500 });
  }
};

