/**
 * Dump the raw VSiN NHL page HTML using the actual scraper's fetch method.
 */
import "dotenv/config";
import * as fs from "fs";
import * as cheerio from "cheerio";
import { ENV } from "../server/_core/env";

async function getVsinAccessToken(): Promise<string> {
  const email = ENV.vsinEmail;
  const password = ENV.vsinPassword;
  const resp = await fetch(
    "https://auth.vsin.com/id/api/v1/identity/login/token?aid=N1owYIiApu&lang=en_US",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://auth.vsin.com",
        "Referer": "https://auth.vsin.com/id/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      body: JSON.stringify({ password, remember: true, login: email, loginType: "email" }),
    }
  );
  if (!resp.ok) throw new Error(`Login failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json() as any;
  return data.access_token;
}

async function main() {
  console.log("Fetching VSiN NHL page...");
  const token = await getVsinAccessToken();
  const resp = await fetch("https://data.vsin.com/nhl/betting-splits/", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Cookie": `__utp=${token}`,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Referer": "https://vsin.com/",
    },
  });
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
  const html = await resp.text();
  fs.writeFileSync("/tmp/vsin_nhl_raw.html", html);
  console.log(`HTML saved: ${html.length} bytes`);

  const $ = cheerio.load(html);

  // Check table structure
  const tables = $("table");
  console.log(`\nTotal <table> elements: ${tables.length}`);
  tables.each((i, t) => {
    const cls = $(t).attr("class") || "(no class)";
    const rows = $(t).find("tr").length;
    const tds = $(t).find("td").length;
    console.log(`  table[${i}]: class="${cls}" rows=${rows} tds=${tds}`);
  });

  // Check all tr/td counts
  console.log(`\nTotal <tr>: ${$("tr").length}`);
  $("tr").each((i, tr) => {
    const tds = $(tr).find("td").length;
    const ths = $(tr).find("th").length;
    if (i < 25) console.log(`  tr[${i}]: ${tds} tds, ${ths} ths`);
  });

  // Check team links
  const teamLinks = $('a[href*="/teams/"]');
  console.log(`\nTeam links: ${teamLinks.length}`);
  teamLinks.each((i, el) => {
    if (i < 30) console.log(`  [${i}] href="${$(el).attr('href')}" class="${$(el).attr('class')}" text="${$(el).text().trim()}"`);
  });

  // Check for freezetable
  console.log(`\nfreezetable elements: ${$(".freezetable").length}`);
  console.log(`table.freezetable: ${$("table.freezetable").length}`);

  // Show first row with most tds
  let maxTds = 0;
  let maxRow = "";
  $("tr").each((_i, tr) => {
    const tds = $(tr).find("td").length;
    if (tds > maxTds) {
      maxTds = tds;
      maxRow = $(tr).html()?.substring(0, 800) || "";
    }
  });
  console.log(`\nRow with most TDs (${maxTds}):`);
  console.log(maxRow);
}
main().catch(console.error);
