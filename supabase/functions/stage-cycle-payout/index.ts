// supabase/functions/stage-cycle-payout/index.ts
//
// Computes the leaderboard-rank bonus batch for the current cycle and STAGES it
// in cycle_payouts (status pending_approval) for in-app review. Moves NO money.
// Meant to run on a schedule; enforces a ~14-day cadence unless {force:true}.
//
// Payout schedule (see documentation.md "Leaderboard Bonus Payouts"):
//   rank 1 -> $3.00, 2 -> $1.50, 3 -> $1.00, else -> $0.50

import { serve } from 'https://deno.land/std@0.131.0/http/server.ts';

const BASE_PAYOUT = 0.5;
const PLACEMENT_TOTALS: Record<number, number> = { 1: 3.0, 2: 1.5, 3: 1.0 };
const payoutForRank = (rank: number) => PLACEMENT_TOTALS[rank] ?? BASE_PAYOUT;
const CYCLE_DAYS = 14;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

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
    const body = await req.json().catch(() => ({}));
    const force = body?.force === true;

    // Cadence guard: skip if a cycle was staged within the last ~14 days.
    if (!force) {
      const recent = await db('cycle_payouts?select=created_at&order=created_at.desc&limit=1').then((r) => r.json());
      if (recent.length) {
        const days = (Date.now() - new Date(recent[0].created_at).getTime()) / 86_400_000;
        if (days < CYCLE_DAYS - 1) {
          return json({ staged: false, reason: `last cycle staged ${days.toFixed(1)}d ago; waiting for ${CYCLE_DAYS}d (pass {force:true} to override)` });
        }
      }
    }

    // Latest leaderboard.
    const lbs = await db('leaderboards?select=id,calculation_date,data,total_users&order=calculation_date.desc,created_at.desc&limit=1').then((r) => r.json());
    if (!lbs.length) return json({ staged: false, reason: 'no leaderboard found' });
    const lb = lbs[0];

    // Don't double-stage the same leaderboard.
    const existing = await db(`cycle_payouts?select=id,status&leaderboard_id=eq.${lb.id}&limit=1`).then((r) => r.json());
    if (existing.length) {
      return json({ staged: false, reason: `leaderboard ${lb.id} already staged as cycle_payout ${existing[0].id} (${existing[0].status})` });
    }

    // Rank the leaderboard rows (by position, else by P&L).
    const rawData = typeof lb.data === 'string' ? JSON.parse(lb.data) : lb.data;
    if (!Array.isArray(rawData)) return json({ staged: false, reason: 'leaderboard data is not an array' });
    const hasPositions = rawData.some((r: Record<string, unknown>) => Number.isFinite(Number(r.position)));
    const sorted = [...rawData].sort((a, b) =>
      hasPositions
        ? Number(a.position ?? Number.MAX_SAFE_INTEGER) - Number(b.position ?? Number.MAX_SAFE_INTEGER)
        : Number(b.total_profit_loss ?? 0) - Number(a.total_profit_loss ?? 0),
    );
    const rows = sorted.map((r, i) => ({
      ...r,
      rank: Number.isFinite(Number(r.position)) ? Number(r.position) : i + 1,
      user_id: r.user_id ? String(r.user_id) : '',
    }));

    // Look up profiles for payment info.
    const userIds = rows.map((r) => r.user_id).filter(Boolean);
    const inList = userIds.map((u) => `"${u}"`).join(',');
    const profiles = userIds.length
      ? await db(`profiles?select=user_id,username,email,payment_id,payment_method&user_id=in.(${inList})`).then((r) => r.json())
      : [];
    const byUser = new Map(profiles.map((p: Record<string, unknown>) => [String(p.user_id), p]));

    // Build the line items with eligibility.
    const items = rows.map((r) => {
      const p = byUser.get(r.user_id) as Record<string, unknown> | undefined;
      const amount = Number(payoutForRank(r.rank).toFixed(2));
      const paymentId = (p?.payment_id as string) ?? (r as Record<string, unknown>).payment_id ?? null;
      const method = (p?.payment_method as string) ?? null;
      let eligible = false;
      let skip_reason: string | null = null;
      if (method !== 'PayPal') skip_reason = `payment_method is ${method ?? 'unset'}, not PayPal`;
      else if (!paymentId || !String(paymentId).includes('@')) skip_reason = 'no valid PayPal email';
      else eligible = true;
      return {
        user_id: r.user_id,
        username: (p?.username as string) ?? (r as Record<string, unknown>).username ?? r.user_id,
        rank: r.rank,
        payment_id: paymentId,
        payment_method: method,
        amount,
        eligible,
        skip_reason,
      };
    });

    const eligible = items.filter((i) => i.eligible);
    const total = Number(eligible.reduce((s, i) => s + i.amount, 0).toFixed(2));

    const insertRes = await db('cycle_payouts', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        leaderboard_id: lb.id,
        calculation_date: lb.calculation_date,
        status: 'pending_approval',
        item_count: items.length,
        eligible_count: eligible.length,
        total_amount: total,
        items,
      }),
    });
    const inserted = await insertRes.json();
    if (!insertRes.ok) return json({ staged: false, error: inserted }, 500);

    return json({
      staged: true,
      cycle_payout_id: inserted[0]?.id,
      leaderboard_id: lb.id,
      calculation_date: lb.calculation_date,
      item_count: items.length,
      eligible_count: eligible.length,
      total_amount: total,
    });
  } catch (err) {
    console.error('stage-cycle-payout error:', err);
    return json({ staged: false, error: (err as Error).message ?? 'Unknown error' }, 500);
  }
});
