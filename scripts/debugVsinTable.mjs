/**
 * Debug the VSiN freeze table DOM structure to fix the scraper.
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

const debug = await page.evaluate(() => {
  const table = document.querySelector("table.freezetable");
  if (!table) return { error: "No freeze table found" };

  const parent = table.parentElement;
  const grandParent = parent?.parentElement;

  // Check the structure
  const info = {
    tableTagName: table.tagName,
    tableClasses: table.className,
    parentTagName: parent?.tagName,
    parentClasses: parent?.className,
    grandParentTagName: grandParent?.tagName,
    grandParentClasses: grandParent?.className,
    tableChildren: Array.from(table.children).map(c => ({
      tag: c.tagName,
      classes: c.className,
      textPreview: c.textContent?.trim().slice(0, 80),
    })),
    parentChildren: Array.from(parent?.children || []).map(c => ({
      tag: c.tagName,
      classes: c.className,
    })),
  };

  // Try the wrapper approach from the scraper
  const wrapper = document.querySelector(".freezetable")?.closest("[class*='freeze']");
  info.wrapperTagName = wrapper?.tagName;
  info.wrapperClasses = wrapper?.className;
  info.wrapperChildCount = wrapper?.children.length;
  info.wrapperChildTags = Array.from(wrapper?.children || []).map(c => c.tagName).slice(0, 10);

  // Try direct THEAD/TBODY on the table
  const theads = table.querySelectorAll("thead");
  const tbodies = table.querySelectorAll("tbody");
  info.theadCount = theads.length;
  info.tbodyCount = tbodies.length;
  
  // Sample first thead
  if (theads.length > 0) {
    info.firstTheadText = theads[0].textContent?.trim().slice(0, 100);
  }
  
  // Sample first tbody first row
  if (tbodies.length > 0) {
    const firstRow = tbodies[0].querySelector("tr");
    if (firstRow) {
      const cells = Array.from(firstRow.querySelectorAll("td, th")).map(td => td.textContent?.trim().slice(0, 30));
      info.firstTbodyFirstRowCells = cells;
    }
  }

  // Check the second tbody (March 4 should be second)
  if (tbodies.length > 1) {
    const secondTbodyRows = tbodies[1].querySelectorAll("tr");
    info.secondTbodyRowCount = secondTbodyRows.length;
    const firstRow = secondTbodyRows[0];
    if (firstRow) {
      const cells = Array.from(firstRow.querySelectorAll("td, th")).map(td => td.textContent?.trim().slice(0, 40));
      info.secondTbodyFirstRowCells = cells;
    }
  }

  // Find the date headers
  const dateHeaders = Array.from(theads).map(th => th.textContent?.trim().slice(0, 50));
  info.dateHeaders = dateHeaders;

  return info;
});

console.log(JSON.stringify(debug, null, 2));

await browser.close();
