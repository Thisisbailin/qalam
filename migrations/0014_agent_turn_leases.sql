CREATE TABLE IF NOT EXISTS agent_turn_leases (
  session_key TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_turn_leases_expiry
  ON agent_turn_leases(expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_turn_leases_idempotency
  ON agent_turn_leases(user_id, idempotency_key);
