// supabase/functions/sweep-court-cases/index.ts
//
// Discovery stage of the court-market pipeline (phase 1). Sweeps CourtListener
// RECAP party-name searches for every company alias and upserts the results
// into public.court_cases. Deterministic — no LLM. Classification and market
// drafting happen downstream (decompose stage / human review).
//
// The sweep owns the discovery fields and overwrites them every run (each run
// re-queries ALL aliases, so the in-memory merge is authoritative). It never
// touches curation fields (status, company_role, case_type, matter_id, notes).
//
// POST body (all optional):
//   { dry_run: true }   -> report what would change, write nothing
//
// Secrets: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto-injected),
//          COURTLISTENER_API_TOKEN (optional; raises CL rate limits).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

// Pure discovery logic (alias list, court-level classification, party
// confirmation) lives in ../_shared/court-discovery.ts and is unit-tested there.
import { COMPANY_ALIASES as ALIASES, courtLevel, partyConfirmed } from '../_shared/court-discovery.ts';

const CL_BASE = 'https://www.courtlistener.com/api/rest/v4/search/';
const MAX_PAGES_PER_TERM = 10; // 20 results/page -> 200 dockets per term, ample headroom

interface ClResult {
  docket_id: number;
  docketNumber: string | null;
  caseName: string;
  court: string | null;
  court_id: string | null;
  dateFiled: string | null;
  dateTerminated: string | null;
  cause: string | null;
  suitNature: string | null;
  jurisdictionType: string | null;
  assignedTo: string | null;
  party: string[] | null;
  docket_absolute_url: string | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const CL_TOKEN = Deno.env.get('COURTLISTENER_API_TOKEN') ?? '';

  const db = (path: string, init?: RequestInit) =>
    fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;
    // Page 1 only by default: new filings sort to the top (dateFiled desc), so
    // 8 requests (4 terms × 2 methods) catch every new case while staying well
    // under CourtListener's 10/min authenticated cap AND inside the edge
    // runtime's wall-clock limit (~7s). The 154-row backlog is already seeded;
    // per-case resolution fetches docket entries directly, so a daily full
    // re-paginate isn't needed. `max_pages` can raise this for a one-off resync,
    // but keep it ≤1 for the pg_cron path (more pages risks 429s + wall-clock).
    const maxPages = Math.min(Number(body?.max_pages) || 1, MAX_PAGES_PER_TERM);

    // 1. Sweep CourtListener for every alias, merging by docket id. A docket
    // hit by multiple terms/companies/methods accumulates all of them.
    //
    // Two passes per term:
    //   party_name= : precise — CL confirms the term is a party (high confidence)
    //   q=          : full-text — catches cases with sparse party data (esp.
    //                 appellate), at the cost of mention-only noise. Results are
    //                 flagged party_confirmed=false unless the alias also shows
    //                 up in the case name / party list (see isPartyConfirmed).
    const merged = new Map<number, { r: ClResult; companies: Set<string>; terms: Set<string>; methods: Set<string> }>();
    const sweepErrors: Array<{ term: string; method: string; error: string }> = [];

