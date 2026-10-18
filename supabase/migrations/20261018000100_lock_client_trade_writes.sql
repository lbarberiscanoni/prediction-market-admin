-- Close the token-minting hole: players can no longer write money directly.
--
-- Apply only AFTER both apps trade through public.place_trade
-- (20261018000000_place_trade.sql); the old browser-side trade code breaks
-- once this is in.
--
-- Before this, RLS let any logged-in player, through PostgREST:
--   * UPDATE their own profiles row, balance and is_admin included;
--   * INSERT any prediction (any user_id, any shares/price), which resolution
--     then pays out;
--   * UPDATE any outcome's tokens or market's token_pool (move the price).
-- Players still edit their own username / payment details / notification and
-- consent fields; only the money columns are locked.

-- 1. profiles: balance and is_admin change only from trusted code (service
--    role, postgres, or a SECURITY DEFINER function such as place_trade /
--    increment_balance / refill_balances, which run as their owner).
create or replace function public.guard_profile_money_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- A player's own profile row is created by the auth trigger; a client
    -- insert starts from the defaults like any new signup, once.
    if exists (select 1 from public.profiles where user_id = new.user_id) then
      raise exception 'A profile already exists for this user.' using errcode = '42501';
    end if;
    new.balance := 1000;
    new.is_admin := false;
    return new;
  end if;
  if new.balance is distinct from old.balance then
    raise exception 'balance can only be changed by trading.' using errcode = '42501';
  end if;
  if new.is_admin is distinct from old.is_admin then
    raise exception 'is_admin cannot be changed by players.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_money_columns on public.profiles;
create trigger guard_profile_money_columns
  before insert or update on public.profiles
  for each row execute function public.guard_profile_money_columns();

-- 2. increment_balance stays for the service-role edge functions
--    (resolve-market, annul-market) but players can't call it.
revoke execute on function public.increment_balance(text, numeric) from public, anon, authenticated;
grant execute on function public.increment_balance(text, numeric) to service_role;

-- 3. Trades are written only by place_trade.
drop policy if exists "Enable insert for authenticated users only" on public.predictions;
revoke insert, update, delete on public.predictions from anon, authenticated;

drop policy if exists "Enable update for authenticated" on public.outcomes;
revoke update on public.outcomes from anon, authenticated;

drop policy if exists "Enable update for authenticated" on public.markets;
revoke update on public.markets from anon, authenticated;
