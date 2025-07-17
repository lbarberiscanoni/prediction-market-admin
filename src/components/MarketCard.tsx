"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import supabase from "@/lib/supabase/createClient";

interface Outcome {
  name: string;
  tokens: number;
}

interface Prediction {
  trade_value: number;
  trade_type: 'buy' | 'sell';
  market_odds: number;
  created_at: string;
}

interface PriceChangeData {
  currentPrice: number;
  previousPrice: number;
  changeAmount: number;
  changePercentage: number;
  hasData: boolean;
}

interface MarketCardProps {
  id: number;
  name: string;
  outcomes?: Outcome[];
}

export default function MarketCard({
  id,
  name,
  outcomes = []
}: MarketCardProps) {
  const [marketVolume, setMarketVolume] = useState<number | null>(null);
  const [tradeCount, setTradeCount] = useState<number>(0);
  const [priceChange, setPriceChange] = useState<PriceChangeData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Calculate the current price (YES outcome probability)
  const getCurrentPrice = (): number => {
    const totalTokens = outcomes.reduce((sum, outcome) => sum + outcome.tokens, 0);
    const yesOutcome = outcomes.find(outcome => outcome.name.toLowerCase() === "yes");
    
    if (!yesOutcome || totalTokens === 0) return 0;
    return (yesOutcome.tokens / totalTokens) * 100;
  };

  // Fetch market data including 24h price change
  useEffect(() => {
    async function fetchMarketData() {
      try {
        // Fetch all predictions for volume and trade count
        const { data: allPredictions, error: predictionsError } = await supabase
          .from("predictions")
          .select("trade_value, trade_type, market_odds, created_at")
          .eq("market_id", id)
          .order("created_at", { ascending: false });

        if (predictionsError) {
          console.error("Error fetching market predictions:", predictionsError.message);
          setIsLoading(false);
          return;
        }

        const typedData = allPredictions as Prediction[];

        // Calculate volume and trade count
        const totalVolume = typedData.reduce(
          (sum: number, prediction: Prediction) => sum + Math.abs(prediction.trade_value),
          0
        );
        setMarketVolume(totalVolume);
        setTradeCount(typedData.length);

        // Calculate 24-hour price change
        const now = new Date();
        const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
        
        const currentPrice = getCurrentPrice();
        
        // Find the most recent prediction from 24+ hours ago
        const oldPredictions = typedData.filter(pred => 
          new Date(pred.created_at) <= twentyFourHoursAgo
        );

        if (oldPredictions.length > 0 && currentPrice > 0) {
          // Get the most recent prediction from 24h ago (first in the filtered array since we ordered by created_at desc)
          const oldestRecentPrediction = oldPredictions[0];
          const previousPrice = oldestRecentPrediction.market_odds * 100;
          
          const changeAmount = currentPrice - previousPrice;
          const changePercentage = previousPrice > 0 ? (changeAmount / previousPrice) * 100 : 0;
          
          setPriceChange({
            currentPrice,
            previousPrice,
            changeAmount,
            changePercentage,
            hasData: true
          });
        } else {
          // No data from 24h ago, but we still want to show current price
          setPriceChange({
            currentPrice,
            previousPrice: currentPrice,
            changeAmount: 0,
            changePercentage: 0,
            hasData: false
          });
        }

        setIsLoading(false);
      } catch (err) {
        console.error("Failed to fetch market data:", err);
        setIsLoading(false);
      }
    }

    // Only fetch if we have outcomes data
    if (outcomes.length > 0) {
      fetchMarketData();
    } else {
      setIsLoading(false);
    }
  }, [id, outcomes]);

  // Format currency values
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0 
    }).format(value);
  };

  // Format price change display
  const formatPriceChange = (change: PriceChangeData) => {
    const sign = change.changeAmount >= 0 ? '+' : '';
    return `${sign}${change.changeAmount.toFixed(1)}%`;
  };

  // Get price change color - updated to include gray for no change
  const getPriceChangeColor = (changeAmount: number) => {
    if (changeAmount > 0) return 'text-green-500';
    if (changeAmount < 0) return 'text-red-500';
    return 'text-gray-500'; // Gray for no change (changeAmount === 0)
  };

  // Ensure "Yes" and "No" are the first two outcomes
  const sortedOutcomes = [
    ...outcomes.filter(outcome => outcome.name.toLowerCase() === "yes"),
    ...outcomes.filter(outcome => outcome.name.toLowerCase() === "no"),
    ...outcomes.filter(outcome => 
      outcome.name.toLowerCase() !== "yes" && 
      outcome.name.toLowerCase() !== "no")
  ];

  // Calculate total tokens for all outcomes
  const totalTokens = sortedOutcomes.reduce((sum, outcome) => sum + outcome.tokens, 0);

  return (
    <Link href={`/markets/${id}`}>
      <div className="bg-transparent border border-gray-200 rounded-lg shadow-md hover:shadow-lg transition duration-200 cursor-pointer w-80 overflow-hidden">
        <div className="p-4">
          <h2 className="text-lg font-semibold text-white mb-4">{name}</h2>
          
          {/* Outcome bubbles container */}
          {sortedOutcomes.length > 0 && (
            <div className="flex justify-between items-center mb-4">
              {sortedOutcomes.slice(0, 2).map((outcome, index) => {
                // Calculate odds only if totalTokens > 0 to avoid division by zero
                const odds = totalTokens ? (outcome.tokens / totalTokens) * 100 : 0;
                const bgColor = outcome.name.toLowerCase() === "yes" ? "bg-blue-50" : "bg-purple-50";
                const textColor = outcome.name.toLowerCase() === "yes" ? "text-blue-600" : "text-purple-600";
                const borderColor = outcome.name.toLowerCase() === "yes" ? "border-blue-200" : "border-purple-200";

                return (
                  <div
                    key={index}
                    className={`flex flex-col justify-center items-center w-[calc(50%-0.5rem)] h-24 rounded-lg border ${bgColor} ${textColor} ${borderColor} p-2`}
                  >
                    <div className="text-sm font-medium">{outcome.name}</div>
                    <div className="text-2xl font-bold">{odds.toFixed(0)}%</div>
                    <div className="text-xs">$100 → ${(100 * odds / 100).toFixed(0)}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 24h Price Change Indicator */}
          {priceChange && (
            <div className="flex justify-center items-center mb-3">
              <div className="text-center">
                <div className="text-xs text-gray-400">24h Change</div>
                {priceChange.hasData ? (
                  <div className={`text-sm font-medium ${getPriceChangeColor(priceChange.changeAmount)}`}>
                    {formatPriceChange(priceChange)}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500">No data</div>
                )}
              </div>
            </div>
          )}

          {/* Market stats - volume and trade count */}
          <div className="flex flex-col space-y-1">
            <div className="text-center text-sm text-gray-500">
              {isLoading ? (
                "Loading market data..."
              ) : (
                `Volume: ${marketVolume !== null ? formatCurrency(marketVolume) : "$0"}`
              )}
            </div>
            <div className="text-center text-sm text-gray-500">
              {isLoading ? (
                ""
              ) : (
                `Trades: ${tradeCount}`
              )}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}