// src/components/analytics/CalibrationChart.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import supabase from "@/lib/supabase/createClient";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

// A Manifold-style calibration chart (https://manifold.markets/calibration).
//
// For every trade in a *resolved binary (YES/NO)* market we recover the YES
// probability the market sat at when the trade happened, and whether the
// market ultimately resolved YES. Trades are grouped into probability buckets;
// for each bucket we plot the mean predicted probability (x) against the actual
// share that resolved YES (y). A perfectly calibrated market falls on the y = x
// diagonal: when the crowd says 70%, YES happens 70% of the time.

interface Outcome {
  id: number;
  name: string;
  market_id: number;
}

interface Market {
  id: number;
  status: string | null;
  outcome_id: number | null;
}

interface Prediction {
  market_id: number;
  outcome_id: number;
  market_odds: number;
  trade_value: number;
}

interface BucketPoint {
  x: number; // mean predicted YES probability (%)
  y: number; // actual YES resolution rate (%)
  n: number; // number of trades in the bucket
  weight: number; // total weight in the bucket
  bucketLabel: string;
}

// Bucket boundaries (as YES probabilities). 10 equal-width buckets 0-100%.
const BUCKET_COUNT = 10;

// Supabase caps a single select at 1000 rows, so page through the whole table.
const PAGE_SIZE = 1000;

async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data as T[]) || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

type Weighting = "bet" | "trade";

