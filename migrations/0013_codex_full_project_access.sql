-- Preserve read-only pairing while allowing an explicitly approved, short-lived
-- full project-operator scope. Existing tokens and pairing requests remain
-- project_read.
ALTER TABLE codex_pairing_requests
  ADD COLUMN requested_scope TEXT NOT NULL DEFAULT 'project_read'
  CHECK (requested_scope IN ('project_read', 'project_full'));

DROP INDEX IF EXISTS idx_agent_access_tokens_user;
DROP INDEX IF EXISTS idx_agent_access_tokens_expiry;

CREATE TABLE agent_access_tokens_next (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('project_read', 'project_full')),
  label TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

INSERT INTO agent_access_tokens_next
  (token_hash, user_id, scope, label, issued_at, expires_at, revoked_at)
SELECT token_hash, user_id, scope, label, issued_at, expires_at, revoked_at
FROM agent_access_tokens;

DROP TABLE agent_access_tokens;
ALTER TABLE agent_access_tokens_next RENAME TO agent_access_tokens;

CREATE INDEX idx_agent_access_tokens_user
  ON agent_access_tokens(user_id, issued_at DESC);

CREATE INDEX idx_agent_access_tokens_expiry
  ON agent_access_tokens(expires_at);
