drop policy if exists "authenticated read payments" on public.payments;
drop policy if exists "authenticated insert payments" on public.payments;
drop policy if exists "authenticated update payments" on public.payments;

create policy "admin read payments"
  on public.payments
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

create policy "admin insert payments"
  on public.payments
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.user_id = auth.uid()
        and profiles.is_admin = true
    )
  );

create policy "admin update payments"
  on public.payments
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

drop policy if exists "authenticated read cycle_payouts" on public.cycle_payouts;
drop policy if exists "authenticated update cycle_payouts" on public.cycle_payouts;

create policy "admin read cycle_payouts"
  on public.cycle_payouts
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

create policy "admin update cycle_payouts"
  on public.cycle_payouts
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
