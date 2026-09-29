// Pipeline-health rules: turn the raw facts (public.pipeline_health_facts +
// the FRED release calendar) into a list of human-readable issues. Pure — the
// pipeline-health edge function does the I/O and the emailing.
//
// Every check here exists because something failed SILENTLY in prod:
//   cron          — mint/watch jobs failed 77 days straight (bad JSON in the job)
//   fred_creation — get-fred-data "succeeded" daily but created nothing for a month
//   stale_closed  — FRED markets stuck 'closed' on a series that never updated
//   stuck_payments— a PayPal payout sat 'Pending' for 3 months

export const CHECKS = [
  "cron",
  "http",
  "fred_creation",
  "stale_closed",
  "stuck_payments",
  "leaderboard",
  "court_watcher",
  "court_mint",
  "review_queue",
  "payday",
] as const;
export type Check = typeof CHECKS[number];

export interface Issue {
  check: Check;
  message: string;
}

export interface HealthFacts {
  cron_failures: Array<{ jobname: string; failures: number; last_failed_at: string; last_error: string }>;
  http_errors: Array<{ status_code: number | null; error: string | null; snippet: string | null; at: string }>;
  fred_markets_for_target: number;
  stale_closed_markets: Array<{ id: number; name: string; close_date: string }>;
  stuck_payments: Array<{ id: number; amount: number; created_at: string }>;
  latest_leaderboard_date: string | null;
  live_specs_unchecked: number;
  draft_specs: number;
  oldest_draft_days: number | null;
  pending_reviews: number;
  specs_needing_review: number;
  cycle_payouts_today: number;
}

export interface FredExpectation {
  target: string; // YYYY-MM-DD close date the 06:00 run targeted
  releases: string[] | null; // indicator names expected; null = calendar lookup failed
  error?: string;
}

const isLastDayOfMonth = (d: Date) => {
  const next = new Date(d);
  next.setUTCDate(d.getUTCDate() + 1);
  return next.getUTCMonth() !== d.getUTCMonth();
};

export function evaluateHealth(f: HealthFacts, fred: FredExpectation, now: Date): Issue[] {
  const issues: Issue[] = [];
  const today = now.toISOString().slice(0, 10);

  for (const c of f.cron_failures) {
    issues.push({
      check: "cron",
      message: `Cron job '${c.jobname}' failed ${c.failures}x in the last day. Last error: ${c.last_error}`,
    });
  }

  for (const h of f.http_errors) {
    issues.push({
      check: "http",
      message: `A scheduled function call returned ${h.status_code ?? "no response"}${h.error ? ` (${h.error})` : ""}: ${h.snippet ?? ""}`,
    });
  }

  if (fred.releases === null) {
    issues.push({ check: "fred_creation", message: `Couldn't read the FRED release calendar: ${fred.error ?? "unknown error"}` });
  } else if (f.fred_markets_for_target < fred.releases.length) {
    issues.push({
      check: "fred_creation",
      message: `FRED has ${fred.releases.length} release(s) on ${fred.target} (${fred.releases.join(", ")}) but only ` +
        `${f.fred_markets_for_target} market(s) were created for it today.`,
    });
  }

  if (f.stale_closed_markets.length) {
    issues.push({
      check: "stale_closed",
      message: `${f.stale_closed_markets.length} market(s) closed 2+ weeks ago and still unresolved: ` +
        f.stale_closed_markets.map((m) => `#${m.id} ${m.name} (closed ${m.close_date})`).join("; "),
    });
  }

  if (f.stuck_payments.length) {
    issues.push({
      check: "stuck_payments",
      message: `${f.stuck_payments.length} payment(s) Pending for over a week: ` +
        f.stuck_payments.map((p) => `#${p.id} $${p.amount}`).join(", "),
    });
  }

  if (f.latest_leaderboard_date !== today) {
    issues.push({
      check: "leaderboard",
      message: `Leaderboard wasn't recalculated today (latest: ${f.latest_leaderboard_date ?? "never"}).`,
    });
  }

  if (f.live_specs_unchecked > 0) {
    issues.push({
      check: "court_watcher",
      message: `${f.live_specs_unchecked} live court market(s) haven't been checked by the watcher in 3+ days.`,
    });
  }

  if (f.draft_specs > 0 && (f.oldest_draft_days ?? 0) >= 3) {
    issues.push({
      check: "court_mint",
      message: `${f.draft_specs} draft court market(s) waiting to be minted; the oldest is ${f.oldest_draft_days} days old.`,
    });
  }

  if (f.pending_reviews + f.specs_needing_review > 0) {
    issues.push({
      check: "review_queue",
      message: `Needs a human: ${f.pending_reviews} resolution proposal(s) and ${f.specs_needing_review} draft market(s) awaiting review.`,
    });
  }

  if ((now.getUTCDate() === 15 || isLastDayOfMonth(now)) && f.cycle_payouts_today === 0) {
    issues.push({ check: "payday", message: `Today is a payout day but no leaderboard-bonus cycle was recorded.` });
  }

  return issues;
}
