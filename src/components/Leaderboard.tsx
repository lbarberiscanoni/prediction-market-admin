"use client";

import { useEffect, useState } from "react";
import supabase from "@/lib/supabase/createClient";

interface LeaderboardEntry {
  user_id: string;
  username?: string;
  payment_id?: string | null;
  total_profit_loss: number;
  percent_pnl: number;
  total_bought_amount: number;
  remaining_shares_value: number;
  net_trade_pnl: number;
  position: number;
  rank_change?: number; // New field for rank change
  is_new?: boolean; // New field to indicate if user is new to leaderboard
}

interface LeaderboardData {
  id: string;
  created_at: string;
  calculation_date: string;
  data: LeaderboardEntry[];
  total_users: number;
}

export default function Leaderboard() {
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"absolute" | "percent">("absolute");
  const [sortDirection, setSortDirection] = useState("desc");

  // Fetch the latest leaderboard data and calculate rank changes
  useEffect(() => {
    const fetchLatestLeaderboardData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Get the two most recent leaderboards (today and yesterday)
        const { data, error } = await supabase
          .from("leaderboards")
          .select("*")
          .order("calculation_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(2);

        if (error) throw error;

        if (!data || data.length === 0) {
          throw new Error("No leaderboard data found");
        }

        const currentLeaderboard = data[0] as LeaderboardData;
        const previousLeaderboard = data.length > 1 ? data[1] as LeaderboardData : null;

        // Calculate rank changes
        const currentData = currentLeaderboard.data;
        const enhancedData = currentData.map(currentEntry => {
          let rankChange = undefined;
          let isNew = false;

          if (previousLeaderboard) {
            const previousEntry = previousLeaderboard.data.find(p => p.user_id === currentEntry.user_id);
            
            if (previousEntry) {
              // User existed in previous leaderboard - calculate rank change
              // Positive number means rank improved (moved up), negative means rank worsened (moved down)
              rankChange = previousEntry.position - currentEntry.position;
            } else {
              // User is new to the leaderboard
              isNew = true;
            }
          }

          return {
            ...currentEntry,
            rank_change: rankChange,
            is_new: isNew
          };
        });

        // Sort the data based on current sort preferences
        const sortedData = sortLeaderboardData(enhancedData, sortBy, sortDirection);
        setLeaderboardData(sortedData);

      } catch (err) {
        console.error("Error fetching leaderboard data:", err);
        setError(err instanceof Error ? err.message : "Failed to load leaderboard data");
      } finally {
        setLoading(false);
      }
    };

    fetchLatestLeaderboardData();
  }, [sortBy, sortDirection]);

  // Function to render rank change indicator
  const renderRankChange = (player: LeaderboardEntry) => {
    if (player.is_new) {
      return (
        <span className="ml-2 text-xs bg-blue-600 text-white px-2 py-1 rounded-full">
          NEW
        </span>
      );
    }

    if (player.rank_change === undefined || player.rank_change === 0) {
      return (
        <span className="ml-2 text-gray-500 text-sm">
          ━
        </span>
      );
    }

    if (player.rank_change > 0) {
      // Rank improved (moved up)
      return (
        <span className="ml-2 text-green-400 text-sm flex items-center">
          ↑{player.rank_change}
        </span>
      );
    } else {
      // Rank worsened (moved down)
      return (
        <span className="ml-2 text-red-400 text-sm flex items-center">
          ↓{Math.abs(player.rank_change)}
        </span>
      );
    }
  };
  
  // Sort the leaderboard data based on current sort parameters
  const sortLeaderboardData = (data: LeaderboardEntry[], sortMetric: "absolute" | "percent", direction: string) => {
    return [...data].sort((a, b) => {
      const valueA = sortMetric === "absolute" ? a.total_profit_loss : a.percent_pnl;
      const valueB = sortMetric === "absolute" ? b.total_profit_loss : b.percent_pnl;
      
      return direction === "desc" ? valueB - valueA : valueA - valueB;
    });
  };

  // Handle column header click
  const handleSortClick = (metric: "absolute" | "percent") => {
    if (sortBy === metric) {
      const newDirection = sortDirection === "asc" ? "desc" : "asc";
      setSortDirection(newDirection);
    } else {
      setSortBy(metric);
      setSortDirection("desc");
    }
  };

  // Format currency values
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2 
    }).format(value);
  };
  
  // Format percentage values
  const formatPercentage = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'percent',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value / 100);
  };

  if (loading) return (
    <div className="flex justify-center items-center h-64">
      <div className="animate-pulse text-blue-500 flex items-center">
        <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Loading leaderboard...
      </div>
    </div>
  );

  if (error) return (
    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
      <strong className="font-bold">Error!</strong>
      <span className="block sm:inline"> {error}</span>
    </div>
  );

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6 text-center text-white">Prophet Market Leaderboard</h1>
      
      <div className="bg-gray-800 rounded-lg shadow-lg overflow-hidden border border-gray-700">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-700">
            <thead className="bg-gray-900">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Position
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Payment ID
                </th>
                <th 
                  className={`px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer ${sortBy === "absolute" ? "bg-gray-800" : ""}`}
                  onClick={() => handleSortClick("absolute")}
                >
                  Total Profit/Loss
                  {sortBy === "absolute" && (
                    <span className="ml-1">{sortDirection === "asc" ? "↑" : "↓"}</span>
                  )}
                </th>
                <th 
                  className={`px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer ${sortBy === "percent" ? "bg-gray-800" : ""}`}
                  onClick={() => handleSortClick("percent")}
                >
                  Percent P&L
                  {sortBy === "percent" && (
                    <span className="ml-1">{sortDirection === "asc" ? "↑" : "↓"}</span>
                  )}
                </th>
              </tr>
            </thead>
            <tbody className="bg-gray-800 divide-y divide-gray-700">
              {leaderboardData.map((player, index) => (
                <tr key={player.user_id} className={index % 2 === 0 ? "bg-gray-800" : "bg-gray-900"}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <span className="text-lg font-bold text-yellow-400 mr-2">
                        #{player.position || index + 1}
                      </span>
                      {renderRankChange(player)}
                      {(player.position || index + 1) === 1 && <span className="text-yellow-400 ml-2">🏆</span>}
                      {(player.position || index + 1) === 2 && <span className="text-gray-300 ml-2">🥈</span>}
                      {(player.position || index + 1) === 3 && <span className="text-orange-400 ml-2">🥉</span>}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-white">
                      {player.username || player.user_id}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-200">
                    {player.payment_id ?? "—"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className={`text-sm font-bold ${player.total_profit_loss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatCurrency(player.total_profit_loss)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className={`text-sm font-bold ${player.percent_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatPercentage(player.percent_pnl)}
                    </div>
                  </td>
                </tr>
              ))}
              
              {leaderboardData.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-center text-gray-400">
                    No leaderboard data available for the selected date
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}