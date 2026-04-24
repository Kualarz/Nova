-- Phase 2: Task queue for Claude Code sessions
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id       TEXT NOT NULL,
  description   TEXT NOT NULL,
  project_dir   TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running', 'done', 'error')),
  result        TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT now()::text,
  completed_at  TEXT
);

CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks (user_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx  ON tasks (status);
