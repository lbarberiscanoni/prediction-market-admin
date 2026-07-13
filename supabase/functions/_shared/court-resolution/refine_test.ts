// supabase/functions/_shared/court-resolution/refine_test.ts
//
// Pure tests for applyRefinement — the safety boundary between the LLM's
// presentation suggestions and the fixed resolution binding. No LLM, no network.
// Run: deno test refine_test.ts  (or `deno task test` from the repo root)

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyRefinement, type RefinementSuggestion } from "./refine.ts";
import { draftSpecs } from "./draft.ts";
import type { CaseInput } from "./templates.ts";

const appealCase: CaseInput = {
  cl_docket_id: 70317348,
  case_name: "Kalshiex LLC v. Mary Jo Flaherty",
  court_id: "ca3",
  court_level: "appellate",
  date_filed: "2025-05-15",
  docket_url: "https://www.courtlistener.com/docket/70317348/",
};
const draft = draftSpecs(appealCase)[0];

const goodSuggestion: RefinementSuggestion = {
  question: "Will the Third Circuit affirm the district court's judgment in Kalshi v. Flaherty by 2026-05-15?",
  close_date: "2026-05-15",
  confidence: "high",
  review_notes: "Clean appeal; disposition set covers affirm/reverse/vacate.",
};

Deno.test("refinement applies presentation: question, close_date, confidence", () => {
  const r = applyRefinement(draft, goodSuggestion);
  assertEquals(r.question, goodSuggestion.question);
  assertEquals(r.close_date, "2026-05-15");
  assertEquals(r.confidence, "high");
  assertEquals(r.params.close_date, "2026-05-15"); // params close_date syncs
});

Deno.test("SAFETY: the resolution binding is preserved verbatim", () => {
  const r = applyRefinement(draft, goodSuggestion);
  assertEquals(r.params.resolution_map, draft.params.resolution_map);
  assertEquals(r.params.outcomes, draft.params.outcomes);
  assertEquals(r.template_id, draft.template_id);
  assertEquals(r.params.docket_id, draft.params.docket_id);
});

Deno.test("SAFETY: even a suggestion that smuggles extra fields can't change the map", () => {
  // The suggestion type has no resolution_map; but simulate a model that tried,
  // by casting. applyRefinement must ignore anything outside the four fields.
  const malicious = {
    ...goodSuggestion,
    resolution_map: { appeal_affirmed: "No", appeal_reversed: "Yes" }, // inverted!
    outcomes: ["Maybe"],
  } as unknown as RefinementSuggestion;
  const r = applyRefinement(draft, malicious);
  assertEquals(r.params.resolution_map, draft.params.resolution_map); // unchanged
  assertEquals(r.params.outcomes, draft.params.outcomes); // unchanged
});

Deno.test("invalid close_date from the model → falls back to the draft's", () => {
  const r = applyRefinement(draft, { ...goodSuggestion, close_date: "sometime next year" });
  assertEquals(r.close_date, draft.close_date);
  assertEquals(r.params.close_date, draft.close_date);
});

Deno.test("empty question → falls back to the draft's", () => {
  const r = applyRefinement(draft, { ...goodSuggestion, question: "   " });
  assertEquals(r.question, draft.question);
});

Deno.test("unknown/missing confidence is treated as low (never auto-approved)", () => {
  const r = applyRefinement(draft, { ...goodSuggestion, confidence: "very sure" as unknown as "high" });
  assertEquals(r.confidence, "low");
});
