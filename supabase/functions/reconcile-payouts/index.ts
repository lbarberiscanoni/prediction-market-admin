// supabase/functions/reconcile-payouts/index.ts
//
// Polls PayPal for the terminal status of payouts that are still non-terminal
// in our `payments` ledger and updates them. Moves NO money — read + update
// only. Intended to run on a schedule (pg_cron).
//
// Uses the same PayPal secrets as send-paypal-payout, plus the auto-injected
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY to write past RLS.

import { serve } from 'https://deno.land/std@0.131.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

const API_BASE = Deno.env.get('PAYPAL_API_BASE') ?? 'https://api-m.sandbox.paypal.com';

// Map PayPal's per-item transaction_status onto our ledger status. Returns null
// for still-pending items so we leave them untouched for the next run.
const mapStatus = (s?: string): string | null => {
  switch ((s || '').toUpperCase()) {
    case 'SUCCESS':
      return 'Completed';
    case 'UNCLAIMED':
      return 'Unclaimed';
    case 'PENDING':
    case 'PROCESSING':
    case '':
      return null; // not terminal yet
    default:
      return 'Failed'; // RETURNED, BLOCKED, DENIED, REFUNDED, REVERSED, ...
  }
};

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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const db = (path: string, init?: RequestInit) =>
    fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });

  try {
    // Pull PayPal payouts still marked Pending that have a batch id to check.
    const pendingRes = await db(
      'payments?select=id,paypal_batch_id&payment_method=eq.PayPal&status=eq.Pending&paypal_batch_id=not.is.null&limit=200',
    );
    const pending: Array<{ id: number; paypal_batch_id: string }> = await pendingRes.json();

    if (!pending.length) return json({ checked: 0, updated: 0, message: 'nothing to reconcile' });

    const token = await getPayPalToken();
    let updated = 0;
    const results: Array<{ id: number; transaction_status?: string; newStatus: string | null }> = [];

    for (const row of pending) {
      try {
        const r = await fetch(`${API_BASE}/v1/payments/payouts/${row.paypal_batch_id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) {
          results.push({ id: row.id, newStatus: null });
          continue;
        }
        const body = await r.json();
        const txStatus: string | undefined = body?.items?.[0]?.transaction_status;
        const newStatus = mapStatus(txStatus);
        // Always record the raw PayPal status; only flip our status when terminal.
        const patch: Record<string, unknown> = { paypal_status: txStatus ?? null };
        if (newStatus) patch.status = newStatus;
        await db(`payments?id=eq.${row.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(patch),
        });
        if (newStatus) updated++;
        results.push({ id: row.id, transaction_status: txStatus, newStatus });
      } catch (_) {
        results.push({ id: row.id, newStatus: null });
      }
    }

    return json({ checked: pending.length, updated, results });
  } catch (err) {
    console.error('reconcile-payouts error:', err);
    return json({ success: false, error: (err as Error).message ?? 'Unknown error' }, 500);
  }
});
