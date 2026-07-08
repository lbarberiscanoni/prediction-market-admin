"use client"

import { useEffect, useState } from "react";
import supabase from "@/lib/supabase/createClient";
import LogoutButton from "./logout-button";
import MigrationBanner from "./MigrationBanner";
import Link from "next/link";
import { User } from "@supabase/supabase-js";

export default function Navbar() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      
      // Check if user is an admin - you might want to adapt this to your own logic
      // For example, you might have an "admins" table or a role field in profiles
      if (user) {
        const { data } = await supabase
          .from("profiles")
          .select("is_admin")
          .eq("user_id", user.id)
          .single();
        
        setIsAdmin(data?.is_admin === true);
      }
    };

    fetchUser();
  }, []);

  return (
    <>
    <MigrationBanner />
    <nav className="flex w-full justify-between items-center p-4 bg-transparent text-white">
      <h1 className="text-lg font-bold">Prediction Market</h1>
      <div className="flex space-x-4">
        {user && (
          <>
            <Link href="/profile" className="px-4 py-2 bg-blue-500 rounded-md hover:bg-blue-600">Profile</Link>
            <Link href="/leaderboard" className="px-4 py-2 bg-blue-500 rounded-md hover:bg-blue-600">Leaderboard</Link>
          </>
        )}
        
        {user && isAdmin && (
          <>
            <Link href="/admin" className="px-4 py-2 bg-purple-600 rounded-md hover:bg-purple-700">Admin</Link>
            <Link href="/payments" className="px-4 py-2 bg-green-600 rounded-md hover:bg-green-700">Payments</Link>
          </>
        )}
        
        {user ? (
          <LogoutButton />
        ) : (
          <Link href="/auth" className="px-4 py-2 bg-blue-500 rounded-md hover:bg-blue-600">Log In</Link>
        )}
      </div>
    </nav>
    </>
  );
}
