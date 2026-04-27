-- Companion conversation flag — marks the user's persistent always-on chat with NOVA.
-- One row per user is expected to be flagged is_companion = 1.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_companion INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_conversations_companion ON conversations(is_companion) WHERE is_companion = 1;
