-- Add type column to spine_memories for decision / bug / feature / context / fact
ALTER TABLE spine_memories
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'context'
  CONSTRAINT spine_memories_type_check
  CHECK (type IN ('decision', 'bug', 'feature', 'context', 'fact'));

CREATE INDEX IF NOT EXISTS spine_memories_type_idx ON spine_memories (user_id, type)
  WHERE deleted_at IS NULL;
