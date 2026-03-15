import { readFileSync } from 'fs';
import { load } from 'cheerio';
// ─── Parse NBA.com games ─────────────────────────────────────────────────────
function parseNbaGames() {
  const html = readFileSync('/home/ubuntu/upload/pasted_content_28.txt', 'utf8');
  const $ = load(html);
  const seen = new Set();
  const result = [];
  $('a[href*="/game/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/\/game\/([a-z]+-vs-[a-z]+-\d+)/);
    if (m && !seen.has(m[1])) {
      seen.add(m[1]);
      const parts = m[1].split('-vs-');
      const awayCode = parts[0].toUpperCase();
      const homeCode = parts[1].split('-')[0].toUpperCase();
      result.push({ gameId: m[1], awayCode, homeCode });
    }
  });
  return result;
}

// ─── Parse NHL.com games ─────────────────────────────────────────────────────
function parseNhlGames() {
  const html = readFileSync('/home/ubuntu/upload/pasted_content_29.txt', 'utf8');
  const $ = load(html);
  const seen = new Set();
  const result = [];
  // NHL.com uses game links like /game/2025020XXXX
  $('a[href*="/game/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/\/game\/(\d+)/);
    if (m && !seen.has(m[1])) {
      seen.add(m[1]);
      // Extract team names from the link text or nearby elements
      const text = $(el).text().trim();
      result.push({ gameId: m[1], text, href });
    }
  });
  return result;
}

