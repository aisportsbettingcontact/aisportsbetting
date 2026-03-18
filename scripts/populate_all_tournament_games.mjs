/**
 * populate_all_tournament_games.mjs
 *
 * Populates ALL 36 March Madness 2026 tournament games with VSiN DK NJ odds and splits,
 * then publishes all to the feed.
 *
 * Data source: VSiN https://data.vsin.com/college-basketball/betting-splits/
 * Odds format: awaySpread / homeSpread / total / awayML / homeML
 * Splits format: spreadAwayMoneyPct / spreadAwayBetsPct / totalOverMoneyPct / totalOverBetsPct / mlAwayMoneyPct / mlAwayBetsPct
 *
 * Column order in VSiN data (per row):
 *   away team name, home team name
 *   awaySpread, homeSpread
 *   spreadAwayMoneyPct (handle), spreadAwayBetsPct (bets)
 *   total (over), total (under)
 *   totalOverMoneyPct (handle), totalOverBetsPct (bets)
 *   awayML, homeML
 *   mlAwayMoneyPct (handle), mlAwayBetsPct (bets)
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// ============================================================
// COMPLETE TOURNAMENT GAME DATA
// All odds from VSiN DK NJ (authoritative source)
// ============================================================

const TOURNAMENT_GAMES = [
  // ── FIRST FOUR (March 18) ────────────────────────────────────────────────
  // Already populated from previous session - included here for completeness
  {
    dbId: 1890016,
    awaySlug: 'prairie_view_a_and_m', homeSlug: 'lehigh',
    date: '2026-03-18', time: '15:40',
    awaySpread: 3.5, homeSpread: -3.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 142.5, overOdds: -110, underOdds: -110,
    awayML: 140, homeML: -166,
    spreadAwayMoneyPct: null, spreadAwayBetsPct: null,
    totalOverMoneyPct: null, totalOverBetsPct: null,
    mlAwayMoneyPct: null, mlAwayBetsPct: null,
    label: 'FF: PV A&M vs Lehigh',
  },
  {
    dbId: 1890017,
    awaySlug: 'miami_oh', homeSlug: 'smu',
    date: '2026-03-18', time: '18:15',
    awaySpread: 7.5, homeSpread: -7.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 161.5, overOdds: -110, underOdds: -110,
    awayML: 260, homeML: -325,
    spreadAwayMoneyPct: null, spreadAwayBetsPct: null,
    totalOverMoneyPct: null, totalOverBetsPct: null,
    mlAwayMoneyPct: null, mlAwayBetsPct: null,
    label: 'FF: Miami OH vs SMU',
  },

  // ── ROUND OF 64 - MARCH 19 ────────────────────────────────────────────────
  {
    dbId: 1830083,
    awaySlug: 'tcu', homeSlug: 'ohio_st',
    date: '2026-03-19', time: '09:15',
    awaySpread: 2.5, homeSpread: -2.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 145.5, overOdds: -110, underOdds: -110,
    awayML: 120, homeML: -142,
    spreadAwayMoneyPct: 52, spreadAwayBetsPct: 43,
    totalOverMoneyPct: 40, totalOverBetsPct: 55,
    mlAwayMoneyPct: 53, mlAwayBetsPct: 36,
    label: 'R64: TCU @ Ohio State',
  },
  {
    dbId: 1830109,
    awaySlug: 'troy', homeSlug: 'nebraska',
    date: '2026-03-19', time: '09:40',
    awaySpread: 12.5, homeSpread: -12.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 137.5, overOdds: -110, underOdds: -110,
    awayML: 650, homeML: -1000,
    spreadAwayMoneyPct: 75, spreadAwayBetsPct: 60,
    totalOverMoneyPct: 44, totalOverBetsPct: 63,
    mlAwayMoneyPct: 83, mlAwayBetsPct: 25,
    label: 'R64: Troy @ Nebraska',
  },
  {
    dbId: 1830084,
    awaySlug: 'south_florida', homeSlug: 'louisville',
    date: '2026-03-19', time: '10:30',
    awaySpread: 4.5, homeSpread: -4.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 163.5, overOdds: -110, underOdds: -110,
    awayML: 164, homeML: -198,
    spreadAwayMoneyPct: 84, spreadAwayBetsPct: 70,
    totalOverMoneyPct: 60, totalOverBetsPct: 43,
    mlAwayMoneyPct: 85, mlAwayBetsPct: 44,
    label: 'R64: South Florida @ Louisville',
  },
  {
    dbId: 1830091,
    awaySlug: 'high_point', homeSlug: 'wisconsin',
    date: '2026-03-19', time: '10:50',
    awaySpread: 10.5, homeSpread: -10.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 163.5, overOdds: -110, underOdds: -110,
    awayML: 380, homeML: -500,
    spreadAwayMoneyPct: 54, spreadAwayBetsPct: 65,
    totalOverMoneyPct: 51, totalOverBetsPct: 51,
    mlAwayMoneyPct: 56, mlAwayBetsPct: 23,
    label: 'R64: High Point @ Wisconsin',
  },
  {
    dbId: 1830082,
    awaySlug: 'siena', homeSlug: 'duke',
    date: '2026-03-19', time: '11:50',
    awaySpread: 27.5, homeSpread: -27.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 135.5, overOdds: -110, underOdds: -110,
    awayML: 3500, homeML: -20000,
    spreadAwayMoneyPct: 36, spreadAwayBetsPct: 64,
    totalOverMoneyPct: 18, totalOverBetsPct: 76,
    mlAwayMoneyPct: 25, mlAwayBetsPct: 10,
    label: 'R64: Siena @ Duke',
  },
  {
    dbId: 1830107,
    awaySlug: 'mcneese_st', homeSlug: 'vanderbilt',
    date: '2026-03-19', time: '12:15',
    awaySpread: 11.5, homeSpread: -11.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 150.5, overOdds: -110, underOdds: -110,
    awayML: 500, homeML: -700,
    spreadAwayMoneyPct: 46, spreadAwayBetsPct: 75,
    totalOverMoneyPct: 55, totalOverBetsPct: 55,
    mlAwayMoneyPct: 44, mlAwayBetsPct: 16,
    label: 'R64: McNeese ST @ Vanderbilt',
  },
  {
    dbId: 1830085,
    awaySlug: 'n_dakota_st', homeSlug: 'michigan_st',
    date: '2026-03-19', time: '13:05',
    awaySpread: 16.5, homeSpread: -16.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 143.5, overOdds: -110, underOdds: -110,
    awayML: 1000, homeML: -1800,
    spreadAwayMoneyPct: 42, spreadAwayBetsPct: 43,
    totalOverMoneyPct: 58, totalOverBetsPct: 58,
    mlAwayMoneyPct: 65, mlAwayBetsPct: 11,
    label: 'R64: N Dakota ST @ Michigan ST',
  },
  {
    dbId: 1830092,
    awaySlug: 'hawaii', homeSlug: 'arkansas',
    date: '2026-03-19', time: '13:25',
    awaySpread: 15.5, homeSpread: -15.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 159.5, overOdds: -110, underOdds: -110,
    awayML: 850, homeML: -1450,
    spreadAwayMoneyPct: 58, spreadAwayBetsPct: 36,
    totalOverMoneyPct: 40, totalOverBetsPct: 40,
    mlAwayMoneyPct: 77, mlAwayBetsPct: 11,
    label: 'R64: Hawaii @ Arkansas',
  },
  {
    dbId: 1830110,
    awaySlug: 'va_commonwealth', homeSlug: 'north_carolina',
    date: '2026-03-19', time: '15:50',
    awaySpread: 2.5, homeSpread: -2.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 152.5, overOdds: -110, underOdds: -110,
    awayML: 130, homeML: -155,
    spreadAwayMoneyPct: 57, spreadAwayBetsPct: 12,
    totalOverMoneyPct: 40, totalOverBetsPct: 40,
    mlAwayMoneyPct: 65, mlAwayBetsPct: 44,
    label: 'R64: VCU @ North Carolina',
  },
  {
    dbId: 1860014,
    awaySlug: 'howard', homeSlug: 'michigan',
    date: '2026-03-19', time: '16:10',
    awaySpread: 30.5, homeSpread: -30.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 151.5, overOdds: -110, underOdds: -110,
    awayML: 3500, homeML: -20000,
    spreadAwayMoneyPct: 59, spreadAwayBetsPct: 73,
    totalOverMoneyPct: 50, totalOverBetsPct: 50,
    mlAwayMoneyPct: 50, mlAwayBetsPct: 16,
    label: 'R64: Howard @ Michigan',
  },
  {
    dbId: 1860015,
    awaySlug: 'texas', homeSlug: 'brigham_young',
    date: '2026-03-19', time: '16:25',
    awaySpread: 2.5, homeSpread: -2.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 157.5, overOdds: -110, underOdds: -110,
    awayML: 114, homeML: -135,
    spreadAwayMoneyPct: 21, spreadAwayBetsPct: 35,
    totalOverMoneyPct: 38, totalOverBetsPct: 38,
    mlAwayMoneyPct: 56, mlAwayBetsPct: 39,
    label: 'R64: Texas @ BYU',
  },
  {
    dbId: 1830112,
    awaySlug: 'texas_a_and_m', homeSlug: 'st_marys',
    date: '2026-03-19', time: '16:35',
    awaySpread: 3.5, homeSpread: -3.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 147.5, overOdds: -110, underOdds: -110,
    awayML: 136, homeML: -162,
    spreadAwayMoneyPct: 41, spreadAwayBetsPct: 52,
    totalOverMoneyPct: 42, totalOverBetsPct: 42,
    mlAwayMoneyPct: 62, mlAwayBetsPct: 42,
    label: "R64: Texas A&M @ Saint Mary's",
  },
  {
    dbId: 1830111,
    awaySlug: 'pennsylvania', homeSlug: 'illinois',
    date: '2026-03-19', time: '18:25',
    awaySpread: 25.5, homeSpread: -25.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 151.5, overOdds: -110, underOdds: -110,
    awayML: 2200, homeML: -8000,
    spreadAwayMoneyPct: 58, spreadAwayBetsPct: 70,
    totalOverMoneyPct: 54, totalOverBetsPct: 54,
    mlAwayMoneyPct: 93, mlAwayBetsPct: 19,
    label: 'R64: Penn @ Illinois',
  },
  {
    dbId: 1830094,
    awaySlug: 'saint_louis', homeSlug: 'georgia',
    date: '2026-03-19', time: '18:45',
    awaySpread: 2.5, homeSpread: -2.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 169.5, overOdds: -110, underOdds: -110,
    awayML: 124, homeML: -148,
    spreadAwayMoneyPct: 36, spreadAwayBetsPct: 40,
    totalOverMoneyPct: 37, totalOverBetsPct: 37,
    mlAwayMoneyPct: 72, mlAwayBetsPct: 46,
    label: 'R64: Saint Louis @ Georgia',
  },
  {
    dbId: 1830093,
    awaySlug: 'kennesaw_st', homeSlug: 'gonzaga',
    date: '2026-03-19', time: '19:00',
    awaySpread: 21.5, homeSpread: -21.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 154.5, overOdds: -110, underOdds: -110,
    awayML: 1600, homeML: -4000,
    spreadAwayMoneyPct: 37, spreadAwayBetsPct: 30,
    totalOverMoneyPct: 33, totalOverBetsPct: 33,
    mlAwayMoneyPct: 88, mlAwayBetsPct: 12,
    label: 'R64: Kennesaw ST @ Gonzaga',
  },
  {
    dbId: 1830113,
    awaySlug: 'idaho', homeSlug: 'houston',
    date: '2026-03-19', time: '19:10',
    awaySpread: 23.5, homeSpread: -23.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 137.5, overOdds: -110, underOdds: -110,
    awayML: 2200, homeML: -8000,
    spreadAwayMoneyPct: 12, spreadAwayBetsPct: 62,
    totalOverMoneyPct: 11, totalOverBetsPct: 11,
    mlAwayMoneyPct: 78, mlAwayBetsPct: 11,
    label: 'R64: Idaho @ Houston',
  },

  // ── ROUND OF 64 - MARCH 20 ────────────────────────────────────────────────
  {
    dbId: 1830105,
    awaySlug: 'santa_clara', homeSlug: 'kentucky',
    date: '2026-03-20', time: '09:15',
    awaySpread: 2.5, homeSpread: -2.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 160.5, overOdds: -110, underOdds: -110,
    awayML: 136, homeML: -162,
    spreadAwayMoneyPct: 59, spreadAwayBetsPct: 52,
    totalOverMoneyPct: 23, totalOverBetsPct: 34,
    mlAwayMoneyPct: 60, mlAwayBetsPct: 33,
    label: 'R64: Santa Clara @ Kentucky',
  },
  {
    dbId: 1830099,
    awaySlug: 'akron', homeSlug: 'texas_tech',
    date: '2026-03-20', time: '09:40',
    awaySpread: 7.5, homeSpread: -7.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 156.5, overOdds: -110, underOdds: -110,
    awayML: 260, homeML: -325,
    spreadAwayMoneyPct: 78, spreadAwayBetsPct: 68,
    totalOverMoneyPct: 42, totalOverBetsPct: 47,
    mlAwayMoneyPct: 82, mlAwayBetsPct: 31,
    label: 'R64: Akron @ Texas Tech',
  },
  {
    dbId: 1830095,
    awaySlug: 'liu_brooklyn', homeSlug: 'arizona',
    date: '2026-03-20', time: '10:35',
    awaySpread: 30.5, homeSpread: -30.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 150.5, overOdds: -110, underOdds: -110,
    awayML: 5000, homeML: -100000,
    spreadAwayMoneyPct: 31, spreadAwayBetsPct: 45,
    totalOverMoneyPct: 17, totalOverBetsPct: 45,
    mlAwayMoneyPct: 36, mlAwayBetsPct: 13,
    label: 'R64: LIU @ Arizona',
  },
  {
    dbId: 1830104,
    awaySlug: 'wright_st', homeSlug: 'virginia',
    date: '2026-03-20', time: '10:50',
    awaySpread: 18.5, homeSpread: -18.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 145.5, overOdds: -110, underOdds: -110,
    awayML: 1300, homeML: -2800,
    spreadAwayMoneyPct: 45, spreadAwayBetsPct: 44,
    totalOverMoneyPct: 27, totalOverBetsPct: 48,
    mlAwayMoneyPct: 87, mlAwayBetsPct: 12,
    label: 'R64: Wright ST @ Virginia',
  },
  {
    dbId: 1830106,
    awaySlug: 'tennessee_st', homeSlug: 'iowa_st',
    date: '2026-03-20', time: '11:50',
    awaySpread: 24.5, homeSpread: -24.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 149.5, overOdds: -110, underOdds: -110,
    awayML: 2200, homeML: -8000,
    spreadAwayMoneyPct: 27, spreadAwayBetsPct: 44,
    totalOverMoneyPct: 15, totalOverBetsPct: 44,
    mlAwayMoneyPct: 86, mlAwayBetsPct: 13,
    label: 'R64: Tennessee ST @ Iowa ST',
  },
  {
    dbId: 1830103,
    awaySlug: 'hofstra', homeSlug: 'alabama',
    date: '2026-03-20', time: '12:15',
    awaySpread: 11.5, homeSpread: -11.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 159.5, overOdds: -110, underOdds: -110,
    awayML: 550, homeML: -800,
    spreadAwayMoneyPct: 66, spreadAwayBetsPct: 45,
    totalOverMoneyPct: 29, totalOverBetsPct: 45,
    mlAwayMoneyPct: 82, mlAwayBetsPct: 21,
    label: 'R64: Hofstra @ Alabama',
  },
  {
    dbId: 1830096,
    awaySlug: 'utah_st', homeSlug: 'villanova',
    date: '2026-03-20', time: '13:10',
    // NOTE: Utah State is the FAVORITE here (negative spread)
    awaySpread: -1.5, homeSpread: 1.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 146.5, overOdds: -110, underOdds: -110,
    awayML: -125, homeML: 105,
    spreadAwayMoneyPct: 61, spreadAwayBetsPct: 56,
    totalOverMoneyPct: 38, totalOverBetsPct: 59,
    mlAwayMoneyPct: 56, mlAwayBetsPct: 49,
    label: 'R64: Utah ST @ Villanova (Utah ST favored)',
  },
  {
    dbId: 1890019,
    awaySlug: 'miami_oh', homeSlug: 'tennessee',
    date: '2026-03-20', time: '13:25',
    // Placeholder - odds TBD pending First Four result tonight
    awaySpread: null, homeSpread: null,
    awaySpreadOdds: null, homeSpreadOdds: null,
    total: null, overOdds: null, underOdds: null,
    awayML: null, homeML: null,
    spreadAwayMoneyPct: null, spreadAwayBetsPct: null,
    totalOverMoneyPct: null, totalOverBetsPct: null,
    mlAwayMoneyPct: null, mlAwayBetsPct: null,
    label: 'R64: Miami OH/SMU winner @ Tennessee (odds pending First Four)',
  },
  {
    dbId: 1830102,
    awaySlug: 'iowa', homeSlug: 'clemson',
    date: '2026-03-20', time: '15:50',
    // NOTE: Iowa is the FAVORITE here
    awaySpread: -2.5, homeSpread: 2.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 128.5, overOdds: -110, underOdds: -110,
    awayML: -135, homeML: 114,
    spreadAwayMoneyPct: 72, spreadAwayBetsPct: 52,
    totalOverMoneyPct: 42, totalOverBetsPct: 55,
    mlAwayMoneyPct: 51, mlAwayBetsPct: 55,
    label: 'R64: Iowa @ Clemson (Iowa favored)',
  },
  {
    dbId: 1830086,
    awaySlug: 'n_iowa', homeSlug: 'st_johns',
    date: '2026-03-20', time: '16:10',
    awaySpread: 9.5, homeSpread: -9.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 131.5, overOdds: -110, underOdds: -110,
    awayML: 400, homeML: -535,
    spreadAwayMoneyPct: 47, spreadAwayBetsPct: 50,
    totalOverMoneyPct: 57, totalOverBetsPct: 57,
    mlAwayMoneyPct: 12, mlAwayBetsPct: 11,
    label: "R64: Northern Iowa @ St. John's",
  },
  {
    dbId: 1830088,
    awaySlug: 'c_florida', homeSlug: 'ucla',
    date: '2026-03-20', time: '16:25',
    awaySpread: 5.5, homeSpread: -5.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 152.5, overOdds: -110, underOdds: -110,
    awayML: 205, homeML: -250,
    spreadAwayMoneyPct: 43, spreadAwayBetsPct: 43,
    totalOverMoneyPct: 20, totalOverBetsPct: 43,
    mlAwayMoneyPct: 63, mlAwayBetsPct: 25,
    label: 'R64: UCF @ UCLA',
  },
  {
    dbId: 1830098,
    awaySlug: 'queens_nc', homeSlug: 'purdue',
    date: '2026-03-20', time: '16:35',
    awaySpread: 25.5, homeSpread: -25.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 163.5, overOdds: -110, underOdds: -110,
    awayML: 2200, homeML: -8000,
    spreadAwayMoneyPct: 34, spreadAwayBetsPct: 24,
    totalOverMoneyPct: 17, totalOverBetsPct: 24,
    mlAwayMoneyPct: 78, mlAwayBetsPct: 17,
    label: "R64: Queens NC @ Purdue",
  },
  {
    dbId: 1890020,
    awaySlug: 'prairie_view_a_and_m', homeSlug: 'florida',
    date: '2026-03-20', time: '18:25',
    // Placeholder - odds TBD pending First Four result tonight
    awaySpread: null, homeSpread: null,
    awaySpreadOdds: null, homeSpreadOdds: null,
    total: null, overOdds: null, underOdds: null,
    awayML: null, homeML: null,
    spreadAwayMoneyPct: null, spreadAwayBetsPct: null,
    totalOverMoneyPct: null, totalOverBetsPct: null,
    mlAwayMoneyPct: null, mlAwayBetsPct: null,
    label: 'R64: PV A&M/Lehigh winner @ Florida (odds pending First Four)',
  },
  {
    dbId: 1830087,
    awaySlug: 'california_baptist', homeSlug: 'kansas',
    date: '2026-03-20', time: '18:45',
    awaySpread: 14.5, homeSpread: -14.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 138.5, overOdds: -110, underOdds: -110,
    awayML: 750, homeML: -1200,
    spreadAwayMoneyPct: 27, spreadAwayBetsPct: 56,
    totalOverMoneyPct: 35, totalOverBetsPct: 56,
    mlAwayMoneyPct: 64, mlAwayBetsPct: 14,
    label: 'R64: Cal Baptist @ Kansas',
  },
  {
    dbId: 1830089,
    awaySlug: 'furman', homeSlug: 'connecticut',
    date: '2026-03-20', time: '19:00',
    awaySpread: 20.5, homeSpread: -20.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 136.5, overOdds: -110, underOdds: -110,
    awayML: 1700, homeML: -4500,
    spreadAwayMoneyPct: 38, spreadAwayBetsPct: 76,
    totalOverMoneyPct: 51, totalOverBetsPct: 76,
    mlAwayMoneyPct: 88, mlAwayBetsPct: 15,
    label: 'R64: Furman @ UConn',
  },
  {
    dbId: 1830097,
    awaySlug: 'missouri', homeSlug: 'miami_fl',
    date: '2026-03-20', time: '19:10',
    // NOTE: Missouri is the slight favorite
    awaySpread: -1.5, homeSpread: 1.5,
    awaySpreadOdds: -110, homeSpreadOdds: -110,
    total: 147.5, overOdds: -110, underOdds: -110,
    awayML: -130, homeML: 110,
    spreadAwayMoneyPct: 44, spreadAwayBetsPct: 57,
    totalOverMoneyPct: 22, totalOverBetsPct: 57,
    mlAwayMoneyPct: 67, mlAwayBetsPct: 44,
    label: 'R64: Missouri @ Miami FL (Missouri favored)',
  },
];

// ============================================================
// UPDATE ALL GAMES
// ============================================================
console.log('=== POPULATING ALL TOURNAMENT GAMES ===');
console.log(`Total games to process: ${TOURNAMENT_GAMES.length}`);
console.log('');

let updated = 0;
let skipped = 0;
let errors = 0;

for (const g of TOURNAMENT_GAMES) {
  try {
    // Skip games with null odds (First Four winner placeholders)
    if (g.awaySpread === null && g.total === null && g.awayML === null) {
      console.log(`  SKIP (no odds yet): ${g.label} (ID:${g.dbId})`);
      // Still publish to feed even without odds? No - only publish when odds available
      skipped++;
      continue;
    }

    const [result] = await conn.execute(
      `UPDATE games SET
        awayBookSpread = ?,
        homeBookSpread = ?,
        awaySpreadOdds = ?,
        homeSpreadOdds = ?,
        bookTotal = ?,
        overOdds = ?,
        underOdds = ?,
        awayML = ?,
        homeML = ?,
        spreadAwayMoneyPct = ?,
        spreadAwayBetsPct = ?,
        totalOverMoneyPct = ?,
        totalOverBetsPct = ?,
        mlAwayMoneyPct = ?,
        mlAwayBetsPct = ?,
        publishedToFeed = 1
      WHERE id = ?`,
      [
        g.awaySpread, g.homeSpread,
        g.awaySpreadOdds, g.homeSpreadOdds,
        g.total, g.overOdds, g.underOdds,
        g.awayML, g.homeML,
        g.spreadAwayMoneyPct, g.spreadAwayBetsPct,
        g.totalOverMoneyPct, g.totalOverBetsPct,
        g.mlAwayMoneyPct, g.mlAwayBetsPct,
        g.dbId,
      ]
    );

    if (result.affectedRows === 1) {
      console.log(`  ✓ UPDATED+PUBLISHED: ${g.label} (ID:${g.dbId})`);
      updated++;
    } else {
      console.log(`  ⚠ NO MATCH: ${g.label} (ID:${g.dbId}) — affectedRows=${result.affectedRows}`);
      errors++;
    }
  } catch (err) {
    console.error(`  ✗ ERROR: ${g.label} (ID:${g.dbId}):`, err.message);
    errors++;
  }
}

console.log('');
console.log('=== SUMMARY ===');
console.log(`  Updated + Published: ${updated}`);
console.log(`  Skipped (no odds):   ${skipped}`);
console.log(`  Errors:              ${errors}`);

// ============================================================
// FINAL VERIFICATION
// ============================================================
console.log('');
console.log('=== FINAL FEED VERIFICATION ===');

const [feedGames] = await conn.execute(
  `SELECT id, awayTeam, homeTeam, gameDate, startTimeEst, 
          awayBookSpread, bookTotal, awayML, publishedToFeed,
          spreadAwayBetsPct, mlAwayBetsPct
   FROM games 
   WHERE sport = 'NCAAM' AND publishedToFeed = 1
   ORDER BY gameDate, startTimeEst`
);

console.log(`\nGames published to feed: ${feedGames.length}`);
console.log('');

const byDate = new Map();
for (const r of feedGames) {
  const d = r.gameDate;
  if (!byDate.has(d)) byDate.set(d, []);
  byDate.get(d).push(r);
}

for (const [date, games] of [...byDate.entries()].sort()) {
  console.log(`DATE: ${date} (${games.length} games)`);
  for (const g of games) {
    const spread = g.awayBookSpread !== null ? `spread:${g.awayBookSpread > 0 ? '+' : ''}${g.awayBookSpread}` : 'spread:NULL';
    const total = g.bookTotal !== null ? `total:${g.bookTotal}` : 'total:NULL';
    const ml = g.awayML !== null ? `ml:${g.awayML > 0 ? '+' : ''}${g.awayML}` : 'ml:NULL';
    const splits = g.spreadAwayBetsPct !== null ? `splits:YES` : 'splits:NO';
    console.log(`  ID:${g.id} | ${g.awayTeam} @ ${g.homeTeam} | ${spread} | ${total} | ${ml} | ${splits}`);
  }
  console.log('');
}

await conn.end();
console.log('Done.');
