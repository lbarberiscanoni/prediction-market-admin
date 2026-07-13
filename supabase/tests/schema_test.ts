// Schema contract for the v1 events data model (market-data-models-survey.md §15).
//
// This suite is the executable specification for the events layer. It asserts
// the TARGET schema, so it runs RED against a database that predates the
// spec_conditions migration and GREEN once the migration is applied. It is
// also the post-apply verification gate against prod.
//
// Run:  DATABASE_URL=postgres://… deno task test:schema
//
// Every test that writes wraps its work in a transaction that is ALWAYS rolled
// back, so the suite leaves any database (including prod) byte-identical.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

const DATABASE_URL = Deno.env.get("DATABASE_URL");
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required (point it at the local or prod Postgres).");
}

// Supabase's pooler presents a cert signed by a PRIVATE Supabase CA that is not
// in any public/system trust store, so Deno's strict TLS rejects it. Point PGCA
// at a PEM file with the pooler CA chain to trust it explicitly (never committed).
const caFile = Deno.env.get("PGCA");
const caCertificates = caFile
  ? Deno.readTextFileSync(caFile)
    .split(/(?<=-----END CERTIFICATE-----)/)
    .map((c) => c.trim())
    .filter((c) => c.includes("BEGIN CERTIFICATE"))
  : undefined;

function clientConfig() {
  const u = new URL(DATABASE_URL!);
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    hostname: u.hostname,
    port: Number(u.port || "5432"),
    database: u.pathname.replace(/^\//, "") || "postgres",
    tls: caCertificates ? { enabled: true, enforce: true, caCertificates } : undefined,
  };
}

async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client(clientConfig());
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// Runs fn inside a transaction that is always rolled back — no persistence.
async function withRollback(fn: (c: Client) => Promise<void>): Promise<void> {
  await withClient(async (c) => {
    await c.queryArray("begin");
    try {
      await fn(c);
    } finally {
      await c.queryArray("rollback");
    }
  });
}

async function column(c: Client, table: string, col: string) {
  const { rows } = await c.queryObject<
    { data_type: string; is_nullable: string; column_default: string | null }
  >(
    `select data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [table, col],
  );
  return rows[0] ?? null;
}

async function expectError(fn: () => Promise<unknown>, needle: string) {
  let threw = false;
  try {
    await fn();
  } catch (e) {
    threw = true;
    const msg = e instanceof Error ? e.message : String(e);
    assert(
      msg.toLowerCase().includes(needle.toLowerCase()),
      `expected error containing "${needle}", got: ${msg}`,
    );
  }
  assert(threw, `expected an error containing "${needle}", but none was thrown`);
}

// Creates a scratch event + market_spec inside the caller's transaction and
// returns their ids, so condition tests have valid referents.
async function scaffold(c: Client) {
  const ev = await c.queryObject<{ id: number }>(
    `insert into public.events (kind, title) values ('custom', 'schema-test') returning id`,
  );
  const eventId = ev.rows[0].id;
  const sp = await c.queryObject<{ id: number }>(
    `insert into public.market_specs (event_id, template_id, question)
       values ($1, 'schema-test', 'will it work?') returning id`,
    [eventId],
  );
  return { eventId, specId: sp.rows[0].id };
}

// ── Suite A: target schema (RED before the migration, GREEN after) ──────────

Deno.test("A1. spec_conditions has the expected columns", async () => {
  await withClient(async (c) => {
    const expected: Record<string, { type: string; nullable: string }> = {
      id: { type: "bigint", nullable: "NO" },
      created_at: { type: "timestamp with time zone", nullable: "NO" },
      market_spec_id: { type: "bigint", nullable: "NO" },
      condition_spec_id: { type: "bigint", nullable: "YES" },
      condition_event_id: { type: "bigint", nullable: "YES" },
      required_outcome: { type: "text", nullable: "NO" },
      note: { type: "text", nullable: "YES" },
    };
    for (const [col, want] of Object.entries(expected)) {
      const got = await column(c, "spec_conditions", col);
      assert(got !== null, `spec_conditions.${col} is missing`);
      assertEquals(got.data_type, want.type, `spec_conditions.${col} type`);
      assertEquals(got.is_nullable, want.nullable, `spec_conditions.${col} nullability`);
    }
  });
});

Deno.test("A2. events.mutually_exclusive is boolean not null default false", async () => {
  await withClient(async (c) => {
    const got = await column(c, "events", "mutually_exclusive");
    assert(got !== null, "events.mutually_exclusive is missing");
    assertEquals(got.data_type, "boolean");
    assertEquals(got.is_nullable, "NO");
    assert((got.column_default ?? "").includes("false"), "default should be false");
  });
});

Deno.test("A3. a condition with zero referents is rejected", async () => {
  await withRollback(async (c) => {
    const { specId } = await scaffold(c);
    await expectError(
      () =>
        c.queryArray(
          `insert into public.spec_conditions (market_spec_id, required_outcome)
             values ($1, 'Yes')`,
          [specId],
        ),
      "spec_conditions_one_referent",
    );
  });
});

Deno.test("A4. a condition with both referents is rejected", async () => {
  await withRollback(async (c) => {
    const { eventId, specId } = await scaffold(c);
    // A second spec to serve as the spec-referent.
    const other = await c.queryObject<{ id: number }>(
      `insert into public.market_specs (event_id, template_id, question)
         values ($1, 'schema-test', 'other?') returning id`,
      [eventId],
    );
    await expectError(
      () =>
        c.queryArray(
          `insert into public.spec_conditions
             (market_spec_id, condition_spec_id, condition_event_id, required_outcome)
             values ($1, $2, $3, 'Yes')`,
          [specId, other.rows[0].id, eventId],
        ),
      "spec_conditions_one_referent",
    );
  });
});

Deno.test("A5. a condition cannot reference its own spec", async () => {
  await withRollback(async (c) => {
    const { specId } = await scaffold(c);
    await expectError(
      () =>
        c.queryArray(
          `insert into public.spec_conditions
             (market_spec_id, condition_spec_id, required_outcome)
             values ($1, $1, 'Yes')`,
          [specId],
        ),
      "spec_conditions_no_self_reference",
    );
  });
});

Deno.test("A6. deleting a spec cascades to its conditions", async () => {
  await withRollback(async (c) => {
    const { eventId, specId } = await scaffold(c);
    await c.queryArray(
      `insert into public.spec_conditions
         (market_spec_id, condition_event_id, required_outcome)
         values ($1, $2, 'not_consolidated')`,
      [specId, eventId],
    );
    const before = await c.queryObject<{ n: bigint }>(
      `select count(*)::bigint as n from public.spec_conditions where market_spec_id = $1`,
      [specId],
    );
    assertEquals(before.rows[0].n, 1n);
    await c.queryArray(`delete from public.market_specs where id = $1`, [specId]);
    const after = await c.queryObject<{ n: bigint }>(
      `select count(*)::bigint as n from public.spec_conditions where market_spec_id = $1`,
      [specId],
    );
    assertEquals(after.rows[0].n, 0n, "conditions should be cascade-deleted");
  });
});

Deno.test("A7. a valid event-referent condition round-trips", async () => {
  await withRollback(async (c) => {
    const { eventId, specId } = await scaffold(c);
    const ins = await c.queryObject<{ id: number }>(
      `insert into public.spec_conditions
         (market_spec_id, condition_event_id, required_outcome, note)
         values ($1, $2, 'denied', 'if the motion to dismiss is denied')
         returning id`,
      [specId, eventId],
    );
    assert(ins.rows[0].id > 0, "insert should return an id");
  });
});

Deno.test("A8. RLS is enabled with the admin-only house pattern", async () => {
  await withClient(async (c) => {
    const rls = await c.queryObject<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class
        where oid = 'public.spec_conditions'::regclass`,
    );
    assertEquals(rls.rows[0].relrowsecurity, true, "RLS must be enabled");
    const pol = await c.queryObject<{ policyname: string; qual: string }>(
      `select policyname, qual from pg_policies
        where schemaname = 'public' and tablename = 'spec_conditions'`,
    );
    assertEquals(pol.rows.length, 2, "expected read + write admin policies");
    for (const p of pol.rows) {
      assert(
        (p.qual ?? "").includes("is_admin") && (p.qual ?? "").includes("user_id"),
        `policy ${p.policyname} must gate on profiles.user_id + is_admin`,
      );
    }
  });
});

