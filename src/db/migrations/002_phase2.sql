-- Phase 2 tables

CREATE TABLE IF NOT EXISTS memory_connections (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  memory_a_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  memory_b_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  similarity  REAL NOT NULL,
  type        TEXT NOT NULL DEFAULT 'semantic',
  created_at  TEXT NOT NULL DEFAULT now()::text
);

CREATE TABLE IF NOT EXISTS routines (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL,
  cron        TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_run    TEXT,
  created_at  TEXT NOT NULL DEFAULT now()::text
);

CREATE TABLE IF NOT EXISTS dispatch_queue (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  prompt       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  result       TEXT,
  created_at   TEXT NOT NULL DEFAULT now()::text,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS hooks (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event      TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS action_log (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  session_id  TEXT,
  tool_name   TEXT,
  input       TEXT,
  output      TEXT,
  reversible  INTEGER NOT NULL DEFAULT 1,
  approved    INTEGER,
  created_at  TEXT NOT NULL DEFAULT now()::text
);