export default function CalibrationChart() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weighting, setWeighting] = useState<Weighting>("bet");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [marketsData, outcomesData, predictionsData] = await Promise.all([
          fetchAll<Market>("markets", "id, status, outcome_id"),
          fetchAll<Outcome>("outcomes", "id, name, market_id"),
          fetchAll<Prediction>(
            "predictions",
            "market_id, outcome_id, market_odds, trade_value"
          ),
        ]);

        setMarkets(marketsData);
        setOutcomes(outcomesData);
        setPredictions(predictionsData);
      } catch (err) {
        console.error("Error loading calibration data:", err);
        setError(
          err instanceof Error ? err.message : "Failed to load calibration data"
        );
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const { points, resolvedMarketCount, tradeCount, brier } = useMemo(() => {
    // Map market_id -> its YES / NO outcome ids.
    const yesByMarket = new Map<number, number>();
    const noByMarket = new Map<number, number>();
    for (const o of outcomes) {
      const name = o.name?.toUpperCase();
      if (name === "YES") yesByMarket.set(o.market_id, o.id);
      else if (name === "NO") noByMarket.set(o.market_id, o.id);
    }

    // Keep only resolved binary markets: has YES + NO outcomes, a winning
    // outcome that is YES or NO, and not annulled/void.
    const resolvedYesByMarket = new Map<number, boolean>();
    for (const m of markets) {
      if (m.status === "annulled" || m.outcome_id == null) continue;
      const yesId = yesByMarket.get(m.id);
      const noId = noByMarket.get(m.id);
      if (yesId == null || noId == null) continue;
      if (m.outcome_id === yesId) resolvedYesByMarket.set(m.id, true);
      else if (m.outcome_id === noId) resolvedYesByMarket.set(m.id, false);
    }

    const buckets = Array.from({ length: BUCKET_COUNT }, () => ({
      wSum: 0,
      wProbSum: 0,
      wYesSum: 0,
      n: 0,
    }));

    let usedTrades = 0;
    let brierNum = 0;
    let brierDen = 0;

    for (const p of predictions) {
      const resolvedYes = resolvedYesByMarket.get(p.market_id);
      if (resolvedYes === undefined) continue; // not a resolved binary market

      const yesId = yesByMarket.get(p.market_id);
      const noId = noByMarket.get(p.market_id);
      // Recover the YES probability at trade time from the traded outcome.
      let yesProb: number;
      if (p.outcome_id === yesId) yesProb = p.market_odds;
      else if (p.outcome_id === noId) yesProb = 1 - p.market_odds;
      else continue; // trade on some other outcome — skip

      if (!Number.isFinite(yesProb)) continue;
      yesProb = Math.min(1, Math.max(0, yesProb));

      const weight = weighting === "bet" ? Math.abs(p.trade_value || 0) : 1;
      if (weight <= 0) continue;

      const outcomeVal = resolvedYes ? 1 : 0;
      const idx = Math.min(BUCKET_COUNT - 1, Math.floor(yesProb * BUCKET_COUNT));
      const b = buckets[idx];
      b.wSum += weight;
      b.wProbSum += weight * yesProb;
      b.wYesSum += weight * outcomeVal;
      b.n += 1;

      brierNum += weight * (yesProb - outcomeVal) ** 2;
      brierDen += weight;
      usedTrades += 1;
    }

    const pts: BucketPoint[] = buckets
      .map((b, i) => {
        if (b.wSum <= 0) return null;
        const lo = (i / BUCKET_COUNT) * 100;
        const hi = ((i + 1) / BUCKET_COUNT) * 100;
        return {
          x: (b.wProbSum / b.wSum) * 100,
          y: (b.wYesSum / b.wSum) * 100,
          n: b.n,
          weight: b.wSum,
          bucketLabel: `${lo.toFixed(0)}–${hi.toFixed(0)}%`,
        };
      })
      .filter((p): p is BucketPoint => p !== null);

    return {
      points: pts,
      resolvedMarketCount: resolvedYesByMarket.size,
      tradeCount: usedTrades,
      brier: brierDen > 0 ? brierNum / brierDen : null,
    };
  }, [markets, outcomes, predictions, weighting]);

  interface TooltipProps {
    active?: boolean;
    payload?: Array<{ payload: BucketPoint }>;
  }
  const CustomTooltip = ({ active, payload }: TooltipProps) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      return (
        <div className="p-3 bg-gray-800 border border-gray-700 rounded shadow-lg text-sm">
          <p className="text-gray-300 mb-1">Bucket {d.bucketLabel}</p>
          <p className="text-white font-semibold">Predicted YES: {d.x.toFixed(1)}%</p>
          <p className="text-white font-semibold">Actual YES: {d.y.toFixed(1)}%</p>
          <p className="text-gray-400 mt-1">{d.n.toLocaleString()} trades</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-gray-900 rounded-lg p-6 border border-gray-800 mb-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-2">
        <div>
          <h3 className="text-xl font-semibold text-white">Calibration</h3>
          <p className="text-gray-400 text-sm mt-1">
            Predicted probability vs. actual YES-resolution rate across resolved
            binary markets. Points on the dashed diagonal are perfectly calibrated.
          </p>
        </div>
        <div className="flex rounded-lg bg-gray-800 p-1 self-start">
          {(["bet", "trade"] as Weighting[]).map((w) => (
            <button
              key={w}
              onClick={() => setWeighting(w)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                weighting === w
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {w === "bet" ? "Weight by bet size" : "Weight per trade"}
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 my-4">
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <h4 className="text-gray-400 text-sm mb-1">Resolved markets</h4>
          <div className="text-2xl font-bold text-blue-400">
            {resolvedMarketCount.toLocaleString()}
          </div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <h4 className="text-gray-400 text-sm mb-1">Trades scored</h4>
          <div className="text-2xl font-bold text-green-400">
            {tradeCount.toLocaleString()}
          </div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <h4 className="text-gray-400 text-sm mb-1">Brier score</h4>
          <div className="text-2xl font-bold text-purple-400">
            {brier == null ? "—" : brier.toFixed(4)}
          </div>
          <p className="text-gray-500 text-xs mt-1">Lower is better (0 = perfect)</p>
        </div>
      </div>

      {loading ? (
        <div className="h-96 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      ) : error ? (
        <div className="h-96 flex items-center justify-center">
          <p className="text-red-400">Error: {error}</p>
        </div>
      ) : points.length === 0 ? (
        <div className="h-96 flex items-center justify-center text-gray-400 text-center">
          No resolved binary markets with trades yet. The calibration chart will
          populate as YES/NO markets resolve.
        </div>
      ) : (
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                type="number"
                dataKey="x"
                name="Predicted"
                domain={[0, 100]}
                ticks={[0, 20, 40, 60, 80, 100]}
                tickFormatter={(v) => `${v}%`}
                stroke="#9CA3AF"
                label={{
                  value: "Predicted probability",
                  position: "insideBottom",
                  offset: -10,
                  fill: "#9CA3AF",
                }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="Actual"
                domain={[0, 100]}
                ticks={[0, 20, 40, 60, 80, 100]}
                tickFormatter={(v) => `${v}%`}
                stroke="#9CA3AF"
                label={{
                  value: "Actual YES rate",
                  angle: -90,
                  position: "insideLeft",
                  offset: 10,
                  fill: "#9CA3AF",
                }}
              />
              <ZAxis type="number" dataKey="weight" range={[60, 400]} />
              <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: "3 3" }} />
              {/* Perfect-calibration diagonal */}
              <ReferenceLine
                segment={[
                  { x: 0, y: 0 },
                  { x: 100, y: 100 },
                ]}
                stroke="#6B7280"
                strokeDasharray="4 4"
              />
              <Scatter data={points} fill="#3B82F6" line={{ stroke: "#3B82F6" }} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
