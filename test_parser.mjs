import * as cheerio from 'cheerio';
import { readFileSync } from 'fs';

const html = readFileSync('/home/ubuntu/upload/pasted_content_23.txt', 'utf8');
const $ = cheerio.load(html);

// Find DK column index
let dkIdx = 9;
$('tr').first().find('th').each((i, el) => {
  const img = $(el).find('img').first();
  const alt = img.attr('alt') || '';
  if (alt.includes('DK')) { dkIdx = i; return false; }
});
console.log('DK column index:', dkIdx);

function parseOpenCell(cell) {
  const openCells = $(cell).find('.best-odds__open-cell').toArray();
  if (openCells.length < 2) return { away: null, home: null };
  
  const parseOne = (el) => {
    const $el = $(el);
    const allDivs = $el.children('div').toArray();
    const secondary = $el.find('.best-odds__open-cell-secondary');
    const lineDiv = allDivs.find(d => !$(d).hasClass('best-odds__open-cell-secondary'));
    const line = lineDiv ? $(lineDiv).text().trim() : '';
    const juiceDiv = secondary.find('div').first();
    const juice = juiceDiv.text().trim();
    return line ? { line, juice: juice || '-110' } : null;
  };
  
  return { away: parseOne(openCells[0]), home: parseOne(openCells[1]) };
}

function parseBookCell(cell) {
  const oddsDivs = $(cell).find('[data-testid="book-cell__odds"]').toArray();
  if (oddsDivs.length < 2) return { away: null, home: null };
  
  const parseOne = (el) => {
    const $el = $(el);
    const allText = $el.text().trim();
    if (allText === 'N/A') return null;
    const spans = $el.find('span').toArray().filter(s => $(s).find('svg').length === 0);
    const texts = spans.map(s => $(s).text().trim()).filter(t => t && t !== 'N/A');
    if (!texts.length) return null;
    return { line: texts[0], juice: texts[1] || '-110' };
  };
  
  return { away: parseOne(oddsDivs[0]), home: parseOne(oddsDivs[1]) };
}

let gameCount = 0;
$('tr').each((_, row) => {
  const cells = $(row).find('td').toArray();
  if (cells.length < 10) return;
  
  const link = $(cells[0]).find('a').first();
  const href = link.attr('href') || '';
  const idMatch = href.match(/\/(\d+)$/);
  if (!idMatch) return;
  
  const anGameId = idMatch[1];
  gameCount++;
  
  const openOdds = parseOpenCell(cells[1]);
  const dkOdds = parseBookCell(cells[dkIdx]);
  
  const teamsDivs = $(cells[0]).find('.game-info__teams').toArray();
  const awayName = teamsDivs[0] ? $(teamsDivs[0]).find('.game-info__team--desktop').first().text().trim() : '?';
  const homeName = teamsDivs[1] ? $(teamsDivs[1]).find('.game-info__team--desktop').first().text().trim() : '?';
  
  console.log(`Game ${gameCount}: ${awayName} @ ${homeName} [AN:${anGameId}]`);
  console.log(`  Open: ${openOdds.away?.line}(${openOdds.away?.juice}) / ${openOdds.home?.line}(${openOdds.home?.juice})`);
  console.log(`  DK:   ${dkOdds.away?.line}(${dkOdds.away?.juice}) / ${dkOdds.home?.line}(${dkOdds.home?.juice})`);
});

console.log(`\nTotal games parsed: ${gameCount}`);
