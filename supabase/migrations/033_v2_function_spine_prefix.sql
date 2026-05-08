-- 033 — Apply spine_hybrid_candidates_v2 + missing columns adapted for spine_memories prefix
--
-- Migration 012 was never applied to prod because it referenced unprefixed `memories`
-- table. The codebase now uses spine_memories. This migration:
--   1. Adds superseded_by + last_confirmed_at columns to spine_memories (from 012)
--   2. Creates spine_hybrid_candidates_v2 function pointing at spine_memories
-- This unblocks /api/cron/benchmarks which was failing with "v2 function not found".

ALTER TABLE public.spine_memories
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.spine_memories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_confirmed_at timestamptz;

CREATE INDEX IF NOT EXISTS spine_memories_superseded_by_idx
  ON public.spine_memories (superseded_by)
  WHERE superseded_by IS NOT NULL;

UPDATE public.spine_memories
  SET last_confirmed_at = created_at
  WHERE last_confirmed_at IS NULL;

CREATE OR REPLACE FUNCTION public.spine_hybrid_candidates_v2(
  p_user            uuid,
  p_query           text,
  p_query_embedding vector(1536),
  p_limit           int DEFAULT 30
)
RETURNS TABLE (
  id                 uuid,
  content            text,
  source             text,
  tags               text[],
  created_at         timestamptz,
  last_confirmed_at  timestamptz,
  superseded_by      uuid,
  vec_similarity     double precision,
  bm25_rank          double precision
)
LANGUAGE sql STABLE
AS $func$
  WITH vec AS (
    SELECT m.id, 1 - (m.embedding <=> p_query_embedding) AS sim
    FROM public.spine_memories m
    WHERE m.user_id = p_user
      AND m.deleted_at IS NULL
      AND m.embedding IS NOT NULL
    ORDER BY m.embedding <=> p_query_embedding
    LIMIT p_limit
  ),
  bm25 AS (
    SELECT m.id,
           ts_rank(m.content_tsv, websearch_to_tsquery('english', COALESCE(p_query, ''))) AS rank
    FROM public.spine_memories m
    WHERE m.user_id = p_user
      AND m.deleted_at IS NULL
      AND p_query IS NOT NULL
      AND length(trim(p_query)) > 0
      AND m.content_tsv @@ websearch_to_tsquery('english', p_query)
    ORDER BY rank DESC
    LIMIT p_limit
  ),
  ids AS (
    SELECT id FROM vec
    UNION
    SELECT id FROM bm25
  )
  SELECT m.id,
         m.content,
         m.source,
         m.tags,
         m.created_at,
         m.last_confirmed_at,
         m.superseded_by,
         COALESCE(vec.sim, 0)::double precision AS vec_similarity,
         COALESCE(bm25.rank, 0)::double precision AS bm25_rank
  FROM public.spine_memories m
  JOIN ids ON ids.id = m.id
  LEFT JOIN vec ON vec.id = m.id
  LEFT JOIN bm25 ON bm25.id = m.id;
$func$;

GRANT EXECUTE ON FUNCTION public.spine_hybrid_candidates_v2(uuid, text, vector, int)
  TO authenticated, service_role;
