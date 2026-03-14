import * as cheerio from 'cheerio';
import { readFileSync } from 'fs';

const html = readFileSync('/home/ubuntu/upload/pasted_content_26.txt', 'utf8');
const $ = cheerio.load('<table>' + html + '</table>');

const rows = $('tr').toArray();
console.log('Total rows:', rows.length);

// Classify each row
function classifyRow(row) {
  const cells = $(row).find('> td').toArray();
  if (cells.length < 12) return { type: 'SEPARATOR', cells };
  
  const hasLink = $(row).find('a[href*="ncaab-game"]').length > 0;
  const openCells = $(row).find('.best-odds__open-cell').toArray();
  const openTexts = openCells.map(c => $(c).children('div').first().text().trim());
  
  if (hasLink) return { type: 'SPREAD', cells, openTexts };
  if (openTexts.some(t => /^[ou]/i.test(t))) return { type: 'TOTAL', cells, openTexts };
  if (openTexts.some(t => /^[+-]\d{3}/.test(t))) return { type: 'ML', cells, openTexts };
  return { type: 'UNKNOWN', cells, openTexts };
}

// Parse a single odds cell - extract away and home odds
function parseOddsCell(cell) {
  const wrappers = $(cell).find('.best-odds__odds-container > div').toArray();
  if (wrappers.length < 2) return { away: null, home: null };
  
  const parseWrapper = (wrapper) => {
    const oddsDiv = $(wrapper).find('[data-testid="book-cell__odds"]');
    const isNA = oddsDiv.find('.css-1db6njd').length > 0;
    if (isNA) return null;
    
    const spans = oddsDiv.find('span').toArray()
      .filter(s => $(s).find('svg').length === 0 && $(s).find('picture').length === 0);
    const texts = spans.map(s => $(s).text().trim()).filter(t => t && t !== 'N/A');
    if (!texts.length) return null;
    
    const bookLogo = $(wrapper).find('img[alt*="Logo"]').attr('alt') || null;
    return { line: texts[0], juice: texts[1] || '-110', bookLogo };
  };
  
  return { away: parseWrapper(wrappers[0]), home: parseWrapper(wrappers[1]) };
}

// Parse open cell (column 1)
function parseOpenCell(cell) {
  const openCells = $(cell).find('.best-odds__open-cell').toArray();
  if (openCells.length < 2) return { away: null, home: null };
  
  const parseOne = (el) => {
    const allDivs = $(el).children('div').toArray();
    const secondary = $(el).find('.best-odds__open-cell-secondary');
    const lineDiv = allDivs.find(d => !$(d).hasClass('best-odds__open-cell-secondary'));
    const line = lineDiv ? $(lineDiv).text().trim() : '';
    const juice = secondary.find('div').first().text().trim();
    return line ? { line, juice: juice || '-110' } : null;
  };
  
  return { away: parseOne(openCells[0]), home: parseOne(openCells[1]) };
}

// Find DK column index dynamically by scanning all rows for DK logo
function findDkColumnIndex(rows) {
  const dkCounts = {};
  rows.forEach(row => {
    const cells = $(row).find('> td').toArray();
    cells.forEach((cell, ci) => {
      const hasDK = $(cell).find('img[alt*="DK"]').length > 0;
      if (hasDK) dkCounts[ci] = (dkCounts[ci] || 0) + 1;
    });
  });
  console.log('DK logo appearances per column:', dkCounts);
  // Return the column with most DK appearances
  return Object.entries(dkCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
}

const dkColIdx = parseInt(findDkColumnIndex(rows));
console.log('DK column index:', dkColIdx);
console.log('');

// Now group rows into game groups (SPREAD + TOTAL + ML)
const games = [];
let currentGame = null;

rows.forEach((row, i) => {
  const { type, cells, openTexts } = classifyRow(row);
  
  if (type === 'SPREAD') {
    // Start new game
    const link = $(row).find('a[href*="ncaab-game"]').attr('href') || '';
    const idMatch = link.match(/\/(\d+)$/);
    const anGameId = idMatch ? idMatch[1] : null;
    
    // Extract team names
    const teamDivs = $(row).find('.game-info__teams').toArray();
    const awayName = teamDivs[0] ? $(teamDivs[0]).find('.game-info__team--desktop').first().text().trim() : '?';
    const homeName = teamDivs[1] ? $(teamDivs[1]).find('.game-info__team--desktop').first().text().trim() : '?';
    
    // Extract rotation numbers
    const rotDivs = $(row).find('.game-info__rot-number div').toArray();
    const awayRot = rotDivs[0] ? $(rotDivs[0]).text().trim() : null;
    const homeRot = rotDivs[1] ? $(rotDivs[1]).text().trim() : null;
    
    const openSpread = parseOpenCell(cells[1]);
    const dkSpread = parseOddsCell(cells[dkColIdx]);
    
    currentGame = {
      anGameId,
      awayName,
      homeName,
      awayRot,
      homeRot,
      spread: {
        open: openSpread,
        dk: dkSpread,
      },
      total: null,
      ml: null,
    };
    games.push(currentGame);
  } else if (type === 'TOTAL' && currentGame) {
    const openTotal = parseOpenCell(cells[1]);
    const dkTotal = parseOddsCell(cells[dkColIdx]);
    currentGame.total = { open: openTotal, dk: dkTotal };
  } else if (type === 'ML' && currentGame) {
    const openML = parseOpenCell(cells[1]);
    const dkML = parseOddsCell(cells[dkColIdx]);
    currentGame.ml = { open: openML, dk: dkML };
  }
});

console.log(`\n=== Parsed ${games.length} games ===\n`);
games.forEach((g, i) => {
  console.log(`Game ${i+1}: ${g.awayName} (${g.awayRot}) @ ${g.homeName} (${g.homeRot}) [AN:${g.anGameId}]`);
  
  const s = g.spread;
  console.log(`  SPREAD  Open: ${s.open.away?.line}(${s.open.away?.juice}) / ${s.open.home?.line}(${s.open.home?.juice})`);
  console.log(`          DK:   ${s.dk.away?.line}(${s.dk.away?.juice}) / ${s.dk.home?.line}(${s.dk.home?.juice})`);
  
  if (g.total) {
    const t = g.total;
    console.log(`  TOTAL   Open: ${t.open.away?.line}(${t.open.away?.juice}) / ${t.open.home?.line}(${t.open.home?.juice})`);
    console.log(`          DK:   ${t.dk.away?.line}(${t.dk.away?.juice}) / ${t.dk.home?.line}(${t.dk.home?.juice})`);
  }
  
  if (g.ml) {
    const m = g.ml;
    console.log(`  ML      Open: ${m.open.away?.line}(${m.open.away?.juice}) / ${m.open.home?.line}(${m.open.home?.juice})`);
    console.log(`          DK:   ${m.dk.away?.line}(${m.dk.away?.juice}) / ${m.dk.home?.line}(${m.dk.home?.juice})`);
  }
  console.log('');
});
