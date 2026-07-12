// supabase/functions/_shared/court-resolution/classify.ts
//
// The court-resolution classifier — the function under test. Given a case's
// docket entries, it classifies the terminal event and recommends a market
// action, with a quoted docket entry as evidence. Pure input → output; no DB,
// no market spec. Resolution proper (applying an outcome to a market) is a
// separate, deterministic step downstream.
//
// Uses the Anthropic Messages API via raw fetch (matching this repo's other
// edge functions, which use fetch rather than an SDK), Opus 4.8 with adaptive
// thinking and structured outputs.

import {
  CaseFixture,
  Classification_Result,
  CLASSIFICATION_SCHEMA,
} from "./taxonomy.ts";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

const SYSTEM_PROMPT = `You classify the CURRENT disposition of a U.S. federal court case from its docket entries, for a prediction-market resolver. The companies of interest are Kalshi and Polymarket.

CRITICAL PRINCIPLE: a case being "terminated" does NOT mean it resolved on the merits. Most terminations are procedural redirects, not win/lose outcomes. Read the actual docket text — especially the most recent entries — and identify what truly happened.

Classifications:
- appeal_affirmed / appeal_reversed / appeal_vacated_remanded: an appellate court ruled on the merits (look for "JUDGMENT, Affirmed", "Reversed", "Vacated and Remanded", opinions, "MANDATE ISSUED").
- appeal_dismissed: an appeal ended without a merits ruling (e.g. "granting motion for voluntary dismissal" of the appeal). NOT a merits outcome.
- remanded_to_state: a case that was removed to federal court is sent BACK to state court ("Remanding Case to State Court", "remand to [County] Circuit/Superior Court"). We lose all visibility after this. NOT a merits outcome.
- transferred: transferred to a different federal district ("GRANTING MOTION TO TRANSFER VENUE", "Case transferred ... to [district]"). NOT a merits outcome.
- consolidated: merged into a lead/MDL case ("CONSOLIDATED MEMBER CASE", "STIPULATION TO CONSOLIDATE"). NOT a merits outcome.
- voluntarily_dismissed: the plaintiff dropped the case ("NOTICE OF VOLUNTARY DISMISSAL", Rule 41(a)). NOT a merits outcome (often without prejudice).
- dismissed_with_prejudice: a merits dismissal that cannot be refiled. Merits outcome.
- merits_judgment: a final judgment deciding the case's legal question at the district level. Merits outcome.
- district_terminated_appealed: the district case closed AND a notice of appeal was filed — the dispute has moved to a separate appellate proceeding. NOT itself a merits outcome.
- pending: no terminal event; the case is ongoing.
- other: none of the above, or genuinely unclear.

recommended_market_action:
- "resolve" ONLY for a genuine merits outcome (appeal_affirmed/reversed/vacated_remanded, merits_judgment, dismissed_with_prejudice).
- "annul" for procedural redirects that end this proceeding without a merits outcome (remanded_to_state, transferred, consolidated, voluntarily_dismissed, appeal_dismissed, district_terminated_appealed). When in doubt between resolve and annul, choose annul.
- "continue_tracking" if the case is still live (pending) with no terminal event.
- "no_action" if nothing meaningful happened.

Rules:
- Quote the single most decisive docket entry verbatim in evidence_entry.
- Never infer a merits win/loss that the text does not explicitly state.
- Ignore routine procedural noise (scheduling, pro hac vice, protective orders, transcripts) — find the dispositive entry.
- If entries have empty text, do not treat "no text" as "no event"; rely on the entries that do have text.`;

function renderPrompt(c: CaseFixture): string {
  const entries = c.entries
    .map(
      (e) =>
        `#${e.entry_number ?? "-"}  ${e.date_filed ?? "?"}  ${
          (e.description ?? "").trim() || "[no text]"
        }`,
    )
    .join("\n");
  return `Case: ${c.case_name}
Court: ${c.court_id} (level: ${c.court_level})
Filed: ${c.date_filed}   Docket-reported termination date: ${c.date_terminated ?? "none"}

Docket entries (most recent first):
${entries}

Classify the current disposition of this case.`;
}

export async function classifyDocket(
  c: CaseFixture,
  apiKey: string,
): Promise<Classification_Result> {
  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: CLASSIFICATION_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: renderPrompt(c) }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  if (data.stop_reason === "refusal") {
    throw new Error(`Model refused: ${JSON.stringify(data.stop_details)}`);
  }
  // With output_config.format the JSON answer arrives as the text block(s);
  // thinking blocks (if any) come separately and are skipped.
  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");
  if (!text) throw new Error(`No text content in response: ${JSON.stringify(data)}`);
  return JSON.parse(text) as Classification_Result;
}
