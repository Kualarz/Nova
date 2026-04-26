CREATE TABLE IF NOT EXISTS projects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  instructions TEXT,
  created_at   TEXT NOT NULL DEFAULT (now()::text),
  updated_at   TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);

-- Link conversations to projects (nullable — chats can exist without a project)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);
