// supabase/functions/pipeline-health/index.ts
//
// Daily alarm for silent pipeline failures. Runs on pg_cron after the morning
// chain (FRED 06:00 → … → court watcher 09:00), gathers facts, applies the rules
// in _shared/health/checks.ts, and emails ALERT_EMAIL only when something is
// wrong. A healthy day sends nothing.
//
// Why it exists: pg_cron marks a job "succeeded" as soon as the HTTP request is
// queued, so broken jobs looked green for months (see checks.ts header).
//
// Body: { dry_run?: boolean }  — dry run returns the report and never emails.
// Auth: dry run is open (read-only report); a real run needs x-cron-secret or
// the service-role key, so the public anon key can't spam the inbox.

import { serve } from "https://deno.land/std@0.131.0/http/server.ts";
import { CHECKS, evaluateHealth, type FredExpectation, type HealthFacts } from "../_shared/health/checks.ts";
import { isAuthorized } from "../_shared/leaderboard-payouts/auto-pay.ts";

// Must match the FRED cron job's body (fred-daily-check: days_ahead 14).
const FRED_DAYS_AHEAD = 14;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info, x-cron-secret",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  let dryRun = false;
  try {
    dryRun = (await req.json())?.dry_run === true;
  } catch (_) { /* empty body = real run */ }

  if (!dryRun) {
    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const cron = req.headers.get("x-cron-secret") ?? "";
    if (!isAuthorized(bearer, cron, { serviceKey: SERVICE_KEY, cronSecret: Deno.env.get("CRON_SECRET") })) {
      return json({ error: "unauthorized" }, 401);
    }
  }

  try {
    const now = new Date();
    const target = new Date(now);
    target.setUTCDate(now.getUTCDate() + FRED_DAYS_AHEAD);
    const targetStr = target.toISOString().slice(0, 10);

    // What FRED says should have been created today (read-only call).
    let fred: FredExpectation;
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/get-fred-data`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ days_ahead: FRED_DAYS_AHEAD, create_markets: false }),
      });
      if (!r.ok) throw new Error(`get-fred-data ${r.status}`);
      const body = await r.json();
      const releases = (body.releases_on_target_date ?? []) as Array<{ series_name: string }>;
      fred = { target: body.summary?.target_date ?? targetStr, releases: releases.map((x) => x.series_name) };
    } catch (e) {
      fred = { target: targetStr, releases: null, error: (e as Error).message };
    }

    const factsRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/pipeline_health_facts`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fred_target: fred.target }),
    });
    if (!factsRes.ok) throw new Error(`pipeline_health_facts ${factsRes.status}: ${await factsRes.text()}`);
    const facts: HealthFacts = await factsRes.json();

    const issues = evaluateHealth(facts, fred, now);
    const report = { ok: issues.length === 0, dry_run: dryRun, checks: CHECKS, issues, fred, facts };

    if (dryRun || issues.length === 0) return json({ ...report, emailed: false });

    const to = (Deno.env.get("ALERT_EMAIL") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!to.length) return json({ ...report, emailed: false, error: "ALERT_EMAIL secret not set" }, 500);

    const html = `<div style="font-family:Arial,sans-serif;max-width:640px">
      <h2>Prophet pipeline: ${issues.length} issue${issues.length === 1 ? "" : "s"}</h2>
      <ul>${issues.map((i) => `<li><b>${i.check}</b>: ${escapeHtml(i.message)}</li>`).join("")}</ul>
      <p style="color:#666;font-size:12px">Daily check from the pipeline-health edge function.
      Re-run anytime with {"dry_run":true} to see the full report.</p></div>`;
    const mail = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "prophet@cassandralabs.org",
        to,
        subject: `⚠️ Prophet pipeline: ${issues.length} issue${issues.length === 1 ? "" : "s"}`,
        html,
      }),
    });
    if (!mail.ok) return json({ ...report, emailed: false, error: `Resend ${mail.status}: ${await mail.text()}` }, 502);
    return json({ ...report, emailed: true });
  } catch (err) {
    console.error("pipeline-health error:", err);
    return json({ error: (err as Error).message ?? "Unknown error" }, 500);
  }
});
