// supabase/functions/_shared/court-resolution/refine_eval.ts
//
// Eval for the LLM refinement pass. Runs the real model over drafted specs and
// asserts the invariants hold on ACTUAL output: the resolution binding is
// preserved, the close date is valid and after filing, confidence is in-range,
// and the question is non-empty and on-topic. It does NOT assert exact wording
// (that's subjective) — it asserts the properties that must hold for a refined
// draft to be safe to mint.
//
// Run: export ANTHROPIC_API_KEY=...
//      deno test --allow-env --allow-net supabase/functions/_shared/court-resolution/refine_eval.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { refineDraft } from "./refine.ts";
import { draftSpecs } from "./draft.ts";
import type { CaseInput } from "./templates.ts";

const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const cases: CaseInput[] = [
  {
    cl_docket_id: 70317348,
    case_name: "Kalshiex LLC v. Mary Jo Flaherty",
    court_id: "ca3",
    court_level: "appellate",
    date_filed: "2025-05-15",
    docket_url: "https://www.courtlistener.com/docket/70317348/",
  },
  {
    cl_docket_id: 73108570,
    case_name: "State of Washington v. KalshiEX LLC",
    court_id: "wawd",
    court_level: "district",
    date_filed: "2026-03-27",
    docket_url: "https://www.courtlistener.com/docket/73108570/",
  },
];

Deno.test("ANTHROPIC_API_KEY is set", () => {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set — the refinement eval cannot run.");
});

for (const c of cases) {
  const draft = draftSpecs(c)[0];
  Deno.test({
    name: `refine: ${c.case_name} (${draft.template_id})`,
    ignore: !apiKey,
    fn: async () => {
      const r = await refineDraft(draft, c, apiKey);

      // Safety invariant: the resolution binding is untouched by the model.
      assertEquals(r.params.resolution_map, draft.params.resolution_map);
      assertEquals(r.params.outcomes, draft.params.outcomes);
      assertEquals(r.template_id, draft.template_id);
      assertEquals(r.params.docket_id, draft.params.docket_id);

      // Close date: valid YYYY-MM-DD, after filing, and synced into params.
      assert(/^\d{4}-\d{2}-\d{2}$/.test(r.close_date), `bad close_date ${r.close_date}`);
      assert(r.close_date > c.date_filed, `close_date ${r.close_date} not after filing ${c.date_filed}`);
      assertEquals(r.params.close_date, r.close_date);

      // Confidence in-range; question non-empty and mentions the company.
      assert(["high", "medium", "low"].includes(r.confidence));
      assert(r.question.length > 0);
      assert(/kalshi/i.test(r.question), `question should reference the case: ${r.question}`);
    },
  });
}
