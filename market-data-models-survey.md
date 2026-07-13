# Market data models: Polymarket, Kalshi, Manifold

Survey of how the three major prediction-market platforms structure markets as
data — entity hierarchy, how one schema absorbs market variety (binary,
multi-outcome, scalar ladders, recurring), and how resolution is represented.
Blockchain/settlement mechanics deliberately out of scope.

**Purpose:** design reference for Prophet's proposed `events` / `market_specs`
layer (see CLAUDE.md "Proposed events data model"). Researched 2026-07-11 from
official docs, live public APIs (Polymarket Gamma, Kalshi Trading API v2), and
Manifold's open-source code. Source URLs at the end of each section.

---

## The headline finding

**Polymarket and Kalshi independently converged on the identical architecture:
neither has an N-outcome market object.** Every tradable market is a binary
Yes/No contract; all variety — elections, scalar ladders, multi-candidate
races — is expressed one level up, by grouping binary markets under an
**event** that carries a mutual-exclusivity flag. Manifold is the lone
dissenter: one flexible `Contract` entity (discriminated union) with
first-class multi-outcome answers — and even there, each answer is internally
a full mini binary market.

---

## 1. Polymarket — `Series → Event → Market → 2 tokens`

```
Tag  (flat labels; many-to-many with events & markets)
  ╲
   Series          recurring franchise — "FOMC decisions" (recurrence: monthly)
     │ 1:N
     ▼
   Event           the QUESTION as the user sees it — "Fed decision in September?"
     │ 1:N          carries negRisk = "these child markets are mutually exclusive"
     ▼
   Market          the tradable atom — ALWAYS binary Yes/No
     │ 1:2          carries the resolution prose, dates, prices, groupItemTitle
     ▼
   Token           exactly two per market: Yes token + No token
```

### Event (Gamma API)

| Field | Meaning |
|---|---|
| `id`, `slug`, `ticker` | Identity; slug is the URL key |
| `title`, `description` | The human question ("Who will win the 2024 Presidential Election?") |
| `negRisk` | **Mutual-exclusivity marker**: children are winner-take-all, prices sum to ~1 |
| `negRiskAugmented` | Group can gain outcomes post-launch (placeholder slots + explicit "Other" market) |
| `startDate`, `endDate` | Event window |
| `active`, `closed`, `archived` | Lifecycle **flags** (no status enum) |
| `markets[]`, `series[]`, `tags[]` | Children / parents / categorization |

### Market

| Field | Meaning |
|---|---|
| `question` | The binary question ("Will Norway win the 2026 FIFA World Cup?") |
| `description` | **The resolution criterion, as free prose** — "This market will resolve Yes if…" |
| `resolutionSource` | Free-text authority name; often empty; not machine-readable |
| `outcomes`, `outcomePrices` | Always `["Yes","No"]` + implied probabilities |
| `groupItemTitle` | **Short label this market wears inside its parent event's list** — "Norway", "25 bps decrease", "Trump" |
| `groupItemThreshold` | Sort order within the group (numeric ladders) |
| `negRisk` | Mirrors the parent event's flag |
| `active`, `closed` | Lifecycle flags |
| `umaResolutionStatus` | Oracle pipeline state (proposed / disputed / resolved) |
| `marketType` | Vestigial `normal` \| `scalar` from the old AMM era — modern Polymarket doesn't use true scalars |

### Series

| Field | Meaning |
|---|---|
| `title`, `ticker` | "FOMC", "Bitcoin Hit Price Monthly" |
| `recurrence` | `daily` \| `weekly` \| `monthly` \| `annual` (observed live) |
| `isTemplate`, `templateVariables` | Series acts as a template new events are stamped from |
| `events[]` | All instances (this month's, last month's, …) |

### How variety is handled

- **Binary yes/no**: event containing exactly 1 market, `negRisk: false`.
- **Multi-candidate election**: **one event with N binary markets, one per
  candidate** — NOT one market with N outcomes. `negRisk: true` on the event
  marks winner-take-all. `groupItemTitle` is what renders as the outcome row.
  `negRiskAugmented` handles open candidate lists.
