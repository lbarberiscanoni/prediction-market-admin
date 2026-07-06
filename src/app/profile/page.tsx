"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { User } from "@supabase/supabase-js";
import supabase from "@/lib/supabase/createClient";
import Onboarding from "@/components/Onboarding";

interface Profile {
  id: number;
  user_id: string | null;
  username: string | null;
  email: string | null;
  payment_method: string | null;
  payment_id: string | null;
  balance: number | null;
  is_admin?: boolean;
  created_at?: string | null;
}

interface Prediction {
  id: number;
  market_id: number;
  outcome_id: number;
  shares_amt: number | null;
  trade_value: number | null;
  trade_type: "buy" | "sell" | null;
  market_odds: number | null;
  created_at: string;
}

interface MarketSummary {
  id: number;
  name: string;
  status?: string | null;
}

interface OutcomeSummary {
  id: number;
  name: string;
}

interface Payment {
  id: number;
  amount: number;
  payment_method: string | null;
  status: string | null;
  transaction_id: string | null;
  created_at: string;
}

interface Holding {
  key: string;
  marketId: number;
  marketName: string;
  outcomeName: string;
  shares: number;
  netTradeValue: number;
}

const formatCurrency = (value: number | null | undefined) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "Not available";

export default function UserProfile() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [markets, setMarkets] = useState<Record<number, MarketSummary>>({});
  const [outcomes, setOutcomes] = useState<Record<number, OutcomeSummary>>({});
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProfileData = async () => {
      setLoading(true);
      setError(null);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        setError(userError.message);
        setLoading(false);
        return;
      }

      setUser(user);

      if (!user) {
        setLoading(false);
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("id, user_id, username, email, payment_method, payment_id, balance, is_admin, created_at")
        .eq("user_id", user.id)
        .maybeSingle();

      if (profileError) {
        setError(profileError.message);
        setLoading(false);
        return;
      }

      setProfile((profileData as Profile | null) ?? null);

      const { data: predictionData, error: predictionsError } = await supabase
        .from("predictions")
        .select("id, market_id, outcome_id, shares_amt, trade_value, trade_type, market_odds, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (predictionsError) {
        setError(predictionsError.message);
        setLoading(false);
        return;
      }

      const userPredictions = (predictionData ?? []) as Prediction[];
      setPredictions(userPredictions);

      const marketIds = [...new Set(userPredictions.map((prediction) => prediction.market_id))];
      const outcomeIds = [...new Set(userPredictions.map((prediction) => prediction.outcome_id))];

      if (marketIds.length > 0) {
        const { data: marketData } = await supabase
          .from("markets")
          .select("id, name, status")
          .in("id", marketIds);
        setMarkets(
          Object.fromEntries(
            ((marketData ?? []) as MarketSummary[]).map((market) => [market.id, market])
          )
        );
      }

      if (outcomeIds.length > 0) {
        const { data: outcomeData } = await supabase
          .from("outcomes")
          .select("id, name")
          .in("id", outcomeIds);
        setOutcomes(
          Object.fromEntries(
            ((outcomeData ?? []) as OutcomeSummary[]).map((outcome) => [outcome.id, outcome])
          )
        );
      }

      if (profileData?.id) {
        const { data: paymentData } = await supabase
          .from("payments")
          .select("id, amount, payment_method, status, transaction_id, created_at")
          .eq("player_id", profileData.id)
          .order("created_at", { ascending: false })
          .limit(10);
        setPayments((paymentData ?? []) as Payment[]);
      }

      setLoading(false);
    };

    fetchProfileData();
  }, []);

  const holdings = useMemo<Holding[]>(() => {
    const byOutcome = new Map<string, Holding>();

    predictions.forEach((prediction) => {
      const key = `${prediction.market_id}:${prediction.outcome_id}`;
      const existing = byOutcome.get(key) ?? {
        key,
        marketId: prediction.market_id,
        marketName: markets[prediction.market_id]?.name ?? `Market ${prediction.market_id}`,
        outcomeName: outcomes[prediction.outcome_id]?.name ?? `Outcome ${prediction.outcome_id}`,
        shares: 0,
        netTradeValue: 0,
      };

      const shares = Number(prediction.shares_amt ?? 0);
      const tradeValue = Number(prediction.trade_value ?? 0);

      existing.shares += prediction.trade_type === "sell" ? -shares : shares;
      existing.netTradeValue += tradeValue;
      byOutcome.set(key, existing);
    });

    return Array.from(byOutcome.values())
      .filter((holding) => Math.abs(holding.shares) > 0.0001)
      .sort((a, b) => Math.abs(b.shares) - Math.abs(a.shares));
  }, [markets, outcomes, predictions]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black p-6 text-white">
        <p>Loading your profile...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-black p-6 text-white">
        <div className="mx-auto max-w-xl rounded-lg border border-gray-700 bg-gray-900 p-6">
          <h1 className="text-2xl font-bold">Sign in required</h1>
          <p className="mt-2 text-gray-300">Log in to view your balance, holdings, and payout details.</p>
          <Link
            href="/auth"
            className="mt-4 inline-flex rounded-lg bg-blue-600 px-4 py-2 font-semibold hover:bg-blue-700"
          >
            Go to login
          </Link>
        </div>
      </div>
    );
  }

  if (!profile) {
    return <Onboarding />;
  }

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-300">Profile</p>
            <h1 className="text-3xl font-bold">{profile.username || user.email || "Your account"}</h1>
            <p className="mt-2 text-gray-300">{profile.email || user.email}</p>
          </div>
          {profile.is_admin && (
            <Link
              href="/admin"
              className="inline-flex items-center justify-center rounded-lg bg-purple-600 px-4 py-2 font-semibold hover:bg-purple-700"
            >
              Open admin console
            </Link>
          )}
        </header>

        {error && (
          <div className="rounded-lg border border-red-700 bg-red-950/50 p-4 text-red-200">
            {error}
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-gray-700 bg-gray-900 p-5">
            <p className="text-sm text-gray-400">Balance</p>
            <p className="mt-2 text-3xl font-bold">{formatCurrency(profile.balance)}</p>
          </div>
          <div className="rounded-lg border border-gray-700 bg-gray-900 p-5">
            <p className="text-sm text-gray-400">Payment method</p>
            <p className="mt-2 text-xl font-semibold">{profile.payment_method || "Not set"}</p>
            <p className="mt-1 break-all text-sm text-gray-300">{profile.payment_id || "Add payment info during onboarding."}</p>
          </div>
          <div className="rounded-lg border border-gray-700 bg-gray-900 p-5">
            <p className="text-sm text-gray-400">Player ID</p>
            <p className="mt-2 font-mono text-lg">{profile.id}</p>
            <p className="mt-1 text-sm text-gray-300">Joined {formatDate(profile.created_at)}</p>
          </div>
        </section>

        <section className="rounded-lg border border-gray-700 bg-gray-900 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Holdings</h2>
              <p className="text-sm text-gray-400">Open share positions based on your buy and sell history.</p>
            </div>
            <span className="rounded-full bg-gray-800 px-3 py-1 text-sm text-gray-300">
              {holdings.length} position{holdings.length === 1 ? "" : "s"}
            </span>
          </div>

          {holdings.length === 0 ? (
            <p className="mt-4 rounded-lg bg-gray-800 p-4 text-gray-300">No current holdings yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-gray-400">
                  <tr className="border-b border-gray-800">
                    <th className="py-3 pr-4">Market</th>
                    <th className="py-3 pr-4">Outcome</th>
                    <th className="py-3 pr-4">Shares</th>
                    <th className="py-3 pr-4">Net cash flow</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((holding) => (
                    <tr key={holding.key} className="border-b border-gray-800">
                      <td className="py-3 pr-4">
                        <Link href={`/markets/${holding.marketId}`} className="text-blue-300 hover:underline">
                          {holding.marketName}
                        </Link>
                      </td>
                      <td className="py-3 pr-4">{holding.outcomeName}</td>
                      <td className="py-3 pr-4">{holding.shares.toFixed(2)}</td>
                      <td className="py-3 pr-4">{formatCurrency(holding.netTradeValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-gray-700 bg-gray-900 p-5">
            <h2 className="text-xl font-semibold">Recent trades</h2>
            {predictions.length === 0 ? (
              <p className="mt-4 rounded-lg bg-gray-800 p-4 text-gray-300">No trades yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {predictions.slice(0, 8).map((prediction) => (
                  <div key={prediction.id} className="rounded-lg bg-gray-800 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">
                          {prediction.trade_type === "sell" ? "Sold" : "Bought"}{" "}
                          {outcomes[prediction.outcome_id]?.name ?? `Outcome ${prediction.outcome_id}`}
                        </p>
                        <p className="text-sm text-gray-400">
                          {markets[prediction.market_id]?.name ?? `Market ${prediction.market_id}`}
                        </p>
                      </div>
                      <p className="whitespace-nowrap text-sm font-semibold">
                        {formatCurrency(prediction.trade_value)}
                      </p>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">{formatDate(prediction.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-700 bg-gray-900 p-5">
            <h2 className="text-xl font-semibold">Recent payouts</h2>
            {payments.length === 0 ? (
              <p className="mt-4 rounded-lg bg-gray-800 p-4 text-gray-300">No payouts recorded yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {payments.map((payment) => (
                  <div key={payment.id} className="rounded-lg bg-gray-800 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{formatCurrency(payment.amount)}</p>
                        <p className="text-sm text-gray-400">{payment.payment_method || "Payment"}</p>
                      </div>
                      <span className="rounded-full bg-gray-700 px-3 py-1 text-xs font-semibold">
                        {payment.status || "Pending"}
                      </span>
                    </div>
                    <p className="mt-2 break-all text-xs text-gray-500">
                      {payment.transaction_id || "No transaction id yet"} · {formatDate(payment.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
