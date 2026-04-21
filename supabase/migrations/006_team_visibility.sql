-- Round 7: team visibility, project tag, Slack webhook, spine.config support

-- memory visibility: personal (default) | team (org-visible) | org (entire org)
ALTER TABLE spine_memories
  ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'personal'
  CONSTRAINT spine_memories_visibility_check
  CHECK (visibility IN ('personal', 'team', 'org'));

-- project slug tag for cross-project memory graph
ALTER TABLE spine_memories
  ADD COLUMN IF NOT EXISTS project TEXT;

CREATE INDEX IF NOT EXISTS spine_memories_project_idx
  ON spine_memories (user_id, project)
  WHERE deleted_at IS NULL AND project IS NOT NULL;

CREATE INDEX IF NOT EXISTS spine_memories_visibility_idx
  ON spine_memories (org_id, visibility)
  WHERE deleted_at IS NULL AND org_id IS NOT NULL;

-- store Slack webhook per user (for morning briefing)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS slack_webhook TEXT;

-- store briefing preferences
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS briefing_enabled BOOLEAN DEFAULT true;

-- Team memory RLS: allow org members to read team memories
-- The existing 004 policy already allows org_id-scoped reads.
-- We add a supplemental policy so team memories with visibility='team'
-- are readable by org members even if they're not in the SELECT policy.
-- (Existing policy covers this via org_id check — no new policy needed.)

-- update the spine_match_memories RPC to include team memories
-- we create a new overload that also returns org team memories
CREATE OR REPLACE FUNCTION public.spine_match_team_memories(
  p_user          uuid,
  p_org           uuid,
  p_query_embedding vector(1536),
  p_limit         int DEFAULT 10
)
RETURNS TABLE (
  id          uuid,
  user_id     uuid,
  content     text,
  source      text,
  tags        text[],
  type        text,
  project     text,
  visibility  text,
  created_at  timestamptz,
  similarity  float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    m.id, m.user_id, m.content, m.source, m.tags,
    m.type, m.project, m.visibility, m.created_at,
    1 - (m.embedding <=> p_query_embedding) AS similarity
  FROM spine_memories m
  WHERE m.deleted_at IS NULL
    AND (
      m.user_id = p_user
      OR (m.org_id = p_org AND m.visibility = 'team')
    )
  ORDER BY m.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.spine_match_team_memories TO service_role;
