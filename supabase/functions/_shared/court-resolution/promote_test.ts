// supabase/functions/_shared/court-resolution/promote_test.ts
//
// Unit tests for Phase B promotion. Pure — no DB, no network.
// Run: deno test promote_test.ts  (or `deno task test` from the repo root)

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type CourtCaseRow, eventFromRow, isPromotable, planPromotion } from "./promote.ts";

const base: CourtCaseRow = {
  id: 42,
  cl_docket_id: 70317348,
  case_name: "Kalshiex LLC v. Mary Jo Flaherty",
  court_id: "ca3",
  court_level: "appellate",
  date_filed: "2025-05-15",
  date_terminated: null,
  docket_url: "https://www.courtlistener.com/docket/70317348/",
  party_confirmed: true,
  status: "candidate",
  company_role: "plaintiff",
  matter_id: 7,
};

// ── The promotability gate: confirmed + active + not rejected ────────────────
Deno.test("promotable: confirmed, active, non-rejected", () => {
  assert(isPromotable(base));
});

Deno.test("not promotable: full-text mention (party_confirmed=false)", () => {
  assertEquals(isPromotable({ ...base, party_confirmed: false }), false);
});

Deno.test("not promotable: already terminated (nothing to trade)", () => {
  assertEquals(isPromotable({ ...base, date_terminated: "2026-04-06" }), false);
});

Deno.test("not promotable: human-rejected", () => {
  assertEquals(isPromotable({ ...base, status: "rejected" }), false);
});

// ── Event mapping: details must carry what the court adapter reads back ──────
Deno.test("eventFromRow maps registry row → event with adapter-readable details", () => {
  const e = eventFromRow(base);
  assertEquals(e.kind, "court_case");
  assertEquals(e.title, base.case_name);
  assertEquals(e.status, "open");
  assertEquals(e.source_ref, "42");
  // The court adapter reads these off event.details at resolution time:
  assertEquals(e.details.cl_docket_id, 70317348);
  assertEquals(e.details.court_id, "ca3");
  assertEquals(e.details.court_level, "appellate");
  assertEquals(e.details.date_filed, "2025-05-15");
  assertEquals(e.details.matter_id, 7);
});

// ── The full plan across case types ─────────────────────────────────────────
Deno.test("plan: appellate case → event + appeal_outcome spec", () => {
  const plan = planPromotion(base)!;
  assert(plan !== null);
  assertEquals(plan.specs.map((s) => s.template_id), ["appeal_outcome"]);
  // The spec's params ARE the ResolutionSpec the watcher will consume.
  assertEquals(plan.specs[0].params.docket_id, 70317348);
});

Deno.test("plan: removed state-enforcement case → event + state_remand spec", () => {
  const plan = planPromotion({
    ...base,
    case_name: "State of Washington v. KalshiEX LLC",
    court_id: "wawd",
    court_level: "district",
  })!;
  assertEquals(plan.specs.map((s) => s.template_id), ["state_remand"]);
});

Deno.test("plan: promotable case with no applicable template → event, no specs", () => {
  // A private district suit promotes (it's a real proceeding) but yields no
  // markets yet — the event exists, ready for future templates.
  const plan = planPromotion({
    ...base,
    case_name: "Josephson v. Kalshi, Inc.",
    court_id: "nysd",
    court_level: "district",
  })!;
  assert(plan !== null);
  assertEquals(plan.specs, []);
});

Deno.test("plan: non-promotable case → null", () => {
  assertEquals(planPromotion({ ...base, party_confirmed: false }), null);
});
