// Pure leaderboard-bonus "cycle plan" logic — the single source of truth for
// WHO gets a bonus, HOW MUCH, and (if not) WHY. Shared by the auto-pay-cycle
// edge function; mirrors CyclePayoutReview.tsx and stage-cycle-payout. No DB, no
// network, no PayPal: give it leaderboard rows + profiles, get back the plan.
//
// Bonus schedule (see documentation.md "Leaderboard Bonus Payouts"):
//   rank 1 -> $3.00, 2 -> $1.50, 3 -> $1.00, else -> $0.50

export const BASE_PAYOUT = 0.5;
export const PLACEMENT_TOTALS: Record<number, number> = { 1: 3.0, 2: 1.5, 3: 1.0 };
// Safety net: a cycle whose eligible total exceeds this is flagged `overCap` and
// left for manual review instead of auto-sent.
export const DEFAULT_MAX_CYCLE_USD = 100;

export const payoutForRank = (rank: number): number =>
  Number((PLACEMENT_TOTALS[rank] ?? BASE_PAYOUT).toFixed(2));

export interface LeaderboardEntry {
  user_id?: string | null;
  username?: string | null;
  position?: number | null;
  total_profit_loss?: number | null;
}

export interface ProfileInfo {
  id?: number | null;
  user_id: string;
  username?: string | null;
  payment_id?: string | null;
  payment_method?: string | null;
}

export interface CyclePayoutItem {
  user_id: string;
  profile_id: number | null;
  username: string;
  rank: number;
  amount: number;
  payment_method: string | null;
  payment_id: string | null;
  eligible: boolean;
  skip_reason: string | null;
}

export interface CyclePlan {
  items: CyclePayoutItem[];
  eligible: CyclePayoutItem[];
  itemCount: number;
  eligibleCount: number;
  totalAmount: number;
  overCap: boolean;
}

// Sort + rank leaderboard rows: by explicit `position` when any row has one,
// else by descending P&L. Rows without a user_id are dropped.
export function rankEntries(
  entries: LeaderboardEntry[],
): Array<{ user_id: string; username?: string | null; rank: number }> {
  const hasPositions = entries.some((r) => Number.isFinite(Number(r.position)));
  const sorted = [...entries].sort((a, b) =>
    hasPositions
      ? Number(a.position ?? Number.MAX_SAFE_INTEGER) - Number(b.position ?? Number.MAX_SAFE_INTEGER)
      : Number(b.total_profit_loss ?? 0) - Number(a.total_profit_loss ?? 0)
  );
  return sorted
    .map((r, i) => ({
      user_id: r.user_id ? String(r.user_id) : "",
      username: r.username,
      rank: Number.isFinite(Number(r.position)) ? Number(r.position) : i + 1,
    }))
    .filter((r) => r.user_id);
}

// Build the full plan: rank the leaderboard, join each row to its profile's live
// payment info, compute amount + eligibility, and total the eligible rows.
export function computeCyclePlan(
  entries: LeaderboardEntry[],
  profiles: ProfileInfo[],
  maxCycleUsd: number = DEFAULT_MAX_CYCLE_USD,
): CyclePlan {
  const byUser = new Map(profiles.map((p) => [String(p.user_id), p]));

  const items: CyclePayoutItem[] = rankEntries(entries).map((r) => {
    const p = byUser.get(r.user_id);
    const method = p?.payment_method ?? null;
    const paymentId = p?.payment_id ?? null;

    let eligible = false;
    let skip_reason: string | null = null;
    if (method !== "PayPal") skip_reason = `payment_method is ${method ?? "unset"}, not PayPal`;
    else if (!paymentId || !paymentId.includes("@")) skip_reason = "no valid PayPal email";
    else eligible = true;

    return {
      user_id: r.user_id,
      profile_id: p?.id ?? null,
      username: p?.username ?? r.username ?? r.user_id,
      rank: r.rank,
      amount: payoutForRank(r.rank),
      payment_method: method,
      payment_id: paymentId,
      eligible,
      skip_reason,
    };
  });

  const eligible = items.filter((i) => i.eligible);
  const totalAmount = Number(eligible.reduce((s, i) => s + i.amount, 0).toFixed(2));

  return {
    items,
    eligible,
    itemCount: items.length,
    eligibleCount: eligible.length,
    totalAmount,
    overCap: totalAmount > maxCycleUsd,
  };
}
