# CLAUDE.md — Architecture map & orientation

Admin console for **Prophet**, a play-money prediction market. This file is the
fast orientation map. Deeper references already exist and are still canonical:

- [`documentation.md`](documentation.md) — DB schema, custom types, module catalog, leaderboard payout schedule.
- [`README.md`](README.md) — product overview, frontend structure, roadmap, changelog.

**Read this file first when the question is "how does X actually happen".** Most
of the real work happens in **Supabase Edge Functions**, not in this Next.js app —
that is the single biggest thing that isn't obvious from the frontend code.

---

## The most important thing to know

**The backend is a set of Supabase Edge Functions. The Next.js app is mostly a
thin admin UI on top of them.** The functions run with the **service-role key**
(bypassing RLS) and are the source of truth for creating, activating, closing,
resolving, and paying out markets.

These functions are **deployed to Supabase** (project ref `asxaibpmkcorlcpycgqc`).
`supabase/functions/` in this repo is a **vendored mirror for readability** — it is
NOT the deployment source and may drift from what's live. Always treat the
deployed version as truth.

- List live functions: `supabase functions list`
- Refresh a local copy: `supabase functions download <name>`
- Deploy (only when intentionally changing backend): `supabase functions deploy <name>`

---

## Edge Function catalog (15 functions)

| Function | Purpose | Writes to | Triggered by |
|---|---|---|---|
| `get-fred-data` | Checks 16 FRED indicators for a release ~14 days out; for each, calls `add-market`. | (via `add-market`) | **pg_cron `0 6 * * *`** (`fred-daily-check`) |
| `add-market` | Inserts a market + its outcomes. Service role. Default Yes/No @ 10000 tokens, `status:'open'`. | `markets`, `outcomes` | `get-fred-data`; callable directly |
| `activate-markets` | Finds markets closing in ~15 days, searches FRED for a matching series, backfills outcomes/description, sets `status:'open'`. | `markets`, `outcomes` | ⚠️ **Not scheduled** (possibly obsolete — `add-market` already creates markets as `open`) |
| `auto-close-markets` | Sets `open` markets whose `close_date` has passed to `closed`. | `markets` | **pg_cron `0 7 * * *`** (`auto-close-markets-daily`) |
| `resolve-fred-markets` | For `closed` FRED markets, pulls latest FRED value, compares to `target`, resolves win/lose + payouts. | `markets` (→`resolved`), payouts | **pg_cron `30 6 * * *`** (`daily-fred-resolution`) |
| `resolve-market` | Manual resolution of one market by winning outcome; computes net shares & pays winners. | `markets` (→`resolved`), `payouts` | Admin UI / manual |
| `annul-market` | Voids a market; refunds all participants their net position. | `markets` (→`annulled`), `payouts` | Admin UI / manual |
| `calculate-leaderboard` | Ranks users by P&L over eligible markets (open + recently-closed/resolved/annulled). | `leaderboards` | **pg_cron `45 6 * * *`** (`daily-leaderboard-calculation`) |
| `market-notification` | Emails users (Resend) announcing newly created markets. Rate-limited. | — (sends email) | `get-fred-data` after creating markets |
| `stage-cycle-payout` | Computes leaderboard-rank bonus batch, STAGES it as `pending_approval` (moves no money). ~14-day cadence. | `cycle_payouts` | **pg_cron `15 7 * * *`** (`stage-cycle-payout-daily`; internal 14-day guard self-throttles) |
| `send-paypal-payout` | Pays a batch via PayPal Payouts API; logs to ledger. | `payments` | **Admin UI** (`invoke('send-paypal-payout')`) |
| `reconcile-payouts` | Polls PayPal for terminal status of `Pending` PayPal payments; updates ledger. Moves no money. | `payments` | **pg_cron `0 * * * *`** (`reconcile-payouts-hourly`) |
| `send-mturk-bonus` | Sends an Amazon MTurk worker bonus (legacy payout path). | — (MTurk API) | Admin UI / manual |
| `admin` | Signs AWS/MTurk requests (returns signed request / creds helper for MTurk). | — | Frontend helper |

**In-repo before this doc:** only `send-mturk-bonus`, `send-paypal-payout`,
`reconcile-payouts`, `_shared`. All 15 are now vendored.

### Scheduling — pg_cron is the source of truth (NOT this repo)
All periodic work runs from **Supabase `pg_cron`**, configured in the database
(not in git). Query it with `select jobid, jobname, schedule, active, command
from cron.job;`. As of 2026-07-11 there are 6 active jobs (all times UTC):

