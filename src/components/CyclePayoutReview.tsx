'use client';

import React, { useEffect, useState } from 'react';
import supabase from '@/lib/supabase/createClient';

// Leaderboard-rank bonus schedule (see documentation.md "Leaderboard Bonus Payouts"):
//   rank 1 -> $3.00, 2 -> $1.50, 3 -> $1.00, else -> $0.50
const PLACEMENT_TOTALS: Record<number, number> = { 1: 3.0, 2: 1.5, 3: 1.0 };
const payoutForRank = (rank: number) => Number((PLACEMENT_TOTALS[rank] ?? 0.5).toFixed(2));

interface LeaderboardEntry {
  user_id?: string;
  username?: string;
  position?: number;
  total_profit_loss?: number;
}

interface PayoutRow {
  user_id: string;
  username: string;
  rank: number;
  amount: number;
  payment_method: string | null;
  payment_id: string | null;
  eligible: boolean;
  skip_reason: string | null;
}

// Reads the current leaderboard and each recipient's LIVE payment status, then —
// on an explicit click — sends the eligible PayPal payouts. Nothing is pre-staged:
// what you see is computed fresh on load, so a user who fixes their PayPal details
// is reflected immediately. The same leaderboard can never be paid twice (guarded
// by the cycle_payouts.leaderboard_id unique constraint).
export default function CyclePayoutReview() {
  const [leaderboardId, setLeaderboardId] = useState<number | null>(null);
  const [calculationDate, setCalculationDate] = useState<string>('');
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [alreadyPaidAt, setAlreadyPaidAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      // 1. Latest leaderboard (live).
      const { data: lbs, error: lbErr } = await supabase
        .from('leaderboards')
        .select('id, calculation_date, data')
        .order('calculation_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1);
      if (lbErr) throw lbErr;
      if (!lbs || lbs.length === 0) {
        setLeaderboardId(null);
        setRows([]);
        return;
      }
      const lb = lbs[0];
      const rawData = typeof lb.data === 'string' ? JSON.parse(lb.data) : lb.data;
      const entries: LeaderboardEntry[] = Array.isArray(rawData) ? rawData : [];

      // Rank by explicit position, else by P&L.
      const hasPositions = entries.some((e) => Number.isFinite(Number(e.position)));
      const sorted = [...entries].sort((a, b) =>
        hasPositions
          ? Number(a.position ?? Number.MAX_SAFE_INTEGER) - Number(b.position ?? Number.MAX_SAFE_INTEGER)
          : Number(b.total_profit_loss ?? 0) - Number(a.total_profit_loss ?? 0)
      );
      const ranked = sorted
        .map((e, i) => ({
          user_id: e.user_id ? String(e.user_id) : '',
          username: e.username,
          rank: Number.isFinite(Number(e.position)) ? Number(e.position) : i + 1,
        }))
        .filter((r) => r.user_id);

      // 2. LIVE payment info for those users.
      const userIds = ranked.map((r) => r.user_id);
      const { data: profs, error: pErr } = userIds.length
        ? await supabase
            .from('profiles')
            .select('user_id, username, payment_id, payment_method')
            .in('user_id', userIds)
        : { data: [], error: null };
      if (pErr) throw pErr;
      const byUser = new Map((profs ?? []).map((p) => [String(p.user_id), p]));

      // 3. Compute amount + eligibility live.
      const computed: PayoutRow[] = ranked.map((r) => {
        const p = byUser.get(r.user_id) as Record<string, unknown> | undefined;
        const method = (p?.payment_method as string) ?? null;
        const paymentId = (p?.payment_id as string) ?? null;
        let eligible = false;
        let skip_reason: string | null = null;
        if (method !== 'PayPal') skip_reason = `payment_method is ${method ?? 'unset'}, not PayPal`;
        else if (!paymentId || !paymentId.includes('@')) skip_reason = 'no valid PayPal email';
        else eligible = true;
        return {
          user_id: r.user_id,
          username: (p?.username as string) ?? r.username ?? r.user_id,
          rank: r.rank,
          amount: payoutForRank(r.rank),
          payment_method: method,
          payment_id: paymentId,
          eligible,
          skip_reason,
        };
      });

      setLeaderboardId(lb.id);
      setCalculationDate(lb.calculation_date);
      setRows(computed);

      // 4. Has this leaderboard already been paid?
      const { data: paid } = await supabase
        .from('cycle_payouts')
        .select('sent_at, status')
        .eq('leaderboard_id', lb.id)
        .eq('status', 'sent')
        .maybeSingle();
      setAlreadyPaidAt(paid?.sent_at ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payout data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const eligible = rows.filter((r) => r.eligible);
  const skipped = rows.filter((r) => !r.eligible);
  const total = Number(eligible.reduce((s, r) => s + r.amount, 0).toFixed(2));

  const approveAndSend = async () => {
    if (leaderboardId == null) return;
    setProcessing(true);
    setError(null);
    setMessage(null);

    try {
      // Guard: never pay the same leaderboard twice.
      const { data: existing } = await supabase
        .from('cycle_payouts')
        .select('status, sent_at')
        .eq('leaderboard_id', leaderboardId)
        .maybeSingle();
      if (existing?.status === 'sent') {
        setAlreadyPaidAt(existing.sent_at ?? null);
        throw new Error("This leaderboard's bonuses were already paid.");
      }

      // Claim the batch and record exactly what we're about to pay (audit trail).
      // The leaderboard_id unique constraint blocks a concurrent double-send.
      const { error: claimErr } = await supabase.from('cycle_payouts').upsert(
        {
          leaderboard_id: leaderboardId,
          calculation_date: calculationDate,
          status: 'sending',
          item_count: rows.length,
          eligible_count: eligible.length,
          total_amount: total,
          items: rows,
        },
        { onConflict: 'leaderboard_id' }
      );
      if (claimErr) throw claimErr;

      // Resolve profiles.id (bigint) so payments rows link back.
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, user_id')
        .in(
          'user_id',
          eligible.map((e) => e.user_id)
        );
      const idByUser = new Map((profs ?? []).map((p) => [String(p.user_id), p.id]));

      const failures: string[] = [];
      let sent = 0;
      for (const item of eligible) {
        const { data, error: fnErr } = await supabase.functions.invoke('send-paypal-payout', {
          body: {
            email: item.payment_id,
            amount: item.amount,
            note: `Prediction market leaderboard bonus (rank ${item.rank})`,
          },
        });
        if (fnErr || !data?.transaction_id) {
          failures.push(`${item.username}: ${fnErr?.message || 'no transaction id'}`);
          continue;
        }
        await supabase.from('payments').insert({
          player_id: idByUser.get(item.user_id) ?? null,
          amount: item.amount,
          payment_method: 'PayPal',
          status: 'Pending',
          transaction_id: data.transaction_id,
          paypal_batch_id: data.batch_id ?? null,
          paypal_status: data.transaction_status ?? null,
        });
        sent += 1;
      }

      await supabase
        .from('cycle_payouts')
        .update({
          status: 'sent',
          approved_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
        })
        .eq('leaderboard_id', leaderboardId);

      if (failures.length) {
        setError(`Sent ${sent}, ${failures.length} failed: ${failures.join('; ')}`);
      } else {
        setMessage(`Approved and sent ${sent} payout${sent === 1 ? '' : 's'} ($${total.toFixed(2)}).`);
      }
      setShowConfirm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send payouts');
    } finally {
      setProcessing(false);
      setShowConfirm(false);
    }
  };

  if (loading || leaderboardId == null) return null;

  const paid = alreadyPaidAt != null;

  return (
    <div className="bg-gray-800 p-4 mb-6 rounded-lg shadow-md border border-amber-600">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h3 className="text-xl font-semibold text-amber-300">Cycle Payout — Leaderboard {calculationDate}</h3>
          <p className="text-sm text-gray-300 mt-1">
            <strong>{eligible.length}</strong> payable via PayPal · <strong>${total.toFixed(2)}</strong> total ·{' '}
            {skipped.length} not on PayPal
            {paid && (
              <span className="ml-2 text-green-400">
                · already paid {new Date(alreadyPaidAt as string).toLocaleDateString()}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => setShowConfirm(true)}
          disabled={processing || paid || eligible.length === 0}
          className="px-5 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition-colors disabled:opacity-50"
        >
          {processing ? 'Sending…' : paid ? 'Paid' : `Approve & Send (${eligible.length})`}
        </button>
      </div>

      {message && <p className="text-green-400 mt-3">{message}</p>}
      {error && <p className="text-red-400 mt-3 whitespace-pre-line">{error}</p>}

      <div className="overflow-x-auto mt-4">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-700">
              <th className="px-3 py-2">Rank</th>
              <th className="px-3 py-2">Username</th>
              <th className="px-3 py-2">Method</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.user_id} className="border-b border-gray-800">
                <td className="px-3 py-2">{item.rank}</td>
                <td className="px-3 py-2 font-medium">{item.username}</td>
                <td className="px-3 py-2">{item.payment_method ?? '—'}</td>
                <td className="px-3 py-2">${item.amount.toFixed(2)}</td>
                <td className="px-3 py-2">
                  {item.eligible ? (
                    <span className="text-green-400">Will pay</span>
                  ) : (
                    <span className="text-gray-500">Skip — {item.skip_reason}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg shadow-lg max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Confirm Cycle Payout</h3>
            <p>
              Send <strong>{eligible.length}</strong> real PayPal payout{eligible.length === 1 ? '' : 's'} totaling{' '}
              <strong className="text-green-400">${total.toFixed(2)}</strong>?
            </p>
            <p className="mt-2 text-sm text-amber-400">This moves real money and cannot be undone.</p>
            <div className="flex justify-end gap-4 mt-6">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={processing}
                className="px-4 py-2 bg-gray-600 rounded hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={approveAndSend}
                disabled={processing}
                className="px-4 py-2 bg-green-600 rounded hover:bg-green-700"
              >
                {processing ? 'Sending…' : 'Confirm & Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
