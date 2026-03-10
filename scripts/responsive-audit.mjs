/**
 * RESPONSIVE OVERFLOW AUDIT
 * ─────────────────────────
 * Tests 16 screen sizes (4 desktop, 4 tablet, 8 mobile) for:
 *   1. Any element whose scrollWidth > clientWidth (horizontal overflow / truncation)
 *   2. Any element whose scrollHeight > clientHeight (vertical overflow)
 *   3. Any element with CSS text-overflow:ellipsis that is actually clipping
 *
 * Grades each screen size PASS / FAIL with a full list of offending elements.
 * Outputs a JSON report + a human-readable summary.
 */

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const BASE_URL = "http://localhost:3000";

// ── Screen sizes ──────────────────────────────────────────────────────────────
const SCREENS = [
  // Desktop (4)
  { label: "Desktop 4K",        w: 3840, h: 2160, category: "desktop" },
  { label: "Desktop 1920×1080", w: 1920, h: 1080, category: "desktop" },
  { label: "Desktop 1440×900",  w: 1440, h:  900, category: "desktop" },
  { label: "Desktop 1280×800",  w: 1280, h:  800, category: "desktop" },
  // Tablet (4)
  { label: "iPad Pro 12.9\"",   w: 1024, h: 1366, category: "tablet"  },
  { label: "iPad Air 10.9\"",   w:  820, h: 1180, category: "tablet"  },
  { label: "Surface Pro 7",     w:  912, h: 1368, category: "tablet"  },
  { label: "Galaxy Tab S8",     w:  800, h: 1280, category: "tablet"  },
  // Mobile (8)
  { label: "iPhone 15 Pro Max", w:  430, h:  932, category: "mobile"  },
  { label: "iPhone 15 Pro",     w:  393, h:  852, category: "mobile"  },
  { label: "iPhone SE (3rd)",   w:  375, h:  667, category: "mobile"  },
  { label: "iPhone 12 mini",    w:  360, h:  780, category: "mobile"  },
  { label: "Galaxy S24 Ultra",  w:  412, h:  915, category: "mobile"  },
  { label: "Galaxy S23",        w:  360, h:  800, category: "mobile"  },
  { label: "Pixel 8 Pro",       w:  412, h:  892, category: "mobile"  },
  { label: "Moto G Power",      w:  360, h:  760, category: "mobile"  },
];

// ── Pages to test ─────────────────────────────────────────────────────────────
const PAGES = [
  { path: "/",        label: "Home / Feed" },
  { path: "/splits",  label: "Betting Splits" },
  { path: "/edge",    label: "Edge" },
];

