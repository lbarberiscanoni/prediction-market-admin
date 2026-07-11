-- Add provenance + confidence signals for the supplementary full-text pass.
-- party_name search misses cases with sparse party data (esp. appellate); a
-- full-text (q=) pass catches them but also surfaces mention-only dockets
-- where the company is named in the text but is not actually a party.
--
--   discovery_methods : how the sweep found this docket (party_name | full_text)
--   party_confirmed   : an alias literally appears in the case name or party[]
--                       (true = solid; false = full-text mention, needs review)

alter table public.court_cases
  add column if not exists discovery_methods text[] not null default '{}',
  add column if not exists party_confirmed boolean not null default false;

-- Reviewers triage the maybes by filtering party_confirmed = false.
create index if not exists court_cases_party_confirmed_idx
  on public.court_cases (party_confirmed);
