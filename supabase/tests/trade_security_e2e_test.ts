// End-to-end test for the trading write path, as a real player.
//
// Signs the claude-e2e-test account in through Supabase Auth and talks to the
// live PostgREST API with that player's JWT, exactly like the browser does.
// Proves (1) a player can no longer mint tokens by writing their own balance,
// a fake prediction, or outcome pools directly, and (2) a buy and a sell
// through the server-side public.place_trade RPC still work.
//
// These calls are real (not in a rolled-back transaction, since they go
// through the API). Every test snapshots what it touches over a direct DB
// connection and restores it in `finally`, so prod is left as it was.
//
// Run:  DATABASE_URL=… PGCA=… E2E_TEST_EMAIL=… E2E_TEST_PASSWORD=… \
//       SUPABASE_URL=… SUPABASE_ANON_KEY=… deno task test:trade

import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import type { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";
import { withClient } from "./db.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const EMAIL = Deno.env.get("E2E_TEST_EMAIL")!;
const PASSWORD = Deno.env.get("E2E_TEST_PASSWORD")!;
if (!URL_ || !ANON || !EMAIL || !PASSWORD) {
  throw new Error("SUPABASE_URL, SUPABASE_ANON_KEY, E2E_TEST_EMAIL, E2E_TEST_PASSWORD are required.");
}

let session: { token: string; userId: string } | null = null;
async function login() {
  if (session) return session;
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`login failed: ${JSON.stringify(j)}`);
  session = { token: j.access_token, userId: j.user.id };
  return session;
}

// One PostgREST call with the player's JWT.
async function api(method: string, path: string, body?: unknown) {
  const { token } = await login();
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, ok: r.ok, body: text ? JSON.parse(text) : null };
}

async function profile(c: Client, userId: string) {
  const { rows } = await c.queryObject<{ id: number; balance: number; tos_accepted_at: string | null }>(
    `select id, balance, tos_accepted_at from public.profiles where user_id = $1`,
    [userId],
  );
  return rows[0];
}

// An open binary market to trade on, with its pools snapshotted for restore.
async function openMarket(c: Client) {
  const { rows } = await c.queryObject<{ id: number; token_pool: number }>(
    `select m.id, m.token_pool from public.markets m
       where m.status = 'open' and (select count(*) from public.outcomes o where o.market_id = m.id) = 2
       order by m.id desc limit 1`,
  );
  const m = rows[0];
  const o = await c.queryObject<{ id: number; tokens: number }>(
    `select id, tokens from public.outcomes where market_id = $1 order by id`,
    [m.id],
  );
  return { id: Number(m.id), tokenPool: Number(m.token_pool), outcomes: o.rows.map((r) => ({ id: Number(r.id), tokens: Number(r.tokens) })) };
}

async function restoreMarket(c: Client, m: Awaited<ReturnType<typeof openMarket>>) {
  for (const o of m.outcomes) {
    await c.queryArray(`update public.outcomes set tokens = $1 where id = $2`, [o.tokens, o.id]);
  }
  await c.queryArray(`update public.markets set token_pool = $1 where id = $2`, [m.tokenPool, m.id]);
}

Deno.test("hole: a player's JWT cannot PATCH their own balance", async () => {
  const { userId } = await login();
  await withClient(async (c) => {
    const before = await profile(c, userId);
    try {
      const r = await api("PATCH", `profiles?user_id=eq.${userId}`, { balance: 999999 });
      const after = await profile(c, userId);
      assertEquals(after.balance, before.balance, `balance changed via the API (status ${r.status})`);
      assert(!r.ok, `PATCH balance should be rejected, got ${r.status}`);
    } finally {
      await c.queryArray(`update public.profiles set balance = $1 where id = $2`, [before.balance, before.id]);
    }
  });
});

Deno.test("hole: a player can still edit their own non-money profile fields", async () => {
  const { userId } = await login();
  await withClient(async (c) => {
    const { rows } = await c.queryObject<{ enable_email_notifications: boolean | null }>(
      `select enable_email_notifications from public.profiles where user_id = $1`,
      [userId],
    );
    const prev = rows[0].enable_email_notifications;
    try {
      const r = await api("PATCH", `profiles?user_id=eq.${userId}`, { enable_email_notifications: !prev });
      assert(r.ok, `own-profile edit should work: ${JSON.stringify(r.body)}`);
      assertEquals(r.body[0].enable_email_notifications, !prev);
    } finally {
      await c.queryArray(`update public.profiles set enable_email_notifications = $1 where user_id = $2`, [prev, userId]);
    }
  });
});

Deno.test("hole: a player cannot call increment_balance", async () => {
  const { userId } = await login();
  await withClient(async (c) => {
    const before = await profile(c, userId);
    try {
      const r = await api("POST", "rpc/increment_balance", { user_id_input: userId, amount: 500 });
      assertEquals((await profile(c, userId)).balance, before.balance, "increment_balance changed the balance");
      assert(!r.ok, `increment_balance should be rejected, got ${r.status}`);
    } finally {
      await c.queryArray(`update public.profiles set balance = $1 where id = $2`, [before.balance, before.id]);
    }
  });
});

