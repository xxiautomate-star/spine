-- Migration 009: multi-repo reasoning infrastructure
-- spine_dependency_nodes, spine_dependency_edges, spine_session_history
-- Idempotent — safe to re-run.

---------------------------------------------------------------
-- Dependency graph — package-level and file-level nodes
---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.spine_dependency_nodes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  repo       text NOT NULL,
  name       text NOT NULL,
  type       text NOT NULL DEFAULT 'package'
    CONSTRAINT dep_nodes_type_check
    CHECK (type IN ('package', 'file', 'module')),
  version    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, repo, name, type)
);

CREATE INDEX IF NOT EXISTS dep_nodes_user_repo_idx
  ON public.spine_dependency_nodes (user_id, repo);
CREATE INDEX IF NOT EXISTS dep_nodes_name_idx
  ON public.spine_dependency_nodes (user_id, name);

ALTER TABLE public.spine_dependency_nodes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dep_nodes_owner_all ON public.spine_dependency_nodes;
CREATE POLICY dep_nodes_owner_all ON public.spine_dependency_nodes
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

---------------------------------------------------------------
-- Dependency edges — directed: from_node depends on to_node
---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.spine_dependency_edges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  repo       text NOT NULL,
  from_node  uuid NOT NULL REFERENCES public.spine_dependency_nodes(id) ON DELETE CASCADE,
  to_node    uuid NOT NULL REFERENCES public.spine_dependency_nodes(id) ON DELETE CASCADE,
  dep_type   text NOT NULL DEFAULT 'depends_on'
    CONSTRAINT dep_edges_type_check
    CHECK (dep_type IN ('depends_on', 'devDependency', 'peerDependency', 'imports')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_node, to_node, dep_type)
);

CREATE INDEX IF NOT EXISTS dep_edges_from_idx
  ON public.spine_dependency_edges (user_id, from_node);
CREATE INDEX IF NOT EXISTS dep_edges_to_idx
  ON public.spine_dependency_edges (user_id, to_node);

ALTER TABLE public.spine_dependency_edges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dep_edges_owner_all ON public.spine_dependency_edges;
CREATE POLICY dep_edges_owner_all ON public.spine_dependency_edges
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

---------------------------------------------------------------
-- Session history — per-conversation query/answer pairs
-- Enables follow-up questions without re-explaining context.
---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.spine_session_history (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid NOT NULL,
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  turn_index         integer NOT NULL DEFAULT 0,
  query              text NOT NULL,
  answer             text NOT NULL,
  context_memory_ids uuid[] DEFAULT '{}'::uuid[],
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_history_session_idx
  ON public.spine_session_history (session_id, turn_index);
CREATE INDEX IF NOT EXISTS session_history_user_idx
  ON public.spine_session_history (user_id, created_at DESC);

ALTER TABLE public.spine_session_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS session_history_owner_all ON public.spine_session_history;
CREATE POLICY session_history_owner_all ON public.spine_session_history
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Auto-prune sessions older than 7 days (keep the table lean)
-- Trigger fires on INSERT; deletes rows from same user older than 7 days.
CREATE OR REPLACE FUNCTION public.spine_prune_old_sessions()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.spine_session_history
  WHERE user_id = NEW.user_id
    AND created_at < NOW() - INTERVAL '7 days';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spine_session_prune_trigger ON public.spine_session_history;
CREATE TRIGGER spine_session_prune_trigger
  AFTER INSERT ON public.spine_session_history
  FOR EACH ROW EXECUTE FUNCTION public.spine_prune_old_sessions();

---------------------------------------------------------------
-- spine_repo_hybrid_candidates — hybrid search scoped to one repo
-- Mirrors spine_hybrid_candidates but adds a project filter.
---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.spine_repo_hybrid_candidates(
  p_user            uuid,
  p_query           text,
  p_query_embedding vector(1536),
  p_project         text,
  p_limit           int DEFAULT 15
)
RETURNS TABLE (
  id             uuid,
  content        text,
  source         text,
  tags           text[],
  type           text,
  project        text,
  created_at     timestamptz,
  vec_similarity double precision,
  bm25_rank      double precision
)
LANGUAGE sql STABLE
AS $$
  WITH vec AS (
    SELECT m.id, 1 - (m.embedding <=> p_query_embedding) AS sim
    FROM public.memories m
    WHERE m.user_id = p_user
      AND m.project = p_project
      AND m.deleted_at IS NULL
      AND m.embedding IS NOT NULL
    ORDER BY m.embedding <=> p_query_embedding
    LIMIT p_limit
  ),
  bm25 AS (
    SELECT m.id,
           ts_rank(m.content_tsv, websearch_to_tsquery('english', p_query)) AS rank
    FROM public.memories m
    WHERE m.user_id = p_user
      AND m.project = p_project
      AND m.deleted_at IS NULL
      AND m.content_tsv @@ websearch_to_tsquery('english', p_query)
    ORDER BY rank DESC
    LIMIT p_limit
  ),
  ids AS (SELECT id FROM vec UNION SELECT id FROM bm25)
  SELECT
    m.id, m.content, m.source, m.tags,
    COALESCE(m.type, 'context') AS type,
    m.project, m.created_at,
    COALESCE(vec.sim,   0)::double precision AS vec_similarity,
    COALESCE(bm25.rank, 0)::double precision AS bm25_rank
  FROM public.memories m
  JOIN ids      ON ids.id   = m.id
  LEFT JOIN vec  ON vec.id   = m.id
  LEFT JOIN bm25 ON bm25.id  = m.id;
$$;

GRANT EXECUTE ON FUNCTION public.spine_repo_hybrid_candidates(uuid, text, vector, text, int)
  TO authenticated, service_role;
