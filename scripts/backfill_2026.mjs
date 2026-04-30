/**
 * backfill_2026.mjs
 *
 * Re-ingests all 2026 MLB games (Mar 26 → today) using the corrected
 * away_team_id / home_team_id logic.
 *
 * This script calls the AN v1 API for each date, applies the fixed
 * home/away assignment, and upserts into mlb_schedule_history.
 *
 * Run: DATABASE_URL=... node scripts/backfill_2026.mjs
 */

import { createConnection } from 'mysql2/promise';
import axios from 'axios';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[BACKFILL][FATAL] DATABASE_URL not set');
  process.exit(1);
}

const conn = await createConnection(DATABASE_URL);

const AN_V1_BASE = 'https://api.actionnetwork.com/web/v1/scoreboard/mlb';
const DK_NJ_BOOK_ID = 68;
const AN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Referer': 'https://www.actionnetwork.com/',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtOdds(odds) {
  if (odds == null) return null;
  const rounded = Math.round(odds);
  return rounded >= 0 ? `+${rounded}` : String(rounded);
}

function fmtLine(line) {
  if (line == null) return null;
  return line >= 0 ? `+${line}` : String(line);
}

function utcToEstDate(utcIso) {
  const d = new Date(utcIso);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d).replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$1-$2');
}

function deriveAwayRunLineCovered(awayScore, homeScore, spreadAway) {
  if (awayScore == null || homeScore == null || spreadAway == null) return null;
  return awayScore + spreadAway > homeScore;
}

function deriveTotalResult(awayScore, homeScore, total) {
  if (awayScore == null || homeScore == null || total == null) return null;
  const combined = awayScore + homeScore;
  if (combined > total) return 'OVER';
  if (combined < total) return 'UNDER';
  return 'PUSH';
}

// ─── Date range: 2026 Opening Day → today ────────────────────────────────────

