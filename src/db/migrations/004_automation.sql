CREATE TABLE IF NOT EXISTS hooks (
  id         TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  event      TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
