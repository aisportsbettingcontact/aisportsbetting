/**
 * STRICT RESPONSIVE OVERFLOW AUDIT — PASS 2
 * ──────────────────────────────────────────
 * More aggressive than pass 1:
 *   1. Zero tolerance (0px) for scrollWidth > clientWidth on text elements
 *   2. Catches text-overflow:ellipsis inside overflow:hidden containers
 *      (the parent clips, so scrollWidth is suppressed — we detect via
 *       Canvas measureText vs actual clientWidth)
 *   3. Checks every span/button/td/th/p/h1-h6/a/label/div with text content
 *   4. Reports actual rendered font size and whether the text would fit
 *      at that size in the available container width
 *
 * This catches the "visual truncation" that DOM overflow metrics miss
 * because the parent container has overflow:hidden.
 */

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const BASE_URL = "http://localhost:3000";

const SCREENS = [
  { label: "Desktop 4K",        w: 3840, h: 2160, category: "desktop" },
  { label: "Desktop 1920×1080", w: 1920, h: 1080, category: "desktop" },
  { label: "Desktop 1440×900",  w: 1440, h:  900, category: "desktop" },
  { label: "Desktop 1280×800",  w: 1280, h:  800, category: "desktop" },
  { label: "iPad Pro 12.9\"",   w: 1024, h: 1366, category: "tablet"  },
  { label: "iPad Air 10.9\"",   w:  820, h: 1180, category: "tablet"  },
  { label: "Surface Pro 7",     w:  912, h: 1368, category: "tablet"  },
  { label: "Galaxy Tab S8",     w:  800, h: 1280, category: "tablet"  },
  { label: "iPhone 15 Pro Max", w:  430, h:  932, category: "mobile"  },
  { label: "iPhone 15 Pro",     w:  393, h:  852, category: "mobile"  },
  { label: "iPhone SE (3rd)",   w:  375, h:  667, category: "mobile"  },
  { label: "iPhone 12 mini",    w:  360, h:  780, category: "mobile"  },
  { label: "Galaxy S24 Ultra",  w:  412, h:  915, category: "mobile"  },
  { label: "Galaxy S23",        w:  360, h:  800, category: "mobile"  },
  { label: "Pixel 8 Pro",       w:  412, h:  892, category: "mobile"  },
  { label: "Moto G Power",      w:  360, h:  760, category: "mobile"  },
];

const PAGES = [
  { path: "/",        label: "Home / Feed" },
  { path: "/splits",  label: "Betting Splits" },
  { path: "/edge",    label: "Edge" },
];

