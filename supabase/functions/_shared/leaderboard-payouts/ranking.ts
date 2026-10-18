// Leaderboard ranking: by return % (profit / amount bought), not raw profit,
// so a bigger bankroll doesn't buy a better rank. A newcomer at 1000 tokens and
// a veteran at 5000 compete on forecasting skill alone.
//
// Players who bought less than MIN_STAKE in the window still appear (and still
// collect the participation bonus) but rank below every qualifier, so a lucky
// 1-token bet can't take first place.

export const MIN_STAKE = 50;

export interface RankableEntry {
  total_profit_loss: number;
  total_bought_amount: number;
  percent_pnl: number;
  position: number;
}

export function rankLeaderboard<T extends RankableEntry>(entries: T[], minStake = MIN_STAKE): T[] {
  const qualifies = (e: T) => e.total_bought_amount >= minStake;
  return entries
    .filter((e) => e.total_bought_amount > 0)
    .map((e) => ({ ...e }))
    .sort((a, b) =>
      Number(qualifies(b)) - Number(qualifies(a)) ||
      b.percent_pnl - a.percent_pnl ||
      b.total_profit_loss - a.total_profit_loss
    )
    .map((e, i) => ({ ...e, position: i + 1 }));
}
