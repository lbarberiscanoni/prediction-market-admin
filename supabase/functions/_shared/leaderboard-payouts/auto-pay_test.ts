// Unit tests for the auto-pay-cycle ORCHESTRATION — the money-moving shell that
// is now the ONLY leaderboard-bonus payout path (the manual CyclePayoutReview UI
// was deleted). I/O (DB, PayPal) is injected as deps, so these tests exercise the
// real control flow with fakes — no DB, no network, no money.
//
// Invariants under test:
//   * auth: service-role key OR x-cron-secret required; anon/none rejected
//   * idempotency: an existing cycle_payout for the leaderboard is left alone
//   * spend cap: over-cap cycles are NOT sent (no claim, no PayPal)
//   * dry run: computes but performs zero writes / zero payouts
//   * empty eligible: records a zero cycle, calls no PayPal
//   * happy path: claim -> pay each eligible -> ledger row each -> mark sent
//   * partial failure: a failed payout is reported, the rest still send
//   * claim conflict: bail with 409, pay nobody
//
// Run with `deno task test`.

import { assertEquals } from "jsr:@std/assert@1";
import {
  type AutoPayDeps,
  isAuthorized,
  runAutoPayCycle,
} from "./auto-pay.ts";
import { type ProfileInfo } from "./cycle.ts";

// ── auth gate ─────────────────────────────────────────────────────────────────

Deno.test("isAuthorized: service-role key as bearer is allowed", () => {
  assertEquals(isAuthorized("SERVICE", "", { serviceKey: "SERVICE", cronSecret: "CRON" }), true);
});

Deno.test("isAuthorized: correct x-cron-secret is allowed", () => {
  assertEquals(isAuthorized("anon-jwt", "CRON", { serviceKey: "SERVICE", cronSecret: "CRON" }), true);
});

Deno.test("isAuthorized: anon/none/wrong is rejected", () => {
  const cfg = { serviceKey: "SERVICE", cronSecret: "CRON" };
  assertEquals(isAuthorized("anon-jwt", "", cfg), false);
  assertEquals(isAuthorized("", "", cfg), false);
  assertEquals(isAuthorized("wrong", "wrong", cfg), false);
});

Deno.test("isAuthorized: an unset CRON_SECRET can't be matched by an empty header", () => {
  assertEquals(isAuthorized("", "", { serviceKey: "SERVICE", cronSecret: undefined }), false);
});

// ── orchestration fakes ───────────────────────────────────────────────────────

interface Overrides {
  leaderboard?: { id: number; calculation_date: string; data: unknown } | null;
  existing?: { id: number; status: string } | null;
  profiles?: ProfileInfo[];
  claimResult?: boolean;
  payTo?: (email: string, amount: number) => Promise<{ batch_id?: string; transaction_id?: string; transaction_status?: string }>;
  maxCycleUsd?: number;
}

function fakeDeps(o: Overrides) {
  const calls = {
    getProfiles: [] as string[][],
    claimCycle: [] as unknown[],
    recordEmptyCycle: [] as unknown[],
    payTo: [] as Array<{ email: string; amount: number }>,
    insertPayment: [] as Array<Record<string, unknown>>,
    markSent: [] as number[],
  };
  const deps: AutoPayDeps = {
    maxCycleUsd: o.maxCycleUsd ?? 100,
    getLatestLeaderboard: () => Promise.resolve(o.leaderboard ?? null),
    getExistingCyclePayout: () => Promise.resolve(o.existing ?? null),
    getProfiles: (ids) => {
      calls.getProfiles.push(ids);
      return Promise.resolve(o.profiles ?? []);
    },
    claimCycle: (row) => {
      calls.claimCycle.push(row);
      return Promise.resolve(o.claimResult ?? true);
    },
    recordEmptyCycle: (row) => {
      calls.recordEmptyCycle.push(row);
      return Promise.resolve();
    },
    payTo: (email, amount) => {
      calls.payTo.push({ email, amount });
      if (o.payTo) return o.payTo(email, amount);
      return Promise.resolve({ batch_id: "b", transaction_id: "t", transaction_status: "PENDING" });
    },
    insertPayment: (row) => {
      calls.insertPayment.push(row);
      return Promise.resolve();
    },
    markSent: (id) => {
      calls.markSent.push(id);
      return Promise.resolve();
    },
  };
  return { deps, calls };
}

const paypalProfile = (user_id: string, email: string, id = 0) => ({
  id,
  user_id,
  username: user_id,
  payment_id: email,
  payment_method: "PayPal",
});

const board = (data: unknown) => ({ id: 383, calculation_date: "2026-07-15", data });

// ── orchestration behavior ────────────────────────────────────────────────────

Deno.test("no leaderboard -> paid:false, pays nobody", async () => {
  const { deps, calls } = fakeDeps({ leaderboard: null });
  const out = await runAutoPayCycle(deps, { dryRun: false });
  assertEquals(out.status, 200);
  assertEquals(out.body.paid, false);
  assertEquals(calls.payTo.length, 0);
});

Deno.test("idempotency: existing cycle_payout is left alone, pays nobody", async () => {
  const { deps, calls } = fakeDeps({
    leaderboard: board([{ user_id: "a", position: 1 }]),
    existing: { id: 1, status: "pending_approval" },
  });
  const out = await runAutoPayCycle(deps, { dryRun: false });
  assertEquals(out.body.paid, false);
  assertEquals(String(out.body.reason).includes("already has cycle_payout 1"), true);
  assertEquals(calls.claimCycle.length, 0);
  assertEquals(calls.payTo.length, 0);
});

