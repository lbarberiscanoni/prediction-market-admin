// supabase/functions/send-paypal-payout/index.ts
//
// Sends a single PayPal payout to a recipient email using the PayPal
// Payouts API, then reads back the per-item transaction_status so the
// caller can tell SUCCESS from UNCLAIMED / RETURNED (i.e. whether the
// email is actually a usable PayPal account).
//
// Required Supabase secrets:
//   PAYPAL_CLIENT_ID   - REST app client id
//   PAYPAL_SECRET      - REST app secret
// Optional:
//   PAYPAL_API_BASE    - defaults to sandbox; set to https://api-m.paypal.com for live

import { serve } from 'https://deno.land/std@0.131.0/http/server.ts';
import { requireAdmin } from '../_shared/admin.ts';

interface PayoutRequest {
  email: string;
  amount: number;
  note?: string;
  senderItemId?: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, apikey, x-client-info',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

const API_BASE =
  Deno.env.get('PAYPAL_API_BASE') ?? 'https://api-m.sandbox.paypal.com';

async function getAccessToken(clientId: string, secret: string): Promise<string> {
  const res = await fetch(`${API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    throw new Error(`PayPal auth failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;

    const { email, amount, note, senderItemId } = (await req.json()) as PayoutRequest;

    if (!email || !email.includes('@') || typeof amount !== 'number' || amount <= 0) {
      return json({ error: 'Invalid email or amount' }, 400);
    }

    const clientId = Deno.env.get('PAYPAL_CLIENT_ID');
    const secret = Deno.env.get('PAYPAL_SECRET');
    if (!clientId || !secret) {
      return json({ error: 'PayPal credentials missing (set via Supabase secrets)' }, 500);
    }

    const token = await getAccessToken(clientId, secret);

    // sender_batch_id must be unique per batch to avoid duplicate-payout rejects.
    const batchId = `payout-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const itemId = senderItemId ?? `item-${Date.now()}`;

    const createRes = await fetch(`${API_BASE}/v1/payments/payouts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender_batch_header: {
          sender_batch_id: batchId,
          email_subject: 'You have a payment from the Prediction Market',
          email_message: note ?? 'Thanks for participating in the Prediction Market.',
        },
        items: [
          {
            recipient_type: 'EMAIL',
            amount: { value: amount.toFixed(2), currency: 'USD' },
            receiver: email,
            note: note ?? 'Prediction market payout',
            sender_item_id: itemId,
          },
        ],
      }),
    });

    const createBody = await createRes.json();
    if (!createRes.ok) {
      return json(
        { success: false, error: createBody?.message ?? 'PayPal payout failed', details: createBody },
        502,
      );
    }

    const payoutBatchId = createBody?.batch_header?.payout_batch_id as string | undefined;

    // Best-effort read-back of the per-item status. Right after creation the
    // batch is often still PENDING/PROCESSING, so this may not be terminal yet;
    // the caller should reconcile later via the same endpoint.
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
        // non-fatal: return what we have from creation
      }
    }

    return json({
      success: true,
      batch_id: payoutBatchId,
      batch_status: createBody?.batch_header?.batch_status,
      transaction_id: payoutItemId ?? payoutBatchId,
      transaction_status: transactionStatus, // SUCCESS | PENDING | UNCLAIMED | RETURNED | ...
    });
  } catch (err) {
    console.error('Error sending PayPal payout:', err);
    return json({ success: false, error: (err as Error).message ?? 'Unknown error' }, 500);
  }
});
