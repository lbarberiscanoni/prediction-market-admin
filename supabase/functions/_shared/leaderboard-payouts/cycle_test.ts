// Unit tests for the pure leaderboard-bonus "cycle plan" logic shared by the
// auto-pay-cycle edge function (and mirrored by CyclePayoutReview.tsx /
// stage-cycle-payout). No DB, no network, no PayPal — give it leaderboard rows
// + profiles, get back exactly who would be paid, how much, and why not.
//
// These encode the CURRENT behavior so the extraction is a faithful refactor:
//   * bonus schedule: rank 1 -> $3.00, 2 -> $1.50, 3 -> $1.00, else -> $0.50
//   * ranking: by explicit `position` when present, else by descending P&L
//   * eligible IFF payment_method === 'PayPal' AND payment_id looks like an email
//   * total counts ELIGIBLE rows only
//   * spend cap: overCap flips when the eligible total exceeds the cap
//
// Run with `deno task test`.

import { assertEquals } from "jsr:@std/assert@1";
import {
  computeCyclePlan,
  DEFAULT_MAX_CYCLE_USD,
  type LeaderboardEntry,
  payoutForRank,
  type ProfileInfo,
} from "./cycle.ts";

const paypal = (user_id: string, email: string, id = 0): ProfileInfo => ({
  id,
  user_id,
  username: user_id,
  payment_id: email,
  payment_method: "PayPal",
});

// ── bonus schedule ────────────────────────────────────────────────────────────

Deno.test("payoutForRank: placement schedule then flat base", () => {
  assertEquals(payoutForRank(1), 3.0);
  assertEquals(payoutForRank(2), 1.5);
  assertEquals(payoutForRank(3), 1.0);
  assertEquals(payoutForRank(4), 0.5);
  assertEquals(payoutForRank(99), 0.5);
});

// ── ranking ───────────────────────────────────────────────────────────────────

Deno.test("ranks by explicit position when present", () => {
  const entries: LeaderboardEntry[] = [
    { user_id: "b", position: 2, total_profit_loss: 999 },
    { user_id: "a", position: 1, total_profit_loss: 1 },
  ];
  const profiles = [paypal("a", "a@x.com"), paypal("b", "b@x.com")];
  const plan = computeCyclePlan(entries, profiles);
  const byUser = Object.fromEntries(plan.items.map((i) => [i.user_id, i.rank]));
  assertEquals(byUser, { a: 1, b: 2 });
  // rank drives amount: a (rank 1) = $3, b (rank 2) = $1.5
  assertEquals(Object.fromEntries(plan.items.map((i) => [i.user_id, i.amount])), { a: 3.0, b: 1.5 });
});

Deno.test("ranks by descending P&L when no positions given", () => {
  const entries: LeaderboardEntry[] = [
    { user_id: "low", total_profit_loss: 10 },
    { user_id: "high", total_profit_loss: 500 },
    { user_id: "mid", total_profit_loss: 100 },
  ];
  const profiles = [paypal("low", "l@x.com"), paypal("high", "h@x.com"), paypal("mid", "m@x.com")];
  const plan = computeCyclePlan(entries, profiles);
  assertEquals(plan.items.map((i) => i.user_id), ["high", "mid", "low"]);
  assertEquals(plan.items.map((i) => i.rank), [1, 2, 3]);
});

// ── eligibility ───────────────────────────────────────────────────────────────

Deno.test("non-PayPal payment method is skipped with a reason", () => {
  const entries: LeaderboardEntry[] = [{ user_id: "a", position: 1 }];
  const profiles: ProfileInfo[] = [
    { id: 1, user_id: "a", username: "a", payment_id: "a@x.com", payment_method: "MTurk" },
  ];
  const plan = computeCyclePlan(entries, profiles);
  assertEquals(plan.items[0].eligible, false);
  assertEquals(plan.items[0].skip_reason, "payment_method is MTurk, not PayPal");
  assertEquals(plan.eligibleCount, 0);
});

