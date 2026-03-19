/**
 * MarchMadnessBracket.tsx — 2026 NCAA Tournament Bracket
 *
 * Architecture:
 *   - CSS-based connectors (border lines on pair-wrappers) — pixel-perfect, layout-driven
 *   - No SVG / getBoundingClientRect — eliminates paint-timing bugs
 *   - Each "pair" of matchups is wrapped in a .bracket-pair div that draws the
 *     right-side bracket arm via ::before / ::after pseudo-elements
 *   - Gap between matchups doubles each round (standard bracket geometry)
 *
 * Layout:
 *   LEFT  side: EAST (top) + SOUTH (bottom)
 *   RIGHT side: WEST (top, RTL) + MIDWEST (bottom, RTL)
 *   CENTER: Final Four + Championship
 *
 * Debugging:
 *   - console.group logs per region with round counts and game IDs
 *   - console.warn for any missing game IDs or slug resolution failures
 */
import React, { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { NCAAM_TEAMS } from "@shared/ncaamTeams";

// ─── Team registry ────────────────────────────────────────────────────────────
const TEAM_BY_SLUG = new Map(NCAAM_TEAMS.map(t => [t.dbSlug, t]));

// ─── Seed map ─────────────────────────────────────────────────────────────────
const SEED_MAP: Record<number, { away: number; home: number }> = {
  // First Four
  101: { away: 16, home: 16 },
  102: { away: 11, home: 11 },
  103: { away: 16, home: 16 },
  104: { away: 11, home: 11 },
  // EAST R64
  201: { away: 16, home: 1  }, 202: { away: 9,  home: 8  },
  203: { away: 12, home: 5  }, 204: { away: 13, home: 4  },
  205: { away: 11, home: 6  }, 206: { away: 14, home: 3  },
  207: { away: 10, home: 7  }, 208: { away: 15, home: 2  },
  // SOUTH R64
  209: { away: 16, home: 1  }, 210: { away: 9,  home: 8  },
  211: { away: 12, home: 5  }, 212: { away: 13, home: 4  },
  213: { away: 11, home: 6  }, 214: { away: 14, home: 3  },
  215: { away: 10, home: 7  }, 216: { away: 15, home: 2  },
  // WEST R64
  217: { away: 16, home: 1  }, 218: { away: 9,  home: 8  },
  219: { away: 12, home: 5  }, 220: { away: 13, home: 4  },
  221: { away: 11, home: 6  }, 222: { away: 14, home: 3  },
  223: { away: 10, home: 7  }, 224: { away: 15, home: 2  },
  // MIDWEST R64
  225: { away: 16, home: 1  }, 226: { away: 9,  home: 8  },
  227: { away: 12, home: 5  }, 228: { away: 13, home: 4  },
  229: { away: 11, home: 6  }, 230: { away: 14, home: 3  },
  231: { away: 10, home: 7  }, 232: { away: 15, home: 2  },
};

// ─── Slug aliases (DB slug → ncaamTeams dbSlug) ───────────────────────────────
const SLUG_ALIAS: Record<string, string> = {
  'north_carolina_st': 'nc_state',
  's_florida': 'south_florida',
  'north_dakota_st': 'n_dakota_st',
  'vcu': 'va_commonwealth',
  'penn': 'pennsylvania',
  'texas_am': 'texas_a_and_m',
  'saint_marys': 'st_marys',
  'liu': 'liu_brooklyn',
  'byu': 'brigham_young',
};
function resolveSlug(slug: string): string {
  return SLUG_ALIAS[slug] ?? slug;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface BracketGame {
  id: number;
  awayTeam: string;
  homeTeam: string;
  gameDate: string;
  startTimeEst: string;
  gameStatus: string;
  awayScore: number | null;
  homeScore: number | null;
  bracketGameId: number;
  bracketRound: string;
  bracketRegion: string;
  bracketSlot: number;
  nextBracketGameId: number | null;
  nextBracketSlot: string | null;
  awayBookSpread: string | null;
  homeBookSpread: string | null;
  bookTotal: string | null;
  awayML: string | null;
  homeML: string | null;
  awayModelSpread: string | null;
  homeModelSpread: string | null;
  modelTotal: string | null;
  modelAwayWinPct: string | null;
  modelHomeWinPct: string | null;
  publishedToFeed: boolean;
  publishedModel: boolean;
}

interface TeamSlot {
  slug: string;
  seed: number;
  isWinner: boolean | null;
}

interface MatchupData {
  bracketGameId: number;
  top: TeamSlot;
  bottom: TeamSlot;
  gameStatus: string;
  topScore: number | null;
  bottomScore: number | null;
  startTimeEst: string;
  isTbd: boolean;
}

// ─── Build bracket structure ──────────────────────────────────────────────────
function buildBracketStructure(games: BracketGame[]) {
  const byId = new Map<number, BracketGame>();
  for (const g of games) byId.set(g.bracketGameId, g);

  function makeTeamSlot(slug: string, seed: number, game: BracketGame, isAway: boolean): TeamSlot {
    let isWinner: boolean | null = null;
    if (game.gameStatus === 'final' && game.awayScore !== null && game.homeScore !== null) {
      const awayWon = game.awayScore > game.homeScore;
      isWinner = isAway ? awayWon : !awayWon;
    }
    return { slug, seed, isWinner };
  }

  function makeMatchup(bracketGameId: number): MatchupData | null {
    const g = byId.get(bracketGameId);
    if (!g) {
      console.warn(`[Bracket] Missing game ID: ${bracketGameId}`);
      return null;
    }
    const seeds = SEED_MAP[bracketGameId] ?? { away: 0, home: 0 };
    const awaySlug = resolveSlug(g.awayTeam);
    const homeSlug = resolveSlug(g.homeTeam);

    if (!TEAM_BY_SLUG.has(awaySlug) && !awaySlug.startsWith('tbd_')) {
      console.warn(`[Bracket] Unknown away slug: "${awaySlug}" (raw: "${g.awayTeam}") in game ${bracketGameId}`);
    }
    if (!TEAM_BY_SLUG.has(homeSlug) && !homeSlug.startsWith('tbd_')) {
      console.warn(`[Bracket] Unknown home slug: "${homeSlug}" (raw: "${g.homeTeam}") in game ${bracketGameId}`);
    }

    const awayIsTop = seeds.away <= seeds.home;
    const topSlug  = awayIsTop ? awaySlug  : homeSlug;
    const botSlug  = awayIsTop ? homeSlug  : awaySlug;
    const topSeed  = awayIsTop ? seeds.away : seeds.home;
    const botSeed  = awayIsTop ? seeds.home : seeds.away;
    const topIsAway = awayIsTop;

    const topSlot = makeTeamSlot(topSlug, topSeed, g, topIsAway);
    const botSlot = makeTeamSlot(botSlug, botSeed, g, !topIsAway);
    const topScore = topIsAway ? g.awayScore : g.homeScore;
    const botScore = topIsAway ? g.homeScore : g.awayScore;

    const isTbd = (awaySlug.startsWith('tbd_') || awaySlug === 'tbd') &&
                  (homeSlug.startsWith('tbd_') || homeSlug === 'tbd');

    return {
      bracketGameId,
      top: topSlot,
      bottom: botSlot,
      gameStatus: g.gameStatus,
      topScore,
      bottomScore: botScore,
      startTimeEst: g.startTimeEst,
      isTbd,
    };
  }

  const REGION_IDS = {
    EAST:    { r64: [201,202,203,204,205,206,207,208], r32: [301,302,303,304], s16: [401,402], e8: [501] },
    SOUTH:   { r64: [209,210,211,212,213,214,215,216], r32: [305,306,307,308], s16: [403,404], e8: [502] },
    WEST:    { r64: [217,218,219,220,221,222,223,224], r32: [309,310,311,312], s16: [405,406], e8: [503] },
    MIDWEST: { r64: [225,226,227,228,229,230,231,232], r32: [313,314,315,316], s16: [407,408], e8: [504] },
  };

  type RegionKey = keyof typeof REGION_IDS;

  function getMatchups(ids: number[]) {
    return ids.map(id => makeMatchup(id));
  }

  // Deep debug logging
  console.group('[Bracket] buildBracketStructure');
  console.log(`Total games loaded: ${games.length}`);
  for (const [region, ids] of Object.entries(REGION_IDS)) {
    const allIds = [...ids.r64, ...ids.r32, ...ids.s16, ...ids.e8];
    const found = allIds.filter(id => byId.has(id));
    const missing = allIds.filter(id => !byId.has(id));
    console.log(`${region}: ${found.length}/${allIds.length} games found${missing.length ? ` | MISSING: ${missing.join(',')}` : ''}`);
  }
  const ffIds = [601, 602, 701];
  const ffFound = ffIds.filter(id => byId.has(id));
  console.log(`Final Four/Champ: ${ffFound.length}/${ffIds.length} games found`);
  console.groupEnd();

  return {
    regions: Object.fromEntries(
      Object.entries(REGION_IDS).map(([key, val]) => [
        key,
        {
          r64: getMatchups(val.r64),
          r32: getMatchups(val.r32),
          s16: getMatchups(val.s16),
          e8:  getMatchups(val.e8),
        },
      ])
    ) as Record<RegionKey, { r64: (MatchupData|null)[]; r32: (MatchupData|null)[]; s16: (MatchupData|null)[]; e8: (MatchupData|null)[] }>,
    ff: getMatchups([601, 602]),
    champ: getMatchups([701]),
    firstFour: [101, 102, 103, 104].map(id => makeMatchup(id)),
  };
}

// ─── TeamStrip ────────────────────────────────────────────────────────────────
function TeamStrip({ slug, seed, isWinner, score }: {
  slug: string;
  seed: number;
  isWinner: boolean | null;
  score?: number | null;
}) {
  const isPlaceholder = slug.startsWith('tbd_') || slug === 'tbd';
  const team = isPlaceholder ? null : TEAM_BY_SLUG.get(slug);
  const color = isPlaceholder ? '#0e0e14' : (team?.primaryColor ?? '#1a1a2e');
  const displayName = isPlaceholder ? '' : (team ? team.ncaaName : slug.replace(/_/g, ' ').toUpperCase());
  const logoUrl = isPlaceholder ? null : (team?.logoUrl ?? null);
  const stateClass = isWinner === true ? 'strip-winner' : isWinner === false ? 'strip-loser' : '';
  const hasScore = !isPlaceholder && score !== undefined && score !== null;

  return (
    <div
      className={`bracket-strip ${stateClass}`}
      style={{ background: color }}
      title={displayName || 'TBD'}
    >
      <div className="strip-sheen" />
      <div className="strip-shadow" />

      {!isPlaceholder && (
        <div className="strip-logo-left">
          <div className="logo-circle">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={displayName}
                width={20}
                height={20}
                style={{ objectFit: 'contain', display: 'block' }}
                onError={(e) => {
                  const el = e.currentTarget;
                  el.style.display = 'none';
                  if (el.parentElement) {
                    el.parentElement.innerHTML = `<span style="font-size:6px;font-weight:900;color:#fff;letter-spacing:-0.5px">${displayName.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase()}</span>`;
                  }
                }}
              />
            ) : (
              <span style={{ fontSize: 6, fontWeight: 900, color: '#fff', letterSpacing: -0.5 }}>
                {displayName.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase()}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="strip-center">
        {!isPlaceholder && seed > 0 && (
          <span className="strip-seed">{seed}</span>
        )}
        {!isPlaceholder && (
          <span className="strip-name">{displayName}</span>
        )}
      </div>

      {hasScore && (
        <div className="strip-score-right">
          <span className="strip-score-val">{score}</span>
        </div>
      )}
    </div>
  );
}

// ─── Matchup ──────────────────────────────────────────────────────────────────
function Matchup({ data, size = 'normal' }: {
  data: MatchupData | null;
  size?: 'normal' | 'champ';
}) {
  if (!data) {
    return (
      <div className={`bracket-matchup bracket-matchup-${size}`}>
        <div className="bracket-strip strip-placeholder"><div className="strip-sheen" /></div>
        <div className="matchup-divider" />
        <div className="bracket-strip strip-placeholder"><div className="strip-sheen" /></div>
      </div>
    );
  }

  const isFinal = data.gameStatus === 'final';
  const isLive  = data.gameStatus === 'live';
  const isUpcoming = !isFinal && !isLive;

  let statusLabel: React.ReactNode = null;
  if (isLive) {
    statusLabel = <div className="matchup-status status-live">● LIVE</div>;
  } else if (isFinal) {
    statusLabel = <div className="matchup-status status-final">FINAL</div>;
  } else if (isUpcoming && !data.isTbd && data.startTimeEst && data.startTimeEst !== 'TBD') {
    statusLabel = <div className="matchup-status status-time">{data.startTimeEst} EST</div>;
  }

  return (
    <div className="matchup-wrap">
      {statusLabel}
      <div className={`bracket-matchup bracket-matchup-${size}`}>
        <TeamStrip
          slug={data.top.slug}
          seed={data.top.seed}
          isWinner={isFinal ? data.top.isWinner : null}
          score={isFinal || isLive ? data.topScore : undefined}
        />
        <div className="matchup-divider" />
        <TeamStrip
          slug={data.bottom.slug}
          seed={data.bottom.seed}
          isWinner={isFinal ? data.bottom.isWinner : null}
          score={isFinal || isLive ? data.bottomScore : undefined}
        />
      </div>
    </div>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────
// MATCHUP_H = height of one matchup card (2 strips × 32px + 1px divider + ~16px status label)
// We use CSS variables so the connector math is always in sync with actual rendered height.
// Strip height: 32px × 2 + 1px divider = 65px card body
// Status label: ~16px (but we account for it in the pair-wrapper padding)
const STRIP_H = 32;   // px — must match .bracket-strip min-height in CSS
const DIVIDER_H = 1;  // px
const STATUS_H = 16;  // px — reserved for status label above each matchup
const CARD_H = STRIP_H * 2 + DIVIDER_H; // 65px
const MATCHUP_TOTAL_H = STATUS_H + CARD_H; // 81px — total vertical space per matchup slot

// Gap between matchup slots in R64 (no gap — they're packed)
// Gap doubles each round: R32 = 1 matchup height, S16 = 3, E8 = 7
// These gaps are between the BOTTOM of one matchup slot and the TOP of the next
const COL_W = 180; // px — matchup card width
const COL_GAP = 24; // px — horizontal gap between round columns

// ─── BracketRound: one column of matchups ────────────────────────────────────
function BracketRound({ matchups, direction }: {
  matchups: (MatchupData | null)[];
  direction: 'ltr' | 'rtl';
}) {
  // For LTR: matchups are in natural order (top to bottom)
  // For RTL: same — the column order is reversed at the RegionBracket level
  return (
    <div className="round-col" style={{ width: COL_W }}>
      {matchups.map((m, i) => (
        <Matchup key={m?.bracketGameId ?? `tbd-${i}`} data={m} />
      ))}
    </div>
  );
}

// ─── ConnectorColumn: draws the bracket arm between two rounds ────────────────
// Uses CSS borders on pair-wrappers to draw the classic bracket bracket arm:
//   top matchup  ──┐
//                  ├── next round slot
//   bot matchup  ──┘
//
// The pair-wrapper height = 2 × MATCHUP_TOTAL_H + inter-pair-gap
// The connector arm is drawn via border-right + ::before/::after on the pair-wrapper.
function ConnectorColumn({ pairCount, pairH, slotH, direction }: {
  pairCount: number;    // number of pairs (= nextRound.length)
  pairH: number;        // height of each pair wrapper in px (= 2 x slotH)
  slotH: number;        // height each feeder matchup occupies (center = slotH/2)
  direction: 'ltr' | 'rtl';
}) {
  const connW = COL_GAP;
  // Guard against NaN/0 values (defensive programming)
  const safePairH = pairH > 0 ? pairH : 1;
  const safeSlotH = slotH > 0 ? slotH : 1;
  // Center of top feeder matchup = slotH/2 from top of pair
  const topTickY = safeSlotH / 2;
  // Center of bottom feeder matchup = pairH - slotH/2 from top of pair
  const botTickY = safePairH - safeSlotH / 2;
  // Midpoint between the two ticks = where the arm to next round exits
  const midY = safePairH / 2;
  return (
    <div style={{
      width: connW,
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      position: 'relative',
    }}>
      {Array.from({ length: pairCount }).map((_, i) => (
        <div
          key={i}
          style={{
            height: safePairH,
            position: 'relative',
            flexShrink: 0,
          }}
        >
          {/* Vertical bracket arm: from center of top feeder to center of bottom feeder */}
          <div style={{
            position: 'absolute',
            top: topTickY,
            bottom: safePairH - botTickY,
            [direction === 'ltr' ? 'left' : 'right']: 0,
            width: 0,
            borderLeft: direction === 'ltr' ? '1.5px solid rgba(255,255,255,.38)' : 'none',
            borderRight: direction === 'rtl' ? '1.5px solid rgba(255,255,255,.38)' : 'none',
          }} />
          {/* Top horizontal tick */}
          <div style={{
            position: 'absolute',
            top: topTickY,
            [direction === 'ltr' ? 'left' : 'right']: 0,
            width: connW / 2,
            height: 0,
            borderTop: '1.5px solid rgba(255,255,255,.38)',
          }} />
          {/* Bottom horizontal tick */}
          <div style={{
            position: 'absolute',
            top: botTickY,
            [direction === 'ltr' ? 'left' : 'right']: 0,
            width: connW / 2,
            height: 0,
            borderTop: '1.5px solid rgba(255,255,255,.38)',
          }} />
          {/* Center horizontal arm to next round slot */}
          <div style={{
            position: 'absolute',
            top: midY,
            [direction === 'ltr' ? 'left' : 'right']: connW / 2,
            width: connW / 2,
            height: 0,
            borderTop: '1.5px solid rgba(255,255,255,.38)',
          }} />
        </div>
      ))}
    </div>
  );
}

// ─── RegionBracket ────────────────────────────────────────────────────────────
// Renders one region: 4 rounds (R64, R32, S16, E8) with connectors between each.
// LTR: R64 → R32 → S16 → E8  (left side: EAST, SOUTH)
// RTL: E8 → S16 → R32 → R64  (right side: WEST, MIDWEST)
function RegionBracket({ region, data, direction }: {
  region: string;
  data: { r64: (MatchupData|null)[]; r32: (MatchupData|null)[]; s16: (MatchupData|null)[]; e8: (MatchupData|null)[] };
  direction: 'ltr' | 'rtl';
}) {
  // Debug log
  console.group(`[Bracket] RegionBracket: ${region} (${direction})`);
  console.log(`R64: ${data.r64.length} games | R32: ${data.r32.length} | S16: ${data.s16.length} | E8: ${data.e8.length}`);
  const missingR64 = data.r64.filter(m => !m).length;
  const missingR32 = data.r32.filter(m => !m).length;
  if (missingR64 > 0) console.warn(`  R64 missing ${missingR64} games`);
  if (missingR32 > 0) console.warn(`  R32 missing ${missingR32} games`);
  console.groupEnd();

  // Pair heights for each transition:
  // R64→R32: each R32 game covers 2 R64 games. Pair height = 2 × MATCHUP_TOTAL_H
  // R32→S16: each S16 game covers 2 R32 games. Pair height = 2 × (2 × MATCHUP_TOTAL_H) = 4 × MATCHUP_TOTAL_H
  // S16→E8:  each E8 game covers 2 S16 games. Pair height = 2 × (4 × MATCHUP_TOTAL_H) = 8 × MATCHUP_TOTAL_H
  const pairH_r64_r32 = 2 * MATCHUP_TOTAL_H;
  const pairH_r32_s16 = 4 * MATCHUP_TOTAL_H;
  const pairH_s16_e8  = 8 * MATCHUP_TOTAL_H;

  // Column order depends on direction
  // LTR: [R64, conn, R32, conn, S16, conn, E8]
  // RTL: [E8, conn, S16, conn, R32, conn, R64]
  const rounds = direction === 'ltr'
    ? [data.r64, data.r32, data.s16, data.e8]
    : [data.e8, data.s16, data.r32, data.r64];
  const roundLabels = direction === 'ltr'
    ? ['R64', 'R32', 'S16', 'E8']
    : ['E8', 'S16', 'R32', 'R64'];
  // Connector pair heights in column order
  const connPairHeights = direction === 'ltr'
    ? [pairH_r64_r32, pairH_r32_s16, pairH_s16_e8]
    : [pairH_s16_e8, pairH_r32_s16, pairH_r64_r32];
  // Pair counts (= number of matchups in the NEXT round)
  const connPairCounts = direction === 'ltr'
    ? [data.r32.length, data.s16.length, data.e8.length]
    : [data.s16.length, data.r32.length, data.r64.length];
  // slotH = height each FEEDER matchup occupies in the column to the left of the connector
  // R64 matchups each occupy MATCHUP_TOTAL_H; R32 occupy 2×; S16 occupy 4×
  const connSlotHeights = direction === 'ltr'
    ? [MATCHUP_TOTAL_H, pairH_r64_r32, pairH_r32_s16]
    : [pairH_r32_s16, pairH_r64_r32, MATCHUP_TOTAL_H];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: direction === 'rtl' ? 'flex-end' : 'flex-start' }}>
      {/* Region label */}
      <div style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: 'rgba(255,165,50,.7)',
        marginBottom: 4,
        paddingLeft: direction === 'rtl' ? 0 : 0,
        alignSelf: 'flex-start',
        marginLeft: direction === 'rtl' ? 'auto' : 0,
      }}>
        {region}
      </div>

      {/* Round header labels */}
      <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 6 }}>
        {roundLabels.map((label, i) => (
          <React.Fragment key={label}>
            <div style={{
              width: COL_W,
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,.28)',
              paddingBottom: 4,
              borderBottom: '1px solid rgba(255,255,255,.09)',
              textAlign: 'center',
            }}>
              {label}
            </div>
            {i < 3 && <div style={{ width: COL_GAP }} />}
          </React.Fragment>
        ))}
      </div>

      {/* Bracket columns + connectors */}
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        {rounds.map((matchups, ri) => (
          <React.Fragment key={ri}>
            <BracketRound matchups={matchups} direction={direction} />
            {ri < 3 && (
              <ConnectorColumn
                pairCount={connPairCounts[ri]}
                pairH={connPairHeights[ri]}
                slotH={connSlotHeights[ri]}
                direction={direction}
              />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ─── FinalFourSection ─────────────────────────────────────────────────────────
function FinalFourSection({ ff, champ }: {
  ff: (MatchupData | null)[];
  champ: (MatchupData | null)[];
}) {
  const champGame = champ[0];
  const champTeam = useMemo(() => {
    if (!champGame || champGame.gameStatus !== 'final') return null;
    if (champGame.topScore === null || champGame.bottomScore === null) return null;
    return champGame.topScore > champGame.bottomScore ? champGame.top.slug : champGame.bottom.slug;
  }, [champGame]);

  const champTeamData = champTeam ? TEAM_BY_SLUG.get(champTeam) : null;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 0,
      minWidth: 220,
      paddingTop: MATCHUP_TOTAL_H * 3, // vertically center with E8 games
    }}>
      {/* F4 label */}
      <div style={{
        fontSize: 8.5, fontWeight: 700, letterSpacing: '0.2em',
        textTransform: 'uppercase', color: 'rgba(255,255,255,.28)',
        paddingBottom: 4, borderBottom: '1px solid rgba(255,255,255,.09)',
        width: COL_W, textAlign: 'center', marginBottom: 6,
      }}>
        FINAL FOUR
      </div>

      {/* F4 Game 601: EAST vs SOUTH */}
      <div style={{ marginBottom: MATCHUP_TOTAL_H * 2 }}>
        <div style={{ fontSize: 7.5, color: 'rgba(255,165,50,.6)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 4, textAlign: 'center' }}>
          EAST · SOUTH
        </div>
        <Matchup data={ff[0]} />
      </div>

      {/* Championship */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,165,50,.7)' }}>
          CHAMPIONSHIP
        </div>
        <div style={{ fontSize: 22, lineHeight: 1 }}>🏆</div>
        <Matchup data={champGame ?? null} size="champ" />
        {champTeam && (
          <div style={{ marginTop: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: 'rgba(255,165,50,.7)', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 4 }}>2026 CHAMPION</div>
            <div style={{ fontSize: 14, fontWeight: 900, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {champTeamData?.ncaaName ?? champTeam.replace(/_/g, ' ').toUpperCase()}
            </div>
          </div>
        )}
      </div>

      {/* F4 Game 602: WEST vs MIDWEST */}
      <div style={{ marginTop: MATCHUP_TOTAL_H * 2 }}>
        <div style={{ fontSize: 7.5, color: 'rgba(255,165,50,.6)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 4, textAlign: 'center' }}>
          WEST · MIDWEST
        </div>
        <Matchup data={ff[1]} />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function MarchMadnessBracket() {
  const { data: result, isLoading, error } = trpc.bracket.getGames.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const bracket = useMemo(() => {
    if (!result?.games) return null;
    console.log(`[Bracket] Received ${result.games.length} games from API`);
    return buildBracketStructure(result.games as unknown as BracketGame[]);
  }, [result]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'rgba(255,255,255,.5)', fontSize: 14 }}>
        Loading bracket…
      </div>
    );
  }
  if (error || !bracket) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#f87171', fontSize: 14 }}>
        Failed to load bracket data.
      </div>
    );
  }

  return (
    <div className="bracket-root">
      <style>{`
        .bracket-root {
          background: #0d0d0f;
          padding: 24px 16px;
          overflow-x: auto;
          overflow-y: auto;
          min-height: 600px;
          font-family: 'Inter', 'Helvetica Neue', sans-serif;
        }

        /* ── Matchup card ── */
        .bracket-matchup {
          display: flex;
          flex-direction: column;
          background: #000;
          border: 1.5px solid #2a2a2a;
          border-radius: 3px;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0,0,0,.7), inset 0 0 0 1px rgba(255,255,255,.04);
          width: ${COL_W}px;
        }
        .bracket-matchup-champ {
          border-color: rgba(255,185,50,.5);
          box-shadow: 0 0 18px rgba(255,120,20,.3), 0 2px 8px rgba(0,0,0,.7);
        }
        .matchup-divider {
          height: ${DIVIDER_H}px;
          background: #000;
          flex-shrink: 0;
        }

        /* ── Matchup wrapper (includes status label) ── */
        .matchup-wrap {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          min-height: ${MATCHUP_TOTAL_H}px;
        }
        .matchup-status {
          height: ${STATUS_H}px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .status-live  { color: #4ade80; text-shadow: 0 0 6px rgba(74,222,128,.6); }
        .status-final { color: rgba(255,255,255,.5); }
        .status-time  { color: rgba(255,255,255,.38); font-weight: 600; }

        /* ── Round column ── */
        .round-col {
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
        }

        /* ── Team strip ── */
        .bracket-strip {
          position: relative;
          width: 100%;
          height: ${STRIP_H}px;
          display: flex;
          align-items: center;
          overflow: hidden;
          cursor: pointer;
          transition: filter .12s;
          flex-shrink: 0;
        }
        .bracket-strip:hover { filter: brightness(1.15); z-index: 10; }
        .strip-placeholder { background: #0e0e14 !important; }
        .strip-winner { box-shadow: inset 0 0 0 1.5px rgba(255,200,80,.45); }
        .strip-loser  { filter: brightness(.55) saturate(.6); }

        .strip-sheen {
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, rgba(255,255,255,.22) 0%, rgba(255,255,255,.06) 30%, rgba(0,0,0,.18) 100%);
          z-index: 2;
          pointer-events: none;
        }
        .strip-shadow {
          position: absolute;
          bottom: 0; left: 0; right: 0;
          height: 1px;
          background: rgba(0,0,0,.4);
          z-index: 3;
        }
        .strip-logo-left {
          position: absolute;
          left: 4px;
          top: 50%;
          transform: translateY(-50%);
          z-index: 4;
          width: 28px;
          height: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .logo-circle {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: rgba(255,255,255,.15);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }
        .strip-center {
          position: relative;
          z-index: 4;
          display: flex;
          align-items: center;
          gap: 3px;
          flex: 1;
          min-width: 0;
          padding-left: 36px;
          padding-right: 36px;
        }
        .strip-seed {
          font-size: 9px;
          font-weight: 800;
          min-width: 10px;
          text-align: right;
          line-height: 1;
          color: rgba(255,255,255,.6);
          text-shadow: 0 1px 3px rgba(0,0,0,.8);
          flex-shrink: 0;
        }
        .strip-name {
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          text-shadow: 0 1px 4px rgba(0,0,0,.9);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.1;
          color: #fff;
        }
        .strip-score-right {
          position: absolute;
          right: 6px;
          top: 50%;
          transform: translateY(-50%);
          z-index: 4;
          min-width: 24px;
          text-align: right;
        }
        .strip-score-val {
          font-size: 13px;
          font-weight: 900;
          color: #fff;
          text-shadow: 0 1px 4px rgba(0,0,0,.9);
        }

        /* ── Bracket layout ── */
        .bracket-layout {
          display: flex;
          align-items: flex-start;
          gap: 16px;
          min-width: max-content;
        }
        .bracket-half {
          display: flex;
          flex-direction: column;
          gap: 32px;
        }
      `}</style>

      {/* Title */}
      <div style={{
        textAlign: 'center',
        marginBottom: 20,
        fontSize: 13,
        fontWeight: 800,
        letterSpacing: '0.25em',
        textTransform: 'uppercase',
        color: 'rgba(255,165,50,.85)',
      }}>
        2026 NCAA TOURNAMENT BRACKET
      </div>

      {/* Main bracket layout */}
      <div className="bracket-layout">
        {/* LEFT HALF: EAST + SOUTH */}
        <div className="bracket-half">
          <RegionBracket region="EAST"  data={bracket.regions.EAST}  direction="ltr" />
          <RegionBracket region="SOUTH" data={bracket.regions.SOUTH} direction="ltr" />
        </div>

        {/* CENTER: Final Four + Championship */}
        <FinalFourSection ff={bracket.ff} champ={bracket.champ} />

        {/* RIGHT HALF: WEST + MIDWEST (RTL) */}
        <div className="bracket-half">
          <RegionBracket region="WEST"    data={bracket.regions.WEST}    direction="rtl" />
          <RegionBracket region="MIDWEST" data={bracket.regions.MIDWEST} direction="rtl" />
        </div>
      </div>
    </div>
  );
}
