CREATE TABLE IF NOT EXISTS connector_permissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  connector    TEXT NOT NULL,    -- e.g., 'notion', 'gmail', 'web-search'
  tool         TEXT NOT NULL,    -- e.g., 'gmail.search', 'notion.create-page'
  permission   TEXT NOT NULL,    -- 'always-allow' | 'needs-approval' | 'never'
  created_at   TEXT NOT NULL DEFAULT (now()::text),
  UNIQUE (user_id, connector, tool)
);
CREATE INDEX IF NOT EXISTS idx_connector_perms_user ON connector_permissions(user_id, connector);
