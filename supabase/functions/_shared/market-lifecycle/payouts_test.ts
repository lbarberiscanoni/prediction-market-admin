// Unit tests for the pure payout math shared by resolve-market / annul-market.
// No DB, no network — run with `deno task test`.
//
// These encode the CURRENT behavior of the two edge functions so the extraction
// is a faithful refactor:
//   * resolution pays net shares on the WINNING outcome at $1.00/share
//   * annulment refunds net shares across ALL outcomes at $0.50/share
//   * only strictly-positive net balances are paid

import { assertEquals } from "jsr:@std/assert@1";
import {
  ANNUL_SHARE_VALUE,
  computeAnnulmentPayouts,
  computeResolutionPayouts,
  RESOLVE_SHARE_VALUE,
  type Prediction,
} from "./payouts.ts";

const p = (
  user_id: string,
  outcome_id: number,
  trade_type: "buy" | "sell",
  shares_amt: number | null,
): Prediction => ({ user_id, outcome_id, trade_type, shares_amt, trade_value: 0 });

const WIN = 1; // winning outcome id
const LOSE = 2; // losing outcome id
const MKT = 42;

// ── resolution ──────────────────────────────────────────────────────────────

Deno.test("resolve: a single buy on the winning outcome pays $1/share", () => {
  const r = computeResolutionPayouts([p("u1", WIN, "buy", 100)], WIN, MKT);
  assertEquals(r.payouts, [{ user_id: "u1", market_id: MKT, outcome_id: WIN, payout_amount: 100 }]);
  assertEquals(r.totalCount, 1);
  assertEquals(r.totalAmount, 100);
});

Deno.test("resolve: sells net against buys on the winning outcome", () => {
  const r = computeResolutionPayouts(
    [p("u1", WIN, "buy", 100), p("u1", WIN, "sell", 30)],
    WIN,
    MKT,
  );
  assertEquals(r.payouts[0].payout_amount, 70);
});

Deno.test("resolve: net zero or negative balances are not paid", () => {
  const r = computeResolutionPayouts(
    [p("u1", WIN, "buy", 40), p("u1", WIN, "sell", 40), p("u2", WIN, "sell", 10)],
    WIN,
    MKT,
  );
  assertEquals(r.payouts, []);
  assertEquals(r.totalCount, 0);
  assertEquals(r.totalAmount, 0);
});

Deno.test("resolve: shares on losing outcomes are ignored", () => {
  const r = computeResolutionPayouts(
    [p("u1", WIN, "buy", 50), p("u1", LOSE, "buy", 999)],
    WIN,
    MKT,
  );
  assertEquals(r.payouts, [{ user_id: "u1", market_id: MKT, outcome_id: WIN, payout_amount: 50 }]);
});

Deno.test("resolve: multiple users are settled independently", () => {
  const r = computeResolutionPayouts(
    [p("u1", WIN, "buy", 10), p("u2", WIN, "buy", 25), p("u3", LOSE, "buy", 100)],
    WIN,
    MKT,
  );
  assertEquals(r.totalCount, 2);
  assertEquals(r.totalAmount, 35);
  const byUser = Object.fromEntries(r.payouts.map((x) => [x.user_id, x.payout_amount] as const));
  assertEquals(byUser, { u1: 10, u2: 25 });
});

Deno.test("resolve: null shares_amt is treated as zero", () => {
  const r = computeResolutionPayouts(
    [p("u1", WIN, "buy", null), p("u1", WIN, "buy", 5)],
    WIN,
    MKT,
  );
  assertEquals(r.payouts[0].payout_amount, 5);
});

// ── annulment ───────────────────────────────────────────────────────────────

Deno.test("annul: refunds net shares at $0.50/share", () => {
  const r = computeAnnulmentPayouts([p("u1", WIN, "buy", 100)], MKT);
  assertEquals(r.payouts[0].payout_amount, 50);
  assertEquals(r.totalAmount, 50);
});

Deno.test("annul: nets shares across ALL outcomes, not just one", () => {
  const r = computeAnnulmentPayouts(
    [p("u1", WIN, "buy", 80), p("u1", LOSE, "buy", 20)],
    MKT,
  );
  assertEquals(r.payouts[0].payout_amount, 50); // (80 + 20) * 0.5
});

Deno.test("annul: net zero balances are not refunded", () => {
  const r = computeAnnulmentPayouts(
    [p("u1", WIN, "buy", 100), p("u1", WIN, "sell", 100)],
    MKT,
  );
  assertEquals(r.payouts, []);
});

Deno.test("share-value constants match the deployed rates", () => {
  assertEquals(RESOLVE_SHARE_VALUE, 1.0);
  assertEquals(ANNUL_SHARE_VALUE, 0.5);
});
