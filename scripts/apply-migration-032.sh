#!/usr/bin/env bash
# Apply migration 032 (grandfather cap) to prod Spine via the Supabase
# Management SQL endpoint, then run the backfill, then verify.
#
# Why a script and not "just run it from the codespace": this codespace
# doesn't carry SUPABASE_MGMT_TOKEN. Roman runs this from his laptop with
# the token from the secrets vault. The flow is auditable — every step
# echoes the SQL it sent and the response it got, so if anything looks
# off Roman can stop before the backfill runs.
#
# Usage (from saas/spine/):
#   export SUPABASE_MGMT_TOKEN='sbp_...'
#   bash scripts/apply-migration-032.sh             # dry-run by default
#   bash scripts/apply-migration-032.sh --apply     # actually run
#
# Decisions baked in (locked 2026-05-08 evening, Roman):
#   - Grandfather formula: GREATEST(count * 2, 1000)
#   - Grace period: 90 days from now
#   - Free plan only — Pro / Team are unlimited regardless

set -euo pipefail

PROJECT_REF='lnfsyxpyumtigxymukim'
ENDPOINT="https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATION_FILE="${SCRIPT_DIR}/../supabase/migrations/032_grandfather_cap.sql"

APPLY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --help|-h)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [[ -z "${SUPABASE_MGMT_TOKEN:-}" ]]; then
  echo "error: SUPABASE_MGMT_TOKEN unset. Set it from the vault, then re-run." >&2
  exit 1
fi
if [[ ! -f "$MIGRATION_FILE" ]]; then
  echo "error: migration file missing: $MIGRATION_FILE" >&2
  exit 1
fi
command -v jq >/dev/null || { echo "error: jq required" >&2; exit 1; }

run_query() {
  local label="$1"
  local sql="$2"
  echo "──────────────────────────────────────────────"
  echo "[$label]"
  echo "$sql" | sed 's/^/  /'
  if [[ "$APPLY" -ne 1 ]]; then
    echo "(dry-run — not sent. Re-run with --apply to execute.)"
    return 0
  fi
  local body
  body=$(jq -nc --arg q "$sql" '{query:$q}')
  local resp
  resp=$(curl -sS -X POST "$ENDPOINT" \
    -H "Authorization: Bearer $SUPABASE_MGMT_TOKEN" \
    -H "Content-Type: application/json" \
    --data-binary "$body")
  echo "response: $resp"
  if echo "$resp" | jq -e 'type=="object" and has("message")' >/dev/null 2>&1; then
    echo "error: query failed — stop here, do NOT proceed." >&2
    exit 1
  fi
}

# Step 1 — apply the migration DDL.
MIGRATION_SQL=$(cat "$MIGRATION_FILE")
run_query "Step 1/4 — apply migration 032" "$MIGRATION_SQL"

# Step 2 — backfill grandfather override for free users with >200 memories.
# Computes from spine_memories grouped by user_id (we never store a
# materialized memory_count column in profiles).
BACKFILL_SQL='
WITH counts AS (
  SELECT user_id, count(*)::int AS n
  FROM public.spine_memories
  WHERE deleted_at IS NULL
    AND (signal_tier IS NULL OR signal_tier <> '\''low'\'')
  GROUP BY user_id
  HAVING count(*) > 200
)
UPDATE public.profiles p
SET grandfather_cap_override = GREATEST(c.n * 2, 1000),
    grandfather_expires_at   = now() + interval '\''90 days'\''
FROM counts c
WHERE p.user_id = c.user_id
  AND COALESCE(p.plan, '\''free'\'') = '\''free'\''
  AND p.grandfather_cap_override IS NULL
RETURNING p.user_id, p.grandfather_cap_override, p.grandfather_expires_at;'
run_query "Step 2/4 — grandfather backfill (free plan, count>200)" "$BACKFILL_SQL"

# Step 3 — verify the override landed.
VERIFY_SQL='
SELECT user_id, grandfather_cap_override, grandfather_expires_at
FROM public.profiles
WHERE grandfather_cap_override IS NOT NULL
ORDER BY grandfather_cap_override DESC
LIMIT 10;'
run_query "Step 3/4 — verify override rows" "$VERIFY_SQL"

# Step 4 — sanity: count distinct users actually grandfathered, vs total free.
SANITY_SQL='
SELECT
  (SELECT count(*) FROM public.profiles
     WHERE grandfather_cap_override IS NOT NULL)        AS grandfathered_users,
  (SELECT count(*) FROM public.profiles
     WHERE COALESCE(plan, '\''free'\'') = '\''free'\'') AS free_users;'
run_query "Step 4/4 — counts" "$SANITY_SQL"

echo "──────────────────────────────────────────────"
if [[ "$APPLY" -ne 1 ]]; then
  echo "Dry-run complete. Re-run with --apply to execute."
else
  echo "Done. Smoke /api/check-cap with Roman's API key:"
  echo "  curl -H \"Authorization: Bearer \$SPINE_KEY\" https://spine.xxiautomate.com/api/check-cap"
fi
