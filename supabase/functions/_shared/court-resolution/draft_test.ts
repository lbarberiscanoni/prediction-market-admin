// supabase/functions/_shared/court-resolution/draft_test.ts
//
// Unit tests for Phase 2 drafting. Pure — no LLM, no network.
// Run: deno test draft_test.ts  (or `deno task test` from the repo root)

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { draftSpecs } from "./draft.ts";
import { ANNUL, applyResolution } from "./resolve.ts";
import { type CaseInput, TEMPLATE_IDS, TEMPLATES } from "./templates.ts";

const appealCase: CaseInput = {
  cl_docket_id: 70317348,
  case_name: "Kalshiex LLC v. Mary Jo Flaherty",
  court_id: "ca3",
  court_level: "appellate",
  date_filed: "2025-05-15",
  docket_url: "https://www.courtlistener.com/docket/70317348/",
};

const stateCase: CaseInput = {
  cl_docket_id: 73108570,
  case_name: "State of Washington v. KalshiEX LLC",
  court_id: "wawd",
  court_level: "district",
  date_filed: "2026-03-27",
  docket_url: "https://www.courtlistener.com/docket/73108570/",
};

const privateCase: CaseInput = {
  cl_docket_id: 73357105,
  case_name: "Josephson v. Kalshi, Inc.",
  court_id: "nysd",
  court_level: "district",
  date_filed: "2026-05-18",
  docket_url: "https://www.courtlistener.com/docket/73357105/",
};

// ── Directional selection ────────────────────────────────────────────────────
Deno.test("appellate case → appeal_outcome draft", () => {
  const drafts = draftSpecs(appealCase);
  assertEquals(drafts.map((d) => d.template_id), ["appeal_outcome"]);
});

Deno.test("removed state-enforcement case → state_remand draft", () => {
  const drafts = draftSpecs(stateCase);
  assertEquals(drafts.map((d) => d.template_id), ["state_remand"]);
});

Deno.test("private district suit → no applicable template (yields no drafts)", () => {
  // Only two templates exist today; a private plaintiff v. company district
  // suit matches neither. Must return [], not throw or mis-fire.
  assertEquals(draftSpecs(privateCase), []);
});

// ── Structural invariants every draft must satisfy ───────────────────────────
Deno.test("every draft satisfies the market_specs invariants", () => {
  for (const c of [appealCase, stateCase]) {
    for (const d of draftSpecs(c)) {
      assert(TEMPLATE_IDS.has(d.template_id), `unknown template ${d.template_id}`);
      assert(d.question.includes(c.case_name), "question must name the case");
      assert(d.close_date > c.date_filed, "close_date must be after filing");
      assertEquals(d.params.docket_id, c.cl_docket_id);
      assertEquals(d.params.close_date, d.close_date);
      assert(d.params.outcomes.length >= 2, "a market needs ≥2 outcomes");
      assert(Object.keys(d.params.resolution_map).length >= 1, "resolution_map must not be empty");
      assert(d.justification.length > 0, "justification (audit trail) required");
    }
  }
});

// ── The lock: every template's resolution_map only references its own outcomes,
//    so settlement can never hit the "bad outcome → review" path from a draft.
Deno.test("every template's resolution_map values are ANNUL or a declared outcome", () => {
  for (const t of TEMPLATES) {
    for (const [classification, target] of Object.entries(t.resolution_map)) {
      assert(
        target === ANNUL || t.outcomes.includes(target as string),
        `${t.id}: ${classification} → "${target}" is neither ANNUL nor one of [${t.outcomes.join(", ")}]`,
      );
    }
  }
});

// ── Round-trip: a draft's params fed straight into the settlement resolver ────
Deno.test("round-trip: affirmed appeal on an appeal_outcome draft resolves Yes", () => {
  const draft = draftSpecs(appealCase)[0];
  const s = applyResolution(draft.params, {
    classification: "appeal_affirmed",
    recommended_market_action: "resolve",
  });
  assertEquals(s.action, "resolve");
  assertEquals(s.winning_outcome, "Yes");
});

Deno.test("round-trip: remand on a state_remand draft resolves Yes (map beats generic annul)", () => {
  const draft = draftSpecs(stateCase)[0];
  // The classifier's generic recommendation for a remand is annul; the
  // remand-market's spec maps it to Yes, and map-first wins.
  const s = applyResolution(draft.params, {
    classification: "remanded_to_state",
    recommended_market_action: "annul",
  });
  assertEquals(s.action, "resolve");
  assertEquals(s.winning_outcome, "Yes");
});

Deno.test("round-trip: an appeal draft annuls on a remand (not its question)", () => {
  const draft = draftSpecs(appealCase)[0];
  const s = applyResolution(draft.params, {
    classification: "remanded_to_state",
    recommended_market_action: "annul",
  });
  assertEquals(s.action, "annul");
});
