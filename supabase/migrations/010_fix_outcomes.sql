-- Migration 010: fix outcome feedback loop
-- spine_fix_outcomes: Roman accepts/rejects Spine fixes → drives confidence priors
-- spine_confidence_priors: Bayesian update table, per file-pattern × hypothesis-type

CREATE TABLE IF NOT EXISTS public.spine_fix_outcomes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id        uuid,
  fix_fingerprint   text NOT NULL,   -- hash of hypothesis + file + diff
  file_pattern      text NOT NULL,   -- e.g. '*.tsx', 'api/route.ts', 'components/'
  hypothesis_type   text NOT NULL,   -- e.g. 'missing-null-guard', 'wrong-dep-array'
  outcome           text NOT NULL
    CONSTRAINT outcome_check
    CHECK (outcome IN ('accepted', 'rejected', 'modified', 'deferred')),
  actual_fix        text,            -- what Roman actually committed (if modified)
  confidence_at_time double precision,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fix_outcomes_user_idx
  ON public.spine_fix_outcomes (user_id, hypothesis_type, outcome);
CREATE INDEX IF NOT EXISTS fix_outcomes_file_idx
  ON public.spine_fix_outcomes (user_id, file_pattern);

ALTER TABLE public.spine_fix_outcomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fix_outcomes_owner_all ON public.spine_fix_outcomes;
CREATE POLICY fix_outcomes_owner_all ON public.spine_fix_outcomes
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Confidence priors — Bayesian accept/reject counts per (file_pattern, hypothesis_type)
CREATE TABLE IF NOT EXISTS public.spine_confidence_priors (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_pattern     text NOT NULL,
  hypothesis_type  text NOT NULL,
  accept_count     integer NOT NULL DEFAULT 0,
  reject_count     integer NOT NULL DEFAULT 0,
  total_count      integer NOT NULL DEFAULT 0,
  -- modifier: (accept_count + 1) / (total_count + 2)  — Laplace-smoothed
  -- stored for fast lookup; recomputed on each outcome write
  confidence_modifier double precision NOT NULL DEFAULT 0.5,
  last_updated     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, file_pattern, hypothesis_type)
);

CREATE INDEX IF NOT EXISTS priors_user_idx
  ON public.spine_confidence_priors (user_id, file_pattern);

ALTER TABLE public.spine_confidence_priors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS priors_owner_all ON public.spine_confidence_priors;
CREATE POLICY priors_owner_all ON public.spine_confidence_priors
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- RPC: record an outcome + atomically update the prior
CREATE OR REPLACE FUNCTION public.spine_record_fix_outcome(
  p_user           uuid,
  p_fingerprint    text,
  p_file_pattern   text,
  p_hypothesis     text,
  p_outcome        text,
  p_actual_fix     text DEFAULT NULL,
  p_confidence     double precision DEFAULT NULL,
  p_session_id     uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_accept int;
  v_reject int;
  v_total  int;
  v_mod    double precision;
BEGIN
  -- Insert outcome row
  INSERT INTO public.spine_fix_outcomes
    (user_id, session_id, fix_fingerprint, file_pattern, hypothesis_type,
     outcome, actual_fix, confidence_at_time)
  VALUES
    (p_user, p_session_id, p_fingerprint, p_file_pattern, p_hypothesis,
     p_outcome, p_actual_fix, p_confidence);

  -- Upsert prior with incremented counts
  INSERT INTO public.spine_confidence_priors
    (user_id, file_pattern, hypothesis_type, accept_count, reject_count,
     total_count, confidence_modifier)
  VALUES (
    p_user, p_file_pattern, p_hypothesis,
    CASE WHEN p_outcome = 'accepted' THEN 1 ELSE 0 END,
    CASE WHEN p_outcome = 'rejected' THEN 1 ELSE 0 END,
    1,
    0.5
  )
  ON CONFLICT (user_id, file_pattern, hypothesis_type) DO UPDATE SET
    accept_count = spine_confidence_priors.accept_count +
      CASE WHEN p_outcome = 'accepted' THEN 1 ELSE 0 END,
    reject_count = spine_confidence_priors.reject_count +
      CASE WHEN p_outcome = 'rejected' THEN 1 ELSE 0 END,
    total_count  = spine_confidence_priors.total_count + 1,
    last_updated = now();

  -- Recompute Laplace-smoothed modifier
  SELECT accept_count, reject_count, total_count
    INTO v_accept, v_reject, v_total
    FROM public.spine_confidence_priors
   WHERE user_id = p_user
     AND file_pattern = p_file_pattern
     AND hypothesis_type = p_hypothesis;

  v_mod := (v_accept + 1.0) / (v_total + 2.0);

  UPDATE public.spine_confidence_priors
     SET confidence_modifier = v_mod
   WHERE user_id = p_user
     AND file_pattern = p_file_pattern
     AND hypothesis_type = p_hypothesis;

  RETURN json_build_object(
    'prior_updated', true,
    'accept_count', v_accept,
    'reject_count', v_reject,
    'total_count', v_total,
    'confidence_modifier', v_mod
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.spine_record_fix_outcome(uuid,text,text,text,text,text,double precision,uuid)
  TO authenticated, service_role;
