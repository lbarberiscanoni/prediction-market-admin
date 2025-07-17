"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import supabase from "@/lib/supabase/createClient";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from "recharts";

interface MarketOdds {
  timestamp: string;
  probability: number;
  shares_amt: number;
  trade_type: 'buy' | 'sell';
  outcome_name: string;
}

interface PriceChartProps {
  marketId?: number;
  height?: number;
  width?: string | number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: MarketOdds;
  }>;
}

interface Outcome {
  id: number;
  name: string;
  tokens: number;
  market_id: number;
}

export default function MarketProbabilityChart({
  marketId: propMarketId,
  height = 300,
  width = "100%"
}: PriceChartProps) {
  const params = useParams();
  const marketId = propMarketId || Number(params.id);
  
  const [marketOdds, setMarketOdds] = useState<MarketOdds[]>([]);
  const [timeRange, setTimeRange] = useState<'1d' | '7d' | '30d' | 'all'>('all');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch market odds history incorporating all trades
  const fetchMarketOddsHistory = useCallback(async () => {
    if (!marketId) return;
    
    setLoading(true);
    try {
      // First, fetch all outcomes for this market
      const { data: outcomesData, error: outcomesError } = await supabase
        .from("outcomes")
        .select("id, name, tokens, market_id")
        .eq("market_id", marketId);
        
      if (outcomesError) throw outcomesError;
      
      if (!outcomesData || outcomesData.length === 0) {
        throw new Error("No outcomes found for this market");
      }
      
      const outcomes = outcomesData as Outcome[];
      
      // Find the YES outcome (we'll use this as our reference)
      const yesOutcome = outcomes.find(o => o.name.toUpperCase() === "YES");
      
      if (!yesOutcome) {
        throw new Error("Could not find YES outcome for this market");
      }
      
      // Get all predictions for this market to calculate historical probabilities
      const { data: predictions, error: predictionsError } = await supabase
        .from("predictions")
        .select(`
          id, 
          market_id,
          outcome_id, 
          market_odds,
          created_at,
          shares_amt,
          trade_type
        `)
        .eq("market_id", marketId)
        .order("created_at", { ascending: true });
        
      if (predictionsError) throw predictionsError;
      
      // Filter based on time range
      let filteredPredictions = [...predictions];
      
      if (timeRange !== 'all') {
        const now = new Date();
        const cutoffDate = new Date();
        
        switch (timeRange) {
          case '1d':
            cutoffDate.setDate(now.getDate() - 1);
            break;
          case '7d':
            cutoffDate.setDate(now.getDate() - 7);
            break;
          case '30d':
            cutoffDate.setDate(now.getDate() - 30);
            break;
        }
        
        filteredPredictions = predictions.filter(p => 
          new Date(p.created_at) >= cutoffDate
        );
      }
      
      if (filteredPredictions.length === 0) {
        setMarketOdds([]);
        setLoading(false);
        return;
      }
      
      // Define the prediction type
      interface Prediction {
        id: number;
        market_id: number;
        outcome_id: number;
        market_odds: number;
        created_at: string;
        shares_amt: number;
        trade_type: 'buy' | 'sell';
      }

      // Group predictions by timestamp to reconstruct market state at each point
      const predictionsByTimestamp: { [timestamp: string]: Prediction[] } = {};
      filteredPredictions.forEach(p => {
        if (!predictionsByTimestamp[p.created_at]) {
          predictionsByTimestamp[p.created_at] = [];
        }
        predictionsByTimestamp[p.created_at].push(p as Prediction);
      });
      
      // For each time point, calculate the market's YES probability
      // We're using the recorded market_odds at each trade timestamp
      const odds: MarketOdds[] = [];
      const timestamps = Object.keys(predictionsByTimestamp).sort();
      
      timestamps.forEach(timestamp => {
        const trades = predictionsByTimestamp[timestamp];
        
        // Find trades for YES outcome to get the market odds
        const yesTrade = trades.find(t => t.outcome_id === yesOutcome.id);
        
        if (yesTrade) {
          odds.push({
            timestamp,
            probability: Math.round(yesTrade.market_odds * 100),
            shares_amt: yesTrade.shares_amt,
            trade_type: yesTrade.trade_type,
            outcome_name: 'YES'
          });
        } else {
          // If there's no YES trade at this timestamp, try to get odds from any trade
          // (assuming all trades at a timestamp share the same market state)
          const anyTrade = trades[0];
          
          // Find the outcome name for this trade
          const outcome = outcomes.find(o => o.id === anyTrade.outcome_id);
          const outcomeName = outcome ? outcome.name : 'Unknown';
          
          // For non-YES outcomes, we need to adjust probability
          // If it's a NO outcome, the YES probability is 1 - NO probability
          const isNoOutcome = outcomeName.toUpperCase() === 'NO';
          const probability = isNoOutcome
            ? Math.round((1 - anyTrade.market_odds) * 100)
            : Math.round(anyTrade.market_odds * 100);
          
          odds.push({
            timestamp,
            probability,
            shares_amt: anyTrade.shares_amt,
            trade_type: anyTrade.trade_type,
            outcome_name: outcomeName
          });
        }
      });
      
      setMarketOdds(odds);
    } catch (err) {
      console.error("Error fetching market odds history:", err);
      setError("Failed to load market probability data");
    } finally {
      setLoading(false);
    }
  }, [marketId, timeRange]);

  // Initial data loading
  useEffect(() => {
    fetchMarketOddsHistory();
  }, [fetchMarketOddsHistory]);

  // Format date for display on chart
  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString();
  };
  
  // Custom tooltip to show additional details
  const CustomTooltip = ({ active, payload }: CustomTooltipProps) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="p-3 bg-[#1E1E1E] border border-[#2C2C2C] rounded shadow-lg">
          <p className="text-gray-300">{new Date(data.timestamp).toLocaleString()}</p>
          <p className="text-white font-semibold">YES: {data.probability}%</p>
          <p className="text-white font-semibold">NO: {100 - data.probability}%</p>
          <p className="text-gray-300">
            Last trade: {data.trade_type === 'buy' ? 'Buy' : 'Sell'} {data.outcome_name} ({data.shares_amt.toFixed(2)} shares)
          </p>
        </div>
      );
    }
    return null;
  };

  if (error) {
    return (
      <div className="p-4 text-red-500 bg-[#1E1E1E] rounded border border-red-700">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="w-full bg-[#1E1E1E] rounded-lg border border-[#2C2C2C] p-4">
      <div className="flex flex-col mb-4">
        <h3 className="text-white text-xl font-semibold mb-4">Market Probability</h3>
        
        <div className="flex justify-end items-center mb-4">
          {/* Time range selector */}
          <div className="flex space-x-2">
            {(['1d', '7d', '30d', 'all'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1 text-sm rounded ${
                  timeRange === range
                    ? 'bg-blue-600 text-white'
                    : 'bg-[#2C2C2C] text-gray-400 hover:bg-[#3C3C3C]'
                }`}
              >
                {range === 'all' ? 'All' : range}
              </button>
            ))}
          </div>
        </div>
      </div>
      
      {loading ? (
        <div className="flex justify-center items-center" style={{ height }}>
          <div className="animate-pulse text-blue-400 flex items-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Loading market data...
          </div>
        </div>
      ) : marketOdds.length === 0 ? (
        <div className="flex justify-center items-center text-gray-400" style={{ height }}>
          No trading data available for this market
        </div>
      ) : (
        <ResponsiveContainer width={width} height={height}>
          <LineChart
            data={marketOdds}
            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis 
              dataKey="timestamp" 
              tickFormatter={formatDate}
              stroke="#666"
            />
            <YAxis 
              domain={[0, 100]} 
              tickFormatter={(value) => `${value}%`}
              stroke="#666"
              label={{ value: 'YES Probability', angle: -90, position: 'insideLeft', offset: -5, fill: '#666' }}
            />
            <Tooltip content={<CustomTooltip />} />
            {/* Reference line at 50% */}
            <ReferenceLine y={50} stroke="#666" strokeDasharray="3 3" label={{ value: '50%', position: 'right', fill: '#666' }} />
            <Line
              type="monotone"
              dataKey="probability"
              stroke="#3B82F6"
              strokeWidth={2}
              activeDot={{ r: 8 }}
              name="YES Probability"
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}