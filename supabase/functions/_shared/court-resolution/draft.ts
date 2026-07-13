// supabase/functions/_shared/court-resolution/draft.ts
//
// Phase 2 drafting: turn a court case into draft market specs, one per applicable
// template. The output is exactly the shape a market_specs row carries — its
// `params` IS the ResolutionSpec the settlement resolver (resolve.ts) consumes,
// so drafting and settlement lock together by construction.
//
// Selection + parameter-fill here are DETERMINISTIC (fully unit-testable). An
// LLM pass can later refine question wording and close-date estimates, but the
// skeleton — which templates fire and the resolution binding — is fixed code.

import type { ResolutionSpec } from "./resolve.ts";
import { type CaseInput, TEMPLATES } from "./templates.ts";

export interface MarketSpecDraft {
  template_id: string;
  question: string;
  close_date: string; // YYYY-MM-DD
  params: ResolutionSpec; // the resolution binding — consumed verbatim by applyResolution()
  justification: string;
}

// Deterministic close-date hint: filing date + the template's horizon. Pure
// (no Date.now) so drafts are reproducible in tests; the human/LLM refines it.
function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function draftSpecs(c: CaseInput): MarketSpecDraft[] {
  return TEMPLATES.filter((t) => t.applies(c)).map((t) => {
    const close_date = addDays(c.date_filed, t.horizonDays);
    const params: ResolutionSpec = {
      template_id: t.id,
      docket_id: c.cl_docket_id,
      outcomes: t.outcomes,
      resolution_map: t.resolution_map,
      close_date,
    };
    return {
      template_id: t.id,
      question: t.question(c, close_date),
      close_date,
      params,
      justification: t.justification(c),
    };
  });
}