function dateRange(startStr, endStr) {
  const dates = [];
  const cur = new Date(startStr + 'T12:00:00Z');
  const end = new Date(endStr + 'T12:00:00Z');
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    dates.push(`${y}${m}${d}`);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

const today = new Date();
const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
const dates = dateRange('2026-03-26', todayStr);

console.log(`[BACKFILL][START] Re-ingesting 2026 MLB season: 2026-03-26 → ${todayStr}`);
console.log(`[BACKFILL][START] Total dates to process: ${dates.length}`);
console.log(`[BACKFILL][START] Using CORRECTED logic: away_team_id / home_team_id (not teams[] position)`);
console.log('');

let totalFetched = 0, totalUpserted = 0, totalMismatches = 0, totalErrors = 0;

for (const dateStr of dates) {
  const url = `${AN_V1_BASE}?period=game&bookIds=${DK_NJ_BOOK_ID}&date=${dateStr}`;
  
  let games = [];
  try {
    const res = await axios.get(url, { headers: AN_HEADERS, timeout: 15000 });
    games = res.data.games ?? [];
  } catch (err) {
    console.error(`[BACKFILL][ERROR] date=${dateStr} fetch failed: ${err.message}`);
    totalErrors++;
    await new Promise(r => setTimeout(r, 500));
    continue;
  }

  if (games.length === 0) {
    console.log(`[BACKFILL][SKIP] date=${dateStr} — 0 games (off-day)`);
    await new Promise(r => setTimeout(r, 200));
    continue;
  }

  let dateUpserted = 0, dateMismatches = 0;

  for (const game of games) {
    const teams = game.teams ?? [];
    
    // ── CORRECTED: Use away_team_id / home_team_id ────────────────────────────
    let awayTeam, homeTeam;
    let mismatch = false;

    if (game.away_team_id && game.home_team_id) {
      awayTeam = teams.find(t => t.id === game.away_team_id);
      homeTeam = teams.find(t => t.id === game.home_team_id);
      
      if (!awayTeam || !homeTeam) {
        // Fallback to positional
        awayTeam = teams[0];
        homeTeam = teams[1];
      } else if (teams[0]?.id !== game.away_team_id) {
        mismatch = true;
        dateMismatches++;
        totalMismatches++;
      }
    } else {
      awayTeam = teams[0];
      homeTeam = teams[1];
    }

    if (!awayTeam || !homeTeam) continue;

    const awayAbbr = awayTeam.abbr ?? awayTeam.short_name ?? '???';
    const homeAbbr = homeTeam.abbr ?? homeTeam.short_name ?? '???';
    const awaySlug = awayTeam.url_slug ?? '';
    const homeSlug = homeTeam.url_slug ?? '';

    // ── Odds ──────────────────────────────────────────────────────────────────
    const oddsList = game.odds ?? [];
    const dk = oddsList.find(o => o.book_id === DK_NJ_BOOK_ID) ?? null;
    const spreadAway = dk?.spread_away ?? null;
    const spreadHome = dk?.spread_home ?? null;
    const spreadAwayLine = dk?.spread_away_line ?? null;
    const spreadHomeLine = dk?.spread_home_line ?? null;
    const mlAway = dk?.ml_away ?? null;
    const mlHome = dk?.ml_home ?? null;
    const totalLine = dk?.total ?? null;
    const overOdds = dk?.over ?? null;
    const underOdds = dk?.under ?? null;

    // ── Scores ────────────────────────────────────────────────────────────────
    const bs = game.boxscore;
    const awayScore = bs?.total_away_points != null ? Number(bs.total_away_points) : null;
    const homeScore = bs?.total_home_points != null ? Number(bs.total_home_points) : null;
    const isComplete = game.status === 'complete';

    // ── Results ───────────────────────────────────────────────────────────────
    const awayRunLineCovered = isComplete ? deriveAwayRunLineCovered(awayScore, homeScore, spreadAway) : null;
    const homeRunLineCovered = isComplete && awayRunLineCovered != null ? !awayRunLineCovered : null;
    const totalResult = isComplete ? deriveTotalResult(awayScore, homeScore, totalLine) : null;
    const awayWon = isComplete && awayScore != null && homeScore != null ? awayScore > homeScore : null;

    const gameDateEst = utcToEstDate(game.start_time);

    if (mismatch) {
      console.log(`[BACKFILL][FIX] ${dateStr} game.id=${game.id} — teams[] order mismatch corrected: AWAY=${awayAbbr} HOME=${homeAbbr} score=${awayScore}-${homeScore}`);
    }

    // ── Upsert ────────────────────────────────────────────────────────────────
    try {
      await conn.query(`
        INSERT INTO mlb_schedule_history (
          anGameId, gameDate, gameStatus, startTimeUtc,
          awaySlug, homeSlug, awayAbbr, homeAbbr, awayName, homeName,
          awayTeamId, homeTeamId, awayScore, homeScore, awayWon,
          dkAwayRunLine, dkHomeRunLine, dkAwayRunLineOdds, dkHomeRunLineOdds,
          awayRunLineCovered, homeRunLineCovered,
          dkAwayML, dkHomeML,
          dkTotal, dkOverOdds, dkUnderOdds, totalResult,
          lastRefreshedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          gameDate=VALUES(gameDate), gameStatus=VALUES(gameStatus), startTimeUtc=VALUES(startTimeUtc),
          awaySlug=VALUES(awaySlug), homeSlug=VALUES(homeSlug),
          awayAbbr=VALUES(awayAbbr), homeAbbr=VALUES(homeAbbr),
          awayName=VALUES(awayName), homeName=VALUES(homeName),
          awayTeamId=VALUES(awayTeamId), homeTeamId=VALUES(homeTeamId),
          awayScore=VALUES(awayScore), homeScore=VALUES(homeScore), awayWon=VALUES(awayWon),
          dkAwayRunLine=VALUES(dkAwayRunLine), dkHomeRunLine=VALUES(dkHomeRunLine),
          dkAwayRunLineOdds=VALUES(dkAwayRunLineOdds), dkHomeRunLineOdds=VALUES(dkHomeRunLineOdds),
          awayRunLineCovered=VALUES(awayRunLineCovered), homeRunLineCovered=VALUES(homeRunLineCovered),
          dkAwayML=VALUES(dkAwayML), dkHomeML=VALUES(dkHomeML),
          dkTotal=VALUES(dkTotal), dkOverOdds=VALUES(dkOverOdds), dkUnderOdds=VALUES(dkUnderOdds),
          totalResult=VALUES(totalResult), lastRefreshedAt=VALUES(lastRefreshedAt)
      `, [
        game.id, gameDateEst, game.status, game.start_time,
        awaySlug, homeSlug, awayAbbr, homeAbbr,
        awayTeam.full_name ?? awayAbbr, homeTeam.full_name ?? homeAbbr,
        awayTeam.id ?? 0, homeTeam.id ?? 0,
        awayScore, homeScore, awayWon,
        fmtLine(spreadAway), fmtLine(spreadHome),
        fmtOdds(spreadAwayLine), fmtOdds(spreadHomeLine),
        awayRunLineCovered, homeRunLineCovered,
        fmtOdds(mlAway), fmtOdds(mlHome),
        totalLine != null ? String(totalLine) : null,
        fmtOdds(overOdds), fmtOdds(underOdds),
        totalResult, Date.now()
      ]);
      dateUpserted++;
      totalFetched++;
      totalUpserted++;
    } catch (err) {
      console.error(`[BACKFILL][ERROR] game.id=${game.id} upsert failed: ${err.message}`);
      totalErrors++;
    }
  }

  console.log(`[BACKFILL][DATE] ${dateStr} — ${games.length} games fetched, ${dateUpserted} upserted, ${dateMismatches} order-mismatches-fixed`);
  
  // Rate limit: 300ms between dates
  await new Promise(r => setTimeout(r, 300));
}

await conn.end();

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('[BACKFILL][COMPLETE] 2026 MLB season re-ingested with corrected home/away logic');
console.log(`  Total dates processed: ${dates.length}`);
console.log(`  Total games fetched:   ${totalFetched}`);
console.log(`  Total games upserted:  ${totalUpserted}`);
console.log(`  Order mismatches fixed: ${totalMismatches}`);
console.log(`  Errors:                ${totalErrors}`);
console.log('═══════════════════════════════════════════════════════════════');
