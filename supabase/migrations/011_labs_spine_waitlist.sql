-- Migration 011: Round-15 labs landing — product-prefixed waitlist + recall events.
--
-- Tables:
--   saas_spine_waitlist       — email-only signups from labs.xxiautomate.com/spine
--   saas_spine_recall_events  — per-recall latency + cost log, powers /spine/stats
--
-- Prefix convention matches the AA shared-project consolidation (2026-04-20).

---------------------------------------------------------------
-- Waitlist (labs)
---------------------------------------------------------------

create table if not exists public.saas_spine_waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text unique not null,
  source     text,             -- utm/referrer label
  referrer   text,             -- Referer header
  user_agent text,
  ip_hash    text,             -- salted hash, never raw IP
  created_at timestamptz not null default now()
);

create index if not exists saas_spine_waitlist_created_idx
  on public.saas_spine_waitlist (created_at desc);

alter table public.saas_spine_waitlist enable row level security;

-- Writes go through service-role API route, not client. No public policies.

---------------------------------------------------------------
-- Recall events — per-recall latency + cost. Used by /api/spine-stats.
---------------------------------------------------------------

create table if not exists public.saas_spine_recall_events (
  id              bigserial primary key,
  user_id         uuid,             -- null for demo/public recall
  is_demo         boolean not null default false,
  query_len       integer,
  result_count    integer,
  latency_ms      integer not null,
  rerank_cost_usd numeric(10,6) not null default 0,
  embed_cost_usd  numeric(10,6) not null default 0,
  plan            text,
  cross_session   boolean not null default false,  -- true when the hit came from >24h prior session
  created_at      timestamptz not null default now()
);

create index if not exists saas_spine_recall_events_created_idx
  on public.saas_spine_recall_events (created_at desc);

create index if not exists saas_spine_recall_events_cross_idx
  on public.saas_spine_recall_events (cross_session, created_at desc);

alter table public.saas_spine_recall_events enable row level security;

-- Writes go through service-role routes only. No public policies.
