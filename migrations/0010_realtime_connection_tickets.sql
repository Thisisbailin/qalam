-- Browser WebSocket handshakes cannot set an Authorization header. Store only
-- hashes of short-lived, one-time connection tickets so Clerk session JWTs do
-- not need to travel in Sec-WebSocket-Protocol.
CREATE TABLE IF NOT EXISTS realtime_connection_tickets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_realtime_connection_tickets_expiry
  ON realtime_connection_tickets(expires_at);

CREATE INDEX IF NOT EXISTS idx_realtime_connection_tickets_user
  ON realtime_connection_tickets(user_id, issued_at DESC);