// ── In-page strict detector ───────────────────────────────────────────────────
function strictDetectOverflows() {
  const TEXT_TAGS = new Set(["span","p","h1","h2","h3","h4","h5","h6","button","a","label","td","th","li","dt","dd"]);
  const results = [];
  const seen = new Set();

  // Canvas for text measurement
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  function measureText(text, fontSize, fontWeight, fontFamily) {
    ctx.font = `${fontWeight} ${fontSize} ${fontFamily}`;
    return ctx.measureText(text).width;
  }

  const all = document.querySelectorAll("*");

  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    // Only check visible text-bearing elements
    if (rect.width === 0 || rect.height === 0) continue;
    if (style.display === "none" || style.visibility === "hidden") continue;

    const text = (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3)
      ? el.childNodes[0].textContent?.trim() ?? ""
      : (el.innerText || "").trim();

    if (!text || text.length < 2) continue;
    if (!TEXT_TAGS.has(tag) && !text) continue;

    const fontSize = style.fontSize;
    const fontWeight = style.fontWeight;
    const fontFamily = style.fontFamily;
    const whiteSpace = style.whiteSpace;
    const textOverflow = style.textOverflow;
    const overflow = style.overflow;
    const overflowX = style.overflowX;

    // Method 1: DOM scrollWidth (works when overflow is visible)
    const domOverflow = el.scrollWidth > el.clientWidth;

    // Method 2: Canvas measurement (catches overflow:hidden suppression)
    // Only for single-line elements (nowrap or no-wrap)
    const isSingleLine = whiteSpace === "nowrap" || whiteSpace === "pre";
    let canvasOverflow = false;
    let measuredWidth = 0;
    if (isSingleLine && text.length > 0) {
      measuredWidth = measureText(text, fontSize, fontWeight, fontFamily);
      canvasOverflow = measuredWidth > el.clientWidth + 2; // 2px tolerance
    }

    // Method 3: Ellipsis active
    const ellipsisActive = textOverflow === "ellipsis" && (domOverflow || canvasOverflow);

    if (!domOverflow && !canvasOverflow && !ellipsisActive) continue;

    // Build selector path
    const getPath = (node) => {
      const parts = [];
      let cur = node;
      for (let i = 0; i < 5 && cur && cur !== document.body; i++) {
        let seg = cur.tagName?.toLowerCase() ?? "?";
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
    const key = `${selectorPath}|${text.slice(0,20)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      selector: selectorPath,
      tag,
      text: text.slice(0, 80),
      clientW: Math.round(el.clientWidth),
      scrollW: Math.round(el.scrollWidth),
      measuredW: Math.round(measuredWidth),
      domOverflow,
      canvasOverflow,
      ellipsisActive,
      fontSize,
      fontWeight,
      whiteSpace,
      textOverflow,
      overflowX,
      rectTop: Math.round(rect.top),
    });
  }

  return results;
}

async function runStrictAudit() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║       STRICT RESPONSIVE AUDIT (PASS 2) — 16 SCREENS          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium-browser",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    headless: true,
  });

  const outDir = "/home/ubuntu/ai-sports-betting/scripts/audit-results";
  fs.mkdirSync(outDir, { recursive: true });

  const allIssues = [];
  let totalPass = 0, totalFail = 0;

  for (const screen of SCREENS) {
    let screenPass = true;
    console.log(`\n▶ ${screen.label} (${screen.w}×${screen.h}) [${screen.category.toUpperCase()}]`);

    for (const pg of PAGES) {
      const page = await browser.newPage();
      await page.setViewport({ width: screen.w, height: screen.h, deviceScaleFactor: 1 });

      try {
        await page.goto(`${BASE_URL}${pg.path}`, { waitUntil: "networkidle2", timeout: 15000 });
        await new Promise(r => setTimeout(r, 2000));

        const issues = await page.evaluate(strictDetectOverflows);

        const pass = issues.length === 0;
        if (!pass) screenPass = false;

        const icon = pass ? "✅" : "❌";
        console.log(`   ${icon} ${pg.label}: ${issues.length} issue(s)`);

        if (!pass) {
          issues.slice(0, 8).forEach(o => {
            const method = o.canvasOverflow ? "CANVAS" : o.ellipsisActive ? "ELLIPSIS" : "DOM";
            console.log(`      [${method}][${o.tag}] "${o.text.slice(0,45)}" fs=${o.fontSize} clientW=${o.clientW} scrollW=${o.scrollW} measuredW=${o.measuredW}`);
            console.log(`              sel: ${o.selector.slice(0,70)}`);
            allIssues.push({ screen: screen.label, category: screen.category, page: pg.label, ...o });
          });
          if (issues.length > 8) console.log(`      … and ${issues.length - 8} more`);
        }
      } catch (err) {
        console.log(`   ⚠️  ${pg.label}: ERROR — ${err.message}`);
        screenPass = false;
      } finally {
        await page.close();
      }
    }

    if (screenPass) totalPass++; else totalFail++;
  }

  await browser.close();

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║                   STRICT AUDIT SUMMARY                       ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`  Screens passed : ${totalPass} / 16`);
  console.log(`  Screens failed : ${totalFail} / 16`);

  if (allIssues.length > 0) {
    // Group by selector to find systemic issues
    const bySelector = {};
    allIssues.forEach(i => {
      const k = `${i.selector}|${i.text.slice(0,20)}`;
      if (!bySelector[k]) bySelector[k] = { ...i, count: 0, screens: [], categories: new Set() };
      bySelector[k].count++;
      bySelector[k].screens.push(i.screen);
      bySelector[k].categories.add(i.category);
    });

    console.log(`\n  SYSTEMIC ISSUES (appearing on multiple screens):`);
    Object.values(bySelector)
      .sort((a,b) => b.count - a.count)
      .forEach(i => {
        const cats = [...i.categories].join("+");
        console.log(`\n  [${i.tag}][${cats}] "${i.text.slice(0,55)}" (${i.count} screens)`);
        console.log(`    fontSize  : ${i.fontSize}  fontWeight: ${i.fontWeight}`);
        console.log(`    clientW   : ${i.clientW}  scrollW: ${i.scrollW}  measuredW: ${i.measuredW}`);
        console.log(`    whiteSpace: ${i.whiteSpace}  textOverflow: ${i.textOverflow}`);
        console.log(`    selector  : ${i.selector.slice(0,80)}`);
      });

    // Save detailed JSON
    const reportPath = path.join(outDir, "strict-audit-report.json");
    fs.writeFileSync(reportPath, JSON.stringify({ totalPass, totalFail, issues: allIssues, bySelector: Object.values(bySelector) }, null, 2));
    console.log(`\n  Detailed report: ${reportPath}`);
  } else {
    console.log("\n  🎉 ZERO issues found across all 16 screens and 3 pages!");
  }

  return { totalPass, totalFail, allIssues };
}

runStrictAudit().catch(err => {
  console.error("STRICT AUDIT FAILED:", err);
  process.exit(1);
});
