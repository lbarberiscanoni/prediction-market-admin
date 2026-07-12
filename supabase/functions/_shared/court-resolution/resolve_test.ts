// supabase/functions/_shared/court-resolution/resolve_test.ts
//
// Unit tests for the deterministic settlement step. Pure — no LLM, no network.
// Reuses the golden-set ground-truth labels (labels.json) as classifier
// verdicts, so settlement is tested against the same real cases the classifier
// eval uses, but for free and instantly.
//
// Run: deno test resolve_test.ts   (or `deno task test` from the repo root)

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ANNUL, applyResolution, type ResolutionSpec } from "./resolve.ts";
import type { Classification, MarketAction } from "./taxonomy.ts";

// A representative appeal-outcome spec: "Will the appellate court affirm?"
const appealYesNo: ResolutionSpec = {
  template_id: "appeal_outcome",
  docket_id: 70317348,
  outcomes: ["Yes", "No"],
  resolution_map: {
    appeal_affirmed: "Yes",
    appeal_reversed: "No",
    appeal_vacated_remanded: "No",
    appeal_dismissed: ANNUL, // appeal dropped without a merits ruling → annul
  },
};

interface Label {
  classification: Classification;
  recommended_market_action: MarketAction;
}
const labels: Record<string, Label> = JSON.parse(
  await Deno.readTextFile(new URL("./labels.json", import.meta.url)),
);

// 1. Every annul-labeled golden case settles to annul, regardless of the spec —
//    the classifier's annul decision is spec-independent.
Deno.test("golden set: every procedural-redirect case annuls", () => {
  for (const [slug, label] of Object.entries(labels)) {
    if (slug.startsWith("_")) continue;
    if (label.recommended_market_action !== "annul") continue;
    const s = applyResolution(appealYesNo, label);
    assertEquals(s.action, "annul", `${slug} should annul — got ${s.action} (${s.reason})`);
    assert(s.winning_outcome === undefined);
  }
});

// 2. The one merits case (Flaherty, appeal affirmed) resolves the "Yes" outcome.
Deno.test("golden set: affirmed appeal resolves Yes on an appeal-outcome market", () => {
  const flaherty = labels["flaherty-appeal-ca3"];
  assertEquals(flaherty.classification, "appeal_affirmed");
  const s = applyResolution(appealYesNo, flaherty);
  assertEquals(s.action, "resolve");
  assertEquals(s.winning_outcome, "Yes");
});

// 3. A reversal on the same market resolves No.
Deno.test("appeal reversed → resolves No", () => {
  const s = applyResolution(appealYesNo, {
    classification: "appeal_reversed",
    recommended_market_action: "resolve",
  });
  assertEquals(s.action, "resolve");
  assertEquals(s.winning_outcome, "No");
});

// 4. resolution_map ANNUL sentinel is honored even when the classifier said resolve.
Deno.test("resolution_map ANNUL sentinel → annul", () => {
  const s = applyResolution(appealYesNo, {
    classification: "appeal_dismissed",
    recommended_market_action: "resolve", // even if forced to resolve...
  });
  assertEquals(s.action, "annul"); // ...the spec maps this classification to ANNUL
});

// 5. Safety: a classification the spec doesn't map NEVER auto-resolves — human review.
Deno.test("unmapped classification → review, never a guess", () => {
  const s = applyResolution(appealYesNo, {
    classification: "merits_judgment", // not in an appeal-outcome map
    recommended_market_action: "resolve",
  });
  assertEquals(s.action, "review");
  assert(s.winning_outcome === undefined);
});

// 6. Safety: a spec that maps to a non-existent outcome → review, not a bad settle.
Deno.test("resolution_map pointing at a non-outcome → review", () => {
  const brokenSpec: ResolutionSpec = {
    template_id: "appeal_outcome",
    docket_id: 1,
    outcomes: ["Yes", "No"],
    resolution_map: { appeal_affirmed: "Maybe" }, // "Maybe" isn't an outcome
  };
  const s = applyResolution(brokenSpec, {
    classification: "appeal_affirmed",
    recommended_market_action: "resolve",
  });
  assertEquals(s.action, "review");
});

// 7. continue_tracking / no_action → continue, never settle.
Deno.test("pending case → continue", () => {
  const s = applyResolution(appealYesNo, {
    classification: "pending",
    recommended_market_action: "continue_tracking",
  });
  assertEquals(s.action, "continue");
});
