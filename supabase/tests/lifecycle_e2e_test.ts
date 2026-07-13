// End-to-end market-lifecycle test, independent of the live game.
//
// Drives create → predict → settle against the REAL tables inside a rolled-back
// transaction (nothing persists), using the SAME pure payout module the edge
// functions use. This exercises the real schema — so it catches "works in
// dry-run, breaks on the real write" bugs that unit tests and dry-runs miss.
//
// Run:  DATABASE_URL=… PGCA=… deno task test:e2e

import { assert, assertEquals } from "jsr:@std/assert@1";
import type { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";
import { withRollback } from "./db.ts";
import {
  computeAnnulmentPayouts,
  computeResolutionPayouts,
  type Prediction,
} from "../functions/_shared/market-lifecycle/payouts.ts";

// creator_id / user_id carry FKs to auth.users, so the scratch rows must use
// real user ids. Everything is rolled back, so borrowing existing ids is inert.
async function realUsers(c: Client, n: number): Promise<string[]> {
  const { rows } = await c.queryObject<{ user_id: string }>(
    `select user_id from public.profiles where user_id is not null limit $1`,
    [n],
  );
  if (rows.length < n) throw new Error(`need ${n} profiles, found ${rows.length}`);
  return rows.map((r) => r.user_id);
}

// Stands up a scratch market with Yes/No outcomes and a fixed book of trades,
// all inside the caller's (rolled-back) transaction.
async function seedMarket(c: Client) {
  const [creator, u1, u2, u3] = await realUsers(c, 4);
  const m = await c.queryObject<{ id: number }>(
    `insert into public.markets (creator_id, name, token_pool, market_maker, status)
       values ($1, 'e2e lifecycle market', 20000, 'CPMM', 'open') returning id`,
    [creator],
  );
  const marketId = m.rows[0].id;
  const outs = await c.queryObject<{ id: number; name: string }>(
    `insert into public.outcomes (market_id, name, tokens, creator_id)
       values ($1, 'Yes', 10000, $2), ($1, 'No', 10000, $2) returning id, name`,
    [marketId, creator],
  );
  const yesId = outs.rows.find((o) => o.name === "Yes")!.id;
  const noId = outs.rows.find((o) => o.name === "No")!.id;

  // Book: u1 buys 100 Yes; u2 buys 40 Yes then sells 10 Yes (net 30); u3 buys 50 No.
  const trades: [string, number, string, number][] = [
    [u1, yesId, "buy", 100],
    [u2, yesId, "buy", 40],
    [u2, yesId, "sell", 10],
    [u3, noId, "buy", 50],
  ];
  for (const [user, outcome, type, shares] of trades) {
    await c.queryArray(
      `insert into public.predictions (user_id, market_id, outcome_id, trade_type, shares_amt, trade_value)
         values ($1, $2, $3, $4, $5, 0)`,
      [user, marketId, outcome, type, shares],
    );
  }
  return { marketId, yesId, noId, u1, u2, u3 };
}

async function loadPredictions(c: Client, marketId: number): Promise<Prediction[]> {
  const { rows } = await c.queryObject<Prediction>(
    `select user_id, outcome_id, trade_type, shares_amt, trade_value
       from public.predictions where market_id = $1`,
    [marketId],
  );
  return rows;
}

Deno.test("E2E resolve: create → bet → resolve writes correct payout rows", async () => {
  await withRollback(async (c) => {
    const { marketId, yesId, u1, u2 } = await seedMarket(c);

    const preds = await loadPredictions(c, marketId);
    const result = computeResolutionPayouts(preds, yesId, marketId);

    for (const p of result.payouts) {
      await c.queryArray(
        `insert into public.payouts (user_id, market_id, outcome_id, payout_amount)
           values ($1, $2, $3, $4)`,
        [p.user_id, p.market_id, p.outcome_id, p.payout_amount],
      );
    }
    await c.queryArray(
      `update public.markets set status = 'resolved', outcome_id = $2, resolved_at = now()
         where id = $1`,
      [marketId, yesId],
    );

    const paid = await c.queryObject<{ user_id: string; payout_amount: number }>(
      `select user_id, payout_amount from public.payouts where market_id = $1 order by payout_amount desc`,
      [marketId],
    );
    const byUser = Object.fromEntries(paid.rows.map((r) => [r.user_id, Number(r.payout_amount)]));
    assertEquals(byUser, { [u1]: 100, [u2]: 30 }); // u3 held only the losing outcome → no payout

    const mkt = await c.queryObject<{ status: string; outcome_id: number }>(
      `select status, outcome_id from public.markets where id = $1`,
      [marketId],
    );
    assertEquals(mkt.rows[0].status, "resolved");
    assertEquals(mkt.rows[0].outcome_id, yesId);
  });
});

Deno.test("E2E annul: create → bet → annul writes refund rows for every holder", async () => {
  await withRollback(async (c) => {
    const { marketId } = await seedMarket(c);

    const preds = await loadPredictions(c, marketId);
    const result = computeAnnulmentPayouts(preds, marketId);
    // Everyone with a positive net position is refunded at $0.50/share:
    // u1 100→$50, u2 30→$15, u3 50→$25.
    assertEquals(result.totalCount, 3);

    for (const p of result.payouts) {
      await c.queryArray(
        `insert into public.payouts (user_id, market_id, outcome_id, payout_amount)
           values ($1, $2, $3, $4)`,
        [p.user_id, p.market_id, p.outcome_id, p.payout_amount],
      );
    }
    await c.queryArray(
      `update public.markets set status = 'annulled' where id = $1`,
      [marketId],
    );

    const paid = await c.queryObject<{ n: bigint; total: number }>(
      `select count(*)::bigint as n, coalesce(sum(payout_amount),0) as total
         from public.payouts where market_id = $1`,
      [marketId],
    );
    assertEquals(paid.rows[0].n, 3n, "every holder should get a refund row");
    assertEquals(Number(paid.rows[0].total), 90, "50 + 15 + 25");

    const mkt = await c.queryObject<{ status: string }>(
      `select status from public.markets where id = $1`,
      [marketId],
    );
    assertEquals(mkt.rows[0].status, "annulled");
  });
});