Deno.test("unset payment method reads as 'unset' in the skip reason", () => {
  const entries: LeaderboardEntry[] = [{ user_id: "a", position: 1 }];
  const profiles: ProfileInfo[] = [{ id: 1, user_id: "a", username: "a" }];
  const plan = computeCyclePlan(entries, profiles);
  assertEquals(plan.items[0].skip_reason, "payment_method is unset, not PayPal");
});

Deno.test("PayPal method but non-email payment_id is skipped", () => {
  const entries: LeaderboardEntry[] = [{ user_id: "a", position: 1 }];
  const profiles: ProfileInfo[] = [
    { id: 1, user_id: "a", username: "a", payment_id: "not-an-email", payment_method: "PayPal" },
  ];
  const plan = computeCyclePlan(entries, profiles);
  assertEquals(plan.items[0].eligible, false);
  assertEquals(plan.items[0].skip_reason, "no valid PayPal email");
});

Deno.test("PayPal + email is eligible with the rank amount", () => {
  const entries: LeaderboardEntry[] = [{ user_id: "a", position: 3 }];
  const plan = computeCyclePlan(entries, [paypal("a", "a@x.com", 42)]);
  assertEquals(plan.items[0].eligible, true);
  assertEquals(plan.items[0].skip_reason, null);
  assertEquals(plan.items[0].amount, 1.0);
  assertEquals(plan.items[0].profile_id, 42);
});

// ── totals ────────────────────────────────────────────────────────────────────

Deno.test("total sums ELIGIBLE rows only", () => {
  const entries: LeaderboardEntry[] = [
    { user_id: "a", position: 1 }, // $3.00 PayPal -> counts
    { user_id: "b", position: 2 }, // $1.50 non-PayPal -> excluded
    { user_id: "c", position: 4 }, // $0.50 PayPal -> counts
  ];
  const profiles: ProfileInfo[] = [
    paypal("a", "a@x.com"),
    { id: 2, user_id: "b", username: "b", payment_id: "b@x.com", payment_method: "MTurk" },
    paypal("c", "c@x.com"),
  ];
  const plan = computeCyclePlan(entries, profiles);
  assertEquals(plan.itemCount, 3);
  assertEquals(plan.eligibleCount, 2);
  assertEquals(plan.totalAmount, 3.5); // 3.00 + 0.50, NOT b's 1.50
});

// ── edge cases ────────────────────────────────────────────────────────────────

Deno.test("entries with no user_id are dropped", () => {
  const entries: LeaderboardEntry[] = [
    { user_id: "a", position: 1 },
    { user_id: "", position: 2 },
    { position: 3 },
  ];
  const plan = computeCyclePlan(entries, [paypal("a", "a@x.com")]);
  assertEquals(plan.itemCount, 1);
  assertEquals(plan.items[0].user_id, "a");
});

Deno.test("username falls back profile -> entry -> user_id", () => {
  const entries: LeaderboardEntry[] = [
    { user_id: "u1", username: "entry-name", position: 1 },
    { user_id: "u2", position: 2 },
  ];
  const profiles: ProfileInfo[] = [
    { id: 1, user_id: "u1", username: "profile-name", payment_id: "u1@x.com", payment_method: "PayPal" },
    // u2 has no profile at all
  ];
  const plan = computeCyclePlan(entries, profiles);
  assertEquals(plan.items[0].username, "profile-name"); // profile wins
  assertEquals(plan.items[1].username, "u2"); // no profile, no entry name -> user_id
});

// ── spend cap ─────────────────────────────────────────────────────────────────

Deno.test("overCap is false under the cap, true over it", () => {
  const entries: LeaderboardEntry[] = [{ user_id: "a", position: 1 }]; // $3.00
  const profiles = [paypal("a", "a@x.com")];
  assertEquals(computeCyclePlan(entries, profiles, 100).overCap, false);
  assertEquals(computeCyclePlan(entries, profiles, 1).overCap, true); // 3.00 > 1
});

Deno.test("constants match the deployed rates", () => {
  assertEquals(DEFAULT_MAX_CYCLE_USD, 100);
  assertEquals([payoutForRank(1), payoutForRank(2), payoutForRank(3)], [3.0, 1.5, 1.0]);
});
