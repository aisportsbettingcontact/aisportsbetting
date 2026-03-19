/**
 * Dump the raw VSiN NHL betting-splits page HTML for debugging.
 */
import "dotenv/config";
import * as fs from "fs";
import * as cheerio from "cheerio";

// Copy the token fetch logic from nhlVsinScraper
const VSIN_EMAIL = process.env.VSIN_EMAIL!;
const VSIN_PASSWORD = process.env.VSIN_PASSWORD!;

async function getVsinAccessToken(): Promise<string> {
  const loginUrl = "https://buy.tinypass.com/id/api/v1/publisher/login";
  const params = new URLSearchParams({
    email: VSIN_EMAIL,
    password: VSIN_PASSWORD,
    aid: "Ry9rjXGnXR",
  });
  const res = await fetch(loginUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const data = await res.json() as any;
  return data.token || data.access_token;
}

async function main() {
  console.log("Fetching VSiN NHL page...");
  const token = await getVsinAccessToken();
  const url = "https://data.vsin.com/nhl/betting-splits/";
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "Mozilla/5.0 (compatible)",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const html = await res.text();
  
  // Save full HTML
  fs.writeFileSync("/tmp/vsin_nhl_raw.html", html);
  console.log(`HTML saved to /tmp/vsin_nhl_raw.html (${html.length} bytes)`);
  
  // Parse and inspect structure
  const $ = cheerio.load(html);
  
  // Look for any table rows
  const rows = $("tr");
  console.log(`\nTotal <tr> elements: ${rows.length}`);
  
  // Look for team links
  const teamLinks = $('a[href*="/teams/"]');
  console.log(`Total team links (href*/teams/): ${teamLinks.length}`);
  teamLinks.each((i, el) => {
    if (i < 20) console.log(`  [${i}] href="${$(el).attr('href')}" text="${$(el).text().trim()}"`);
  });
  
  // Look for any anchors with class containing "vsin"
  const vsinLinks = $('a[class*="vsin"]');
  console.log(`\nTotal anchors with class*=vsin: ${vsinLinks.length}`);
  vsinLinks.slice(0, 10).each((i, el) => {
    console.log(`  [${i}] class="${$(el).attr('class')}" href="${$(el).attr('href')}" text="${$(el).text().trim()}"`);
  });
  
  // Look for any anchors with txt-color
  const colorLinks = $('a[class*="txt-color"]');
  console.log(`\nTotal anchors with class*=txt-color: ${colorLinks.length}`);
  colorLinks.slice(0, 10).each((i, el) => {
    console.log(`  [${i}] class="${$(el).attr('class')}" href="${$(el).attr('href')}" text="${$(el).text().trim()}"`);
  });
  
  // Print first 3 table rows raw HTML
  console.log("\n=== First 3 TR raw HTML ===");
  rows.slice(0, 3).each((i, el) => {
    console.log(`\n--- TR[${i}] ---`);
    console.log($(el).html()?.substring(0, 500));
  });
}
main().catch(console.error);
