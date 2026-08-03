-- Permanent project deletion is a durable state machine. The project is
-- fenced synchronously; object storage is then removed in bounded queue jobs.
CREATE TABLE IF NOT EXISTS project_deletion_jobs (
  job_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  capability_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('fencing', 'queued', 'cleaning', 'complete')),
  cursor_json TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  removed_objects INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  lease_token TEXT,
  lease_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE (user_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_project_deletion_jobs_status
  ON project_deletion_jobs(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_project_deletion_jobs_lease
  ON project_deletion_jobs(status, lease_until);
