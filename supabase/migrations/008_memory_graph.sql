-- Migration 008: memory graph + retrieval_count for orphan detection
-- Idempotent — safe to re-run.

---------------------------------------------------------------
-- memory_edges: direct memory-to-memory links via shared entities
-- Populated by entity-extractor when a new memory shares entities
-- with existing memories. Used for graph expansion in recall.
---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.memory_edges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chunk_id_a       uuid NOT NULL REFERENCES public.memories(id) ON DELETE CASCADE,
  chunk_id_b       uuid NOT NULL REFERENCES public.memories(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL DEFAULT 'entity_linked'
    CONSTRAINT memory_edges_rel_check
    CHECK (relationship_type IN ('entity_linked', 'session_adjacent', 'conflict', 'supersedes')),
  entity_name      TEXT,
  weight           DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chunk_id_a, chunk_id_b, relationship_type)
);

-- Indexes for graph expansion queries (look up by either chunk)
CREATE INDEX IF NOT EXISTS memory_edges_a_user_idx
  ON public.memory_edges (user_id, chunk_id_a);
CREATE INDEX IF NOT EXISTS memory_edges_b_user_idx
  ON public.memory_edges (user_id, chunk_id_b);

ALTER TABLE public.memory_edges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_edges_owner_all ON public.memory_edges;
CREATE POLICY memory_edges_owner_all ON public.memory_edges
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

---------------------------------------------------------------
-- retrieval_count on memories — incremented by retrieval-touch.ts
-- Used to identify orphans (never recalled) for health dashboard.
---------------------------------------------------------------

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS retrieval_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS memories_retrieval_count_idx
  ON public.memories (user_id, retrieval_count)
  WHERE deleted_at IS NULL;

---------------------------------------------------------------
-- memory_graph_neighbors RPC — efficient bilateral edge lookup
-- Returns all memories directly linked to any of the input IDs
-- via memory_edges, excluding IDs already in the seed set.
---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.memory_graph_neighbors(
  p_user     uuid,
  p_seed_ids uuid[],
  p_limit    int DEFAULT 20
)
RETURNS TABLE (
  id               uuid,
  content          text,
  source           text,
  tags             text[],
  created_at       timestamptz,
  relationship_type TEXT,
  entity_name      TEXT,
  weight           double precision
)
LANGUAGE sql STABLE
AS $$
  SELECT DISTINCT ON (m.id)
    m.id,
    m.content,
    m.source,
    m.tags,
    m.created_at,
    e.relationship_type,
    e.entity_name,
    e.weight
  FROM public.memory_edges e
  JOIN public.memories m
    ON (m.id = CASE WHEN e.chunk_id_a = ANY(p_seed_ids) THEN e.chunk_id_b ELSE e.chunk_id_a END)
  WHERE e.user_id = p_user
    AND (e.chunk_id_a = ANY(p_seed_ids) OR e.chunk_id_b = ANY(p_seed_ids))
    AND NOT (m.id = ANY(p_seed_ids))
    AND m.deleted_at IS NULL
    AND m.embedding IS NOT NULL
  ORDER BY m.id, e.weight DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.memory_graph_neighbors(uuid, uuid[], int)
  TO authenticated, service_role;

---------------------------------------------------------------
-- health_stats RPC — single query for /dashboard/health
---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.spine_health_stats(
  p_user uuid
)
RETURNS JSON
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_total          bigint;
  v_by_date        json;
  v_orphan_count   bigint;
  v_edge_count     bigint;
  v_days_covered   int;
  v_coverage_pct   numeric;
BEGIN
  -- Total memories
  SELECT COUNT(*) INTO v_total
  FROM public.memories
  WHERE user_id = p_user AND deleted_at IS NULL;

  -- Per-day counts for last 30 days
  SELECT json_agg(row_to_json(d))
  INTO v_by_date
  FROM (
    SELECT
      date_trunc('day', created_at AT TIME ZONE 'UTC')::date::text AS day,
      COUNT(*)::int AS count
    FROM public.memories
    WHERE user_id = p_user
      AND deleted_at IS NULL
      AND created_at >= NOW() - INTERVAL '30 days'
    GROUP BY 1
    ORDER BY 1
  ) d;

  -- Orphaned chunks: never retrieved AND no entity edges
  SELECT COUNT(*) INTO v_orphan_count
  FROM public.memories m
  WHERE m.user_id = p_user
    AND m.deleted_at IS NULL
    AND COALESCE(m.retrieval_count, 0) = 0
    AND NOT EXISTS (
      SELECT 1 FROM public.memory_edges e
      WHERE e.user_id = p_user
        AND (e.chunk_id_a = m.id OR e.chunk_id_b = m.id)
    );

  -- Total graph edges
  SELECT COUNT(*) INTO v_edge_count
  FROM public.memory_edges
  WHERE user_id = p_user;

  -- Coverage: % of days in last 30 that have at least 1 memory
  SELECT COUNT(DISTINCT date_trunc('day', created_at AT TIME ZONE 'UTC')::date)
  INTO v_days_covered
  FROM public.memories
  WHERE user_id = p_user
    AND deleted_at IS NULL
    AND created_at >= NOW() - INTERVAL '30 days';

  v_coverage_pct := ROUND((v_days_covered::numeric / 30.0) * 100, 1);

  RETURN json_build_object(
    'total',         v_total,
    'by_date',       COALESCE(v_by_date, '[]'::json),
    'orphan_count',  v_orphan_count,
    'edge_count',    v_edge_count,
    'days_covered',  v_days_covered,
    'coverage_pct',  v_coverage_pct
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.spine_health_stats(uuid)
  TO authenticated, service_role;
