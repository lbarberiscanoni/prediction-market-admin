-- Pre-apply GREEN proof: apply the spec_conditions migration inside a
-- transaction, probe the constraints, and ROLL BACK so prod is untouched.
-- Any failure RAISEs and aborts. Run with:
--   psql "<conn>" -X -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/20260713000000_add_spec_conditions_and_event_exclusivity.sql-inlined
-- (This file inlines the apply itself so the whole thing is one rolled-back tx.)

begin;

\i supabase/migrations/20260713000000_add_spec_conditions_and_event_exclusivity.sql

do $$
declare
  ev bigint;
  sp bigint;
  sp2 bigint;
  ok boolean;
begin
  insert into public.events (kind, title) values ('custom', 'dryrun') returning id into ev;
  insert into public.market_specs (event_id, template_id, question)
    values (ev, 'dryrun', 'q?') returning id into sp;
  insert into public.market_specs (event_id, template_id, question)
    values (ev, 'dryrun', 'q2?') returning id into sp2;

  -- 1. zero referents rejected
  begin
    insert into public.spec_conditions (market_spec_id, required_outcome) values (sp, 'Yes');
    raise exception 'FAIL: zero-referent condition was accepted';
  exception when check_violation then null;
  end;

  -- 2. both referents rejected
  begin
    insert into public.spec_conditions
      (market_spec_id, condition_spec_id, condition_event_id, required_outcome)
      values (sp, sp2, ev, 'Yes');
    raise exception 'FAIL: two-referent condition was accepted';
  exception when check_violation then null;
  end;

  -- 3. self-reference rejected
  begin
    insert into public.spec_conditions (market_spec_id, condition_spec_id, required_outcome)
      values (sp, sp, 'Yes');
    raise exception 'FAIL: self-referencing condition was accepted';
  exception when check_violation then null;
  end;

  -- 4. valid event-referent condition accepted
  insert into public.spec_conditions
    (market_spec_id, condition_event_id, required_outcome, note)
    values (sp, ev, 'denied', 'if MTD denied');

  -- 5. cascade delete
  delete from public.market_specs where id = sp;
  select not exists (select 1 from public.spec_conditions where market_spec_id = sp) into ok;
  if not ok then raise exception 'FAIL: conditions were not cascade-deleted'; end if;

  -- 6. events.mutually_exclusive default
  select mutually_exclusive = false from public.events where id = ev into ok;
  if not ok then raise exception 'FAIL: mutually_exclusive default is not false'; end if;

  raise notice 'DRYRUN GREEN: all constraint probes passed';
end $$;

rollback;
