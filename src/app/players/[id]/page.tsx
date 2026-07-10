"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import supabase from "@/lib/supabase/createClient";
import Link from "next/link";

interface Profile {
  id: string;
  user_id?: string;
  username?: string;
  payment_method?: string;
  payment_id?: string | null;
  balance?: number;
  created_at?: string;
  is_admin?: boolean;
}

interface PredictionRow {
  id: number;
  created_at?: string;
  marketName: string;
  outcomeName: string;
  tradeType?: string;
  sharesAmt?: number;
  tradeValue?: number;
}

export default function PlayerDetailsPage() {
  const { id } = useParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [predictions, setPredictions] = useState<PredictionRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPlayerData = async () => {
      setLoading(true);
      setError(null);

      try {
        // The id param may be a numeric profiles.id (from the players list /
        // payments table) or an auth user_id UUID (from the leaderboard).
        // Resolve against whichever column matches.
        const lookupColumn = /^\d+$/.test(String(id)) ? "id" : "user_id";
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("*")
          .eq(lookupColumn, id)
          .single();

        if (profileError) {
          console.error("Profile error:", profileError.message);
          throw new Error(profileError.message || "Failed to fetch profile");
        }
        
        setProfile(profileData);

        // Load this player's trade history, keyed by their auth user_id.
        // Failures here shouldn't hide the profile, so they're handled locally.
        try {
          const userId = profileData.user_id;
          if (userId) {
            const { data: preds, error: predsError } = await supabase
              .from("predictions")
              .select("id, market_id, outcome_id, trade_type, shares_amt, trade_value, created_at")
              .eq("user_id", userId)
              .order("created_at", { ascending: false });

            if (predsError) throw predsError;

            if (preds && preds.length > 0) {
              const marketIds = [...new Set(preds.map((p) => p.market_id))];
              const outcomeIds = [...new Set(preds.map((p) => p.outcome_id))];

              const [{ data: markets }, { data: outcomes }] = await Promise.all([
                supabase.from("markets").select("id, name").in("id", marketIds),
                supabase.from("outcomes").select("id, name").in("id", outcomeIds),
              ]);

              const marketMap = new Map((markets ?? []).map((m) => [m.id, m.name]));
              const outcomeMap = new Map((outcomes ?? []).map((o) => [o.id, o.name]));

              setPredictions(
                preds.map((p) => ({
                  id: p.id,
                  created_at: p.created_at,
                  marketName: marketMap.get(p.market_id) ?? `Market #${p.market_id}`,
                  outcomeName: outcomeMap.get(p.outcome_id) ?? `Outcome #${p.outcome_id}`,
                  tradeType: p.trade_type,
                  sharesAmt: p.shares_amt,
                  tradeValue: p.trade_value,
                }))
              );
            } else {
              setPredictions([]);
            }
          }
        } catch (predErr) {
          console.error(
            "Error fetching prediction history:",
            predErr instanceof Error ? predErr.message : "Unknown error"
          );
          setPredictions([]);
        }

      } catch (err) {
        // Properly handle and log the error
        console.error("Error fetching player data:", err instanceof Error ? err.message : 'Unknown error');
        setError("Failed to load player data. Please try again later.");
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchPlayerData();
    }
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="container mx-auto p-4">
          <div className="flex justify-center items-center py-8">
            <p className="text-xl">Loading player data...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="container mx-auto p-4">
          <div className="bg-red-900 p-4 rounded">
            <p className="text-white">{error || "Player not found"}</p>
            <Link href="/players" className="text-blue-300 hover:underline mt-2 inline-block">
              ← Back to players list
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="container mx-auto p-4">
        <div className="mb-4">
          <Link href="/players" className="text-blue-400 hover:underline flex items-center">
            ← Back to players list
          </Link>
        </div>

        <div className="bg-gray-900 rounded-lg shadow-lg p-6 mb-6">
          <h1 className="text-2xl font-bold mb-6 border-b border-gray-700 pb-4">
            Player Profile: {profile.username || "Anonymous"}
          </h1>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h2 className="text-xl font-semibold mb-4">Basic Information</h2>
              <div className="space-y-3">
                <p className="flex justify-between">
                  <span className="text-gray-400">Username:</span>
                  <span>{profile.username || "Not set"}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-gray-400">User ID:</span>
                  <span className="font-mono text-sm">{profile.id}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-gray-400">Account Balance:</span>
                  <span>{typeof profile.balance === 'number' ? profile.balance.toFixed(2) : 'N/A'}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-gray-400">Account Created:</span>
                  <span>
                    {profile.created_at 
                      ? new Date(profile.created_at).toLocaleDateString() 
                      : "N/A"}
                  </span>
                </p>
                <p className="flex justify-between">
                  <span className="text-gray-400">Account Type:</span>
                  <span>{profile.is_admin ? "Administrator" : "Standard User"}</span>
                </p>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">Payment Information</h2>
              <div className="space-y-3">
                <p className="flex justify-between">
                  <span className="text-gray-400">Payment Method:</span>
                  <span>{profile.payment_method || "Not set"}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-gray-400">
                    {profile.payment_method === "MTurk" ? "MTurk ID:" : "PayPal Email:"}
                  </span>
                  <span>{profile.payment_id || "Not provided"}</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gray-900 rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold mb-4 border-b border-gray-700 pb-4">
            Prediction History
            {predictions.length > 0 && (
              <span className="ml-2 text-sm font-normal text-gray-400">
                ({predictions.length})
              </span>
            )}
          </h2>

          {predictions.length === 0 ? (
            <p className="text-center py-4 text-gray-400">No predictions yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-700 text-sm">
                <thead>
                  <tr className="text-left text-gray-400">
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Market</th>
                    <th className="px-4 py-2 font-medium">Outcome</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 font-medium text-right">Shares</th>
                    <th className="px-4 py-2 font-medium text-right">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {predictions.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2 whitespace-nowrap text-gray-300">
                        {p.created_at
                          ? new Date(p.created_at).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="px-4 py-2">{p.marketName}</td>
                      <td className="px-4 py-2">{p.outcomeName}</td>
                      <td className="px-4 py-2 capitalize">{p.tradeType || "—"}</td>
                      <td className="px-4 py-2 text-right">
                        {typeof p.sharesAmt === "number"
                          ? p.sharesAmt.toFixed(2)
                          : "—"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {typeof p.tradeValue === "number"
                          ? `$${p.tradeValue.toFixed(2)}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
