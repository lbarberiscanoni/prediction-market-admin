// supabase/functions/promote-court-cases/index.ts
//
// Phase B promotion (glue): court_cases → events + drafted market_specs. Loads
// promotable registry rows (confirmed + active + not rejected), and for each one
// not already promoted, creates an `events` row and its drafted `market_specs`
// (status 'draft'). Idempotent (dedup by events.source_ref). Supports
// {dry_run:true}.
//
// This creates only the CANONICAL layer (events + draft specs). It does NOT mint
// markets — turning a draft into a live, tradeable market is a separate step, so
// no user-facing market appears from running this.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { type CourtCaseRow, planPromotion } from "../_shared/court-resolution/promote.ts";

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

    // 1. Load promotable registry rows.
    // court_cases stores the docket link as `absolute_url`; alias it to the
    // `docket_url` the promotion logic (and event.details) expects.
    const cols =
      "id,cl_docket_id,case_name,court_id,court_level,date_filed,date_terminated,docket_url:absolute_url,party_confirmed,status,company_role,matter_id";
    const ccRes = await db(
      `court_cases?party_confirmed=eq.true&date_terminated=is.null&status=neq.rejected&select=${cols}`,
    );
    if (!ccRes.ok) throw new Error(`court_cases read failed: ${await ccRes.text()}`);
    const cases = (await ccRes.json()) as CourtCaseRow[];

    // 2. Which are already promoted (dedup by source_ref = court_cases.id).
    const evRes = await db("events?kind=eq.court_case&select=source_ref");
    if (!evRes.ok) throw new Error(`events read failed: ${await evRes.text()}`);
    const promoted = new Set(((await evRes.json()) as Array<{ source_ref: string }>).map((e) => e.source_ref));

    const plans = cases
      .filter((c) => !promoted.has(String(c.id)))
      .map((c) => ({ cc: c, plan: planPromotion(c) }))
      .filter((p): p is { cc: CourtCaseRow; plan: NonNullable<ReturnType<typeof planPromotion>> } => p.plan !== null);

    if (dryRun) {
      return json({
        dry_run: true,
        promotable: cases.length,
        already_promoted: promoted.size,
        would_create_events: plans.length,
        would_create_specs: plans.reduce((n, p) => n + p.plan.specs.length, 0),
        sample: plans.slice(0, 8).map((p) => ({
          case: p.cc.case_name,
          templates: p.plan.specs.map((s) => s.template_id),
        })),
      });
    }

    // 3. Create each event + its draft specs.
    let eventsCreated = 0;
    let specsCreated = 0;
    const errors: Array<{ case_id: number; error: string }> = [];

    for (const { cc, plan } of plans) {
      try {
        const insEv = await db("events", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(plan.event),
        });
        if (!insEv.ok) throw new Error(`event insert: ${await insEv.text()}`);
        const [event] = (await insEv.json()) as Array<{ id: number }>;
        eventsCreated++;

        if (plan.specs.length > 0) {
          const rows = plan.specs.map((s) => ({
            event_id: event.id,
            template_id: s.template_id,
            question: s.question,
            params: s.params,
            justification: s.justification,
            close_date: s.close_date,
            status: "draft",
          }));
          const insSp = await db("market_specs", {
            method: "POST",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify(rows),
          });
          if (!insSp.ok) throw new Error(`specs insert: ${await insSp.text()}`);
          specsCreated += rows.length;
        }
      } catch (err) {
        errors.push({ case_id: cc.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return json({
      promotable: cases.length,
      already_promoted: promoted.size,
      events_created: eventsCreated,
      specs_created: specsCreated,
      errors,
    });
  } catch (err) {
    console.error("promote-court-cases error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
