/**
 * Debug what rawGames the scraper evaluate block returns.
 */
import puppeteer from "puppeteer";
import dotenv from "dotenv";
dotenv.config();

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});

const page = await browser.newPage();
page.setDefaultNavigationTimeout(60000);

await page.goto("https://data.vsin.com/college-basketball/betting-splits/", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});

await page.waitForSelector("table.freezetable", { timeout: 30000 });
await new Promise((r) => setTimeout(r, 2000));

const dateLabel = "Mar 4";

const rawGames = await page.evaluate((dateLabel) => {
  const wrapper = document.querySelector(".freezetable")?.closest("[class*='freeze']");
  if (!wrapper) return { error: "no wrapper", wrapperNull: true };

  const children = Array.from(wrapper.children);
  const results = [];
  let currentDate = "";
  let capture = false;
  const debugLog = [];

  for (const child of children) {
    if (child.tagName === "THEAD") {
      const dateCell = child.querySelector("th");
      currentDate = dateCell?.textContent?.trim() || "";
      const prevCapture = capture;
      capture = currentDate.includes(dateLabel);
      debugLog.push({ tag: "THEAD", currentDate: currentDate.slice(0, 60), capture, prevCapture });
    } else if (child.tagName === "TBODY") {
      debugLog.push({ tag: "TBODY", capture, rowCount: child.querySelectorAll("tr").length });
      if (capture) {
        const rows = Array.from(child.querySelectorAll("tr"));
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll("td, th")).map(
            (td) => td.textContent?.trim() || ""
          );
          if (cells.length < 5) continue;
          results.push({
            teamRaw: cells[0],
            spreadRaw: cells[1],
            totalRaw: cells[4],
          });
        }
      }
    }
  }

  return { debugLog, resultCount: results.length, firstResult: results[0] || null };
}, dateLabel);

console.log("Debug log:", JSON.stringify(rawGames.debugLog, null, 2));
console.log("Result count:", rawGames.resultCount);
console.log("First result:", JSON.stringify(rawGames.firstResult, null, 2));

await browser.close();
