/**
 * backfillTeamRpgIpg.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Backfills rpg (runs per game) and ipPerGame (innings pitched per game)
 * into mlb_team_batting_splits for all 30 teams.
 *
 * Data source: MLB Stats API
 *   - Batting: https://statsapi.mlb.com/api/v1/teams/{teamId}/stats?stats=season&group=hitting&season=2026
 *   - Pitching: https://statsapi.mlb.com/api/v1/teams/{teamId}/stats?stats=season&group=pitching&season=2026
 *
 * Logic:
 *   rpg       = runs / gamesPlayed  (from hitting stats)
 *   ipPerGame = inningsPitched / gamesPlayed  (from pitching stats)
 *
 * Both values are hand-agnostic (same for L and R rows per team).
 *
 * [INPUT]  mlb_team_batting_splits — reads teamAbbrev, mlbTeamId
 * [OUTPUT] mlb_team_batting_splits — writes rpg, ipPerGame for all rows
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createConnection } from 'mysql2/promise';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env
const envPath = resolve(__dirname, '../.env');
let DATABASE_URL;
try {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^DATABASE_URL=["']?(.+?)["']?\s*$/);
    if (m) { DATABASE_URL = m[1]; break; }
  }
} catch {}
if (!DATABASE_URL) DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('[FATAL] DATABASE_URL not found'); process.exit(1); }

const SEASON = 2026;
const LEAGUE_AVG_RPG = 4.50;
const LEAGUE_AVG_IPG = 5.30;

// ── MLB Stats API helpers ─────────────────────────────────────────────────────
async function fetchTeamHittingStats(mlbTeamId) {
  const url = `https://statsapi.mlb.com/api/v1/teams/${mlbTeamId}/stats?stats=season&group=hitting&season=${SEASON}&sportId=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for teamId=${mlbTeamId} hitting`);
  const json = await res.json();
  const splits = json?.stats?.[0]?.splits;
  if (!splits?.length) return null;
  const stat = splits[0]?.stat;
  return stat ?? null;
}

async function fetchTeamPitchingStats(mlbTeamId) {
  const url = `https://statsapi.mlb.com/api/v1/teams/${mlbTeamId}/stats?stats=season&group=pitching&season=${SEASON}&sportId=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for teamId=${mlbTeamId} pitching`);
  const json = await res.json();
  const splits = json?.stats?.[0]?.splits;
  if (!splits?.length) return null;
  const stat = splits[0]?.stat;
  return stat ?? null;
}

// Parse IP string "123.2" → decimal innings (123 + 2/3 = 123.667)
function parseInningsPitched(ipStr) {
  if (!ipStr) return null;
  const str = String(ipStr);
  const parts = str.split('.');
  const full = parseInt(parts[0], 10);
  const frac = parts[1] ? parseInt(parts[1], 10) : 0;
  return full + frac / 3;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`[INPUT] Connecting to DB...`);
  const conn = await createConnection(DATABASE_URL);

  // Get all distinct team/mlbTeamId pairs from the batting splits table
  const [teamRows] = await conn.query(
    'SELECT DISTINCT teamAbbrev, mlbTeamId FROM mlb_team_batting_splits ORDER BY teamAbbrev'
  );
  console.log(`[INPUT] Found ${teamRows.length} distinct teams in mlb_team_batting_splits`);

  let updated = 0;
  let fallback = 0;
  let errors = 0;

  for (const row of teamRows) {
    const { teamAbbrev, mlbTeamId } = row;
    const tag = `[${teamAbbrev}|${mlbTeamId}]`;
    console.log(`\n[STEP] Processing ${tag}...`);

    let rpg = null;
    let ipPerGame = null;

    try {
      // ── Hitting: rpg = runs / gamesPlayed ──────────────────────────────────
      const hitting = await fetchTeamHittingStats(mlbTeamId);
      if (hitting) {
        const runs = parseFloat(hitting.runs ?? hitting.r ?? 0);
        const gp   = parseFloat(hitting.gamesPlayed ?? hitting.g ?? 0);
        if (runs > 0 && gp > 0) {
          rpg = runs / gp;
          console.log(`[STATE] ${tag} Hitting: runs=${runs} gamesPlayed=${gp} → rpg=${rpg.toFixed(4)}`);
        } else {
          console.warn(`[STATE] ${tag} Hitting: insufficient data (runs=${runs} gp=${gp}) — will use fallback`);
        }
      } else {
        console.warn(`[STATE] ${tag} No hitting stats returned from API`);
      }
    } catch (err) {
      console.error(`[STATE] ${tag} Hitting fetch error: ${err.message}`);
    }

    try {
      // ── Pitching: ipPerGame = inningsPitched / gamesPlayed ─────────────────
      const pitching = await fetchTeamPitchingStats(mlbTeamId);
      if (pitching) {
        const ip = parseInningsPitched(pitching.inningsPitched ?? pitching.ip);
        const gp = parseFloat(pitching.gamesPlayed ?? pitching.g ?? 0);
        if (ip > 0 && gp > 0) {
          ipPerGame = ip / gp;
          console.log(`[STATE] ${tag} Pitching: ip=${ip.toFixed(2)} gamesPlayed=${gp} → ipPerGame=${ipPerGame.toFixed(4)}`);
        } else {
          console.warn(`[STATE] ${tag} Pitching: insufficient data (ip=${ip} gp=${gp}) — will use fallback`);
        }
      } else {
        console.warn(`[STATE] ${tag} No pitching stats returned from API`);
      }
    } catch (err) {
      console.error(`[STATE] ${tag} Pitching fetch error: ${err.message}`);
    }

    // Apply fallbacks if API returned no data (early season, API gap)
    const finalRpg = rpg ?? LEAGUE_AVG_RPG;
    const finalIpg = ipPerGame ?? LEAGUE_AVG_IPG;
    if (!rpg) { console.warn(`[STATE] ${tag} RPG fallback → ${finalRpg} (league avg)`); fallback++; }
    if (!ipPerGame) { console.warn(`[STATE] ${tag} IPG fallback → ${finalIpg} (league avg)`); fallback++; }

    // Update both L and R rows for this team
    try {
      const [result] = await conn.query(
        'UPDATE mlb_team_batting_splits SET rpg = ?, ipPerGame = ? WHERE teamAbbrev = ?',
        [finalRpg, finalIpg, teamAbbrev]
      );
      const affectedRows = result.affectedRows ?? 0;
      console.log(`[OUTPUT] ${tag} Updated ${affectedRows} rows: rpg=${finalRpg.toFixed(4)} ipPerGame=${finalIpg.toFixed(4)}`);
      updated += affectedRows;
    } catch (err) {
      console.error(`[OUTPUT] ${tag} DB update failed: ${err.message}`);
      errors++;
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  // Final verification
  const [verifyRows] = await conn.query(
    'SELECT teamAbbrev, hand, rpg, ipPerGame FROM mlb_team_batting_splits ORDER BY teamAbbrev, hand'
  );
  const nullRpg = verifyRows.filter(r => r.rpg === null).length;
  const nullIpg = verifyRows.filter(r => r.ipPerGame === null).length;

  console.log(`\n[VERIFY] ─────────────────────────────────────────────────────`);
  console.log(`[VERIFY] Total rows updated: ${updated}`);
  console.log(`[VERIFY] Fallbacks applied:  ${fallback}`);
  console.log(`[VERIFY] Errors:             ${errors}`);
  console.log(`[VERIFY] Null rpg remaining: ${nullRpg}`);
  console.log(`[VERIFY] Null ipPerGame remaining: ${nullIpg}`);
  console.log(`[VERIFY] ${nullRpg === 0 && nullIpg === 0 ? '✅ PASS — all rows populated' : '❌ FAIL — some rows still null'}`);

  // Print summary table
  console.log(`\n[OUTPUT] Team RPG / IP-per-game summary:`);
  const seen = new Set();
  for (const r of verifyRows) {
    if (!seen.has(r.teamAbbrev)) {
      seen.add(r.teamAbbrev);
      console.log(`  ${r.teamAbbrev.padEnd(4)} rpg=${r.rpg?.toFixed(3) ?? 'NULL'} ipg=${r.ipPerGame?.toFixed(3) ?? 'NULL'}`);
    }
  }

  await conn.end();
  console.log(`\n[STEP] Backfill complete.`);
  process.exit(errors > 0 ? 1 : 0);
})();
