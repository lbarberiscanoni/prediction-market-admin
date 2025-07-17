/**
 * Market maker implementations for prediction markets.
 */

/**
 * Fixed price market maker - calculates shares based on current odds.
 * 
 * With this market maker, users get shares based on the current price:
 * - $10 at 50% odds gives exactly 20 shares ($10/0.5)
 * - $10 at 20% odds gives exactly 50 shares ($10/0.2)
 * 
 * @param outcome1_tokens - Token balance of the outcome being bought
 * @param outcome2_tokens - Token balance of the other outcome
 * @param predict_amt - Amount being spent in dollars
 * @returns Number of outcome shares the user receives
 */
export function fixedPriceMarketMaker(
  outcome1_tokens: number,
  outcome2_tokens: number,
  predict_amt: number
): number {
  // Calculate current odds/price
  const totalTokens = outcome1_tokens + outcome2_tokens;
  const probability = outcome1_tokens / totalTokens;
  
  // Shares = Amount spent / probability
  // This gives a fixed price of (probability) per share
  // At 50% odds, $10 gets you 20 shares ($10/0.5)
  // At 25% odds, $10 gets you 40 shares ($10/0.25)
  return predict_amt / probability;
}

/**
 * Constant Product Market Maker (CPMM) - used to update market odds after trades.
 * 
 * This function calculates the new token pools after a trade to maintain
 * the constant product relationship: outcome1_tokens * outcome2_tokens = k
 * 
 * @param outcome1_tokens - Current token balance of the outcome being bought
 * @param outcome2_tokens - Current token balance of the other outcome
 * @param predict_amt - Amount being spent
 * @returns New token balances for both outcomes [new_outcome1_tokens, new_outcome2_tokens]
 */
export function cpmm_update(
  outcome1_tokens: number,
  outcome2_tokens: number,
  predict_amt: number
): [number, number] {
  // Calculate the constant product
  const k = outcome1_tokens * outcome2_tokens;
  
  // When buying shares of outcome1, we add money to outcome1 pool
  const new_outcome1_tokens = outcome1_tokens + predict_amt;
  
  // Calculate new token amount for outcome2 to maintain the constant product
  const new_outcome2_tokens = k / new_outcome1_tokens;
  
  return [new_outcome1_tokens, new_outcome2_tokens];
}

/**
 * Original CPMM function (Kept for compatibility)
 * Calculates shares based on CPMM, which gives fewer shares due to slippage
 */
export function constantProductMarketMaker(
  outcome1_tokens: number,
  outcome2_tokens: number,
  predict_amt: number,
  min_tokens: number = 1.0 // Minimum tokens to maintain in each pool
): number {
  // Validate inputs
  if (predict_amt <= 0) {
    throw new Error("Prediction amount must be greater than zero.");
  }
  if (outcome1_tokens <= min_tokens || outcome2_tokens <= min_tokens) {
    throw new Error(`Token pools must be greater than ${min_tokens}.`);
  }

  // Calculate the constant product
  const k = outcome1_tokens * outcome2_tokens;
  
  // When buying shares of outcome1, we add money to outcome1 pool
  const new_outcome1_tokens = outcome1_tokens + predict_amt;
  
  // Calculate new token amount for outcome2 to maintain the constant product
  const new_outcome2_tokens = k / new_outcome1_tokens;
  
  // Check if the trade would reduce outcome2 tokens below minimum threshold
  if (new_outcome2_tokens < min_tokens) {
    throw new Error(`Trade would reduce liquidity too much. Maximum trade amount: ${
      outcome1_tokens * (outcome2_tokens - min_tokens) / min_tokens
    }`);
  }
  
  // The number of shares received is equal to the tokens removed from outcome2 pool
  const shares_received = outcome2_tokens - new_outcome2_tokens;
  
  // Double-check the final values
  if (shares_received < 0 || new_outcome2_tokens < min_tokens) {
    throw new Error("Invalid trade: would result in negative tokens or shares.");
  }
  
  return shares_received;
}