Deno.test("spend cap: over-cap cycle is not claimed and pays nobody", async () => {
  const { deps, calls } = fakeDeps({
    leaderboard: board([{ user_id: "a", position: 1 }]), // $3.00
    profiles: [paypalProfile("a", "a@x.com")],
    maxCycleUsd: 1, // 3.00 > 1
  });
  const out = await runAutoPayCycle(deps, { dryRun: false });
  assertEquals(out.body.paid, false);
  assertEquals(String(out.body.reason).includes("exceeds cap"), true);
  assertEquals(calls.claimCycle.length, 0);
  assertEquals(calls.payTo.length, 0);
});

Deno.test("dry run: computes the plan but writes nothing and pays nobody", async () => {
  const { deps, calls } = fakeDeps({
    leaderboard: board([{ user_id: "a", position: 1 }, { user_id: "b", position: 2 }]),
    profiles: [paypalProfile("a", "a@x.com"), paypalProfile("b", "b@x.com")],
  });
  const out = await runAutoPayCycle(deps, { dryRun: true });
  assertEquals(out.body.dry_run, true);
  assertEquals(out.body.eligible_count, 2);
  assertEquals(out.body.total_amount, 4.5);
  assertEquals(calls.claimCycle.length, 0);
  assertEquals(calls.payTo.length, 0);
  assertEquals(calls.insertPayment.length, 0);
  assertEquals(calls.markSent.length, 0);
});

Deno.test("nothing eligible: records an empty cycle, calls no PayPal", async () => {
  const { deps, calls } = fakeDeps({
    leaderboard: board([{ user_id: "a", position: 1 }]),
    profiles: [{ id: 1, user_id: "a", username: "a", payment_id: "a@x.com", payment_method: "MTurk" }],
  });
  const out = await runAutoPayCycle(deps, { dryRun: false });
  assertEquals(out.body.paid, true);
  assertEquals(out.body.eligible_count, 0);
  assertEquals(calls.recordEmptyCycle.length, 1);
  assertEquals(calls.payTo.length, 0);
  assertEquals(calls.markSent.length, 0);
});

Deno.test("happy path: claim -> pay each eligible -> ledger row each -> mark sent", async () => {
  const { deps, calls } = fakeDeps({
    leaderboard: board([{ user_id: "a", position: 1 }, { user_id: "b", position: 2 }]),
    profiles: [paypalProfile("a", "a@x.com", 10), paypalProfile("b", "b@x.com", 20)],
  });
  const out = await runAutoPayCycle(deps, { dryRun: false });
  assertEquals(out.body.paid, true);
  assertEquals(out.body.sent, 2);
  assertEquals(out.body.failed, 0);
  assertEquals(out.body.total_amount, 4.5);
  assertEquals(calls.claimCycle.length, 1);
  assertEquals(calls.payTo.map((c) => c.amount), [3.0, 1.5]);
  assertEquals(calls.insertPayment.length, 2);
  // ledger rows carry the money-relevant invariants
  assertEquals(calls.insertPayment[0].payment_method, "PayPal");
  assertEquals(calls.insertPayment[0].status, "Pending");
  assertEquals(calls.insertPayment[0].player_id, 10);
  assertEquals(calls.insertPayment[0].amount, 3.0);
  assertEquals(calls.markSent, [383]);
});

Deno.test("partial failure: a thrown payout is reported, the rest still send + mark sent", async () => {
  const { deps, calls } = fakeDeps({
    leaderboard: board([{ user_id: "a", position: 1 }, { user_id: "b", position: 2 }]),
    profiles: [paypalProfile("a", "a@x.com", 10), paypalProfile("b", "b@x.com", 20)],
    payTo: (email, amount) => {
      if (email === "a@x.com") return Promise.reject(new Error("PayPal 500"));
      return Promise.resolve({ batch_id: "b", transaction_id: "t", transaction_status: "PENDING" });
    },
  });
  const out = await runAutoPayCycle(deps, { dryRun: false });
  assertEquals(out.body.sent, 1);
  assertEquals(out.body.failed, 1);
  assertEquals(calls.insertPayment.length, 1); // only b
  assertEquals(String((out.body.failures as string[])[0]).includes("PayPal 500"), true);
  assertEquals(calls.markSent, [383]); // batch still finalized
});

Deno.test("payout with no transaction_id counts as a failure, writes no ledger row", async () => {
  const { deps, calls } = fakeDeps({
    leaderboard: board([{ user_id: "a", position: 1 }]),
    profiles: [paypalProfile("a", "a@x.com", 10)],
    payTo: () => Promise.resolve({ batch_id: "b", transaction_id: undefined }),
  });
  const out = await runAutoPayCycle(deps, { dryRun: false });
  assertEquals(out.body.sent, 0);
  assertEquals(out.body.failed, 1);
  assertEquals(calls.insertPayment.length, 0);
});

Deno.test("claim conflict: bail with 409, pay nobody", async () => {
  const { deps, calls } = fakeDeps({
    leaderboard: board([{ user_id: "a", position: 1 }]),
    profiles: [paypalProfile("a", "a@x.com", 10)],
    claimResult: false,
  });
  const out = await runAutoPayCycle(deps, { dryRun: false });
  assertEquals(out.status, 409);
  assertEquals(out.body.paid, false);
  assertEquals(calls.payTo.length, 0);
  assertEquals(calls.markSent.length, 0);
});
