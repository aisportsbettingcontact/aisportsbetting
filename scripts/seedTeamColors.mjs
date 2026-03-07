/**
 * seedTeamColors.mjs
 *
 * Seeds the ncaam_teams and nba_teams tables with all team data including
 * primary, secondary, and tertiary hex colors.
 *
 * Run: node scripts/seedTeamColors.mjs
 */

import { createConnection } from 'mysql2/promise';
import { readFileSync } from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

// ── Parse NCAAM CSV ──────────────────────────────────────────────────────────
const ncaamCsv = readFileSync('/home/ubuntu/upload/pasted_content_9.txt', 'utf-8');
const ncaamLines = ncaamCsv.trim().split('\n').slice(1);

const ncaamTeams = [];
for (const line of ncaamLines) {
  const cols = line.split('\t');
  if (cols.length < 9) continue;
  const conference   = cols[0]?.trim();
  const ncaaName     = cols[1]?.trim();
  const ncaaNickname = cols[2]?.trim();
  const primaryColor = cols[3]?.trim();
  const secondaryColor = cols[4]?.trim();
  const tertiaryColor  = cols[5]?.trim();
  const ncaaSlug     = cols[6]?.trim();
  const vsinSlug     = cols[7]?.trim();
  const logoUrl      = cols[8]?.trim();
  const vsinName     = cols[9]?.trim() || ncaaName;

  if (!ncaaSlug || !ncaaName) continue;

  const dbSlug = vsinSlug ? vsinSlug.replace(/-/g, '_') : ncaaSlug.replace(/-/g, '_');

  ncaamTeams.push({
    dbSlug,
    ncaaSlug,
    vsinSlug: vsinSlug || ncaaSlug,
    ncaaName,
    ncaaNickname,
    vsinName,
    conference,
    logoUrl: logoUrl || `https://www.ncaa.com/sites/default/files/images/logos/schools/bgl/${ncaaSlug}.svg`,
    primaryColor:   primaryColor || null,
    secondaryColor: secondaryColor || null,
    tertiaryColor:  tertiaryColor || null,
  });
}

console.log(`Parsed ${ncaamTeams.length} NCAAM teams`);

// ── Parse NBA CSV ────────────────────────────────────────────────────────────
const nbaCsv = readFileSync('/home/ubuntu/upload/pasted_content_10.txt', 'utf-8');
const nbaLines = nbaCsv.trim().split('\n').slice(1);

const nbaTeams = [];
for (const line of nbaLines) {
  const cols = line.split('\t');
  if (cols.length < 10) continue;
  const conference   = cols[0]?.trim();
  const division     = cols[1]?.trim();
  const city         = cols[2]?.trim();
  const nickname     = cols[3]?.trim();
  const primaryColor = cols[4]?.trim();
  const secondaryColor = cols[5]?.trim();
  const tertiaryColor  = cols[6]?.trim();
  const nbaSlug      = cols[7]?.trim();
  const logoUrl      = cols[8]?.trim();
  const vsinSlug     = cols[9]?.trim();
  const vsinName     = cols[10]?.trim();

  if (!nbaSlug || !nickname) continue;

  const name   = `${city} ${nickname}`;
  const dbSlug = vsinSlug ? vsinSlug.replace(/-/g, '_') : nbaSlug;

  nbaTeams.push({
    dbSlug,
    nbaSlug,
    vsinSlug: vsinSlug || nbaSlug,
    name,
    nickname,
    city,
    conference,
    division,
    logoUrl: logoUrl || `https://cdn.nba.com/logos/nba/${nbaSlug}/primary/L/logo.svg`,
    primaryColor:   primaryColor || null,
    secondaryColor: secondaryColor || null,
    tertiaryColor:  tertiaryColor || null,
  });
}

console.log(`Parsed ${nbaTeams.length} NBA teams`);

// ── Connect and seed ─────────────────────────────────────────────────────────
const conn = await createConnection(DATABASE_URL);

// Seed NCAAM teams
console.log('Seeding ncaam_teams...');
let ncaamInserted = 0, ncaamUpdated = 0;
for (const team of ncaamTeams) {
  const [existing] = await conn.execute(
    'SELECT id FROM ncaam_teams WHERE dbSlug = ?',
    [team.dbSlug]
  );
  if (existing.length > 0) {
    await conn.execute(
      `UPDATE ncaam_teams SET ncaaSlug=?, vsinSlug=?, ncaaName=?, ncaaNickname=?, vsinName=?,
       conference=?, logoUrl=?, primaryColor=?, secondaryColor=?, tertiaryColor=?
       WHERE dbSlug=?`,
      [team.ncaaSlug, team.vsinSlug, team.ncaaName, team.ncaaNickname, team.vsinName,
       team.conference, team.logoUrl, team.primaryColor, team.secondaryColor, team.tertiaryColor,
       team.dbSlug]
    );
    ncaamUpdated++;
  } else {
    await conn.execute(
      `INSERT INTO ncaam_teams (dbSlug, ncaaSlug, vsinSlug, ncaaName, ncaaNickname, vsinName,
       conference, logoUrl, primaryColor, secondaryColor, tertiaryColor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [team.dbSlug, team.ncaaSlug, team.vsinSlug, team.ncaaName, team.ncaaNickname, team.vsinName,
       team.conference, team.logoUrl, team.primaryColor, team.secondaryColor, team.tertiaryColor]
    );
    ncaamInserted++;
  }
}
console.log(`NCAAM: inserted=${ncaamInserted}, updated=${ncaamUpdated}`);

// Seed NBA teams
console.log('Seeding nba_teams...');
let nbaInserted = 0, nbaUpdated = 0;
for (const team of nbaTeams) {
  const [existing] = await conn.execute(
    'SELECT id FROM nba_teams WHERE dbSlug = ?',
    [team.dbSlug]
  );
  if (existing.length > 0) {
    await conn.execute(
      `UPDATE nba_teams SET nbaSlug=?, vsinSlug=?, name=?, nickname=?, city=?,
       conference=?, division=?, logoUrl=?, primaryColor=?, secondaryColor=?, tertiaryColor=?
       WHERE dbSlug=?`,
      [team.nbaSlug, team.vsinSlug, team.name, team.nickname, team.city,
       team.conference, team.division, team.logoUrl, team.primaryColor, team.secondaryColor, team.tertiaryColor,
       team.dbSlug]
    );
    nbaUpdated++;
  } else {
    await conn.execute(
      `INSERT INTO nba_teams (dbSlug, nbaSlug, vsinSlug, name, nickname, city,
       conference, division, logoUrl, primaryColor, secondaryColor, tertiaryColor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [team.dbSlug, team.nbaSlug, team.vsinSlug, team.name, team.nickname, team.city,
       team.conference, team.division, team.logoUrl, team.primaryColor, team.secondaryColor, team.tertiaryColor]
    );
    nbaInserted++;
  }
}
console.log(`NBA: inserted=${nbaInserted}, updated=${nbaUpdated}`);

await conn.end();
console.log('Done!');
