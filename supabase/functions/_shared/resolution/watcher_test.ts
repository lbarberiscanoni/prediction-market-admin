// supabase/functions/_shared/resolution/watcher_test.ts
//
// Unit tests for the domain-agnostic watcher engine. Pure — mock adapters, no
// network, no LLM. Proves the engine dispatches by event kind, applies verdicts
// through the generic settlement primitive, and surfaces (never swallows)
// unadapted kinds and adapter failures.
//
// Run: deno test watcher_test.ts  (or `deno task test` from the repo root)

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ANNUL, type ResolutionSpec, type Verdict } from "./settle.ts";
import { type LiveSpec, type ResolutionAdapter, runWatcher } from "./watcher.ts";

const spec = (spec_id: number, event_kind: string, params: ResolutionSpec): LiveSpec => ({
  spec_id,
  market_id: spec_id * 10,
  event_kind,
  event: { id: spec_id, kind: event_kind, title: `event ${spec_id}`, details: {} },
  params,
});

// A canned adapter: returns whatever verdict it's told, keyed by spec_id.
const mockAdapter = (kind: string, verdicts: Record<number, Verdict | null>): ResolutionAdapter => ({
  kind,
  produceVerdict: (s) => Promise.resolve(verdicts[s.spec_id] ?? null),
});

const appealYesNo: ResolutionSpec = {
  template_id: "appeal_outcome",
  outcomes: ["Yes", "No"],
  resolution_map: { appeal_affirmed: "Yes", appeal_reversed: "No", appeal_dismissed: ANNUL },
};
// A FRED-flavored spec — proves the engine is not court-specific.
const fredAbove: ResolutionSpec = {
  template_id: "fred_threshold",
  outcomes: ["Above", "Below"],
  resolution_map: { above_target: "Above", below_target: "Below" },
};

Deno.test("engine dispatches by kind and settles across domains", async () => {
  const specs = [
    spec(1, "court_case", appealYesNo),
    spec(2, "fred_release", fredAbove),
  ];
  const adapters = [
    mockAdapter("court_case", { 1: { classification: "appeal_affirmed", recommended_market_action: "resolve" } }),
    mockAdapter("fred_release", { 2: { classification: "below_target", recommended_market_action: "resolve" } }),
  ];
  const { proposals, skipped, errors } = await runWatcher(specs, adapters);
  assertEquals(skipped.length, 0);
  assertEquals(errors.length, 0);
  assertEquals(proposals.length, 2);
  const court = proposals.find((p) => p.spec_id === 1)!;
  assertEquals(court.settlement.action, "resolve");
  assertEquals(court.settlement.winning_outcome, "Yes");
  const fred = proposals.find((p) => p.spec_id === 2)!;
  assertEquals(fred.settlement.action, "resolve");
  assertEquals(fred.settlement.winning_outcome, "Below");
});

Deno.test("no adapter for a kind → skipped, not dropped, not proposed", async () => {
  const { proposals, skipped } = await runWatcher(
    [spec(1, "weather", appealYesNo)],
    [mockAdapter("court_case", {})],
  );
  assertEquals(proposals.length, 0);
  assertEquals(skipped, [{ spec_id: 1, reason: 'no adapter for event kind "weather"' }]);
});

Deno.test("adapter returns null (no signal) → no proposal, market keeps running", async () => {
  const { proposals, skipped, errors } = await runWatcher(
    [spec(1, "court_case", appealYesNo)],
    [mockAdapter("court_case", { 1: null })],
  );
  assertEquals(proposals.length, 0);
  assertEquals(skipped.length, 0);
  assertEquals(errors.length, 0);
});

Deno.test("adapter throwing is captured as an error, not a crash", async () => {
  const boom: ResolutionAdapter = {
    kind: "court_case",
    produceVerdict: () => Promise.reject(new Error("CourtListener 503")),
  };
  const { proposals, errors } = await runWatcher([spec(1, "court_case", appealYesNo)], [boom]);
  assertEquals(proposals.length, 0);
  assertEquals(errors.length, 1);
  assert(errors[0].error.includes("503"));
});

Deno.test("a 'continue' verdict produces no proposal", async () => {
  const { proposals } = await runWatcher(
    [spec(1, "court_case", appealYesNo)],
    [mockAdapter("court_case", { 1: { classification: "pending", recommended_market_action: "continue_tracking" } })],
  );
  assertEquals(proposals.length, 0);
});

Deno.test("a resolve the spec can't map surfaces as a review proposal (never auto-settled)", async () => {
  const { proposals } = await runWatcher(
    [spec(1, "court_case", appealYesNo)],
    [mockAdapter("court_case", { 1: { classification: "merits_judgment", recommended_market_action: "resolve" } })],
  );
  assertEquals(proposals.length, 1);
  assertEquals(proposals[0].settlement.action, "review");
});
