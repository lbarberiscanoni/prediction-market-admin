import supabase from "@/lib/supabase/createClient";

export type TradeResult = {
  prediction_id: number;
  shares: number;
  market_odds: number;
  trade_value: number;
  balance: number;
};

// Places a trade through the server-side `place_trade` RPC (defined in
// supabase/migrations/20261018000000_place_trade.sql). It records
// the prediction, prices it, moves the player's balance and the outcome pools
// in one transaction, and checks consent, balance, and shares owned there.
// Players can't write balances, predictions or pools directly.
// For a buy, `amount` is dollars spent; for a sell, it's shares sold.
export async function placeTrade(
  marketId: number,
  outcomeId: number,
  tradeType: "buy" | "sell",
  amount: number
): Promise<TradeResult> {
  const { data, error } = await supabase.rpc("place_trade", {
    p_market_id: marketId,
    p_outcome_id: outcomeId,
    p_trade_type: tradeType,
    p_amount: amount,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as TradeResult;
}
