import { assertEquals } from "jsr:@std/assert@1";
import { MIN_STAKE, rankLeaderboard } from "./ranking.ts";

const row = (user_id: string, pnl: number, bought: number) => ({
  user_id,
  total_profit_loss: pnl,
  total_bought_amount: bought,
  percent_pnl: bought > 0 ? (pnl / bought) * 100 : 0,
  position: 0,
});

Deno.test("ranks by return %, not raw profit", () => {
  // Live board 2026-10-17: Candide won on raw profit with the biggest stake.
  const ranked = rankLeaderboard([
    row("candide", 431.7, 3996),
    row("rpm410", 192.0, 545.6),
    row("sharly", 182.3, 697),
  ]);
  assertEquals(ranked.map((r) => r.user_id), ["rpm410", "sharly", "candide"]);
  assertEquals(ranked.map((r) => r.position), [1, 2, 3]);
});

Deno.test("players under the minimum stake rank below every qualifier", () => {
  const ranked = rankLeaderboard([
    row("lucky", 9, 1), // +900% on a 1-token bet
    row("steady", 5, 100), // +5%
    row("loser", -50, 200), // -25%, but qualified
  ]);
  assertEquals(ranked.map((r) => r.user_id), ["steady", "loser", "lucky"]);
});

Deno.test("minimum stake is inclusive", () => {
  const ranked = rankLeaderboard([row("a", 1, MIN_STAKE), row("b", 50, MIN_STAKE - 0.01)]);
  assertEquals(ranked.map((r) => r.user_id), ["a", "b"]);
});

Deno.test("drops players who bought nothing; ties break on raw profit", () => {
  const ranked = rankLeaderboard([
    row("idle", 0, 0),
    row("small", 10, 100), // +10%
    row("big", 100, 1000), // +10%
  ]);
  assertEquals(ranked.map((r) => r.user_id), ["big", "small"]);
});

Deno.test("does not mutate the input", () => {
  const input = [row("a", 1, 100), row("b", 2, 100)];
  rankLeaderboard(input);
  assertEquals(input.map((r) => r.position), [0, 0]);
});
