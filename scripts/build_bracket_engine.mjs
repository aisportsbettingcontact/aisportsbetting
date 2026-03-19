/**
 * build_bracket_engine.mjs
 *
 * COMPLETE 2026 NCAA TOURNAMENT BRACKET PROGRESSION ENGINE
 *
 * Layout (as confirmed by user):
 *   LEFT SIDE:  EAST (top) + SOUTH (bottom)
 *   RIGHT SIDE: WEST (top) + MIDWEST (bottom)
 *
 * Final Four pairings:
 *   Game 601: EAST winner vs SOUTH winner  (left side semifinal, April 4)
 *   Game 602: WEST winner vs MIDWEST winner (right side semifinal, April 4)
 *   Game 701: Championship (601 winner vs 602 winner, April 6)
 *
 * NCAA.com Game ID structure:
 *   1xx = First Four (101-104)
 *   2xx = Round of 64 (201-232)
 *   3xx = Round of 32 (301-316)
 *   4xx = Sweet 16 (401-408)
 *   5xx = Elite 8 (501-504)
 *   6xx = Final Four (601-602)
 *   7xx = Championship (701)
 *
 * COMPLETE BRACKET PROGRESSION TREE:
 * ─────────────────────────────────────────────────────────────────────────────
 * EAST REGION (games 201-208 → 301-304 → 401-402 → 501)
 *   R64 Game 201: (1)Duke vs (16)Siena          → R32 Game 301 (top slot)
 *   R64 Game 202: (8)Ohio St vs (9)TCU          → R32 Game 301 (bottom slot)
 *   R64 Game 203: (5)St.John's vs (12)N.Iowa    → R32 Game 302 (top slot)
 *   R64 Game 204: (4)Kansas vs (13)Cal Baptist  → R32 Game 302 (bottom slot)
 *   R64 Game 205: (6)Louisville vs (11)S.Fla    → R32 Game 303 (top slot)
 *   R64 Game 206: (3)Mich.St vs (14)NDSU        → R32 Game 303 (bottom slot)
 *   R64 Game 207: (7)UCLA vs (10)UCF            → R32 Game 304 (top slot)
 *   R64 Game 208: (2)UConn vs (15)Furman        → R32 Game 304 (bottom slot)
 *   R32 Game 301: W(201) vs W(202)              → S16 Game 401 (top slot)
 *   R32 Game 302: W(203) vs W(204)              → S16 Game 401 (bottom slot)
 *   R32 Game 303: W(205) vs W(206)              → S16 Game 402 (top slot)
 *   R32 Game 304: W(207) vs W(208)              → S16 Game 402 (bottom slot)
 *   S16 Game 401: W(301) vs W(302)              → E8 Game 501 (top slot)
 *   S16 Game 402: W(303) vs W(304)              → E8 Game 501 (bottom slot)
 *   E8 Game 501:  W(401) vs W(402)              → F4 Game 601 (top slot)
 *
 * SOUTH REGION (games 209-216 → 305-308 → 403-404 → 502)
 *   R64 Game 209: (1)Florida vs (16)FF-winner   → R32 Game 305 (top slot)
 *   R64 Game 210: (8)Clemson vs (9)Iowa         → R32 Game 305 (bottom slot)
 *   R64 Game 211: (5)Vanderbilt vs (12)McNeese  → R32 Game 306 (top slot)
 *   R64 Game 212: (4)Nebraska vs (13)Troy       → R32 Game 306 (bottom slot)
 *   R64 Game 213: (6)N.Carolina vs (11)VCU      → R32 Game 307 (top slot)
 *   R64 Game 214: (3)Illinois vs (14)Penn       → R32 Game 307 (bottom slot)
 *   R64 Game 215: (7)St.Mary's vs (10)Tex.A&M  → R32 Game 308 (top slot)
 *   R64 Game 216: (2)Houston vs (15)Idaho       → R32 Game 308 (bottom slot)
 *   R32 Game 305: W(209) vs W(210)              → S16 Game 403 (top slot)
 *   R32 Game 306: W(211) vs W(212)              → S16 Game 403 (bottom slot)
 *   R32 Game 307: W(213) vs W(214)              → S16 Game 404 (top slot)
 *   R32 Game 308: W(215) vs W(216)              → S16 Game 404 (bottom slot)
 *   S16 Game 403: W(305) vs W(306)              → E8 Game 502 (top slot)
 *   S16 Game 404: W(307) vs W(308)              → E8 Game 502 (bottom slot)
 *   E8 Game 502:  W(403) vs W(404)              → F4 Game 601 (bottom slot)
 *
 * WEST REGION (games 217-224 → 309-312 → 405-406 → 503)
 *   R64 Game 217: (1)Arizona vs (16)LIU         → R32 Game 309 (top slot)
 *   R64 Game 218: (8)Villanova vs (9)Utah St    → R32 Game 309 (bottom slot)
 *   R64 Game 219: (5)Wisconsin vs (12)H.Point   → R32 Game 310 (top slot)
 *   R64 Game 220: (4)Arkansas vs (13)Hawaii     → R32 Game 310 (bottom slot)
 *   R64 Game 221: (6)BYU vs (11)Texas[FF]       → R32 Game 311 (top slot)
 *   R64 Game 222: (3)Gonzaga vs (14)Kennesaw    → R32 Game 311 (bottom slot)
 *   R64 Game 223: (7)Miami FL vs (10)Missouri   → R32 Game 312 (top slot)
 *   R64 Game 224: (2)Purdue vs (15)Queens NC    → R32 Game 312 (bottom slot)
 *   R32 Game 309: W(217) vs W(218)              → S16 Game 405 (top slot)
 *   R32 Game 310: W(219) vs W(220)              → S16 Game 405 (bottom slot)
 *   R32 Game 311: W(221) vs W(222)              → S16 Game 406 (top slot)
 *   R32 Game 312: W(223) vs W(224)              → S16 Game 406 (bottom slot)
 *   S16 Game 405: W(309) vs W(310)              → E8 Game 503 (top slot)
 *   S16 Game 406: W(311) vs W(312)              → E8 Game 503 (bottom slot)
 *   E8 Game 503:  W(405) vs W(406)              → F4 Game 602 (top slot)
 *
 * MIDWEST REGION (games 225-232 → 313-316 → 407-408 → 504)
 *   FF Game 101:  (16)UMBC vs (16)Howard        → R64 Game 225 (bottom slot)
 *   R64 Game 225: (1)Michigan vs (16)FF-winner  → R32 Game 313 (top slot)
 *   R64 Game 226: (8)Georgia vs (9)St.Louis     → R32 Game 313 (bottom slot)
 *   R64 Game 227: (5)Tex.Tech vs (12)Akron      → R32 Game 314 (top slot)
 *   R64 Game 228: (4)Alabama vs (13)Hofstra     → R32 Game 314 (bottom slot)
 *   R64 Game 229: (6)Tennessee vs (11)FF-winner → R32 Game 315 (top slot)
 *   R64 Game 230: (3)Virginia vs (14)Wright St  → R32 Game 315 (bottom slot)
 *   R64 Game 231: (7)Kentucky vs (10)S.Clara    → R32 Game 316 (top slot)
 *   R64 Game 232: (2)Iowa St vs (15)Tenn.St     → R32 Game 316 (bottom slot)
 *   R32 Game 313: W(225) vs W(226)              → S16 Game 407 (top slot)
 *   R32 Game 314: W(227) vs W(228)              → S16 Game 407 (bottom slot)
 *   R32 Game 315: W(229) vs W(230)              → S16 Game 408 (top slot)
 *   R32 Game 316: W(231) vs W(232)              → S16 Game 408 (bottom slot)
 *   S16 Game 407: W(313) vs W(314)              → E8 Game 504 (top slot)
 *   S16 Game 408: W(315) vs W(316)              → E8 Game 504 (bottom slot)
 *   E8 Game 504:  W(407) vs W(408)              → F4 Game 602 (bottom slot)
 *
 * FINAL FOUR:
 *   F4 Game 601:  W(501-EAST) vs W(502-SOUTH)  → Championship 701 (top slot)
 *   F4 Game 602:  W(503-WEST) vs W(504-MIDWEST)→ Championship 701 (bottom slot)
 *   Championship 701: W(601) vs W(602)          → CHAMPION
 *
 * FIRST FOUR:
 *   FF Game 101: UMBC vs Howard    → winner = (16) seed in Game 225 (Michigan's bracket)
 *   FF Game 102: Texas vs NC State → winner = (11) seed in Game 221 (BYU's bracket)
 *   FF Game 103: PV A&M vs Lehigh  → winner = (16) seed in Game 209 (Florida's bracket)
 *   FF Game 104: Miami OH vs SMU   → winner = (11) seed in Game 229 (Tennessee's bracket)
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

// ─── COMPLETE BRACKET PROGRESSION MAP ────────────────────────────────────────
// Maps: bracketGameId → { round, region, slot, nextBracketGameId, nextBracketSlot }
const BRACKET_MAP = {
  // ── FIRST FOUR ──────────────────────────────────────────────────────────────
  101: { round: 'FIRST_FOUR', region: 'MIDWEST', slot: 0, nextBracketGameId: 225, nextBracketSlot: 'bottom' },
  102: { round: 'FIRST_FOUR', region: 'WEST',    slot: 0, nextBracketGameId: 221, nextBracketSlot: 'bottom' },
  103: { round: 'FIRST_FOUR', region: 'SOUTH',   slot: 0, nextBracketGameId: 209, nextBracketSlot: 'bottom' },
  104: { round: 'FIRST_FOUR', region: 'SOUTH',   slot: 0, nextBracketGameId: 229, nextBracketSlot: 'bottom' },

  // ── EAST REGION — Round of 64 ────────────────────────────────────────────────
  201: { round: 'R64', region: 'EAST', slot: 1, nextBracketGameId: 301, nextBracketSlot: 'top' },
  202: { round: 'R64', region: 'EAST', slot: 2, nextBracketGameId: 301, nextBracketSlot: 'bottom' },
  203: { round: 'R64', region: 'EAST', slot: 3, nextBracketGameId: 302, nextBracketSlot: 'top' },
  204: { round: 'R64', region: 'EAST', slot: 4, nextBracketGameId: 302, nextBracketSlot: 'bottom' },
  205: { round: 'R64', region: 'EAST', slot: 5, nextBracketGameId: 303, nextBracketSlot: 'top' },
  206: { round: 'R64', region: 'EAST', slot: 6, nextBracketGameId: 303, nextBracketSlot: 'bottom' },
  207: { round: 'R64', region: 'EAST', slot: 7, nextBracketGameId: 304, nextBracketSlot: 'top' },
  208: { round: 'R64', region: 'EAST', slot: 8, nextBracketGameId: 304, nextBracketSlot: 'bottom' },

  // ── SOUTH REGION — Round of 64 ───────────────────────────────────────────────
  209: { round: 'R64', region: 'SOUTH', slot: 1, nextBracketGameId: 305, nextBracketSlot: 'top' },
  210: { round: 'R64', region: 'SOUTH', slot: 2, nextBracketGameId: 305, nextBracketSlot: 'bottom' },
  211: { round: 'R64', region: 'SOUTH', slot: 3, nextBracketGameId: 306, nextBracketSlot: 'top' },
  212: { round: 'R64', region: 'SOUTH', slot: 4, nextBracketGameId: 306, nextBracketSlot: 'bottom' },
  213: { round: 'R64', region: 'SOUTH', slot: 5, nextBracketGameId: 307, nextBracketSlot: 'top' },
  214: { round: 'R64', region: 'SOUTH', slot: 6, nextBracketGameId: 307, nextBracketSlot: 'bottom' },
  215: { round: 'R64', region: 'SOUTH', slot: 7, nextBracketGameId: 308, nextBracketSlot: 'top' },
  216: { round: 'R64', region: 'SOUTH', slot: 8, nextBracketGameId: 308, nextBracketSlot: 'bottom' },

  // ── WEST REGION — Round of 64 ────────────────────────────────────────────────
  217: { round: 'R64', region: 'WEST', slot: 1, nextBracketGameId: 309, nextBracketSlot: 'top' },
  218: { round: 'R64', region: 'WEST', slot: 2, nextBracketGameId: 309, nextBracketSlot: 'bottom' },
  219: { round: 'R64', region: 'WEST', slot: 3, nextBracketGameId: 310, nextBracketSlot: 'top' },
  220: { round: 'R64', region: 'WEST', slot: 4, nextBracketGameId: 310, nextBracketSlot: 'bottom' },
  221: { round: 'R64', region: 'WEST', slot: 5, nextBracketGameId: 311, nextBracketSlot: 'top' },
  222: { round: 'R64', region: 'WEST', slot: 6, nextBracketGameId: 311, nextBracketSlot: 'bottom' },
  223: { round: 'R64', region: 'WEST', slot: 7, nextBracketGameId: 312, nextBracketSlot: 'top' },
  224: { round: 'R64', region: 'WEST', slot: 8, nextBracketGameId: 312, nextBracketSlot: 'bottom' },

  // ── MIDWEST REGION — Round of 64 ─────────────────────────────────────────────
  225: { round: 'R64', region: 'MIDWEST', slot: 1, nextBracketGameId: 313, nextBracketSlot: 'top' },
  226: { round: 'R64', region: 'MIDWEST', slot: 2, nextBracketGameId: 313, nextBracketSlot: 'bottom' },
  227: { round: 'R64', region: 'MIDWEST', slot: 3, nextBracketGameId: 314, nextBracketSlot: 'top' },
  228: { round: 'R64', region: 'MIDWEST', slot: 4, nextBracketGameId: 314, nextBracketSlot: 'bottom' },
  229: { round: 'R64', region: 'MIDWEST', slot: 5, nextBracketGameId: 315, nextBracketSlot: 'top' },
  230: { round: 'R64', region: 'MIDWEST', slot: 6, nextBracketGameId: 315, nextBracketSlot: 'bottom' },
  231: { round: 'R64', region: 'MIDWEST', slot: 7, nextBracketGameId: 316, nextBracketSlot: 'top' },
  232: { round: 'R64', region: 'MIDWEST', slot: 8, nextBracketGameId: 316, nextBracketSlot: 'bottom' },

  // ── EAST REGION — Round of 32 ────────────────────────────────────────────────
  301: { round: 'R32', region: 'EAST', slot: 1, nextBracketGameId: 401, nextBracketSlot: 'top' },
  302: { round: 'R32', region: 'EAST', slot: 2, nextBracketGameId: 401, nextBracketSlot: 'bottom' },
  303: { round: 'R32', region: 'EAST', slot: 3, nextBracketGameId: 402, nextBracketSlot: 'top' },
  304: { round: 'R32', region: 'EAST', slot: 4, nextBracketGameId: 402, nextBracketSlot: 'bottom' },

  // ── SOUTH REGION — Round of 32 ───────────────────────────────────────────────
  305: { round: 'R32', region: 'SOUTH', slot: 1, nextBracketGameId: 403, nextBracketSlot: 'top' },
  306: { round: 'R32', region: 'SOUTH', slot: 2, nextBracketGameId: 403, nextBracketSlot: 'bottom' },
  307: { round: 'R32', region: 'SOUTH', slot: 3, nextBracketGameId: 404, nextBracketSlot: 'top' },
  308: { round: 'R32', region: 'SOUTH', slot: 4, nextBracketGameId: 404, nextBracketSlot: 'bottom' },

  // ── WEST REGION — Round of 32 ────────────────────────────────────────────────
  309: { round: 'R32', region: 'WEST', slot: 1, nextBracketGameId: 405, nextBracketSlot: 'top' },
  310: { round: 'R32', region: 'WEST', slot: 2, nextBracketGameId: 405, nextBracketSlot: 'bottom' },
  311: { round: 'R32', region: 'WEST', slot: 3, nextBracketGameId: 406, nextBracketSlot: 'top' },
  312: { round: 'R32', region: 'WEST', slot: 4, nextBracketGameId: 406, nextBracketSlot: 'bottom' },

  // ── MIDWEST REGION — Round of 32 ─────────────────────────────────────────────
  313: { round: 'R32', region: 'MIDWEST', slot: 1, nextBracketGameId: 407, nextBracketSlot: 'top' },
  314: { round: 'R32', region: 'MIDWEST', slot: 2, nextBracketGameId: 407, nextBracketSlot: 'bottom' },
  315: { round: 'R32', region: 'MIDWEST', slot: 3, nextBracketGameId: 408, nextBracketSlot: 'top' },
  316: { round: 'R32', region: 'MIDWEST', slot: 4, nextBracketGameId: 408, nextBracketSlot: 'bottom' },

  // ── EAST REGION — Sweet 16 ───────────────────────────────────────────────────
  401: { round: 'S16', region: 'EAST', slot: 1, nextBracketGameId: 501, nextBracketSlot: 'top' },
  402: { round: 'S16', region: 'EAST', slot: 2, nextBracketGameId: 501, nextBracketSlot: 'bottom' },

  // ── SOUTH REGION — Sweet 16 ──────────────────────────────────────────────────
  403: { round: 'S16', region: 'SOUTH', slot: 1, nextBracketGameId: 502, nextBracketSlot: 'top' },
  404: { round: 'S16', region: 'SOUTH', slot: 2, nextBracketGameId: 502, nextBracketSlot: 'bottom' },

  // ── WEST REGION — Sweet 16 ───────────────────────────────────────────────────
  405: { round: 'S16', region: 'WEST', slot: 1, nextBracketGameId: 503, nextBracketSlot: 'top' },
  406: { round: 'S16', region: 'WEST', slot: 2, nextBracketGameId: 503, nextBracketSlot: 'bottom' },

  // ── MIDWEST REGION — Sweet 16 ────────────────────────────────────────────────
  407: { round: 'S16', region: 'MIDWEST', slot: 1, nextBracketGameId: 504, nextBracketSlot: 'top' },
  408: { round: 'S16', region: 'MIDWEST', slot: 2, nextBracketGameId: 504, nextBracketSlot: 'bottom' },

  // ── ELITE 8 ──────────────────────────────────────────────────────────────────
  501: { round: 'E8', region: 'EAST',    slot: 1, nextBracketGameId: 601, nextBracketSlot: 'top' },
  502: { round: 'E8', region: 'SOUTH',   slot: 1, nextBracketGameId: 601, nextBracketSlot: 'bottom' },
  503: { round: 'E8', region: 'WEST',    slot: 1, nextBracketGameId: 602, nextBracketSlot: 'top' },
  504: { round: 'E8', region: 'MIDWEST', slot: 1, nextBracketGameId: 602, nextBracketSlot: 'bottom' },

  // ── FINAL FOUR ───────────────────────────────────────────────────────────────
  601: { round: 'F4', region: 'FINAL_FOUR', slot: 1, nextBracketGameId: 701, nextBracketSlot: 'top' },
  602: { round: 'F4', region: 'FINAL_FOUR', slot: 2, nextBracketGameId: 701, nextBracketSlot: 'bottom' },

  // ── CHAMPIONSHIP ─────────────────────────────────────────────────────────────
  701: { round: 'CHAMPIONSHIP', region: 'FINAL_FOUR', slot: 1, nextBracketGameId: null, nextBracketSlot: null },
};

// ─── DB TEAM SLUG → BRACKET GAME ID MAPPING ──────────────────────────────────
// Maps our DB awayTeam/homeTeam slugs to the NCAA.com bracketGameId
// Format: 'away_slug@home_slug' → bracketGameId
// NOTE: DB stores games as "away @ home" — we match by the pair
const GAME_SLUG_TO_BRACKET_ID = {
  // ── FIRST FOUR ──────────────────────────────────────────────────────────────
  'umbc@howard':                  101,  // Game 101: UMBC vs Howard (Midwest 16-seed play-in)
  'texas@nc_state':               102,  // Game 102: Texas vs NC State (West 11-seed play-in)
  'prairie_view_a_and_m@lehigh':  103,  // Game 103: PV A&M vs Lehigh (South 16-seed play-in)
  'miami_oh@smu':                 104,  // Game 104: Miami OH vs SMU (South 11-seed play-in)

  // ── EAST REGION — Round of 64 ────────────────────────────────────────────────
  'siena@duke':                   201,  // (1)Duke vs (16)Siena
  'tcu@ohio_st':                  202,  // (8)Ohio St vs (9)TCU
  'n_iowa@st_johns':              203,  // (5)St.John's vs (12)Northern Iowa
  'california_baptist@kansas':    204,  // (4)Kansas vs (13)Cal Baptist
  'south_florida@louisville':     205,  // (6)Louisville vs (11)South Florida
  'n_dakota_st@michigan_st':      206,  // (3)Michigan St vs (14)North Dakota St
  'c_florida@ucla':               207,  // (7)UCLA vs (10)UCF
  'furman@connecticut':           208,  // (2)UConn vs (15)Furman

  // ── SOUTH REGION — Round of 64 ───────────────────────────────────────────────
  // Game 209: Florida vs FF-winner (PV A&M/Lehigh) — 2 possible DB slugs
  'prairie_view_a_and_m@florida': 209,  // placeholder before FF result
  'lehigh@florida':               209,  // if Lehigh wins FF game 103
  'iowa@clemson':                 210,  // (8)Clemson vs (9)Iowa
  'mcneese_st@vanderbilt':        211,  // (5)Vanderbilt vs (12)McNeese
  'troy@nebraska':                212,  // (4)Nebraska vs (13)Troy
  'va_commonwealth@north_carolina': 213, // (6)North Carolina vs (11)VCU
  'pennsylvania@illinois':        214,  // (3)Illinois vs (14)Penn
  'texas_a_and_m@st_marys':       215,  // (7)Saint Mary's vs (10)Texas A&M
  'idaho@houston':                216,  // (2)Houston vs (15)Idaho

  // ── WEST REGION — Round of 64 ────────────────────────────────────────────────
  'liu_brooklyn@arizona':         217,  // (1)Arizona vs (16)LIU
  'utah_st@villanova':            218,  // (8)Villanova vs (9)Utah St
  'high_point@wisconsin':         219,  // (5)Wisconsin vs (12)High Point
  'hawaii@arkansas':              220,  // (4)Arkansas vs (13)Hawaii
  // Game 221: BYU vs FF-winner (Texas/NC State) — 2 possible DB slugs
  'texas@brigham_young':          221,  // (6)BYU vs (11)Texas [FF winner]
  'nc_state@brigham_young':       221,  // if NC State wins FF game 102
  'kennesaw_st@gonzaga':          222,  // (3)Gonzaga vs (14)Kennesaw St
  'missouri@miami_fl':            223,  // (7)Miami FL vs (10)Missouri
  'queens_nc@purdue':             224,  // (2)Purdue vs (15)Queens NC

  // ── MIDWEST REGION — Round of 64 ─────────────────────────────────────────────
  // Game 225: Michigan vs FF-winner (UMBC/Howard) — 2 possible DB slugs
  'howard@michigan':              225,  // (1)Michigan vs (16)Howard [FF winner]
  'umbc@michigan':                225,  // if UMBC wins FF game 101
  'saint_louis@georgia':          226,  // (8)Georgia vs (9)Saint Louis
  'akron@texas_tech':             227,  // (5)Texas Tech vs (12)Akron
  'hofstra@alabama':              228,  // (4)Alabama vs (13)Hofstra
  // Game 229: Tennessee vs FF-winner (Miami OH/SMU) — 2 possible DB slugs
  'miami_oh@tennessee':           229,  // placeholder before FF result
  'smu@tennessee':                229,  // if SMU wins FF game 104
  'wright_st@virginia':           230,  // (3)Virginia vs (14)Wright St
  'santa_clara@kentucky':         231,  // (7)Kentucky vs (10)Santa Clara
  'tennessee_st@iowa_st':         232,  // (2)Iowa St vs (15)Tennessee St
};

// ─── MAIN FUNCTION ────────────────────────────────────────────────────────────
async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  console.log('='.repeat(80));
  console.log('2026 NCAA TOURNAMENT BRACKET ENGINE — FULL POPULATION');
  console.log('='.repeat(80));
  console.log(`\nBracket layout: EAST(top-left) + SOUTH(bottom-left) | WEST(top-right) + MIDWEST(bottom-right)`);
  console.log(`Final Four: Game 601 = EAST vs SOUTH | Game 602 = WEST vs MIDWEST`);
  console.log(`Championship: Game 701 = 601 winner vs 602 winner\n`);

  // Step 1: Fetch all tournament games from DB (Mar 18-20)
  const [dbGames] = await conn.execute(`
    SELECT id, awayTeam, homeTeam, gameDate, gameStatus, bracketGameId, bracketRound, bracketRegion
    FROM games
    WHERE sport = 'NCAAM' AND gameDate >= '2026-03-18' AND gameDate <= '2026-03-21'
    ORDER BY gameDate, id
  `);
  
  console.log(`Found ${dbGames.length} tournament games in DB\n`);

  // Step 2: Match each DB game to its bracket game ID
  let matched = 0;
  let alreadySet = 0;
  let unmatched = [];

  for (const game of dbGames) {
    const key = `${game.awayTeam}@${game.homeTeam}`;
    const bracketGameId = GAME_SLUG_TO_BRACKET_ID[key];
    
    if (!bracketGameId) {
      unmatched.push({ id: game.id, key, gameDate: game.gameDate });
      continue;
    }

    const bracketInfo = BRACKET_MAP[bracketGameId];
    if (!bracketInfo) {
      console.error(`  ❌ No bracket info for bracketGameId=${bracketGameId} (game ${game.id})`);
      continue;
    }

    // Check if already correctly set
    if (game.bracketGameId === bracketGameId && game.bracketRound === bracketInfo.round) {
      alreadySet++;
      console.log(`  ✓ Already set: Game ${game.id} (${key}) → bracketGameId=${bracketGameId} [${bracketInfo.round}/${bracketInfo.region}]`);
      continue;
    }

    // Update the game with bracket data
    await conn.execute(`
      UPDATE games SET
        bracketGameId = ?,
        bracketRound = ?,
        bracketRegion = ?,
        bracketSlot = ?,
        nextBracketGameId = ?,
        nextBracketSlot = ?
      WHERE id = ?
    `, [
      bracketGameId,
      bracketInfo.round,
      bracketInfo.region,
      bracketInfo.slot,
      bracketInfo.nextBracketGameId,
      bracketInfo.nextBracketSlot,
      game.id
    ]);

    matched++;
    console.log(`  ✅ Updated: Game ${game.id} (${key})`);
    console.log(`     bracketGameId=${bracketGameId} | round=${bracketInfo.round} | region=${bracketInfo.region} | slot=${bracketInfo.slot}`);
    console.log(`     next → Game ${bracketInfo.nextBracketGameId} (${bracketInfo.nextBracketSlot} slot)`);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`RESULTS: ${matched} updated | ${alreadySet} already correct | ${unmatched.length} unmatched`);
  
  if (unmatched.length > 0) {
    console.log(`\nUNMATCHED GAMES (non-tournament or need mapping):`);
    unmatched.forEach(g => console.log(`  id=${g.id} | ${g.key} | ${g.gameDate}`));
  }

  // Step 3: Verification — show all tournament games with bracket data
  const [verified] = await conn.execute(`
    SELECT id, awayTeam, homeTeam, gameDate, bracketGameId, bracketRound, bracketRegion, bracketSlot, nextBracketGameId, nextBracketSlot
    FROM games
    WHERE sport = 'NCAAM' AND gameDate >= '2026-03-18' AND gameDate <= '2026-03-21'
      AND bracketGameId IS NOT NULL
    ORDER BY bracketGameId
  `);

  console.log(`\n${'='.repeat(80)}`);
  console.log(`VERIFICATION — ${verified.length} games with bracket data:`);
  console.log(`${'='.repeat(80)}`);
  
  const byRegion = {};
  for (const g of verified) {
    const region = g.bracketRegion || 'UNKNOWN';
    if (!byRegion[region]) byRegion[region] = [];
    byRegion[region].push(g);
  }

  for (const region of ['EAST', 'WEST', 'SOUTH', 'MIDWEST', 'FINAL_FOUR', 'UNKNOWN']) {
    const games = byRegion[region];
    if (!games || games.length === 0) continue;
    console.log(`\n  [${region}]`);
    for (const g of games.sort((a, b) => a.bracketGameId - b.bracketGameId)) {
      const next = g.nextBracketGameId ? `→ Game ${g.nextBracketGameId} (${g.nextBracketSlot})` : '→ CHAMPION';
      console.log(`    Game ${String(g.bracketGameId).padEnd(3)} [${g.bracketRound}] slot=${g.bracketSlot}: ${g.awayTeam} @ ${g.homeTeam} ${next}`);
    }
  }

  // Step 4: Print the complete bracket progression tree
  console.log(`\n${'='.repeat(80)}`);
  console.log('COMPLETE BRACKET PROGRESSION TREE (all 67 games):');
  console.log(`${'='.repeat(80)}`);
  
  for (const [gid, info] of Object.entries(BRACKET_MAP).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const next = info.nextBracketGameId ? `→ Game ${info.nextBracketGameId} (${info.nextBracketSlot})` : '→ CHAMPION';
    console.log(`  Game ${String(gid).padEnd(3)} [${info.round.padEnd(12)}] ${info.region.padEnd(10)} slot=${info.slot} ${next}`);
  }

  await conn.end();
  console.log('\n✅ Bracket engine population complete!');
}

main().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