    // Safety net for CourtListener's 10/min authenticated cap: the default
    // 8-request run stays under it, but if a 429 slips through (e.g. an
    // overlapping run), honor Retry-After once. Only one retry, so a saturated
    // window can't stack sleeps past the edge runtime's wall-clock limit.
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const clFetch = async (url: string): Promise<Response> => {
      const headers: Record<string, string> = CL_TOKEN ? { Authorization: `Token ${CL_TOKEN}` } : {};
      let res = await fetch(url, { headers });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after')) || 40;
        await sleep((retryAfter + 1) * 1000);
        res = await fetch(url, { headers });
      }
      return res;
    };

    const runPass = async (company: string, term: string, method: 'party_name' | 'full_text') => {
      const param = method === 'party_name' ? `party_name=${encodeURIComponent(term)}` : `q=${encodeURIComponent(`"${term}"`)}`;
      try {
        let url: string | null = `${CL_BASE}?type=r&${param}&order_by=dateFiled%20desc`;
        for (let page = 0; url && page < maxPages; page++) {
          const res: Response = await clFetch(url);
          if (!res.ok) throw new Error(`CourtListener ${res.status}: ${await res.text()}`);
          const data: { results?: ClResult[]; next?: string | null } = await res.json();
          for (const r of (data.results ?? []) as ClResult[]) {
            const entry = merged.get(r.docket_id) ?? { r, companies: new Set(), terms: new Set(), methods: new Set() };
            entry.r = r; // keep latest full record
            entry.companies.add(company);
            entry.terms.add(term);
            entry.methods.add(method);
            merged.set(r.docket_id, entry);
          }
          url = data.next ?? null;
        }
      } catch (err) {
        sweepErrors.push({ term, method, error: err instanceof Error ? err.message : String(err) });
      }
    };

    for (const alias of ALIASES) {
      for (const term of alias.terms) {
        await runPass(alias.company, term, 'party_name');
        await runPass(alias.company, term, 'full_text');
      }
    }

    // 2. Load existing registry ids so we know insert vs update.
    const existingRes = await db('court_cases?select=cl_docket_id');
    if (!existingRes.ok) throw new Error(`registry read failed: ${await existingRes.text()}`);
    const existingIds = new Set(((await existingRes.json()) as Array<{ cl_docket_id: number }>).map((e) => e.cl_docket_id));

    const toRow = (e: { r: ClResult; companies: Set<string>; terms: Set<string>; methods: Set<string> }) => ({
      source: 'courtlistener',
      cl_docket_id: e.r.docket_id,
      docket_number: e.r.docketNumber,
      case_name: e.r.caseName,
      court_id: e.r.court_id,
      court_name: e.r.court,
      court_level: courtLevel(e.r.court_id),
      date_filed: e.r.dateFiled,
      date_terminated: e.r.dateTerminated,
      cause: e.r.cause,
      suit_nature: e.r.suitNature,
      jurisdiction_type: e.r.jurisdictionType,
      assigned_to: e.r.assignedTo,
      parties: e.r.party ?? [],
      companies: [...e.companies].sort(),
      search_terms_matched: [...e.terms].sort(),
      discovery_methods: [...e.methods].sort(),
      party_confirmed: partyConfirmed(e.r.caseName, e.r.party ?? [], e.companies),
      absolute_url: e.r.docket_absolute_url ? `https://www.courtlistener.com${e.r.docket_absolute_url}` : null,
      raw: e.r,
      updated_at: new Date().toISOString(),
    });

    const all = [...merged.values()];
    const inserts = all.filter((e) => !existingIds.has(e.r.docket_id)).map(toRow);
    const updates = all.filter((e) => existingIds.has(e.r.docket_id)).map(toRow);

    const summarize = (rows: ReturnType<typeof toRow>[]) => ({
      party_confirmed: rows.filter((r) => r.party_confirmed).length,
      needs_review: rows.filter((r) => !r.party_confirmed).length,
      full_text_only: rows.filter((r) => !r.discovery_methods.includes('party_name')).length,
    });

    if (dryRun) {
      return json({
        dry_run: true,
        swept: all.length,
        would_insert: inserts.length,
        would_update: updates.length,
        breakdown: summarize([...inserts, ...updates]),
        sweep_errors: sweepErrors,
        needs_review_cases: [...inserts, ...updates]
          .filter((r) => !r.party_confirmed)
          .map((r) => ({ case_name: r.case_name, court: r.court_name, methods: r.discovery_methods })),
      });
    }

    // 3. Insert new candidates in one batch.
    let inserted = 0;
    if (inserts.length) {
      const res = await db('court_cases', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(inserts) });
      if (!res.ok) throw new Error(`insert failed: ${await res.text()}`);
      inserted = inserts.length;
    }

    // 4. Update discovery fields on existing rows (curation fields untouched).
    let updated = 0;
    const updateErrors: Array<{ cl_docket_id: number; error: string }> = [];
    for (const row of updates) {
      const res = await db(`court_cases?cl_docket_id=eq.${row.cl_docket_id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(row),
      });
      if (res.ok) updated++;
      else updateErrors.push({ cl_docket_id: row.cl_docket_id, error: await res.text() });
    }

    return json({
      swept: all.length,
      inserted,
      updated,
      breakdown: summarize([...inserts, ...updates]),
      sweep_errors: sweepErrors,
      update_errors: updateErrors,
      new_cases: inserts.map((r) => ({ case_name: r.case_name, court: r.court_name, filed: r.date_filed, companies: r.companies, party_confirmed: r.party_confirmed })),
    });
  } catch (err) {
    console.error('sweep-court-cases error:', err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
