// Orchestration for the auto-pay-cycle edge function — the money-moving control
// flow, with all I/O (DB, PayPal) injected as `AutoPayDeps` so it is unit-testable
// with fakes (see auto-pay_test.ts). The edge function (index.ts) is a thin shell
// that builds the real deps and maps the outcome to an HTTP response.
//
// Pairs with cycle.ts (pure who/how-much/why) — this module adds the effects:
// idempotency check, spend-cap gate, claim, per-item payout, ledger, finalize.

import { computeCyclePlan, type ProfileInfo } from "./cycle.ts";

// ── auth ──────────────────────────────────────────────────────────────────────

// Real money: passing the gateway JWT check (anon key) is NOT enough. Require the
// service-role key as Bearer, or the shared x-cron-secret. An unset CRON_SECRET
// can never be satisfied (guards against an empty-string match).
export function isAuthorized(
  bearer: string,
  cronHeader: string,
  cfg: { serviceKey: string; cronSecret: string | undefined },
): boolean {
  if (bearer.length > 0 && bearer === cfg.serviceKey) return true;
  if (cfg.cronSecret && cronHeader === cfg.cronSecret) return true;
  return false;
}

// ── injected effects ────────────────────────────────────────────────────────--

export interface Leaderboard {
  id: number;
  calculation_date: string;
  data: unknown; // array (possibly a JSON string) of leaderboard rows
}

export interface PayoutResult {
  batch_id?: string;
  transaction_id?: string;
  transaction_status?: string;
}

export interface AutoPayDeps {
  maxCycleUsd: number;
  getLatestLeaderboard(): Promise<Leaderboard | null>;
  getExistingCyclePayout(leaderboardId: number): Promise<{ id: number; status: string } | null>;
  getProfiles(userIds: string[]): Promise<ProfileInfo[]>;
  // Insert the cycle_payouts row in 'sending' state. Returns false if the insert
  // conflicts (another run already claimed this leaderboard).
  claimCycle(row: Record<string, unknown>): Promise<boolean>;
  // Record a zero-eligible cycle as handled (no money moved).
  recordEmptyCycle(row: Record<string, unknown>): Promise<void>;
  payTo(email: string, amount: number, note: string): Promise<PayoutResult>;
  insertPayment(row: Record<string, unknown>): Promise<void>;
  markSent(leaderboardId: number): Promise<void>;
}

export interface AutoPayOutcome {
  status: number;
  body: Record<string, unknown>;
}

const ok = (body: Record<string, unknown>): AutoPayOutcome => ({ status: 200, body });

// ── orchestration ─────────────────────────────────────────────────────────────

export async function runAutoPayCycle(
  deps: AutoPayDeps,
  opts: { dryRun: boolean },
): Promise<AutoPayOutcome> {
  const lb = await deps.getLatestLeaderboard();
  if (!lb) return ok({ paid: false, reason: "no leaderboard found" });

  // Idempotency: never touch a leaderboard that already has a cycle_payouts row
  // (paid, in-flight, or a leftover manual pending_approval batch).
  const existing = await deps.getExistingCyclePayout(lb.id);
  if (existing) {
    return ok({
      paid: false,
      reason: `leaderboard ${lb.id} already has cycle_payout ${existing.id} (${existing.status}); leaving it alone`,
    });
  }

  const rawData = typeof lb.data === "string" ? JSON.parse(lb.data) : lb.data;
  if (!Array.isArray(rawData)) return ok({ paid: false, reason: "leaderboard data is not an array" });

  const userIds = [
    ...new Set(rawData.map((r: Record<string, unknown>) => r.user_id).filter(Boolean).map(String)),
  ];
  const profiles = userIds.length ? await deps.getProfiles(userIds) : [];

  const plan = computeCyclePlan(rawData, profiles, deps.maxCycleUsd);
  const { items, eligible } = plan;
  const total = plan.totalAmount;

  // Spend cap: refuse to auto-send an unusually large cycle; leave for manual.
  if (plan.overCap) {
    return ok({
      paid: false,
      reason: `cycle total $${total.toFixed(2)} exceeds cap $${deps.maxCycleUsd.toFixed(2)}; not auto-sending (review manually)`,
      leaderboard_id: lb.id,
      eligible_count: eligible.length,
      total_amount: total,
    });
  }

  if (opts.dryRun) {
    return ok({
      paid: false,
      dry_run: true,
      leaderboard_id: lb.id,
      calculation_date: lb.calculation_date,
      item_count: items.length,
      eligible_count: eligible.length,
      total_amount: total,
      would_pay: eligible.map((i) => ({ username: i.username, rank: i.rank, amount: i.amount, email: i.payment_id })),
    });
  }

  if (eligible.length === 0) {
    await deps.recordEmptyCycle({
      leaderboard_id: lb.id,
      calculation_date: lb.calculation_date,
      item_count: items.length,
      items,
    });
    return ok({ paid: true, leaderboard_id: lb.id, eligible_count: 0, total_amount: 0, message: "nothing eligible; recorded empty cycle" });
  }

  // Claim the batch (unique leaderboard_id blocks a concurrent double-send).
  const claimed = await deps.claimCycle({
    leaderboard_id: lb.id,
    calculation_date: lb.calculation_date,
    status: "sending",
    item_count: items.length,
    eligible_count: eligible.length,
    total_amount: total,
    items,
  });
  if (!claimed) {
    return { status: 409, body: { paid: false, reason: "could not claim cycle (already claimed?)" } };
  }

  // Send each eligible payout, writing a ledger row per success.
  const failures: string[] = [];
  let sent = 0;
  for (const item of eligible) {
    try {
      const res = await deps.payTo(
        item.payment_id as string,
        item.amount,
        `Prediction market leaderboard bonus (rank ${item.rank})`,
      );
      if (!res.transaction_id) {
        failures.push(`${item.username}: no transaction id`);
        continue;
      }
      await deps.insertPayment({
        player_id: item.profile_id,
        amount: item.amount,
        payment_method: "PayPal",
        status: "Pending",
        transaction_id: res.transaction_id,
        paypal_batch_id: res.batch_id ?? null,
        paypal_status: res.transaction_status ?? null,
      });
      sent += 1;
    } catch (err) {
      failures.push(`${item.username}: ${(err as Error).message}`);
    }
  }

  await deps.markSent(lb.id);

  return ok({
    paid: true,
    leaderboard_id: lb.id,
    calculation_date: lb.calculation_date,
    eligible_count: eligible.length,
    sent,
    failed: failures.length,
    failures,
    total_amount: total,
  });
}
