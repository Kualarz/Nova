-- Phase 4.3 — sub-agent runs.
-- One row per spawn of a specialist sub-agent (researcher, writer, coder, planner, …).
-- Lets the UI show a history of who did what and the produced output.

CREATE TABLE IF NOT EXISTS subagent_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_conv_id  UUID,                              -- conversation that spawned it (nullable)
  agent_name      TEXT NOT NULL,
  task            TEXT NOT NULL,
  result          TEXT,
  error           TEXT,
  status          TEXT NOT NULL DEFAULT 'running',   -- 'running' | 'success' | 'error'
  started_at      TEXT NOT NULL DEFAULT (now()::text),
  completed_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_subagent_runs_parent ON subagent_runs(parent_conv_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_subagent_runs_started ON subagent_runs(started_at DESC);