Deno.test("A9. the three condition-referent indexes exist", async () => {
  await withClient(async (c) => {
    const { rows } = await c.queryObject<{ indexname: string }>(
      `select indexname from pg_indexes
        where schemaname = 'public' and tablename = 'spec_conditions'`,
    );
    const names = rows.map((r) => r.indexname);
    for (const want of [
      "spec_conditions_spec_idx",
      "spec_conditions_cond_spec_idx",
      "spec_conditions_cond_event_idx",
    ]) {
      assert(names.includes(want), `missing index ${want}`);
    }
  });
});

// ── Suite B: FRED / trading-core invariants (GREEN before AND after) ────────

Deno.test("B1. markets.event_id is a nullable bigint (only trading-core change)", async () => {
  await withClient(async (c) => {
    const got = await column(c, "markets", "event_id");
    assert(got !== null, "markets.event_id is missing");
    assertEquals(got.data_type, "bigint");
    assertEquals(got.is_nullable, "YES", "event_id must be nullable so FRED markets stay null");
  });
});

Deno.test("B2. an add-market-shaped insert (no event_id) yields event_id null", async () => {
  await withRollback(async (c) => {
    const creator = await c.queryObject<{ creator_id: string }>(
      `select creator_id from public.markets limit 1`,
    );
    assert(creator.rows.length === 1, "need an existing creator_id to mimic add-market");
    const ins = await c.queryObject<{ event_id: number | null }>(
      `insert into public.markets (creator_id, name, token_pool, market_maker)
         values ($1, 'schema-test FRED market', 10000, 'test')
         returning event_id`,
      [creator.rows[0].creator_id],
    );
    assertEquals(ins.rows[0].event_id, null, "FRED-shaped inserts must leave event_id null");
  });
});

Deno.test("B3. existing FRED markets are unaffected (event_id null)", async () => {
  await withClient(async (c) => {
    const { rows } = await c.queryObject<{ n: bigint }>(
      `select count(*)::bigint as n from public.markets where event_id is not null`,
    );
    assertEquals(rows[0].n, 0n, "no live market should be linked to an event yet");
  });
});