// ─── Parse NCAA.com games ─────────────────────────────────────────────────────
function parseNcaaGames() {
  const html = readFileSync('/home/ubuntu/upload/pasted_content_30.txt', 'utf8');
  const $ = load(html);
  const result = [];
  // NCAA.com uses JSON embedded in the page
  const scriptContent = $('script').map((_, el) => $(el).html() || '').get().join('\n');
  const jsonMatch = scriptContent.match(/"games"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
  if (jsonMatch) {
    try {
      const gamesData = JSON.parse(jsonMatch[1]);
      gamesData.forEach((g) => {
        result.push({
          gameId: g.game?.gameID || g.gameID,
          awayTeam: g.game?.away?.names?.short || g.away?.names?.short,
          homeTeam: g.game?.home?.names?.short || g.home?.names?.short,
          awaySlug: g.game?.away?.slug || g.away?.slug,
          homeSlug: g.game?.home?.slug || g.home?.slug,
          startTime: g.game?.startTimeEpoch || g.startTimeEpoch,
        });
      });
    } catch (e) {
      console.log('JSON parse error:', e.message);
    }
  }
  return result;
}

// ─── Parse VSiN splits ────────────────────────────────────────────────────────
function parseVsinSplits() {
  const html = readFileSync('/home/ubuntu/upload/pasted_content_27.txt', 'utf8');
  const $ = load(html);
  const table = $('table.freezetable');
  const rows = table.find('tr');
  
  const result = { nba: [], ncaab: [], nhl: [] };
  let currentSport = null;
  
  rows.each((_, row) => {
    const cells = $(row).find('td, th');
    const cellTexts = cells.map((_, c) => $(c).text().trim().replace(/\s+/g, ' ')).get();
    const rowClass = $(row).attr('class') || '';
    
    if (cellTexts.length === 0) return;
    
    const firstCell = cellTexts[0] || '';
    
    // Detect sport header rows
    if (firstCell.includes('NBA - ')) { currentSport = 'nba'; return; }
    if (firstCell.includes('CBB - ') || firstCell.includes('NCAAB - ')) { currentSport = 'ncaab'; return; }
    if (firstCell.includes('NHL - ')) { currentSport = 'nhl'; return; }
    
    // Skip header rows
    if (firstCell === 'Spread' || firstCell === 'Goal' || firstCell === 'Handle') return;
    
    // Game rows have team names in first cell
    if (currentSport && cellTexts.length >= 8 && firstCell.length > 5) {
      // Extract team names - they appear before "History"
      const historyIdx = firstCell.indexOf(' History');
      const teamPart = historyIdx > 0 ? firstCell.substring(0, historyIdx) : firstCell;
      
      // Parse spread, total, ML from cells
      const spreadLine = cellTexts[1] || '';
      const spreadHandle = cellTexts[2] || '';
      const spreadBets = cellTexts[3] || '';
      const totalLine = cellTexts[4] || '';
      const totalHandle = cellTexts[5] || '';
      const totalBets = cellTexts[6] || '';
      const mlLine = cellTexts[7] || '';
      
      // Parse away/home spread
      const spreadMatch = spreadLine.match(/^([+-]?\d+\.?\d*)\s*([+-]?\d+\.?\d*)$/);
      const awaySpread = spreadMatch ? spreadMatch[1] : null;
      const homeSpread = spreadMatch ? spreadMatch[2] : null;
      
      // Parse away/home handle/bets for spread
      const spreadHandleMatch = spreadHandle.match(/^(\d+)%\s*(\d+)%/);
      const awaySpreadHandle = spreadHandleMatch ? parseInt(spreadHandleMatch[1]) : null;
      const homeSpreadHandle = spreadHandleMatch ? parseInt(spreadHandleMatch[2]) : null;
      
      const spreadBetsMatch = spreadBets.match(/^(\d+)%\s*(\d+)%/);
      const awaySpreadBets = spreadBetsMatch ? parseInt(spreadBetsMatch[1]) : null;
      const homeSpreadBets = spreadBetsMatch ? parseInt(spreadBetsMatch[2]) : null;
      
      // Parse total
      const totalMatch = totalLine.match(/^(\d+\.?\d*)\s*(\d+\.?\d*)$/);
      const total = totalMatch ? parseFloat(totalMatch[1]) : null;
      
      // Parse total handle/bets
      const totalHandleMatch = totalHandle.match(/^(\d+)%\s*(\d+)%/);
      const overHandle = totalHandleMatch ? parseInt(totalHandleMatch[1]) : null;
      const underHandle = totalHandleMatch ? parseInt(totalHandleMatch[2]) : null;
      
      const totalBetsMatch = totalBets.match(/^(\d+)%\s*(\d+)%/);
      const overBets = totalBetsMatch ? parseInt(totalBetsMatch[1]) : null;
      const underBets = totalBetsMatch ? parseInt(totalBetsMatch[2]) : null;
      
      // Parse ML
      const mlMatch = mlLine.match(/^([+-]?\d+)\s*([+-]?\d+)$/);
      const awayML = mlMatch ? mlMatch[1] : null;
      const homeML = mlMatch ? mlMatch[2] : null;
      
      result[currentSport].push({
        teamPart,
        awaySpread, homeSpread,
        awaySpreadHandle, homeSpreadHandle,
        awaySpreadBets, homeSpreadBets,
        total, overHandle, underHandle, overBets, underBets,
        awayML, homeML,
        rawCells: cellTexts.slice(0, 8),
      });
    }
  });
  
  return result;
}

// ─── Main audit ───────────────────────────────────────────────────────────────
console.log('=== NBA.com Games ===');
const nbaGames = parseNbaGames();
nbaGames.forEach((g, i) => console.log(i + ': ' + g.awayCode + ' @ ' + g.homeCode));
console.log('Total NBA games:', nbaGames.length);

console.log('\n=== NHL.com Games ===');
const nhlGames = parseNhlGames();
nhlGames.slice(0, 20).forEach((g, i) => console.log(i + ': gameId=' + g.gameId + ' text=' + g.text.substring(0, 60)));
console.log('Total NHL game links:', nhlGames.length);

console.log('\n=== NCAA.com Games ===');
const ncaaGames = parseNcaaGames();
if (ncaaGames.length > 0) {
  ncaaGames.forEach((g, i) => console.log(i + ': ' + g.awaySlug + ' @ ' + g.homeSlug));
} else {
  console.log('No games parsed from JSON - checking raw HTML structure...');
}

console.log('\n=== VSiN Splits ===');
const splits = parseVsinSplits();
console.log('NBA splits:', splits.nba.length);
splits.nba.forEach((g, i) => console.log('  ' + i + ': ' + g.teamPart + ' | spread=' + g.awaySpread + '/' + g.homeSpread));
console.log('NCAAB splits:', splits.ncaab.length);
splits.ncaab.forEach((g, i) => console.log('  ' + i + ': ' + g.teamPart));
console.log('NHL splits:', splits.nhl.length);
splits.nhl.forEach((g, i) => console.log('  ' + i + ': ' + g.teamPart));
