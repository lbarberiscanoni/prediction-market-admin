// src/components/analytics/UserStatistics.tsx
"use client";

import React, { memo } from 'react';

interface UserStatsData {
  totalUsers: number;
  activeTraders: number;
  traderRatio: number; // percentage of users who are active traders
}

interface UserStatsData {
  totalUsers: number;
  activeTraders: number;
  traderRatio: number; // percentage of users who are active traders
}

interface UserStatisticsProps {
  data: UserStatsData;
  loading?: boolean;
}

const UserStatistics = memo(({ data, loading = false }: UserStatisticsProps) => {
  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('en-US').format(value);
  };

  const formatPercentage = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  // Provide default values if data is undefined
  const safeData = data || {
    totalUsers: 0,
    activeTraders: 0,
    traderRatio: 0
  };

  const LoadingCard = ({ title }: { title: string }) => (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <h4 className="text-sm font-medium text-gray-400 mb-2">{title}</h4>
      <div className="animate-pulse">
        <div className="h-8 bg-gray-700 rounded w-2/3 mb-2"></div>
        <div className="h-4 bg-gray-700 rounded w-1/2"></div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 mb-8">
        <h3 className="text-xl font-semibold text-white mb-6">User Statistics</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <LoadingCard title="Total Users" />
          <LoadingCard title="Active Traders" />
          <LoadingCard title="Trader Ratio" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 mb-8">
      {/* Header */}
      <div className="mb-6">
        <h3 className="text-xl font-semibold text-white">User Statistics</h3>
        <p className="text-gray-400 text-sm mt-1">Platform user engagement and activity metrics</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Total Users Card */}
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-gray-400">Total Users</h4>
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            </div>
          </div>
          <div className="text-3xl font-bold text-white mb-2">
            {formatNumber(safeData.totalUsers)}
          </div>
          <div className="text-sm text-blue-400">
            Registered accounts
          </div>
        </div>

        {/* Active Traders Card */}
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-gray-400">Active Traders</h4>
            <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
          </div>
          <div className="text-3xl font-bold text-white mb-2">
            {formatNumber(safeData.activeTraders)}
          </div>
          <div className="text-sm text-green-400">
            Users with trades
          </div>
        </div>

        {/* Trader Ratio Card */}
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-gray-400">Trader Ratio</h4>
            <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
          </div>
          <div className="text-3xl font-bold text-white mb-2">
            {formatPercentage(safeData.traderRatio)}
          </div>
          <div className="text-sm text-purple-400">
            User engagement rate
          </div>
        </div>
      </div>

      {/* Additional Insights */}
      <div className="mt-6 pt-4 border-t border-gray-700">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-400">
          <div className="flex justify-between">
            <span>Active Traders:</span>
            <span className="text-green-400 font-medium">
              {formatNumber(safeData.activeTraders)} of {formatNumber(safeData.totalUsers)} users
            </span>
          </div>
          <div className="flex justify-between">
            <span>Non-traders:</span>
            <span className="text-gray-300 font-medium">
              {formatNumber(safeData.totalUsers - safeData.activeTraders)} users ({formatPercentage(100 - safeData.traderRatio)})
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});

UserStatistics.displayName = 'UserStatistics';

export default UserStatistics;