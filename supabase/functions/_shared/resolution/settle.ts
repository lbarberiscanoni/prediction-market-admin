// supabase/functions/_shared/resolution/settle.ts
//
// Domain-AGNOSTIC settlement primitive. Given a market's resolution spec (from
// market_specs.params) and a verdict about the world, decide what to do with
// the market. Knows nothing about courts or FRED — a verdict is just a
// classification string + a recommended action; the spec's resolution_map binds
// classifications to outcomes. Court/FRED/custom adapters produce verdicts; this
// applies them. This is the git-versioned "logic", jsonb holds the parameters.

// Sentinel a resolution_map can use to say "this classification annuls".
export const ANNUL = "ANNUL";

// The generic recommendation an adapter attaches to a verdict when the market's
// own spec doesn't map the classification (the fallback). Same members every
// domain uses.
export type RecommendedAction = "resolve" | "annul" | "continue_tracking" | "no_action";

// What an adapter reports about an event. `classification` is a domain string
// (court: "appeal_affirmed"; FRED: "above_target"; etc.).
export interface Verdict {
  classification: string;
  recommended_market_action: RecommendedAction;
  evidence?: string; // quoted source text / value, for the audit trail
  confidence?: string; // "high" | "medium" | "low"
}

// The resolution binding stored under market_specs.params. `resolution_map`
// maps a classification → a winning outcome name (must be in `outcomes`) or the
// ANNUL sentinel. `docket_id`/`ref` are optional domain pointers.
export interface ResolutionSpec {
  template_id: string;
  outcomes: string[];
  resolution_map: Record<string, string>;
  close_date?: string;
  docket_id?: number; // court
  ref?: string; // generic domain pointer (e.g. FRED series id)
}

export type SettlementAction = "resolve" | "annul" | "continue" | "review";

export interface Settlement {
  action: SettlementAction;
  winning_outcome?: string; // only when action === "resolve"
  reason: string;
}

export function applyResolution(spec: ResolutionSpec, verdict: Verdict): Settlement {
  // Map-first: the market's OWN spec is authoritative for its OWN question.
  // A market that asks about a procedural event (e.g. "will this be remanded?")
  // maps that classification to an outcome and must resolve — even though an
  // adapter's generic recommendation for that event might be "annul". So consult
  // the resolution_map before falling back to the recommended action.
  const mapped: string | undefined = spec.resolution_map[verdict.classification];
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

  // Classification is not part of THIS market's question — fall back to the
  // adapter's generic recommendation.
  if (verdict.recommended_market_action === "annul") {
    return { action: "annul", reason: `classified ${verdict.classification} — not this market's question` };
  }
  if (
    verdict.recommended_market_action === "continue_tracking" ||
    verdict.recommended_market_action === "no_action"
  ) {
    return { action: "continue", reason: `no terminal event (${verdict.classification})` };
  }
  return {
    action: "review",
    reason: `recommendation is resolve on "${verdict.classification}" but the spec's resolution_map does not cover it`,
  };
}
