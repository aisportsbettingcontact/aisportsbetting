import { readFileSync } from 'fs';
import { load } from 'cheerio';

// ─── Parse NCAA.com games ─────────────────────────────────────────────────────
function parseNcaaGames() {
  const html = readFileSync('/home/ubuntu/upload/pasted_content_30.txt', 'utf8');
  const $ = load(html);
  
  // Look for game links
  const gameLinks = [];
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href.includes('/game/') || href.includes('/scoreboard/')) {
      gameLinks.push({ href, text: $(el).text().trim().substring(0, 60) });
    }
  });
  console.log('NCAA game links:', gameLinks.length);
  gameLinks.slice(0, 10).forEach((g, i) => console.log('  ' + i + ': ' + g.href + ' - ' + g.text));
  
  // Look for team slugs
  const teamLinks = [];
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href.includes('/team/')) {
      teamLinks.push({ href, text: $(el).text().trim() });
    }
  });
  console.log('NCAA team links:', teamLinks.length);
  teamLinks.slice(0, 20).forEach((g, i) => console.log('  ' + i + ': ' + g.href + ' - ' + g.text));
  
  // Look for JSON data
  const scripts = $('script');
  scripts.each((i, el) => {
    const content = $(el).html() || '';
    const src = $(el).attr('src') || '';
    if (!src && (content.includes('"games"') || content.includes('"contests"') || content.includes('"scoreboard"'))) {
      console.log('\nFound JSON data in script ' + i + ' (length=' + content.length + ')');
      console.log(content.substring(0, 500));
    }
  });
  
  // Look for __NEXT_DATA__
  const nextDataEl = $('script[id="__NEXT_DATA__"]');
  if (nextDataEl.length) {
    const content = nextDataEl.html() || '';
    console.log('\n__NEXT_DATA__ found, length:', content.length);
    // Find games array
    const gamesIdx = content.indexOf('"games"');
    if (gamesIdx >= 0) {
      console.log('Games section found at index', gamesIdx);
      console.log(content.substring(gamesIdx, gamesIdx + 500));
    }
  }
  
  // Look for drupal settings or window.__STATE__
  $('script').each((i, el) => {
    const content = $(el).html() || '';
    if (content.includes('drupalSettings') || content.includes('window.__STATE__') || content.includes('initialState')) {
      console.log('\nFound state data in script ' + i);
      const stateIdx = Math.max(content.indexOf('drupalSettings'), content.indexOf('window.__STATE__'), content.indexOf('initialState'));
      console.log(content.substring(stateIdx, stateIdx + 500));
    }
  });
  
  // Look for any data attributes on game elements
  const gameEls = $('[data-game-id], [data-contest-id], [data-game], [class*="game-tile"], [class*="GameTile"]');
  console.log('\nGame elements with data attrs:', gameEls.length);
  
  // Look for the scoreboard widget
  const scoreboardWidget = $('[class*="scoreboard"], [id*="scoreboard"], [data-component*="scoreboard"]');
  console.log('Scoreboard widgets:', scoreboardWidget.length);
  
  // Print all unique class names that contain 'game' or 'score'
  const allClasses = new Set();
  $('*').each((_, el) => {
    const cls = $(el).attr('class') || '';
    cls.split(' ').forEach(c => {
      if (c && (c.toLowerCase().includes('game') || c.toLowerCase().includes('score') || c.toLowerCase().includes('contest'))) {
        allClasses.add(c);
      }
    });
  });
  console.log('\nRelevant classes:', [...allClasses].slice(0, 30).join(', '));
}

// ─── Parse NHL.com games ─────────────────────────────────────────────────────
function parseNhlGames() {
  const html = readFileSync('/home/ubuntu/upload/pasted_content_29.txt', 'utf8');
  const $ = load(html);
  
  // Look for game links
  const gameLinks = [];
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href.match(/\/game\/\d+/)) {
      gameLinks.push({ href, text: $(el).text().trim().substring(0, 60) });
    }
  });
  console.log('NHL game links:', gameLinks.length);
  gameLinks.slice(0, 20).forEach((g, i) => console.log('  ' + i + ': ' + g.href + ' - ' + g.text));
  
  // Look for JSON data in scripts
  $('script').each((i, el) => {
    const content = $(el).html() || '';
    const src = $(el).attr('src') || '';
    if (!src && content.length > 100 && (content.includes('"gameId"') || content.includes('"awayTeam"') || content.includes('"homeTeam"'))) {
      console.log('\nNHL JSON data in script ' + i + ' (length=' + content.length + ')');
      console.log(content.substring(0, 500));
    }
  });
  
  // Look for __SITE_SETTINGS__ or __PAGE_SETTINGS__
  $('script').each((i, el) => {
    const content = $(el).html() || '';
    if (content.includes('__SITE_SETTINGS__') || content.includes('webAPIBaseURL')) {
      console.log('\nNHL site settings found in script ' + i);
      console.log(content.substring(0, 300));
    }
  });
  
  // Look for game data in any format
  const allText = $('body').text();
  const teamNames = ['Ducks', 'Bruins', 'Flames', 'Blackhawks', 'Avalanche', 'Blue Jackets', 'Stars', 'Red Wings', 'Oilers', 'Panthers', 'Kings', 'Wild', 'Canadiens', 'Predators', 'Devils', 'Islanders', 'Rangers', 'Senators', 'Flyers', 'Penguins', 'Blues', 'Lightning', 'Maple Leafs', 'Canucks', 'Golden Knights', 'Capitals', 'Jets', 'Hurricanes', 'Kraken', 'Sharks', 'Mammoth', 'Sabres'];
  const foundTeams = teamNames.filter(t => allText.includes(t));
  console.log('\nNHL teams found in page text:', foundTeams.join(', '));
  
  // Check for game score elements
  const scoreEls = $('[class*="score"], [class*="Score"], [class*="game-card"], [class*="GameCard"]');
  console.log('Score elements:', scoreEls.length);
  scoreEls.slice(0, 5).each((i, el) => {
    console.log('  ' + i + ': ' + $(el).text().trim().substring(0, 80));
  });
}

console.log('=== NCAA.com Structure ===');
parseNcaaGames();

console.log('\n\n=== NHL.com Structure ===');
parseNhlGames();
