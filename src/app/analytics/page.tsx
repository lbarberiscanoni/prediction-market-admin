// src/app/analytics/page.tsx
"use client";

import { useEffect, useState } from "react";
import supabase from "@/lib/supabase/createClient";
import Navbar from "@/components/navbar";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar
} from "recharts";

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
  totalPredictions: number;
  totalTradeVolume: number;
  activeUsersData: Array<{
    date: string;
    active_users: number;
    cumulative_users: number;
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

type TimeFilter = "daily" | "weekly" | "monthly" | "all";

export default function AnalyticsPage() {
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("monthly");

  useEffect(() => {
    fetchAnalyticsData();
  }, [timeFilter]);

  const getDateRange = () => {
    const now = new Date();
    const ranges = {
      daily: 30, // Last 30 days
      weekly: 84, // Last 12 weeks (84 days)
      monthly: 365, // Last 12 months (365 days)
      all: 730 // Last 2 years or all data
    };

    const daysBack = ranges[timeFilter];
    const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    return { startDate, endDate: now };
  };

  const fetchAnalyticsData = async () => {
    setLoading(true);
    setError(null);

    try {
      const { startDate, endDate } = getDateRange();

      // Fetch all users (for total count)
      const { data: allUsersData, error: allUsersError } = await supabase
        .from("profiles")
        .select("id, created_at");

      if (allUsersError) throw new Error(`Failed to fetch users: ${allUsersError.message}`);

      const totalUsers = allUsersData?.length || 0;

      // Fetch predictions within date range
      const { data: predictionsData, error: predictionsError } = await supabase
        .from("predictions")
        .select("user_id, market_id, outcome_id, shares_amt, trade_value, created_at")
        .gte("created_at", startDate.toISOString())
        .lte("created_at", endDate.toISOString());

      if (predictionsError) throw new Error(`Failed to fetch predictions: ${predictionsError.message}`);

      const totalPredictions = predictionsData?.length || 0;
      const totalTradeVolume = predictionsData?.reduce((sum, p) => sum + Math.abs(p.trade_value || 0), 0) || 0;

      // Generate time series data
      const activeUsersData = generateActiveUsersData(predictionsData || [], startDate, endDate);
      const userGrowthData = generateUserGrowthData(allUsersData || [], startDate, endDate);
      const predictionVolumeData = generateVolumeData(predictionsData || [], startDate, endDate);

      const analytics: AnalyticsData = {
        totalUsers,
        totalPredictions,
        totalTradeVolume,
        activeUsersData,
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

  const generateActiveUsersData = (predictions: Prediction[], startDate: Date, endDate: Date) => {
    const data = [];
    const current = new Date(startDate);
    const cumulativeActiveUsers = new Set<string>();

    while (current <= endDate) {
      const periodEnd = new Date(current);
      
      // Set the end of the current period
      if (timeFilter === "daily") {
        periodEnd.setDate(current.getDate() + 1);
      } else if (timeFilter === "weekly") {
        periodEnd.setDate(current.getDate() + 7);
      } else if (timeFilter === "monthly") {
        periodEnd.setMonth(current.getMonth() + 1);
      } else {
        periodEnd.setDate(current.getDate() + 30); // All time grouped by month
      }

      const periodPredictions = predictions.filter(p => {
        const predDate = new Date(p.created_at);
        return predDate >= current && predDate < periodEnd;
      });

      const activeUsersInPeriod = new Set(periodPredictions.map(p => p.user_id));
      
      // Add to cumulative set
      activeUsersInPeriod.forEach(userId => cumulativeActiveUsers.add(userId));

      data.push({
        date: formatDateForDisplay(current),
        active_users: activeUsersInPeriod.size,
        cumulative_users: cumulativeActiveUsers.size
      });

      // Move to next period
      if (timeFilter === "daily") {
        current.setDate(current.getDate() + 1);
      } else if (timeFilter === "weekly") {
        current.setDate(current.getDate() + 7);
      } else if (timeFilter === "monthly") {
        current.setMonth(current.getMonth() + 1);
      } else {
        current.setDate(current.getDate() + 30);
      }
    }

    return data;
  };

  const generateUserGrowthData = (users: User[], startDate: Date, endDate: Date) => {
    const data = [];
    const current = new Date(startDate);
    let cumulativeUsers = 0;

    // Count users that existed before our date range
    const usersBeforeRange = users.filter(user => 
      new Date(user.created_at) < startDate
    ).length;
    cumulativeUsers = usersBeforeRange;

    while (current <= endDate) {
      const periodEnd = new Date(current);
      
      if (timeFilter === "daily") {
        periodEnd.setDate(current.getDate() + 1);
      } else if (timeFilter === "weekly") {
        periodEnd.setDate(current.getDate() + 7);
      } else if (timeFilter === "monthly") {
        periodEnd.setMonth(current.getMonth() + 1);
      } else {
        periodEnd.setDate(current.getDate() + 30);
      }

      const newUsers = users.filter(user => {
        const userDate = new Date(user.created_at);
        return userDate >= current && userDate < periodEnd;
      }).length;

      cumulativeUsers += newUsers;

      data.push({
        date: formatDateForDisplay(current),
        new_users: newUsers,
        cumulative_users: cumulativeUsers
      });

      // Move to next period
      if (timeFilter === "daily") {
        current.setDate(current.getDate() + 1);
      } else if (timeFilter === "weekly") {
        current.setDate(current.getDate() + 7);
      } else if (timeFilter === "monthly") {
        current.setMonth(current.getMonth() + 1);
      } else {
        current.setDate(current.getDate() + 30);
      }
    }

    return data;
  };

  const generateVolumeData = (predictions: Prediction[], startDate: Date, endDate: Date) => {
    const data = [];
    const current = new Date(startDate);

    while (current <= endDate) {
      const periodEnd = new Date(current);
      
      if (timeFilter === "daily") {
        periodEnd.setDate(current.getDate() + 1);
      } else if (timeFilter === "weekly") {
        periodEnd.setDate(current.getDate() + 7);
      } else if (timeFilter === "monthly") {
        periodEnd.setMonth(current.getMonth() + 1);
      } else {
        periodEnd.setDate(current.getDate() + 30);
      }

      const periodPredictions = predictions.filter(p => {
        const predDate = new Date(p.created_at);
        return predDate >= current && predDate < periodEnd;
      });

      const predictionCount = periodPredictions.length;
      const totalVolume = periodPredictions.reduce((sum, p) => sum + Math.abs(p.trade_value || 0), 0);

      data.push({
        date: formatDateForDisplay(current),
        prediction_count: predictionCount,
        total_volume: totalVolume
      });

      // Move to next period
      if (timeFilter === "daily") {
        current.setDate(current.getDate() + 1);
      } else if (timeFilter === "weekly") {
        current.setDate(current.getDate() + 7);
      } else if (timeFilter === "monthly") {
        current.setMonth(current.getMonth() + 1);
      } else {
        current.setDate(current.getDate() + 30);
      }
    }

    return data;
  };

  const formatDateForDisplay = (date: Date) => {
    if (timeFilter === "daily") {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } else if (timeFilter === "weekly") {
      return `Week of ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    } else if (timeFilter === "monthly") {
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    } else {
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    }
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

        {/* Time Filter Selector */}
        <div className="mb-6">
          <div className="flex gap-2">
            {[
              { key: "daily" as const, label: "Daily" },
              { key: "weekly" as const, label: "Weekly" },
              { key: "monthly" as const, label: "Monthly" },
              { key: "all" as const, label: "All Time" }
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTimeFilter(key)}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  timeFilter === key
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
            <h3 className="text-sm font-medium text-gray-400 mb-2">Total Users</h3>
            <div className="text-3xl font-bold text-white mb-1">{formatNumber(analyticsData.totalUsers)}</div>
            <div className="text-sm text-blue-400">
              Platform-wide registrations
            </div>
          </div>

          <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
            <h3 className="text-sm font-medium text-gray-400 mb-2">Total Predictions</h3>
            <div className="text-3xl font-bold text-white mb-1">{formatNumber(analyticsData.totalPredictions)}</div>
            <div className="text-sm text-green-400">
              {timeFilter === "all" ? "All time" : `Last ${timeFilter.replace('ly', '')}`}
            </div>
          </div>

          <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
            <h3 className="text-sm font-medium text-gray-400 mb-2">Trade Volume</h3>
            <div className="text-3xl font-bold text-white mb-1">{formatCurrency(analyticsData.totalTradeVolume)}</div>
            <div className="text-sm text-purple-400">
              {timeFilter === "all" ? "All time" : `Last ${timeFilter.replace('ly', '')}`}
            </div>
          </div>
        </div>

        {/* Active Users Chart */}
        <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 mb-8">
          <h3 className="text-lg font-semibold mb-4">Active Users Over Time</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analyticsData.activeUsersData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis 
                  dataKey="date" 
                  stroke="#9CA3AF"
                  fontSize={12}
                  angle={timeFilter === "daily" ? -45 : 0}
                  textAnchor={timeFilter === "daily" ? "end" : "middle"}
                  height={timeFilter === "daily" ? 80 : 60}
                />
                <YAxis stroke="#9CA3AF" />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#1F2937', 
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: '#F9FAFB'
                  }}
                  formatter={(value, name) => [
                    formatNumber(Number(value)),
                    name === 'active_users' ? 'Active Users' : 'Cumulative Active Users'
                  ]}
                />
                <Line 
                  type="monotone" 
                  dataKey="active_users" 
                  stroke="#3B82F6" 
                  strokeWidth={2}
                  name="active_users"
                />
                <Line 
                  type="monotone" 
                  dataKey="cumulative_users" 
                  stroke="#10B981" 
                  strokeWidth={2}
                  name="cumulative_users"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 flex justify-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500 rounded"></div>
              <span className="text-gray-300">Active Users (Period)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded"></div>
              <span className="text-gray-300">Cumulative Active Users</span>
            </div>
          </div>
        </div>

        {/* Additional Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* User Growth Chart */}
          <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
            <h3 className="text-lg font-semibold mb-4">User Growth</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analyticsData.userGrowthData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis 
                    dataKey="date" 
                    stroke="#9CA3AF"
                    fontSize={12}
                    angle={timeFilter === "daily" ? -45 : 0}
                    textAnchor={timeFilter === "daily" ? "end" : "middle"}
                    height={timeFilter === "daily" ? 60 : 40}
                  />
                  <YAxis stroke="#9CA3AF" />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#1F2937', 
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      color: '#F9FAFB'
                    }}
                    formatter={(value) => [formatNumber(Number(value)), 'New Users']}
                  />
                  <Bar dataKey="new_users" fill="#8B5CF6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Prediction Volume Chart */}
          <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
            <h3 className="text-lg font-semibold mb-4">Prediction Volume</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analyticsData.predictionVolumeData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis 
                    dataKey="date" 
                    stroke="#9CA3AF"
                    fontSize={12}
                    angle={timeFilter === "daily" ? -45 : 0}
                    textAnchor={timeFilter === "daily" ? "end" : "middle"}
                    height={timeFilter === "daily" ? 60 : 40}
                  />
                  <YAxis stroke="#9CA3AF" />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#1F2937', 
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      color: '#F9FAFB'
                    }}
                    formatter={(value) => [formatNumber(Number(value)), 'Predictions']}
                  />
                  <Bar dataKey="prediction_count" fill="#F59E0B" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-gray-400 text-sm">
          <p>Analytics data updated in real-time. Time range: {timeFilter}</p>
        </div>
      </div>
    </div>
  );
}