-- Routines: scheduled prompts NOVA executes automatically.
-- Distinct from `tasks` (ad-hoc background work).

CREATE TABLE IF NOT EXISTS routines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  prompt          TEXT NOT NULL,
  cron_expr       TEXT NOT NULL,           -- e.g., '0 8 * * 1-5' for weekday 8am
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_run_at     TEXT,
  last_run_status TEXT,                    -- 'success' | 'error' | NULL
  last_run_output TEXT,                    -- truncated to first 2000 chars
  created_at      TEXT NOT NULL DEFAULT (now()::text),
  updated_at      TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_routines_user    ON routines(user_id);
CREATE INDEX IF NOT EXISTS idx_routines_enabled ON routines(enabled) WHERE enabled = 1;

CREATE TABLE IF NOT EXISTS routine_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id   UUID NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  started_at   TEXT NOT NULL DEFAULT (now()::text),
  completed_at TEXT,
  status       TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'success' | 'error'
  output       TEXT,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_routine_runs_routine ON routine_runs(routine_id, started_at DESC);
