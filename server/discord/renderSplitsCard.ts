/**
 * renderSplitsCard.ts
 *
 * Uses Playwright (headless Chromium) to render the splits_card.html template
 * with injected game data and screenshot it to a PNG buffer.
 *
 * The HTML template is self-contained — it loads Barlow Condensed from Google
 * Fonts and renders the exact same card design as the frontend feed.
 */

import { chromium, type Browser } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "splits_card.html");

// ─── Singleton browser instance (reused across all renders) ──────────────────
let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  console.log("[SplitsRenderer] Launching headless Chromium...");
  _browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  console.log("[SplitsRenderer] Chromium ready");
  return _browser;
}

/** Call this on bot shutdown to cleanly close the browser */
export async function closeSplitsRenderer(): Promise<void> {
  if (_browser) {
    await _browser.close();
    _browser = null;
    console.log("[SplitsRenderer] Browser closed");
  }
}

// ─── Data types ──────────────────────────────────────────────────────────────

export interface SplitsCardTeam {
  city: string;       // e.g. "Oklahoma City"
  name: string;       // e.g. "Thunder"
  abbr: string;       // e.g. "OKC"
  primary: string;    // hex
  secondary: string;  // hex
  dark: string;       // hex (darkest shade for logo gradient)
  logoText: string;   // hex (text color inside logo circle)
  logoUrl?: string;   // CDN URL for team logo image (optional)
  logoSize?: string;  // font-size for abbr fallback, e.g. "17px"
}

export interface SplitsCardData {
  away: SplitsCardTeam;
  home: SplitsCardTeam;
  league: string;     // "NBA" | "NHL" | "NCAAM"
  time: string;       // "7:30 PM ET"
  date: string;       // "March 23, 2026"
  liveSplits: boolean;

  spread: {
    awayLine: string | null;  // e.g. "-1.5"
    homeLine: string | null;  // e.g. "+1.5"
    tickets: { away: number; home: number };
    money:   { away: number; home: number };
  };
  total: {
    line: string | null;      // e.g. "5.5"
    tickets: { over: number; under: number };
    money:   { over: number; under: number };
  };
  moneyline: {
    awayLine: string | null;  // e.g. "-192"
    homeLine: string | null;  // e.g. "+160"
    tickets: { away: number; home: number };
    money:   { away: number; home: number };
  };
}

// ─── Main render function ─────────────────────────────────────────────────────

/**
 * Renders a splits card for one game and returns a PNG buffer.
 *
 * @param data - Fully populated SplitsCardData for the game
 * @returns PNG buffer ready to attach to a Discord message
 */
export async function renderSplitsCard(data: SplitsCardData): Promise<Buffer> {
  const t0 = Date.now();
  console.log(`[SplitsRenderer] Rendering: ${data.away.abbr} @ ${data.home.abbr} (${data.league})`);

  // 1. Read template HTML
  const templateHtml = fs.readFileSync(TEMPLATE_PATH, "utf-8");

  // 2. Inject game JSON into the placeholder
  const gameJson = JSON.stringify(data);
  const html = templateHtml.replace("__GAME_JSON__", gameJson.replace(/</g, "\\u003c"));

  // 3. Open page and set content
  const browser = await getBrowser();
  const page = await browser.newPage();

  // Capture browser console messages for debugging
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error(`[SplitsRenderer][BrowserConsole] ${msg.text()}`);
    } else {
      console.log(`[SplitsRenderer][BrowserConsole] ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    console.error(`[SplitsRenderer][PageError] ${err.message}`);
  });

  try {
    // Set viewport to match card width + padding
    await page.setViewportSize({ width: 860, height: 600 });

    // Load Google Fonts by setting content with a base URL so relative resources work
    await page.setContent(html, { waitUntil: "networkidle" });

    // Wait for fonts to be ready
    await page.evaluate(() => document.fonts.ready);

    // Debug: check if card has content
    const cardHtml = await page.evaluate(() => {
      const el = document.getElementById('splits-card');
      return el ? `height=${el.offsetHeight} children=${el.children.length} innerHTML_len=${el.innerHTML.length}` : 'NOT FOUND';
    });
    console.log(`[SplitsRenderer]   Card state: ${cardHtml}`);

    // Find the card element and screenshot just that
    const card = page.locator("#splits-card");
    const bbox = await card.boundingBox();
    if (!bbox) throw new Error("[SplitsRenderer] Could not locate #splits-card element");

    console.log(`[SplitsRenderer]   Card bbox: ${JSON.stringify(bbox)}`);

    const pngBuffer = await card.screenshot({
      type: "png",
      animations: "disabled",
    });

    console.log(`[SplitsRenderer] ✅ Done in ${Date.now() - t0}ms — ${pngBuffer.length} bytes`);
    return pngBuffer as Buffer;
  } finally {
    await page.close();
  }
}
