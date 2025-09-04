// src/components/analytics/UserActivityCharts.tsx
"use client";

import React, { memo } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface UserActivityData {
  date: string;
  new_signups: number;
  cumulative_users: number;
  new_traders: number;
  cumulative_traders: number;
  active_traders: number; // traders who made at least one trade in this period
}

interface UserActivityChartsProps {
  data: UserActivityData[];
  loading?: boolean;
}

type UserTimeFilter = "daily" | "weekly" | "monthly";

const UserActivityCharts = memo(({ data, loading = false }: UserActivityChartsProps) => {
  const [timeFilter, setTimeFilter] = React.useState<UserTimeFilter>("monthly");

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('en-US').format(value);
  };

  // Filter and aggregate data based on selected time period
  const getFilteredData = () => {
    if (!data || data.length === 0) return [];
    
    const now = new Date();
    let cutoffDate: Date;
    
    switch (timeFilter) {
      case "daily":
        cutoffDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)); // Last 30 days
        break;
      case "weekly":
        cutoffDate = new Date(now.getTime() - (12 * 7 * 24 * 60 * 60 * 1000)); // Last 12 weeks
        break;
      case "monthly":
        cutoffDate = new Date(now.getTime() - (12 * 30 * 24 * 60 * 60 * 1000)); // Last 12 months
        break;
      default:
        return data;
    }
    
    // Filter data by time cutoff
    const timeFilteredData = data.filter(item => {
      const itemDate = new Date(item.date);
      return itemDate >= cutoffDate;
    });
    
    // Aggregate data based on time filter
    let aggregatedData: UserActivityData[] = [];
    
    if (timeFilter === "daily") {
      // For daily view, use data as-is but format dates nicely
      aggregatedData = timeFilteredData.map(item => ({
        ...item,
        date: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      }));
    } else if (timeFilter === "weekly") {
      // Aggregate by week
      const weeklyData = new Map<string, UserActivityData>();
      
      timeFilteredData.forEach(item => {
        const itemDate = new Date(item.date);
        // Get Monday of the week
        const monday = new Date(itemDate);
        monday.setDate(itemDate.getDate() - itemDate.getDay() + 1);
        const weekKey = monday.toISOString().split('T')[0];
        const weekLabel = `Week of ${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
        
        if (!weeklyData.has(weekKey)) {
          weeklyData.set(weekKey, {
            date: weekLabel,
            new_signups: 0,
            cumulative_users: 0,
            new_traders: 0,
            cumulative_traders: 0,
            active_traders: 0
          });
        }
        
        const existing = weeklyData.get(weekKey)!;
        existing.new_signups += item.new_signups;
        existing.new_traders += item.new_traders;
        existing.active_traders += item.active_traders;
        // Use the latest cumulative values for the week
        existing.cumulative_users = Math.max(existing.cumulative_users, item.cumulative_users);
        existing.cumulative_traders = Math.max(existing.cumulative_traders, item.cumulative_traders);
      });
      
      aggregatedData = Array.from(weeklyData.values()).sort((a, b) => 
        new Date(a.date.replace('Week of ', '')).getTime() - new Date(b.date.replace('Week of ', '')).getTime()
      );
    } else if (timeFilter === "monthly") {
      // Aggregate by month
      const monthlyData = new Map<string, UserActivityData>();
      
      timeFilteredData.forEach(item => {
        const itemDate = new Date(item.date);
        const monthKey = `${itemDate.getFullYear()}-${itemDate.getMonth()}`;
        const monthLabel = itemDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
        
        if (!monthlyData.has(monthKey)) {
          monthlyData.set(monthKey, {
            date: monthLabel,
            new_signups: 0,
            cumulative_users: 0,
            new_traders: 0,
            cumulative_traders: 0,
            active_traders: 0
          });
        }
        
        const existing = monthlyData.get(monthKey)!;
        existing.new_signups += item.new_signups;
        existing.new_traders += item.new_traders;
        existing.active_traders += item.active_traders;
        // Use the latest cumulative values for the month
        existing.cumulative_users = Math.max(existing.cumulative_users, item.cumulative_users);
        existing.cumulative_traders = Math.max(existing.cumulative_traders, item.cumulative_traders);
      });
      
      aggregatedData = Array.from(monthlyData.values()).sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );
    }
    
    // Find the first entry with any activity
    const firstActiveIndex = aggregatedData.findIndex(item => 
      item.new_signups > 0 || item.new_traders > 0 || item.active_traders > 0
    );
    
    // If no active data found, return empty array
    if (firstActiveIndex === -1) return [];
    
    // Return data starting from the first active entry
    return aggregatedData.slice(firstActiveIndex);
  };

  const filteredData = getFilteredData();

  const LoadingChart = ({ title }: { title: string }) => (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <h4 className="text-lg font-semibold text-white mb-4">{title}</h4>
      <div className="h-64 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 mb-8">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-semibold text-white">User Activity Over Time</h3>
          <div className="flex rounded-lg bg-gray-800 p-1">
            <div className="h-8 w-16 bg-gray-700 rounded animate-pulse"></div>
            <div className="h-8 w-20 bg-gray-700 rounded animate-pulse ml-1"></div>
            <div className="h-8 w-20 bg-gray-700 rounded animate-pulse ml-1"></div>
          </div>
        </div>
        
        <div className="space-y-6">
          <LoadingChart title="User Signups" />
          <LoadingChart title="Active Traders" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 mb-8">
      {/* Header with Time Filter */}
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-semibold text-white">User Activity Over Time</h3>
        
        {/* Time Filter Toggle */}
        <div className="flex rounded-lg bg-gray-800 p-1">
          <button
            onClick={() => setTimeFilter("daily")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              timeFilter === "daily"
                ? "bg-purple-600 text-white shadow-sm"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Daily
          </button>
          <button
            onClick={() => setTimeFilter("weekly")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              timeFilter === "weekly"
                ? "bg-purple-600 text-white shadow-sm"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Weekly
          </button>
          <button
            onClick={() => setTimeFilter("monthly")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              timeFilter === "monthly"
                ? "bg-purple-600 text-white shadow-sm"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Monthly
          </button>
        </div>
      </div>

      {/* Charts - Vertical Layout */}
      <div className="space-y-6">
        {/* New Signups Chart */}
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold text-white">New Signups</h4>
            <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={filteredData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis 
                  dataKey="date" 
                  stroke="#9CA3AF"
                  fontSize={10}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <YAxis stroke="#9CA3AF" fontSize={12} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#1F2937', 
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: '#F9FAFB'
                  }}
                  formatter={(value) => [formatNumber(Number(value)), 'New Signups']}
                />
                <Bar 
                  dataKey="new_signups" 
                  fill="#3B82F6"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Total Users Chart */}
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold text-white">Total Users</h4>
            <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={filteredData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis 
                  dataKey="date" 
                  stroke="#9CA3AF"
                  fontSize={10}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <YAxis stroke="#9CA3AF" fontSize={12} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#1F2937', 
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: '#F9FAFB'
                  }}
                  formatter={(value) => [formatNumber(Number(value)), 'Total Users']}
                />
                <Line 
                  type="monotone" 
                  dataKey="cumulative_users" 
                  stroke="#10B981" 
                  strokeWidth={3}
                  dot={{ fill: '#10B981', strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6, fill: '#10B981' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* New Traders Chart */}
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold text-white">New Traders</h4>
            <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={filteredData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis 
                  dataKey="date" 
                  stroke="#9CA3AF"
                  fontSize={10}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <YAxis stroke="#9CA3AF" fontSize={12} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#1F2937', 
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: '#F9FAFB'
                  }}
                  formatter={(value) => [formatNumber(Number(value)), 'New Traders']}
                />
                <Bar 
                  dataKey="new_traders" 
                  fill="#8B5CF6"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Total Traders Chart */}
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold text-white">Total Traders</h4>
            <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={filteredData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis 
                  dataKey="date" 
                  stroke="#9CA3AF"
                  fontSize={10}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <YAxis stroke="#9CA3AF" fontSize={12} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#1F2937', 
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: '#F9FAFB'
                  }}
                  formatter={(value) => [formatNumber(Number(value)), 'Total Traders']}
                />
                <Line 
                  type="monotone" 
                  dataKey="cumulative_traders" 
                  stroke="#F59E0B" 
                  strokeWidth={3}
                  dot={{ fill: '#F59E0B', strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6, fill: '#F59E0B' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Summary Info */}
      <div className="mt-6 pt-4 border-t border-gray-700">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm text-gray-400">
          <div className="text-center">
            <span className="text-blue-400 font-medium">
              {formatNumber(filteredData.reduce((sum, item) => sum + item.new_signups, 0))}
            </span>
            <span className="ml-1">new signups in {timeFilter} view</span>
          </div>
          <div className="text-center">
            <span className="text-green-400 font-medium">
              {filteredData.length > 0 ? formatNumber(filteredData[filteredData.length - 1].cumulative_users) : '0'}
            </span>
            <span className="ml-1">total users</span>
          </div>
          <div className="text-center">
            <span className="text-purple-400 font-medium">
              {formatNumber(filteredData.reduce((sum, item) => sum + item.new_traders, 0))}
            </span>
            <span className="ml-1">new traders in {timeFilter} view</span>
          </div>
          <div className="text-center">
            <span className="text-yellow-400 font-medium">
              {filteredData.length > 0 ? formatNumber(filteredData[filteredData.length - 1].cumulative_traders) : '0'}
            </span>
            <span className="ml-1">total traders</span>
          </div>
        </div>
      </div>
    </div>
  );
});

UserActivityCharts.displayName = 'UserActivityCharts';

export default UserActivityCharts;