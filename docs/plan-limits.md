# Plan limits — source of truth

The canonical numbers are in `saas/spine/lib/plan-limits.ts`. Anything that
quotes a memory cap (landing page, MCP error responses, dashboard, blog
posts) must read it from `PLAN_LIMITS` — never hardcode.

## Current tiers (as of 2026-04-30)

| Plan | Memory cap        | Price (USD/mo) | Seats | Notable features                              |
| ---- | ----------------- | -------------- | ----- | --------------------------------------------- |
| Free | 200               | 0              | 1     | MCP + extension, vector recall, JSON export   |
| Pro  | unlimited         | 19             | 1     | Conflict detection, decay recovery, pins, BM25 |
| Team | unlimited         | 59             | 5     | Shared workspace, policies, audit log         |

These are the numbers in `lib/plan-limits.ts` and are what the production
billing flow enforces.

## Open question — TODO

The Spine launch stress-test brief (Wed 2026-04-30) said the gates should
test "**Free 1k / Pro 50k / Team 500k**". The code says **200 / unlimited /
unlimited**. PR #50 (Gate 3) wrote tests against the code-as-source-of-truth
— the merged behaviour matches what users actually see today.

**Action:** revisit pricing once we have signal from real users:

- If 200 free is too generous (cohorts hit cap → upgrade rate stays low)
  → tighten to e.g. 100 with a clear "X memories left" UI nudge.
- If 200 free is too tight (cohorts churn before they hit the value loop)
  → loosen to 1k as the brief suggested, OR keep 200 + add a 14-day Pro
  trial.
- The "Pro 50k / Team 500k" finite caps from the brief contradict the
  product positioning ("infinite, not compressed"). If we enforce them
  the messaging has to shift; right now we can't promise infinite *and*
  cap at 50k. If those caps land, update `lib/plan-limits.ts` first and
  the marketing copy second.

When pricing changes, the change must land in:

1. `saas/spine/lib/plan-limits.ts` — `PLAN_LIMITS[*].captureCap` + the
   `features[]` array (the cap value is rendered onto `/pricing` from
   the features list — `tests/plan-caps.test.ts` enforces consistency).
2. This file — bump the date and update the table.
3. `xxi-conductor/briefs/queue/021-spine-conversation-capture.md` and any
   downstream brief that quotes the numbers.

## Why the test-brief mismatch was tolerated

Code wins, brief loses. The merged tests assert the canonical-code
numbers, not the brief's. Reasoning: the cap users actually pay against
is the one in the deployed binary, so that's what the regression net
needs to protect. Updating the brief is a doc-only change; updating
the code requires a billing migration plan.
