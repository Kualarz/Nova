-- Per-tool-call timeline for routine runs.
-- Lets the UI show what tools NOVA actually invoked during a routine.

CREATE TABLE IF NOT EXISTS routine_tool_calls (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       UUID NOT NULL REFERENCES routine_runs(id) ON DELETE CASCADE,
  tool_name    TEXT NOT NULL,
  tool_args    TEXT,                              -- JSON string
  tool_result  TEXT,                              -- truncated to 1000 chars
  status       TEXT NOT NULL DEFAULT 'success',   -- 'success' | 'error' | 'blocked'
  created_at   TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_routine_tool_calls_run ON routine_tool_calls(run_id, created_at);
