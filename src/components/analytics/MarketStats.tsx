// src/components/analytics/MarketStats.tsx
"use client";

import React, { memo } from 'react';

interface MarketStatsData {
  // All time stats
  allTime: {
    markets: number;
    predictions: number;
    tradeVolume: number;
  };
  // Open markets stats
  open: {
    markets: number;
    predictions: number;
    tradeVolume: number;
  };
}

interface MarketStatsProps {
  data: MarketStatsData;
  loading?: boolean;
}

type StatFilter = "open" | "allTime";

const MarketStats = memo(({ data, loading = false }: MarketStatsProps) => {
  const [activeFilter, setActiveFilter] = React.useState<StatFilter>("open");

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

  const currentStats = activeFilter === "open" ? data.open : data.allTime;

  const LoadingCard = ({ title }: { title: string }) => (
    <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
      <h3 className="text-sm font-medium text-gray-400 mb-2">{title}</h3>
      <div className="animate-pulse">
        <div className="h-8 bg-gray-700 rounded w-2/3 mb-2"></div>
        <div className="h-4 bg-gray-700 rounded w-1/2"></div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 mb-8">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-semibold text-white">Market Statistics</h3>
          <div className="flex rounded-lg bg-gray-800 p-1">
            <div className="h-8 w-16 bg-gray-700 rounded animate-pulse"></div>
            <div className="h-8 w-20 bg-gray-700 rounded animate-pulse ml-1"></div>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <LoadingCard title="Markets" />
          <LoadingCard title="Predictions" />
          <LoadingCard title="Trade Volume" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 mb-8">
      {/* Header with Filter Toggle */}
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-semibold text-white">Market Statistics</h3>
        
        {/* Filter Toggle */}
        <div className="flex rounded-lg bg-gray-800 p-1">
          <button
            onClick={() => setActiveFilter("open")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeFilter === "open"
                ? "bg-green-600 text-white shadow-sm"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Open
          </button>
          <button
            onClick={() => setActiveFilter("allTime")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeFilter === "allTime"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            All Time
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Markets Card */}
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-400">Markets</h4>
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
          </div>
          <div className="text-3xl font-bold text-white mb-1">
            {formatNumber(currentStats.markets)}
          </div>
          <div className="text-sm text-emerald-400">
            {activeFilter === "open" ? "Currently active" : "Total created"}
          </div>
        </div>

        {/* Predictions Card */}
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-400">Predictions</h4>
            <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
          </div>
          <div className="text-3xl font-bold text-white mb-1">
            {formatNumber(currentStats.predictions)}
          </div>
          <div className="text-sm text-purple-400">
            {activeFilter === "open" ? "On active markets" : "All time trades"}
          </div>
        </div>

        {/* Trade Volume Card */}
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-400">Trade Volume</h4>
            <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
          </div>
          <div className="text-3xl font-bold text-white mb-1">
            {formatCurrency(currentStats.tradeVolume)}
          </div>
          <div className="text-sm text-blue-400">
            {activeFilter === "open" ? "Active market volume" : "Total volume traded"}
          </div>
        </div>
      </div>

      {/* Optional: Stats Comparison */}
      {activeFilter === "open" && (
        <div className="mt-4 pt-4 border-t border-gray-700">
          <div className="flex justify-between text-sm text-gray-400">
            <span>Showing statistics for open markets only</span>
            <span>
              {((currentStats.markets / data.allTime.markets) * 100).toFixed(1)}% of total markets are currently open
            </span>
          </div>
        </div>
      )}
    </div>
  );
});

MarketStats.displayName = 'MarketStats';

export default MarketStats;