-- NOVA local schema for PGlite (zero-setup local database)
-- Uses TEXT for all IDs (UUID as text) and TEXT for timestamps.
-- Vector dimension: 768 (nomic-embed-text default).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT now()::text
);

CREATE TABLE IF NOT EXISTS conversations (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id          TEXT NOT NULL,
  started_at       TEXT NOT NULL DEFAULT now()::text,
  ended_at         TEXT,
  summary          TEXT,
  memory_extracted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content         TEXT NOT NULL,
  tool_name       TEXT,
  tool_input      TEXT,
  tool_output     TEXT,
  created_at      TEXT NOT NULL DEFAULT now()::text
);

CREATE TABLE IF NOT EXISTS memories (
  id                     TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id                TEXT NOT NULL,
  content                TEXT NOT NULL,
  category               TEXT NOT NULL CHECK (category IN ('fact', 'preference', 'observation', 'personality')),
  embedding              vector(768) NOT NULL,
  source_conversation_id TEXT,
  confidence             REAL NOT NULL DEFAULT 1.0,
  superseded_by          TEXT REFERENCES memories(id),
  access_count           INTEGER NOT NULL DEFAULT 0,
  last_accessed_at       TEXT,
  promoted_to_tier1      INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL DEFAULT now()::text,
  updated_at             TEXT NOT NULL DEFAULT now()::text
);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT now()::text
);
