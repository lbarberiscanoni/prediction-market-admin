// supabase/functions/_shared/court-discovery.ts
//
// Pure, side-effect-free logic for the court-case discovery sweep. Extracted
// from sweep-court-cases so it can be unit-tested without hitting CourtListener
// or the database. The edge function imports these; the tests exercise them.

export interface CompanyAlias {
  company: string;
  terms: string[];
}

// Company alias list. CourtListener's `party_name` is a substring match, so
// 'Kalshi' also matches 'KalshiEX LLC'. Polymarket's legal entities are
// Blockratize Inc. and Adventure One QSS Inc. — the brand name alone misses
// nearly everything, and the bare 'Adventure One' substring-matches ~130
// unrelated dockets, so the full entity name is required for precision.
export const COMPANY_ALIASES: CompanyAlias[] = [
  { company: "kalshi", terms: ["Kalshi"] },
  { company: "polymarket", terms: ["Polymarket", "Blockratize", "Adventure One QSS"] },
];

export const TERMS_BY_COMPANY: Record<string, string[]> = Object.fromEntries(
  COMPANY_ALIASES.map((a) => [a.company, a.terms]),
);

export type CourtLevel = "district" | "appellate" | "scotus";

// Appellate court ids: ca1..ca11, cadc, cafc. District ids like 'cacd'
// (C.D. Cal.) or 'cand' (N.D. Cal.) also start with 'ca', hence the anchored
// pattern — matching a bare /^ca/ would misclassify every California/Colorado/
// Connecticut district as appellate.
export const isAppellate = (courtId: string): boolean => /^ca(\d{1,2}|dc|fc)$/.test(courtId);

export const courtLevel = (courtId: string | null): CourtLevel =>
  courtId === "scotus" ? "scotus" : courtId && isAppellate(courtId) ? "appellate" : "district";

// A docket is "party-confirmed" when one of the matched company's aliases
// literally appears in the case name or the party list — i.e. the company is
// actually a party, not merely mentioned in the docket text. `party_name` hits
// are confirmed by construction; full-text (`q=`) hits may not be, so they are
// flagged party_confirmed=false for human triage.
export const partyConfirmed = (
  caseName: string,
  parties: string[],
  companies: Iterable<string>,
): boolean => {
  const haystack = [caseName ?? "", ...(parties ?? [])].join(" | ").toLowerCase();
  for (const company of companies) {
    for (const term of TERMS_BY_COMPANY[company] ?? []) {
      if (haystack.includes(term.toLowerCase())) return true;
    }
  }
  return false;
};
