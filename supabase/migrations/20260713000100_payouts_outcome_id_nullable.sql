-- Annulment payouts have no winning outcome. The annul-market function already
-- intends to write refund rows with outcome_id = null, but payouts.outcome_id
-- was NOT NULL, so those inserts fail (proven by supabase/tests/lifecycle_e2e_test.ts).
-- Make it nullable so annulment refunds can be recorded.
--
-- Metadata-only change: existing rows all have outcome_id set, no rewrite, no
-- backfill. The FK to outcomes(id) is unaffected (nulls are allowed under a FK).

alter table public.payouts
  alter column outcome_id drop not null;