Deno.test("hole: a player cannot forge a prediction or rewrite outcome pools", async () => {
  const { userId } = await login();
  await withClient(async (c) => {
    const m = await openMarket(c);
    const yes = m.outcomes[0];
    try {
      const forged = await api("POST", "predictions", {
        user_id: userId, market_id: m.id, outcome_id: yes.id,
        shares_amt: 1e6, market_odds: 0.5, trade_value: -0.01, trade_type: "buy",
      });
      assert(!forged.ok, `direct prediction insert should be rejected, got ${forged.status}`);

      await api("PATCH", `outcomes?id=eq.${yes.id}`, { tokens: 1 });
      const { rows } = await c.queryObject<{ tokens: number }>(`select tokens from public.outcomes where id = $1`, [yes.id]);
      assertEquals(Number(rows[0].tokens), yes.tokens, "outcome pool changed via the API");
    } finally {
      await c.queryArray(`delete from public.predictions where user_id = $1 and market_id = $2 and shares_amt = 1e6`, [userId, m.id]);
      await restoreMarket(c, m);
    }
  });
});

Deno.test("trade: a buy then a sell through place_trade move balance, shares and pools", async () => {
  const { userId } = await login();
  await withClient(async (c) => {
    const before = await profile(c, userId);
    const m = await openMarket(c);
    const [sel, oth] = m.outcomes;
    const startMax = await c.queryObject<{ id: number }>(`select coalesce(max(id), 0) id from public.predictions`);
    const maxId = Number(startMax.rows[0].id);
    try {
      // The trading UI makes a player accept the Terms first; do the same.
      if (!before.tos_accepted_at) {
        const t = await api("PATCH", `profiles?user_id=eq.${userId}`, { tos_accepted_at: new Date().toISOString() });
        assert(t.ok, `accepting ToS failed: ${JSON.stringify(t.body)}`);
      }

      // BUY $2 — same math as TradeForm: shares = amt / p, pools via CPMM.
      const p = sel.tokens / (sel.tokens + oth.tokens);
      const buy = await api("POST", "rpc/place_trade", {
        p_market_id: m.id, p_outcome_id: sel.id, p_trade_type: "buy", p_amount: 2,
      });
      assert(buy.ok, `buy failed: ${JSON.stringify(buy.body)}`);
      assertAlmostEquals(buy.body.shares, 2 / p, 1e-6);
      assertAlmostEquals(buy.body.balance, before.balance - 2, 1e-6);
      const newSel = sel.tokens + 2;
      const newOth = (sel.tokens * oth.tokens) / newSel;
      const pools = await c.queryObject<{ id: number; tokens: number }>(
        `select id, tokens from public.outcomes where market_id = $1 order by id`, [m.id],
      );
      assertAlmostEquals(Number(pools.rows.find((r) => Number(r.id) === sel.id)!.tokens), newSel, 1e-6);
      assertAlmostEquals(Number(pools.rows.find((r) => Number(r.id) === oth.id)!.tokens), newOth, 1e-6);
      const pred = await c.queryObject<{ user_id: string; trade_value: number; trade_type: string }>(
        `select user_id::text, trade_value, trade_type from public.predictions where id = $1`, [buy.body.prediction_id],
      );
      assertEquals(pred.rows[0].user_id, userId);
      assertEquals(pred.rows[0].trade_type, "buy");
      assertAlmostEquals(Number(pred.rows[0].trade_value), -2, 1e-9);

      // Can't spend more than the balance.
      const tooBig = await api("POST", "rpc/place_trade", {
        p_market_id: m.id, p_outcome_id: sel.id, p_trade_type: "buy", p_amount: before.balance + 1,
      });
      assert(!tooBig.ok, "overspending buy should be rejected");

      // Can't sell shares you don't own.
      const oversell = await api("POST", "rpc/place_trade", {
        p_market_id: m.id, p_outcome_id: oth.id, p_trade_type: "sell", p_amount: 1e6,
      });
      assert(!oversell.ok, "selling unowned shares should be rejected");

      // SELL the shares just bought — proceeds = shares * current price.
      const p2 = newSel / (newSel + newOth);
      const sell = await api("POST", "rpc/place_trade", {
        p_market_id: m.id, p_outcome_id: sel.id, p_trade_type: "sell", p_amount: buy.body.shares,
      });
      assert(sell.ok, `sell failed: ${JSON.stringify(sell.body)}`);
      assertAlmostEquals(sell.body.balance, before.balance - 2 + buy.body.shares * p2, 1e-6);
      assertAlmostEquals((await profile(c, userId)).balance, sell.body.balance, 1e-6);
    } finally {
      await c.queryArray(`delete from public.predictions where user_id = $1 and market_id = $2 and id > $3`, [userId, m.id, maxId]);
      await c.queryArray(`update public.profiles set balance = $1, tos_accepted_at = $2 where id = $3`, [before.balance, before.tos_accepted_at, before.id]);
      await restoreMarket(c, m);
    }
  });
});
