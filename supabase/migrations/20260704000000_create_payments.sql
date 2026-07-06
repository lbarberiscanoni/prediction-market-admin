-- Payout ledger for external payments (PayPal / MTurk).
-- The Send Payments admin page writes one row per payout attempt and updates
-- it with the provider's result. PayPal reconciliation fields let us tell
-- SUCCESS from UNCLAIMED / RETURNED after the fact.
create table if not exists public.payments (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  player_id      bigint references public.profiles(id),
  amount         double precision not null,
  payment_method "Payment Types",
  status         text not null default 'Pending',  -- Pending | Completed | Failed | Unclaimed | Returned
  transaction_id text,        -- PayPal payout item id (or MTurk request id)
  paypal_batch_id text,       -- PayPal payout_batch_id, for reconciliation
  paypal_status  text         -- raw PayPal item transaction_status (SUCCESS/PENDING/UNCLAIMED/RETURNED/...)
);

alter table public.payments enable row level security;

drop policy if exists "authenticated read payments" on public.payments;
drop policy if exists "authenticated insert payments" on public.payments;
drop policy if exists "authenticated update payments" on public.payments;
create policy "authenticated read payments"   on public.payments for select to authenticated using (true);
create policy "authenticated insert payments" on public.payments for insert to authenticated with check (true);
create policy "authenticated update payments" on public.payments for update to authenticated using (true);
