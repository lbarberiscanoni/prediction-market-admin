// supabase/functions/_shared/resolution/watcher.ts
//
// Domain-AGNOSTIC resolution watcher. Given the live market specs and a set of
// per-kind resolver adapters, it produces settlement PROPOSALS for a
// human-approval queue. It never resolves a market itself.
//
// The engine knows nothing about courts or FRED. Each event kind supplies a
// ResolutionAdapter that turns an event into a Verdict; the engine applies the
// verdict to the market's spec via the generic settlement primitive. Adding a
// domain = register one adapter. This is the "resolver adapter" slot from the
// events-model design law.

import { applyResolution, type Settlement, type Verdict } from "./settle.ts";
import type { ResolutionSpec } from "./settle.ts";

// A live market_specs row joined to its event, as the watcher needs it.
export interface LiveSpec {
  spec_id: number;
  market_id: number;
  event_kind: string; // dispatch key: which adapter handles this
  event: { id: number; kind: string; title: string; details: Record<string, unknown> };
  params: ResolutionSpec;
}

// Per-domain plug. Returns a Verdict, or null if there's no resolving signal yet
// (the market keeps running). Adapters own their own fetching (docket entries,
// FRED observations, …) and any LLM calls.
export interface ResolutionAdapter {
  kind: string;
  produceVerdict(spec: LiveSpec): Promise<Verdict | null>;
}

// A proposal for the pending-approval queue. Never applied automatically.
export interface Proposal {
  spec_id: number;
  market_id: number;
  settlement: Settlement; // resolve(outcome) | annul | review
  verdict: Verdict;
}

export interface WatchResult {
  proposals: Proposal[];
  // specs whose event kind has no registered adapter — surfaced, not silently dropped
  skipped: Array<{ spec_id: number; reason: string }>;
  // adapter threw (network/LLM failure); surfaced for retry, not a crash
  errors: Array<{ spec_id: number; error: string }>;
}

export async function runWatcher(
  specs: LiveSpec[],
  adapters: ResolutionAdapter[],
): Promise<WatchResult> {
  const byKind = new Map(adapters.map((a) => [a.kind, a]));
  const result: WatchResult = { proposals: [], skipped: [], errors: [] };

  for (const spec of specs) {
    const adapter = byKind.get(spec.event_kind);
    if (!adapter) {
      result.skipped.push({ spec_id: spec.spec_id, reason: `no adapter for event kind "${spec.event_kind}"` });
      continue;
    }
    let verdict: Verdict | null;
    try {
      verdict = await adapter.produceVerdict(spec);
    } catch (err) {
      result.errors.push({ spec_id: spec.spec_id, error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (!verdict) continue; // no resolving signal yet — market keeps running

    const settlement = applyResolution(spec.params, verdict);
    if (settlement.action === "continue") continue; // nothing to propose

    // resolve / annul / review → a proposal a human reviews before it's applied.
    result.proposals.push({ spec_id: spec.spec_id, market_id: spec.market_id, settlement, verdict });
  }

  return result;
}
