// src/app/analytics/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import supabase from "@/lib/supabase/createClient";
import MarketStats from "@/components/analytics/MarketStats";
import MarketActivityCharts from "@/components/analytics/MarketActivityCharts";
import UserStatistics from "@/components/analytics/UserStatistics";
import UserActivityCharts from "@/components/analytics/UserActivityCharts";

type KpiTimeFilter = "2d" | "7d" | "30d";

interface User {
  id: string;
  created_at: string;
  user_id: string;
}

interface Prediction {
  user_id: string;
  market_id: number;
  outcome_id: number;
  shares_amt: number;
  trade_value: number;
  created_at: string;
}

interface Market {
  id: number;
  name: string;
  status: string;
  created_at: string;
  token_pool: number;
}

interface UserStatsData {
  totalUsers: number;
  allTimeUsers: number;
  activeTraders: number;
  traderRatio: number;
}

interface MarketStatsData {
  allTime: {
    markets: number;
    predictions: number;
    tradeVolume: number;
  };
  open: {
    markets: number;
    predictions: number;
    tradeVolume: number;
  };
}

interface UserActivityData {
  date: string;
  new_signups: number;
  cumulative_users: number;
  new_traders: number;
  cumulative_traders: number;
  active_traders: number;
}

interface MarketActivityData {
  date: string;
  predictions: number;
  markets_created: number;
  volume: number;
}

interface AnalyticsData {
  userStats: UserStatsData;
  userActivityData: UserActivityData[];
  marketStats: MarketStatsData;
  marketActivityData: MarketActivityData[];
}

function getKpiCutoffDate(filter: KpiTimeFilter): Date {
  const now = new Date();
  switch (filter) {
    case "2d":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1); // start of yesterday
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
}

function getKpiTimeFilterLabel(filter: KpiTimeFilter): string {
  switch (filter) {
    case "2d": return "Today & yesterday";
    case "7d": return "Last 7 days";
    case "30d": return "Last 30 days";
  }
}

