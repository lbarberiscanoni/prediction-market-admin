// supabase/functions/mint-market-specs/index.ts
//
// Mint step (Phase B glue): draft market_specs → live markets. For each draft it
// refines (LLM: better question, realistic close date, confidence), and if
// confidence is not low, mints a real market via add-market, links it to the
// event, and marks the spec `live`. Low-confidence drafts are parked as
// `needs_review` for a human (review-by-exception at creation time).
//
// Refinement is an LLM call per draft, so this processes a small BATCH per
// invocation (`limit`, default 4) to stay inside the edge runtime's wall-clock.
// Call it repeatedly (or on a cron) until no drafts remain. Supports
// {dry_run:true} — refine + decide, mint nothing.
//
// Secrets: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto), ANTHROPIC_API_KEY.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { refineDraft } from "../_shared/court-resolution/refine.ts";
import { approvalDecision, buildAddMarketPayload } from "../_shared/court-resolution/mint.ts";
import type { MarketSpecDraft } from "../_shared/court-resolution/draft.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
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
  const callFn = (name: string, payload: unknown) =>
    fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

  try {
    if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not set");
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;
    const limit = Math.min(Number(body?.limit) || 4, 10);

    // Load a batch of draft specs joined to their events.
    const res = await db(
      `market_specs?select=id,event_id,template_id,question,params,justification,close_date,events(title,details)&status=eq.draft&limit=${limit}`,
    );
    if (!res.ok) throw new Error(`market_specs read failed: ${await res.text()}`);
    const rows = (await res.json()) as Array<{
      id: number;
      event_id: number;
      template_id: string;
      question: string;
      params: MarketSpecDraft["params"];
      justification: string;
      close_date: string;
      events: { title: string; details: Record<string, unknown> } | null;
    }>;

    let minted = 0;
    let queued = 0;
    const results: Array<{ spec_id: number; decision: string; confidence: string; market_id?: number }> = [];
    const errors: Array<{ spec_id: number; error: string }> = [];

    for (const row of rows) {
      if (!row.events) {
        errors.push({ spec_id: row.id, error: "spec has no event" });
        continue;
      }
      try {
        const draft: MarketSpecDraft = {
          template_id: row.template_id,
          question: row.question,
          close_date: row.close_date,
          params: row.params,
          justification: row.justification,
        };
        const caseMeta = {
          case_name: row.events.title,
          court_id: String(row.events.details?.["court_id"] ?? ""),
          date_filed: String(row.events.details?.["date_filed"] ?? ""),
        };
        const refined = await refineDraft(draft, caseMeta, ANTHROPIC_KEY);
        const decision = approvalDecision(refined.confidence);

        if (dryRun) {
          results.push({ spec_id: row.id, decision, confidence: refined.confidence });
          decision === "approve" ? minted++ : queued++;
          continue;
        }

        // Persist the refined values back onto the spec either way.
        const specPatch = {
          question: refined.question,
          params: refined.params,
          close_date: refined.close_date,
        };

        if (decision === "queue") {
          await db(`market_specs?id=eq.${row.id}`, {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ ...specPatch, status: "needs_review" }),
          });
          queued++;
          results.push({ spec_id: row.id, decision, confidence: refined.confidence });
          continue;
        }

        // Approve → mint a real market.
        const mkRes = await callFn("add-market", buildAddMarketPayload(refined, row.events));
        if (!mkRes.ok) throw new Error(`add-market ${mkRes.status}: ${await mkRes.text()}`);
        const mk = await mkRes.json();
        const marketId = mk?.market?.id;
        if (!marketId) throw new Error(`add-market returned no market id: ${JSON.stringify(mk)}`);

        // Link the market to its event, and mark the spec live.
        await db(`markets?id=eq.${marketId}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ event_id: row.event_id }),
        });
        await db(`market_specs?id=eq.${row.id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ ...specPatch, status: "live", market_id: marketId }),
        });
        minted++;
        results.push({ spec_id: row.id, decision, confidence: refined.confidence, market_id: marketId });
      } catch (err) {
        errors.push({ spec_id: row.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return json({
      batch: rows.length,
      minted: dryRun ? 0 : minted,
      queued: dryRun ? 0 : queued,
      would_mint: dryRun ? minted : undefined,
      would_queue: dryRun ? queued : undefined,
      dry_run: dryRun,
      results,
      errors,
    });
  } catch (err) {
    console.error("mint-market-specs error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
