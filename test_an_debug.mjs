import puppeteer from 'puppeteer';

async function testAnPage() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log('Navigating...');
    await page.goto('https://www.actionnetwork.com/ncaab/best-odds?type=spread', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    // Wait a bit for JS to execute
    await new Promise(r => setTimeout(r, 8000));
    
    // Get page title and check what's rendered
    const title = await page.title();
    console.log('Title:', title);
    
    // Check what selectors are present
    const selectors = [
      '.best-odds__game-info',
      'table',
      '[class*="best-odds"]',
      '[class*="game-info"]',
      '[data-testid]'
    ];
    
    for (const sel of selectors) {
      const count = await page.$$eval(sel, els => els.length).catch(() => 0);
      console.log(`${sel}: ${count} elements`);
    }
    
    // Get first 500 chars of body
    const bodyText = await page.$eval('body', el => el.innerHTML.substring(0, 500));
    console.log('Body start:', bodyText);
    
  } finally {
    await browser.close();
  }
}

testAnPage().catch(console.error);
