// src/components/AddIndicatorMarket.tsx
"use client";

import { useState } from "react";
import supabase from "@/lib/supabase/createClient";

interface EconomicSeries {
  id: string;
  title: string;
  value: string;
  change: string;
  changeType: "increase" | "decrease" | "neutral";
  period: string;
  category: string;
  frequency: string;
  units: string;
  lastUpdated: string;
  rawValue?: number;
  previousValue?: number;
}

interface AddIndicatorMarketProps {
  indicator: EconomicSeries;
  onMarketCreated?: (marketId: number) => void;
}

export default function AddIndicatorMarket({ indicator, onMarketCreated }: AddIndicatorMarketProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const createMarketFromIndicator = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      console.log("Starting market creation for indicator:", indicator.id);
      
      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) {
        console.error("User error:", userError);
        throw new Error(`Authentication error: ${userError.message}`);
      }
      if (!user) {
        throw new Error("User not authenticated");
      }
      
      console.log("User authenticated:", user.id);

      // Generate market name and description based on indicator
      const marketName = `${indicator.title} - ${getMarketPrediction(indicator)}`;
      const description = generateMarketDescription(indicator);
      
      console.log("Generated market name:", marketName);
      console.log("Generated description:", description);
      
      // Create the market in test_markets table
      const marketInsertData = {
        creator_id: user.id,
        name: marketName,
        description: description,
        token_pool: 1000, // Default token pool
        market_maker: "CPMM",
        tags: [indicator.category, "Economic Indicator", indicator.id],
        created_at: new Date().toISOString()
      };
      
      console.log("Inserting market data:", marketInsertData);
      
      const { data: marketData, error: marketError } = await supabase
        .from("markets")
        .insert(marketInsertData)
        .select()
        .single();

      if (marketError) {
        console.error("Market creation error:", marketError);
        throw marketError;
      }
      
      console.log("Market created successfully:", marketData);

      // Create binary outcomes for the market
      const outcomes = generateOutcomes(indicator);
      console.log("Generated outcomes:", outcomes);
      
      const outcomesInsertData = outcomes.map(outcome => ({
        market_id: marketData.id,
        creator_id: user.id,
        name: outcome.name,
        tokens: outcome.tokens,
        created_at: new Date().toISOString()
      }));
      
      console.log("Inserting outcomes data:", outcomesInsertData);
      
      const { error: outcomesError } = await supabase
        .from("test_outcomes")
        .insert(outcomesInsertData);

      if (outcomesError) {
        console.error("Outcomes creation error:", outcomesError);
        throw outcomesError;
      }
      
      console.log("Outcomes created successfully");

      setSuccess(`Market "${marketName}" created successfully!`);
      
      if (onMarketCreated) {
        onMarketCreated(marketData.id);
      }

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);

    } catch (err) {
      console.error("Error creating market:", err);
      console.error("Error details:", JSON.stringify(err, null, 2));
      
      let errorMessage = "Failed to create market";
      
      if (err && typeof err === 'object') {
        // Handle Supabase errors
        if ('message' in err && typeof err.message === 'string') {
          errorMessage = err.message;
        } else if ('error' in err && err.error) {
          errorMessage = typeof err.error === 'string' ? err.error : JSON.stringify(err.error);
        } else if ('details' in err && err.details) {
          errorMessage = typeof err.details === 'string' ? err.details : JSON.stringify(err.details);
        } else {
          errorMessage = JSON.stringify(err);
        }
      } else if (typeof err === 'string') {
        errorMessage = err;
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Generate market prediction question based on indicator type
  const getMarketPrediction = (indicator: EconomicSeries): string => {
    const nextPeriod = getNextPeriod(indicator.frequency);
    
    if (indicator.changeType === "increase") {
      return `Will Continue Rising ${nextPeriod}?`;
    } else if (indicator.changeType === "decrease") {
      return `Will Continue Falling ${nextPeriod}?`;
    } else {
      return `Will Increase ${nextPeriod}?`;
    }
  };

  // Generate market description
  const generateMarketDescription = (indicator: EconomicSeries): string => {
    const currentValue = indicator.rawValue || indicator.value;
    const trend = indicator.change !== "N/A" ? ` (${indicator.change})` : "";
    const nextPeriod = getNextPeriod(indicator.frequency);
    
    return `Predict whether ${indicator.title} will increase or decrease ${nextPeriod}. 
    Current value: ${currentValue}${trend}. 
    Data from ${indicator.period}. 
    Source: Federal Reserve Economic Data (FRED).
    
    This market will resolve based on the next official ${indicator.frequency.toLowerCase()} release from FRED series ${indicator.id}.`;
  };

  // Generate binary outcomes with balanced token allocation
  const generateOutcomes = (indicator: EconomicSeries) => {
    const nextPeriod = getNextPeriod(indicator.frequency);
    
    return [
      {
        name: `Yes - Will Increase ${nextPeriod}`,
        tokens: 500
      },
      {
        name: `No - Will Not Increase ${nextPeriod}`,
        tokens: 500
      }
    ];
  };

  // Determine next period based on frequency
  const getNextPeriod = (frequency: string): string => {
    const freq = frequency.toLowerCase();
    if (freq.includes("daily")) return "Tomorrow";
    if (freq.includes("weekly")) return "Next Week";
    if (freq.includes("monthly")) return "Next Month";
    if (freq.includes("quarterly")) return "Next Quarter";
    if (freq.includes("annual")) return "Next Year";
    return "Next Period";
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={createMarketFromIndicator}
        disabled={loading}
        className="px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-white font-medium transition-colors text-sm"
      >
        {loading ? "Creating..." : "Create Market"}
      </button>
      
      {error && (
        <div className="text-red-400 text-xs bg-red-900/30 p-2 rounded">
          {error}
        </div>
      )}
      
      {success && (
        <div className="text-green-400 text-xs bg-green-900/30 p-2 rounded">
          {success}
        </div>
      )}
    </div>
  );
}