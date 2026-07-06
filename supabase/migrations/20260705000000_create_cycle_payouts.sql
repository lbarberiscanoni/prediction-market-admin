-- Staging table for the biweekly leaderboard-bonus cycle payout.
-- stage-cycle-payout writes one row per cycle (status pending_approval) with the
-- computed rank->amount line items; an admin reviews it on the Send Payments
-- page and clicks Approve & Send, which sends the eligible PayPal payouts.
create table if not exists public.cycle_payouts (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  leaderboard_id bigint unique,               -- one staged batch per leaderboard
  calculation_date date,
  status         text not null default 'pending_approval',  -- pending_approval | sending | sent | cancelled
  item_count     int not null default 0,      -- total leaderboard members
  eligible_count int not null default 0,      -- payable via PayPal
  total_amount   double precision not null default 0,        -- sum of eligible amounts
  items          jsonb not null default '[]', -- [{user_id, username, rank, payment_id, payment_method, amount, eligible, skip_reason}]
  approved_at    timestamptz,
  sent_at        timestamptz
);

alter table public.cycle_payouts enable row level security;

drop policy if exists "authenticated read cycle_payouts"   on public.cycle_payouts;
drop policy if exists "authenticated update cycle_payouts" on public.cycle_payouts;
create policy "authenticated read cycle_payouts"   on public.cycle_payouts for select to authenticated using (true);
create policy "authenticated update cycle_payouts" on public.cycle_payouts for update to authenticated using (true);
