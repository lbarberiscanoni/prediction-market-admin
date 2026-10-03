// FRED market resolution decision — pure logic, FRED access injected (same
// dependency-injection pattern as runWatcher / runAutoPayCycle).
//
// A FRED market asks "will the release on <close_date> be higher than <target>?".
// So it must settle on the value PUBLISHED IN THAT RELEASE:
//   1. find a FRED vintage (publication date) of the series in the release
//      window [close - 2d, close + 7d] (capped at today) that CHANGED the latest
//      data point — a new observation, or a revised value for the latest one
//      (BBKMGDP's monthly releases mostly revise the latest quarter's point);
//   2. resolve Yes if that release's value > target, else No;
//   3. no such vintage and the window has passed → annul (the release carried no
//      new data for this series, e.g. TERMCBCCALLNS, a quarterly series on the
//      monthly G.19 release);
//      window still open → wait.
// Never settle on `last_updated` or on a later release's/revision's value.

export const WINDOW_BEFORE_DAYS = 2;
export const WINDOW_AFTER_DAYS = 7;

export interface Observation {
  date: string; // observation period, YYYY-MM-DD
  value: number;
}

export interface FredSource {
  /** Vintage (publication) dates of the series within [start, end], ascending. */
  vintageDates(seriesId: string, start: string, end: string): Promise<string[]>;
  /** Latest numeric observation as it stood on `asOf` (ALFRED real-time). */
  latestAsOf(seriesId: string, asOf: string): Promise<Observation | null>;
}

export type FredDecision =
  | { action: "resolve"; winner: "Yes" | "No"; vintage: string; observation_date: string; value: number }
  | { action: "annul"; reason: string }
  | { action: "wait"; reason: string };

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function decideFredResolution(
  src: FredSource,
  m: { seriesId: string; closeDate: string; target: number; today: string },
): Promise<FredDecision> {
  const start = addDays(m.closeDate, -WINDOW_BEFORE_DAYS);
  const windowEnd = addDays(m.closeDate, WINDOW_AFTER_DAYS);
  const end = m.today < windowEnd ? m.today : windowEnd;

  for (const vintage of await src.vintageDates(m.seriesId, start, end)) {
    const at = await src.latestAsOf(m.seriesId, vintage);
    if (!at) continue;
    const before = await src.latestAsOf(m.seriesId, addDays(vintage, -1));
    if (before && at.date === before.date && at.value === before.value) continue; // latest point untouched
    return {
      action: "resolve",
      winner: at.value > m.target ? "Yes" : "No",
      vintage,
      observation_date: at.date,
      value: at.value,
    };
  }

  if (m.today > windowEnd) {
    return {
      action: "annul",
      reason: `no new ${m.seriesId} observation published between ${start} and ${windowEnd}`,
    };
  }
  return { action: "wait", reason: `no new ${m.seriesId} observation yet; window open until ${windowEnd}` };
}
