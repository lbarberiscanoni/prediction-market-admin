-- Server-side trading: public.place_trade.
--
-- Until now the public app traded from the browser: it inserted the
-- prediction, then wrote the player's balance, the outcome pools and the
-- market token_pool itself through PostgREST. That needed RLS to let players
-- write all of those, so any player could set their own balance (or forge a
-- prediction, or move a price) to anything. This function does the whole trade
-- in one transaction, with the price computed here, so those client writes can
-- be revoked (next migration, 20261018000100_lock_client_trade_writes.sql).
--
-- The math is exactly what TradeForm.tsx did client-side (src/lib/marketMakers.ts):
--   p = selected.tokens / (selected.tokens + other.tokens)
--   buy  $amt:    shares = amt / p; pools: sel += amt, oth = k / sel
--                 rejected if shares > sel.tokens or either new pool < 1
--   sell shares:  proceeds = shares * p; pools: oth += proceeds, sel = k / oth
--                 rejected if shares > shares owned (to the cent, as the UI did)
-- Binary markets only (as the UI). Market must be 'open'; ToS must be accepted.

create or replace function public.place_trade(
  p_market_id  bigint,
  p_outcome_id bigint,
  p_trade_type text,
  p_amount     double precision
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_profile  public.profiles%rowtype;
  v_status   text;
  v_sel      public.outcomes%rowtype;
  v_oth      public.outcomes%rowtype;
  v_n        int;
  v_p        double precision;
  v_shares   double precision;
  v_value    double precision;
  v_new_sel  double precision;
  v_new_oth  double precision;
  v_owned    double precision;
  v_pred_id  bigint;
begin
  if v_uid is null then
    raise exception 'You must be logged in to trade.' using errcode = '42501';
  end if;
  if p_trade_type not in ('buy', 'sell') then
    raise exception 'trade_type must be buy or sell' using errcode = '22023';
  end if;
  if p_amount is null or not (p_amount > 0) or p_amount = 'Infinity'::double precision then
    raise exception 'Trade amount must be a positive number.' using errcode = '22023';
  end if;

  -- Lock the player's row first, then the market's outcomes, so concurrent
  -- trades serialize instead of double-spending.
  select * into v_profile from public.profiles where user_id = v_uid for update;
  if not found then
    raise exception 'No profile for this user.' using errcode = 'P0002';
  end if;
  if v_profile.tos_accepted_at is null then
    raise exception 'You must accept the Terms of Service before trading.' using errcode = '42501';
  end if;

  select m.status::text into v_status from public.markets m where m.id = p_market_id for update;
  if not found then
    raise exception 'Market % not found.', p_market_id using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'This market is % and no longer accepts trades.', v_status using errcode = '22023';
  end if;

  select count(*) into v_n from public.outcomes where market_id = p_market_id;
  if v_n <> 2 then
    raise exception 'This market currently supports only binary outcomes.' using errcode = '22023';
  end if;
  select * into v_sel from public.outcomes where id = p_outcome_id and market_id = p_market_id for update;
  if not found then
    raise exception 'Outcome % is not in market %.', p_outcome_id, p_market_id using errcode = '22023';
  end if;
  select * into v_oth from public.outcomes where market_id = p_market_id and id <> p_outcome_id for update;

  v_p := v_sel.tokens / (v_sel.tokens + v_oth.tokens);

  if p_trade_type = 'buy' then
    if p_amount > v_profile.balance then
      raise exception 'Insufficient balance. You have $% but need $%.',
        round(v_profile.balance::numeric, 2), round(p_amount::numeric, 2) using errcode = '22023';
    end if;
    v_shares := p_amount / v_p;
    if v_shares > v_sel.tokens then
      raise exception 'Not enough tokens available for this outcome.' using errcode = '22023';
    end if;
    v_new_sel := v_sel.tokens + p_amount;
    v_new_oth := (v_sel.tokens * v_oth.tokens) / v_new_sel;
    if v_new_sel < 1 or v_new_oth < 1 then
      raise exception 'Trade would leave insufficient market liquidity.' using errcode = '22023';
    end if;
    v_value := -p_amount;
  else
    select coalesce(sum(case when trade_type = 'buy' then shares_amt else -shares_amt end), 0)
      into v_owned
      from public.predictions
     where user_id = v_uid and outcome_id = p_outcome_id;
    if round(p_amount::numeric, 2) > round(v_owned::numeric, 2) or round(v_owned::numeric, 2) <= 0 then
      raise exception 'Not enough shares to sell. You own % shares.', round(v_owned::numeric, 2) using errcode = '22023';
    end if;
    v_shares := p_amount;
    v_value := p_amount * v_p;
    v_new_oth := v_oth.tokens + v_value;
    v_new_sel := (v_oth.tokens * v_sel.tokens) / v_new_oth;
  end if;

  insert into public.predictions (user_id, market_id, outcome_id, shares_amt, market_odds, trade_value, trade_type)
  values (v_uid, p_market_id, p_outcome_id, v_shares, v_p, v_value, p_trade_type)
  returning id into v_pred_id;

  update public.profiles set balance = balance + v_value where id = v_profile.id;
  update public.outcomes set tokens = v_new_sel where id = v_sel.id;
  update public.outcomes set tokens = v_new_oth where id = v_oth.id;
  update public.markets set token_pool = v_new_sel + v_new_oth where id = p_market_id;

  return jsonb_build_object(
    'prediction_id', v_pred_id,
    'shares', v_shares,
    'market_odds', v_p,
    'trade_value', v_value,
    'balance', v_profile.balance + v_value
  );
end;
$$;

revoke all on function public.place_trade(bigint, bigint, text, double precision) from public, anon;
grant execute on function public.place_trade(bigint, bigint, text, double precision) to authenticated;
