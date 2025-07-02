// src/components/ActiveUsers.tsx
"use client";

import React, { useEffect, useState } from "react";
import { getActiveUsers, getActiveUserCount, ActiveUser } from "@/lib/getActiveUsers";

interface ActiveUsersProps {
  days?: number;
  showProfileData?: boolean;
  minPredictions?: number;
}

export default function ActiveUsers({ 
  days = 14, 
  showProfileData = true, 
  minPredictions = 1 
}: ActiveUsersProps) {
  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchActiveUsers = async () => {
      setLoading(true);
      setError(null);

      try {
        // Get active users with details
        const users = await getActiveUsers({
          days,
          includeProfileData: showProfileData,
          minPredictions
        });

        // Get total count
        const count = await getActiveUserCount(days);

        setActiveUsers(users);
        setTotalCount(count);
      } catch (err) {
        console.error('Error fetching active users:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch active users');
      } finally {
        setLoading(false);
      }
    };

    fetchActiveUsers();
  }, [days, showProfileData, minPredictions]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <span className="ml-3 text-gray-400">Loading active users...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-700 rounded-lg p-4">
        <p className="text-red-400">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-2">
          Active Users (Last {days} days)
        </h2>
        <div className="text-gray-400 space-y-1">
          <p>Total active users: <span className="text-white font-semibold">{totalCount}</span></p>
          <p>Users with {minPredictions}+ predictions: <span className="text-white font-semibold">{activeUsers.length}</span></p>
        </div>
      </div>

      {activeUsers.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-400">No active users found for the specified criteria.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-3 px-4 text-gray-300 font-medium">User</th>
                {showProfileData && (
                  <>
                    <th className="text-left py-3 px-4 text-gray-300 font-medium">Payment Info</th>
                    <th className="text-left py-3 px-4 text-gray-300 font-medium">Balance</th>
                  </>
                )}
                <th className="text-left py-3 px-4 text-gray-300 font-medium">Predictions</th>
                <th className="text-left py-3 px-4 text-gray-300 font-medium">Total Trade Value</th>
                <th className="text-left py-3 px-4 text-gray-300 font-medium">Last Active</th>
              </tr>
            </thead>
            <tbody>
              {activeUsers.map((user, index) => (
                <tr 
                  key={user.user_id} 
                  className={`border-b border-gray-800 ${
                    index % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800'
                  }`}
                >
                  <td className="py-3 px-4">
                    <div>
                      <div className="text-white font-medium">
                        {user.username || 'Anonymous'}
                      </div>
                      <div className="text-gray-400 text-sm font-mono">
                        {user.user_id.slice(0, 8)}...
                      </div>
                      {user.email && (
                        <div className="text-gray-500 text-xs">
                          {user.email}
                        </div>
                      )}
                    </div>
                  </td>
                  
                  {showProfileData && (
                    <>
                      <td className="py-3 px-4">
                        {user.payment_method ? (
                          <div>
                            <div className="text-white text-sm">
                              {user.payment_method}
                            </div>
                            {user.payment_id && (
                              <div className="text-gray-400 text-xs">
                                {user.payment_id}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-500">Not set</span>
                        )}
                      </td>
                      
                      <td className="py-3 px-4">
                        {user.balance !== undefined ? (
                          <span className="text-white font-medium">
                            {formatCurrency(user.balance)}
                          </span>
                        ) : (
                          <span className="text-gray-500">N/A</span>
                        )}
                      </td>
                    </>
                  )}
                  
                  <td className="py-3 px-4">
                    <span className="text-white font-medium">
                      {user.prediction_count}
                    </span>
                  </td>
                  
                  <td className="py-3 px-4">
                    <span className="text-white font-medium">
                      {formatCurrency(user.total_trade_value)}
                    </span>
                  </td>
                  
                  <td className="py-3 px-4">
                    <div className="text-white text-sm">
                      {formatDate(user.last_prediction_date)}
                    </div>
                    <div className="text-gray-400 text-xs">
                      {new Date(user.last_prediction_date).toLocaleTimeString()}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}