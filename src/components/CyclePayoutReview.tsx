'use client';

import React, { useEffect, useState } from 'react';
import supabase from '@/lib/supabase/createClient';

interface CycleItem {
  user_id: string;
  username: string;
  rank: number;
  payment_id: string | null;
  payment_method: string | null;
  amount: number;
  eligible: boolean;
  skip_reason: string | null;
}

interface CyclePayout {
  id: number;
  leaderboard_id: number;
  calculation_date: string;
  status: string;
  item_count: number;
  eligible_count: number;
  total_amount: number;
  items: CycleItem[];
}

// Shows the staged (pending_approval) cycle payout for admin review, and — on an
// explicit click — sends the eligible PayPal payouts. This is the human-in-the-loop
// approval step: nothing here moves money until the admin confirms.
export default function CyclePayoutReview() {
  const [cycle, setCycle] = useState<CyclePayout | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPending = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('cycle_payouts')
      .select('*')
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setCycle((data as CyclePayout | null) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    fetchPending();
  }, []);

  const approveAndSend = async () => {
    if (!cycle) return;
    setProcessing(true);
    setError(null);
    setMessage(null);

    const eligible = cycle.items.filter((i) => i.eligible);

    // Lock the batch so it can't be double-sent (concurrent tab / retry).
    const { data: locked, error: lockErr } = await supabase
      .from('cycle_payouts')
      .update({ status: 'sending' })
      .eq('id', cycle.id)
      .eq('status', 'pending_approval')
      .select()
      .maybeSingle();
    if (lockErr || !locked) {
      setError('This cycle payout is no longer pending (already sending or sent). Refreshing.');
      setProcessing(false);
      setShowConfirm(false);
      fetchPending();
      return;
    }

    // Resolve profiles.id (bigint) for each eligible user so payments rows link back.
    const userIds = eligible.map((i) => i.user_id);
    const { data: profs } = await supabase
      .from('profiles')
      .select('id,user_id')
      .in('user_id', userIds);
    const idByUser = new Map((profs ?? []).map((p) => [String(p.user_id), p.id]));

    const failures: string[] = [];
    let sent = 0;
    for (const item of eligible) {
      const { data, error: fnErr } = await supabase.functions.invoke('send-paypal-payout', {
        body: { email: item.payment_id, amount: item.amount, note: `Prediction market leaderboard bonus (rank ${item.rank})` },
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
      .update({ status: 'sent', approved_at: new Date().toISOString(), sent_at: new Date().toISOString() })
      .eq('id', cycle.id);

    if (failures.length) {
      setError(`Sent ${sent}, ${failures.length} failed: ${failures.join('; ')}`);
    } else {
      setMessage(`Approved and sent ${sent} payout${sent === 1 ? '' : 's'} ($${cycle.total_amount.toFixed(2)}).`);
    }
    setProcessing(false);
    setShowConfirm(false);
    fetchPending();
  };

  if (loading || !cycle) return null;

  const eligible = cycle.items.filter((i) => i.eligible);
  const skipped = cycle.items.filter((i) => !i.eligible);

  return (
    <div className="bg-gray-800 p-4 mb-6 rounded-lg shadow-md border border-amber-600">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h3 className="text-xl font-semibold text-amber-300">Cycle Payout Ready for Review</h3>
          <p className="text-sm text-gray-300 mt-1">
            Leaderboard {cycle.calculation_date} · <strong>{eligible.length}</strong> payable via PayPal ·{' '}
            <strong>${cycle.total_amount.toFixed(2)}</strong> total · {skipped.length} skipped (not on PayPal)
          </p>
        </div>
        <button
          onClick={() => setShowConfirm(true)}
          disabled={processing || eligible.length === 0}
          className="px-5 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition-colors disabled:opacity-50"
        >
          {processing ? 'Sending…' : `Approve & Send (${eligible.length})`}
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
            {cycle.items.map((item) => (
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
              <strong className="text-green-400">${cycle.total_amount.toFixed(2)}</strong>?
            </p>
            <p className="mt-2 text-sm text-amber-400">This moves real money and cannot be undone.</p>
            <div className="flex justify-end gap-4 mt-6">
              <button onClick={() => setShowConfirm(false)} disabled={processing} className="px-4 py-2 bg-gray-600 rounded hover:bg-gray-700">
                Cancel
              </button>
              <button onClick={approveAndSend} disabled={processing} className="px-4 py-2 bg-green-600 rounded hover:bg-green-700">
                {processing ? 'Sending…' : 'Confirm & Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
