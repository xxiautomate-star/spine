-- 030 — Pro-tier recall infrastructure
--
-- Closes the gap surfaced in the 2026-05-07 launch audit: code references
-- five tables that prod doesn't have, so several Pro-tier surfaces silently
-- degrade (Supabase returns empty .data, routes return null/empty rather
-- than 500). Adds them with the spine_ prefix the live deployment uses.
--
-- Six tables, in dependency order:
--   1. spine_rerank_weights              — per-user tuned ranker weights
--   2. spine_session_history             — per-conversation Q/A history
--   3. spine_dependency_nodes            — package / file / module graph
--   4. spine_dependency_edges            — graph edges (depends_on / imports)
--   5. spine_training_samples            — trainer-fuel placeholder
--   6. spine_saas_spine_weight_profiles  — saved slider configs from /spine/why
--
-- All RLS-locked to auth.uid() = user_id. spine_rerank_weights gets one
-- exception: rows with user_id IS NULL (the global default) are readable
-- by everyone authed so loadWeights() can fall back without a join.
--
-- This migration uses the prefixed names directly — code in lib/* that
-- writes `from('spine_xxx')` hits the proxy idempotently; code that writes
-- the unprefixed `from('saas_spine_weight_profiles')` resolves through the
-- prefix proxy to `spine_saas_spine_weight_profiles`.
--
-- This is NOT migration 015 unfolded. The training-pipeline tables
-- (saas_spine_recall_queries / candidates / labels) are deferred until
-- the labeling cron lands — spine_training_samples ships as an empty
-- table so the trainer can run no-op without crashing.

-- ────────────────────────────────────────────────────────────────────────
-- 1. spine_rerank_weights — per-user (or global) ranker fusion weights.
--    Read by lib/rerank-v2.ts:loadWeights() before every recall.
--    Written by scripts/train-rerank-weights.mjs and
--    /api/spine-weight-profiles activate flow.
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.spine_rerank_weights (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,    -- NULL = global default
  bm25_w          double precision NOT NULL,
  vec_w           double precision NOT NULL,
  recency_w       double precision NOT NULL,
  centrality_w    double precision NOT NULL,
  bias            double precision NOT NULL DEFAULT 0,
  model_version   text NOT NULL,
  training_n      integer NOT NULL DEFAULT 0,
  training_auc    real,
  is_active       boolean NOT NULL DEFAULT false,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Active-row lookup (per-user) — the trainer flips the prior active row
-- inactive then inserts a new active one, so the partial index keeps the
-- read path constant-cost.
CREATE UNIQUE INDEX IF NOT EXISTS spine_rerank_weights_active_per_user_idx
  ON public.spine_rerank_weights (user_id)
  WHERE is_active = true AND user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS spine_rerank_weights_active_global_idx
  ON public.spine_rerank_weights ((true))
  WHERE is_active = true AND user_id IS NULL;

CREATE INDEX IF NOT EXISTS spine_rerank_weights_user_created_idx
  ON public.spine_rerank_weights (user_id, created_at DESC);

ALTER TABLE public.spine_rerank_weights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spine_rerank_weights_owner_or_global_read
  ON public.spine_rerank_weights;
CREATE POLICY spine_rerank_weights_owner_or_global_read
  ON public.spine_rerank_weights
  FOR SELECT
  USING (user_id IS NULL OR user_id = auth.uid());

-- Seed the global default row so loadWeights() returns trained-looking
-- values even pre-training. Hand-tuned priors from migration 014.
INSERT INTO public.spine_rerank_weights (
  user_id, bm25_w, vec_w, recency_w, centrality_w,
  bias, model_version, training_n, is_active, notes
)
SELECT
  NULL, 0.25, 0.55, 0.10, 0.10,
  0.0, 'default-v1', 0, true,
  'seeded by migration 030 — hand-tuned priors, awaiting first trainer run'
WHERE NOT EXISTS (
  SELECT 1 FROM public.spine_rerank_weights
  WHERE user_id IS NULL AND is_active = true
);

-- ────────────────────────────────────────────────────────────────────────
-- 2. spine_session_history — per-conversation turn history.
--    Used by lib/session-memory.ts to answer follow-up queries without
--    re-explaining the codebase. Auto-trimmed to 7d window in the runtime
--    (no DB-side TTL — we want snapshots intact for support replay).
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.spine_session_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id          text NOT NULL,
  turn_index          integer NOT NULL,
  query               text NOT NULL,
  answer              text NOT NULL,
  context_memory_ids  uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spine_session_history_user_session_turn_idx
  ON public.spine_session_history (user_id, session_id, turn_index DESC);

CREATE INDEX IF NOT EXISTS spine_session_history_user_created_idx
  ON public.spine_session_history (user_id, created_at DESC);

ALTER TABLE public.spine_session_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spine_session_history_owner_all
  ON public.spine_session_history;
CREATE POLICY spine_session_history_owner_all
  ON public.spine_session_history
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────────────────
-- 3. spine_dependency_nodes — package / file / module graph nodes.
--    Used by lib/dependency-graph.ts to answer "where do we use X?"
--    across repos.
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.spine_dependency_nodes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  repo        text NOT NULL,
  name        text NOT NULL,
  type        text NOT NULL CHECK (type IN ('package', 'file', 'module')),
  version     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS spine_dependency_nodes_unique_idx
  ON public.spine_dependency_nodes (user_id, repo, name, type);

CREATE INDEX IF NOT EXISTS spine_dependency_nodes_name_idx
  ON public.spine_dependency_nodes (user_id, name)
  WHERE type = 'package';

ALTER TABLE public.spine_dependency_nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spine_dependency_nodes_owner_all
  ON public.spine_dependency_nodes;
CREATE POLICY spine_dependency_nodes_owner_all
  ON public.spine_dependency_nodes
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────────────────
-- 4. spine_dependency_edges — directed edges between graph nodes.
--    Cascades from either endpoint so deleting a node cleans up its edges.
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.spine_dependency_edges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  repo        text NOT NULL,
  from_node   uuid NOT NULL REFERENCES public.spine_dependency_nodes(id) ON DELETE CASCADE,
  to_node     uuid NOT NULL REFERENCES public.spine_dependency_nodes(id) ON DELETE CASCADE,
  dep_type    text NOT NULL CHECK (dep_type IN (
                'depends_on', 'devDependency', 'peerDependency', 'imports'
              )),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS spine_dependency_edges_unique_idx
  ON public.spine_dependency_edges (from_node, to_node, dep_type);

CREATE INDEX IF NOT EXISTS spine_dependency_edges_repo_idx
  ON public.spine_dependency_edges (user_id, repo);

CREATE INDEX IF NOT EXISTS spine_dependency_edges_to_node_idx
  ON public.spine_dependency_edges (to_node);

ALTER TABLE public.spine_dependency_edges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spine_dependency_edges_owner_all
  ON public.spine_dependency_edges;
CREATE POLICY spine_dependency_edges_owner_all
  ON public.spine_dependency_edges
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────────────────
-- 5. spine_training_samples — trainer fuel.
--    Migration 015 framed this as a VIEW over recall_queries / candidates
--    / labels. Those upstream tables are not yet in prod, so we ship the
--    leaf as a TABLE that the labeling pipeline writes into directly when
--    it eventually lands. Trainer reads `select user_id, query, why_*,
--    cross_encoder_score, label, rank_shown` — all columns shipped here.
--    Until rows land the trainer no-ops cleanly (see scripts/train-rerank-
--    weights.mjs MIN_POSITIVES check).
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.spine_training_samples (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  query                 text NOT NULL,
  memory_id             uuid,
  rank_shown            integer,
  why_bm25              double precision NOT NULL DEFAULT 0,
  why_vec               double precision NOT NULL DEFAULT 0,
  why_recency           double precision NOT NULL DEFAULT 0,
  why_centrality        double precision NOT NULL DEFAULT 0,
  cross_encoder_score   double precision,
  label                 boolean NOT NULL DEFAULT false,
  label_source          text NOT NULL DEFAULT 'none',
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spine_training_samples_user_label_idx
  ON public.spine_training_samples (user_id, label, created_at DESC);

ALTER TABLE public.spine_training_samples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spine_training_samples_owner_or_global_read
  ON public.spine_training_samples;
CREATE POLICY spine_training_samples_owner_or_global_read
  ON public.spine_training_samples
  FOR SELECT
  USING (user_id IS NULL OR user_id = auth.uid());

-- ────────────────────────────────────────────────────────────────────────
-- 6. spine_saas_spine_weight_profiles — saved slider presets.
--    Backs /api/spine-weight-profiles (GET/POST/DELETE). Code in that
--    route uses `from('saas_spine_weight_profiles')`; the prefix proxy
--    rewrites that to `spine_saas_spine_weight_profiles` — name preserved
--    here so the resolution works end-to-end.
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.spine_saas_spine_weight_profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  bm25_w        double precision NOT NULL,
  vec_w         double precision NOT NULL,
  recency_w     double precision NOT NULL,
  centrality_w  double precision NOT NULL,
  bias          double precision NOT NULL DEFAULT 0,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS spine_saas_spine_weight_profiles_user_name_idx
  ON public.spine_saas_spine_weight_profiles (user_id, name);

ALTER TABLE public.spine_saas_spine_weight_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spine_saas_spine_weight_profiles_owner_all
  ON public.spine_saas_spine_weight_profiles;
CREATE POLICY spine_saas_spine_weight_profiles_owner_all
  ON public.spine_saas_spine_weight_profiles
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
