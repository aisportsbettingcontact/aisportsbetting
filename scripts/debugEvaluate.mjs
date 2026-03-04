/**
 * Minimal test — runs the exact same evaluate block as the scraper.
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
await new Promise((r) => setTimeout(r, 1500));

const dateLabel = "Mar 4";

// Run the EXACT same evaluate block as the scraper
const rawGames = await page.evaluate((dateLabel) => {
  const wrapper = document.querySelector("table.freezetable");
  if (!wrapper) return { error: "no wrapper" };

  const children = Array.from(wrapper.children);
  const results = [];
  let currentDate = "";
  let capture = false;

  for (const child of children) {
    if (child.tagName === "THEAD") {
      const dateCell = child.querySelector("th");
      currentDate = dateCell?.textContent?.trim() || "";
      capture = currentDate.includes(dateLabel);
    } else if (child.tagName === "TBODY" && capture) {
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

  return results;
}, dateLabel);

console.log("rawGames type:", typeof rawGames);
console.log("rawGames length:", Array.isArray(rawGames) ? rawGames.length : "not array");
if (Array.isArray(rawGames) && rawGames.length > 0) {
  console.log("First game:", JSON.stringify(rawGames[0], null, 2));
} else {
  console.log("rawGames:", JSON.stringify(rawGames, null, 2));
}

await browser.close();
