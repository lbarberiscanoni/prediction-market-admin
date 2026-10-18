-- Bankruptcy refill: players who drop below a floor are topped back up to the
-- starting balance, once per period. A refilled player ends up exactly where a
-- new signup starts (1000), so nobody gets a head start. The leaderboard ranks
-- on trade returns, so refilled tokens never count toward bonuses.
--
-- Called by pg_cron (refill-balances-*) on the payout-cycle cadence. The
-- (period, profile_id) unique key makes a re-run in the same period a no-op.

create table if not exists public.balance_refills (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  period           text not null,
  profile_id       bigint not null references public.profiles(id) on delete cascade,
  previous_balance double precision not null,
  amount           double precision not null,
  unique (period, profile_id)
);

alter table public.balance_refills enable row level security;

drop policy if exists "admin read balance_refills" on public.balance_refills;
create policy "admin read balance_refills"
  on public.balance_refills
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where profiles.user_id = auth.uid()
        and profiles.is_admin = true
    )
  );

create or replace function public.refill_balances(
  p_period  text    default to_char(now() at time zone 'utc', 'YYYY-MM-DD'),
  p_floor   numeric default 100,
  p_target  numeric default 1000,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  refilled jsonb;
begin
  if p_dry_run then
    select coalesce(jsonb_agg(jsonb_build_object(
             'profile_id', p.id, 'username', p.username,
             'previous_balance', coalesce(p.balance, 0),
             'amount', p_target - coalesce(p.balance, 0)) order by p.id), '[]'::jsonb)
      into refilled
      from profiles p
     where coalesce(p.balance, 0) < p_floor
       and not exists (select 1 from balance_refills r where r.period = p_period and r.profile_id = p.id);
  else
    with broke as (
      select id, username, coalesce(balance, 0) as balance
        from profiles
       where coalesce(balance, 0) < p_floor
         for update
    ), logged as (
      insert into balance_refills (period, profile_id, previous_balance, amount)
      select p_period, id, balance, p_target - balance from broke
      on conflict (period, profile_id) do nothing
      returning profile_id, previous_balance, amount
    ), credited as (
      update profiles p
         set balance = coalesce(p.balance, 0) + l.amount
        from logged l
       where p.id = l.profile_id
      returning p.id, p.username, l.previous_balance, l.amount
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'profile_id', id, 'username', username,
             'previous_balance', previous_balance, 'amount', amount) order by id), '[]'::jsonb)
      into refilled
      from credited;
  end if;

  return jsonb_build_object('dry_run', p_dry_run, 'period', p_period, 'refilled', refilled);
end;
$$;

-- Only pg_cron / the service role may mint tokens: never players via PostgREST.
revoke all on function public.refill_balances(text, numeric, numeric, boolean) from public, anon, authenticated;
