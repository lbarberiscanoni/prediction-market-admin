-- Rotation cursor for the resolution watcher. Each daily run checks the N
-- least-recently-checked live specs (bounded by CourtListener's 10/min cap and
-- the edge runtime's wall-clock), then stamps last_checked_at so the next run
-- picks up the rest. Over a few runs every live market is covered — accuracy
-- over speed, by design.

alter table public.market_specs
  add column if not exists last_checked_at timestamptz;

-- Oldest-first among live specs (never-checked sort first).
create index if not exists market_specs_live_checked_idx
  on public.market_specs (last_checked_at nulls first)
  where status = 'live';
