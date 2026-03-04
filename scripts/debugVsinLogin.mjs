/**
 * Debug the VSiN login flow step by step.
 */
import puppeteer from "puppeteer";
import dotenv from "dotenv";
dotenv.config();

const email = process.env.VSIN_EMAIL;
const password = process.env.VSIN_PASSWORD;

console.log(`Email: ${email}`);
console.log(`Password set: ${!!password}`);

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});

const page = await browser.newPage();
page.setDefaultNavigationTimeout(60000);
page.setDefaultTimeout(60000);

// Step 1: Go to the splits page
console.log("\n[1] Navigating to VSiN splits page...");
await page.goto("https://data.vsin.com/college-basketball/betting-splits/", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
console.log(`    URL: ${page.url()}`);

// Check if logged in
const hasTable = await page.$("table.freezetable");
const hasLoginLink = await page.$("#login-link-mob, .tp-modal-trigger");
console.log(`    Has freeze table: ${!!hasTable}`);
console.log(`    Has login link: ${!!hasLoginLink}`);

// Save screenshot
await page.screenshot({ path: "/home/ubuntu/vsin_step1.png" });
console.log("    Screenshot saved: /home/ubuntu/vsin_step1.png");

if (!hasTable) {
  // Step 2: Try to log in
  console.log("\n[2] Not logged in. Attempting login...");
  
  // Try the direct login page
  await page.goto("https://data.vsin.com/login/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  console.log(`    URL after goto login: ${page.url()}`);
  await page.screenshot({ path: "/home/ubuntu/vsin_step2.png" });
  console.log("    Screenshot saved: /home/ubuntu/vsin_step2.png");

  // Wait for iframe or form
  await new Promise((r) => setTimeout(r, 3000));
  
  // Check for iframe
  const frames = page.frames();
  console.log(`    Frames on page: ${frames.length}`);
  for (const f of frames) {
    console.log(`      Frame URL: ${f.url()}`);
  }

  // Look for email input in main frame or iframes
  let emailInput = await page.$("input[type='email'], input[name='email'], input[placeholder*='email' i]");
  if (!emailInput) {
    // Check iframes
    for (const f of frames) {
      emailInput = await f.$("input[type='email'], input[name='email']");
      if (emailInput) {
        console.log(`    Found email input in frame: ${f.url()}`);
        break;
      }
    }
  }
  console.log(`    Email input found: ${!!emailInput}`);
  
  await page.screenshot({ path: "/home/ubuntu/vsin_step3.png" });
}

if (hasTable) {
  // Step 3: Count games
  const gameCount = await page.evaluate(() => {
    const tbodies = document.querySelectorAll("table.freezetable tbody");
    let total = 0;
    tbodies.forEach(tb => total += tb.querySelectorAll("tr").length);
    return total;
  });
  console.log(`\n[3] Already logged in! Game rows in table: ${gameCount}`);
}

await browser.close();
console.log("\nDone.");
