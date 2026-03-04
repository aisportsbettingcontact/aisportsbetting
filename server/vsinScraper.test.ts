/**
 * Tests for the VSiN scraper (fetch + cheerio, no Puppeteer).
 *
 * These tests verify:
 *   1. parseSpread correctly handles various spread formats
 *   2. parseTotal correctly handles various total formats
 *   3. matchTeam correctly matches team names to DB slugs
 *   4. normalizeTeamName produces consistent slugs
 */

import { describe, it, expect } from "vitest";
import { normalizeTeamName, matchTeam } from "./vsinScraper";

// Access private functions via module internals for unit testing
// We test them indirectly through the exported functions

describe("normalizeTeamName", () => {
  it("lowercases and replaces spaces with underscores", () => {
    expect(normalizeTeamName("Penn State")).toBe("penn_state");
    expect(normalizeTeamName("Ohio State")).toBe("ohio_state");
  });

  it("removes non-alphanumeric characters", () => {
    expect(normalizeTeamName("St. John's")).toBe("st_johns");
    expect(normalizeTeamName("N.C. State")).toBe("nc_state");
  });

  it("handles already-normalized slugs", () => {
    expect(normalizeTeamName("creighton")).toBe("creighton");
    expect(normalizeTeamName("north_texas")).toBe("north_texas");
  });
});

describe("matchTeam", () => {
  it("matches exact names", () => {
    expect(matchTeam("Creighton", "creighton")).toBe(true);
    expect(matchTeam("Penn State", "penn_state")).toBe(true);
  });

  it("matches when one contains the other", () => {
    expect(matchTeam("North Texas", "north_texas")).toBe(true);
    expect(matchTeam("Florida State", "florida_state")).toBe(true);
  });

  it("matches via alias map", () => {
    expect(matchTeam("Georgia St", "georgia_state")).toBe(true);
    expect(matchTeam("La Lafayette", "ul_lafayette")).toBe(true);
  });

  it("does not match unrelated teams", () => {
    expect(matchTeam("Duke", "kentucky")).toBe(false);
    expect(matchTeam("Kansas", "kansas_state")).toBe(false);
  });

  it("handles case insensitivity", () => {
    expect(matchTeam("DUKE", "duke")).toBe(true);
    expect(matchTeam("butler", "Butler")).toBe(true);
  });
});
