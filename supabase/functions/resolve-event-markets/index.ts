// supabase/functions/resolve-event-markets/index.ts
//
// The generic resolution watcher (Phase 3). Loads every LIVE market_spec, runs
// the domain-agnostic watcher over it with the registered resolver adapters,
// and files settlement PROPOSALS into resolution_proposals for human approval.
// Never resolves a market itself. Domain-agnostic: court today, FRED/custom by
// registering another adapter — the loop is unchanged.
//
// Secrets: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto), plus whatever the
// adapters need (COURTLISTENER_API_TOKEN, ANTHROPIC_API_KEY for the court one).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { type LiveSpec, type ResolutionAdapter, runWatcher } from "../_shared/resolution/watcher.ts";
import { courtAdapter } from "../_shared/court-resolution/court-adapter.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

// The adapter registry. Add a domain by adding one line here.
const ADAPTERS: ResolutionAdapter[] = [courtAdapter()];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = (path: string, init?: RequestInit) =>
    fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;

    // 1. Load live specs joined to their events.
    const res = await db(
      "market_specs?select=id,market_id,params,events(id,kind,title,details)&status=eq.live&market_id=not.is.null",
    );
    if (!res.ok) throw new Error(`market_specs read failed: ${await res.text()}`);
    const rows = (await res.json()) as Array<{
      id: number;
      market_id: number;
      params: LiveSpec["params"];
      events: { id: number; kind: string; title: string; details: Record<string, unknown> } | null;
    }>;

    const specs: LiveSpec[] = rows
      .filter((r) => r.events !== null)
      .map((r) => ({
        spec_id: r.id,
        market_id: r.market_id,
        event_kind: r.events!.kind,
        event: r.events!,
        params: r.params,
      }));

    // 2. Run the domain-agnostic watcher.
    const { proposals, skipped, errors } = await runWatcher(specs, ADAPTERS);

    // Call a sibling edge function (resolve-market / annul-market) with the
    // service key as bearer.
    const callFn = (name: string, payload: unknown) =>
      fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
        method: "POST",
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

    // 3. Automation stance (Lorenzo, 2026-07-12): the pipeline runs on autopilot.
    // Auto-EXECUTE confident resolve/annul (annul-market is the universal undo
    // for any play-money mistake); QUEUE only `review` settlements and
    // low-confidence calls for a human. Every action is logged in
    // resolution_proposals with its verdict + evidence.
    let executed = 0;
    let queued = 0;
    const execErrors: Array<{ spec_id: number; error: string }> = [];

    const logRow = (p: typeof proposals[number], status: string) =>
      db("resolution_proposals?on_conflict=spec_id", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({
          spec_id: p.spec_id,
          market_id: p.market_id,
          event_kind: specs.find((s) => s.spec_id === p.spec_id)?.event_kind ?? null,
          action: p.settlement.action,
          winning_outcome: p.settlement.winning_outcome ?? null,
          reason: p.settlement.reason,
          verdict: p.verdict,
          status,
        }),
      });

    for (const p of proposals) {
      const lowConf = p.verdict.confidence === "low";
      const autoExec = !lowConf && (p.settlement.action === "resolve" || p.settlement.action === "annul");

      if (dryRun) {
        autoExec ? executed++ : queued++;
        continue;
      }

      if (!autoExec) {
        // review, or low-confidence resolve/annul → human queue
        await logRow(p, "pending");
        queued++;
        continue;
      }

      try {
        if (p.settlement.action === "resolve") {
          // Map the winning outcome NAME → its outcome id for resolve-market.
          const oRes = await db(`outcomes?select=id,name&market_id=eq.${p.market_id}`);
          const outcomes = (await oRes.json()) as Array<{ id: number; name: string }>;
          const match = outcomes.find((o) => o.name === p.settlement.winning_outcome);
          if (!match) {
            // Can't map the outcome — don't guess, queue for review.
            await logRow(p, "pending");
            queued++;
            continue;
          }
          const r = await callFn("resolve-market", { market_outcome_id: match.id });
          if (!r.ok) throw new Error(`resolve-market ${r.status}: ${await r.text()}`);
          await db(`market_specs?id=eq.${p.spec_id}`, {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ status: "resolved" }),
          });
        } else {
          const r = await callFn("annul-market", { market_id: p.market_id });
          if (!r.ok) throw new Error(`annul-market ${r.status}: ${await r.text()}`);
          await db(`market_specs?id=eq.${p.spec_id}`, {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ status: "annulled" }),
          });
        }
        await logRow(p, "executed");
        executed++;
      } catch (err) {
        execErrors.push({ spec_id: p.spec_id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return json({
      live_specs: specs.length,
      proposed: proposals.length,
      executed, // auto-applied resolve/annul
      queued, // review / low-confidence → human
      dry_run: dryRun,
      by_action: {
        resolve: proposals.filter((p) => p.settlement.action === "resolve").length,
        annul: proposals.filter((p) => p.settlement.action === "annul").length,
        review: proposals.filter((p) => p.settlement.action === "review").length,
      },
      skipped, // specs whose event kind has no adapter
      adapter_errors: errors, // adapter fetch/LLM failures (retry next run)
      exec_errors: execErrors,
    });
  } catch (err) {
    console.error("resolve-event-markets error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
