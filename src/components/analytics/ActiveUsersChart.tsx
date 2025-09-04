// src/components/analytics/ActiveUsersChart.tsx
"use client";

import React, { memo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface ActiveUsersData {
  date: string;
  active_users: number;
  cumulative_users: number;
}

interface ActiveUsersChartProps {
  data: ActiveUsersData[];
  timeFilter: "daily" | "weekly" | "monthly" | "all";
  loading?: boolean;
  debugMode?: boolean;
}

const ActiveUsersChart = memo(({ data, timeFilter, loading = false, debugMode = false }: ActiveUsersChartProps) => {
  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('en-US').format(value);
  };

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 mb-8">
        <h3 className="text-lg font-semibold mb-4">Active Users Over Time</h3>
        <div className="h-80 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 mb-8">
      <h3 className="text-lg font-semibold mb-4">Active Users Over Time</h3>
      
      {debugMode && (
        <div className="mb-4 text-sm text-yellow-400 bg-yellow-900/20 p-2 rounded">
          Data points: {data.length} | 
          Max active users: {Math.max(...data.map(d => d.active_users), 0)} |
          Total cumulative: {Math.max(...data.map(d => d.cumulative_users), 0)}
        </div>
      )}

      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
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
  );
});

ActiveUsersChart.displayName = 'ActiveUsersChart';

export default ActiveUsersChart;