-- Events + market_specs: the generalization that separates *events* (facts
-- about the world, heterogeneous) from *markets* (bets, uniform). Kalshi's
-- series → event → market shape. See CLAUDE.md "Proposed events data model".
--
-- Design laws honored here:
--   1. The trading core (markets, outcomes, predictions, payouts) is untouched
--      except ONE nullable column: markets.event_id. Legacy markets keep
--      event_id = null and nothing changes.
--   2. jsonb stores *parameters* (details, params). Resolution *logic* lives in
--      git-versioned resolver code (supabase/functions/_shared/court-resolution),
--      NOT in a database DSL.
--
-- This migration is additive and inert: creating these tables changes no
-- existing behavior. The court pipeline targets it next; FRED can be retrofit
-- later (one event per release).

-- EVENTS: the canonical referent. One row per real-world thing worth trading on.
create table public.events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  kind text not null,                 -- court_case | fred_release | custom | ...
  title text not null,
  status text not null default 'open',-- open | closed | resolved | annulled
  details jsonb not null default '{}', -- kind-specific: e.g. {court_cases_id, cl_docket_id, matter_id}
  source_ref text                     -- pointer back to a domain registry row (e.g. court_cases.id)
);

create index events_kind_idx on public.events (kind);
create index events_status_idx on public.events (status);

-- MARKET_SPECS: the bridge + review queue + resolution binding. One event can
-- carry many specs (an MTD market, a class-cert market, an outcome market).
create table public.market_specs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  event_id bigint not null references public.events(id),
  template_id text not null,          -- appeal_outcome | mtd_denied_by_date | class_cert_by_date | ...
  question text not null,             -- the human-readable market question
  params jsonb not null default '{}', -- template params + resolution binding (docket_id, outcomes, resolution_map, close_basis)
  justification text,                 -- quoted evidence / audit trail for why this spec exists
  close_date date,

  market_id bigint references public.markets(id), -- set once the market is minted
  status text not null default 'draft'            -- draft | approved | live | resolved | annulled | rejected
);

create index market_specs_event_idx on public.market_specs (event_id);
create index market_specs_status_idx on public.market_specs (status);
create index market_specs_market_idx on public.market_specs (market_id);

-- The ONLY change to the trading core: a nullable link from a market back to
-- its event. Legacy + FRED markets stay null until/unless retrofit.
alter table public.markets
  add column if not exists event_id bigint references public.events(id);

-- Admin-only RLS, matching the house pattern (profiles.is_admin).
alter table public.events enable row level security;
alter table public.market_specs enable row level security;

create policy "admin read events" on public.events for select to authenticated
  using (exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.is_admin = true));
create policy "admin write events" on public.events for all to authenticated
  using (exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.is_admin = true))
  with check (exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.is_admin = true));

create policy "admin read market_specs" on public.market_specs for select to authenticated
  using (exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.is_admin = true));
create policy "admin write market_specs" on public.market_specs for all to authenticated
  using (exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.is_admin = true))
  with check (exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.is_admin = true));
