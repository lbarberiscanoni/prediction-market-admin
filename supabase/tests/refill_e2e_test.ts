// End-to-end test for the bankruptcy refill (public.refill_balances).
//
// Runs the real SQL function against the real profiles table inside a
// rolled-back transaction, so prod is left untouched.
//
// Run:  DATABASE_URL=… PGCA=… deno task test:refill

import { assert, assertEquals } from "jsr:@std/assert@1";
import type { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";
import { withRollback } from "./db.ts";

type Result = { dry_run: boolean; period: string; refilled: { profile_id: number; previous_balance: number; amount: number }[] };

async function refill(c: Client, period: string, dryRun = false): Promise<Result> {
  const { rows } = await c.queryObject<{ r: Result }>(
    `select public.refill_balances($1, 100, 1000, $2) as r`,
    [period, dryRun],
  );
  return rows[0].r;
}

// Borrow three real profiles (FKs to auth.users make fake ones impractical)
// and set their balances; everything is rolled back.
async function seed(c: Client) {
  const { rows } = await c.queryObject<{ id: number }>(
    `select id from public.profiles where user_id is not null order by id limit 3`,
  );
  const [broke, low, fine] = rows.map((r) => Number(r.id));
  // Only our three players are below the floor for this test.
  await c.queryArray(`update public.profiles set balance = 1000 where balance < 100`);
  await c.queryArray(`update public.profiles set balance = 0.007 where id = $1`, [broke]);
  await c.queryArray(`update public.profiles set balance = 99.99 where id = $1`, [low]);
  await c.queryArray(`update public.profiles set balance = 100 where id = $1`, [fine]);
  return { broke, low, fine };
}

async function balance(c: Client, id: number): Promise<number> {
  const { rows } = await c.queryObject<{ balance: number }>(`select balance from public.profiles where id = $1`, [id]);
  return Number(rows[0].balance);
}

Deno.test("E2E refill: players under 100 go back to exactly 1000, others untouched", async () => {
  await withRollback(async (c) => {
    const { broke, low, fine } = await seed(c);

    const r = await refill(c, "test-period-1");

    assertEquals(r.dry_run, false);
    assertEquals(r.refilled.map((x) => x.profile_id).sort(), [broke, low].sort());
    assertEquals(await balance(c, broke), 1000);
    assertEquals(await balance(c, low), 1000);
    assertEquals(await balance(c, fine), 100);

    const log = await c.queryObject<{ n: bigint }>(
      `select count(*) n from public.balance_refills where period = 'test-period-1'`,
    );
    assertEquals(Number(log.rows[0].n), 2);
  });
});

Deno.test("E2E refill: re-running the same period credits nobody twice", async () => {
  await withRollback(async (c) => {
    const { broke } = await seed(c);
    await refill(c, "test-period-2");
    // Goes broke again within the same period.
    await c.queryArray(`update public.profiles set balance = 1 where id = $1`, [broke]);

    const again = await refill(c, "test-period-2");

    assertEquals(again.refilled.length, 0);
    assertEquals(await balance(c, broke), 1);

    // A new period refills them again.
    const next = await refill(c, "test-period-3");
    assertEquals(next.refilled.map((x) => x.profile_id), [broke]);
    assertEquals(await balance(c, broke), 1000);
  });
});

Deno.test("E2E refill: dry run reports who would be refilled and writes nothing", async () => {
  await withRollback(async (c) => {
    const { broke, low } = await seed(c);

    const r = await refill(c, "test-period-4", true);

    assertEquals(r.dry_run, true);
    assertEquals(r.refilled.map((x) => x.profile_id).sort(), [broke, low].sort());
    assert(Math.abs(await balance(c, broke) - 0.007) < 1e-9);
    const log = await c.queryObject<{ n: bigint }>(
      `select count(*) n from public.balance_refills where period = 'test-period-4'`,
    );
    assertEquals(Number(log.rows[0].n), 0);
  });
});

Deno.test("E2E refill: players cannot call it through the API", async () => {
  await withRollback(async (c) => {
    const { rows } = await c.queryObject<{ anon: boolean; authed: boolean }>(
      `select has_function_privilege('anon', 'public.refill_balances(text,numeric,numeric,boolean)', 'execute') anon,
              has_function_privilege('authenticated', 'public.refill_balances(text,numeric,numeric,boolean)', 'execute') authed`,
    );
    assertEquals(rows[0], { anon: false, authed: false });
  });
});
