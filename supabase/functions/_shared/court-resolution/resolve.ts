// supabase/functions/_shared/court-resolution/resolve.ts
//
// The deterministic settlement step: given a market's resolution spec (the
// binding stored in market_specs.params) and the classifier's verdict, decide
// what to DO with the market — resolve a specific outcome, annul, keep
// tracking, or route to human review. Pure, no LLM, no DB.
//
// This is the git-versioned "logic" half of the design law: market_specs.params
// holds *parameters* (which classification maps to which outcome); this code
// holds the *rules* for applying them. Safety: it never guesses — a
// classification the spec doesn't map goes to human review, never auto-settles.

import type { Classification, MarketAction } from "./taxonomy.ts";

// Sentinel a resolution_map can use to say "this classification annuls".
export const ANNUL = "ANNUL";

// The resolution binding, stored under market_specs.params. `resolution_map`
// maps a case-terminal classification to a winning outcome name (must be one of
// `outcomes`) or the ANNUL sentinel.
export interface ResolutionSpec {
  template_id: string;
  docket_id: number;
  outcomes: string[];
  resolution_map: Partial<Record<Classification, string>>;
  close_date?: string;
}

export interface ClassifierVerdict {
  classification: Classification;
  recommended_market_action: MarketAction;
}

export type SettlementAction = "resolve" | "annul" | "continue" | "review";

export interface Settlement {
  action: SettlementAction;
  winning_outcome?: string; // only when action === "resolve"
  reason: string;
}

export function applyResolution(
  spec: ResolutionSpec,
  verdict: ClassifierVerdict,
): Settlement {
  // Map-first: the market's OWN spec is authoritative for its OWN question.
  // A market that asks about a procedural event (e.g. "will this be remanded?")
  // maps that classification to an outcome and must resolve — even though the
  // classifier's generic recommendation for a remand is "annul". So consult the
  // resolution_map before falling back to the classifier's default action.
  const mapped = spec.resolution_map[verdict.classification];
  if (mapped !== undefined) {
    if (mapped === ANNUL) {
      return { action: "annul", reason: `resolution_map maps ${verdict.classification} → ANNUL` };
    }
    if (!spec.outcomes.includes(mapped)) {
      return {
        action: "review",
        reason: `resolution_map outcome "${mapped}" is not one of the market's outcomes [${spec.outcomes.join(", ")}]`,
      };
    }
    return { action: "resolve", winning_outcome: mapped, reason: `${verdict.classification} → ${mapped}` };
  }

  // Classification is not part of THIS market's question. Fall back to the
  // classifier's generic recommendation:
  //  - annul: a procedural redirect irrelevant to this market (case left, merged, dropped)
  //  - continue/no_action: nothing terminal happened
  //  - resolve: the classifier sees a merits outcome this spec doesn't cover → human review
  if (verdict.recommended_market_action === "annul") {
    return { action: "annul", reason: `classified ${verdict.classification} — procedural redirect, not this market's question` };
  }
  if (
    verdict.recommended_market_action === "continue_tracking" ||
    verdict.recommended_market_action === "no_action"
  ) {
    return { action: "continue", reason: `no terminal event (${verdict.classification})` };
  }
  return {
    action: "review",
    reason: `classifier recommends resolve on "${verdict.classification}" but this spec's resolution_map does not cover it`,
  };
}
