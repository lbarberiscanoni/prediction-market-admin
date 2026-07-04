"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import supabase from "@/lib/supabase/createClient";
import Navbar from "@/components/navbar";
import Link from "next/link";

interface Profile {
  id: string;
  username?: string;
  payment_method?: string;
  payment_id?: string | null;
  balance?: number;
  created_at?: string;
  is_admin?: boolean;
}

export default function PlayerDetailsPage() {
  const { id } = useParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPlayerData = async () => {
      setLoading(true);
      setError(null);

      try {
        // Fetch player profile
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", id)
          .single();

        if (profileError) {
          console.error("Profile error:", profileError.message);
          throw new Error(profileError.message || "Failed to fetch profile");
        }
        
        setProfile(profileData);
        
        // We'll implement predictions fetching in a separate component later

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
        <Navbar />
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
        <Navbar />
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
      <Navbar />
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
          </h2>
          
          {/* Placeholder for future prediction component */}
          <p className="text-center py-4">Prediction history placeholder</p>
        </div>
      </div>
    </div>
  );
}