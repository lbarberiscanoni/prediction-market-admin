# Project TODO

## Requirements
- [ ] R-1 Secure auth & sessions
- [ ] R-2 Event analytics across core flows

## Features (grouped by requirement)
### R-1 Secure auth & sessions
- [ ] F-1.1 Login & Signup UI  (issue #123)
  - [ ] Task: form validation + error states  (issue #201)
  - [ ] Task: invite-only signup gate         (issue #202)
- [ ] F-1.2 Password reset email + token      (issue #124)
  - [ ] Task: request-reset endpoint
  - [ ] Task: verify + reset pages
- [ ] F-1.3 Session hardening (SameSite, rotation) (issue #125)

### R-2 Event analytics
- [ ] F-2.1 Event schema + helpers            (issue #130)
- [ ] F-2.2 Fire events in flows A/B/C        (issue #131)

## Backlog (icebox)
- [ ] “remember me” option

# Architecture

## Custom Types

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
| `web/` | [UI] Next.js pages/components | UI only; no DB calls |
| `api/` | [Domain] HTTP handlers & services | Pure business logic |
| `db/`  | [Data] migrations & seed | Changes must update SCHEMA.md |
| `scripts/` | [Infra] CLIs & jobs | No app imports |

## Module catalog (single line per non-trivial file)
| Path | Role | Key deps | Owner | Tests |
|---|---|---|---|---|
| `web/pages/login.tsx` | login UI | `web/components/AuthForm` | @studentA | `login.spec.ts` |
| `api/routes/auth.ts` | HTTP auth endpoints | `services/auth/*` | @studentB | `auth.routes.spec.ts` |
| `api/services/auth/reset.ts` | reset token logic | `db/*`, emailer | @studentB | `reset.spec.ts` |

## Top flows (human-level)
1. **Sign in:** `login.tsx` → `auth.ts (POST /login)` → `sessions` table → cookie set  
2. **Track event:** UI `analytics.ts` → POST `/events` → queue