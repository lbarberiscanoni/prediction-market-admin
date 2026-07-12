// supabase/functions/_shared/court-resolution/taxonomy.ts
//
// The classification taxonomy for court-market resolution. This is the SPEC,
// expressed as types + a JSON schema the model is constrained to.
//
// Core principle (verified empirically 2026-07-11): a case being terminated
// does NOT mean it resolved on the merits. Most terminations of these cases are
// procedural redirects — remand to state court, transfer, consolidation,
// voluntary dismissal, or a district disposition that moves up on appeal. Only
// a subset are actual win/lose outcomes. Resolution must read the terminal
// docket entry's TEXT and classify it, with annul as a common, first-class
// outcome — never auto-settle on `date_terminated`.

// What happened to the case, read from the docket text.
export const CLASSIFICATIONS = [
  "appeal_affirmed", // appellate court affirmed the judgment below
  "appeal_reversed", // appellate court reversed
  "appeal_vacated_remanded", // vacated and sent back to the trial court
  "appeal_dismissed", // appeal dismissed (incl. voluntary) — no merits ruling
  "remanded_to_state", // removed case sent back to state court (we go blind)
  "transferred", // transferred to another federal district
  "consolidated", // merged into a lead / MDL case
  "voluntarily_dismissed", // plaintiff dropped the case (Rule 41)
  "dismissed_with_prejudice", // merits dismissal, cannot refile
  "merits_judgment", // final judgment on the merits (district level)
  "district_terminated_appealed", // district case closed AND a notice of appeal filed
  "pending", // no terminal event in the docket
  "other", // none of the above / genuinely unclear
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

// What the resolver should do with any market on this proceeding.
//   resolve          — a real outcome occurred; settle per the market's spec
//   annul            — the proceeding ended without a merits outcome (remand,
//                      transfer, consolidation, voluntary dismissal, appeal
//                      dismissed) OR left federal visibility — refund
//   continue_tracking — still live / moved to a linked proceeding; do nothing yet
//   no_action        — nothing terminal happened
export const MARKET_ACTIONS = ["resolve", "annul", "continue_tracking", "no_action"] as const;
export type MarketAction = (typeof MARKET_ACTIONS)[number];

export const CONFIDENCE = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCE)[number];

export interface DocketEntry {
  entry_number: string | number | null;
  date_filed: string | null;
  description: string | null;
}

export interface CaseFixture {
  docket_id: number;
  case_name: string;
  court_id: string;
  court_level: string; // district | appellate | scotus
  date_filed: string;
  date_terminated: string | null;
  docket_url: string;
  entries: DocketEntry[];
}

export interface Classification_Result {
  classification: Classification;
  is_merits_resolution: boolean; // did the case end on its actual legal question?
  recommended_market_action: MarketAction;
  confidence: Confidence;
  evidence_entry: string; // verbatim docket text that justifies the call
  reasoning: string;
}

// JSON schema for structured outputs (output_config.format). Note the
// constraints the API supports: enum + additionalProperties:false + required.
// No minLength/maxLength/numeric constraints (unsupported).
export const CLASSIFICATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reasoning: {
      type: "string",
      description: "Brief explanation tying the classification to the docket text.",
    },
    classification: { type: "string", enum: [...CLASSIFICATIONS] },
    is_merits_resolution: {
      type: "boolean",
      description: "True only if the case ended by deciding its actual legal question (win/lose), not a procedural redirect.",
    },
    recommended_market_action: { type: "string", enum: [...MARKET_ACTIONS] },
    confidence: { type: "string", enum: [...CONFIDENCE] },
    evidence_entry: {
      type: "string",
      description: "The single docket entry's text that most justifies the classification, quoted verbatim.",
    },
  },
  required: [
    "reasoning",
    "classification",
    "is_merits_resolution",
    "recommended_market_action",
    "confidence",
    "evidence_entry",
  ],
} as const;
