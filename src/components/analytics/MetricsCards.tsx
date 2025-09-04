// src/components/analytics/MetricsCards.tsx
"use client";

import React, { memo } from 'react';

interface MetricsData {
  totalUsers: number;
  totalPredictions: number;
  totalTradeVolume: number;
  totalMarkets: number;
  openMarkets: number;
  totalOpenInterest: number;
}

interface MetricsCardsProps {
  data: MetricsData;
  timeFilter: "daily" | "weekly" | "monthly" | "all";
  loading?: boolean;
}

const MetricsCards = memo(({ data, timeFilter, loading = false }: MetricsCardsProps) => {
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6 mb-8">
        <LoadingCard title="Total Users" />
        <LoadingCard title="Total Markets" />
        <LoadingCard title="Open Markets" />
        <LoadingCard title="Open Interest" />
        <LoadingCard title="Total Predictions" />
        <LoadingCard title="Trade Volume" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6 mb-8">
      {/* Total Users */}
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
        <h3 className="text-sm font-medium text-gray-400 mb-2">Total Users</h3>
        <div className="text-3xl font-bold text-white mb-1">{formatNumber(data.totalUsers)}</div>
        <div className="text-sm text-blue-400">
          Platform registrations
        </div>
      </div>

      {/* Total Markets */}
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
        <h3 className="text-sm font-medium text-gray-400 mb-2">Total Markets</h3>
        <div className="text-3xl font-bold text-white mb-1">{formatNumber(data.totalMarkets)}</div>
        <div className="text-sm text-green-400">
          All markets created
        </div>
      </div>

      {/* Open Markets */}
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
        <h3 className="text-sm font-medium text-gray-400 mb-2">Open Markets</h3>
        <div className="text-3xl font-bold text-white mb-1">{formatNumber(data.openMarkets)}</div>
        <div className="text-sm text-emerald-400">
          Currently trading
        </div>
      </div>

      {/* Total Open Interest */}
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
        <h3 className="text-sm font-medium text-gray-400 mb-2">Open Interest</h3>
        <div className="text-3xl font-bold text-white mb-1">{formatCurrency(data.totalOpenInterest)}</div>
        <div className="text-sm text-orange-400">
          Market liquidity
        </div>
      </div>

      {/* Total Predictions */}
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
        <h3 className="text-sm font-medium text-gray-400 mb-2">Total Predictions</h3>
        <div className="text-3xl font-bold text-white mb-1">{formatNumber(data.totalPredictions)}</div>
        <div className="text-sm text-purple-400">
          {timeFilter === "all" ? "All time" : `Last ${timeFilter.replace('ly', '')}`}
        </div>
      </div>

      {/* Trade Volume */}
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
        <h3 className="text-sm font-medium text-gray-400 mb-2">Trade Volume</h3>
        <div className="text-3xl font-bold text-white mb-1">{formatCurrency(data.totalTradeVolume)}</div>
        <div className="text-sm text-pink-400">
          {timeFilter === "all" ? "All time" : `Last ${timeFilter.replace('ly', '')}`}
        </div>
      </div>
    </div>
  );
});

MetricsCards.displayName = 'MetricsCards';

export default MetricsCards;