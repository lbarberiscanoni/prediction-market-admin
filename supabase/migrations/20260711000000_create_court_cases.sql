-- Registry of court cases involving the tracked companies (Kalshi, Polymarket).
-- Populated by the sweep-court-cases edge function (CourtListener discovery);
-- classification fields (company_role, case_type, matter_id) are filled later
-- by the decomposition stage / human review. Discovery fields are overwritten
-- on every sweep; curation fields are never touched by the sweep.

create table public.court_cases (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- discovery fields (owned by sweep-court-cases; overwritten each sweep)
  source text not null default 'courtlistener',
  cl_docket_id bigint not null unique,
  docket_number text,
  case_name text not null,
  court_id text,
  court_name text,
  court_level text not null default 'district',      -- district | appellate | scotus
  date_filed date,
  date_terminated date,
  cause text,
  suit_nature text,
  jurisdiction_type text,
  assigned_to text,
  parties text[] not null default '{}',
  companies text[] not null default '{}',            -- kalshi | polymarket (may be both)
  search_terms_matched text[] not null default '{}',
  absolute_url text,
  raw jsonb,

  -- curation fields (owned by decomposition / human review; sweep never writes)
  status text not null default 'candidate',          -- candidate | verified | rejected | tracking
  company_role text,                                 -- defendant | plaintiff | both | unknown
  case_type text,                                    -- state_enforcement | class_action | private | related
  matter_id bigint references public.court_cases(id),-- self-ref: groups refilings/appeals into one matter
  notes text
);

create index court_cases_status_idx on public.court_cases (status);
create index court_cases_companies_idx on public.court_cases using gin (companies);

alter table public.court_cases enable row level security;

create policy "admin read court_cases"
  on public.court_cases
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

create policy "admin update court_cases"
  on public.court_cases
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where profiles.user_id = auth.uid()
        and profiles.is_admin = true
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.user_id = auth.uid()
        and profiles.is_admin = true
    )
  );
