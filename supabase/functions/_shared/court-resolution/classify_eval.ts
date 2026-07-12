// supabase/functions/_shared/court-resolution/classify_eval.ts
//
// Golden-set eval for the court-resolution classifier. Runs the classifier over
// frozen docket fixtures (real terminated Kalshi/Polymarket cases) and asserts
// it reproduces the hand-labeled ground truth. The fixtures are checked into
// the repo, so this tests the classifier — not CourtListener's uptime.
//
// Run:  export ANTHROPIC_API_KEY=...   (or set it in Supabase secrets)
//       deno test --allow-env --allow-read --allow-net classify_eval.ts
//
// The money-affecting assertion is `recommended_market_action`; `classification`
// is asserted too. A failure means either the classifier regressed or a label
// needs revisiting — that IS the TDD loop.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyDocket } from "./classify.ts";
import type { CaseFixture } from "./taxonomy.ts";

interface Label {
  classification: string;
  recommended_market_action: string;
  is_merits_resolution: boolean;
  note: string;
}

const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const labels: Record<string, Label> = JSON.parse(
  await Deno.readTextFile(new URL("./labels.json", import.meta.url)),
);

// Guard: without a key the eval cannot run. Fail loudly rather than silently
// passing — this is the honest "red" state until the key is configured.
Deno.test("ANTHROPIC_API_KEY is set", () => {
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — the resolution eval cannot run. " +
        "Set it (Supabase secret or env var) to exercise the classifier.",
    );
  }
});

for (const [slug, label] of Object.entries(labels)) {
  if (slug.startsWith("_")) continue; // skip the _comment key

  Deno.test({
    name: `resolve: ${slug} → ${label.recommended_market_action} (${label.classification})`,
    ignore: !apiKey,
    fn: async () => {
      const fixture: CaseFixture = JSON.parse(
        await Deno.readTextFile(new URL(`./fixtures/${slug}.json`, import.meta.url)),
      );
      const result = await classifyDocket(fixture, apiKey);

      // Money-affecting decision first.
      assertEquals(
        result.recommended_market_action,
        label.recommended_market_action,
        `market action mismatch for ${slug}\n` +
          `  expected: ${label.recommended_market_action}\n` +
          `  got:      ${result.recommended_market_action}\n` +
          `  model reasoning: ${result.reasoning}\n` +
          `  evidence: ${result.evidence_entry}`,
      );
      // Then the classification label.
      assertEquals(
        result.classification,
        label.classification,
        `classification mismatch for ${slug}\n` +
          `  expected: ${label.classification}\n` +
          `  got:      ${result.classification}\n` +
          `  model reasoning: ${result.reasoning}`,
      );
      // And the merits/procedural distinction.
      assertEquals(
        result.is_merits_resolution,
        label.is_merits_resolution,
        `is_merits_resolution mismatch for ${slug}`,
      );
    },
  });
}