- **Scalar/numeric**: bucketized into a ladder of binary markets under a
  negRisk event ("50+ bps decrease" / "25 bps decrease" / "No change" /
  "Hike"), ordered by `groupItemThreshold`. Non-exclusive thresholds ("BTC
  above $X" for several X) = same shape with `negRisk: false`.
- **Recurring**: each occurrence (March FOMC, May FOMC, …) is its own event;
  all point to the shared series.

### Resolution & lifecycle

Resolution criteria are **pure prose on the market** (`description` +
free-text `resolutionSource`). No machine-checkable spec exists anywhere in
the schema. Lifecycle is boolean flags, not an enum:
**active → closed → (proposed → possibly disputed →) resolved**, tracked via
`active`/`closed` + `umaResolutionStatus`.

### Example: recurring negRisk event (live data, condensed)

```jsonc
// GET gamma-api.polymarket.com/events?slug=fed-decision-in-september
{
  "title": "Fed decision in September?",
  "negRisk": true,
  "series": [{ "title": "FOMC", "recurrence": "monthly" }],
  "tags": [{ "label": "Fed Rates" }, { "label": "Economy" }],
  "markets": [
    { "question": "Fed decreases interest rates by 50+ bps after September 2025 meeting?",
      "groupItemTitle": "50+ bps decrease",
      "outcomes": "[\"Yes\",\"No\"]", "outcomePrices": "[\"0\",\"1\"]" },
    { "question": "Fed decreases interest rates by 25 bps after September 2025 meeting?",
      "groupItemTitle": "25 bps decrease",
      "outcomePrices": "[\"1\",\"0\"]" }   // this bucket won
    // + "No change", "25+ bps increase"
  ]
}
```

Sources: docs.polymarket.com — concepts/markets-events, concepts/resolution,
developers/neg-risk/overview, api-reference/{events,markets,series,tags};
live gamma-api.polymarket.com responses.

---

## 2. Kalshi — `Series → Event → Market`, the most rigorously structured

Same three-level shape as Polymarket, crisper contracts per level:

```
SERIES  "Highest temperature in NYC" (KXHIGHNY)
│  the TEMPLATE: owns recurrence (frequency), category, tags,
│  settlement_sources, rulebook URLs, fee structure
│
├── EVENT  "Highest temp in NYC on Jul 12, 2026" (KXHIGHNY-26JUL12)
│   │  the INSTANCE: owns mutually_exclusive, strike_date|strike_period,
│   │  collateral_return_type (MECNET = netting across exclusive siblings)
│   │
│   ├── MARKET  KXHIGHNY-26JUL12-T82    strike_type: less,    cap_strike: 82   "81° or below"
│   ├── MARKET  KXHIGHNY-26JUL12-B82.5  strike_type: between, floor 82, cap 83 "82° to 83°"
│   └── MARKET  KXHIGHNY-26JUL12-T94    strike_type: greater, floor_strike: 94 "94°+"
│          every market is a BINARY yes/no contract with a structured strike
│
└── EVENT  KXHIGHNY-26JUL13  (next day's instance, same template) …

Side registries:
  STRUCTURED TARGETS — canonical real-world entities (team, player, person)
                       referenced by markets via UUID; trading core never
                       grows domain columns
  MULTIVARIATE EVENT COLLECTIONS — parlays/combos, outside the hierarchy
```

Ticker convention (`KXHIGHNY → KXHIGHNY-26JUL12 → …-B82.5`) is display-only —
Kalshi's docs explicitly warn: use `series_ticker`/`event_ticker` FK fields,
never parse tickers.

### Series

| Field | Meaning |
|---|---|
| `ticker`, `title` | `KXHIGHNY`, "Highest temperature in NYC" |
| `frequency` | Recurrence. Live values across 11,344 series: `one_off` (4601), `custom` (4596), `annual` (1320), `monthly` (308), `weekly` (254), `daily` (208), `hourly` (44), `fifteen_min` (12), `quarterly` (1). ~81% are one-offs that still live in a series — uniformity beats optionality. |
| `category` | Single canonical category (Entertainment, Sports, Politics, Economics, …) |
| `tags` | Multi-valued keywords crossing categories |
| `settlement_sources` | `[{name, url}]` — official resolution sources (e.g. NWS Climatological Report) |
| `contract_terms_url` | Rulebook PDF — the legally binding resolution spec |
| `fee_type`, `fee_multiplier` | Fee structure, overridable per event |

### Event

| Field | Meaning |
|---|---|
| `event_ticker`, `series_ticker` | Identity + parent FK |
| `title`, `sub_title` | Instance title ("…on Jul 12, 2026") |
| **`mutually_exclusive`** | If true, at most one market in the event resolves Yes (ladders, elections). If false, markets are independent questions grouped for display. |
| `collateral_return_type` | `MECNET` on exclusive events: opposing positions across siblings net |
| `strike_date` \| `strike_period` | The date or period the event is about (either/or) |
| `markets[]` | Children (with `?with_nested_markets=true`) |

### Market

| Field | Meaning |
|---|---|
| `ticker`, `event_ticker` | Identity + parent FK |
| `market_type` | `binary` \| `scalar` (scalar = continuous payout via `functional_strike`; overwhelmingly binary in practice) |
| **`strike_type`** | `greater`, `greater_or_equal`, `less`, `less_or_equal`, `between`, `functional`, `custom`, `structured` — how the observed value maps to Yes/No |
| **`floor_strike`**, **`cap_strike`** | Numeric strike bounds |
| **`custom_strike`** | Non-numeric outcomes: map of target-dimension → value, e.g. `{"Holder": "Ben Wikler"}`; for `structured`, values are structured-target UUIDs |
| `rules_primary` | Binding plain-language if-then resolution rule |
| `rules_secondary` | Methodology caveats ("official value is the NWS report, not AccuWeather") |
| `status` | **Full lifecycle enum**: `initialized → (inactive) → active → closed → determined → finalized`, plus `disputed`, `amended` exception states |
| `result` | `yes` \| `no` \| `scalar` \| `""` until determined |
| `expiration_value` | The observed real-world value used for settlement (e.g. `"85.00"`) |
| `can_close_early`, `early_close_condition` | Early determination + prose condition |
| `settlement_timer_seconds` | Determination→settlement delay = dispute window |
| `is_provisional` | Market may be removed after determination if it saw no activity |

### How variety is handled

| Product shape | Encoding |
|---|---|
| Plain yes/no | Event with one market |
| Scalar ladder (CPI, temp) | N sibling binaries carving up the number line: two tails (`less`/`greater`) + `between` buckets; `mutually_exclusive: true` |
| "Who wins?" | One binary per candidate, `strike_type: custom`, `custom_strike: {"Holder": name}`; `mutually_exclusive: true` |
| Entity-referencing (sports) | `strike_type: structured`, UUIDs into structured-targets registry |
| Related-question grab-bag | `mutually_exclusive: false` — grouping is display-only |
| Recurring | Series `frequency` stamps out a new event per period |
| Parlays | Separate multivariate event collections |

### Resolution & lifecycle

Prose + source pointers + **one machine-recorded value**: `rules_primary`/
`rules_secondary` on the market, `settlement_sources` on the series/event,
legal spec in the rulebook PDF. The machine-checkable part is exactly the
strike comparison: one `expiration_value` (e.g. `"85.00"`) mechanically
settles the entire ladder (`T87` → yes, `T94` → no, off the same
observation). `settlement_timer_seconds` gives a dispute window between
determination and settlement.

### Example: mutually exclusive multi-outcome (live, 2026-07-11)

```
SERIES KXNEXTDNCCHAIR   category: "Politics"
EVENT  KXNEXTDNCCHAIR-45   sub_title: "Before Jan 1, 2045"
       mutually_exclusive: true, collateral_return_type: "MECNET"
       settlement_sources: [{name: "the Democratic Party", url: democrats.org}]
34 MARKETS, one per candidate, each binary:
  KXNEXTDNCCHAIR-45-BWIK  strike_type: "custom"  custom_strike: {"Holder": "Ben Wikler"}
  KXNEXTDNCCHAIR-45-JKLE  strike_type: "custom"  custom_strike: {"Holder": "Jane Kleeb"}
  rules_primary: "If Ben Wikler formally holds Chair of the DNC before Jan 1,
  2045, and is the first such subject to do so after Issuance, then the market
  resolves to Yes."
```

Sources: docs.kalshi.com — api-reference/{market,events,structured-targets},
getting_started/{terms,targets_and_milestones}; live
api.elections.kalshi.com/trade-api/v2 responses.

---

## 3. Manifold — one `Contract` entity, discriminated union in jsonb

The UGC platform took the opposite bet: schema flexibility over structural
guarantees. Everything (including non-tradeable polls and bounties) is one
entity, `Contract`, discriminated on **two axes**: `outcomeType` (what kind of
question) × `mechanism` (how it's priced).

```
Contract  =  SharedFields  &  one variant of:

├── mechanism: 'cpmm-1'          (single binary CPMM pool)
│     ├── BINARY
│     ├── PSEUDO_NUMERIC   (numeric mapped onto one probability, min/max/log-scale)
│     └── STONK            (never closes/resolves)
├── mechanism: 'cpmm-multi-1'    (N answers, each its own binary CPMM pool)
│     ├── MULTIPLE_CHOICE
│     ├── NUMBER / MULTI_NUMERIC  (numeric via bucket-answers)
│     └── DATE
├── mechanism: 'none'            (no trading)
│     ├── BOUNTIED_QUESTION
│     └── POLL
└── legacy: dpm-2 (FREE_RESPONSE, NUMERIC) — readable forever, cutoff 2023-08

Persistence: whole object in a `data` jsonb column; ~a dozen promoted native
columns for querying (slug, outcomeType, mechanism, closeTime, resolution, …).
The union is enforced in application code, not the schema.
```

### Shared Contract fields (selection)

| Field | Meaning |
|---|---|
| `creatorId` + denormalized name/username/avatar | Creator is on the contract |
| `question` (120 chars), `description` (16k rich text) | **Resolution criteria live in description, as prose** |
| `closeTime?` | Optional; creator-editable (moving it into the future reopens a market) |
| `isResolved`, `resolution?`, `resolutionTime?`, `resolutionProbability?`, `resolverId?` | `resolverId ≠ creatorId` when a mod resolves |
| `visibility`, `deleted?`, `isRanked?` | Moderation = layered flags, not lifecycle states |
| `token: 'MANA' \| 'CASH'`, `siblingContractId?` | Sweepstakes twin of the same question = a second contract row |
| `groupSlugs?` | Deprecated — use the `group_contracts` join table |

### Multi-outcome: the `Answer` entity

Answers are **rows in a separate `answers` table** referencing `contractId`,
denormalized into `contract.answers` for clients. From the code comment on
`CPMMMulti`: *"Implemented as a set of cpmm-1 binary contracts, one for each
answer."* So **each Answer is a full mini binary market**: its own pools,
`prob`, liquidity, volume — and its own resolution fields (`resolution`,
`resolutionTime`, `resolverId`). Plus `index` (ordering), `userId` (who added
it), `text`, `isOther?`, `midpoint?` (numeric buckets).

**`shouldAnswersSumToOne`** switches economic regimes on one schema:

- `true` → **mutually exclusive**: arbitrage keeps probs summing to 100%; one
  resolution event with weights in `resolutions: {answerId: pct}` (can split
  60/40); automatic **"Other"** answer absorbs unlisted candidates; max 100.
- `false` → **independent**: each answer is a free-standing yes/no market,
  resolving individually while the rest keep trading; max 200.

**Dynamic outcome sets**: `addAnswersMode: 'DISABLED' | 'ONLY_CREATOR' |
'ANYONE'` — anyone can add candidates at runtime; the "Other" pool makes this
economically coherent (new answers split out of Other). Neither Kalshi nor
Polymarket allows this.

### Resolution & lifecycle

**No status enum exists.** Lifecycle is derived at read time:

```
open     = !isResolved && (closeTime == null || closeTime > now)
closed   = !isResolved && closeTime <= now
resolved = isResolved
```

No auto-close job — closing is the clock passing `closeTime`.

- `resolution: 'YES' | 'NO' | 'MKT' | 'CANCEL'` — **MKT** = partial resolution
  at `resolutionProbability`; **CANCEL** = N/A, everyone refunded (the
  `annulled` equivalent, but just another resolution value, not a state).
- **Creator-as-oracle**: creator resolves their own market; mods can
  resolve/unresolve others'. Creator may unresolve only within 10 minutes;
  mods anytime. Mistakes are handled socially (mod escalation), not
  structurally.

### Grouping & (non-)series

- **Groups/Topics**: first-class entity, many-to-many via `group_contracts`
  join table, max 5 per market, membership with roles.
- **No series concept — confirmed.** Recurring questions ("…in July?" /
  "…in August?") are unrelated contract rows tied together only by naming
  convention and shared groups. Manifold visibly pays for this in orphaned
  recurring questions and copy-pasted ladders.
- Cost of the flexible approach, visible in the type: dating-app fields
  (`loverUserId1/2`), a Sports mixin, Twitch flags leaked into the core
  Contract — the "trading core learns about domains" anti-pattern.

Sources: docs.manifold.markets/api; github.com/manifoldmarkets/manifold —
common/src/contract.ts, common/src/answer.ts, common/src/group.ts,
backend/api/src/unresolve.ts.

---

## 4. Side-by-side

| | Polymarket | Kalshi | Manifold |
|---|---|---|---|
| Hierarchy | Series → Event → Market | Series → Event → Market | Contract (+ Answer rows), flat |
| Tradable atom | Binary market, always | Binary market, always | Contract or per-answer pool |
| Multi-outcome | N binary markets under event | N binary markets under event | N Answer rows under contract |
| Exclusivity marker | `negRisk` on event | `mutually_exclusive` on event | `shouldAnswersSumToOne` on contract |
| Scalar/numeric | Bucketized binary ladder | Bucketized ladder w/ structured strikes (`floor`/`cap`) | Bucketized answers (NUMBER/DATE) |
| Recurrence | Series w/ `recurrence` + template flags | Series w/ `frequency`; template is the design center | None — copy-paste + naming convention |
| Resolution spec | Prose only (`description`) | Prose + `settlement_sources` + machine-readable strike | Prose only; creator-as-oracle |
| Lifecycle | Boolean flags, no enum | Full status enum incl. `disputed`/`amended` | Derived from timestamps, no state |
| Open outcome lists | `negRiskAugmented` + "Other" market | No (new markets added by Kalshi) | `addAnswersMode` + auto-"Other" answer |
| Domain entities | — | Structured-targets registry (UUID refs) | Leaked into core type (anti-pattern) |

## 5. Implications for Prophet's events/market_specs design

1. **"The trading core never learns about domains" is the industry
   consensus.** Kalshi enforces it hardest — the structured-targets registry
   referenced by UUID is precisely our domain-registry layer. Manifold is the
   cautionary counterexample (dating fields in the core Contract type).
2. **Our `events` table maps 1:1 onto Kalshi/Polymarket events**, including
   where mutual exclusivity should live: on the event/group, never on the
   market. Ladders (multi-strike FRED) = N binary markets under one event
   with an exclusivity flag — meaning the existing binary `markets`/`outcomes`
   core needs **zero changes** to support them. Strong confirmation of
   migration-path step (A).
3. **A machine-checkable resolution spec would exceed all three platforms.**
   Polymarket and Manifold are 100% prose; Kalshi's strike fields
   (`strike_type` + floor/cap + one recorded `expiration_value` settling a
   whole ladder) are the closest existing thing to our "jsonb params +
   versioned resolver code" idea — and they stop at numeric comparison.
   Kalshi's `settlement_sources: [{name, url}]` on the series is worth
   stealing verbatim.
4. **Kalshi's series answers the recurrence question**: template owns
   frequency/sources/rules/category; instance owns only its date and
   exclusivity semantics. That's the FRED retrofit (event per release) in the
   wild. Also instructive: 81% of Kalshi series are one-offs that still live
   in a series — uniformity beats optionality.
5. **Worth adopting, not in the original design notes**: (a) an explicit
   "Other"/augmented-outcomes mechanism if court events might grow outcomes
   after launch (both Polymarket and Manifold needed one); (b) Kalshi's
   `disputed`/`amended` lifecycle states and its determination→settlement
   delay window — a structural analog of our never-auto-resolve
   pending-approval resolution queue.

---

## 6. Appendix: Gnosis Conditional Tokens Framework (the layer under Polymarket)

From the Gnosis "short primer on Conditional Tokens" (developer portal). CTF is
the substrate Polymarket's `conditionId` / `clobTokenIds` fields sit on — the
layer *below* the Gamma API objects in §1. Blockchain mechanics still out of
scope; what matters here is the abstraction, which is worth studying on its
own.

### The core abstraction is a `condition`, not a market

A condition is the pure question, identified by hashing exactly three things:

- an **oracle** — who will answer,
- a **questionId** — opaque reference to the question,
- an **outcomeSlotCount** — how many mutually exclusive outcome slots it has.

Deliberately absent: prices, trading, close dates, question text. The
framework only knows "some authority will eventually distribute 100% of value
across N slots." The "trading core never learns about domains" law, enforced
one level lower than any of the three platforms.

### Resolution is a payout vector, not a winner

The oracle reports a vector of payout numerators across the N slots — `[1, 0]`
for a clean Yes, but equally `[0.5, 0.5]` or any split. Partial resolution
(Manifold's `MKT`, Polymarket's rare 50/50) is not a bolted-on special case;
it is the *native shape* of resolution, and binary win/lose is the degenerate
vector. Annulment (equal refund) is just another vector, not a separate code
path.

### Outcomes are combinatorial positions

A position = collateral + a *collection* of outcome slots, possibly across
**multiple conditions** — split on condition A, split each piece again on
condition B, yielding deep positions like "Yes-A AND Yes-B." This is the
machinery for conditional/combinatorial markets ("if X is nominated, will
they win?"), which Kalshi rebuilt centrally as multivariate event collections
(parlays). Index sets (bitmasks over slots) let one condition's N slots trade
in coarser buckets (`{A|B}` vs `{C}`) without minting new conditions.

### Split/merge at par is what makes grouping work

Collateral always splits into a full outcome set and a full set merges back
into collateral, 1:1. This is the mechanical reason Polymarket's negRisk
groups keep prices summing to ~1 — arbitrageurs split/merge whenever the
group drifts. I.e. the `negRisk: true` flag in §1 isn't enforced by the event
object at all; it's enforced economically by this layer.

### How the layers stack (and the Prophet mapping)

Each Gamma "market" is one CTF condition with `outcomeSlotCount = 2`; the
Event/Series/negRisk structure is entirely an off-chain editorial layer over
uniform binary conditions:

```
CTF condition   (oracle, questionId, N slots)      ≈ resolver binding (market_specs)
  → market      (prose, dates, prices)             ≈ markets/outcomes
    → event     (grouping, exclusivity)            ≈ events
      → series  (recurrence, template)             ≈ registry/templates
```

### Takeaways for Prophet

1. **Identify the question separately from the market.** CTF's
   `(oracle, questionId, outcomeSlotCount)` triple is a clean precedent for
   `market_specs` carrying a stable identity independent of the minted
   market — resolution binds to the question, not to the tradable wrapper.
2. **Store resolution as a payout vector.** Even if the UI only ever produces
   `[1,0]` or the annul-refund vector, a distribution keeps partial/split
   outcomes (settlements, mixed appellate rulings — very plausible for court
   markets) representable without schema change. `resolve-market`'s single
   winning `outcome_id` is the degenerate case of this.

Source: "A short primer on Conditional Tokens," Gnosis Developer Portal
(docs.gnosis.io / conditional tokens docs).

---

## 7. Design roadmap additions (Lorenzo, 2026-07-11)

Three concepts to fold into the events/market_specs design. The unifying frame
(from the SciCast-style "linked questions" graph and the branching life-paths
picture): **events are nodes in a dependency graph; these are three kinds of
edges.** A conditional market prices one branch of the tree to the right of
"today."

### 7.1 Conditional markets (precondition → annul)

*"If a market's precondition (not its outcome) doesn't occur, the market is
annulled."* — e.g. "Will the injunction be upheld on appeal?" presupposes an
appeal is filed; no appeal → annul, refund everyone.

- **Prior art:** Polymarket/Kalshi handle this purely in prose ("if X does not
  occur, this market resolves N/A"); CTF handles it structurally (a position's
  collateral is itself an outcome token of another condition). Manifold uses
  `resolution: CANCEL` socially.
- **Proposed shape:** structural but minimal — on `market_specs` (or
  `events`): nullable `precondition_event_id` + `precondition_outcome` +
  `on_precondition_failure: 'annul'`. When the precondition event resolves
  the wrong way, the watcher **stages** annulment into the pending-approval
  resolution queue (never auto-annuls, consistent with phase-3 law). The
  `annul-market` edge function is already the execution mechanism — this is
  just a trigger wired to it.
- Note we already have one instance of this rule in prose: MDL consolidation
  as an annul/merge condition for per-member court markets. This generalizes
  it.

### 7.2 Multiple-choice markets

Two proven encodings from the survey; pick per case:

- **Event-grouped binaries** (Kalshi/Polymarket consensus): N Yes/No markets
  under one event with an exclusivity flag. Right for open-ended or long
  outcome lists (ladders, "who wins"), needs zero changes to the trading
  core, and gets an "Other" bucket pattern for free.
- **One market with N outcomes**: `outcomes` already supports ≥2 per market
  (CLAUDE.md open question, leaning yes). Right for small closed sets —
  e.g. appeal outcome: affirm / reverse / vacate-remand. Requires the AMM and
  resolve path to handle N outcomes cleanly; verify the public platform's AMM
  before committing.
- Rule of thumb: **closed small set → N-outcome market; open or large set →
  event-grouped binaries with `mutually_exclusive` flag.**

### 7.3 Combination markets ("If A, then B or C")

Structurally the composition of 7.1 + 7.2: a multi-outcome market whose
precondition edge points at event A ("Given the motion to dismiss is denied
(A): settlement (B) or trial verdict (C)?").

- **Prior art:** CTF deep positions (split on condition A, then again on B/C)
  do this natively; Kalshi rebuilt it centrally as multivariate event
  collections (parlays). Full combinatorial *trading* (cross-market
  arbitrage, LMSR over the joint distribution) is explicitly out of scope —
  it's what SciCast did and it's a research project, not a feature.
- **Proposed shape:** no new market machinery. What's needed is the **edge
  table**: `event_links (from_event_id, to_event_id, link_type)` with types
  like `precondition`, `same_matter`, `supersedes`. `court_cases.matter_id`
  is already a hand-rolled special case of this (trial ↔ appeal ↔ cert);
  generalizing it to typed event edges gives conditional markets (7.1),
  combinations (7.3), and the linked-questions navigation graph in one
  structure.

**Sequencing suggestion:** 7.2's grouped-binary form falls out of the `events`
layer already planned (step A); 7.1 needs only the precondition columns +
watcher rule; 7.3 needs the edge table, which also subsumes 7.1's FK. So the
build order is: events layer → `event_links` → precondition-annul rule →
multi-outcome specs.

---

## 8. Hanson 2003 — Market scoring rules (LMSR) and combinatorial markets

Robin Hanson, "Combinatorial Information Market Design," *Information Systems
Frontiers* 5:1 (2003). The foundational mechanism-design paper behind LMSR;
also the reason §7.3 marks full combinatorial trading as a research project.

### The mechanism: a scoring rule that becomes an AMM

A scoring rule pays one person to reveal their probability estimate. Hanson
makes it *sequentially shared*: anyone can update the current consensus
distribution at any time and is paid `s(new report) − s(previous report)` —
each user pays off the previous one, and the patron only ever pays the last.
With one participant it degenerates to a plain scoring rule (**solving the
thin-market problem** — a lone expert can still move the price and be paid
for it); with many it is an automated market maker (solving the scoring
rule's opinion-pooling problem). Thin markets are Prophet's actual operating
regime — a small play-money platform trading court dockets will have markets
where exactly one person knows anything. An order book dies there; a market
scoring rule doesn't.

### Bounded, quantifiable subsidy

The patron's worst-case loss under the logarithmic rule is `b ×` the entropy
of the initial distribution. Prophet's house-seeded AMM (10000 tokens per
outcome) is playing the patron role; this is the accounting for it. Bonus
theorem: one market maker over the entire *joint* state space costs no more
to subsidize than separate per-variable market makers (joint entropy ≤ sum
of marginal entropies).

### The log rule is uniquely modular — mechanism-level conditional markets

Under the logarithmic rule, betting on `p(A|B)` (trade "Pays $1 if B" for
"Pays $1 if A∧B") moves the conditional **without disturbing `p(B)`** — and
the log rule is the *only* rule with this property. That trade construction
pays out only in B-worlds and is effectively refunded if B never occurs:
**exactly §7.1's precondition-annul market, implemented economically rather
than administratively.** Our design does with an annulment edge + refund what
LMSR does natively with conditional assets. Hanson motivates it with decision
markets ("chance of war given we elect X") — the price-one-branch-of-the-tree
idea.

### Why full combinatorial markets stay out of scope

With N variables the state space is exponential; beyond ~30 binary variables
exact computation fails. Approximating is worse than infeasible: if the
market maker quotes approximate probabilities, anyone who finds a systematic
pattern in the approximation error can **arbitrage the patron into a money
pump**. Hanson's two mitigations:

1. Restrict to exactly-computable structures (nearly singly-connected Bayes
   nets) and only accept bets on probabilities computable exactly.
2. **Overlapping market makers**: several MSRs over overlapping variable
   subsets, each internally exactly consistent, with inconsistencies
   *between* them left as bounded arbitrage profit for users. Total loss
   bounded by the sum of subsidies. This is the principled generalization of
   how Polymarket's negRisk groups actually stay coherent (per-market pricing
   + split/merge arbitrage, §6).

Also notable: **sawtooth assets** for scalars — cutpoint-based assets with
linear interpolation, so the same asset set supports both expected-value bets
and "if X is near v" conditions, with cutpoints refinable on the fly (the
principled version of Polymarket's `negRiskAugmented` adding buckets
post-launch). The collateral machinery (reusing past bets as collateral,
proofs of coverage) is the least relevant part — it only matters when
positions span a mutating joint distribution, which no surveyed platform
attempts.

### Takeaways for Prophet

1. **LMSR is arguably the right AMM for Prophet's regime** — subsidized,
   play-money, chronically thin markets is exactly the setting it was
   designed for. Check what the sibling public app's AMM actually is before
   this becomes a recommendation.
2. Sharpens §7.3's boundary: the *data model* for combinations
   (`event_links`) is cheap and safe; *pricing* combinations is where the
   money-pump dragons live. If linked markets are ever priced jointly, the
   overlapping-market-makers pattern is the only battle-tested shape.

---

## 9. Higher-order forecasts (Gooen / QURI, 2024)

Ozzie Gooen, "Higher-Order Forecasts," Quantified Uncertainty Research
Institute blog, 2024-05-22
(quantifieduncertainty.org/posts/higher-order-forecasts/).

### The idea

**An Nth-order forecast is a forecast about an (N−1)th-order forecast.**
Order 0 = ground truth; order 1 = a normal market; order 2 = a question whose
*referent is itself a forecast*: "How many predictions will question X
receive?", "How correlated will the GDP-2024 and GDP-2025 forecasts be?",
"If question Q were posted with a 100k Mana subsidy, what would its price be
after a month?". Order 3 stacks again. Analogy: financial derivatives on an
underlying. Claimed uses: measure forecaster overconfidence, price the
*information value* of questions (which deserve subsidy), surface
correlations, all on existing platform infrastructure. Caveats: needs a deep
base of first-order activity; accuracy problems cascade upward. **Notably
absent from the post: manipulation/self-reference risk** — a market about
your own market's price is the easiest thing on a platform to manipulate,
since betting the underlying moves the meta-market's resolution value.

### How it connects

1. **A fourth kind of edge in the question graph.** §7's edges point between
   events about the world; higher-order forecasts add an edge pointing at
   the platform itself — an event whose referent is a market/forecast. Cost
   in our model: ~nothing. `events.kind = 'market'` (or a
   `references_market_id` in details jsonb) + the same `event_links` table.
   Design law survives: "our own markets" is just one more domain registry —
   one we fully control.
2. **Meta-markets are the easiest markets to resolve — the inverse of the
   court pipeline.** "How many predictions will market X receive by date D?"
   resolves with a SQL query against our own `predictions` table. No
   CourtListener, no FRED, no LLM, no review queue. If we want to pilot the
   events/market_specs machinery end-to-end with a trivially
   machine-checkable resolver, second-order markets on Prophet's own
   activity are the cheapest possible domain.
3. **The poor-man's combinatorial market.** Hanson prices correlations
   natively via the joint distribution (intractable, §8); a 2nd-order
   question "how correlated will forecasts X and Y be?" outsources the
   joint-distribution computation to human bettors, one pairwise question at
   a time, bounded subsidy, zero new mechanism.
4. **Closes a loop with Hanson on subsidy allocation**: the LMSR patron has
   no way to know *which* questions merit patronage; 2nd-order
   "how valuable/active will this question be?" markets price exactly that.

Practical ranking: #2 is actionable soon (pilot domain for the events
layer); #1 is a one-line generalization; #3–#4 are someday-tier alongside
combinatorial pricing.

---

## 10. pm-AMM (Paradigm, 2024) — AMM design for outcome tokens

Ciamac Moallemi & Dan Robinson, "pm-AMM: A Uniform AMM for Prediction
Markets," Paradigm, 2024-11-05 (paradigm.xyz/writing/pm-amm).

### The problem

Outcome tokens ($1-or-$0 at a known expiry) are a weird asset class:
volatility depends on both current probability and time remaining — as
expiry approaches the price must collapse to 0 or 1, so late-market
information is maximally toxic to whoever quotes prices. Both CPMM
(Manifold's mechanism) and LMSR suffer **loss-versus-rebalancing (LVR)** —
steady bleed to arbitrageurs picking off stale quotes — and both concentrate
it at extreme prices (near $0.01/$0.99, 20–40% of pool value per unit time).

### The model and the fix

Model the token as a derivative on a Brownian "score" (point differential,
polling margin): price = Φ(score / remaining volatility) — **Gaussian score
dynamics**. Scope condition, per the authors: fits domains where information
arrives continuously (sports, elections); explicitly does *not* fit one-shot
surprise events.

- **Static pm-AMM**: the invariant that makes LVR *uniform* — proportional to
  pool value at every price instead of exploding at the tails. Liquidity
  concentrates near 50/50.
- **Dynamic pm-AMM**: additionally shrink liquidity as expiry approaches
  (∝ √(time remaining)), so expected loss *rate* is constant over the
  market's life instead of accelerating at the end. Cost: less depth when
  trading demand often peaks.

### Relation to §8, and takeaways for Prophet

pm-AMM answers a different question than Hanson: LMSR asks "how does a
*patron who expects to lose* buy information efficiently?" (Prophet's
world — house-subsidized play money); pm-AMM asks "how does a
*profit-seeking LP* survive outcome tokens?" (on-chain Polymarket world). It
doesn't displace LMSR as the fit for Prophet, but two insights transfer:

1. **In play money, LVR doesn't vanish — it becomes leaderboard distortion.**
   The house AMM's arbitrage losses are exactly the tokens snipers farm by
   picking off stale prices right before close/resolution (e.g. betting a
   FRED market minutes before the release). Not a monetary loss, but
   corrupted leaderboard P&L — and the leaderboard pays real PayPal bonuses.
   The dynamic pm-AMM move — **decay AMM depth as `close_date` approaches** —
   is the principled, cheap defense.
2. **Court markets fail the model's own scope condition — informative.**
   Docket events are lumpy jumps (a ruling drops, probability teleports),
   precisely the excluded case. No AMM curve survives a jump; the defense is
   operational: pause/thin trading when a new docket entry lands. The planned
   phase-3 `resolve-court-markets` watcher already classifies new docket
   entries — "pause trading" is the same trigger wired to one more action.

Schema impact is minimal, consistent with everything else here: AMM choice is
market-level *config*, not structure — at most a `liquidity_param` (and
optionally a decay policy) per market, with `close_date` as the time input.

---

## 11. Metaculus — the richest question ontology (researched 2026-07-11)

Sources: open-source repo `Metaculus/metaculus` (Django models: `questions/models.py`,
`posts/models.py`, `projects/models.py`, `questions/services/lifecycle.py`),
API docs, FAQ, question-writing guide. Metaculus is a forecasting platform
(no trading), but its question schema is the richest in the industry.

### Entity hierarchy: Post (container) vs Question (forecastable unit)

```
Project   (site_main | tournament | question_series | category | topic | …)
   ▲ default_project (owns permissions/visibility) + projects M2M
 Post ──── the CONTAINER: title, author, curation workflow, votes, comments.
   │       Exactly ONE payload (OneToOne):
   ├── question ────────► Question                    (simple post)
   ├── group_of_questions ► GroupOfQuestions ► Question × N   (subquestions)
   ├── conditional ─────► Conditional (4 question refs — see below)
   └── notebook ────────► Notebook   (essay, no forecasting)
```

Why the split: four payload shapes share one social/curation surface; a group
post has one comment thread but N independently scored questions;
conditionals reference questions living on *other* posts; and **curation
state is per-post while forecasting state is per-question**. Post lifecycle
fields (`open_time`, `resolved`, …) are pseudo-materialized rollups computed
from child questions (group close = max of children; conditional resolved =
condition AND child resolved).

### Question types and the continuous representation

Five types: `binary`, `multiple_choice`, `numeric`, `date`, `discrete`.
Continuous questions carry a machine-readable range envelope — `range_min`,
`range_max` (dates as unix ts), `open_lower_bound`/`open_upper_bound` bools,
`zero_point` (non-null ⇒ log scaling), `unit`, `inbound_outcome_count` — and
forecasts are **full 201-point CDFs**, not bucket bets (`cdf[0] = P(x <
range_min)`; closed bounds force 0/1 at the ends; the user's raw slider
params are kept separately in `distribution_input` jsonb). Contrast: markets
discretize continuous quantities into separate binary bucket markets;
Metaculus stores one coherent distribution per forecaster. The range envelope
is a reusable spec shape for numeric-threshold market ladders.

### Conditional pairs — first-class "If A, then B?" (the crown jewel)

The whole model is 4 FKs:

```python
class Conditional:
    condition        # FK → parent question A (must be binary; lives on another post)
    condition_child  # FK → child question B (lives on another post)
    question_yes     # OneToOne → freshly minted branch: P(B | A=yes)
    question_no      # OneToOne → freshly minted branch: P(B | A=no)
```

Plain FKs on condition/child mean one question can parent many conditionals.
The **resolution cascade** (`lifecycle.py::resolve_question`) is the exact
semantics our §7.1/§7.3 needs:

| Event | question_yes | question_no |
|---|---|---|
| Parent resolves Yes (child open) | stays open → closed, awaiting child | **resolved `annulled`** — not scored |
| Parent resolves No (child open) | **annulled** | closed, awaiting child |
| Child then resolves R | surviving branch resolves to R | — |
| Parent OR child resolves ambiguous/annulled | **both branches annulled** | |
| Child resolves first (parent open) | both branches close (freeze), resolve when parent does | |

Note: upstream ambiguity propagates as `annulled` (not `ambiguous`) — the
branches' *assumption* failed; reality wasn't unclear about them. And there
is a full `unresolve_question` inverse that un-winds the cascade — 
**re-resolution is a designed-for operation**, not a hack. Conditionals
cannot nest.

### Question groups

The group declares its varying dimension once (`group_variable` — "Date",
"Candidate"); each subquestion carries `label` (its coordinate) and
`group_rank` (ordering). Subquestions are fully independent questions (own
type, range, times, resolution — partial resolution of a group is normal).
Group probabilities are deliberately **not** constrained to sum to 100% —
the FAQ draws the exact line: multiple choice = one question, mutually
exclusive + exhaustive; group = bundle of related-but-independent questions.
Richer than a bare exclusivity flag: the group names the dimension and each
child's coordinate.

### Resolution: ambiguous vs annulled, and structured prose

Resolution is one nullable text column with **typed, validated values**:
`yes`/`no`, an option string (validated against `options_history`, so
renamed options still resolve), a numeric/date value in range,
`below_lower_bound`/`above_upper_bound` (rejected if that bound is closed),
or two first-class void states:

- **`ambiguous`** — *reality is unclear*: conflicting reports, source
  vanished.
- **`annulled`** — *reality is clear but the question is broken*:
  underspecified method, subverted assumptions (the presupposed world-change
  didn't happen), imbalanced incentives. Conditional branches whose parent
  went the other way are the canonical annulment.

Both → not scored, excluded from leaderboards *by resolution value* (nothing
deleted). Authoring is **structured prose** — four fields with distinct
contractual roles: `title` (must not mislead), `description` (background),
`resolution_criteria` (the binding contract), `fine_print` (edge-case
clauses kept out of the main criteria). The FAQ calls criteria "akin to a
legal contract."

### Time model and lifecycle

Six timestamps: `open_time`, `scheduled_close_time`, `actual_close_time`,
`scheduled_resolve_time`, `actual_resolve_time` (when the answer became
*knowable* — admin-supplied, can be in the past), `resolution_set_time`
(when the admin recorded it). On resolution, `actual_close_time` snaps back
to min(scheduled_close, actual_resolve) **so forecasts made after the answer
was knowable can't score** — the scoring-layer version of our
sniping/leaderboard-distortion concern (§10). Plus `cp_reveal_time` (hide
the community prediction early, anti-anchoring).

Two orthogonal state machines: **curation** on the Post (`draft → pending →
approved/rejected`, reviewer recorded in `curated_last_by`, approval
requires setting the question's whole calendar) and **forecasting** on the
Question (upcoming/open/closed/resolved — *computed from timestamps, never
stored*). The curation machine is a ready-made shape for our phase-2 review
queue.

### What Metaculus adds beyond Polymarket/Kalshi/Manifold

1. Container/unit separation with a typed payload discriminator ≈ our
   events-vs-markets split, proven.
2. Conditional pairs as first-class schema with a deterministic
   annul-the-counterfactual cascade + reversible unresolve.
3. Annulled vs ambiguous as distinct void states with a documented taxonomy
   of causes.
4. Structured resolution authoring (criteria vs fine-print) + typed,
   validated resolution values.
5. A real six-timestamp time model with anti-late-scoring snapback.
6. Review as a state machine orthogonal to market lifecycle.

---

## 12. Augur v2, PredictIt, Futuur (researched 2026-07-11)

### Augur v2 — one parameterized market, tradable Invalid, and the template system

**One Market contract, three thin presets.** `YES_NO` / `CATEGORICAL` (2–8
outcomes) / `SCALAR` differ only in `numOutcomes`, `numTicks`, and a
min/max `prices` pair. Settlement is a **payout vector** (`payoutNumerators`
summing to `numTicks`): YES on a binary = `[0,0,100]`; a scalar resolving
40% up-range = `[0,60,40]`. One representation covers all types *and*
partial payouts — third independent convergence on resolution-as-vector
(with CTF §6 and Betfair §13).

**INVALID as a tradable outcome — the v2 headline.** `Market.sol:69`:
`_numOutcomes += 1; // The INVALID outcome is always first`. The v1 failure
this fixed is the canonical natural experiment against administrative
annulment under adversarial creation: v1 treated invalid as a settlement
rule (all outcomes pay equally), so attackers created deliberately ambiguous
markets, bet the longshot at 5¢, and collected the 50¢ equal split when it
resolved Invalid — invalidity risk existed in every trade but was invisible
and unpriced, and the best-informed trader was the market's own author. v2
makes `P(Invalid)` a live price on every market: spotters of a trap bid it
up (getting paid instead of the scammer), the price doubles as a warning
label, and the UI auto-filters markets whose Invalid price is elevated.

*Relevance to §7.1:* our refund-on-annul is safe **because** creation is a
trusted pipeline and annulment criteria are supposed to be machine-checkable
ex ante. The discipline to import: **write annulment preconditions into the
resolution spec at creation time** (so "would this refund?" is answerable
before listing, never at post-hoc admin discretion), and treat priced
invalidity as the known-good upgrade path if market creation ever opens up.

**The template system — the most complete prior art for our phase-2 template
library** (`packages/augur-tools/src/templates-template.ts`):

- A template = `{hash, marketType, question, inputs[], resolutionRules, …}`
  with fill-in-the-blank slots: `"Will [0] win the [1] presidential
  election?"`.
- **Typed slots** (`TEXT`, `DATEYEAR`, `DATETIME`, `ESTDATETIME`, `DROPDOWN`,
  `ADDED_OUTCOME` for forced "Other" outcomes, dependent dropdowns) with
  per-slot regex validation, plus **declarative cross-field temporal
  constraints** — `dateAfterId`, `daysAfterStartDate`,
  `eventExpEndNextMonth`, weekend/holiday exclusion tables — i.e. the
  template machine-checks *event time + buffer ≤ market close*, the #1
  cause of invalid markets (and exactly the failure mode of our
  "X-by-date" court templates).
- **Hash-locked resolution clauses**: canned `resolutionRules` attached to
  the description, sha256-hashed so they can't be silently edited.
- **Provenance on the minted market**: `extraInfo.template = {hash,
  question, inputs: [{id, type, value}]}` + a validation table keyed by
  template hash, so *any client at resolution time* can recompute whether
  the market is a faithful instantiation. Unfaithful markets are flagged as
  custom.
- A `RetiredTemplate {hash, autoFail}` kill list for templates later found
  flawed.

Map to our design: `market_specs.template_id + params jsonb` ≈
`template.hash + inputs`. Adopt: (1) store a template+params **hash** on the
minted market; (2) declarative date-arithmetic constraints in template
definitions; (3) a retired/auto-fail flag on templates.

**Resolution state machine** (shape): designated reporter (24h) → open
reporting → dispute rounds (a dispute = a *competing payout vector with a
bigger bond*; ~2× escalation, max 20 rounds) → fork → finalized. Shape
observation worth stealing: **a report and a dispute are the same data
structure** (payout vector + stake).

### PredictIt — grouping as margining

Two-level tree: market (the question group) → contracts (one binary order
book per candidate, each with four-sided best-price summary and per-contract
`dateEnd`/`status` — contracts close individually). Same shape as
Polymarket's event→binaries, but the parent row does **three jobs**: display
grouping, mutual-exclusivity declaration, and **margin netting set** — risk
is computed as worst-case loss across the whole market, so buying No on
additional contracts can produce *credits* ("negative risk"). Lesson: an
exclusivity flag on `events` is what would unlock portfolio margining or
NO→YES conversion later; it costs nothing to record now.

### Futuur — dual currency on one question row

One question row; per-mode fields (`real_currency_available`,
`volume_play_money` / `volume_real_money`, per-mode fees) and **outcome
prices keyed by currency**: `price: {OOM: …, USDC: …}` — two independent
LS-LMSR pools per question, one resolution. Contrast Manifold's
`siblingContractId` (a duplicated contract row per currency). Futuur's shape
preserves exactly the invariant our event/spec design fights for — one
event, one spec, one resolution decides both pools — at the cost of a
`currency` discriminator on every trading-side table. The two pools showing
two different probabilities is a feature (play-money forecast signal vs
money-weighted signal). If Prophet ever adds a cash mode, this is the shape.

---

## 13. Betfair Exchange, Metaforecast, INFER (researched 2026-07-11)

### Betfair — the industrial-scale ancestor

```
EventType (sport) → Competition → Event (match) → Market (typed question) → Runner (outcome)
```

The Event is the canonical fact-about-the-world; Markets are cheap, typed,
many-per-event derivatives (30+ markets per soccer match) — our
`events → market_specs → markets` split, proven at scale for ~20 years.

**The market-type catalog.** Every market carries a `marketType` code
(`MATCH_ODDS`, `OVER_UNDER_25`, `CORRECT_SCORE`, `ASIAN_HANDICAP`, …) — a
flat, operator-curated, sport-scoped enum. It's queryable both as a filter
(`marketTypeCodes`) and as a runtime catalog (`listMarketTypes` per sport
with counts). `marketType` is precisely our `template_id`: fixed template
library per domain, (event × template) generates the ladder, the template
code stays on the market row forever.

**Lifecycle: SUSPENDED is first-class and reversible.**
`INACTIVE → OPEN ⇄ SUSPENDED → CLOSED`. Markets suspend routinely on any
material in-play event (goal, red card): resting orders cancelled, prices
re-form, reopen seconds later. Complement: `betDelay` (orders held N seconds
before hitting the book — information-lag protection). **Our status enum has
no reversible pause state**; `suspended` is the Betfair-shaped move for
"major docket entry landed, pause until a human looks."

**Outcome withdrawal ≠ market annulment.** A withdrawn runner gets
`RunnerStatus.REMOVED` (+ `removalDate`) on the *runner row*; bets on it are
voided; surviving matched bets are **repriced by the runner's pre-declared
`adjustmentFactor`** (≈ its win-probability share). The market survives.
Maps directly: dismissed co-defendant = runner-level removal;
consolidation-annuls-market = market-level void ("all bets void except
markets already unconditionally determined"). Schema lesson: **withdrawal
state and its compensation parameter live on the outcome row.**

**Resolution is per-runner statuses, not a market-level winner pointer.**
A CLOSED market has no `outcome_id`; each runner ends
`WINNER`/`LOSER`/`PLACED`/`REMOVED`, `numberOfWinners` can exceed 1, and
dead heats settle *fractionally*. Our `markets.outcome_id` is fine for
binary, but multi-outcome and partial cases argue for per-outcome terminal
status as the general form (converging again with payout vectors, §6/§12).

**Strike parameterization, the other normalization.** Kalshi mints one
market per strike; Betfair puts the whole handicap ladder *inside one
market* — the tradable unit is the composite key `(selectionId, handicap)`
and the grid is declared in one `MarketLineRangeInfo {min, max, interval,
unit}` row. Betfair buys atomic ladder-wide lifecycle (one suspension covers
the ladder); Kalshi buys a dumb-simple trading core. For our design law
(trading core never learns domains), Kalshi's shape is right — but store the
strike in `market_specs.params` so the ladder stays reconstructable, which
is what `lineRangeInfo` does declaratively.

### Metaforecast — the empirical lowest common denominator

QURI's aggregator normalizes ~18 platforms (Polymarket, Metaculus, Manifold,
Kalshi, Betfair, PredictIt, GJOpen, INFER, Fantasy SCOTUS, …) into one
table: `{id, title, url, platform, description, options: [{name,
probability}], qualityindicators, extra jsonb, history[]}`. What could NOT
be normalized is the revealing part — **no lifecycle status, no close/resolve
dates, no resolution criteria as data (flattened to prose), no market
microstructure, no question typology, no event hierarchy**. Resolved
questions just stop being refetched. Conclusion: lifecycle, machine-readable
resolution, and event grouping are the *genuinely platform-specific* parts —
exactly the layer `events` + `market_specs` proposes to own. (Corollary:
Prophet exports cleanly to aggregators as long as each market has a stable
URL and a probability vector.)

Their **star rating** is also worth stealing: a per-source
`calculateStars(question)` function computes a small integer trust score at
ingestion from source-specific signals (volume, open interest; minus one
star for extreme probabilities). Ready-made pattern for scoring
`court_cases` rows (party_confirmed, docket richness, court level) ahead of
registry→event promotion.

### INFER / Cultivate Labs — recurrence as template parameters

Their "multi-time-period (rolling) questions": one question template + a
recurrence config — how many periods simultaneously active (e.g. 4 quarters),
window start policy, per-period deadline offset, optional base-rate CSV. As
each period lapses and scores, the next auto-appends: **one question
identity, an unbounded ladder of period-instances**. A compact recurrence
schema for FRED-style repeating events — cadence params on the spec instead
of hand-minting each month. (Smarkets, briefly: a cleaner three-level
Betfair — events form a *tree* via parent/child nesting, e.g. race meeting →
race; tradable unit is called a contract.)

---

## 14. Consolidated: what the roadmap was missing (research answer, 2026-07-11)

Gaps in the §7 roadmap + CLAUDE.md design surfaced by §11–13, ranked:

1. **The conditional-pair resolution cascade (§11).** §7.1 said "precondition
   fails → annul" but not the full semantics. Metaculus supplies them:
   annul the counterfactual branch the moment the parent resolves; upstream
   ambiguity/annulment propagates as *annulment* downstream; child-first
   resolution freezes branches until the parent lands; and the whole cascade
   has an inverse (unresolve). Adopt the table wholesale.
2. **`suspended` as a reversible market state (§13).** Our
   pending/open/closed/resolved/annulled enum can't pause. Needed for
   "docket entry landed" (§10's jump problem) and cheap to add:
   open ⇄ suspended.
3. **Annulled ≠ ambiguous (§11).** Two void causes — "question broken" vs
   "reality unclear" — that we currently conflate. Matters for court
   markets where both will happen (remand = assumption failed; sealed
   filings = reality unclear). Record the void *reason* even if both refund.
4. **Outcome-level withdrawal (§13).** A dismissed co-defendant shouldn't
   annul the whole market. Withdrawal state (+ compensation policy) belongs
   on the `outcomes` row; market-level annul is a separate, blunter tool.
5. **Resolution as per-outcome terminal status / payout vector (§6, §12,
   §13 — triple convergence).** `markets.outcome_id` as a single winner
   pointer is the degenerate case. The general form: per-outcome payout
   weights. Keeps partial resolutions, dead-heat-style splits, settlements,
   and annulment (uniform refund vector) in one representation.
6. **Template provenance + validation (§12).** Phase 2's template library
   needs Augur's three ideas: hash the template+params onto the minted
   market (faithfulness re-checkable at resolution), declarative
   date-arithmetic constraints (event date + buffer ≤ close), and a
   retired/auto-fail template list.
7. **Annulment criteria belong in the spec at creation time (§12).** Augur
   v1 is the natural experiment for what happens when annulment is
   discretionary and post-hoc. Our trusted pipeline mostly protects us —
   keep it that way by making "what would refund this market?" answerable
   ex ante on every spec.
8. **Structured resolution prose (§11).** Split our per-market prose into
   `resolution_criteria` vs `fine_print` (+ background) in the template
   library, per Metaculus's legal-contract framing.
9. **The time model (§11).** Add `scheduled_resolve_time` vs
   `actual_resolve_time` (answer-knowable time) vs `resolution_set_time`,
   and consider the anti-sniping snapback: trades after
   answer-knowability shouldn't count toward leaderboard P&L (schema-level
   complement to §10's liquidity decay).
10. **Curation state machine orthogonal to market lifecycle (§11).**
    draft → pending → approved/rejected with reviewer recorded — the
    phase-2 review queue is exactly this; keep it on the spec, never on the
    market.
11. **Groups declare their dimension (§11).** `group_variable` + per-child
    `label`/`rank` on the event's market ladder, not just an exclusivity
    boolean. The exclusivity flag itself also earns its keep later as a
    margin-netting/conversion declaration (§12, PredictIt).
12. **Recurrence as spec params (§13, INFER).** N-active-periods +
    auto-append is the clean FRED retrofit shape.
13. **Registry trust scoring (§13, Metaforecast).** A `calculateStars`-style
    ingestion score on `court_cases` to gate registry→event promotion.
14. **Dual-currency, if ever (§12, Futuur).** One question row, per-currency
    price/pool state, one resolution — not sibling market rows.

---

## 15. Proposed v1 schema (settled 2026-07-11, after the Elon-algorithm pass)

The schema that survived: first a maximal draft was assembled from §1–14, then
requirements were re-questioned (whose requirement is this?), speculative
structure deleted, and the platform-roadmap pieces (7.1–7.3 — Lorenzo's
requirements, not research artifacts) restored in a more modular form.
**Four small tables + one column now; one more table with phase 3.**

> **As built (2026-07-13) — reconcile with prod.** The SQL below is the
> conceptual design. The LIVE schema (migrations `20260712000000`,
> `20260712000100`, `20260713000000`, `20260713000100`) differs in specifics,
> and prod is the source of truth:
> - **`bigint generated always as identity`** keys, not uuid (matches the
>   existing trading core).
> - `events` uses **`source_ref`** (+ `details` jsonb) for registry provenance,
>   not `registry_table`/`registry_id`.
> - `market_specs` has a **`status`** column (`draft→approved→live→resolved→
>   annulled→rejected`) the deployed watcher filters on — kept over the
>   `review_reason`/`audit` sketch because it was already built and working.
> - **`resolution_proposals`** (watcher audit log + review queue) is the live
>   form of the resolution-tracking idea, not columns on the spec.
> - **`event_links` was NOT built** — designed here, deferred (not needed for
>   the 7.1–7.3 market types; `spec_conditions` carries conditionality).
> - `spec_conditions` and `events.mutually_exclusive` are live exactly as
>   described. `payouts.outcome_id` was made nullable to record annulment
>   refunds (see §"Market lifecycle" note in CLAUDE.md).

### The migration (conceptual — see "As built" above for live specifics)

```sql
create table events (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in ('court_case', 'fred_release', 'custom')),
  title              text not null,
  status             text not null default 'active'
                       check (status in ('active', 'concluded', 'abandoned')),
  mutually_exclusive boolean not null default false,   -- 7.2: this event's markets form an exclusive ladder
  registry_table     text,                             -- provenance: 'court_cases', …
  registry_id        text,
  details            jsonb not null default '{}',
  created_at         timestamptz not null default now()
);

create table market_specs (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references events(id),
  template_id         text not null,                   -- names a template defined in GIT (no templates table)
  params              jsonb not null default '{}',
  question            text not null,
  resolution_criteria text not null,                   -- rendered prose; MUST include annulment conditions
                                                       -- fixed at creation (§12 Augur lesson)
  justification       text,                            -- the LLM's case (audit trail)
  confidence          numeric,                         -- drafter confidence; drives auto-approval
  status              text not null default 'pending'
                        check (status in ('pending', 'approved', 'rejected')),
  reviewed_by         uuid,                            -- null on an approved spec = machine-approved
  decided_at          timestamptz,
  market_id           bigint unique references markets(id),  -- match markets key type; set on mint;
                                                             -- the market's own status is truth thereafter
  created_at          timestamptz not null default now()
);

-- 7.1 + 7.3: conditions as ROWS, N rows = conjunction (AND). "If A and B, then X"
-- = a spec for X with two condition rows. The administrative mirror of CTF deep
-- positions (§6).
create table spec_conditions (
  id                 uuid primary key default gen_random_uuid(),
  market_spec_id     uuid not null references market_specs(id) on delete cascade,
  condition_spec_id  uuid references market_specs(id),  -- condition is another market: machine-checkable
  condition_event_id uuid references events(id),        -- condition is an event predicate: watcher/human-checked
  required_outcome   text not null,                     -- what keeps this market alive ('Yes', 'denied', …)
  note               text,                              -- human-readable statement of the condition
  check (num_nonnulls(condition_spec_id, condition_event_id) = 1)
);

-- The navigation/matter graph (generalizes court_cases.matter_id).
-- NOTE: no 'precondition' type — conditionality lives ONLY in spec_conditions.
create table event_links (
  from_event_id uuid not null references events(id),
  to_event_id   uuid not null references events(id),
  link_type     text not null check (link_type in ('same_matter', 'supersedes')),
  details       jsonb not null default '{}',
  primary key (from_event_id, to_event_id, link_type)
);

-- THE only trading-core change:
alter table markets add column event_id uuid references events(id);
```

### Phase 3 (ships WITH the resolve-court-markets watcher, not before)

```sql
create table resolution_proposals (
  id          uuid primary key default gen_random_uuid(),
  market_id   bigint not null references markets(id),
  kind        text not null check (kind in ('resolve', 'annul')),
  outcome_id  bigint references outcomes(id),   -- for 'resolve'; null for 'annul'
  void_reason text,                             -- 'annulled' vs 'ambiguous' (§11) + subtype
  confidence  numeric,                          -- classifier confidence; drives auto-execution
  evidence    jsonb,                            -- docket entry ids + classified text
  proposed_by text not null,                    -- 'watcher:court' | 'watcher:condition' | admin id
  status      text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected', 'executed')),
  reviewed_by uuid,                             -- null on executed rows = machine-executed
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);
```

Execution invokes the existing `resolve-market`/`annul-market` functions —
the table sits upstream; they stay dumb.

### Automation model (per Lorenzo, 2026-07-12: automate everything; mistakes OK)

**Review-by-exception, not review-by-default.** Play-money mistakes are
acceptable; the one human gate is the existing real-money one
(`stage-cycle-payout` → admin approves → `send-paypal-payout`), which doubles
as the place a systematically-wrong watcher would surface (bad resolutions →
suspicious leaderboard P&L in the cash batch you already eyeball ~14-daily).

- **Drafting:** specs with `confidence` ≥ threshold auto-approve
  (`reviewed_by null`) and mint via `add-market` in the same cron chain as
  the sweep. Low-confidence specs sit at `pending`.
- **Resolution:** classifier verdicts `resolve`/`annul` auto-execute — the
  proposal row is inserted with `status='executed'` as an audit log, and the
  edge function fires immediately. Only the classifier's `review` verdict
  (unmapped classification) or low confidence leaves a `pending` row.
- **Mistake handling:** `annul-market` (refund everyone) is the universal
  undo; every automated decision carries its `evidence`, so bad calls are
  diagnosable and reversible in one action. No settlement-delay machinery at
  play-money stakes.
- The full court chain thus mirrors FRED's autonomy: sweep → promote →
  draft → mint → watch → resolve, all cron, humans only on exceptions.

### Condition semantics (the Metaculus cascade, §11, generalized to N parents)

- All conditions satisfied or still open → the market lives its normal life.
- **Any** condition resolves contrary to `required_outcome` — or resolves
  ambiguous/annulled, or its event is abandoned — → the watcher files ONE
  annul proposal citing the failed condition and auto-executes it (condition
  failure is deterministic — the highest-confidence case there is). Order of
  failures irrelevant; first failure kills.
- Conditions still open at market close: market closes normally; resolution
  waits until conditions + the main question are known.
- The **watcher refuses condition chains deeper than 1** (a condition whose
  spec itself has conditions) — nesting is deferred (below), guarded in code
  rather than schema.

### Roadmap coverage

- **7.1 Conditional** = one condition row.
- **7.2 Multi-choice** = closed small set → one market with N `outcomes` rows
  (pre-flight: verify `resolve-market` + the public app's AMM handle N>2);
  open/large set → N specs under one event with `mutually_exclusive`.
- **7.3 Combination** ("if A, then B or C") = a multi-outcome spec with
  condition rows. "If A and B, then X" comes free (two rows).
- Joint/combinatorial *pricing* — permanently out (§8 money-pump boundary);
  CTF nested collateral (§6) is the documented upgrade path.

### Deletion / deferral log (each with its reinstatement trigger)

| Deleted/deferred | Why | Add back when |
|---|---|---|
| `templates` table + `template_hash` | Design law #2: templates/provenance live in git; hashing is for adversarial creation (Augur), ours is a trusted pipeline | Admin UI authors templates / creation opens to outsiders |
| `draft`/`live`/`resolved` spec statuses | Market state lives only on `markets`; no dual state machine | Never |
| `on_precondition_failure` column | One legal value ('annul') is a constant | A second failure policy exists |
| **Disjunction** ("if A **or** B") — deferred per Lorenzo | OR-conditioned refund semantics are murky (which branch's failure refunds?); let a concrete market force the design | Standard shape: `condition_group` smallint on `spec_conditions` — OR across groups, AND within |
| **Nested conditions** — deferred per Lorenzo | Metaculus forbids nesting outright; murky semantics | Real chain shows up; lift the watcher's depth-1 guard, define cascade-through |
| Payout-vector resolution | All current markets resolve binary-or-annul | First split/partial resolution: `payout` jsonb on proposals + per-outcome numerators (§6/§12/§13) |
| `suspended` status | No live market has hit the docket-jump problem yet | First observed need: one check-constraint value, open ⇄ suspended (§13) |
| Outcome withdrawal (`result`/`removed_at` on outcomes) | Nothing to withdraw from until multi-outcome markets exist | First dismissed co-defendant on a live ladder (§13) |
| `answer_knowable_at` + anti-sniping snapback | Leaderboard-integrity enhancement, not roadmap | Sniping observed in P&L (§10/§11) |
| Recurrence params on templates | FRED already recurs procedurally; retrofit is optional step C | FRED retrofit (§13 INFER shape) |
| `fine_print` as separate column | One text column suffices | Reviewers complain criteria are unreadable (§11) |
| `kind='market'` (meta-markets) | Nobody asked yet | Meta-market pilot (§9) — one check-constraint value |
| `group_variable` on events | No renderer reads it | Ladder UI ships; until then `details` jsonb |
| Dual currency | Not on roadmap | Cash mode: `currency` discriminator on trading tables, Futuur shape (§12) |

**Open pre-flight checks before building:** (1) verify `resolve-market`,
`annul-market`, and the public app's AMM against N>2 outcomes; (2) match FK
types to actual `markets.id`/`profiles.id` types; (3) decide where the
`mutually_exclusive` flag gets *enforced* when the first ladder ships (UI
only, or AMM).
