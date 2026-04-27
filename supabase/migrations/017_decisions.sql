-- Migration 017: Decisions as a first-class object.
--
-- Memories are raw facts. Decisions are the derived second layer — distilled
-- one-sentence statements ("we picked Coolify over Vercel because of AU
-- region") that supersede each other over time. They are the answer to
-- "what did we decide?" — a question raw memory recall is bad at because
-- decisions are scattered across many conversations.
--
-- Pipeline (lib/decision-extractor.ts):
--   capture/route.ts → fire-and-forget Haiku call → if classified as a
--   decision → insert here. Original memory always retained — decisions are
--   a derived layer, not a replacement.
--
-- Append-only same as everything else in Spine. status transitions are the
-- only mutation: 'active' → 'superseded' (via superseded_by) or 'reverted'.
-- We never delete a decision row; we mark it inert.
--
-- Idempotent.

---------------------------------------------------------------
-- 1. decisions — the derived layer
---------------------------------------------------------------

create table if not exists public.decisions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  org_id            uuid references public.orgs(id) on delete cascade,
  source_memory_id  uuid references public.memories(id) on delete set null,
                                          -- the memory this decision was extracted from.
                                          -- on memory hard-delete (forget) we keep the
                                          -- decision but null the link — the decision
                                          -- itself remains valid even if the original
                                          -- conversation is forgotten.
  statement         text not null,        -- the distilled decision, one sentence
  context           text,                  -- excerpt around the decision (≤500 chars)
  status            text not null default 'active'
                    check (status in ('active','superseded','reverted','pending_review')),
  superseded_by     uuid references public.decisions(id) on delete set null,
  confidence        double precision not null default 0,
                                          -- 0..1, Haiku's self-reported confidence
  tags              text[] default '{}'::text[],
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists decisions_user_status_idx
  on public.decisions (user_id, status, created_at desc);

create index if not exists decisions_source_memory_idx
  on public.decisions (source_memory_id)
  where source_memory_id is not null;

create index if not exists decisions_superseded_by_idx
  on public.decisions (superseded_by)
  where superseded_by is not null;

create index if not exists decisions_org_idx
  on public.decisions (org_id, created_at desc)
  where org_id is not null;

-- Full-text search on statement so /dashboard/decisions can filter by query
-- without leaving Postgres.
alter table public.decisions
  add column if not exists statement_tsv tsvector
  generated always as (to_tsvector('english', coalesce(statement, ''))) stored;

create index if not exists decisions_statement_tsv_gin
  on public.decisions using gin (statement_tsv);

alter table public.decisions enable row level security;

drop policy if exists decisions_owner_all on public.decisions;
create policy decisions_owner_all on public.decisions
  for all
  using (
    user_id = auth.uid()
    or (org_id is not null and org_id = any(public.my_org_ids()))
  )
  with check (
    user_id = auth.uid()
    or (org_id is not null and org_id = any(public.my_org_ids()))
  );

comment on table public.decisions is
  'Derived layer over memories. Each row is a one-sentence decision distilled by Haiku at capture time. Append-only; status transitions are the only mutation.';
comment on column public.decisions.superseded_by is
  'When a later decision overturns this one, that decision''s id goes here and status flips to ''superseded''. Forms a chain — follow superseded_by until null to find the current authoritative decision.';

---------------------------------------------------------------
-- 2. decision_evidence — links between decisions and the memories that
--    support, contradict, or contextualise them.
--    Rationale: a decision often evolves across multiple captures. The
--    source_memory_id on decisions is where it was BORN; this table
--    records every memory that touches it after.
---------------------------------------------------------------

create table if not exists public.decision_evidence (
  id           bigserial primary key,
  decision_id  uuid not null references public.decisions(id) on delete cascade,
  memory_id    uuid not null references public.memories(id) on delete cascade,
  relation     text not null check (relation in ('supports','contradicts','contextualises','supersedes_target')),
  weight       double precision not null default 1.0,
  created_at   timestamptz not null default now(),
  unique (decision_id, memory_id, relation)
);

create index if not exists decision_evidence_decision_idx
  on public.decision_evidence (decision_id);

create index if not exists decision_evidence_memory_idx
  on public.decision_evidence (memory_id);

alter table public.decision_evidence enable row level security;

drop policy if exists decision_evidence_via_decision on public.decision_evidence;
create policy decision_evidence_via_decision on public.decision_evidence
  for select
  using (
    exists (
      select 1 from public.decisions d
      where d.id = decision_id
        and (d.user_id = auth.uid()
             or (d.org_id is not null and d.org_id = any(public.my_org_ids())))
    )
  );

---------------------------------------------------------------
-- 3. RPC: counts for the /dashboard/decisions stats card.
---------------------------------------------------------------

create or replace function public.spine_decision_stats(
  p_user uuid,
  p_since timestamptz default (now() - interval '30 days')
)
returns table (
  status         text,
  total          bigint,
  last_at        timestamptz
)
language sql stable
as $$
  select
    d.status,
    count(*)::bigint           as total,
    max(d.created_at)          as last_at
  from public.decisions d
  where d.user_id = p_user
    and d.created_at >= p_since
  group by d.status
  order by d.status;
$$;

grant execute on function public.spine_decision_stats(uuid, timestamptz)
  to authenticated, service_role;

---------------------------------------------------------------
-- 4. RPC: full-text search over decisions + score.
--    Used by /api/decisions?q=... — keeps the heavy lifting in Postgres.
---------------------------------------------------------------

create or replace function public.spine_search_decisions(
  p_user  uuid,
  p_query text,
  p_limit int default 25
)
returns table (
  id           uuid,
  statement    text,
  context      text,
  status       text,
  confidence   double precision,
  tags         text[],
  source_memory_id uuid,
  superseded_by uuid,
  rank         double precision,
  created_at   timestamptz
)
language sql stable
as $$
  select
    d.id,
    d.statement,
    d.context,
    d.status,
    d.confidence,
    d.tags,
    d.source_memory_id,
    d.superseded_by,
    ts_rank(d.statement_tsv, websearch_to_tsquery('english', coalesce(p_query, ''))) as rank,
    d.created_at
  from public.decisions d
  where d.user_id = p_user
    and (
      p_query is null
      or length(trim(p_query)) = 0
      or d.statement_tsv @@ websearch_to_tsquery('english', p_query)
    )
  order by
    case when p_query is null or length(trim(p_query)) = 0 then 0 else 1 end,
    rank desc,
    d.created_at desc
  limit p_limit;
$$;

grant execute on function public.spine_search_decisions(uuid, text, int)
  to authenticated, service_role;
