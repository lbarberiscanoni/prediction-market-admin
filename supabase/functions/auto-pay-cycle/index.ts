// supabase/functions/auto-pay-cycle/index.ts
//
// Fully automated leaderboard-bonus payout — the ONLY payout path (the manual
// CyclePayoutReview UI was deleted). Computes the current cycle from the latest
// leaderboard, sends the eligible PayPal payouts, and records them in the
// payments ledger — no human click. Designed to run on pg_cron.
//
// This file is a THIN I/O SHELL. The decisions live in unit-tested _shared code:
//   * cycle.ts     — pure who/how-much/why (ranking, eligibility, amounts, cap)
//   * auto-pay.ts  — isAuthorized() + runAutoPayCycle(deps) orchestration
// Here we only build the real deps (DB via service role, PayPal) and map the
// outcome to an HTTP response.
//
// This MOVES REAL MONEY, so it is deliberately conservative:
//   - AUTH: requires the service-role key as the Bearer token (NOT the public
//     anon key). Only pg_cron / an admin holding the service key can trigger it.
//   - CADENCE: controlled by the pg_cron SCHEDULE (mid-month on the 15th +
//     end-of-month), NOT by a timer inside the function. The function pays
//     whatever the latest leaderboard is whenever it's invoked.
//   - IDEMPOTENCY: the cycle_payouts.leaderboard_id unique constraint + an
//     explicit pre-check mean a given leaderboard can never be paid twice, and
//     leaderboards already staged/paid (e.g. a leftover manual batch) are left
//     untouched.
//   - SPEND CAP: refuses to auto-send if the cycle total exceeds MAX_CYCLE_USD
//     (defends against a bug ballooning amounts); such cycles fall back to manual.
//   - DRY RUN: {dry_run:true} computes and returns the plan without moving money
//     or writing anything.
//
// Body: { dry_run?: boolean }
//
// Payout schedule (see documentation.md "Leaderboard Bonus Payouts"):
//   rank 1 -> $3.00, 2 -> $1.50, 3 -> $1.00, else -> $0.50

import { serve } from 'https://deno.land/std@0.131.0/http/server.ts';
import { DEFAULT_MAX_CYCLE_USD } from '../_shared/leaderboard-payouts/cycle.ts';
import { type AutoPayDeps, isAuthorized, runAutoPayCycle } from '../_shared/leaderboard-payouts/auto-pay.ts';

// Safety net: an auto-run will not send more than this per cycle. A normal cycle
// is a few dollars; anything above is almost certainly a bug and is left manual.
const MAX_CYCLE_USD = Number(Deno.env.get('AUTO_PAY_MAX_CYCLE_USD') ?? String(DEFAULT_MAX_CYCLE_USD));

const API_BASE = Deno.env.get('PAYPAL_API_BASE') ?? 'https://api-m.sandbox.paypal.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

