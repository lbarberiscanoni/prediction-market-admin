"use client";

import supabase from "@/lib/supabase/createClient";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  return <button onClick={handleLogout} className="px-4 py-2 bg-blue-500 rounded-md hover:bg-blue-600">Logout</button>;
}
