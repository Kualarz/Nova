CREATE TABLE IF NOT EXISTS project_memories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content      TEXT NOT NULL,
  source       TEXT NOT NULL,    -- 'chat-end' | 'nightly-cron'
  created_at   TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_project_memories_project ON project_memories(project_id);
CREATE INDEX IF NOT EXISTS idx_project_memories_created ON project_memories(project_id, created_at DESC);
