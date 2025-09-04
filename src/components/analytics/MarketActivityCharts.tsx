// src/components/analytics/MarketActivityCharts.tsx
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

interface MarketActivityData {
  date: string;
  predictions: number;
  markets_created: number;
  volume: number;
}

interface MarketActivityChartsProps {
  data: MarketActivityData[];
  loading?: boolean;
}

type ActivityTimeFilter = "daily" | "weekly" | "monthly";

const MarketActivityCharts = memo(({ data, loading = false }: MarketActivityChartsProps) => {
  const [timeFilter, setTimeFilter] = React.useState<ActivityTimeFilter>("monthly");

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

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
    let aggregatedData: MarketActivityData[] = [];
    
    if (timeFilter === "daily") {
      // For daily view, use data as-is but format dates nicely
      aggregatedData = timeFilteredData.map(item => ({
        ...item,
        date: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      }));
    } else if (timeFilter === "weekly") {
      // Aggregate by week
      const weeklyData = new Map<string, MarketActivityData>();
      
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
            predictions: 0,
            markets_created: 0,
            volume: 0
          });
        }
        
        const existing = weeklyData.get(weekKey)!;
        existing.predictions += item.predictions;
        existing.markets_created += item.markets_created;
        existing.volume += item.volume;
      });
      
      aggregatedData = Array.from(weeklyData.values()).sort((a, b) => 
        new Date(a.date.replace('Week of ', '')).getTime() - new Date(b.date.replace('Week of ', '')).getTime()
      );
    } else if (timeFilter === "monthly") {
      // Aggregate by month
      const monthlyData = new Map<string, MarketActivityData>();
      
      timeFilteredData.forEach(item => {
        const itemDate = new Date(item.date);
        const monthKey = `${itemDate.getFullYear()}-${itemDate.getMonth()}`;
        const monthLabel = itemDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
        
        if (!monthlyData.has(monthKey)) {
          monthlyData.set(monthKey, {
            date: monthLabel,
            predictions: 0,
            markets_created: 0,
            volume: 0
          });
        }
        
        const existing = monthlyData.get(monthKey)!;
        existing.predictions += item.predictions;
        existing.markets_created += item.markets_created;
        existing.volume += item.volume;
      });
      
      aggregatedData = Array.from(monthlyData.values()).sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );
    }
    
    // Find the first entry with any activity
    const firstActiveIndex = aggregatedData.findIndex(item => 
      item.predictions > 0 || item.markets_created > 0 || item.volume > 0
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 mb-8">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-semibold text-white">Market Activity Over Time</h3>
          <div className="flex rounded-lg bg-gray-800 p-1">
            <div className="h-8 w-16 bg-gray-700 rounded animate-pulse"></div>
            <div className="h-8 w-20 bg-gray-700 rounded animate-pulse ml-1"></div>
            <div className="h-8 w-20 bg-gray-700 rounded animate-pulse ml-1"></div>
          </div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <LoadingChart title="Predictions" />
          <LoadingChart title="New Markets" />
          <LoadingChart title="Trade Volume" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 mb-8">
      {/* Header with Time Filter */}
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-semibold text-white">Market Activity Over Time</h3>
        
        {/* Time Filter Toggle */}
        <div className="flex rounded-lg bg-gray-800 p-1">
          <button
            onClick={() => setTimeFilter("daily")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              timeFilter === "daily"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Daily
          </button>
          <button
            onClick={() => setTimeFilter("weekly")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              timeFilter === "weekly"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Weekly
          </button>
          <button
            onClick={() => setTimeFilter("monthly")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              timeFilter === "monthly"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Monthly
          </button>
        </div>
      </div>

      {/* Charts Grid - Vertical Layout */}
      <div className="space-y-6">
        {/* Predictions Chart */}
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold text-white">Predictions</h4>
            <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
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
                  formatter={(value) => [formatNumber(Number(value)), 'Predictions']}
                />
                <Line 
                  type="monotone" 
                  dataKey="predictions" 
                  stroke="#A855F7" 
                  strokeWidth={2}
                  dot={{ fill: '#A855F7', strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6, fill: '#A855F7' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* New Markets Chart */}
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold text-white">New Markets</h4>
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
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
                  formatter={(value) => [formatNumber(Number(value)), 'New Markets']}
                />
                <Bar 
                  dataKey="markets_created" 
                  fill="#10B981"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Trade Volume Chart */}
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold text-white">Trade Volume</h4>
            <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
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
                <YAxis 
                  stroke="#9CA3AF" 
                  fontSize={12}
                  tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#1F2937', 
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: '#F9FAFB'
                  }}
                  formatter={(value) => [formatCurrency(Number(value)), 'Volume']}
                />
                <Line 
                  type="monotone" 
                  dataKey="volume" 
                  stroke="#3B82F6" 
                  strokeWidth={2}
                  dot={{ fill: '#3B82F6', strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6, fill: '#3B82F6' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Summary Info */}
      <div className="mt-6 pt-4 border-t border-gray-700">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-400">
          <div className="text-center">
            <span className="text-purple-400 font-medium">
              {formatNumber(filteredData.reduce((sum, item) => sum + item.predictions, 0))}
            </span>
            <span className="ml-1">total predictions in {timeFilter} view</span>
          </div>
          <div className="text-center">
            <span className="text-emerald-400 font-medium">
              {formatNumber(filteredData.reduce((sum, item) => sum + item.markets_created, 0))}
            </span>
            <span className="ml-1">markets created in {timeFilter} view</span>
          </div>
          <div className="text-center">
            <span className="text-blue-400 font-medium">
              {formatCurrency(filteredData.reduce((sum, item) => sum + item.volume, 0))}
            </span>
            <span className="ml-1">total volume in {timeFilter} view</span>
          </div>
        </div>
      </div>
    </div>
  );
});

MarketActivityCharts.displayName = 'MarketActivityCharts';

export default MarketActivityCharts;