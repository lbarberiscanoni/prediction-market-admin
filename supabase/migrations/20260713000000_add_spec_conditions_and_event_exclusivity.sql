-- spec_conditions + events.mutually_exclusive: completes the v1 events data
-- model (see market-data-models-survey.md §15).
--
-- spec_conditions models conditional / combination markets. One row per
-- condition on a market_spec; N rows on the same spec = conjunction (AND).
-- A condition points at EXACTLY ONE of:
--   * another market_spec (condition_spec_id) — machine-checkable: that
--     market's own resolution is the signal; or
--   * an event           (condition_event_id) — a predicate the watcher /
--     domain adapter evaluates.
-- The market stays alive while every condition still holds or is open; the
-- first condition to resolve contrary to `required_outcome` (or ambiguous /
-- annulled / abandoned) stages an annul. Disjunction (OR / condition groups)
-- and nested conditions are DEFERRED — the watcher must refuse condition
-- chains deeper than 1 in code, not the schema.
--
-- Design laws honored: the trading core (markets/outcomes/predictions/payouts)
-- is untouched; jsonb/edge-function code (not a DB DSL) holds resolution logic.
-- This migration is additive and inert until the court pipeline writes to it.

create table public.spec_conditions (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),

  market_spec_id bigint not null references public.market_specs(id) on delete cascade,
  condition_spec_id bigint references public.market_specs(id),
  condition_event_id bigint references public.events(id),
  required_outcome text not null,   -- the resolution that keeps this market alive
  note text,                        -- human-readable statement of the condition

  -- Exactly one referent: a condition is about another market XOR an event.
  constraint spec_conditions_one_referent
    check (num_nonnulls(condition_spec_id, condition_event_id) = 1),
  -- A condition can never reference its own spec.
  constraint spec_conditions_no_self_reference
    check (condition_spec_id is distinct from market_spec_id)
);

create index spec_conditions_spec_idx on public.spec_conditions (market_spec_id);
create index spec_conditions_cond_spec_idx on public.spec_conditions (condition_spec_id);
create index spec_conditions_cond_event_idx on public.spec_conditions (condition_event_id);

-- Admin-only RLS, matching the house pattern (profiles.user_id = auth.uid()).
-- Edge functions use the service-role key and bypass RLS.
alter table public.spec_conditions enable row level security;

create policy "admin read spec_conditions" on public.spec_conditions for select to authenticated
  using (exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.is_admin = true));
create policy "admin write spec_conditions" on public.spec_conditions for all to authenticated
  using (exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.is_admin = true))
  with check (exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.is_admin = true));

-- Exclusivity declaration for an event's market ladder. A declaration only for
-- now; the UI / AMM enforce it when the first ladder ships.
alter table public.events
  add column if not exists mutually_exclusive boolean not null default false;
