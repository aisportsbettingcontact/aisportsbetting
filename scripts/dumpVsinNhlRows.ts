/**
 * Dump first 3 full TR rows from the VSiN NHL freezetable for detailed inspection.
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
  if (!resp.ok) throw new Error(`Login failed: ${resp.status}`);
  const data = await resp.json() as any;
  return data.access_token;
}

async function main() {
  const token = await getVsinAccessToken();
  const resp = await fetch("https://data.vsin.com/nhl/betting-splits/", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Cookie": `__utp=${token}`,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": "https://vsin.com/",
    },
  });
  const html = await resp.text();
  const $ = cheerio.load(html);

  console.log("=== Inspecting table.freezetable rows ===");
  $("table.freezetable tr").each((i, tr) => {
    const tds = $(tr).find("td").toArray();
    console.log(`\n--- TR[${i}] (${tds.length} tds) ---`);
    if (tds.length === 0) {
      console.log("  (header row with TH)");
      return;
    }
    
    // Show td[0] full HTML
    console.log(`  td[0] HTML (first 1500 chars):`);
    console.log($(tds[0]).html()?.substring(0, 1500));
    
    // Show what team anchors are found
    const allAnchors = $(tds[0]).find('a[href*="/teams/"]').toArray();
    console.log(`\n  All team anchors in td[0]: ${allAnchors.length}`);
    allAnchors.forEach((a, j) => {
      const inCollapse = $(a).closest(".collapse").length > 0;
      console.log(`    [${j}] href="${$(a).attr('href')}" class="${$(a).attr('class')}" text="${$(a).text().trim()}" inCollapse=${inCollapse}`);
    });
    
    // Show what anchors pass the filter
    const filtered = allAnchors.filter(a => $(a).closest(".collapse").length === 0);
    console.log(`  After .collapse filter: ${filtered.length} anchors`);
    
    // Show data-param2 values
    const params = $(tds[0]).find("[data-param2]").toArray();
    console.log(`  data-param2 elements: ${params.length}`);
    params.forEach((p, j) => {
      const inCollapse = $(p).closest(".collapse").length > 0;
      console.log(`    [${j}] data-param2="${$(p).attr('data-param2')}" inCollapse=${inCollapse}`);
    });
    
    if (i >= 3) return false; // Stop after 4 rows
  });
}
main().catch(console.error);
