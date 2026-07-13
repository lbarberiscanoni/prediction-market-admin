-- Pending-approval queue for market resolutions. The generic watcher
-- (resolve-event-markets) files a proposal here per live market_spec that has a
-- resolving signal; a human approves/rejects before anything settles. Nothing
-- auto-resolves. Domain-agnostic — one row shape for court, FRED, custom, etc.

create table public.resolution_proposals (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),

  spec_id bigint not null references public.market_specs(id),
  market_id bigint references public.markets(id),
  event_kind text not null,                     -- which adapter produced it (court_case, fred_release, …)

  action text not null,                         -- resolve | annul | review
  winning_outcome text,                         -- set when action = resolve
  reason text not null,                         -- settlement rationale
  verdict jsonb not null default '{}',          -- {classification, recommended_market_action, evidence, confidence}

  status text not null default 'pending',       -- pending | approved | rejected | applied
  reviewed_at timestamptz,
  reviewed_by uuid                              -- profiles.user_id of the approver
);

create index resolution_proposals_status_idx on public.resolution_proposals (status);
create index resolution_proposals_spec_idx on public.resolution_proposals (spec_id);

-- One open proposal per spec at a time — the watcher must not re-file while a
-- proposal is still pending review.
create unique index resolution_proposals_one_open_per_spec
  on public.resolution_proposals (spec_id)
  where status = 'pending';

alter table public.resolution_proposals enable row level security;

create policy "admin read resolution_proposals" on public.resolution_proposals for select to authenticated
  using (exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.is_admin = true));
create policy "admin write resolution_proposals" on public.resolution_proposals for all to authenticated
  using (exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.is_admin = true))
  with check (exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.is_admin = true));
