# Database & lifecycle tests

Deno tests that run against a real Postgres. Every write is wrapped in a
transaction that is rolled back, so they are safe to run against **prod** and
leave it byte-identical.

| Task | File | What it checks |
|---|---|---|
| `deno task test:schema` | `schema_test.ts` | The v1 events schema contract (spec_conditions, events.mutually_exclusive, RLS, constraints) + FRED/trading-core invariants |
| `deno task test:e2e` | `lifecycle_e2e_test.ts` | Full create → bet → resolve / → annul lifecycle, using the same `_shared/market-lifecycle/payouts.ts` module the edge functions use |
| `deno task test:integration` | `pipeline_integration_test.ts` | Invokes the DEPLOYED court-pipeline edge functions (sweep / promote / mint / resolve-event-markets) in **dry-run** mode — exercises the real boot → auth → DB → external-API glue, writes nothing. Needs `SUPABASE_URL` + `SUPABASE_ANON_KEY` (from `.env.local`'s `NEXT_PUBLIC_*`); costs a few live CL/LLM calls. |

Pure-logic tests (no DB) run with `deno task test` and need no setup.

## Running against prod

Two env vars:

- `DATABASE_URL` — the pooler connection string (session mode, port 5432).
  Build it from `supabase/.temp/pooler-url` + `SUPABASE_DB_PASSWORD` in `.env.local`.
- `PGCA` — a PEM file with the pooler's CA chain. Supabase's pooler presents a
  cert signed by a **private** Supabase CA that no public/system trust store
  contains, so deno-postgres needs it explicitly. Extract it once:

  ```bash
  openssl s_client -connect aws-0-us-east-1.pooler.supabase.com:5432 \
    -starttls postgres -showcerts </dev/null 2>/dev/null \
    | awk '/BEGIN CERTIFICATE/,/END CERTIFICATE/' > /tmp/pooler-chain.pem
  ```

Then:

```bash
export DATABASE_URL="postgresql://USER:ENCODED_PW@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
export PGCA=/tmp/pooler-chain.pem
deno task test:e2e
```

(`psql` connects with plain `sslmode=require`, which encrypts without verifying,
so it does not need `PGCA` — only deno-postgres does.)
