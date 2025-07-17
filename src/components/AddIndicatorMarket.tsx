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

// Release schedule patterns (same as in the FRED page)
const RELEASE_SCHEDULES = [
  {
    seriesId: "UNRATE",
    releaseDay: "first-friday",
    importance: "high" as const,
    description: "First Friday of each month"
  },
  {
    seriesId: "PAYEMS", 
    releaseDay: "first-friday",
    importance: "high" as const,
    description: "First Friday of each month"
  },
  {
    seriesId: "CPIAUCSL",
    releaseDay: "mid-month",
    importance: "high" as const,
    description: "Mid-month (around 10th-15th)"
  },
  {
    seriesId: "CPILFESL",
    releaseDay: "mid-month", 
    importance: "high" as const,
    description: "Mid-month (around 10th-15th)"
  },
  {
    seriesId: "GDP",
    releaseDay: "quarterly-end",
    importance: "high" as const,
    description: "End of month after quarter"
  },
  {
    seriesId: "GDPPOT",
    releaseDay: "quarterly-end",
    importance: "medium" as const,
    description: "End of month after quarter"
  },
  {
    seriesId: "FEDFUNDS",
    releaseDay: "fomc-meeting",
    importance: "high" as const,
    description: "After FOMC meetings"
  },
  {
    seriesId: "DGS10",
    releaseDay: "daily",
    importance: "medium" as const,
    description: "Daily (business days)"
  },
  {
    seriesId: "INDPRO",
    releaseDay: "mid-month",
    importance: "medium" as const,
    description: "Mid-month (around 15th)"
  },
  {
    seriesId: "HOUST",
    releaseDay: "mid-month",
    importance: "medium" as const,
    description: "Mid-month (around 17th)"
  },
  {
    seriesId: "CSUSHPISA",
    releaseDay: "end-month",
    importance: "medium" as const,
    description: "Last Tuesday of month"
  },
  {
    seriesId: "NAPM",
    releaseDay: "first-business-day",
    importance: "medium" as const,
    description: "First business day of month"
  },
  {
    seriesId: "UMCSENT",
    releaseDay: "mid-month",
    importance: "low" as const,
    description: "Mid-month (preliminary and final)"
  },
  {
    seriesId: "VIXCLS",
    releaseDay: "daily",
    importance: "low" as const,
    description: "Daily (market days)"
  },
  {
    seriesId: "DEXUSEU",
    releaseDay: "daily",
    importance: "low" as const,
    description: "Daily (business days)"
  }
];

// FOMC meeting dates for 2025
const FOMC_DATES_2025 = [
  new Date(2025, 0, 29), // January 28-29 (announcement on 29th)
  new Date(2025, 2, 19), // March 18-19 (announcement on 19th)
  new Date(2025, 4, 7),  // May 6-7 (announcement on 7th)
  new Date(2025, 5, 18), // June 17-18 (announcement on 18th)
  new Date(2025, 6, 30), // July 29-30 (announcement on 30th)
  new Date(2025, 8, 17), // September 16-17 (announcement on 17th)
  new Date(2025, 10, 5), // November 4-5 (announcement on 5th)
  new Date(2025, 11, 17) // December 16-17 (announcement on 17th)
];

