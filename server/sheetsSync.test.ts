import { describe, it, expect } from "vitest";
import { fetchLatestSheetGames, fetchAllSheetsGames, SHEETS_FILE_ID } from "./sheetsSync";

describe("sheetsSync", () => {
  it("SHEETS_FILE_ID is 0 (virtual ID for sheet-sourced rows)", () => {
    expect(SHEETS_FILE_ID).toBe(0);
  });

  it("fetchLatestSheetGames returns games from the most recent sheet", async () => {
    const { games, sheetName } = await fetchLatestSheetGames();
    // The sheet is public and has data — should return at least 1 game
    expect(games.length).toBeGreaterThan(0);
    expect(sheetName).toBeTruthy();
    // Sheet name should match MM-DD-YYYY pattern
    expect(sheetName).toMatch(/^\d{2}-\d{2}-\d{4}$/);
  }, 30_000);

  it("games have required fields", async () => {
    const { games } = await fetchLatestSheetGames();
    for (const g of games) {
      expect(g.awayTeam).toBeTruthy();
      expect(g.homeTeam).toBeTruthy();
      expect(g.gameDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(g.sport).toBe("NCAAM");
      expect(g.fileId).toBe(SHEETS_FILE_ID);
    }
  }, 30_000);

  it("fetchAllSheetsGames returns games from multiple sheets", async () => {
    const { games, result } = await fetchAllSheetsGames();
    expect(games.length).toBeGreaterThan(0);
    expect(result.sheetsProcessed).toBeGreaterThan(0);
    expect(result.gamesFound).toBe(games.length);
    expect(result.sheetNames.length).toBe(result.sheetsProcessed);
  }, 60_000);
});
