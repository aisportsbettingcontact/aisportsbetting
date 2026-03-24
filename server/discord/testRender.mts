/**
 * testRender.mts — end-to-end render test
 * Run: npx tsx server/discord/testRender.mts
 */
import { renderSplitsCard, closeSplitsRenderer, type SplitsCardData } from "./renderSplitsCard.js";
import { writeFileSync } from "fs";

// ── GSW vs DAL (typical NBA game) ─────────────────────────────────────────────
const gswDal: SplitsCardData = {
  away: {
    city: "Golden State", name: "Warriors", abbr: "GSW",
    primary: "#FFC72C", secondary: "#1D428A", dark: "#0A1A40",
    logoText: "#000000",
    logoUrl: "https://cdn.nba.com/logos/nba/1610612744/global/L/logo.svg",
  },
  home: {
    city: "Dallas", name: "Mavericks", abbr: "DAL",
    primary: "#B8C4CA", secondary: "#00538C", dark: "#001A3A",
    logoText: "#000000",
    logoUrl: "https://cdn.nba.com/logos/nba/1610612742/global/L/logo.svg",
  },
  league: "NBA", time: "9:30 PM ET", date: "March 23, 2026", liveSplits: false,
  spread: {
    awayLine: "-1.5", homeLine: "+1.5",
    tickets: { away: 51, home: 49 },
    money:   { away: 53, home: 47 },
  },
  total: {
    line: "235.5",
    tickets: { over: 65, under: 35 },
    money:   { over: 57, under: 43 },
  },
  moneyline: {
    awayLine: "-122", homeLine: "+102",
    tickets: { away: 42, home: 58 },
    money:   { away: 38, home: 62 },
  },
};

// ── BKN vs POR (extreme moneyline) ────────────────────────────────────────────
const bknPor: SplitsCardData = {
  away: {
    city: "Brooklyn", name: "Nets", abbr: "BKN",
    primary: "#AAAAAA", secondary: "#777777", dark: "#333333",
    logoText: "#FFFFFF",
    logoUrl: "https://cdn.nba.com/logos/nba/1610612751/global/L/logo.svg",
  },
  home: {
    city: "Portland", name: "Trail Blazers", abbr: "POR",
    primary: "#E03A3E", secondary: "#000000", dark: "#6A0000",
    logoText: "#FFFFFF",
    logoUrl: "https://cdn.nba.com/logos/nba/1610612757/global/L/logo.svg",
  },
  league: "NBA", time: "10:00 PM ET", date: "March 23, 2026", liveSplits: false,
  spread: {
    awayLine: "+9.5", homeLine: "-9.5",
    tickets: { away: 47, home: 53 },
    money:   { away: 28, home: 72 },
  },
  total: {
    line: "226.5",
    tickets: { over: 65, under: 35 },
    money:   { over: 57, under: 43 },
  },
  moneyline: {
    awayLine: "+350", homeLine: "-450",
    tickets: { away: 9, home: 91 },
    money:   { away: 4, home: 96 },
  },
};

// ── OTT vs NYR (NHL) ──────────────────────────────────────────────────────────
const ottNyr: SplitsCardData = {
  away: {
    city: "Ottawa", name: "Senators", abbr: "OTT",
    primary: "#E31837", secondary: "#000000", dark: "#6A0000",
    logoText: "#FFFFFF",
    logoUrl: "https://www-league.nhlstatic.com/images/logos/teams-current-primary-dark/9.svg",
  },
  home: {
    city: "New York", name: "Rangers", abbr: "NYR",
    primary: "#0038A8", secondary: "#CE1126", dark: "#001560",
    logoText: "#FFFFFF",
    logoUrl: "https://www-league.nhlstatic.com/images/logos/teams-current-primary-dark/3.svg",
  },
  league: "NHL", time: "7:30 PM ET", date: "March 23, 2026", liveSplits: false,
  spread: {
    awayLine: "+1.5", homeLine: "-1.5",
    tickets: { away: 38, home: 62 },
    money:   { away: 29, home: 71 },
  },
  total: {
    line: "6.0",
    tickets: { over: 55, under: 45 },
    money:   { over: 48, under: 52 },
  },
  moneyline: {
    awayLine: "+175", homeLine: "-215",
    tickets: { away: 33, home: 67 },
    money:   { away: 22, home: 78 },
  },
};

async function main() {
  console.log("=== Playwright Splits Card Render Test ===\n");

  const tests = [
    { data: gswDal, out: "/tmp/playwright_gsw_dal.png", label: "GSW @ DAL" },
    { data: bknPor, out: "/tmp/playwright_bkn_por.png", label: "BKN @ POR (extreme ML)" },
    { data: ottNyr, out: "/tmp/playwright_ott_nyr.png", label: "OTT @ NYR (NHL)" },
  ];

  for (const { data, out, label } of tests) {
    console.log(`\n[TEST] Rendering: ${label}`);
    const t0 = Date.now();
    try {
      const buf = await renderSplitsCard(data);
      writeFileSync(out, buf);
      console.log(`[TEST] ✅ ${label} → ${out} (${(buf.length/1024).toFixed(1)} KB, ${Date.now()-t0}ms)`);
    } catch (err) {
      console.error(`[TEST] ❌ ${label} FAILED:`, err);
    }
  }

  await closeSplitsRenderer();
  console.log("\n=== Test complete ===");
}

main().catch((err) => { console.error(err); process.exit(1); });
