// supabase/functions/_shared/court-resolution/promote.ts
//
// Phase B promotion (pure logic): turn a court_cases registry row into the
// canonical layer — an `events` row plus its drafted `market_specs`. This is the
// registry→event step that keeps noise out of the canonical layer: only
// confirmed, active, non-rejected proceedings promote.
//
// Pure — no DB. The promote-court-cases edge function persists what this returns.

import { draftSpecs, type MarketSpecDraft } from "./draft.ts";
import type { CaseInput } from "./templates.ts";

// The court_cases registry row, as promotion needs it.
export interface CourtCaseRow {
  id: number; // court_cases.id → event.source_ref
  cl_docket_id: number;
  case_name: string;
  court_id: string;
  court_level: string;
  date_filed: string;
  date_terminated: string | null;
  docket_url: string;
  party_confirmed: boolean;
  status: string; // candidate | verified | rejected | tracking
  company_role?: string | null;
  matter_id?: number | null;
}

// An `events` row to insert (matches the live events schema: status 'open').
export interface EventInput {
  kind: string; // "court_case"
  title: string;
  status: string; // open | closed | resolved | annulled
  details: Record<string, unknown>;
  source_ref: string;
}

export interface PromotionPlan {
  event: EventInput;
  specs: MarketSpecDraft[]; // may be empty if no template applies yet
}

// A proceeding promotes when the machine is confident it's a real party (not a
// full-text mention), it's still live (not terminated → we'd have nothing to
// trade), and a human hasn't rejected it. Registry noise never reaches the
// canonical layer.
export function isPromotable(cc: CourtCaseRow): boolean {
  return cc.party_confirmed && cc.date_terminated === null && cc.status !== "rejected";
}

export function caseInputFromRow(cc: CourtCaseRow): CaseInput {
  return {
    cl_docket_id: cc.cl_docket_id,
    case_name: cc.case_name,
    court_id: cc.court_id,
    court_level: cc.court_level,
    date_filed: cc.date_filed,
    docket_url: cc.docket_url,
  };
}

export function eventFromRow(cc: CourtCaseRow): EventInput {
  return {
    kind: "court_case",
    title: cc.case_name,
    status: "open",
    // The court adapter reads these back off event.details at resolution time.
    details: {
      cl_docket_id: cc.cl_docket_id,
      court_id: cc.court_id,
      court_level: cc.court_level,
      date_filed: cc.date_filed,
      docket_url: cc.docket_url,
      matter_id: cc.matter_id ?? null,
      company_role: cc.company_role ?? null,
    },
    source_ref: String(cc.id),
  };
}

// Full plan for one case: null if it shouldn't promote, else the event + its
// drafted specs (which may be empty when no template applies yet).
export function planPromotion(cc: CourtCaseRow): PromotionPlan | null {
  if (!isPromotable(cc)) return null;
  return {
    event: eventFromRow(cc),
    specs: draftSpecs(caseInputFromRow(cc)),
  };
}
