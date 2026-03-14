import puppeteer from 'puppeteer';

async function testAnPage() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log('Navigating to AN NCAAB best-odds page...');
    await page.goto('https://www.actionnetwork.com/ncaab/best-odds?type=spread', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Wait for the table to render
    await page.waitForSelector('.best-odds__game-info', { timeout: 15000 });
    
    // Count game rows
    const gameCount = await page.$$eval('.best-odds__game-info', els => els.length);
    console.log(`Game rows found: ${gameCount}`);
    
    // Check if DK column header exists
    const dkHeader = await page.$('th a[title*="DK NJ"]');
    console.log(`DK header found: ${dkHeader !== null}`);
    
    // Get column headers
    const headers = await page.$$eval('th', ths => ths.map(th => {
      const img = th.querySelector('img');
      return img ? img.alt : th.textContent?.trim() || '';
    }));
    console.log('Headers:', headers.slice(0, 15));
    
  } finally {
    await browser.close();
  }
}

testAnPage().catch(console.error);