async function getPayPalToken(): Promise<string> {
  const id = Deno.env.get('PAYPAL_CLIENT_ID');
  const secret = Deno.env.get('PAYPAL_SECRET');
  if (!id || !secret) throw new Error('PayPal credentials missing');
  const res = await fetch(`${API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token as string;
}

// Send one PayPal payout and best-effort read back the per-item status. Mirrors
// send-paypal-payout so the ledger rows look identical to manually-sent ones.
async function sendPayPalPayout(
  token: string,
  email: string,
  amount: number,
  note: string,
): Promise<{ batch_id?: string; transaction_id?: string; transaction_status?: string }> {
  const batchId = `payout-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const itemId = `item-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const createRes = await fetch(`${API_BASE}/v1/payments/payouts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: batchId,
        email_subject: 'You have a payment from the Prediction Market',
        email_message: note,
      },
      items: [
        {
          recipient_type: 'EMAIL',
          amount: { value: amount.toFixed(2), currency: 'USD' },
          receiver: email,
          note,
          sender_item_id: itemId,
        },
      ],
    }),
  });
  const createBody = await createRes.json();
  if (!createRes.ok) {
    throw new Error(createBody?.message ?? `PayPal payout failed (${createRes.status})`);
  }
  const payoutBatchId = createBody?.batch_header?.payout_batch_id as string | undefined;
  let transactionStatus: string | undefined;
  let payoutItemId: string | undefined;
  if (payoutBatchId) {
    try {
      const statusRes = await fetch(`${API_BASE}/v1/payments/payouts/${payoutBatchId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (statusRes.ok) {
        const statusBody = await statusRes.json();
        const item = statusBody?.items?.[0];
        transactionStatus = item?.transaction_status;
        payoutItemId = item?.payout_item_id;
      }
    } catch (_) {
      // non-fatal
    }
  }
  return { batch_id: payoutBatchId, transaction_id: payoutItemId ?? payoutBatchId, transaction_status: transactionStatus };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Auth: this moves real money, so passing the gateway's JWT check (anon key) is
  // NOT sufficient. Require the service-role key as Bearer OR the shared
  // x-cron-secret (what pg_cron sends). Logic + tests in _shared (isAuthorized).
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const cronHeader = req.headers.get('x-cron-secret') ?? '';
  if (!isAuthorized(bearer, cronHeader, { serviceKey: SERVICE_KEY, cronSecret: Deno.env.get('CRON_SECRET') })) {
    return json({ error: 'Unauthorized: x-cron-secret or service-role key required' }, 401);
  }

  const db = (path: string, init?: RequestInit) =>
    fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;

    // Cadence is enforced by the pg_cron SCHEDULE (15th + last day of month), not
    // here. The orchestration (runAutoPayCycle) is domain logic tested with fakes;
    // these deps are the real I/O it drives. PayPal token is fetched lazily so a
    // dry-run / empty cycle never touches PayPal.
    let tokenPromise: Promise<string> | null = null;
    const getToken = () => (tokenPromise ??= getPayPalToken());

    const deps: AutoPayDeps = {
      maxCycleUsd: MAX_CYCLE_USD,
      getLatestLeaderboard: async () => {
        const lbs = await db('leaderboards?select=id,calculation_date,data&order=calculation_date.desc,created_at.desc&limit=1').then((r) => r.json());
        return lbs.length ? lbs[0] : null;
      },
      getExistingCyclePayout: async (leaderboardId) => {
        const rows = await db(`cycle_payouts?select=id,status&leaderboard_id=eq.${leaderboardId}&limit=1`).then((r) => r.json());
        return rows.length ? rows[0] : null;
      },
      getProfiles: async (userIds) => {
        const inList = userIds.map((u) => `"${u}"`).join(',');
        return await db(`profiles?select=id,user_id,username,payment_id,payment_method&user_id=in.(${inList})`).then((r) => r.json());
      },
      claimCycle: async (row) => {
        const res = await db('cycle_payouts', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(row),
        });
        return res.ok; // false on the unique-leaderboard_id conflict (409)
      },
      recordEmptyCycle: async (row) => {
        await db('cycle_payouts', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            ...row,
            status: 'sent',
            eligible_count: 0,
            total_amount: 0,
            approved_at: new Date().toISOString(),
            sent_at: new Date().toISOString(),
          }),
        });
      },
      payTo: async (email, amount, note) => sendPayPalPayout(await getToken(), email, amount, note),
      insertPayment: async (row) => {
        await db('payments', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      },
      markSent: async (leaderboardId) => {
        await db(`cycle_payouts?leaderboard_id=eq.${leaderboardId}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'sent', approved_at: new Date().toISOString(), sent_at: new Date().toISOString() }),
        });
      },
    };

    const outcome = await runAutoPayCycle(deps, { dryRun });
    return json(outcome.body, outcome.status);
  } catch (err) {
    console.error('auto-pay-cycle error:', err);
    return json({ paid: false, error: (err as Error).message ?? 'Unknown error' }, 500);
  }
});
