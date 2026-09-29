-- Raw facts for the pipeline-health monitor (edge function `pipeline-health`).
--
-- Edge functions can't read the cron/net schemas through PostgREST, so this
-- SECURITY DEFINER function gathers everything the monitor needs in one call.
-- It only READS. The judgement (what counts as an issue) lives in
-- _shared/health/checks.ts; this returns facts, not verdicts.
--
-- fred_target: the close_date the FRED job targeted today (today + days_ahead),
-- so the monitor can compare "releases expected" vs "markets actually created".

create or replace function public.pipeline_health_facts(fred_target date)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'cron_failures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'jobname', j.jobname, 'failures', f.n,
        'last_failed_at', f.last_at, 'last_error', left(f.last_msg, 300)))
      from (
        select jobid, count(*) n, max(start_time) last_at,
               (array_agg(return_message order by start_time desc))[1] last_msg
        from cron.job_run_details
        where start_time > now() - interval '26 hours' and status <> 'succeeded'
        group by jobid
      ) f join cron.job j using (jobid)
    ), '[]'::jsonb),

    -- pg_net keeps ~6h of responses. Timeouts are excluded: several jobs use a
    -- short client timeout by design and the function still runs to completion.
    'http_errors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'status_code', status_code, 'error', error_msg,
        'snippet', left(content, 200), 'at', created))
      from net._http_response
      where created > now() - interval '26 hours'
        and (status_code >= 400 or (error_msg is not null and not timed_out))
    ), '[]'::jsonb),

    'fred_markets_for_target', (
      select count(*) from markets
      where event_id is null and close_date = fred_target
        and created_at > now() - interval '26 hours'
    ),

    'stale_closed_markets', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'close_date', close_date) order by close_date)
      from markets
      where status = 'closed' and close_date < current_date - 14
    ), '[]'::jsonb),

    'stuck_payments', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'amount', amount, 'created_at', created_at))
      from payments
      where status = 'Pending' and created_at < now() - interval '7 days'
    ), '[]'::jsonb),

    'latest_leaderboard_date', (select max(created_at)::date from leaderboards),

    'live_specs_unchecked', (
      select count(*) from market_specs
      where status = 'live' and created_at < now() - interval '1 day'
        and (last_checked_at is null or last_checked_at < now() - interval '3 days')
    ),

    -- Mint moves every draft it touches out of 'draft' (to live or needs_review),
    -- so a draft sitting for days means the mint job isn't running.
    'draft_specs', (select count(*) from market_specs where status = 'draft'),
    'oldest_draft_days', (
      select extract(day from now() - min(created_at))::int
      from market_specs where status = 'draft'
    ),

    'pending_reviews', (select count(*) from resolution_proposals where status = 'pending'),
    'specs_needing_review', (select count(*) from market_specs where status = 'needs_review'),

    'cycle_payouts_today', (
      select count(*) from cycle_payouts where created_at::date = current_date
    )
  );
$$;

revoke all on function public.pipeline_health_facts(date) from public, anon, authenticated;
grant execute on function public.pipeline_health_facts(date) to service_role;
