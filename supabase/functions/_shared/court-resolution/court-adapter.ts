// supabase/functions/_shared/court-resolution/court-adapter.ts
//
// The court-case ResolutionAdapter — the domain plug for event kind
// "court_case". Given a live spec, it fetches the case's recent docket entries
// from CourtListener, runs classifyDocket (LLM), and returns a domain-agnostic
// Verdict the generic watcher applies. A FRED adapter would be a sibling that
// reads an observation instead; the engine is unchanged.

import type { LiveSpec, ResolutionAdapter } from "../resolution/watcher.ts";
import type { Verdict } from "../resolution/settle.ts";
import { classifyDocket } from "./classify.ts";
import type { CaseFixture, DocketEntry } from "./taxonomy.ts";

const CL_ENTRIES = "https://www.courtlistener.com/api/rest/v4/docket-entries/";

// Pull the docket id and display fields from the spec/event.
function docketId(spec: LiveSpec): number | null {
  if (typeof spec.params.docket_id === "number") return spec.params.docket_id;
  const d = spec.event.details?.["cl_docket_id"];
  return typeof d === "number" ? d : null;
}

async function fetchRecentEntries(id: number, token: string): Promise<DocketEntry[]> {
  const res = await fetch(`${CL_ENTRIES}?docket=${id}&order_by=-date_filed&page_size=25`, {
    headers: token ? { Authorization: `Token ${token}` } : {},
  });
  if (!res.ok) throw new Error(`CourtListener docket-entries ${res.status}: ${await res.text()}`);
  const data: { results?: Array<{ entry_number: number | null; date_filed: string | null; description: string | null }> } =
    await res.json();
  return (data.results ?? []).map((e) => ({
    entry_number: e.entry_number,
    date_filed: e.date_filed,
    description: e.description,
  }));
}

export function courtAdapter(env?: { clToken?: string; anthropicKey?: string }): ResolutionAdapter {
  const clToken = env?.clToken ?? Deno.env.get("COURTLISTENER_API_TOKEN") ?? "";
  const anthropicKey = env?.anthropicKey ?? Deno.env.get("ANTHROPIC_API_KEY") ?? "";

  return {
    kind: "court_case",
    async produceVerdict(spec: LiveSpec): Promise<Verdict | null> {
      const id = docketId(spec);
      if (id === null) throw new Error(`spec ${spec.spec_id} has no docket id`);
      if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not set");

      const entries = await fetchRecentEntries(id, clToken);
      const fixture: CaseFixture = {
        docket_id: id,
        case_name: spec.event.title,
        court_id: String(spec.event.details?.["court_id"] ?? ""),
        court_level: String(spec.event.details?.["court_level"] ?? "district"),
        date_filed: String(spec.event.details?.["date_filed"] ?? ""),
        date_terminated: (spec.event.details?.["date_terminated"] as string | null) ?? null,
        docket_url: String(spec.event.details?.["docket_url"] ?? ""),
        entries,
      };

      const r = await classifyDocket(fixture, anthropicKey);

      // No terminal event yet → no verdict; the market keeps running.
      if (r.classification === "pending") return null;

      return {
        classification: r.classification,
        recommended_market_action: r.recommended_market_action,
        evidence: r.evidence_entry,
        confidence: r.confidence,
      };
    },
  };
}
