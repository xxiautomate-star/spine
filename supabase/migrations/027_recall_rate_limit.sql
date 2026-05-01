-- 027 — daily recall rate limit counters
--
-- Gate B of the launch stress-test brief. Spine's per-recall vendor cost
-- is non-trivial (Haiku rerank input + output, plus the embedding API
-- on the query). Without a daily cap we cannot rule out a single power
-- user burning through our COGS in an afternoon. The plan limits live
-- in lib/plan-limits.ts; this migration is the persistence layer.
--
-- Schema:
--   PRIMARY KEY (user_id, day_utc) — one row per user-day. UPSERT-able
--   via Postgres ON CONFLICT, so the increment is a single round-trip.
--
-- Why day_utc rather than a sliding window: simpler accounting + lines
-- up with vendor billing days. Trade-off: a user can do 50 recalls at
-- 23:59 UTC and another 50 at 00:01 UTC. Acceptable for the threat
-- model — actual cost-of-goods abuse runs at thousands of calls/day.

CREATE TABLE IF NOT EXISTS recall_call_counts (
  user_id     uuid NOT NULL,
  day_utc     date NOT NULL,
  count       integer NOT NULL DEFAULT 0,
  last_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day_utc)
);

-- Cleanup: rows older than 30 days are evicted by a cron job. We keep
-- 30d of history so the dashboard can chart usage trends, but never need
-- it for the limit check itself (which is always today's row).
CREATE INDEX IF NOT EXISTS idx_recall_call_counts_day ON recall_call_counts(day_utc);

-- spine_increment_recall_count(p_user_id, p_day_utc, p_increment) RETURNS new_count
--   Atomic UPSERT-and-read. Caller compares the returned count against
--   the plan limit to decide allow/throttle/reject. Uses a single
--   query so we don't race a concurrent recall.
CREATE OR REPLACE FUNCTION spine_increment_recall_count(
  p_user_id uuid,
  p_day_utc date,
  p_increment integer
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO recall_call_counts (user_id, day_utc, count, last_at)
  VALUES (p_user_id, p_day_utc, p_increment, now())
  ON CONFLICT (user_id, day_utc) DO UPDATE
    SET count = recall_call_counts.count + EXCLUDED.count,
        last_at = now()
  RETURNING count INTO new_count;
  RETURN new_count;
END;
$$;

-- spine_get_recall_count_today(p_user_id) RETURNS count
--   Read-only helper for the dashboard / diary endpoint. Returns 0 if
--   the user hasn't recalled at all today.
CREATE OR REPLACE FUNCTION spine_get_recall_count_today(p_user_id uuid)
RETURNS integer
LANGUAGE sql
AS $$
  SELECT COALESCE(
    (SELECT count FROM recall_call_counts
     WHERE user_id = p_user_id AND day_utc = (now() AT TIME ZONE 'utc')::date),
    0
  );
$$;
