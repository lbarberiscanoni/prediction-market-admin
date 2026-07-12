# Court-market resolution — classifier + golden-set eval

Test-driven foundation for **Phase 3** (resolving court markets). The riskiest
part of the court-market pipeline is deciding *how a case ended* from messy
docket text. This module pins that judgment to a labeled set of real,
already-decided cases, so the classifier is provably correct before any
play-money rides on it.

## Why this exists (the empirical finding)

Checked against 12 terminated Kalshi/Polymarket cases (2026-07-11): **a case
being "terminated" almost never means it resolved on the merits.** Of the golden
set, only 1 of 12 is a clean merits outcome (an appellate affirmance). The rest
are procedural redirects — remand to state court, transfer, consolidation,
voluntary dismissal, or a district disposition that moved up on appeal. So
resolution must **classify the terminal docket entry's text**, with **annul as a
common first-class outcome** — never settle on `date_terminated`.

## Files

| File | What it is |
|---|---|
| `taxonomy.ts` | The classification + market-action enums, types, and the structured-output JSON schema. This is the spec. |
| `classify.ts` | The classifier under test: `classifyDocket(fixture, apiKey)` → `{classification, recommended_market_action, confidence, evidence_entry, reasoning}`. Opus 4.8, adaptive thinking, structured outputs, raw `fetch` (matching this repo's other edge functions). |
| `fixtures/*.json` | Frozen docket entries for the golden cases (checked in → hermetic, no CourtListener dependency at test time). |
| `labels.json` | Hand-assigned ground truth per fixture (from reading each docket). |
| `classify_eval.ts` | Deno eval: runs the classifier over every fixture, asserts it reproduces the labels. |

## Run

```sh
export ANTHROPIC_API_KEY=...   # not stored here; set as a Supabase secret for prod
cd supabase/functions/_shared/court-resolution
deno test --allow-env --allow-read --allow-net classify_eval.ts
```

Without the key the eval fails loudly (the honest "red" state) rather than
passing silently. Each fixture is its own test case, so failures are granular.
The money-affecting assertion is `recommended_market_action`.

## The TDD loop

1. A real case terminates → capture its docket entries as a new `fixtures/<slug>.json`.
2. Hand-label the correct outcome in `labels.json`.
3. Run the eval. If the classifier misses it, tighten the system prompt in
   `classify.ts` (or fix a wrong label) until green.
4. The weird tail (partial grants, stipulated dismissals, buried dispositive
   orders) becomes regression tests instead of production surprises.

## Scope / not yet done

- This classifies the *event* (`classification` + `recommended_market_action`).
  Applying an outcome to a specific market (which outcome = YES) is a separate,
  deterministic step that needs the market's resolution spec — built when the
  `events`/`market_specs` model lands.
- Known gap: a case whose dispositive ruling is older than the fixture's recent
  entries (e.g. the CFTC district win) needs a "fetch full history" path — add
  as a fixture once that path exists.
- Remanded-to-state cases annul: CourtListener is federal-only, so we lose
  visibility at remand. This is a hard boundary, documented in CLAUDE.md.
