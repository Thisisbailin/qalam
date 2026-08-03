-- Short-lived external Agent access uses a device-pairing handshake. Browser
-- sessions approve a human-readable code; only the local device secret can
-- claim the resulting scoped token.
CREATE TABLE IF NOT EXISTS codex_pairing_requests (
  device_code_hash TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'consumed')),
  user_id TEXT,
  requested_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  approved_at INTEGER,
  consumed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_codex_pairing_user_code
  ON codex_pairing_requests(user_code, expires_at);

CREATE INDEX IF NOT EXISTS idx_codex_pairing_expiry
  ON codex_pairing_requests(expires_at);

CREATE TABLE IF NOT EXISTS agent_access_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope = 'project_read'),
  label TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_agent_access_tokens_user
  ON agent_access_tokens(user_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_access_tokens_expiry
  ON agent_access_tokens(expires_at);

