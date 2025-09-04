// src/components/analytics/UserGrowthChart.tsx
"use client";

import React, { memo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface UserGrowthData {
  date: string;
  new_users: number;
  cumulative_users: number;
}

interface UserGrowthChartProps {
  data: UserGrowthData[];
  timeFilter: "daily" | "weekly" | "monthly" | "all";
  loading?: boolean;
}

const UserGrowthChart = memo(({ data, timeFilter, loading = false }: UserGrowthChartProps) => {
  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('en-US').format(value);
  };

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
        <h3 className="text-lg font-semibold mb-4">User Growth</h3>
        <div className="h-64 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
      <h3 className="text-lg font-semibold mb-4">User Growth</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
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
  );
});

UserGrowthChart.displayName = 'UserGrowthChart';

export default UserGrowthChart;