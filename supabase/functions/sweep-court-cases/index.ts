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

// Company alias list. party_name is a substring match on CourtListener, so
// 'Kalshi' also matches 'KalshiEX LLC'. Polymarket's legal entities are
// Blockratize Inc. and Adventure One QSS Inc. — the brand name alone misses
// nearly everything.
const ALIASES: Array<{ company: string; terms: string[] }> = [
  { company: 'kalshi', terms: ['Kalshi'] },
  // 'Adventure One' alone substring-matches ~130 unrelated dockets; the full
  // entity name is required for precision.
  { company: 'polymarket', terms: ['Polymarket', 'Blockratize', 'Adventure One QSS'] },
];

const TERMS_BY_COMPANY: Record<string, string[]> = Object.fromEntries(ALIASES.map((a) => [a.company, a.terms]));

// A docket is "party-confirmed" when one of the matched company's aliases
// literally appears in the case name or the party list — i.e. the company is
// actually a party, not merely mentioned in the docket text. party_name hits
// are confirmed by construction; full-text hits may not be.
const isPartyConfirmed = (r: ClResult, companies: Set<string>): boolean => {
  const haystack = [r.caseName ?? '', ...(r.party ?? [])].join(' | ').toLowerCase();
  for (const company of companies) {
    for (const term of TERMS_BY_COMPANY[company] ?? []) {
      if (haystack.includes(term.toLowerCase())) return true;
    }
  }
  return false;
};

const CL_BASE = 'https://www.courtlistener.com/api/rest/v4/search/';
const MAX_PAGES_PER_TERM = 10; // 20 results/page -> 200 dockets per term, ample headroom

// Appellate court ids: ca1..ca11, cadc, cafc, scotus. District ids like 'cacd'
// (C.D. Cal.) also start with 'ca', hence the anchored pattern.
const isAppellate = (courtId: string) => /^ca(\d{1,2}|dc|fc)$/.test(courtId);
const courtLevel = (courtId: string | null) =>
  courtId === 'scotus' ? 'scotus' : courtId && isAppellate(courtId) ? 'appellate' : 'district';

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

    const runPass = async (company: string, term: string, method: 'party_name' | 'full_text') => {
      const param = method === 'party_name' ? `party_name=${encodeURIComponent(term)}` : `q=${encodeURIComponent(`"${term}"`)}`;
      try {
        let url: string | null = `${CL_BASE}?type=r&${param}&order_by=dateFiled%20desc`;
        for (let page = 0; url && page < MAX_PAGES_PER_TERM; page++) {
          const res = await fetch(url, { headers: CL_TOKEN ? { Authorization: `Token ${CL_TOKEN}` } : {} });
          if (!res.ok) throw new Error(`CourtListener ${res.status}: ${await res.text()}`);
          const data = await res.json();
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
      party_confirmed: isPartyConfirmed(e.r, e.companies),
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
