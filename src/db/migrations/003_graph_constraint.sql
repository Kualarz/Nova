-- Unique index for canonical graph edges (memory_a_id < memory_b_id ordering enforced in app)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_memory_connection ON memory_connections (memory_a_id, memory_b_id);
