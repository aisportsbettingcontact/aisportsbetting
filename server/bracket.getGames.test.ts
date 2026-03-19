/**
 * bracket.getGames — vitest
 *
 * Verifies that the bracket data endpoint returns the correct structure:
 * - 36 total games (4 First Four + 32 R64)
 * - All required fields present
 * - bracketGameId values are unique
 * - All 4 regions represented (EAST, SOUTH, WEST, MIDWEST)
 * - First Four games have bracketRound = FIRST_FOUR
 * - R64 games have bracketRound = R64
 */

import { describe, it, expect } from "vitest";
import { getBracketGames } from "./db";

describe("getBracketGames", () => {
  it("returns 36 tournament games (4 First Four + 32 R64)", async () => {
    const games = await getBracketGames();
    expect(games.length).toBe(36);
  });

  it("all games have required fields", async () => {
    const games = await getBracketGames();
    for (const g of games) {
      expect(g.id).toBeDefined();
      expect(g.awayTeam).toBeTruthy();
      expect(g.homeTeam).toBeTruthy();
      expect(g.bracketGameId).toBeDefined();
      expect(g.bracketRound).toBeTruthy();
      expect(g.bracketRegion).toBeTruthy();
      expect(typeof g.bracketSlot).toBe("number");
    }
  });

  it("bracketGameId values are unique", async () => {
    const games = await getBracketGames();
    const ids = games.map(g => g.bracketGameId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("has exactly 4 First Four games", async () => {
    const games = await getBracketGames();
    const ff = games.filter(g => g.bracketRound === "FIRST_FOUR");
    expect(ff.length).toBe(4);
  });

  it("First Four games have bracketGameIds 101, 102, 103, 104", async () => {
    const games = await getBracketGames();
    const ff = games.filter(g => g.bracketRound === "FIRST_FOUR");
    const ffIds = ff.map(g => g.bracketGameId).sort((a, b) => a - b);
    expect(ffIds).toEqual([101, 102, 103, 104]);
  });

  it("game 101 is UMBC vs Howard (MIDWEST 16-seed, FINAL)", async () => {
    const games = await getBracketGames();
    const g = games.find(g => g.bracketGameId === 101);
    expect(g).toBeDefined();
    expect(g!.awayTeam).toBe("umbc");
    expect(g!.homeTeam).toBe("howard");
    expect(g!.bracketRegion).toBe("MIDWEST");
    expect(g!.gameStatus).toBe("final");
    expect(g!.awayScore).toBe(83);
    expect(g!.homeScore).toBe(86);
  });

  it("game 102 is Texas vs NC State (WEST 11-seed, FINAL)", async () => {
    const games = await getBracketGames();
    const g = games.find(g => g.bracketGameId === 102);
    expect(g).toBeDefined();
    expect(g!.awayTeam).toBe("texas");
    expect(g!.homeTeam).toBe("north_carolina_st");
    expect(g!.bracketRegion).toBe("WEST");
    expect(g!.gameStatus).toBe("final");
    expect(g!.awayScore).toBe(68);
    expect(g!.homeScore).toBe(66);
  });

  it("has exactly 32 R64 games", async () => {
    const games = await getBracketGames();
    const r64 = games.filter(g => g.bracketRound === "R64");
    expect(r64.length).toBe(32);
  });

  it("has all 4 regions represented in R64", async () => {
    const games = await getBracketGames();
    const r64 = games.filter(g => g.bracketRound === "R64");
    const regions = new Set(r64.map(g => g.bracketRegion));
    expect(regions.has("EAST")).toBe(true);
    expect(regions.has("SOUTH")).toBe(true);
    expect(regions.has("WEST")).toBe(true);
    expect(regions.has("MIDWEST")).toBe(true);
  });

  it("each region has exactly 8 R64 games", async () => {
    const games = await getBracketGames();
    const r64 = games.filter(g => g.bracketRound === "R64");
    const byRegion: Record<string, number> = {};
    for (const g of r64) {
      byRegion[g.bracketRegion] = (byRegion[g.bracketRegion] ?? 0) + 1;
    }
    expect(byRegion["EAST"]).toBe(8);
    expect(byRegion["SOUTH"]).toBe(8);
    expect(byRegion["WEST"]).toBe(8);
    expect(byRegion["MIDWEST"]).toBe(8);
  });

  it("R64 bracketGameIds are in range 201-232", async () => {
    const games = await getBracketGames();
    const r64 = games.filter(g => g.bracketRound === "R64");
    for (const g of r64) {
      expect(g.bracketGameId).toBeGreaterThanOrEqual(201);
      expect(g.bracketGameId).toBeLessThanOrEqual(232);
    }
  });
});
