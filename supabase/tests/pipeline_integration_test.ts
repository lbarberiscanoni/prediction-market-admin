// supabase/tests/pipeline_integration_test.ts
//
// Integration tests for the court-market pipeline's EDGE FUNCTIONS — the I/O
// glue the pure unit tests can't reach (DB reads, external API calls, batching,
// orchestration). Each test invokes the DEPLOYED function in dry-run mode, so it
// exercises the real boot → auth → DB query → compute path but writes NOTHING.
//
// These catch what unit tests can't: a deploy that didn't ship, a wrong column
// name (the `docket_url` bug), an auth/query failure, CourtListener rate-limit
// breakage. They cost a few live CL/LLM calls, so they're a separate task.
//
// Run: export SUPABASE_URL=... SUPABASE_ANON_KEY=...
//      deno test --allow-env --allow-net supabase/tests/pipeline_integration_test.ts

import { assert, assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

async function invoke(fn: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await res.json();
}

Deno.test("credentials present", () => {
  assert(URL && ANON, "set SUPABASE_URL and SUPABASE_ANON_KEY");
});

const ready = !!(URL && ANON);

// 1. Discovery: dry-run sweep reaches CourtListener and returns a clean report.
Deno.test({
  name: "sweep-court-cases: dry-run discovery, no sweep errors",
  ignore: !ready,
  fn: async () => {
    const r = await invoke("sweep-court-cases", { dry_run: true });
    assertExists(r.breakdown, `unexpected response: ${JSON.stringify(r)}`);
    assert(typeof r.swept === "number" && (r.swept as number) > 0, "should sweep some cases");
    assertEquals(r.sweep_errors, [], "no CourtListener errors (rate-limit regression guard)");
  },
});

// 2. Promotion: dry-run reads the registry + events and reports a plan.
Deno.test({
  name: "promote-court-cases: dry-run reports a plan without error",
  ignore: !ready,
  fn: async () => {
    const r = await invoke("promote-court-cases", { dry_run: true });
    assert(r.error === undefined, `errored: ${JSON.stringify(r)}`);
    assert(typeof r.promotable === "number", "promotable count present");
    assert(typeof r.would_create_events === "number", "would_create_events present");
  },
});

// 3. Mint: dry-run reads draft specs and decides (batch may be 0 once all minted).
Deno.test({
  name: "mint-market-specs: dry-run decides without error",
  ignore: !ready,
  fn: async () => {
    const r = await invoke("mint-market-specs", { dry_run: true, limit: 2 });
    assert(r.error === undefined, `errored: ${JSON.stringify(r)}`);
    assert(typeof r.batch === "number", "batch present");
    assertEquals(r.errors, [], "no per-spec errors");
  },
});

// 4. Watcher: dry-run checks one live market end to end (CL fetch + classify),
//    no adapter/exec errors — the whole resolution glue in one call.
Deno.test({
  name: "resolve-event-markets: dry-run checks a live market, no adapter errors",
  ignore: !ready,
  fn: async () => {
    const r = await invoke("resolve-event-markets", { dry_run: true, limit: 1 });
    assert(r.error === undefined, `errored: ${JSON.stringify(r)}`);
    assert(typeof r.live_specs === "number", "live_specs present");
    assertEquals(r.adapter_errors, [], "no adapter (CL/LLM) errors");
    assertEquals(r.exec_errors, [], "no execution errors");
  },
});

// 5. Health monitor: the daily alarm that catches silent pipeline failures (the
//    court jobs failed 77 days straight and FRED creation stopped for a month
//    before anyone noticed). Dry-run reads the real system and reports — sends
//    nothing. Stale closed markets are a known-real condition in prod, so the
//    report must be able to surface issues, not just return an empty list.
Deno.test({
  name: "pipeline-health: dry-run inspects every check and reports issues",
  ignore: !ready,
  fn: async () => {
    const r = await invoke("pipeline-health", { dry_run: true });
    assert(r.error === undefined, `errored: ${JSON.stringify(r)}`);
    assertEquals(r.dry_run, true);
    assertEquals(r.emailed, false, "dry run must never email");
    const checks = r.checks as string[];
    for (const c of ["cron", "http", "fred_creation", "stale_closed", "stuck_payments", "leaderboard", "court_watcher", "court_mint", "review_queue", "payday"]) {
      assert(checks.includes(c), `check '${c}' ran`);
    }
    const issues = r.issues as Array<{ check: string; message: string }>;
    assert(Array.isArray(issues), "issues is a list");
    assertEquals(r.ok, issues.length === 0, "ok iff no issues");
    for (const i of issues) assert(checks.includes(i.check) && i.message.length > 0, `well-formed issue ${JSON.stringify(i)}`);
  },
});

// 6. Health monitor auth: a real (emailing) run with only the public anon key is
//    refused — nobody can spam the admin inbox with the published key.
Deno.test({
  name: "pipeline-health: non-dry run with anon key is rejected",
  ignore: !ready,
  fn: async () => {
    const res = await fetch(`${URL}/functions/v1/pipeline-health`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await res.body?.cancel();
    assertEquals(res.status, 401);
  },
});
