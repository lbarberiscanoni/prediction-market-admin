// supabase/functions/_shared/court-resolution/mint_test.ts
//
// Pure tests for the mint step logic. No LLM, no network.
// Run: deno test mint_test.ts  (or `deno task test` from the repo root)

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { approvalDecision, buildAddMarketPayload } from "./mint.ts";
import { applyRefinement } from "./refine.ts";
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
const refined = applyRefinement(draftSpecs(appealCase)[0], {
  question: "Will the Third Circuit affirm the judgment below by 2026-08-15?",
  close_date: "2026-08-15",
  confidence: "high",
  review_notes: "Clean appeal.",
});
const event = { title: appealCase.case_name, details: { docket_url: appealCase.docket_url } };

// ── Approval gate ────────────────────────────────────────────────────────────
Deno.test("approvalDecision: high/medium auto-approve, low queues for review", () => {
  assertEquals(approvalDecision("high"), "approve");
  assertEquals(approvalDecision("medium"), "approve");
  assertEquals(approvalDecision("low"), "queue");
});

// ── add-market payload ───────────────────────────────────────────────────────
Deno.test("payload: name is the refined question, close_date carried, market opens", () => {
  const p = buildAddMarketPayload(refined, event);
  assertEquals(p.name, refined.question);
  assertEquals(p.close_date, "2026-08-15");
  assertEquals(p.status, "open");
  assert(p.tags?.includes("Legal"));
  assertEquals(p.link, appealCase.docket_url);
});

Deno.test("payload: outcomes exactly match the draft's resolution-spec outcomes", () => {
  const p = buildAddMarketPayload(refined, event);
  assertEquals(p.outcomes?.map((o) => o.name), refined.params.outcomes);
  assert(p.outcomes?.every((o) => (o.tokens ?? 0) > 0));
});

Deno.test("payload: description carries the docket link and justification", () => {
  const p = buildAddMarketPayload(refined, event);
  assert(p.description.includes(appealCase.docket_url));
  assert(p.description.includes(refined.template_id));
});
