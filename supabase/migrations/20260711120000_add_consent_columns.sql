-- Consent tracking for the player-facing app.
--
-- Accepting the Terms of Service + Privacy Policy is a condition of using
-- Prophet. Acceptance also covers research participation (the public archive and
-- coded data sharing), which are part of participating, not separate optional
-- choices — so a single acceptance timestamp is all we store. The exact text a
-- user agreed to is recoverable from version control of
-- src/content/{terms,privacy}.md in the player app repo.
--
-- Nullable with no default, so every existing user reads as "not accepted" and
-- is caught by the app's consent gate on next authenticated session.

alter table profiles
  add column if not exists tos_accepted_at timestamptz;

comment on column profiles.tos_accepted_at is
  'When the user accepted the Terms of Service + Privacy Policy (which include mandatory research participation). Required to trade.';
