"use client";

import { useEffect, useState } from "react";
import { User } from "@supabase/supabase-js";
import supabase from "@/lib/supabase/createClient";
import Link from "next/link";

interface Profile {
  id: string;
  username?: string;
  payment_method?: string;
  payment_id?: string | null;
  balance?: number;
  created_at?: string;
}

export default function PlayersPage() {
  const [user, setUser] = useState<User | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [sortField, setSortField] = useState<string>("username");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    const fetchUserAndProfiles = async () => {
      setLoading(true);
      setError(null);

      try {
        // Get the current user
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        setUser(userData.user);
        console.log(user)

        // Fetch all profiles
        const { data: profilesData, error: profilesError } = await supabase
          .from("profiles")
          .select("*");

        if (profilesError) throw profilesError;
        setProfiles(profilesData || []);
      } catch (err) {
        console.error("Error fetching data:", err);
        setError("Failed to load profiles data. Please try again later.");
      } finally {
        setLoading(false);
      }
    };

    fetchUserAndProfiles();
  }, []);

  // Sort profiles
  const sortProfiles = (a: Profile, b: Profile) => {
    // Get the values from the profile objects
    let fieldA: string | number | boolean | null | undefined = a[sortField as keyof Profile];
    let fieldB: string | number | boolean | null | undefined = b[sortField as keyof Profile];
    
    // Use empty string for null/undefined values
    fieldA = fieldA ?? "";
    fieldB = fieldB ?? "";

    // Convert to strings for comparison if not already strings
    const strA = typeof fieldA === "string" ? fieldA : String(fieldA);
    const strB = typeof fieldB === "string" ? fieldB : String(fieldB);

    if (sortDirection === "asc") {
      return strA.localeCompare(strB);
    } else {
      return strB.localeCompare(strA);
    }
  };

  // Toggle sort direction
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // Filter profiles based on search term
  const filteredProfiles = profiles.filter(
    (profile) =>
      (profile.username?.toLowerCase() || "").includes(searchTerm.toLowerCase()) ||
      (profile.id?.toLowerCase() || "").includes(searchTerm.toLowerCase()) ||
      (profile.payment_method?.toLowerCase() || "").includes(searchTerm.toLowerCase())
  );

  // Sort the filtered profiles
  const sortedProfiles = [...filteredProfiles].sort(sortProfiles);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="container mx-auto p-4">
        <h1 className="text-2xl font-bold mb-6">Players List</h1>

        {/* Search and filters */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="Search by name or ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full p-2 bg-gray-800 border border-gray-700 rounded text-white"
          />
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-8">
            <p className="text-xl">Loading players...</p>
          </div>
        ) : error ? (
          <div className="bg-red-900 p-4 rounded">
            <p className="text-white">{error}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full bg-gray-900 text-white border border-gray-800 rounded-lg">
              <thead>
                <tr className="bg-gray-800">
                  <th 
                    className="px-4 py-3 cursor-pointer hover:bg-gray-700"
                    onClick={() => handleSort("username")}
                  >
                    Username {sortField === "username" && (sortDirection === "asc" ? "↑" : "↓")}
                  </th>
                  <th 
                    className="px-4 py-3 cursor-pointer hover:bg-gray-700"
                    onClick={() => handleSort("balance")}
                  >
                    Balance {sortField === "balance" && (sortDirection === "asc" ? "↑" : "↓")}
                  </th>
                  <th 
                    className="px-4 py-3 cursor-pointer hover:bg-gray-700"
                    onClick={() => handleSort("payment_method")}
                  >
                    Payment Method {sortField === "payment_method" && (sortDirection === "asc" ? "↑" : "↓")}
                  </th>
                  <th 
                    className="px-4 py-3 cursor-pointer hover:bg-gray-700"
                    onClick={() => handleSort("created_at")}
                  >
                    Joined {sortField === "created_at" && (sortDirection === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedProfiles.map((profile) => (
                  <tr key={profile.id} className="border-t border-gray-800 hover:bg-gray-800">
                    <td className="px-4 py-3">
                      <Link 
                        href={`/players/${profile.id}`}
                        className="text-blue-400 hover:underline"
                      >
                        {profile.username || "N/A"}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {typeof profile.balance === 'number' ? profile.balance.toFixed(2) : 'N/A'}
                    </td>
                    <td className="px-4 py-3">
                      {profile.payment_method || "N/A"}
                      {profile.payment_id && (
                        <span className="ml-2 text-gray-400">({profile.payment_id})</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {profile.created_at 
                        ? new Date(profile.created_at).toLocaleDateString() 
                        : "N/A"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {profile.id}
                    </td>
                    <td className="px-4 py-3">
                      <Link 
                        href={`/players/${profile.id}`}
                        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded-md text-sm"
                      >
                        View Details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            {sortedProfiles.length === 0 && (
              <div className="text-center py-8">
                <p>No players found matching your search criteria.</p>
              </div>
            )}
            
            <div className="mt-4 text-sm text-gray-400">
              Total players: {profiles.length}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