export default function AnalyticsPage() {
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [rawUsers, setRawUsers] = useState<User[]>([]);
  const [rawPredictions, setRawPredictions] = useState<Prediction[]>([]);
  const [rawMarkets, setRawMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'user' | 'market'>('market');
  const [kpiTimeFilter, setKpiTimeFilter] = useState<KpiTimeFilter>("30d");

  const filteredUserStats = useMemo(() => {
    if (rawUsers.length === 0 && rawPredictions.length === 0) {
      return { totalUsers: 0, allTimeUsers: 0, activeTraders: 0, traderRatio: 0 };
    }
    const cutoff = getKpiCutoffDate(kpiTimeFilter);
    const usersInPeriod = rawUsers.filter(u => new Date(u.created_at) >= cutoff);
    const predictionsInPeriod = rawPredictions.filter(p => new Date(p.created_at) >= cutoff);
    const tradersInPeriod = new Set(predictionsInPeriod.map(p => p.user_id));
    const newUsers = usersInPeriod.length;
    const allTimeUsers = rawUsers.length;
    const activeTraders = tradersInPeriod.size;
    const traderRatio = allTimeUsers > 0 ? (activeTraders / allTimeUsers) * 100 : 0;
    return { totalUsers: newUsers, allTimeUsers, activeTraders, traderRatio };
  }, [rawUsers, rawPredictions, kpiTimeFilter]);

  const filteredMarketStats = useMemo(() => {
    if (rawMarkets.length === 0 && rawPredictions.length === 0) {
      return { allTime: { markets: 0, predictions: 0, tradeVolume: 0 }, open: { markets: 0, predictions: 0, tradeVolume: 0 } };
    }
    const cutoff = getKpiCutoffDate(kpiTimeFilter);
    const marketsInPeriod = rawMarkets.filter(m => new Date(m.created_at) >= cutoff);
    const predictionsInPeriod = rawPredictions.filter(p => new Date(p.created_at) >= cutoff);
    const tradeVolume = predictionsInPeriod.reduce((sum, p) => sum + Math.abs(p.trade_value || 0), 0);

    const openMarketIds = new Set(rawMarkets.filter(m => m.status === 'open').map(m => m.id));
    const openPredictions = predictionsInPeriod.filter(p => openMarketIds.has(p.market_id));
    const openVolume = openPredictions.reduce((sum, p) => sum + Math.abs(p.trade_value || 0), 0);
    const openMarketsInPeriod = marketsInPeriod.filter(m => m.status === 'open');

    return {
      allTime: { markets: marketsInPeriod.length, predictions: predictionsInPeriod.length, tradeVolume: tradeVolume },
      open: { markets: openMarketsInPeriod.length, predictions: openPredictions.length, tradeVolume: openVolume }
    };
  }, [rawMarkets, rawPredictions, kpiTimeFilter]);

  useEffect(() => {
    fetchAnalyticsData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAnalyticsData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch all users
      const { data: usersData, error: usersError } = await supabase
        .from("profiles")
        .select("id, created_at, user_id");

      if (usersError) throw new Error(`Failed to fetch users: ${usersError.message}`);

      // Fetch all markets (excluding pending markets)
      const { data: marketsData, error: marketsError } = await supabase
        .from("markets")
        .select("id, name, status, created_at, token_pool")
        .neq("status", "pending");

      if (marketsError) throw new Error(`Failed to fetch markets: ${marketsError.message}`);

      const markets = marketsData as Market[];

      // Fetch ALL predictions for market stats calculations
      const { data: allPredictionsData, error: allPredictionsError } = await supabase
        .from("predictions")
        .select("user_id, market_id, outcome_id, shares_amt, trade_value, created_at");

      if (allPredictionsError) throw new Error(`Failed to fetch all predictions: ${allPredictionsError.message}`);

      const allTimePredictions = allPredictionsData || [];
      const users = usersData || [];

      // Store raw data for reuse by useMemo
      setRawUsers(users);
      setRawPredictions(allTimePredictions);
      setRawMarkets(markets);

      // Generate chart data (always uses full dataset)
      const userActivityData = generateUserActivityData(users, allTimePredictions);
      const marketActivityData = generateMarketActivityData(allTimePredictions, markets);

      setAnalyticsData({
        userStats: { totalUsers: 0, allTimeUsers: 0, activeTraders: 0, traderRatio: 0 }, // placeholder, useMemo computes actual
        userActivityData,
        marketStats: { allTime: { markets: 0, predictions: 0, tradeVolume: 0 }, open: { markets: 0, predictions: 0, tradeVolume: 0 } },
        marketActivityData
      });
    } catch (err) {
      console.error("Error fetching analytics data:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch analytics data");
    } finally {
      setLoading(false);
    }
  };

  const generateUserActivityData = (users: User[], predictions: Prediction[]): UserActivityData[] => {
    const data: UserActivityData[] = [];
    
    // Get date range for comprehensive data (last 2 years)
    const now = new Date();
    const startDate = new Date(now.getFullYear() - 2, 0, 1);
    
    // Generate daily data points
    const current = new Date(startDate);
    let cumulativeUsers = 0;
    let cumulativeTraders = 0;
    const tradersSet = new Set<string>();
    
    while (current <= now) {
      const dayStart = new Date(current);
      const dayEnd = new Date(current.getFullYear(), current.getMonth(), current.getDate(), 23, 59, 59, 999);

      // Count new signups for this day
      const newSignups = users.filter(user => {
        const userDate = new Date(user.created_at);
        return userDate >= dayStart && userDate <= dayEnd;
      }).length;

      cumulativeUsers += newSignups;

      // Count new traders for this day (users who made their first trade)
      const dayPredictions = predictions.filter(p => {
        const predDate = new Date(p.created_at);
        return predDate >= dayStart && predDate <= dayEnd;
      });

      let newTraders = 0;
      dayPredictions.forEach(pred => {
        if (!tradersSet.has(pred.user_id)) {
          tradersSet.add(pred.user_id);
          newTraders++;
        }
      });

      cumulativeTraders += newTraders;

      // Count active traders for this day (users who traded on this specific day)
      const activeTraders = new Set(dayPredictions.map(p => p.user_id)).size;

      data.push({
        date: current.toISOString().split('T')[0],
        new_signups: newSignups,
        cumulative_users: cumulativeUsers,
        new_traders: newTraders,
        cumulative_traders: cumulativeTraders,
        active_traders: activeTraders
      });

      // Move to next day
      current.setDate(current.getDate() + 1);
    }

    return data;
  };

  const generateMarketActivityData = (predictions: Prediction[], markets: Market[]): MarketActivityData[] => {
    const data: MarketActivityData[] = [];
    
    // Get date range for comprehensive data (last 2 years to cover all scenarios)
    const now = new Date();
    const startDate = new Date(now.getFullYear() - 2, 0, 1); // Start from 2 years ago
    
    // Generate daily data points
    const current = new Date(startDate);
    
    while (current <= now) {
      const dayStart = new Date(current);
      const dayEnd = new Date(current.getFullYear(), current.getMonth(), current.getDate(), 23, 59, 59, 999);

      // Filter predictions for this day
      const dayPredictions = predictions.filter(p => {
        const predDate = new Date(p.created_at);
        return predDate >= dayStart && predDate <= dayEnd;
      });

      // Filter markets created on this day
      const marketsCreated = markets.filter(m => {
        const marketDate = new Date(m.created_at);
        return marketDate >= dayStart && marketDate <= dayEnd;
      });

      const predictionCount = dayPredictions.length;
      const totalVolume = dayPredictions.reduce((sum, p) => sum + Math.abs(p.trade_value || 0), 0);
      const marketsCreatedCount = marketsCreated.length;

      data.push({
        date: current.toISOString().split('T')[0], // YYYY-MM-DD format for daily data
        predictions: predictionCount,
        markets_created: marketsCreatedCount,
        volume: totalVolume
      });

      // Move to next day
      current.setDate(current.getDate() + 1);
    }

    return data;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-transparent text-white">
        <div className="container mx-auto p-6">
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            <span className="ml-3 text-gray-400">Loading analytics...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-transparent text-white">
        <div className="container mx-auto p-6">
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-4">
            <p className="text-red-400">Error: {error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!analyticsData) {
    return (
      <div className="min-h-screen bg-transparent text-white">
        <div className="container mx-auto p-6">
          <p className="text-center text-gray-400">No analytics data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent text-white">
      <div className="container mx-auto p-6">
        {/* Header with View Toggle and KPI Time Filter */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <h1 className="text-3xl font-bold mb-2">
                {activeView === 'user' ? 'User Analytics' : 'Market Analytics'}
              </h1>
              <p className="text-gray-400">
                {activeView === 'user'
                  ? 'Prophet user engagement and activity statistics'
                  : 'Prophet prediction market statistics and trends'
                }
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              {/* KPI Time Filter */}
              <div className="flex rounded-lg bg-gray-800 p-1">
                {(["2d", "7d", "30d"] as KpiTimeFilter[]).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setKpiTimeFilter(filter)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      kpiTimeFilter === filter
                        ? "bg-green-600 text-white shadow-sm"
                        : "text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    {filter === "2d" ? "Today" : filter === "7d" ? "7 Days" : "30 Days"}
                  </button>
                ))}
              </div>

              {/* View Toggle */}
              <div className="flex rounded-lg bg-gray-800 p-1">
                <button
                  onClick={() => setActiveView('user')}
                  className={`px-6 py-3 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
                    activeView === 'user'
                      ? "bg-purple-600 text-white shadow-sm"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                  </svg>
                  User Analytics
                </button>
                <button
                  onClick={() => setActiveView('market')}
                  className={`px-6 py-3 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
                    activeView === 'market'
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  Market Analytics
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* User Analytics View */}
        {activeView === 'user' && (
          <>
            {/* User Statistics Section */}
            <UserStatistics
              data={filteredUserStats}
              timeFilter={kpiTimeFilter}
              loading={false}
            />

            {/* User Activity Charts */}
            <UserActivityCharts
              data={analyticsData.userActivityData}
              loading={false}
            />
            
            {/* User-focused insights */}
            <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 mb-8">
              <h3 className="text-xl font-semibold text-white mb-4">User Activity Insights</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                  <h4 className="text-gray-400 text-sm mb-2">Engagement Rate</h4>
                  <div className="text-2xl font-bold text-purple-400">
                    {`${filteredUserStats.traderRatio.toFixed(1)}%`}
                  </div>
                  <p className="text-gray-500 text-xs mt-1">Users who traded ({getKpiTimeFilterLabel(kpiTimeFilter)})</p>
                </div>

                <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                  <h4 className="text-gray-400 text-sm mb-2">Average Trades per Trader</h4>
                  <div className="text-2xl font-bold text-green-400">
                    {filteredUserStats.activeTraders > 0
                      ? (filteredMarketStats.allTime.predictions / filteredUserStats.activeTraders).toFixed(1)
                      : '0'
                    }
                  </div>
                  <p className="text-gray-500 text-xs mt-1">Predictions per active user</p>
                </div>

                <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                  <h4 className="text-gray-400 text-sm mb-2">Platform Adoption</h4>
                  <div className="text-2xl font-bold text-blue-400">
                    {`${filteredUserStats.activeTraders}/${filteredUserStats.allTimeUsers}`}
                  </div>
                  <p className="text-gray-500 text-xs mt-1">Active traders vs total users ({getKpiTimeFilterLabel(kpiTimeFilter)})</p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Market Analytics View */}
        {activeView === 'market' && (
          <>
            {/* Market Statistics Section */}
            <MarketStats
              data={filteredMarketStats}
              timeFilter={kpiTimeFilter}
              loading={false}
            />

            {/* Market Activity Charts */}
            <MarketActivityCharts
              data={analyticsData.marketActivityData}
              loading={false}
            />
          </>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-gray-400 text-sm">
          <p>
            {activeView === 'user' ? 'User analytics' : 'Market analytics'} updated in real-time
          </p>
        </div>
      </div>
    </div>
  );
}