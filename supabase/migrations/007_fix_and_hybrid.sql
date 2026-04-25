-- Migration 007: fix table references from 005/006 (spine_memories → memories)
-- and add full hybrid search infrastructure for Round 8.
-- Idempotent — safe to re-run.

---------------------------------------------------------------
-- 005 columns on correct table
---------------------------------------------------------------

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'context'
  CONSTRAINT memories_type_check
  CHECK (type IN ('decision', 'bug', 'feature', 'context', 'fact'));

CREATE INDEX IF NOT EXISTS memories_type_idx ON public.memories (user_id, type)
  WHERE deleted_at IS NULL;

---------------------------------------------------------------
-- 006 columns on correct table
---------------------------------------------------------------

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'personal'
  CONSTRAINT memories_visibility_check
  CHECK (visibility IN ('personal', 'team', 'org'));

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS project TEXT;

CREATE INDEX IF NOT EXISTS memories_project_idx
  ON public.memories (user_id, project)
  WHERE deleted_at IS NULL AND project IS NOT NULL;

-- No org_id on memories — team visibility via tag 'team' instead.
CREATE INDEX IF NOT EXISTS memories_visibility_idx
  ON public.memories (user_id, visibility)
  WHERE deleted_at IS NULL;

---------------------------------------------------------------
-- Profiles: Slack webhook + briefing toggle (from 006)
---------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS slack_webhook TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS briefing_enabled BOOLEAN DEFAULT true;

---------------------------------------------------------------
-- Ensure content_tsv generated column exists (schema.sql has it,
-- but guard against fresh installs that skipped it)
---------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'memories'
      AND column_name  = 'content_tsv'
  ) THEN
    ALTER TABLE public.memories
      ADD COLUMN content_tsv tsvector
      GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

    CREATE INDEX IF NOT EXISTS memories_content_tsv_gin
      ON public.memories USING gin (content_tsv);
  END IF;
END$$;

---------------------------------------------------------------
-- Team memory search — no org_id dependency, uses tag 'team'
---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.spine_match_team_memories(
  p_user          uuid,
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
  FROM public.memories m
  WHERE m.deleted_at IS NULL
    AND (
      m.user_id = p_user
      OR (m.visibility = 'team' AND m.tags @> ARRAY['team'])
    )
  ORDER BY m.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.spine_match_team_memories(uuid, vector, int)
  TO authenticated, service_role;

---------------------------------------------------------------
-- Hybrid search with recency decay baked in
-- Returns vec_similarity, bm25_rank, age_days so the app layer
-- can do RRF + decay without a second round-trip.
---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.spine_hybrid_candidates(
  p_user             uuid,
  p_query            text,
  p_query_embedding  vector(1536),
  p_limit            int DEFAULT 30
)
RETURNS TABLE (
  id             uuid,
  content        text,
  source         text,
  tags           text[],
  type           text,
  created_at     timestamptz,
  vec_similarity double precision,
  bm25_rank      double precision
)
LANGUAGE sql STABLE
AS $$
  WITH vec AS (
    SELECT
      m.id,
      1 - (m.embedding <=> p_query_embedding) AS sim
    FROM public.memories m
    WHERE m.user_id = p_user
      AND m.deleted_at IS NULL
      AND m.embedding IS NOT NULL
    ORDER BY m.embedding <=> p_query_embedding
    LIMIT p_limit
  ),
  bm25 AS (
    SELECT
      m.id,
      ts_rank(m.content_tsv, websearch_to_tsquery('english', p_query)) AS rank
    FROM public.memories m
    WHERE m.user_id = p_user
      AND m.deleted_at IS NULL
      AND m.content_tsv @@ websearch_to_tsquery('english', p_query)
    ORDER BY rank DESC
    LIMIT p_limit
  ),
  ids AS (
    SELECT id FROM vec
    UNION
    SELECT id FROM bm25
  )
  SELECT
    m.id,
    m.content,
    m.source,
    m.tags,
    COALESCE(m.type, 'context') AS type,
    m.created_at,
    COALESCE(vec.sim,  0)::double precision AS vec_similarity,
    COALESCE(bm25.rank, 0)::double precision AS bm25_rank
  FROM public.memories m
  JOIN ids      ON ids.id      = m.id
  LEFT JOIN vec  ON vec.id      = m.id
  LEFT JOIN bm25 ON bm25.id    = m.id;
$$;

GRANT EXECUTE ON FUNCTION public.spine_hybrid_candidates(uuid, text, vector, int)
  TO authenticated, service_role;