export default function AddIndicatorMarket({ indicator, onMarketCreated }: AddIndicatorMarketProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Calculate next release date based on pattern
  const calculateNextReleaseDate = (releaseDay: string): Date => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    switch (releaseDay) {
      case "first-friday": {
        // First Friday of current month if not passed, otherwise next month
        const firstOfMonth = new Date(currentYear, currentMonth, 1);
        const dayOfWeek = firstOfMonth.getDay();
        const daysToFirstFriday = (5 - dayOfWeek + 7) % 7;
        const firstFriday = new Date(currentYear, currentMonth, 1 + daysToFirstFriday);
        
        if (firstFriday > now) {
          return firstFriday;
        } else {
          // Next month's first Friday
          const nextMonth = new Date(currentYear, currentMonth + 1, 1);
          const nextDayOfWeek = nextMonth.getDay();
          const nextDaysToFirstFriday = (5 - nextDayOfWeek + 7) % 7;
          return new Date(currentYear, currentMonth + 1, 1 + nextDaysToFirstFriday);
        }
      }
      
      case "mid-month": {
        // Around 15th of current or next month
        const midCurrentMonth = new Date(currentYear, currentMonth, 15);
        if (midCurrentMonth > now) {
          return midCurrentMonth;
        }
        return new Date(currentYear, currentMonth + 1, 15);
      }

      case "end-month": {
        // Last Tuesday of current or next month
        const lastDayCurrentMonth = new Date(currentYear, currentMonth + 1, 0);
        const lastTuesday = new Date(lastDayCurrentMonth);
        
        // Find last Tuesday
        while (lastTuesday.getDay() !== 2) {
          lastTuesday.setDate(lastTuesday.getDate() - 1);
        }
        
        if (lastTuesday > now) {
          return lastTuesday;
        }
        
        // Next month's last Tuesday
        const lastDayNextMonth = new Date(currentYear, currentMonth + 2, 0);
        const nextLastTuesday = new Date(lastDayNextMonth);
        while (nextLastTuesday.getDay() !== 2) {
          nextLastTuesday.setDate(nextLastTuesday.getDate() - 1);
        }
        return nextLastTuesday;
      }

      case "quarterly-end": {
        // Next quarterly release (end of Jan, Apr, Jul, Oct)
        const quarterlyMonths = [0, 3, 6, 9]; // Jan, Apr, Jul, Oct
        const nextQuarterMonth = quarterlyMonths.find(month => {
          const quarterEnd = new Date(currentYear, month, 30);
          return quarterEnd > now;
        });
        
        if (nextQuarterMonth !== undefined) {
          return new Date(currentYear, nextQuarterMonth, 30);
        }
        // If no quarters left this year, first quarter next year
        return new Date(currentYear + 1, 0, 30);
      }

      case "first-business-day": {
        // First business day of next month
        const firstOfNextMonth = new Date(currentYear, currentMonth + 1, 1);
        while (firstOfNextMonth.getDay() === 0 || firstOfNextMonth.getDay() === 6) {
          firstOfNextMonth.setDate(firstOfNextMonth.getDate() + 1);
        }
        return firstOfNextMonth;
      }

      case "fomc-meeting": {
        // Next FOMC meeting
        const nextMeeting = FOMC_DATES_2025.find(date => date > now);
        return nextMeeting || FOMC_DATES_2025[0];
      }

      case "daily": {
        // For daily indicators, set close date to end of week
        const endOfWeek = new Date(now);
        const daysUntilFriday = (5 - now.getDay() + 7) % 7;
        endOfWeek.setDate(now.getDate() + (daysUntilFriday || 7)); // If today is Friday, go to next Friday
        return endOfWeek;
      }

      default:
        // Default to 30 days from now
        const defaultDate = new Date(now);
        defaultDate.setDate(now.getDate() + 30);
        return defaultDate;
    }
  };

  // Get release schedule for this indicator
  const getReleaseSchedule = (seriesId: string) => {
    return RELEASE_SCHEDULES.find(schedule => schedule.seriesId === seriesId);
  };

  const createMarketFromIndicator = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      console.log("Starting test market creation for indicator:", indicator.id);
      
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

      // Get release schedule and calculate close date
      const releaseSchedule = getReleaseSchedule(indicator.id);
      let closeDate: Date;
      
      if (releaseSchedule) {
        closeDate = calculateNextReleaseDate(releaseSchedule.releaseDay);
        console.log(`Found release schedule for ${indicator.id}: ${releaseSchedule.description}`);
        console.log(`Calculated close date: ${closeDate.toISOString()}`);
      } else {
        // Default to 30 days from now if no schedule found
        closeDate = new Date();
        closeDate.setDate(closeDate.getDate() + 30);
        console.log(`No release schedule found for ${indicator.id}, using default close date: ${closeDate.toISOString()}`);
      }

      // Generate market name and description based on indicator
      const marketName = `${indicator.title} - ${getMarketPrediction(indicator)}`;
      const description = generateMarketDescription(indicator, closeDate, releaseSchedule);
      
      console.log("Generated market name:", marketName);
      console.log("Generated description:", description);
      
      // Create the market in test_markets table with close_date
      const marketInsertData = {
        creator_id: user.id,
        name: marketName,
        description: description,
        token_pool: 1000, // Default token pool
        market_maker: "CPMM",
        tags: [indicator.category, "Economic Indicator", indicator.id],
        close_date: closeDate.toISOString(), // Add close_date here
        created_at: new Date().toISOString()
      };
      
      console.log("Inserting test market data:", marketInsertData);
      
      const { data: marketData, error: marketError } = await supabase
        .from("test_markets")
        .insert(marketInsertData)
        .select()
        .single();

      if (marketError) {
        console.error("Test market creation error:", marketError);
        throw marketError;
      }
      
      console.log("Test market created successfully:", marketData);

      // Create binary outcomes for the test market
      const outcomes = generateOutcomes(indicator);
      console.log("Generated outcomes:", outcomes);
      
      const outcomesInsertData = outcomes.map(outcome => ({
        market_id: marketData.id,
        creator_id: user.id,
        name: outcome.name,
        tokens: outcome.tokens,
        created_at: new Date().toISOString()
      }));
      
      console.log("Inserting test outcomes data:", outcomesInsertData);
      
      const { error: outcomesError } = await supabase
        .from("test_outcomes")
        .insert(outcomesInsertData);

      if (outcomesError) {
        console.error("Test outcomes creation error:", outcomesError);
        throw outcomesError;
      }
      
      console.log("Test outcomes created successfully");

      setSuccess(
        `Test market "${marketName}" created successfully! Market closes on ${closeDate.toLocaleDateString()}.`
      );
      
      if (onMarketCreated) {
        onMarketCreated(marketData.id);
      }

      // Clear success message after 5 seconds
      setTimeout(() => setSuccess(null), 5000);

    } catch (err) {
      console.error("Error creating test market:", err);
      console.error("Error details:", JSON.stringify(err, null, 2));
      
      let errorMessage = "Failed to create test market";
      
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

  // Generate enhanced market description with release date info
  const generateMarketDescription = (indicator: EconomicSeries, closeDate: Date, releaseSchedule?: typeof RELEASE_SCHEDULES[0]): string => {
    const currentValue = indicator.rawValue || indicator.value;
    const trend = indicator.change !== "N/A" ? ` (${indicator.change})` : "";
    const nextPeriod = getNextPeriod(indicator.frequency);
    
    const releaseInfo = releaseSchedule ? 
      `This market will close on ${closeDate.toLocaleDateString()} when the ${indicator.frequency.toLowerCase()} data is typically released (${releaseSchedule.description}).` :
      `This market will close on ${closeDate.toLocaleDateString()}.`;
    
    return `Predict whether ${indicator.title} will increase or decrease ${nextPeriod}. 

Current value: ${currentValue}${trend}
Data from: ${indicator.period}
Source: Federal Reserve Economic Data (FRED)

${releaseInfo}

Resolution: This market will resolve based on the next official ${indicator.frequency.toLowerCase()} release from FRED series ${indicator.id}. If the new value is higher than the current value (${currentValue}), "Yes" wins. If lower or unchanged, "No" wins.`;
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
        {loading ? "Creating..." : "Create Test Market"}
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