// ── In-page overflow detector (runs inside browser context) ───────────────────
function detectOverflows() {
  const results = [];
  const seen = new Set();

  // Walk every element in the DOM
  const all = document.querySelectorAll("*");
  for (const el of all) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue; // invisible / detached

    const style = window.getComputedStyle(el);
    const overflowX = style.overflowX;
    const overflowY = style.overflowY;
    const textOverflow = style.textOverflow;
    const whiteSpace = style.whiteSpace;

    // Horizontal overflow: scrollWidth > clientWidth (only meaningful when overflow is visible/hidden)
    const hOverflow = el.scrollWidth > el.clientWidth + 1; // +1 px tolerance
    // Vertical overflow
    const vOverflow = el.scrollHeight > el.clientHeight + 1;
    // Ellipsis clipping: text-overflow:ellipsis AND element is actually scrollable
    const ellipsisClip = textOverflow === "ellipsis" && hOverflow;

    if (!hOverflow && !vOverflow && !ellipsisClip) continue;

    // Build a concise selector path (up to 4 ancestors)
    const getPath = (node) => {
      const parts = [];
      let cur = node;
      for (let i = 0; i < 4 && cur && cur !== document.body; i++) {
        let seg = cur.tagName.toLowerCase();
        if (cur.id) seg += `#${cur.id}`;
        else if (cur.className && typeof cur.className === "string") {
          const cls = cur.className.trim().split(/\s+/).slice(0, 2).join(".");
          if (cls) seg += `.${cls}`;
        }
        parts.unshift(seg);
        cur = cur.parentElement;
      }
      return parts.join(" > ");
    };

    const selectorPath = getPath(el);
    const key = `${selectorPath}|${Math.round(rect.width)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Get text content (first 60 chars)
    const text = (el.innerText || el.textContent || "").trim().slice(0, 60);

    results.push({
      selector: selectorPath,
      tag: el.tagName.toLowerCase(),
      text: text || "(no text)",
      clientW: Math.round(el.clientWidth),
      scrollW: Math.round(el.scrollWidth),
      clientH: Math.round(el.clientHeight),
      scrollH: Math.round(el.scrollHeight),
      hOverflow,
      vOverflow,
      ellipsisClip,
      overflowX,
      overflowY,
      textOverflow,
      whiteSpace,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      rectTop: Math.round(rect.top),
      rectLeft: Math.round(rect.left),
    });
  }
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function runAudit() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║         RESPONSIVE OVERFLOW AUDIT — 16 SCREEN SIZES          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium-browser",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    headless: true,
  });

  const report = { screens: [], summary: { total: 0, passed: 0, failed: 0, issues: [] } };
  const outDir = "/home/ubuntu/ai-sports-betting/scripts/audit-results";
  fs.mkdirSync(outDir, { recursive: true });

  for (const screen of SCREENS) {
    const screenResult = { ...screen, pages: [], pass: true };
    console.log(`\n▶ ${screen.label} (${screen.w}×${screen.h}) [${screen.category.toUpperCase()}]`);

    for (const pg of PAGES) {
      const page = await browser.newPage();
      await page.setViewport({ width: screen.w, height: screen.h, deviceScaleFactor: 1 });

      try {
        await page.goto(`${BASE_URL}${pg.path}`, { waitUntil: "networkidle2", timeout: 15000 });
        // Wait for game cards to render
        await new Promise(r => setTimeout(r, 1500));

        const overflows = await page.evaluate(detectOverflows);

        // Filter out known-acceptable overflows (scrollable containers, body, html)
        const filtered = overflows.filter(o => {
          const sel = o.selector.toLowerCase();
          // Skip body/html level overflows (page scroll)
          if (o.tag === "body" || o.tag === "html") return false;
          // Skip elements where overflow is intentionally scroll
          if (o.overflowX === "scroll" || o.overflowX === "auto") return false;
          if (o.overflowY === "scroll" || o.overflowY === "auto") return false;
          // Skip invisible elements
          if (o.clientW === 0 || o.clientH === 0) return false;
          // Only flag horizontal overflows for text elements
          if (o.hOverflow && !["span","p","h1","h2","h3","h4","div","td","th","button","a","label"].includes(o.tag)) return false;
          return true;
        });

        // Take screenshot
        const ssName = `${screen.label.replace(/[^a-z0-9]/gi,"_")}_${pg.label.replace(/[^a-z0-9]/gi,"_")}.png`;
        await page.screenshot({ path: path.join(outDir, ssName), fullPage: false });

        const pass = filtered.length === 0;
        if (!pass) screenResult.pass = false;

        const pageResult = { page: pg.label, path: pg.path, pass, issues: filtered, screenshot: ssName };
        screenResult.pages.push(pageResult);

        const icon = pass ? "✅" : "❌";
        console.log(`   ${icon} ${pg.label}: ${filtered.length} issue(s)`);
        if (!pass) {
          filtered.slice(0, 5).forEach(o => {
            console.log(`      • [${o.tag}] "${o.text.slice(0,40)}" scrollW=${o.scrollW} clientW=${o.clientW} fs=${o.fontSize} sel=${o.selector.slice(0,60)}`);
          });
          if (filtered.length > 5) console.log(`      … and ${filtered.length - 5} more`);
        }
      } catch (err) {
        console.log(`   ⚠️  ${pg.label}: ERROR — ${err.message}`);
        screenResult.pages.push({ page: pg.label, path: pg.path, pass: false, issues: [], error: err.message });
        screenResult.pass = false;
      } finally {
        await page.close();
      }
    }

    report.screens.push(screenResult);
    report.summary.total++;
    if (screenResult.pass) report.summary.passed++;
    else {
      report.summary.failed++;
      screenResult.pages.forEach(p => {
        p.issues.forEach(i => report.summary.issues.push({ screen: screen.label, page: p.page, ...i }));
      });
    }
  }

  await browser.close();

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║                        AUDIT SUMMARY                         ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`  Total screens : ${report.summary.total}`);
  console.log(`  Passed        : ${report.summary.passed} ✅`);
  console.log(`  Failed        : ${report.summary.failed} ❌`);

  if (report.summary.issues.length > 0) {
    console.log(`\n  Top unique issues by selector:`);
    // Deduplicate by selector
    const bySelector = {};
    report.summary.issues.forEach(i => {
      const k = i.selector;
      if (!bySelector[k]) bySelector[k] = { ...i, count: 0, screens: [] };
      bySelector[k].count++;
      bySelector[k].screens.push(i.screen);
    });
    Object.values(bySelector)
      .sort((a,b) => b.count - a.count)
      .slice(0, 20)
      .forEach(i => {
        console.log(`\n  [${i.tag}] "${i.text.slice(0,50)}" (${i.count} screens)`);
        console.log(`    selector : ${i.selector.slice(0,80)}`);
        console.log(`    fontSize : ${i.fontSize}  fontWeight: ${i.fontWeight}`);
        console.log(`    scrollW  : ${i.scrollW}  clientW: ${i.clientW}`);
        console.log(`    screens  : ${[...new Set(i.screens)].join(", ")}`);
      });
  }

  // Write JSON report
  const reportPath = path.join(outDir, "audit-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n  Full report saved: ${reportPath}`);
  console.log(`  Screenshots in  : ${outDir}/\n`);

  return report;
}

runAudit().catch(err => {
  console.error("AUDIT FAILED:", err);
  process.exit(1);
});
