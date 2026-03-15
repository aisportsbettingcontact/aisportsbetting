import { readFileSync } from 'fs';
import { load } from 'cheerio';

const nhlHtml = readFileSync('/home/ubuntu/upload/pasted_content_29.txt', 'utf8');
const nh = load(nhlHtml);

const gameCards = nh('.game-card-container');
console.log('NHL game cards:', gameCards.length);

const NHL_CODES = new Set(['ANA','ARI','BOS','BUF','CGY','CAR','CHI','COL','CBJ','DAL','DET','EDM','FLA','LAK','MIN','MTL','NSH','NJD','NYI','NYR','OTT','PHI','PIT','STL','SJS','SEA','TBL','TOR','UTA','VAN','VGK','WSH','WPG']);

const nhlGames = [];

gameCards.each((i, card) => {
  const teamContainers = nh(card).find('.team-container');
  const awayClasses = nh(teamContainers.eq(0)).attr('class') || '';
  const homeClasses = nh(teamContainers.eq(1)).attr('class') || '';
  
  const awayCode = awayClasses.split(' ').find(c => NHL_CODES.has(c)) || '';
  const homeCode = homeClasses.split(' ').find(c => NHL_CODES.has(c)) || '';
  
  const links = nh(card).find('a').map((_, a) => nh(a).attr('href') || '').get();
  const gameLink = links.find(l => /\/game\/\d+/.test(l)) || '';
  const gameId = (gameLink.match(/\/game\/(\d+)/) || [])[1] || '';
  
  const awayName = nh(teamContainers.eq(0)).find('.team-name').text().trim();
  const homeName = nh(teamContainers.eq(1)).find('.team-name').text().trim();
  const awayScore = nh(teamContainers.eq(0)).find('.team-score').text().trim();
  const homeScore = nh(teamContainers.eq(1)).find('.team-score').text().trim();
  const state = nh(card).find('.game-state-container').text().trim().replace(/\s+/g, ' ').substring(0, 30);
  
  nhlGames.push({ awayCode, homeCode, awayName, homeName, awayScore, homeScore, state, gameId });
  
  console.log(i + ': ' + awayCode + '(' + awayName + ') @ ' + homeCode + '(' + homeName + ') ' + awayScore + '-' + homeScore + ' [' + state + '] gameId=' + gameId);
});

// Now cross-reference with VSiN splits
console.log('\n=== VSiN NHL Teams ===');
const vsinTeams = [
  'Anaheim Ducks / Ottawa Senators',
  'Boston Bruins / Washington Capitals',
  'Colorado Avalanche / Winnipeg Jets',
  'New York Rangers / Minnesota Wild',
  'Toronto Maple Leafs / Buffalo Sabres',
  'Calgary Flames / New York Islanders',
  'San Jose Sharks / Montreal Canadiens',
  'Carolina Hurricanes / Tampa Bay Lightning',
  'Los Angeles Kings / New Jersey Devils',
  'Columbus Blue Jackets / Philadelphia Flyers',
  'Detroit Red Wings / Dallas Stars',
  'Pittsburgh Penguins / Utah Mammoth',
  'Chicago Blackhawks / Vegas Golden Knights',
  'Seattle Kraken / Vancouver Canucks',
];

// Map NHL full names to codes
const NHL_NAME_TO_CODE = {
  'Ducks': 'ANA', 'Senators': 'OTT', 'Bruins': 'BOS', 'Capitals': 'WSH',
  'Avalanche': 'COL', 'Jets': 'WPG', 'Rangers': 'NYR', 'Wild': 'MIN',
  'Maple Leafs': 'TOR', 'Sabres': 'BUF', 'Flames': 'CGY', 'Islanders': 'NYI',
  'Sharks': 'SJS', 'Canadiens': 'MTL', 'Hurricanes': 'CAR', 'Lightning': 'TBL',
  'Kings': 'LAK', 'Devils': 'NJD', 'Blue Jackets': 'CBJ', 'Flyers': 'PHI',
  'Red Wings': 'DET', 'Stars': 'DAL', 'Penguins': 'PIT', 'Mammoth': 'UTA',
  'Blackhawks': 'CHI', 'Golden Knights': 'VGK', 'Kraken': 'SEA', 'Canucks': 'VAN',
};

console.log('\nNHL Code → Name mapping:');
Object.entries(NHL_NAME_TO_CODE).forEach(([name, code]) => {
  console.log('  ' + code + ' = ' + name);
});

// Check if all VSiN teams are in the NHL.com games
console.log('\n=== VSiN vs NHL.com Cross-Reference ===');
const nhlGameCodes = nhlGames.map(g => g.awayCode + '@' + g.homeCode);
console.log('NHL.com game codes:', nhlGameCodes.join(', '));
