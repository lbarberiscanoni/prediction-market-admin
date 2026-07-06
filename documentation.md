# Prophet V3 TODO

## Requirements
- [ ] PayPal payments

## Features (grouped by requirement)
### R-1 PayPal payments
- [ ] F-1.1 Login & Signup UI  (issue #123)
  - [ ] Task: form validation + error states  (issue #201)
  - [ ] Task: invite-only signup gate         (issue #202)
- [ ] F-1.2 Password reset email + token      (issue #124)
  - [ ] Task: request-reset endpoint
  - [ ] Task: verify + reset pages
- [ ] F-1.3 Session hardening (SameSite, rotation) (issue #125)

## Backlog (icebox)
- [ ] “remember me” option

# Architecture

## Custom Databse Types

### Market Status
Enum values: `'open'`, `'closed'`, `'resolved'`, `'annulled'`, `'pending'`

### Payment Types
Enum values: `'PayPal'`, `'MTurk'`

## Schema

### leaderboards
| Column | Type | Null | Default | Index | Notes |
|---|---|---|---|---|---|
| id | bigint | NO | identity | PK | auto-generated |
| created_at | timestamptz | NO | now() |  |  |
| data | jsonb | NO |  |  | leaderboard data |
| calculation_date | date | NO |  |  |  |
| total_users | integer | NO |  |  |  |

**Relations:** None

### markets
| Column | Type | Null | Default | Index | Notes |
|---|---|---|---|---|---|
| id | bigint | NO | identity | PK | auto-generated |
| created_at | timestamptz | NO | now() |  |  |
| creator_id | uuid | NO |  |  | user who created market |
| name | text | NO |  |  |  |
| description | text | YES |  |  |  |
| token_pool | double precision | NO |  |  |  |
| outcome_id | bigint | YES |  |  | FK to outcomes |
| market_maker | text | NO |  |  |  |
| status | Market Status | NO | 'open' |  | enum type |
| tags | text[] | YES |  |  | array of tags |
| close_date | date | YES |  |  |  |
| link | text | YES |  |  |  |
| target | double precision | YES |  |  |  |

**Relations:** `markets.outcome_id` → `outcomes.id` (FK)

### outcomes
| Column | Type | Null | Default | Index | Notes |
|---|---|---|---|---|---|
| id | bigint | NO | identity | PK | auto-generated |
| created_at | timestamptz | NO | now() |  |  |
| market_id | bigint | YES |  |  | FK to markets |
| name | text | YES |  |  |  |
| description | text | YES |  |  |  |
| creator_id | uuid | YES | gen_random_uuid() |  |  |
| tokens | double precision | NO |  |  |  |

**Relations:** `outcomes.id` ← `markets.outcome_id` (FK), `outcomes.market_id` → `markets.id` (FK), `outcomes.id` ← `payouts.outcome_id` (FK), `outcomes.id` ← `predictions.outcome_id` (FK)

### payouts
| Column | Type | Null | Default | Index | Notes |
|---|---|---|---|---|---|
| id | bigint | NO | identity | PK | auto-generated |
| created_at | timestamptz | NO | now() |  |  |
| payout_amount | double precision | NO |  |  |  |
| user_id | uuid | NO |  |  |  |
| market_id | bigint | NO |  |  | FK to markets |
| outcome_id | bigint | NO |  |  | FK to outcomes |

**Relations:** `payouts.market_id` → `markets.id` (FK), `payouts.outcome_id` → `outcomes.id` (FK)

### predictions
| Column | Type | Null | Default | Index | Notes |
|---|---|---|---|---|---|
| id | bigint | NO | identity | PK | auto-generated |
| created_at | timestamptz | NO | now() |  |  |
| user_id | uuid | YES |  |  |  |
| market_id | bigint | YES |  |  | FK to markets |
| outcome_id | bigint | YES |  |  | FK to outcomes |
| trade_type | text | NO | 'buy' |  |  |
| shares_amt | double precision | YES |  |  |  |
| market_odds | double precision | YES |  |  |  |
| trade_value | double precision | YES |  |  |  |

**Relations:** `predictions.market_id` → `markets.id` (FK), `predictions.outcome_id` → `outcomes.id` (FK)

### profiles
| Column | Type | Null | Default | Index | Notes |
|---|---|---|---|---|---|
| id | bigint | NO | identity | PK | auto-generated |
| created_at | timestamptz | NO | now() |  |  |
| user_id | uuid | YES |  |  |  |
| email | varchar | NO |  |  |  |
| username | text | YES |  |  |  |
| balance | double precision | NO | 1000 |  | starting balance |
| absolute_returns | double precision | YES |  |  |  |
| roi | double precision | YES |  |  |  |
| payment_method | Payment Types | YES |  |  | enum type |
| payment_id | text | YES |  |  |  |
| iq | text | YES |  |  |  |
| iq_url | text | YES |  |  |  |
| enable_email_notifications | boolean | YES | false |  |  |

**Relations:** None

## Directory map (one-liners)
| Dir | Role | Notes |
|---|---|---|
| `src/app/` | [UI] Next.js App Router pages | Route handlers & page components |
| `src/components/` | [UI] Reusable React components | Market cards, forms, charts |
| `src/lib/` | [Domain] Business logic & utilities | Market makers, predictions, types |
| `public/` | [Static] Assets & icons | SVG files, static resources |
| `.github/` | [Infra] CI/CD workflows | FRED data automation |

## Module catalog (single line per non-trivial file)
| Path | Role | Key deps | Owner | Tests |
|---|---|---|---|---|
| `src/app/page.tsx` | Landing page | `components/navbar` | - | - |
| `src/app/auth/page.tsx` | Auth UI (login/signup) | `supabase/createClient` | - | - |
| `src/app/auth/callback/route.ts` | OAuth callback handler | `supabase/server-client` | - | - |
| `src/app/markets/page.tsx` | Markets listing page | `components/MarketsList` | - | - |
| `src/app/markets/[id]/page.tsx` | Individual market details | `components/TradeForm, PriceChart` | - | - |
| `src/app/profile/page.tsx` | User profile page | `components/Onboarding` | - | - |
| `src/app/admin/page.tsx` | Admin dashboard | `components/CreateMarket` | - | - |
| `src/app/players/page.tsx` | Players listing | `supabase/createClient` | - | - |
| `src/app/players/[id]/page.tsx` | Individual player details | `supabase/createClient` | - | - |
| `src/app/payments/page.tsx` | Payment management | `supabase/createClient` | - | - |
| `src/app/leaderboard/page.tsx` | Leaderboard display | `components/Leaderboard, ActiveUsers` | - | - |
| `src/app/analytics/page.tsx` | Platform analytics | `recharts, supabase` | - | - |
| `src/app/fred-data/page.tsx` | FRED economic data viewer | `components/AddIndicatorMarket` | - | - |
| `src/app/economic_indicators/page.tsx` | Census Bureau data viewer | `Census API` | - | - |
| `src/app/api/fred/route.ts` | FRED API proxy | `FRED API` | - | - |
| `src/app/api/test-markets/route.ts` | Test markets CRUD | `supabase/createClient` | - | - |
| `src/components/MarketCard.tsx` | Market display component | `supabase, Link` | - | - |
| `src/components/TradeForm.tsx` | Trading interface | `lib/predictions, lib/marketMakers` | - | - |
| `src/components/PriceChart.tsx` | Market price visualization | `recharts, supabase` | - | - |
| `src/components/CreateMarket.tsx` | Market creation form | `lib/addMarket, lib/addAnswers` | - | - |
| `src/components/Leaderboard.tsx` | Leaderboard component | `supabase/createClient` | - | - |
| `src/components/ActiveUsers.tsx` | Active users display | `lib/getActiveUsers` | - | - |
| `src/components/MarketsList.tsx` | Markets listing component | `lib/getMarkets, components/MarketCard` | - | - |
| `src/components/Onboarding.tsx` | User onboarding flow | `supabase/createClient` | - | - |
| `src/components/navbar.tsx` | Site navigation | `components/logout-button` | - | - |
| `src/lib/predictions.ts` | Trading logic | `supabase/createClient` | - | - |
| `src/lib/marketMakers.ts` | Market maker algorithms (CPMM) | None | - | - |
| `src/lib/addMarket.ts` | Market creation logic | `supabase/createClient` | - | - |
| `src/lib/getMarkets.ts` | Market data fetching | `supabase/createClient` | - | - |
| `src/lib/getActiveUsers.ts` | Active user analytics | `supabase/createClient` | - | - |
| `src/lib/calculateLeaderboard.ts` | Leaderboard calculations | `supabase/createClient` | - | - |
| `src/lib/supabase/createClient.ts` | Supabase client setup | `@supabase/supabase-js` | - | - |
| `src/lib/supabase/server-client.ts` | Server-side Supabase client | `@supabase/ssr` | - | - |
| `src/lib/types.ts` | TypeScript type definitions | None | - | - |
| `src/lib/tradingTypes.ts` | Trading-specific types | None | - | - |
| `src/lib/constants.ts` | App-wide constants | None | - | - |
| `.github/workflows/fred-daily.yml` | Daily FRED data automation | Supabase Edge Functions | - | - |

## Top flows (human-level)
1. **User Authentication:** `auth/page.tsx` → Google OAuth → `auth/callback/route.ts` → Supabase session → redirect to dashboard
2. **Market Trading:** `markets/[id]/page.tsx` → `TradeForm.tsx` → `lib/predictions.ts` → Supabase DB updates → balance & token pool updates
3. **Market Creation:** `admin/page.tsx` → `CreateMarket.tsx` → `lib/addMarket.ts` → `lib/addAnswers.ts` → Supabase inserts
4. **Price Discovery:** User trades → `lib/marketMakers.ts` (CPMM) → token pool updates → `PriceChart.tsx` visualization
5. **Leaderboard Calculation:** `analytics/page.tsx` → `lib/calculateLeaderboard.ts` → aggregate user P&L → `Leaderboard.tsx` display
6. **Economic Data Integration:** `fred-data/page.tsx` → `api/fred/route.ts` → FRED API → `AddIndicatorMarket.tsx` → auto-market creation
7. **Payment Processing:** `payments/page.tsx` → MTurk/PayPal APIs → user balance updates → batch payment handling
8. **Market Resolution:** Admin selects winning outcome → `predictions.ts` calculates payouts → user balances updated
9. **Data Analytics:** `analytics/page.tsx` → Supabase queries → `recharts` visualizations → platform metrics display
10. **Automated Market Creation:** `.github/workflows/fred-daily.yml` → FRED API → Supabase Edge Functions → new markets for economic releases

## Leaderboard Bonus Payouts

Participants are paid a **leaderboard-rank bonus** each payment cycle (intended cadence: every 2 weeks). Only users **on the leaderboard** are paid — not all participants. The leaderboard is the **top ~10** users, ranked by performance (P&L), recomputed daily by `calculate-leaderboard`.

### Payout amount by rank

| Rank | Payout (USD) |
|---|---|
| 1st | $3.00 |
| 2nd | $1.50 |
| 3rd | $1.00 |
| 4th and below (on the leaderboard) | $0.50 (base) |

A full top-10 cycle therefore costs **≈ $9.00** ( $3.00 + $1.50 + $1.00 + 7 × $0.50 ).

**Source of truth:** these amounts come from Noah's payout scripts — `BASE_PAYOUT = 0.5` and `PLACEMENT_TOTALS = { 1: 3.0, 2: 1.5, 3: 1.0 }` in `lookup-mturk-leaderboard-assignments.mjs` (`payoutForRank(rank)`). If the schedule changes, update it here **and** wherever the payout job reads it.

### Process (how a payout run works)

Two steps, **human-in-the-loop** (a person reviews and approves before any money moves):

1. **Prepare / dry-run** — fetch a leaderboard, map each member's `rank → amount`, resolve each member's `payment_id`, and print who/how much/total. No money moves. (Noah: `mturk:lookup`.)
2. **Execute** — actually send, only on explicit trigger; defaults to dry-run otherwise. Uses an **idempotency token** (hash of leaderboard id + calculation_date + user_id + rank + amount) so a given cycle/rank cannot be paid twice. (Noah: `mturk:send-bonuses --execute`.)

### PayPal implementation notes

- The leaderboard rows already carry `payment_id` (the PayPal email), so the PayPal path skips all of the MTurk worker-ID / HIT-batch-CSV matching that Noah's scripts needed.
- Pay each leaderboard member via the `send-paypal-payout` Edge Function; log to the `payments` table; `reconcile-payouts` (hourly cron) settles terminal status.
- Members whose `payment_method` is still `MTurk` (or who have no PayPal `payment_id`) are **skipped** and must migrate to PayPal to be paid — this is the point of the MTurk→PayPal migration.