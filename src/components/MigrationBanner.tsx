"use client";

import { useEffect, useState } from "react";
import supabase from "@/lib/supabase/createClient";
import Link from "next/link";

// Nudge shown to players who are still set up to be paid via MTurk.
// MTurk payouts are being retired, so these users must switch to PayPal
// to keep receiving their bonuses.
export default function MigrationBanner() {
  const [onMTurk, setOnMTurk] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const checkPaymentMethod = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Look up by user_id (the auth UUID). Note profiles.id is a bigint,
      // so the auth user must be matched on user_id, not id.
      const { data, error } = await supabase
        .from("profiles")
        .select("payment_method")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!error && data?.payment_method === "MTurk") {
        setOnMTurk(true);
      }
    };

    checkPaymentMethod();
  }, []);

  if (!onMTurk || dismissed) return null;

  return (
    <div className="w-full bg-amber-500 text-black px-4 py-3 flex items-center justify-between gap-4">
      <p className="text-sm font-medium">
        ⚠️ You&apos;re set up to receive bonuses via MTurk, which is being
        discontinued. Switch to PayPal so you don&apos;t miss future payouts.
      </p>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href="/profile"
          className="px-3 py-1.5 bg-black text-white rounded-md text-sm font-semibold hover:bg-gray-800 whitespace-nowrap"
        >
          Switch to PayPal
        </Link>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="px-2 text-black/70 hover:text-black text-xl leading-none"
        >
          ×
        </button>
      </div>
    </div>
  );
}
