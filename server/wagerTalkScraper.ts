/**
 * WagerTalk Live Odds Scraper
 *
 * Uses Puppeteer to load the WagerTalk NCAAM odds page and extract
 * the current consensus spread and total for each game by rotation number.
 *
 * Returns a map of rotNum (away) → { awaySpread, homeSpread, total }
 */

import puppeteer from "puppeteer";

export interface ScrapedOdds {
  rotAway: string;
  rotHome: string;
  awaySpread: number | null;
  homeSpread: number | null;
  total: number | null;
}

export async function scrapeWagerTalkNcaam(): Promise<ScrapedOdds[]> {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Navigate to NCAAM odds page (sport=L4)
    await page.goto("https://www.wagertalk.com/odds?sport=L4", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Wait for the odds table rows to appear
    await page.waitForSelector("tr.event", { timeout: 20000 }).catch(() => {
      // Some pages use different selectors — try waiting for any table row with rotation numbers
    });

    // Give JS a moment to render dynamic content
    await new Promise((r) => setTimeout(r, 3000));

    // Extract odds data from the rendered DOM
    const results: ScrapedOdds[] = await page.evaluate(() => {
      const games: Array<{
        rotAway: string;
        rotHome: string;
        awaySpread: number | null;
        homeSpread: number | null;
        total: number | null;
      }> = [];

      // WagerTalk renders games as pairs of rows — away row then home row
      // Each row has a rotation number in the first cell
      const rows = Array.from(document.querySelectorAll("tr"));

      let i = 0;
      while (i < rows.length) {
        const row = rows[i];
        const cells = Array.from(row.querySelectorAll("td"));
        if (cells.length < 3) { i++; continue; }

        // First cell often contains rotation number
        const rotText = cells[0]?.textContent?.trim() ?? "";
        const rotNum = parseInt(rotText, 10);
        if (isNaN(rotNum) || rotNum < 100) { i++; continue; }

        // Look for the next row (home team)
        const nextRow = rows[i + 1];
        const nextCells = nextRow ? Array.from(nextRow.querySelectorAll("td")) : [];
        const rotHomeText = nextCells[0]?.textContent?.trim() ?? "";
        const rotHome = parseInt(rotHomeText, 10);

        // Extract spread from the "Consensus" column (typically index 4 or 5)
        // WagerTalk columns: Rot | Team | Score | Tickets | Money | Open | DraftKings | FanDuel | Circa | SuperBook | Caesars | BetMGM | SouthPoint | HardRock | ESPNBet
        // The "Consensus" data is typically in the SuperBook or Caesars column
        // We'll grab the first numeric spread value we find after the team name
        const extractSpread = (rowCells: Element[]): number | null => {
          for (let ci = 2; ci < rowCells.length; ci++) {
            const txt = rowCells[ci]?.textContent?.trim() ?? "";
            // Spread looks like "-3.5", "+7", "-14", "pk" etc.
            const match = txt.match(/^([+-]?\d+\.?\d*)$/);
            if (match) {
              const val = parseFloat(match[1]);
              if (!isNaN(val) && Math.abs(val) < 60) return val;
            }
            if (txt.toLowerCase() === "pk") return 0;
          }
          return null;
        };

        const extractTotal = (rowCells: Element[]): number | null => {
          for (let ci = 2; ci < rowCells.length; ci++) {
            const txt = rowCells[ci]?.textContent?.trim() ?? "";
            // Total looks like "O 148½" or "U 148½" or just "148.5"
            const match = txt.match(/[OU]\s*(\d+\.?\d*)/i) || txt.match(/^(\d{3}\.?\d*)$/);
            if (match) {
              const val = parseFloat(match[1].replace("½", ".5"));
              if (!isNaN(val) && val > 100 && val < 300) return val;
            }
          }
          return null;
        };

        const awaySpread = extractSpread(cells);
        const total = extractTotal(cells.length > 0 ? cells : nextCells);
        const homeSpread = awaySpread !== null ? -awaySpread : null;

        if (!isNaN(rotNum) && !isNaN(rotHome)) {
          games.push({
            rotAway: String(rotNum),
            rotHome: String(rotHome),
            awaySpread,
            homeSpread,
            total,
          });
          i += 2; // skip both rows
        } else {
          i++;
        }
      }

      return games;
    });

    return results;
  } finally {
    await browser.close();
  }
}
