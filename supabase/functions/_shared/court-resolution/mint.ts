// supabase/functions/_shared/court-resolution/mint.ts
//
// Pure logic for the mint step (draft spec → live market). Two decisions live
// here so they're unit-testable: whether a refined draft is confident enough to
// auto-approve, and the exact add-market payload a draft becomes. The edge
// function does the I/O (refine → decide → add-market → mark live).

import type { Confidence, RefinedDraft } from "./refine.ts";

// add-market's request shape (see supabase/functions/add-market/index.ts).
export interface AddMarketRequest {
  name: string;
  description: string;
  close_date?: string;
  tags?: string[];
  status?: string;
  link?: string;
  outcomes?: Array<{ name: string; tokens?: number }>;
}

// Auto-approve confident drafts; low confidence goes to human review instead of
// minting. This is the "review-by-exception" gate at creation time — the mirror
// of the resolution watcher's confidence gate.
export function approvalDecision(confidence: Confidence): "approve" | "queue" {
  return confidence === "low" ? "queue" : "approve";
}

const DEFAULT_TOKENS = 10000;

// Turn a refined draft + its event into the market to create. The market's
// outcomes come straight from the draft's resolution spec, so what gets minted
// and what settles are the same set by construction.
export function buildAddMarketPayload(
  refined: RefinedDraft,
  event: { title: string; details: Record<string, unknown> },
): AddMarketRequest {
  const docketUrl = typeof event.details?.docket_url === "string" ? event.details.docket_url : undefined;
  const description = [
    refined.justification ?? "",
    refined.review_notes ? `Note: ${refined.review_notes}` : "",
    docketUrl ? `Docket: ${docketUrl}` : "",
    `Resolution: settled from the case docket via the ${refined.template_id} template.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    name: refined.question,
    description,
    close_date: refined.close_date,
    tags: ["Legal", "Kalshi/Polymarket"],
    status: "open",
    link: docketUrl,
    outcomes: refined.params.outcomes.map((name) => ({ name, tokens: DEFAULT_TOKENS })),
  };
}
