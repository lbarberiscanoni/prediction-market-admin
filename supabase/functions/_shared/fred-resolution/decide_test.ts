// Unit tests for the FRED resolution decision. No network — the FRED source is a
// fake built from REAL ALFRED vintages of TERMCBCCALLNS (quarterly series that
// rides the monthly G.19 release, so most monthly release dates carry no new
// data for it). Run with `deno task test`.
//
// The bug these guard: the old resolver settled a market as soon as the series'
// `last_updated` was after the close date, so markets for Feb/Mar/Jun releases
// (no new data) were settled months later on the NEXT quarter's value
// (#183, #202, #234).

import { assertEquals } from "jsr:@std/assert@1";
import { decideFredResolution, type FredSource, type Observation } from "./decide.ts";

// Real ALFRED vintages: vintage date → latest observation valid on that date.
const TERMCBCCALLNS: Record<string, Observation> = {
  "2025-07-08": { date: "2025-05-01", value: 21.16 },
  "2025-10-07": { date: "2025-08-01", value: 21.39 },
  "2026-01-08": { date: "2025-11-01", value: 20.97 },
  "2026-04-08": { date: "2026-02-01", value: 21.0 },
  "2026-07-08": { date: "2026-05-01", value: 20.94 },
};

function fakeSource(vintages: Record<string, Observation>): FredSource & { calls: string[] } {
  const dates = Object.keys(vintages).sort();
  const calls: string[] = [];
  return {
    calls,
    vintageDates(_series, start, end) {
      calls.push(`vintages ${start}..${end}`);
      return Promise.resolve(dates.filter((d) => d >= start && d <= end));
    },
    latestAsOf(_series, asOf) {
      // the vintage in force on `asOf` = the last vintage date <= asOf
      const v = dates.filter((d) => d <= asOf).pop();
      return Promise.resolve(v ? vintages[v] : null);
    },
  };
}

const src = fakeSource(TERMCBCCALLNS);
const decide = (closeDate: string, target: number, today: string, s: FredSource = src) =>
  decideFredResolution(s, { seriesId: "TERMCBCCALLNS", closeDate, target, today });

// ── releases that carried new data resolve on the release's own value ──────

Deno.test("#115: Oct 7 release (21.39) > 21.16 → Yes", async () => {
  assertEquals(await decide("2025-10-07", 21.16, "2025-10-08"), {
    action: "resolve", winner: "Yes", vintage: "2025-10-07", observation_date: "2025-08-01", value: 21.39,
  });
});

Deno.test("#164: Jan 8 release (20.97) <= 21.39 → No", async () => {
  const d = await decide("2026-01-08", 21.39, "2026-01-09");
  assertEquals(d.action, "resolve");
  assertEquals(d.action === "resolve" && d.winner, "No");
});

Deno.test("#252: Jul 8 release (20.94) <= 21 → No", async () => {
  const d = await decide("2026-07-08", 21, "2026-07-09");
  assertEquals(d.action === "resolve" && [d.winner, d.value], ["No", 20.94]);
});

Deno.test("resolves on the value AS RELEASED, not a later revision", async () => {
  const revised = fakeSource({
    ...TERMCBCCALLNS,
    "2026-08-01": { date: "2026-05-01", value: 25 }, // later revision of the same point
  });
  const d = await decide("2026-07-08", 21, "2026-08-20", revised);
  assertEquals(d.action === "resolve" && [d.winner, d.value], ["No", 20.94]);
});

// ── releases with no new data for the series annul (the actual bug) ────────

Deno.test("#183: Feb 6 has no release for the series → annul once the window passes", async () => {
  // old resolver: settled 2026-04-08 on the Q1 value (Yes). Correct: annul.
  assertEquals((await decide("2026-02-06", 20.97, "2026-04-08")).action, "annul");
});

Deno.test("#202 / #234 / #297 / #303: no-update months annul", async () => {
  for (const [close, target, today] of [
    ["2026-03-06", 20.97, "2026-04-08"],
    ["2026-06-05", 21, "2026-07-09"],
    ["2026-08-07", 20.94, "2026-08-20"],
    ["2026-09-08", 20.94, "2026-10-08"], // even after the Oct release lands
  ] as const) {
    assertEquals((await decide(close, target, today)).action, "annul", close);
  }
});

Deno.test("a release that leaves the latest point unchanged → annul", async () => {
  const noChange = fakeSource({
    ...TERMCBCCALLNS,
    "2026-08-07": { date: "2026-05-01", value: 20.94 }, // only older points revised
  });
  assertEquals((await decide("2026-08-07", 20.94, "2026-08-20", noChange)).action, "annul");
});

Deno.test("BBKMGDP-style: release revises the latest point's value → resolve on it", async () => {
  // real ALFRED: the 2026-06-01 release revised March from 2.10 to 2.49 (#231 resolved Yes)
  const bbk = fakeSource({
    "2026-04-30": { date: "2026-03-01", value: 2.099986 },
    "2026-06-01": { date: "2026-03-01", value: 2.493884 },
  });
  const d = await decideFredResolution(bbk, { seriesId: "BBKMGDP", closeDate: "2026-06-01", target: 2.1, today: "2026-06-02" });
  assertEquals(d.action === "resolve" && [d.winner, d.value], ["Yes", 2.493884]);
});

// ── waiting ────────────────────────────────────────────────────────────────

Deno.test("no release yet but still inside the grace window → wait", async () => {
  assertEquals((await decide("2026-08-07", 20.94, "2026-08-08")).action, "wait");
  assertEquals((await decide("2026-08-07", 20.94, "2026-08-14")).action, "wait"); // close + 7
  assertEquals((await decide("2026-08-07", 20.94, "2026-08-15")).action, "annul"); // close + 8
});

Deno.test("release posted a few days late still counts", async () => {
  const late = fakeSource({
    "2026-06-01": { date: "2026-04-01", value: 1 },
    "2026-07-10": { date: "2026-05-01", value: 3 }, // scheduled 07-08, posted 07-10
  });
  const d = await decide("2026-07-08", 2, "2026-07-11", late);
  assertEquals(d.action === "resolve" && d.winner, "Yes");
});

Deno.test("never looks past today (no peeking at future vintages in the window)", async () => {
  const s = fakeSource(TERMCBCCALLNS);
  await decide("2026-07-08", 21, "2026-07-09", s);
  assertEquals(s.calls[0], "vintages 2026-07-06..2026-07-09");
});
