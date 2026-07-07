-- Reconcile profiles.payment_method for users hit by the migration bug.
--
-- Before the profile-edit fix, the user-facing app could only update payment_id,
-- never payment_method. MTurk users who followed the "switch to PayPal" prompt
-- replaced their MTurk Worker ID with a PayPal email in payment_id, but their
-- payment_method stayed 'MTurk' (or was never set). The Send Payments page routes
-- by payment_method, so these users would be paid via the wrong rail (MTurk) or
-- filtered out of payouts entirely (null method).
--
-- Signal: an MTurk Worker ID never contains '@'; a PayPal payment_id is always an
-- email. So an '@' in payment_id is a high-confidence indicator the account is
-- really on PayPal. This backfills payment_method to 'PayPal' for exactly those
-- rows. Idempotent: re-running matches no additional rows.
--
-- Deliberately NOT touched: users with a null method and a non-email payment_id.
-- Those are likely genuine MTurk workers, but the same bug means we can't be sure
-- they didn't intend PayPal, so they're left for manual review rather than guessed.
update public.profiles
set payment_method = 'PayPal'
where payment_id like '%@%'
  and coalesce(payment_method::text, '') <> 'PayPal';
