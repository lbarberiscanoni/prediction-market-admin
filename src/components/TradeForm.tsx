"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import supabase from "@/lib/supabase/createClient";
import { addPrediction } from "@/lib/predictions";
import { fixedPriceMarketMaker, cpmm_update } from "@/lib/marketMakers";
import { User } from "@supabase/supabase-js";
import {
  Market,
  Answer,
  TradePreview,
} from "@/lib/tradingTypes";

export default function TradeForm() {
  const { id } = useParams();
  
  // State variables
  const [market, setMarket] = useState<Market | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [totalPrice, setTotalPrice] = useState<number>(10);
  const [computedShares, setComputedShares] = useState<number>(0);
  const [selectedAnswer, setSelectedAnswer] = useState<Answer | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [userBalance, setUserBalance] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  
  // Loading states
  const [isUserLoading, setIsUserLoading] = useState<boolean>(true);
  const [isMarketLoading, setIsMarketLoading] = useState<boolean>(true);
  const [isSharesLoading, setIsSharesLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isBalanceLoading, setIsBalanceLoading] = useState<boolean>(true);

  // State to track user's share balances
  const [userShares, setUserShares] = useState<{[outcomeId: number]: number}>({});

  // Fetch logged-in user and their balance.
  useEffect(() => {
    async function fetchUserAndBalance() {
      setIsUserLoading(true);
      setIsBalanceLoading(true);
      
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) {
        setError(`Error fetching user: ${userError.message}`);
        setIsUserLoading(false);
        setIsBalanceLoading(false);
        return;
      }
      
      setUser(user);
      setIsUserLoading(false);

      if (user) {
        // Fetch user's balance
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("balance")
          .eq("user_id", user.id)
          .single();

        if (profileError) {
          console.error("Error fetching user balance:", profileError.message);
          setUserBalance(0); // Default to 0 if we can't fetch balance
        } else {
          setUserBalance(Number(profileData?.balance || 0));
        }
      }
      
      setIsBalanceLoading(false);
    }
    fetchUserAndBalance();
  }, []);

  // Fetch market details and outcomes.
  const fetchMarketData = useCallback(async () => {
    if (!id) return;
    setIsMarketLoading(true);
    try {
      const { data: marketData, error: marketError } = await supabase
        .from("markets")
        .select("id, name, description, token_pool, market_maker")
        .eq("id", id)
        .single();
      if (marketError) throw new Error(marketError.message);
      setMarket(marketData as Market);

      const { data: answersData, error: answersError } = await supabase
        .from("outcomes")
        .select("id, name, tokens, market_id")
        .eq("market_id", id);
      if (answersError) throw new Error(answersError.message);
      setAnswers(answersData as Answer[]);
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError(`Error fetching market data: ${e.message}`);
      } else {
        setError("Error fetching market data.");
      }
    } finally {
      setIsMarketLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchMarketData();
  }, [fetchMarketData]);
  
  // Fetch user's shares whenever user or market changes
  useEffect(() => {
    async function fetchUserShares() {
      if (!user || !market) return;
      
      setIsSharesLoading(true);
      try {
        const { data, error } = await supabase
          .from("predictions")
          .select("outcome_id, shares_amt, trade_type")
          .eq("user_id", user.id)
          .eq("market_id", market.id);
          
        if (error) throw error;
        
        const shares: {[outcomeId: number]: number} = {};
        
        answers.forEach(answer => {
          shares[answer.id] = 0;
        });
        
        data?.forEach(pred => {
          const outcomeId = pred.outcome_id;
          const amount = pred.shares_amt || 0;
          if (pred.trade_type === 'buy') {
            shares[outcomeId] = (shares[outcomeId] || 0) + amount;
          } else if (pred.trade_type === 'sell') {
            shares[outcomeId] = (shares[outcomeId] || 0) - amount;
          }
        });
        
        setUserShares(shares);
      } catch (e) {
        console.error("Error fetching user shares:", e);
      } finally {
        setIsSharesLoading(false);
      }
    }
    
    fetchUserShares();
  }, [user, market, answers]);

  // Refresh user balance after successful trades
  const refreshUserBalance = useCallback(async () => {
    if (!user) return;
    
    try {
      const { data: profileData, error } = await supabase
        .from("profiles")
        .select("balance")
        .eq("user_id", user.id)
        .single();

      if (!error && profileData) {
        setUserBalance(Number(profileData.balance || 0));
      }
    } catch (e) {
      console.error("Error refreshing user balance:", e);
    }
  }, [user]);

  // Calculate trade preview using CPMM
  const calculateTradePreview = (): TradePreview => {
    if (!selectedAnswer || totalPrice <= 0 || answers.length !== 2 || tradeType !== 'buy') {
      return {
        sharesReceived: 0,
        avgPrice: 0,
        priceImpact: 0,
        newOdds: 0,
        expectedProfit: 0,
        isValid: false,
        error: null
      };
    }

    const otherAnswer = answers.find((a) => a.id !== selectedAnswer.id)!;
    const currentTotalTokens = selectedAnswer.tokens + otherAnswer.tokens;
    const currentOdds = selectedAnswer.tokens / currentTotalTokens;

    try {
      // First, calculate shares that would be received
      const sharesReceived = fixedPriceMarketMaker(
        selectedAnswer.tokens,
        otherAnswer.tokens,
        totalPrice
      );

      // Check if shares requested exceed available tokens
      if (sharesReceived > selectedAnswer.tokens) {
        return {
          sharesReceived: 0,
          avgPrice: 0,
          priceImpact: 0,
          newOdds: 0,
          expectedProfit: 0,
          isValid: false,
          error: `Not enough tokens available. You're trying to purchase ${sharesReceived.toFixed(2)} shares, but only ${selectedAnswer.tokens.toFixed(2)} tokens are available for ${selectedAnswer.name}.`
        };
      }

      // Then validate using CPMM calculation
      const [newSelectedTokens, newOtherTokens] = cpmm_update(
        selectedAnswer.tokens,
        otherAnswer.tokens,
        totalPrice
      );

      // Validate the trade won't break the market
      if (newSelectedTokens < 0 || newOtherTokens < 0) {
        return {
          sharesReceived: 0,
          avgPrice: 0,
          priceImpact: 0,
          newOdds: 0,
          expectedProfit: 0,
          isValid: false,
          error: "Trade too large - would drain market liquidity"
        };
      }

      // Keep minimum liquidity threshold
      const minLiquidity = 1;
      if (newSelectedTokens < minLiquidity || newOtherTokens < minLiquidity) {
        return {
          sharesReceived: 0,
          avgPrice: 0,
          priceImpact: 0,
          newOdds: 0,
          expectedProfit: 0,
          isValid: false,
          error: "Trade would leave insufficient market liquidity"
        };
      }

      // Calculate metrics
      const avgPrice = totalPrice / sharesReceived;
      const newTotalTokens = newSelectedTokens + newOtherTokens;
      const newOdds = newSelectedTokens / newTotalTokens;
      const priceImpact = Math.abs(newOdds - currentOdds) / currentOdds * 100;
      const expectedProfit = sharesReceived - totalPrice;

      return {
        sharesReceived,
        avgPrice,
        priceImpact,
        newOdds,
        expectedProfit,
        isValid: true,
        error: null
      };

    } catch (error) {
      return {
        sharesReceived: 0,
        avgPrice: 0,
        priceImpact: 0,
        newOdds: 0,
        expectedProfit: 0,
        isValid: false,
        error: error instanceof Error ? error.message : "Trade calculation failed"
      };
    }
  };

  // Calculate maximum safe purchase amount based on user balance
  const getMaxPurchaseAmount = (): number => {
    if (!selectedAnswer || answers.length !== 2 || tradeType !== 'buy') {
      return 0;
    }

    const otherAnswer = answers.find((a) => a.id !== selectedAnswer.id)!;
    const currentTotalTokens = selectedAnswer.tokens + otherAnswer.tokens;
    const currentOdds = selectedAnswer.tokens / currentTotalTokens;
    
    // Maximum shares we can buy = available tokens for this outcome
    const maxShares = selectedAnswer.tokens;
    
    // Maximum dollar amount based on market liquidity
    const maxDollarAmountByLiquidity = maxShares * currentOdds;
    
    // Maximum dollar amount based on user balance
    const maxDollarAmountByBalance = userBalance;
    
    // Take the minimum of the two constraints
    const constrainedMaxAmount = Math.min(maxDollarAmountByLiquidity, maxDollarAmountByBalance);
    
    // Also check CPMM constraints using binary search for safety
    let low = 0;
    let high = constrainedMaxAmount;
    let safeMaxAmount = 0;

    for (let i = 0; i < 50; i++) {
      const mid = (low + high) / 2;
      
      try {
        // Check if this amount would result in valid shares
        const sharesReceived = fixedPriceMarketMaker(
          selectedAnswer.tokens,
          otherAnswer.tokens,
          mid
        );
        
        // Check both token availability and CPMM constraints
        if (sharesReceived <= selectedAnswer.tokens) {
          const [newSelectedTokens, newOtherTokens] = cpmm_update(
            selectedAnswer.tokens,
            otherAnswer.tokens,
            mid
          );

          if (newSelectedTokens >= 1 && newOtherTokens >= 1) {
            safeMaxAmount = mid;
            low = mid;
          } else {
            high = mid;
          }
        } else {
          high = mid;
        }
      } catch {
        high = mid;
      }

      if (high - low < 0.01) break;
    }

    return Math.floor(safeMaxAmount * 100) / 100;
  };

  // Update shares calculation with CPMM validation
  useEffect(() => {
    // Clear any previous errors when inputs change
    setError(null);
    
    if (selectedAnswer && totalPrice > 0 && answers.length === 2) {
      if (tradeType === 'buy') {
        const preview = calculateTradePreview();
        
        if (!preview.isValid) {
          setError(preview.error);
          setComputedShares(0);
        } else {
          setComputedShares(preview.sharesReceived);
        }
      } else {
        setComputedShares(totalPrice);
      }
    } else {
      setComputedShares(0);
    }
  }, [selectedAnswer, totalPrice, answers, tradeType]);

  // Format functions
  const formatShares = (value: number, decimals: number = 2): number => {
    return parseFloat(value.toFixed(decimals));
  };
  
  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2 
    }).format(value);
  };

  // Enhanced buy validation that checks balance
  const validateBuyTrade = (): { isValid: boolean; error?: string } => {
    if (!selectedAnswer || totalPrice <= 0) {
      return { isValid: false, error: "Invalid trade parameters" };
    }

    // Check user balance
    if (totalPrice > userBalance) {
      return { 
        isValid: false, 
        error: `Insufficient balance. You have ${formatCurrency(userBalance)} but need ${formatCurrency(totalPrice)}.` 
      };
    }

    // Check market constraints
    const preview = calculateTradePreview();
    if (!preview.isValid) {
      return { isValid: false, error: preview.error || "Invalid trade" };
    }

    return { isValid: true };
  };

  // Handle buy prediction with enhanced validation
  const handleBuy = async () => {
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);
  
    if (!user) {
      setError("User is not logged in.");
      setIsSubmitting(false);
      return;
    }
    if (!market || !selectedAnswer) {
      setError("Market data or outcome selection is missing.");
      setIsSubmitting(false);
      return;
    }

    // Enhanced validation including balance check
    const validation = validateBuyTrade();
    if (!validation.isValid) {
      setError(validation.error || "Invalid trade");
      setIsSubmitting(false);
      return;
    }

    if (answers.length !== 2) {
      setError("This market currently supports only binary outcomes.");
      setIsSubmitting(false);
      return;
    }

    try {
      const otherAnswer = answers.find((a) => a.id !== selectedAnswer.id)!;
      const totalTokens = selectedAnswer.tokens + otherAnswer.tokens;
      const currentOdds = selectedAnswer.tokens / totalTokens;
      
      // Calculate shares and new token distributions
      const sharesPurchased = fixedPriceMarketMaker(
        selectedAnswer.tokens,
        otherAnswer.tokens,
        totalPrice
      );

      const [newOutcome1Tokens, newOutcome2Tokens] = cpmm_update(
        selectedAnswer.tokens,
        otherAnswer.tokens,
        totalPrice
      );

      // Final safety check
      if (newOutcome1Tokens < 0 || newOutcome2Tokens < 0) {
        throw new Error("Trade would result in negative token pools.");
      }

      // Create prediction (this will also update user balance)
      await addPrediction({
        user_id: user.id,
        market_id: market.id,
        outcome_id: selectedAnswer.id,
        shares_amt: sharesPurchased,
        market_odds: currentOdds,
        trade_value: -totalPrice,
        trade_type: 'buy'
      });

      // Update token pools
      const { error: updateError1 } = await supabase
        .from("outcomes")
        .update({ tokens: newOutcome1Tokens })
        .eq("id", selectedAnswer.id);
      if (updateError1) throw new Error(updateError1.message);

      const { error: updateError2 } = await supabase
        .from("outcomes")
        .update({ tokens: newOutcome2Tokens })
        .eq("id", otherAnswer.id);
      if (updateError2) throw new Error(updateError2.message);

      // Update market token pool
      const newMarketTokenPool = newOutcome1Tokens + newOutcome2Tokens;
      const { error: marketUpdateError } = await supabase
        .from("markets")
        .update({ token_pool: newMarketTokenPool })
        .eq("id", market.id);

      if (marketUpdateError) {
        throw new Error(`Failed to update market token_pool: ${marketUpdateError.message}`);
      }

      setSuccess(
        `Purchase successful! You spent ${formatCurrency(totalPrice)} and received ${sharesPurchased.toFixed(2)} shares.`
      );

      // Refresh data
      await Promise.all([
        fetchMarketData(),
        refreshUserBalance()
      ]);
      
      setSelectedAnswer(null);
      setTotalPrice(10);
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError(`Error making prediction: ${e.message}`);
      } else {
        setError("Error making prediction.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // Handle sell (unchanged but refresh balance after)
  const handleSell = async () => {
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);
    
    if (!user || !market || !selectedAnswer) {
      setError("Missing user, market, or outcome.");
      setIsSubmitting(false);
      return;
    }
    
    const sellShares = totalPrice;
    const owned = userShares[selectedAnswer.id] || 0;
    const formattedOwned = formatShares(owned);
    const formattedSellShares = formatShares(sellShares);
    
    if (formattedSellShares > formattedOwned) {
      setError(`Not enough shares to sell. You own ${formattedOwned.toFixed(2)} shares of ${selectedAnswer.name}.`);
      setIsSubmitting(false);
      return;
    }
    
    if (formattedOwned <= 0) {
      setError(`You don't own any shares of ${selectedAnswer.name} to sell.`);
      setIsSubmitting(false);
      return;
    }

    try {
      const otherAnswer = answers.find((a) => a.id !== selectedAnswer.id)!;
      const totalTokens = selectedAnswer.tokens + otherAnswer.tokens;
      const currentOdds = selectedAnswer.tokens / totalTokens;
      
      const receivedAmount = sellShares * currentOdds;
      
      const [new_other_tokens, new_selected_tokens] = cpmm_update(
        otherAnswer.tokens,
        selectedAnswer.tokens,
        receivedAmount
      );
      
      await addPrediction({
        user_id: user.id,
        market_id: market.id,
        outcome_id: selectedAnswer.id,
        shares_amt: sellShares,
        market_odds: currentOdds,
        trade_value: receivedAmount,
        trade_type: 'sell'
      });
    
      const { error: updateError1 } = await supabase
        .from("outcomes")
        .update({ tokens: new_selected_tokens })
        .eq("id", selectedAnswer.id);
      
      if (updateError1) throw new Error(`Failed to update outcome tokens: ${updateError1.message}`);
      
      const { error: updateError2 } = await supabase
        .from("outcomes")
        .update({ tokens: new_other_tokens })
        .eq("id", otherAnswer.id);
        
      if (updateError2) throw new Error(`Failed to update opposing outcome tokens: ${updateError2.message}`);
      
      const newMarketTokenPool = new_selected_tokens + new_other_tokens;
      const { error: marketUpdateError } = await supabase
        .from("markets")
        .update({ token_pool: newMarketTokenPool })
        .eq("id", market.id);
      
      if (marketUpdateError) {
        throw new Error(`Failed to update market token_pool: ${marketUpdateError.message}`);
      }
    
      setSuccess(`Successfully sold ${formatShares(sellShares).toFixed(2)} shares of ${selectedAnswer.name} and received ${formatCurrency(receivedAmount)}`);
      
      // Refresh data
      await Promise.all([
        fetchMarketData(),
        refreshUserBalance()
      ]);
      
      setSelectedAnswer(null);
      setTotalPrice(10);
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError(`Error selling shares: ${e.message}`);
      } else {
        setError("An unexpected error occurred when selling shares.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Calculate values for display
  const totalOutcomeTokens = answers.reduce((sum, a) => sum + a.tokens, 0);
  const getOutcomeProbability = (answer: Answer) => {
    return totalOutcomeTokens > 0
      ? ((answer.tokens / totalOutcomeTokens) * 100).toFixed(0)
      : '0';
  };

  const calculateSellAmount = (): string => {
    if (!selectedAnswer || tradeType !== 'sell') return formatCurrency(0);
    const currentOdds = selectedAnswer.tokens / totalOutcomeTokens;
    const receivedAmount = totalPrice * currentOdds;
    return formatCurrency(receivedAmount);
  };

  // Enhanced validation that includes balance check
  const validateTrade = (): { isValid: boolean; reason?: string } => {
    if (!selectedAnswer || totalPrice <= 0) {
      return { isValid: false };
    }

    if (tradeType === 'buy') {
      const validation = validateBuyTrade();
      return { isValid: validation.isValid, reason: validation.error };
    }

    if (tradeType === 'sell') {
      const owned = userShares[selectedAnswer.id] || 0;
      if (formatShares(totalPrice) > formatShares(owned)) {
        return { isValid: false, reason: `Insufficient shares` };
      }
    }

    return { isValid: true };
  };

  const handleSubmit = tradeType === 'buy' ? handleBuy : handleSell;
  const validation = validateTrade();
  const preview = calculateTradePreview();

  const LoadingSkeleton = () => (
    <div className="animate-pulse">
      <div className="h-4 bg-[#2C2C2C] rounded w-3/4 mb-4"></div>
      <div className="h-10 bg-[#2C2C2C] rounded w-full mb-4"></div>
      <div className="h-10 bg-[#2C2C2C] rounded w-full mb-4"></div>
    </div>
  );

  const isLoading = isUserLoading || isMarketLoading || isBalanceLoading;

  return (
    <div className="w-full max-w-md bg-[#1E1E1E] rounded-2xl shadow-lg border border-[#2C2C2C] p-6">
      {/* Market Title */}
      <div className="mb-6">
        {isMarketLoading ? (
          <div className="h-6 bg-[#2C2C2C] rounded w-2/3 animate-pulse"></div>
        ) : (
          <h2 className="text-white text-xl font-semibold">
            {market?.name}
          </h2>
        )}
      </div>

      {/* User Balance Display */}
      <div className="mb-4 p-3 bg-[#2C2C2C] rounded-lg">
        <div className="flex justify-between items-center">
          <span className="text-gray-400">Your Balance:</span>
          {isBalanceLoading ? (
            <div className="h-4 bg-[#3C3C3C] rounded w-16 animate-pulse"></div>
          ) : (
            <span className="text-white font-medium">{formatCurrency(userBalance)}</span>
          )}
        </div>
      </div>

      {/* Trade Type Selector */}
      <div className="flex mb-6">
        <button
          onClick={() => setTradeType('buy')}
          className={`w-1/2 py-2 ${
            tradeType === 'buy' 
              ? 'bg-blue-600 text-white' 
              : 'bg-[#2C2C2C] text-gray-400'
          } rounded-l-lg transition-colors`}
          disabled={isLoading}
        >
          Buy
        </button>
        <button
          onClick={() => setTradeType('sell')}
          className={`w-1/2 py-2 ${
            tradeType === 'sell' 
              ? 'bg-blue-600 text-white' 
              : 'bg-[#2C2C2C] text-gray-400'
          } rounded-r-lg transition-colors`}
          disabled={isLoading}
        >
          Sell
        </button>
      </div>

      {/* Outcome Buttons */}
      <div className="flex gap-4 mb-6">
        {isMarketLoading ? (
          <>
            <div className="flex-1 h-12 bg-[#2C2C2C] rounded-lg animate-pulse"></div>
            <div className="flex-1 h-12 bg-[#2C2C2C] rounded-lg animate-pulse"></div>
          </>
        ) : answers.length > 0 ? (
          answers.map((answer) => (
            <button
              key={answer.id}
              onClick={() => setSelectedAnswer(answer)}
              className={`flex-1 py-3 rounded-lg transition-colors ${
                selectedAnswer?.id === answer.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#2C2C2C] text-gray-400 hover:bg-[#3C3C3C]'
              }`}
              disabled={isLoading}
            >
              <div className="flex justify-between px-4">
                <span>{answer.name}</span>
                <span>{getOutcomeProbability(answer)}¢</span>
              </div>
            </button>
          ))
        ) : (
          <div className="w-full text-center text-gray-400 py-3">
            No outcomes available for this market
          </div>
        )}
      </div>

      {/* Amount Input */}
      <div className="mb-6">
        <label className="block text-gray-400 mb-2">
          {tradeType === 'buy' ? 'Amount to Spend ($)' : 'Shares to Sell'}
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
            {tradeType === 'buy' ? '$' : '#'}
          </span>
          <input
            type="number"
            value={totalPrice}
            onChange={(e) => setTotalPrice(Number(e.target.value))}
            className="w-full bg-[#2C2C2C] text-white py-3 pl-6 pr-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            placeholder="0"
            disabled={isLoading}
            max={tradeType === 'buy' ? userBalance : undefined}
          />
        </div>
        
        {/* Balance warning for buy trades */}
        {tradeType === 'buy' && totalPrice > userBalance && !isBalanceLoading && (
          <p className="text-red-400 text-sm mt-1">
            Amount exceeds your balance of {formatCurrency(userBalance)}
          </p>
        )}
      </div>

      {/* Max Buy/Sell All buttons */}
      {tradeType === 'buy' && selectedAnswer && !isBalanceLoading && (
        <button
          onClick={() => {
            const maxAmount = getMaxPurchaseAmount();
            if (maxAmount > 0) {
              setTotalPrice(maxAmount);
            }
          }}
          className="mb-4 w-full py-2 bg-green-600 hover:bg-green-700 text-white rounded transition-colors text-sm"
          disabled={isLoading || isSubmitting || getMaxPurchaseAmount() <= 0}
        >
          Max Buy (${getMaxPurchaseAmount().toFixed(2)})
        </button>
      )}

      {tradeType === 'sell' && selectedAnswer && userShares[selectedAnswer.id] > 0 && (
        <button
          onClick={() => setTotalPrice(formatShares(userShares[selectedAnswer.id] || 0))}
          className="mb-4 w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors text-sm"
          disabled={isLoading || isSubmitting}
        >
          Sell All ({formatShares(userShares[selectedAnswer.id] || 0).toFixed(2)} shares)
        </button>
      )}

      {/* Enhanced Trade Details */}
      <div className="bg-[#2C2C2C] rounded-lg p-4 mb-6 text-sm">
        {isLoading ? (
          <LoadingSkeleton />
        ) : (
          <>
            <div className="flex justify-between mb-2">
              <span className="text-gray-400">
                {tradeType === 'buy' ? 'Shares to Receive' : 'Amount to Receive'}
              </span>
              <span className="text-white">
                {tradeType === 'buy' 
                  ? formatShares(computedShares).toFixed(2)
                  : calculateSellAmount()
                }
              </span>
            </div>

            {/* Buy-specific details with price impact */}
            {tradeType === 'buy' && preview.isValid && selectedAnswer && (
              <>
                <div className="flex justify-between mb-2">
                  <span className="text-gray-400">Average price per share</span>
                  <span className="text-white">
                    {formatCurrency(preview.avgPrice)}
                  </span>
                </div>

                <div className="flex justify-between mb-2">
                  <span className="text-gray-400">Price impact</span>
                  <span className="text-white">
                    {preview.priceImpact.toFixed(2)}%
                  </span>
                </div>

                <div className="flex justify-between mb-2">
                  <span className="text-gray-400">New market odds</span>
                  <span className="text-white">
                    {(preview.newOdds * 100).toFixed(1)}%
                  </span>
                </div>
              </>
            )}

            <div className="flex justify-between mb-2">
              <span className="text-gray-400">Current odds</span>
              <span className="text-white">
                {selectedAnswer 
                  ? (selectedAnswer.tokens / totalOutcomeTokens * 100).toFixed(1) + '%'
                  : '0%'}
              </span>
            </div>
            
            {/* User's current position */}
            {selectedAnswer && (
              <div className="flex justify-between mb-2">
                <span className="text-gray-400">Your position</span>
                {isSharesLoading ? (
                  <div className="h-4 bg-[#3C3C3C] rounded w-16 animate-pulse"></div>
                ) : (
                  <span className="text-white">
                    {formatShares(userShares[selectedAnswer.id] || 0).toFixed(2)} shares
                  </span>
                )}
              </div>
            )}

            {/* Profitability display for buys */}
            {tradeType === 'buy' && preview.isValid && selectedAnswer && (
              <div className="flex justify-between border-t border-gray-600 pt-2 mt-2">
                <span className="text-gray-400">If {selectedAnswer.name} wins</span>
                <span className="text-green-400">
                  {formatCurrency(preview.sharesReceived)} 
                  <span className="text-xs ml-1">
                    ({preview.expectedProfit >= 0 ? '+' : ''}{formatCurrency(preview.expectedProfit)})
                  </span>
                </span>
              </div>
            )}

            {/* Balance check warning for buys */}
            {tradeType === 'buy' && totalPrice > userBalance && !isBalanceLoading && (
              <div className="flex justify-between border-t border-red-600 pt-2 mt-2">
                <span className="text-red-400">Balance needed</span>
                <span className="text-red-400">
                  {formatCurrency(totalPrice - userBalance)} more
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Action Button */}
      <button 
        onClick={handleSubmit}
        className={`w-full py-4 rounded-lg transition-colors flex justify-center items-center ${
          isLoading || isSubmitting || !validation.isValid
            ? 'bg-gray-600 cursor-not-allowed opacity-50' 
            : 'bg-blue-600 hover:bg-blue-700'
        }`}
        disabled={isLoading || isSubmitting || !validation.isValid}
      >
        {isSubmitting ? (
          <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        ) : (
          `${tradeType === 'buy' ? 'Buy' : 'Sell'} ${selectedAnswer?.name || 'Outcome'}`
        )}
      </button>
      
      {/* Enhanced validation messages */}
      {!isLoading && !validation.isValid && validation.reason && (
        <p className="text-red-400 text-sm mt-2 text-center">
          {validation.reason}
        </p>
      )}

      {/* Validation messages for selling */}
      {!isLoading && tradeType === 'sell' && selectedAnswer && userShares[selectedAnswer.id] !== undefined && (
        <p className="text-yellow-500 text-sm mt-2 text-center">
          {formatShares(userShares[selectedAnswer.id]) <= 0 
            ? `You do not own any shares of ${selectedAnswer.name}`
            : formatShares(totalPrice) > formatShares(userShares[selectedAnswer.id])
              ? `You only own ${formatShares(userShares[selectedAnswer.id]).toFixed(2)} shares of ${selectedAnswer.name}`
              : null
          }
        </p>
      )}

      {/* Error/Success Messages */}
      {error && <p className="mt-4 text-red-500 text-center">{error}</p>}
      {success && <p className="mt-4 text-green-500 text-center">{success}</p>}
      
      {/* General loading indicator */}
      {isLoading && (
        <p className="mt-4 text-blue-400 text-center flex items-center justify-center">
          <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Loading market data...
        </p>
      )}
    </div>
  );
}