# CLAUDE.md — Architecture map & orientation

Admin console for **Prophet**, a play-money prediction market. This file is the
fast orientation map. Deeper references already exist and are still canonical:

- [`documentation.md`](documentation.md) — DB schema, custom types, module catalog, leaderboard payout schedule.
- [`README.md`](README.md) — product overview, frontend structure, roadmap, changelog.
- [`market-data-models-survey.md`](market-data-models-survey.md) — design reference for the
  events/market_specs proposal below: how Polymarket/Kalshi/Manifold structure markets as
  data (§1–5), Gnosis CTF (§6), roadmap concepts — conditional/multi-choice/combination
  markets (§7), Hanson LMSR (§8), higher-order forecasts (§9), Paradigm pm-AMM (§10),
  Metaculus/Augur/PredictIt/Futuur/Betfair/Metaforecast/INFER (§11–13), the
  consolidated missing-pieces list (§14), and the **settled v1 schema (§15)**:
  events + market_specs + spec_conditions (N rows = AND; disjunction/nesting
  deferred) + event_links + markets.event_id, with the deletion/deferral log.

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
from cron.job;`. As of 2026-07-11 there are 7 active jobs (all times UTC):

| jobid | jobname | schedule | function |
|---|---|---|---|
| 8 | `fred-daily-check` | `0 6 * * *` | `get-fred-data` (`create_markets:true`) |
| 14 | `daily-fred-resolution` | `30 6 * * *` | `resolve-fred-markets` |
| 1 | `daily-leaderboard-calculation` | `45 6 * * *` | `calculate-leaderboard` |
| 2 | `auto-close-markets-daily` | `0 7 * * *` | `auto-close-markets` |
| 21 | `stage-cycle-payout-daily` | `15 7 * * *` | `stage-cycle-payout` (guard self-throttles to ~14d) |
| 22 | `sweep-court-cases-daily` | `0 8 * * *` | `sweep-court-cases` (court-market pipeline discovery) |
| 19 | `reconcile-payouts-hourly` | `0 * * * *` | `reconcile-payouts` |

The daily chain is intentional: create (06:00) → resolve (06:30) → leaderboard
(06:45) → close (07:00) → stage bonus batch (07:15) → court sweep (08:00). To
add/remove jobs use
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

## Data model (verified live 2026-07-11)

`documentation.md` documents 6 tables (`markets`, `outcomes`, `payouts`,
`predictions`, `profiles`, `leaderboards`). The live DB has **19** — the docs
are incomplete. Full list with the extras called out:

- **Core (documented):** `markets`, `outcomes`, `predictions`, `payouts`,
  `profiles`, `leaderboards`.
- **Events layer (LIVE, mostly inert — see "Events data model" below):**
  `events`, `market_specs`, `spec_conditions` (conditional/combination markets;
  N rows = AND), `resolution_proposals` (watcher audit log + review queue).
- **Court registry:** `court_cases` (CourtListener discovery; see court pipeline).
- **Undocumented but real:** `cycle_payouts` (staged leaderboard-bonus batches:
  `status`, `items` jsonb, `approved_at`, `sent_at`), `payments` (payout ledger:
  `player_id`, `payment_method` enum, `status` + `paypal_status`, `paypal_batch_id`).
- **Test/sandbox mirror:** `test_markets`, `test_outcomes`, `test_predictions`,
  `test_user` (used by the manual FRED button + experiments; separate from prod).
- **Junk (ignore / candidates for cleanup):** `profiles_duplicate` (0 rows),
  `profiles_duplicate1` (125 rows). Leftover copies — don't read/write these.

Key column notes: `markets.status` is a Postgres enum (pending/open/closed/
resolved/annulled); `markets.outcome_id` = winning outcome after resolution;
`markets.target` = FRED threshold value; `markets.resolved_at` set on resolution.
`markets.event_id` (nullable) links a market to its `events` row (null for
legacy/FRED). `payouts.outcome_id` is **nullable** (as of 2026-07-13) so
annulment refunds — which have no winning outcome — can be recorded.
`profiles.is_admin` (boolean) is **real and load-bearing** — see auth below.
Query live schema anytime via the recipe in memory `supabase-db-connection`.

## Auth / admin gate
`_shared/admin.ts` exports `requireAdmin(req)`: validates the caller's JWT
(`/auth/v1/user`), then checks `profiles.is_admin === true` (via service role);
returns `{userId}` or a 401/403 Response. **Only the two money-moving functions
use it:** `send-paypal-payout` and `send-mturk-bonus`. So `is_admin` is the gate
for real payouts — not a phantom column.

## Deployment
- **Frontend:** Next.js admin app deployed on **Vercel**. App env vars + the
  edge-function/integration secrets are managed in **Vercel**.
- **Backend:** Supabase edge functions read their secrets from **Supabase function
  secrets** (`FRED_API_KEY`, `RESEND_API_KEY`, `PAYPAL_*`, `AWS_*`,
  `SUPABASE_SERVICE_ROLE_KEY`) — confirmed working since the crons succeed.
  ⚠️ `send-paypal-payout` / `reconcile-payouts` default `PAYPAL_API_BASE` to the
  **sandbox** URL; verify the live secret is set for real payouts.
- **Sibling public app:** https://github.com/lbarberiscanoni/prediction-market —
  the public-facing platform; diff it to replicate features (see memory
  `public-platform-sibling-repo`).

## Court-market pipeline (in progress)

Goal: create + settle markets on court cases involving Kalshi/Polymarket,
mirroring the FRED pipeline (discover → create via `add-market` → resolve).

- **Phase 1 (live):** `sweep-court-cases` edge function — CourtListener v4
  RECAP discovery over the entity alias list (Kalshi ⊃ KalshiEX; Polymarket =
  Blockratize / Adventure One QSS), upserted into `public.court_cases`
  (migrations `20260711000000`, `..000100`). Two passes per alias:
  `party_name=` (precise) and full-text `q=` (recall — catches appellate/sparse
  party data, e.g. 2→15 appellate cases). Full-text noise is tagged
  `party_confirmed=false` (alias not found in case name/party list) for human
  triage; `discovery_methods` records provenance. Sweep owns discovery fields
  and overwrites them; curation fields (`status`, `company_role`, `case_type`,
  `matter_id`, `notes`) are never touched. Supports `{dry_run:true}`.
  Idempotent. Scheduled: pg_cron `sweep-court-cases-daily` (`0 8 * * *`).
  Pure logic (alias list, court-level classification, party confirmation) is
  extracted to [`_shared/court-discovery.ts`](supabase/functions/_shared/court-discovery.ts)
  and unit-tested (`court-discovery_test.ts`, 8 tests — the `ca`-prefix and
  `Adventure One` traps). **Rate limit (important):** CourtListener's
  authenticated cap is **10 requests/min**; in-function throttling can't beat
  the edge runtime's ~50s wall-clock, so the sweep fetches **page 1 only** (8
  requests, ~7s) — new filings sort to the top, so this catches every new case;
  the backlog is already seeded and per-case resolution fetches entries
  directly. `{max_pages:N}` raises pagination for a one-off resync but risks
  429s + wall-clock; keep it ≤1 on the cron path.
- **Phase 2 (in progress — TDD):** drafting = turn a case into draft
  `market_specs`, one per applicable template. The **template library** and
  **drafter** are built + unit-tested
  ([`templates.ts`](supabase/functions/_shared/court-resolution/templates.ts),
  [`draft.ts`](supabase/functions/_shared/court-resolution/draft.ts)): each
  template is git-versioned code carrying a baked-in `resolution_map`
  (classification → outcome/ANNUL), so the LLM never invents resolution logic.
  `draftSpecs(case)` selects applicable templates deterministically and emits
  drafts whose `params` IS the `ResolutionSpec` the settlement resolver
  consumes — draft and settle lock together (a round-trip test proves it).
  Today's templates: `appeal_outcome`, `state_remand` (a "will it be remanded?"
  market — which drove the resolver to be **map-first**: a market's own spec is
  authoritative for its own question, overriding the classifier's generic
  annul). `draft_test.ts` (8 pure tests) covers selection + invariants +
  round-trip. **Promotion** (`court_cases` → `events` + draft `market_specs`) is
  built: [`promote.ts`](supabase/functions/_shared/court-resolution/promote.ts)
  (`isPromotable`/`planPromotion`, 9 pure tests) + the
  [`promote-court-cases`](supabase/functions/promote-court-cases/index.ts) edge
  function (idempotent, dry-run). Ran live: **49 events + 11 draft specs**
  (6 appeal_outcome, 5 state_remand). **LLM refinement** is built:
  [`refine.ts`](supabase/functions/_shared/court-resolution/refine.ts)
  `refineDraft` improves question wording + estimates a realistic close date +
  assigns `confidence` (drives auto-approval). Safety law: `applyRefinement` is
  a pure merge that keeps the draft's `params` (resolution_map/outcomes/template)
  verbatim — the LLM structurally cannot change what a market resolves on, proven
  by `refine_test.ts` (7 pure tests) without calling the model; `refine_eval.ts`
  asserts the invariants on real output (`deno task test:refine`). Still to add:
  more templates (MTD/PI granted-by-date, class-cert, settlement approval), and
  the **mint** step (draft → live market via `add-market`, set `status:'live'`)
  — the one gap before the loop runs end to end. Needs `ANTHROPIC_API_KEY`.
- **Phase 3 (in progress — TDD first):** the resolution *classifier* is built
  test-first in [`supabase/functions/_shared/court-resolution/`](supabase/functions/_shared/court-resolution/):
  `classifyDocket()` (Opus 4.8, structured outputs) maps a case's docket entries
  → terminal-event classification + recommended market action (resolve / **annul**
  / continue) + quoted evidence. A golden-set eval (`classify_eval.ts`) runs it
  over 12 frozen real dockets and asserts hand-labeled ground truth — 13/13
  green. Run: `deno test --allow-env --allow-read --allow-net
  supabase/functions/_shared/court-resolution/classify_eval.ts` (needs
  `ANTHROPIC_API_KEY`). Every new real termination → new fixture + label.
  The **deterministic settlement step** is built + unit-tested:
  [`resolve.ts`](supabase/functions/_shared/court-resolution/resolve.ts)
  `applyResolution(spec, verdict)` maps a market's `resolution_spec` (from
  `market_specs.params`) + the classifier verdict → `resolve` (a specific
  outcome) / `annul` / `continue` / `review` — never guesses (unmapped
  classification → human review). `resolve_test.ts` (7 pure tests, no LLM)
  covers it against the golden labels. **Built + deployed** as the
  domain-agnostic [`resolve-event-markets`](supabase/functions/resolve-event-markets/index.ts)
  watcher: `runWatcher` ([`_shared/resolution/watcher.ts`](supabase/functions/_shared/resolution/watcher.ts))
  dispatches each live `market_spec` to the adapter registered for its
  `event.kind` (court today via
  [`court-adapter.ts`](supabase/functions/_shared/court-resolution/court-adapter.ts);
  FRED/custom = add a sibling adapter, engine unchanged), then **auto-executes**
  confident `resolve`/`annul` verdicts (via `resolve-market`/`annul-market`,
  marks the spec resolved/annulled, logs an `executed` row in
  `resolution_proposals` with evidence); only `review` verdicts / low-confidence
  calls queue as `pending` for a human. Verified end-to-end against the real
  Flaherty docket (affirmed → resolve "Yes"). Not yet on pg_cron (inert until
  Phase B mints live specs). **Automation stance (Lorenzo, 2026-07-12):** the
  whole pipeline runs on autopilot — play-money mistakes are acceptable,
  `annul-market` is the universal undo, and the only human gate is the existing
  real-money one (cycle-payout approval). See survey §15 "Automation model".

### Events data model — schema LIVE (Phase A applied, inert)

Generalization: separate *events* (facts about the world,
heterogeneous) from *markets* (bets, uniform) — the Kalshi `series → event →
market` shape. Layers:

```
domain registries (court_cases, FRED list, …)   noisy, machine-owned, high recall
      │ curation promotes worthy rows
      ▼
