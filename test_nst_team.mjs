import * as cheerio from "cheerio";

const CURRENT_SEASON = "20252026";
const URL = `https://www.naturalstattrick.com/teamtable.php?fromseason=${CURRENT_SEASON}&thruseason=${CURRENT_SEASON}&stype=2&sit=5v5&score=all&rate=n&team=all&loc=B&gpf=1&gpt=&fd=&td=`;

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.naturalstattrick.com/",
};

const resp = await fetch(URL, { headers: FETCH_HEADERS });
const html = await resp.text();
const $ = cheerio.load(html);
const table = $("table#teams, table.tablesorter").first();

const headers = [];
table.find("thead tr th").each((_, th) => headers.push($(th).text().trim().toLowerCase()));
console.log("Headers:", headers.join(" | "));

// Show first 5 rows
let count = 0;
table.find("tbody tr").each((i, tr) => {
  const cells = [];
  $(tr).find("td").each((_, td) => cells.push($(td).text().trim()));
  if (cells.length >= 4 && i < 5) {
    console.log(`Row ${i}: team="${cells[1]}" cells[0]="${cells[0]}" cells[2]="${cells[2]}"`);
  }
  if (cells.length >= 4) count++;
});
console.log(`Total: ${count} rows`);
