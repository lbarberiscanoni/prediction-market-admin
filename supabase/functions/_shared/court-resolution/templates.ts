// supabase/functions/_shared/court-resolution/templates.ts
//
// The fixed market-template library for court cases. Each template declares:
//   - which cases it applies to (a deterministic predicate)
//   - the market question, outcomes, and — crucially — a baked-in resolution_map
//     (classification → outcome / ANNUL) that the settlement resolver consumes.
//
// Design law: templates are git-versioned CODE, not LLM output. The drafter LLM
// (later) may refine wording and close dates, but it selects from THIS library
// and never invents a resolution_map — that keeps settlement deterministic and
// safe. Selection here is deterministic so it's fully unit-testable; LLM
// judgment is layered on top as a separate, eval-tested concern.

import { ANNUL } from "./resolve.ts";

export interface CaseInput {
  cl_docket_id: number;
  case_name: string;
  court_id: string;
  court_level: string; // district | appellate | scotus
  date_filed: string; // YYYY-MM-DD
  docket_url: string;
}

export interface Template {
  id: string;
  // horizon in days from filing → the default close date (a hint the human/LLM refines)
  horizonDays: number;
  outcomes: string[];
  resolution_map: Record<string, string>;
  applies: (c: CaseInput) => boolean;
  question: (c: CaseInput, closeDate: string) => string;
  justification: (c: CaseInput) => string;
}

// A state/commonwealth/people-of plaintiff signals a removed state-enforcement
// case, where remand back to state court is a live, tradeable question.
const STATE_PLAINTIFF = /^(state|commonwealth|people)\s+of\b|ex rel\b/i;

export const TEMPLATES: Template[] = [
  {
    id: "appeal_outcome",
    horizonDays: 365,
    outcomes: ["Yes", "No"],
    resolution_map: {
      appeal_affirmed: "Yes",
      appeal_reversed: "No",
      appeal_vacated_remanded: "No",
      appeal_dismissed: ANNUL, // appeal dropped without a merits ruling
    },
    applies: (c) => c.court_level === "appellate",
    question: (c, close) =>
      `Will the appellate court affirm the judgment below in ${c.case_name} on or before ${close}?`,
    justification: (c) =>
      `Appellate proceeding (${c.court_id}); resolves on the panel's disposition (affirm/reverse/vacate) or annuls if the appeal is dismissed.`,
  },
  {
    id: "state_remand",
    horizonDays: 120,
    outcomes: ["Yes", "No"],
    resolution_map: {
      // The market's question IS the procedural event, so remand resolves Yes
      // (the map-first resolver honors this over the classifier's generic annul).
      remanded_to_state: "Yes",
    },
    applies: (c) => c.court_level === "district" && STATE_PLAINTIFF.test(c.case_name),
    question: (c, close) =>
      `Will ${c.case_name} be remanded to state court on or before ${close}?`,
    justification: (c) =>
      `Removed state-enforcement case (${c.court_id}); a granted motion to remand resolves Yes. If no remand by the close date it resolves No.`,
  },
];

export const TEMPLATE_IDS = new Set(TEMPLATES.map((t) => t.id));
