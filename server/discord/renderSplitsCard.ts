/**
 * renderSplitsCard.ts
 *
 * Uses Playwright (headless Chromium) to render the splits_card.html template
 * with injected game data and screenshot it to a PNG buffer.
 *
 * Logos are pre-fetched server-side and embedded as base64 data URIs so
 * Playwright never needs to make outbound network requests for images.
 */

import { chromium, type Browser } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import https from "https";
import http from "http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "splits_card.html");

// ─── Logo cache: URL → base64 data URI ───────────────────────────────────────
const _logoCache = new Map<string, string>();

/**
 * Fetches a logo URL and returns a base64 data URI.
 * Results are cached in memory so each logo is only fetched once per process.
 */
async function fetchLogoAsDataUri(url: string): Promise<string | null> {
  if (_logoCache.has(url)) return _logoCache.get(url)!;
  return new Promise((resolve) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) {
        console.warn(`[SplitsRenderer] Logo fetch failed (${res.statusCode}): ${url}`);
        resolve(null);
        return;
      }
      const contentType = res.headers["content-type"] || "image/svg+xml";
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const b64 = Buffer.concat(chunks).toString("base64");
        const dataUri = `data:${contentType};base64,${b64}`;
        _logoCache.set(url, dataUri);
        console.log(`[SplitsRenderer] Logo cached: ${url.split("/").slice(-3).join("/")} (${b64.length} chars)`);
        resolve(dataUri);
      });
    });
    req.on("error", (err: Error) => {
      console.warn(`[SplitsRenderer] Logo fetch error: ${url} — ${err.message}`);
      resolve(null);
    });
    req.on("timeout", () => {
      req.destroy();
      console.warn(`[SplitsRenderer] Logo fetch timeout: ${url}`);
      resolve(null);
    });
  });
}

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

  // Pre-fetch logos server-side and replace URLs with base64 data URIs
  // so Playwright never needs to make outbound network requests for images
  const enrichedData = {
    ...data,
    away: { ...data.away },
    home: { ...data.home },
  };

  if (data.away.logoUrl) {
    const dataUri = await fetchLogoAsDataUri(data.away.logoUrl);
    if (dataUri) {
      enrichedData.away.logoUrl = dataUri;
      console.log(`[SplitsRenderer] Away logo embedded: ${data.away.abbr}`);
    } else {
      console.warn(`[SplitsRenderer] Away logo unavailable, using abbr fallback: ${data.away.abbr}`);
      enrichedData.away.logoUrl = undefined;
    }
  }

  if (data.home.logoUrl) {
    const dataUri = await fetchLogoAsDataUri(data.home.logoUrl);
    if (dataUri) {
      enrichedData.home.logoUrl = dataUri;
      console.log(`[SplitsRenderer] Home logo embedded: ${data.home.abbr}`);
    } else {
      console.warn(`[SplitsRenderer] Home logo unavailable, using abbr fallback: ${data.home.abbr}`);
      enrichedData.home.logoUrl = undefined;
    }
  }

  // 1. Read template HTML
  const templateHtml = fs.readFileSync(TEMPLATE_PATH, "utf-8");

  // 2. Inject enriched game JSON (with base64 logos) into the placeholder
  const gameJson = JSON.stringify(enrichedData);
  const html = templateHtml.replace("__GAME_JSON__", gameJson.replace(/</g, "\\u003c"));

  // 3. Open page and set content
  const browser = await getBrowser();
  const page = await browser.newPage();

  // Capture browser console messages for debugging
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.error(`[SplitsRenderer][BrowserConsole] ${msg.text()}`);
    } else if (msg.type() !== "log") {
      console.log(`[SplitsRenderer][BrowserConsole] ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    console.error(`[SplitsRenderer][PageError] ${err.message}`);
  });

  try {
    // Set viewport to match card width + padding
    await page.setViewportSize({ width: 860, height: 600 });

    // Load HTML — logos are embedded as data URIs, no external requests needed
    await page.setContent(html, { waitUntil: "networkidle" });

    // Wait for fonts to be ready
    await page.evaluate(() => document.fonts.ready);

    // Debug: check if card has content
    const cardHtml = await page.evaluate(() => {
      const el = document.getElementById("splits-card");
      return el
        ? `height=${el.offsetHeight} children=${el.children.length} innerHTML_len=${el.innerHTML.length}`
        : "NOT FOUND";
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