events            canonical referent: kind, title, status, details jsonb
      ▼ 1:N
market_specs      bridge + review queue + resolution binding:
      │           event_id, template_id, params jsonb, question, justification,
      │           market_id (once minted), status draft→approved→live→resolved
      ▼ on approval mints
markets/outcomes  existing tables — ONLY change is nullable markets.event_id
```

Design laws: (1) the trading core (`markets`, `outcomes`, `predictions`,
`payouts`, AMM, leaderboard) never learns about domains — no court/FRED columns
ever; (2) jsonb stores *parameters*, git-versioned resolver code stores *logic*
(no resolution DSL). Registry→event promotion is load-bearing: 154 court rows →
~35–40 events; noise never reaches the canonical layer. One event can carry a
market ladder (MTD/cert/outcome; multi-strike FRED). A new domain = registry +
templates + resolver adapter, nothing else changes. Migration path: **(A) DONE**
— `events` + `market_specs` + `markets.event_id` (migration `20260712000000`),
`resolution_proposals` (`20260712000100`), `spec_conditions` +
`events.mutually_exclusive` (`20260713000000`), and `payouts.outcome_id`
nullable (`20260713000100`); all admin-only RLS, LIVE but inert — nothing
writes to the events layer yet. **(B) NEXT** — court pipeline targets it
(promote confirmed+active proceedings → events, draft specs into
`market_specs`, approve → mint markets via `add-market`); (C) optionally
retrofit FRED (event per release). `market_specs.params` carries the
`ResolutionSpec` consumed by [`resolve.ts`](supabase/functions/_shared/court-resolution/resolve.ts).
NB: `event_links` (the `same_matter`/`supersedes` navigation graph in survey
§15) is designed but **not built** — not needed for the market types above;
add it when the matter graph is wanted. Migration history was out of sync
(several migrations applied out-of-band); repaired 2026-07-13, so
`supabase db push` works normally again.
Resolved open questions (all yes): hand-created `kind='custom'` events;
multi-outcome specs for appeals (`outcomes` already supports ≥2); every new
event-linked market requires a spec (legacy/FRED markets exempt via nullable
`event_id`).

Roadmap market types (detailed in
[`market-data-models-survey.md`](market-data-models-survey.md) §7, §15) — the
SCHEMA to hold these is now live (population pipeline = Phase B): (1)
**conditional markets** — a `spec_conditions` row ties a spec to a required
outcome of another spec/event; any condition resolving contrary (or
ambiguous/annulled/abandoned) stages annulment via `annul-market`; multiple
rows = AND ("if A and B, then X"); (2) **multiple-choice markets** — closed
small set → one N-outcome market (`outcomes` supports ≥2, but resolve/AMM
handling of N>2 is **unverified** — a pre-flight check to do), open/large set →
event-grouped binaries under a `mutually_exclusive` event; (3) **combinations**
("if A, then B or C") = a multi-outcome spec + `spec_conditions` rows.
**Deferred by decision:** disjunction (OR conditions — add-back:
`condition_group` column) and nested conditions (the watcher must refuse
condition chains deeper than 1). Full combinatorial *pricing* is permanently
out of scope (Hanson money-pump, survey §8).

Known gaps / design notes:
- Appellate dockets under-match on `party_name` (sparse party data in
  CourtListener's appellate coverage) — needs a supplementary full-text pass.
- **Matter vs. proceeding (core modeling rule):** a *matter* is the underlying
  dispute; a *proceeding* is one docket. Markets attach to **proceedings**, not
  matters. `matter_id` LINKS related proceedings (trial ↔ appeal ↔ cert,
  duplicate/member dockets) but does NOT merge them for market generation.
  **Appeals and cert petitions are always separate proceedings with their own
  markets** — different court, question, and timeline than the trial case. Only
  literal duplicate dockets and MDL member cases consolidated into an `In re`
  actually collapse to one proceeding. The class-action wave
  (Roberts/Reynolds/Risch/Jennings, refiled across districts) folds into `In re
  KALSHI SPORTS PREDICTION MARKET LITIGATION`; consolidation is also an
  annul/merge condition for any per-member markets. Of the current registry:
  ~56 confirmed+active dockets → ~35–40 distinct market-generating proceedings
  (~9 of them appeals).
- States file in state court but the companies remove to federal — so
  CourtListener covers most of the universe; a paid state-court vendor is
  deferred until remand data says otherwise.
- **State-level cases are DEFERRED (revisit later).** CourtListener/RECAP is
  federal-only (PACER). Empirically (Washington v. KalshiEX), when a removed
  case is **remanded to state court** we go blind — no further docket entries.
  So for now: markets on removed cases must **annul at remand**, and we are NOT
  attempting to track/resolve anything once it's in state court. Figuring out
  state-court coverage (a paid vendor, or manual tracking) is a separate future
  workstream, not part of the current CourtListener-based pipeline.
- **Resolution reliability (empirically checked 2026-07-11):** CL docket *text*
  is good enough to detect terminal events (Affirmed/Reversed/Mandate,
  Remanded, Transfer Venue, Denying/Granting) and coverage is current for these
  high-profile dockets. BUT `date_terminated` ≠ merits resolution — 3 of 4
  sampled terminations were remand/transfer/appeal, not a win/loss. Resolution
  MUST classify the terminal entry's text (merits-win / merits-loss / remanded /
  transferred / appealed / voluntarily-dismissed) with
  **annul as a common first-class outcome** — never settle on `date_terminated`
  alone. Classified verdicts auto-execute (automation stance above); the
  classifier's `review` verdict is the human escape hatch.
  Appeals resolve cleanest. Optional: CL **docket alerts** make CL actively poll
  PACER to guarantee the resolving entry appears promptly.
- Secret `COURTLISTENER_API_TOKEN` is SET (EDU-tier token, in Supabase secrets +
  `.env.local`) — unlocks docket-entries/documents endpoints; per-case on-demand
  fetching is cheap under EDU limits.

## Market lifecycle logic & tests (2026-07-13)

Payout math is extracted into one pure, unit-tested module
[`_shared/market-lifecycle/payouts.ts`](supabase/functions/_shared/market-lifecycle/payouts.ts):
`computeResolutionPayouts` (net shares on the winning outcome × $1.00) and
`computeAnnulmentPayouts` (net shares across all outcomes × $0.50; `outcome_id`
null). `resolve-market` and `annul-market` both call it (dry-run *and* real
path) — no more copy-pasted payout loops. All three of `resolve-market`,
`annul-market`, `resolve-fred-markets` accept `{dry_run:true}` to simulate
without writing (see memory `pipeline-dry-run-verification`; `resolve-fred`'s is
shallow — picks the winner, doesn't simulate payouts).

Bug fixed this session: `annul-market` inserted `outcome_id:null` + a phantom
`payout_type` column into `payouts`, which failed against the real schema — so
live annulments credited balances but wrote no payout rows. Fix = nullable
`payouts.outcome_id` + drop `payout_type` (both live + deployed).

Tests (deno; every DB test wraps writes in a rolled-back transaction, safe vs
prod — see [`supabase/tests/README.md`](supabase/tests/README.md)):
- `deno task test` — pure logic, no DB (payout math + court pipeline; 39 tests).
- `deno task test:schema` — events-schema contract vs live DB.
- `deno task test:e2e` — full create → bet → resolve/annul lifecycle vs live DB
  (this is the game-independent E2E that caught the annul bug).
  `test:schema`/`test:e2e` need `DATABASE_URL` + `PGCA` (pooler CA); see the
  tests README.

## Conventions
- Trunk-based: commit straight to `main`, no feature branches (see global prefs).
- `profiles`: `id` (row PK) vs `user_id` (auth uid) — see `documentation.md`; don't conflate.
- Editing an edge function here does nothing until `supabase functions deploy`.
