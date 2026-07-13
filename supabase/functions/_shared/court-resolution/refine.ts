// supabase/functions/_shared/court-resolution/refine.ts
//
// LLM refinement of a drafted market spec. Deterministic drafting (draft.ts)
// produces template-filled questions and filing+horizon close dates; this pass
// improves the QUESTION wording, estimates a realistic CLOSE DATE from the case
// posture, and assigns a CONFIDENCE that drives auto-approval.
//
// Safety law: the LLM touches presentation only. It structurally CANNOT change
// what the market resolves on — applyRefinement reads only the LLM's
// {question, close_date, confidence, review_notes} and keeps the draft's
// `params` (resolution_map, outcomes, template_id, docket_id) verbatim. So no
// matter what the model returns, the resolution binding is preserved — a
// property the pure tests assert without calling the model.

import type { MarketSpecDraft } from "./draft.ts";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

export type Confidence = "high" | "medium" | "low";

// What the LLM is allowed to suggest — presentation only, no resolution logic.
export interface RefinementSuggestion {
  question: string;
  close_date: string; // YYYY-MM-DD
  confidence: Confidence;
  review_notes: string;
}

export interface RefinedDraft extends MarketSpecDraft {
  confidence: Confidence;
  review_notes: string;
}

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// PURE merge. Keeps the resolution binding (params) from the draft; applies only
// presentation fields from the suggestion, with defensive fallbacks. This is the
// safety boundary: it cannot emit a different resolution_map/outcomes/template.
export function applyRefinement(draft: MarketSpecDraft, s: RefinementSuggestion): RefinedDraft {
  const close_date = isYmd(s.close_date) ? s.close_date : draft.close_date;
  const question = s.question?.trim() ? s.question.trim() : draft.question;
  return {
    ...draft,
    question,
    close_date,
    // params keeps resolution_map / outcomes / template_id / docket_id verbatim;
    // only close_date syncs to the refined value so settlement uses it.
    params: { ...draft.params, close_date },
    confidence: s.confidence === "high" || s.confidence === "medium" || s.confidence === "low"
      ? s.confidence
      : "low", // unknown/missing confidence is treated as low → queued, never auto-approved
    review_notes: s.review_notes ?? "",
  };
}

const SYSTEM_PROMPT = `You refine a prediction-market question about a U.S. court case. You improve PRESENTATION only — you do NOT decide how the market resolves (that is fixed by a template and is not yours to change).

Given a draft question, its outcomes, the fixed resolution map (classification → outcome), the case caption/court, and a placeholder close date, return:
- question: a clear, unambiguous, single-sentence question that a trader can understand, consistent with the outcomes and resolution map. Do not change what is being asked — only how it is worded.
- close_date (YYYY-MM-DD): a realistic date by which the resolving event would plausibly occur, given the court level and posture. Appeals typically resolve in 9–18 months from filing; district remand/procedural motions in 2–6 months. Never earlier than the filing date.
- confidence: high if the question is crisp and the resolution map cleanly covers the likely outcomes; medium if there is some ambiguity; low if the question is hard to resolve or the map may miss likely outcomes. Low confidence sends the market to human review instead of auto-approval.
- review_notes: one sentence — any caveat, or why the confidence is not high.

Do not invent outcomes or resolution rules. Keep it faithful to the draft's intent.`;

function renderPrompt(draft: MarketSpecDraft, caseMeta: { case_name: string; court_id: string; date_filed: string }): string {
  return `Case: ${caseMeta.case_name}
Court: ${caseMeta.court_id}   Filed: ${caseMeta.date_filed}
Template: ${draft.template_id}
Outcomes: ${draft.params.outcomes.join(", ")}
Resolution map (fixed — do not change): ${JSON.stringify(draft.params.resolution_map)}
Draft question: ${draft.question}
Placeholder close date: ${draft.close_date}

Refine the question wording and estimate a realistic close date.`;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    question: { type: "string" },
    close_date: { type: "string", description: "YYYY-MM-DD" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    review_notes: { type: "string" },
  },
  required: ["question", "close_date", "confidence", "review_notes"],
} as const;

export async function refineDraft(
  draft: MarketSpecDraft,
  caseMeta: { case_name: string; court_id: string; date_filed: string },
  apiKey: string,
): Promise<RefinedDraft> {
  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: renderPrompt(draft, caseMeta) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.stop_reason === "refusal") throw new Error(`Model refused: ${JSON.stringify(data.stop_details)}`);
  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");
  if (!text) throw new Error(`No text content: ${JSON.stringify(data)}`);
  const suggestion = JSON.parse(text) as RefinementSuggestion;
  return applyRefinement(draft, suggestion);
}
