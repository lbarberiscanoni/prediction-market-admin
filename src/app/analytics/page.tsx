// src/app/analytics/page.tsx
"use client";

import { useEffect, useState } from "react";
import supabase from "@/lib/supabase/createClient";
import Navbar from "@/components/navbar";

interface User {
  id: string;
  created_at: string;
}

interface Prediction {
  user_id: string;
  market_id: number;
  outcome_id: number;
  shares_amt: number;
  trade_value: number;
  created_at: string;
}

interface AnalyticsData {
  totalUsers: number;
  activeTraders: number;
  totalPredictions: number;
  totalMarkets: number;
  totalTradeVolume: number;
  averagePredictionValue: number;
  newUsersThisWeek: number;
  newUsersThisMonth: number;
  predictionsThisWeek: number;
  predictionsThisMonth: number;
  topMarketsByVolume: Array<{
    id: number;
    name: string;
    prediction_count: number;
    total_volume: number;
  }>;
  userGrowthData: Array<{
    date: string;
    new_users: number;
    cumulative_users: number;
  }>;
  predictionVolumeData: Array<{
    date: string;
    prediction_count: number;
    total_volume: number;
  }>;
}

export default function AnalyticsPage() {
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d" | "all">("30d");

  useEffect(() => {
    fetchAnalyticsData();
  }, [timeRange]);

  const fetchAnalyticsData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Calculate date ranges
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

      let startDate: Date;
      switch (timeRange) {
        case "7d":
          startDate = oneWeekAgo;
          break;
        case "30d":
          startDate = oneMonthAgo;
          break;
        case "90d":
          startDate = threeMonthsAgo;
          break;
        default:
          startDate = new Date("2020-01-01"); // All time
      }

      // Fetch total users
      const { data: usersData, error: usersError } = await supabase
        .from("profiles")
        .select("id, created_at");

      if (usersError) throw new Error(`Failed to fetch users: ${usersError.message}`);

      const totalUsers = usersData?.length || 0;
      const newUsersThisWeek = usersData?.filter(u => 
        new Date(u.created_at) >= oneWeekAgo
      ).length || 0;
      const newUsersThisMonth = usersData?.filter(u => 
        new Date(u.created_at) >= oneMonthAgo
      ).length || 0;

      // Fetch predictions data
      const { data: predictionsData, error: predictionsError } = await supabase
        .from("predictions")
        .select("user_id, market_id, outcome_id, shares_amt, trade_value, created_at")
        .gte("created_at", startDate.toISOString());

      if (predictionsError) throw new Error(`Failed to fetch predictions: ${predictionsError.message}`);

      const totalPredictions = predictionsData?.length || 0;
      const activeTraders = new Set(predictionsData?.map(p => p.user_id)).size;
      
      // Use trade_value as the primary trade volume metric
      const totalTradeVolume = predictionsData?.reduce((sum, p) => sum + (p.trade_value || 0), 0) || 0;
      const averagePredictionValue = totalPredictions > 0 ? totalTradeVolume / totalPredictions : 0;

      const predictionsThisWeek = predictionsData?.filter(p => 
        new Date(p.created_at) >= oneWeekAgo
      ).length || 0;
      const predictionsThisMonth = predictionsData?.filter(p => 
        new Date(p.created_at) >= oneMonthAgo
      ).length || 0;

      // Fetch markets data
      const { data: marketsData, error: marketsError } = await supabase
        .from("markets")
        .select("id, name");

      if (marketsError) throw new Error(`Failed to fetch markets: ${marketsError.message}`);

      const totalMarkets = marketsData?.length || 0;

      // Calculate top markets by volume
      const marketStats = new Map<number, { name: string; prediction_count: number; total_volume: number }>();
      
      marketsData?.forEach(market => {
        marketStats.set(market.id, {
          name: market.name,
          prediction_count: 0,
          total_volume: 0
        });
      });

      predictionsData?.forEach(prediction => {
        const marketStat = marketStats.get(prediction.market_id);
        if (marketStat) {
          marketStat.prediction_count += 1;
          marketStat.total_volume += prediction.trade_value || 0;
        }
      });

      const topMarketsByVolume = Array.from(marketStats.entries())
        .map(([id, stats]) => ({ id, ...stats }))
        .sort((a, b) => b.total_volume - a.total_volume)
        .slice(0, 5);

      // Generate user growth data (last 30 days)
      const userGrowthData = generateGrowthData(usersData || [], oneMonthAgo, now, "created_at");

      // Generate prediction volume data (last 30 days)
      const predictionVolumeData = generateVolumeData(predictionsData || [], oneMonthAgo, now);

      const analytics: AnalyticsData = {
        totalUsers,
        activeTraders,
        totalPredictions,
        totalMarkets,
        totalTradeVolume,
        averagePredictionValue,
        newUsersThisWeek,
        newUsersThisMonth,
        predictionsThisWeek,
        predictionsThisMonth,
        topMarketsByVolume,
        userGrowthData,
        predictionVolumeData
      };

      setAnalyticsData(analytics);
    } catch (err) {
      console.error("Error fetching analytics data:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch analytics data");
    } finally {
      setLoading(false);
    }
  };

  const generateGrowthData = (data: User[], startDate: Date, endDate: Date, dateField: keyof User) => {
    const days = [];
    const current = new Date(startDate);
    
    while (current <= endDate) {
      const dayStr = current.toISOString().split('T')[0];
      const newUsers = data.filter(item => 
        item[dateField] && new Date(item[dateField] as string).toISOString().split('T')[0] === dayStr
      ).length;
      
      const cumulativeUsers = data.filter(item => 
        item[dateField] && new Date(item[dateField] as string) <= current
      ).length;

      days.push({
        date: dayStr,
        new_users: newUsers,
        cumulative_users: cumulativeUsers
      });
      
      current.setDate(current.getDate() + 1);
    }
    
    return days;
  };

  const generateVolumeData = (predictions: Prediction[], startDate: Date, endDate: Date) => {
    const days = [];
    const current = new Date(startDate);
    
    while (current <= endDate) {
      const dayStr = current.toISOString().split('T')[0];
      const dayPredictions = predictions.filter(p => 
        p.created_at && new Date(p.created_at).toISOString().split('T')[0] === dayStr
      );
      
      const predictionCount = dayPredictions.length;
      const totalVolume = dayPredictions.reduce((sum, p) => sum + (p.trade_value || 0), 0);

      days.push({
        date: dayStr,
        prediction_count: predictionCount,
        total_volume: totalVolume
      });
      
      current.setDate(current.getDate() + 1);
    }
    
    return days;
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('en-US').format(value);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white">
        <Navbar />
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
      <div className="min-h-screen bg-black text-white">
        <Navbar />
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
      <div className="min-h-screen bg-black text-white">
        <Navbar />
        <div className="container mx-auto p-6">
          <p className="text-center text-gray-400">No analytics data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />
      <div className="container mx-auto p-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Analytics Dashboard</h1>
          <p className="text-gray-400">Prophet prediction market platform statistics</p>
        </div>

        {/* Time Range Selector */}
        <div className="mb-6">
          <div className="flex gap-2">
            {[
              { key: "7d" as const, label: "Last 7 days" },
              { key: "30d" as const, label: "Last 30 days" },
              { key: "90d" as const, label: "Last 90 days" },
              { key: "all" as const, label: "All time" }
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTimeRange(key)}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  timeRange === key
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Key Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
            <h3 className="text-sm font-medium text-gray-400 mb-2">Total Users</h3>
            <div className="text-3xl font-bold text-white mb-1">{formatNumber(analyticsData.totalUsers)}</div>
            <div className="text-sm text-green-400">
              +{analyticsData.newUsersThisWeek} this week
            </div>
          </div>

          <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
            <h3 className="text-sm font-medium text-gray-400 mb-2">Active Traders</h3>
            <div className="text-3xl font-bold text-white mb-1">{formatNumber(analyticsData.activeTraders)}</div>
            <div className="text-sm text-gray-400">
              {analyticsData.totalUsers > 0 ? ((analyticsData.activeTraders / analyticsData.totalUsers) * 100).toFixed(1) : 0}% of total users
            </div>
          </div>

          <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
            <h3 className="text-sm font-medium text-gray-400 mb-2">Total Predictions</h3>
            <div className="text-3xl font-bold text-white mb-1">{formatNumber(analyticsData.totalPredictions)}</div>
            <div className="text-sm text-blue-400">
              +{analyticsData.predictionsThisWeek} this week
            </div>
          </div>

          <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
            <h3 className="text-sm font-medium text-gray-400 mb-2">Trade Volume</h3>
            <div className="text-3xl font-bold text-white mb-1">{formatCurrency(analyticsData.totalTradeVolume)}</div>
            <div className="text-sm text-gray-400">
              Avg: {formatCurrency(analyticsData.averagePredictionValue)}
            </div>
          </div>
        </div>

        {/* Secondary Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
            <h3 className="text-lg font-semibold mb-4">Platform Overview</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-400">Total Markets:</span>
                <span className="text-white font-medium">{formatNumber(analyticsData.totalMarkets)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">New Users (Month):</span>
                <span className="text-white font-medium">{formatNumber(analyticsData.newUsersThisMonth)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Predictions (Month):</span>
                <span className="text-white font-medium">{formatNumber(analyticsData.predictionsThisMonth)}</span>
              </div>
            </div>
          </div>

          <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 md:col-span-2">
            <h3 className="text-lg font-semibold mb-4">Top Markets by Volume</h3>
            <div className="space-y-3">
              {analyticsData.topMarketsByVolume.map((market, index) => (
                <div key={market.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-400">#{index + 1}</span>
                    <span className="text-white font-medium truncate">{market.name}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-white font-medium">{formatCurrency(market.total_volume)}</div>
                    <div className="text-xs text-gray-400">{formatNumber(market.prediction_count)} predictions</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Growth Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
            <h3 className="text-lg font-semibold mb-4">User Growth (Last 30 Days)</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {analyticsData.userGrowthData.slice(-10).map((day) => (
                <div key={day.date} className="flex justify-between items-center text-sm">
                  <span className="text-gray-400">{new Date(day.date).toLocaleDateString()}</span>
                  <div className="text-right">
                    <span className="text-white">+{day.new_users}</span>
                    <span className="text-gray-400 ml-2">({day.cumulative_users} total)</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
            <h3 className="text-lg font-semibold mb-4">Prediction Volume (Last 30 Days)</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {analyticsData.predictionVolumeData.slice(-10).map((day) => (
                <div key={day.date} className="flex justify-between items-center text-sm">
                  <span className="text-gray-400">{new Date(day.date).toLocaleDateString()}</span>
                  <div className="text-right">
                    <span className="text-white">{day.prediction_count}</span>
                    <span className="text-gray-400 ml-2">({formatCurrency(day.total_volume)})</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-gray-400 text-sm">
          <p>Analytics data updated in real-time. Time range: {timeRange === "all" ? "All time" : timeRange}</p>
        </div>
      </div>
    </div>
  );
}