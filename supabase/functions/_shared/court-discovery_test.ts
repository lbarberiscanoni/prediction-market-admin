// supabase/functions/_shared/court-discovery_test.ts
//
// Unit tests for the discovery sweep's pure logic. Deterministic, no network.
// Run: deno test court-discovery_test.ts
//
// These lock down the two bugs the sweep design was built to avoid:
//   1. the `ca`-prefix trap (district courts like `cand` misread as appellate)
//   2. the `Adventure One` precision trap (brand substring over-matching)
// plus the party-confirmation triage signal that separates real cases from
// full-text mentions.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  COMPANY_ALIASES,
  courtLevel,
  isAppellate,
  partyConfirmed,
} from "./court-discovery.ts";

Deno.test("courtLevel: appellate circuits", () => {
  for (const id of ["ca1", "ca9", "ca11", "cadc", "cafc"]) {
    assertEquals(courtLevel(id), "appellate", `${id} should be appellate`);
    assert(isAppellate(id));
  }
});

Deno.test("courtLevel: district courts starting with 'ca' are NOT appellate (the trap)", () => {
  // Real dockets in our registry live in these — misclassifying them as
  // appellate would corrupt the matter/proceeding split.
  for (const id of ["cand", "cacd", "casd", "caed"]) {
    assertEquals(courtLevel(id), "district", `${id} must be district, not appellate`);
    assert(!isAppellate(id));
  }
});

Deno.test("courtLevel: scotus and plain districts", () => {
  assertEquals(courtLevel("scotus"), "scotus");
  assertEquals(courtLevel("nysd"), "district");
  assertEquals(courtLevel("nvd"), "district");
  assertEquals(courtLevel(null), "district");
});

Deno.test("partyConfirmed: Kalshi appears in the case name", () => {
  assert(partyConfirmed("KalshiEX LLC v. Williams", [], ["kalshi"]));
  assert(partyConfirmed("State of Nevada v. KalshiEX, LLC", [], ["kalshi"]));
});

Deno.test("partyConfirmed: Polymarket entity aliases in parties, not the brand", () => {
  // party_name search misses the brand; the legal-entity aliases catch it.
  assert(
    partyConfirmed("State of Nevada v. Blockratize, Inc.", ["Blockratize Inc"], ["polymarket"]),
  );
  assert(partyConfirmed("Yoon v. Blockratize, Inc.", [], ["polymarket"]));
});

Deno.test("partyConfirmed: mention-only noise is NOT confirmed", () => {
  // A docket where Kalshi shows up only in the text (a related/adjacent case),
  // not the caption or party list, must be flagged for human triage.
  assertEquals(
    partyConfirmed("Robinhood Derivatives, LLC v. Dana Nessel", ["Robinhood Derivatives, LLC", "Dana Nessel"], ["kalshi"]),
    false,
  );
  assertEquals(partyConfirmed("GoHealth, Inc.", [], ["kalshi"]), false);
});

Deno.test("partyConfirmed: 'Adventure One' precision — only the full entity confirms", () => {
  // The alias list uses 'Adventure One QSS', not 'Adventure One', so an
  // unrelated 'Adventure One Travel' docket does not confirm.
  assertEquals(partyConfirmed("Adventure One Travel LLC v. Doe", [], ["polymarket"]), false);
  assert(partyConfirmed("CFTC v. Adventure One QSS Inc.", ["Adventure One QSS Inc"], ["polymarket"]));
});

Deno.test("alias list: brand-only 'Adventure One' is never a search term", () => {
  const poly = COMPANY_ALIASES.find((a) => a.company === "polymarket")!;
  assert(!poly.terms.includes("Adventure One"), "bare 'Adventure One' over-matches ~130 dockets");
  assert(poly.terms.includes("Adventure One QSS"));
  assert(poly.terms.includes("Blockratize"));
});
