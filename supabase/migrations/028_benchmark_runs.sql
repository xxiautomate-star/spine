-- 028 — public benchmark runs (Gate D — proof page)
--
-- Each row is one execution of the recall-quality eval (30 queries
-- against the seeded harness corpus, plus rolling totals snapshot).
-- The /proof page surfaces the latest row plus a sparkline of the
-- previous 12 rows; /api/proof/csv exports the full table.
--
-- Why a flat table not a star schema: this is a 1-row-per-week
-- artifact. We don't need joins. Storage is trivial.

CREATE TABLE IF NOT EXISTS benchmark_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at                timestamptz NOT NULL DEFAULT now(),

  -- Recall-quality metrics (from the Gate 2 + Gate A harnesses)
  precision_at_5        real NOT NULL,
  recall_at_10          real,
  false_positive_rate   real,

  -- Latency: median of the 30 queries' wall-clock /api/recall response time
  median_latency_ms     integer,
  p95_latency_ms        integer,

  -- Methodology snapshot — both let an external observer replay the eval.
  corpus_size           integer NOT NULL,
  query_count           integer NOT NULL,
  harness_name          text NOT NULL,
  notes                 text,

  -- Anonymous totals for the proof page's "scale" section. NOT keyed by
  -- user; aggregated across the whole platform. Recomputed every run.
  total_memories_count  bigint,
  total_users_count     bigint,

  -- Free-form JSON for additional metrics so we can ship new dimensions
  -- without another migration each time.
  extra                 jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_benchmark_runs_ran_at ON benchmark_runs(ran_at DESC);

-- spine_latest_benchmark() returns the most recent row or null.
-- Used by the /proof page server component so it doesn't have to
-- fetch + sort + slice.
CREATE OR REPLACE FUNCTION spine_latest_benchmark()
RETURNS SETOF benchmark_runs
LANGUAGE sql
STABLE
AS $$
  SELECT * FROM benchmark_runs ORDER BY ran_at DESC LIMIT 1;
$$;
