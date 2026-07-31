-- Project existence and metadata are account data. They must not be inferred
-- from the eventually projected realtime document, otherwise a newly-created
-- or empty project is invisible on every other device.
CREATE TABLE IF NOT EXISTS user_project_catalog (
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  color TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  root_node_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_project_catalog_user_updated
  ON user_project_catalog(user_id, updated_at DESC, project_id ASC);

-- Existing projected documents remain discoverable after this migration.
INSERT OR IGNORE INTO user_project_catalog (
  user_id,
  project_id,
  title,
  color,
  duration_min,
  root_node_id,
  created_at,
  updated_at
)
SELECT
  user_id,
  project_id,
  COALESCE(NULLIF(json_extract(project_data, '$.fileName'), ''), project_id),
  COALESCE(NULLIF(json_extract(project_data, '$.flowProjects[0].color'), ''), 'amber'),
  COALESCE(json_extract(project_data, '$.flowProjects[0].durationMin'), 120),
  COALESCE(
    NULLIF(json_extract(project_data, '$.flowProjects[0].rootNodeId'), ''),
    'project-root-' || project_id
  ),
  COALESCE(json_extract(project_data, '$.flowProjects[0].createdAt'), updated_at),
  updated_at
FROM user_project_documents;

CREATE TRIGGER IF NOT EXISTS deny_deleted_project_catalog_insert
BEFORE INSERT ON user_project_catalog
WHEN EXISTS (
  SELECT 1 FROM user_project_deletions
  WHERE user_id = NEW.user_id AND project_id = NEW.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'PROJECT_DELETED');
END;

CREATE TRIGGER IF NOT EXISTS deny_deleted_project_catalog_update
BEFORE UPDATE ON user_project_catalog
WHEN EXISTS (
  SELECT 1 FROM user_project_deletions
  WHERE user_id = NEW.user_id AND project_id = NEW.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'PROJECT_DELETED');
END;
