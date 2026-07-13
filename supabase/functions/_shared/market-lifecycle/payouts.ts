// Pure payout math for the market lifecycle — the single source of truth shared
// by resolve-market and annul-market (both the dry-run simulation and the real
// write path). No DB, no I/O: give it predictions, get back payout records.
//
//   resolution → net shares on the WINNING outcome, paid at $1.00/share
//   annulment  → net shares across ALL outcomes,   refunded at $0.50/share
// Only strictly-positive net balances are paid.

export const RESOLVE_SHARE_VALUE = 1.0;
export const ANNUL_SHARE_VALUE = 0.5;

export interface Prediction {
  user_id: string;
  outcome_id: number | string;
  trade_type: string; // "buy" | "sell"
  shares_amt: number | null;
  trade_value?: number | null;
}

export interface PayoutRecord {
  user_id: string;
  market_id: number;
  outcome_id: number | null; // the winning outcome for resolution; null for annulment
  payout_amount: number;
}

export interface PayoutResult {
  payouts: PayoutRecord[];
  totalCount: number;
  totalAmount: number;
}

// Net signed shares per user: buys add, sells subtract. `filter` restricts which
// predictions count (winning outcome for resolution; all of them for annulment).
function netSharesByUser(
  predictions: Prediction[],
  filter: (p: Prediction) => boolean,
): Map<string, number> {
  const net = new Map<string, number>();
  for (const p of predictions) {
    if (!filter(p)) continue;
    const shares = Number(p.shares_amt ?? 0);
    const signed = p.trade_type === "sell" ? -shares : p.trade_type === "buy" ? shares : 0;
    net.set(p.user_id, (net.get(p.user_id) ?? 0) + signed);
  }
  return net;
}

function toResult(
  net: Map<string, number>,
  perShare: number,
  marketId: number,
  outcomeId: number | null,
): PayoutResult {
  const payouts: PayoutRecord[] = [];
  let totalAmount = 0;
  for (const [user_id, shares] of net) {
    if (shares <= 0) continue; // only positive net balances are paid
    const payout_amount = shares * perShare;
    payouts.push({ user_id, market_id: marketId, outcome_id: outcomeId, payout_amount });
    totalAmount += payout_amount;
  }
  return { payouts, totalCount: payouts.length, totalAmount };
}

// Resolution: pay holders of the winning outcome $1.00 per net share.
export function computeResolutionPayouts(
  predictions: Prediction[],
  winningOutcomeId: number | string,
  marketId: number,
): PayoutResult {
  const net = netSharesByUser(
    predictions,
    (p) => String(p.outcome_id) === String(winningOutcomeId),
  );
  return toResult(net, RESOLVE_SHARE_VALUE, marketId, Number(winningOutcomeId));
}

// Annulment: refund every holder $0.50 per net share across all outcomes.
export function computeAnnulmentPayouts(
  predictions: Prediction[],
  marketId: number,
): PayoutResult {
  const net = netSharesByUser(predictions, () => true);
  return toResult(net, ANNUL_SHARE_VALUE, marketId, null);
}