| jobid | jobname | schedule | function |
|---|---|---|---|
| 8 | `fred-daily-check` | `0 6 * * *` | `get-fred-data` (`create_markets:true`) |
| 14 | `daily-fred-resolution` | `30 6 * * *` | `resolve-fred-markets` |
| 1 | `daily-leaderboard-calculation` | `45 6 * * *` | `calculate-leaderboard` |
| 2 | `auto-close-markets-daily` | `0 7 * * *` | `auto-close-markets` |
| 21 | `stage-cycle-payout-daily` | `15 7 * * *` | `stage-cycle-payout` (guard self-throttles to ~14d) |
| 19 | `reconcile-payouts-hourly` | `0 * * * *` | `reconcile-payouts` |

The daily chain is intentional: create (06:00) → resolve (06:30) → leaderboard
(06:45) → close (07:00) → stage bonus batch (07:15). To add/remove jobs use
`cron.schedule('name','* * * * *', $job$ … $job$)` / `cron.unschedule('name')`;
mirror the auth pattern of the existing jobs (anon Bearer token in the header).

**History:** `.github/workflows/fred-daily.yml` was the *original* scheduler for
`get-fred-data`, superseded by pg_cron `fred-daily-check`. It went dormant after
**2025-08-28** and was **removed** (it would have double-created markets if
GitHub Actions were re-enabled). pg_cron is the sole scheduler now.

**Remaining gap:** `activate-markets` has no scheduler — left unwired because it
appears obsolete (`add-market` already creates markets as `open`). Confirm before
relying on it.

---

## The automated FRED market pipeline

```
fred-daily.yml   GitHub Actions cron '0 6 * * *'  (daily 06:00 UTC)
    │  POST { days_ahead: 14, create_markets: true, jwt_token, supabase_project_url }
    ▼
get-fred-data    checks 16 hardcoded FRED indicators for a release exactly 14 days out;
    │            for each hit, fetches the latest observation → uses it as `target`
    │  POST /functions/v1/add-market { name, description, link, close_date,
    │                                  tags:["Economics"], target }
    ▼
add-market       INSERT markets (status:'open') + outcomes (Yes/No, 10000 each)  [service role]
    ▼
market-notification   emails users about the new markets (if any were created)
```

**This creates REAL production markets** in `markets` / `outcomes`.

---

## Two separate market systems — don't confuse them

| | Production markets | Test markets |
|---|---|---|
| Tables | `markets`, `outcomes` | `test_markets`, `test_outcomes` |
| Created by | `add-market` edge fn (cron pipeline above) | Manual button [`AddIndicatorMarket.tsx`](src/components/AddIndicatorMarket.tsx) → direct Supabase insert |
| Indicator list | 16 series inside `get-fred-data` | 16 series inside the FRED page / component |
| API route | — | [`src/app/api/test-markets/route.ts`](src/app/api/test-markets/route.ts) (unused CRUD) |

The manual admin button writes **only** to `test_*` tables. The automated cron
writes **only** to production tables. They share no code.

Also note: [`CreateMarket.tsx`](src/components/CreateMarket.tsx) (full manual
market form → `markets`) is **orphaned** — not mounted on any route. `/markets`
calls `notFound()`.

---

## Market lifecycle (`status` enum)

```
pending ──activate-markets──▶ open ──auto-close-markets (close_date passed)──▶ closed
                                │                                                │
                                │                          resolve-fred-markets / resolve-market
                                │                                                ▼
                                └──────────annul-market──────────▶ annulled   resolved
```

- **payouts** are written to the `payouts` table on `resolve-market` / `annul-market`
  / `resolve-fred-markets` (in-app play-money settlement of shares).
- **cash payouts** (leaderboard bonuses) are a *separate* system: `stage-cycle-payout`
  → `cycle_payouts` (pending_approval) → admin approves → `send-paypal-payout`
  → `payments` ledger → `reconcile-payouts` settles. See `documentation.md`
  "Leaderboard Bonus Payouts". Real-money paths (`send-paypal-payout`,
  `send-mturk-bonus`) always require explicit human approval in the UI.

---

## Conventions
- Trunk-based: commit straight to `main`, no feature branches (see global prefs).
- `profiles`: `id` (row PK) vs `user_id` (auth uid) — see `documentation.md`; don't conflate.
- Editing an edge function here does nothing until `supabase functions deploy`.
