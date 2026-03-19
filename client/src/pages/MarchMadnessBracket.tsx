/**
 * MarchMadnessBracket.tsx
 *
 * Full interactive 2026 March Madness bracket.
 *
 * Layout (as confirmed):
 *   LEFT  side: EAST (top) + SOUTH (bottom)
 *   RIGHT side: WEST (top) + MIDWEST (bottom)
 *
 * Visual design mirrors bracket-v2.html:
 *   - Dark #0d0d0f background with fire radial gradients
 *   - Team color strips with laminate sheen
 *   - SVG connector lines between rounds
 *   - Winner (gold border) / Loser (dimmed) states
 *   - Seed number + team abbreviation + team name
 *   - Animated ember particles
 */

import React, { useEffect, useRef, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { NCAAM_TEAMS } from "@shared/ncaamTeams";

// ─── Team registry lookup ─────────────────────────────────────────────────────
const TEAM_BY_SLUG = new Map(NCAAM_TEAMS.map(t => [t.dbSlug, t]));

// ─── Seed map: bracketGameId → { awaySlug: seed, homeSlug: seed } ─────────────
// Derived from the official 2026 bracket
const SEED_MAP: Record<number, { away: number; home: number }> = {
  // First Four
  101: { away: 16, home: 16 }, // UMBC vs Howard (MIDWEST 16-seed)
  102: { away: 11, home: 11 }, // Texas vs NC State (WEST 11-seed)
  103: { away: 16, home: 16 }, // PV A&M vs Lehigh (SOUTH 16-seed)
  104: { away: 11, home: 11 }, // Miami OH vs SMU (MIDWEST 11-seed)
  // EAST R64
  201: { away: 16, home: 1  }, // Siena @ Duke
  202: { away: 9,  home: 8  }, // TCU @ Ohio St
  203: { away: 12, home: 5  }, // N.Iowa @ St.John's
  204: { away: 13, home: 4  }, // Cal Baptist @ Kansas
  205: { away: 11, home: 6  }, // S.Florida @ Louisville
  206: { away: 14, home: 3  }, // NDSU @ Michigan St
  207: { away: 10, home: 7  }, // UCF @ UCLA
  208: { away: 15, home: 2  }, // Furman @ UConn
  // SOUTH R64
  209: { away: 16, home: 1  }, // FF winner @ Florida
  210: { away: 9,  home: 8  }, // Iowa @ Clemson
  211: { away: 12, home: 5  }, // McNeese @ Vanderbilt
  212: { away: 13, home: 4  }, // Troy @ Nebraska
  213: { away: 11, home: 6  }, // VCU @ N.Carolina
  214: { away: 14, home: 3  }, // Penn @ Illinois
  215: { away: 10, home: 7  }, // Tex A&M @ St.Mary's
  216: { away: 15, home: 2  }, // Idaho @ Houston
  // WEST R64
  217: { away: 16, home: 1  }, // LIU @ Arizona
  218: { away: 9,  home: 8  }, // Utah St @ Villanova
  219: { away: 12, home: 5  }, // High Point @ Wisconsin
  220: { away: 13, home: 4  }, // Hawaii @ Arkansas
  221: { away: 11, home: 6  }, // Texas[FF] @ BYU
  222: { away: 14, home: 3  }, // Kennesaw @ Gonzaga
  223: { away: 10, home: 7  }, // Missouri @ Miami FL
  224: { away: 15, home: 2  }, // Queens NC @ Purdue
  // MIDWEST R64
  225: { away: 16, home: 1  }, // Howard[FF] @ Michigan
  226: { away: 9,  home: 8  }, // St.Louis @ Georgia
  227: { away: 12, home: 5  }, // Akron @ Texas Tech
  228: { away: 13, home: 4  }, // Hofstra @ Alabama
  229: { away: 11, home: 6  }, // Miami OH[FF] @ Tennessee
  230: { away: 14, home: 3  }, // Wright St @ Virginia
  231: { away: 10, home: 7  }, // Santa Clara @ Kentucky
  232: { away: 15, home: 2  }, // Tenn St @ Iowa St
};

// ─── Color helpers ────────────────────────────────────────────────────────────
function hexToRgb(h: string): [number, number, number] {
  const hex = h.replace('#', '');
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// All text is ALWAYS white — no black text allowed on bracket
function textColor(_hex: string): string {
  return '#fff';
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
  isWinner: boolean | null; // true=won, false=lost, null=TBD
}

interface MatchupData {
  bracketGameId: number;
  top: TeamSlot;
  bottom: TeamSlot;
  gameStatus: string;
  awayScore: number | null;
  homeScore: number | null;
  startTimeEst: string;
  gameDate: string;
  spread: string | null;
  total: string | null;
}

// ─── Build bracket structure from flat game list ──────────────────────────────
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

  // Slug alias: DB slug → ncaamTeams dbSlug for teams whose DB slug differs
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

  function makeMatchup(bracketGameId: number): MatchupData | null {
    const g = byId.get(bracketGameId);
    if (!g) return null;
    const seeds = SEED_MAP[bracketGameId] ?? { away: 0, home: 0 };
    // Resolve any slug aliases so TEAM_BY_SLUG lookup works
    const awaySlug = resolveSlug(g.awayTeam);
    const homeSlug = resolveSlug(g.homeTeam);
    const awaySeed = seeds.away;
    const homeSeed = seeds.home;
    // Always put LOWER seed number on top (seed 1 = top, seed 16 = bottom)
    // For First Four games both seeds are equal — keep away on top
    const awayIsTop = awaySeed <= homeSeed;
    const topSlug  = awayIsTop ? awaySlug  : homeSlug;
    const botSlug  = awayIsTop ? homeSlug  : awaySlug;
    const topSeed  = awayIsTop ? awaySeed  : homeSeed;
    const botSeed  = awayIsTop ? homeSeed  : awaySeed;
    const topIsAway = awayIsTop;
    const topSlot = makeTeamSlot(topSlug, topSeed, g, topIsAway);
    const botSlot = makeTeamSlot(botSlug, botSeed, g, !topIsAway);
    // Scores follow the top/bottom assignment
    const topScore = topIsAway ? g.awayScore : g.homeScore;
    const botScore = topIsAway ? g.homeScore : g.awayScore;
    return {
      bracketGameId,
      top: topSlot,
      bottom: botSlot,
      gameStatus: g.gameStatus,
      awayScore: topScore,
      homeScore: botScore,
      startTimeEst: g.startTimeEst,
      gameDate: g.gameDate,
      spread: g.awayBookSpread || g.homeBookSpread || null,
      total: g.bookTotal || null,
    };
  }

  // Build per-region round arrays
  // Each region: R64 (8 games), R32 (4 games), S16 (2 games), E8 (1 game)
  const regions = {
    EAST:    { r64: [201,202,203,204,205,206,207,208], r32: [301,302,303,304], s16: [401,402], e8: [501] },
    SOUTH:   { r64: [209,210,211,212,213,214,215,216], r32: [305,306,307,308], s16: [403,404], e8: [502] },
    WEST:    { r64: [217,218,219,220,221,222,223,224], r32: [309,310,311,312], s16: [405,406], e8: [503] },
    MIDWEST: { r64: [225,226,227,228,229,230,231,232], r32: [313,314,315,316], s16: [407,408], e8: [504] },
  };

  const ff = [601, 602];
  const champ = [701];

  type RegionKey = keyof typeof regions;

  function getMatchups(ids: number[]): (MatchupData | null)[] {
    return ids.map(id => makeMatchup(id));
  }

  return {
    regions: Object.fromEntries(
      Object.entries(regions).map(([key, val]) => [
        key,
        {
          r64: getMatchups(val.r64),
          r32: getMatchups(val.r32),
          s16: getMatchups(val.s16),
          e8:  getMatchups(val.e8),
        },
      ])
    ) as Record<RegionKey, { r64: (MatchupData|null)[]; r32: (MatchupData|null)[]; s16: (MatchupData|null)[]; e8: (MatchupData|null)[] }>,
    ff: getMatchups(ff),
    champ: getMatchups(champ),
    firstFour: [101, 102, 103, 104].map(id => makeMatchup(id)),
  };
}

// ─── TeamStrip component ──────────────────────────────────────────────────────
function TeamStrip({ slug, seed, isWinner, score }: {
  slug: string;
  seed: number;
  isWinner: boolean | null;
  score?: number | null;
}) {
  const team = TEAM_BY_SLUG.get(slug);
  const color = team?.primaryColor ?? '#1a1a2e';
  // Always white text — textColor always returns '#fff'
  const tc = textColor(color);
  const displayName = team ? team.ncaaName : slug.replace(/_/g, ' ').toUpperCase();
  const logoUrl = team?.logoUrl ?? null;

  // Logo circle: always semi-transparent white for visibility on any team color
  const logoBg = 'rgba(255,255,255,.15)';

  const stateClass = isWinner === true ? 'strip-winner' : isWinner === false ? 'strip-loser' : '';
  const hasScore = score !== undefined && score !== null;

  return (
    <div
      className={`bracket-strip ${stateClass}`}
      style={{ background: color }}
      title={`${displayName}${hasScore ? ` (${score})` : ''}`}
    >
      {/* Laminate sheen */}
      <div className="strip-sheen" />
      {/* Bottom shadow */}
      <div className="strip-shadow" />

      {/* Left: team logo circle */}
      <div className="strip-logo-left">
        <div className="logo-circle" style={{ background: logoBg }}>
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

      {/* Center: seed + name — NO truncation, always white with text-shadow */}
      <div className="strip-center">
        <span className="strip-seed" style={{ color: 'rgba(255,255,255,.6)', textShadow: '0 1px 3px rgba(0,0,0,.8)' }}>
          {seed}
        </span>
        <span className="strip-name" style={{ color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,.9)' }}>
          {displayName}
        </span>
      </div>

      {/* Right: score — always white with text-shadow */}
      <div className="strip-score-right">
        {hasScore && (
          <span className="strip-score-val" style={{ color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,.9)' }}>
            {score}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Matchup component ────────────────────────────────────────────────────────
function Matchup({ data, size = 'normal' }: { data: MatchupData | null; size?: 'normal' | 'small' | 'champ' }) {
  if (!data) {
    // TBD placeholder
    return (
      <div className={`bracket-matchup bracket-matchup-${size}`}>
        <div className="bracket-strip strip-tbd">
          <div className="strip-sheen" />
          <div className="strip-center"><span className="strip-name" style={{ color: 'rgba(255,255,255,.3)' }}>TBD</span></div>
        </div>
        <div className="matchup-divider" />
        <div className="bracket-strip strip-tbd">
          <div className="strip-sheen" />
          <div className="strip-center"><span className="strip-name" style={{ color: 'rgba(255,255,255,.3)' }}>TBD</span></div>
        </div>
      </div>
    );
  }

  const isFinal = data.gameStatus === 'final';
  const isLive = data.gameStatus === 'live';
  const isUpcoming = !isFinal && !isLive;

  // Status label shown ABOVE the matchup cell
  let statusLabel: React.ReactNode = null;
  if (isLive) {
    statusLabel = (
      <div style={{ fontSize: 9, fontWeight: 800, color: '#4ade80', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2, textAlign: 'center', textShadow: '0 0 6px rgba(74,222,128,.6)' }}>
        ● LIVE
      </div>
    );
  } else if (isFinal) {
    statusLabel = (
      <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.5)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2, textAlign: 'center' }}>
        FINAL
      </div>
    );
  } else if (isUpcoming && data.startTimeEst) {
    statusLabel = (
      <div style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,.4)', letterSpacing: 0.5, marginBottom: 2, textAlign: 'center' }}>
        {data.startTimeEst} EST
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
      {statusLabel}
      <div className={`bracket-matchup bracket-matchup-${size}`}>
        <TeamStrip
          slug={data.top.slug}
          seed={data.top.seed}
          isWinner={isFinal ? data.top.isWinner : null}
          score={isFinal || isLive ? data.awayScore : undefined}
        />
        <div className="matchup-divider" />
        <TeamStrip
          slug={data.bottom.slug}
          seed={data.bottom.seed}
          isWinner={isFinal ? data.bottom.isWinner : null}
          score={isFinal || isLive ? data.homeScore : undefined}
        />
      </div>
    </div>
  );
}

// ─── Round column ─────────────────────────────────────────────────────────────
function RoundCol({ matchups, gap, width, animDelay }: {
  matchups: (MatchupData | null)[];
  gap: number;
  width: number;
  animDelay: number;
}) {
  return (
    <div
      className="round-col"
      style={{
        width,
        gap,
        animationDelay: `${animDelay}s`,
      }}
    >
      {matchups.map((m, i) => (
        <Matchup key={m?.bracketGameId ?? `tbd-${i}`} data={m} />
      ))}
    </div>
  );
}

// ─── SVG Connector lines ──────────────────────────────────────────────────────
function drawConnectors(
  wrapEl: HTMLElement,
  colEls: HTMLElement[],
  svgEl: SVGSVGElement
) {
  svgEl.innerHTML = '';
  const wrapRect = wrapEl.getBoundingClientRect();
  svgEl.setAttribute('width', `${wrapEl.scrollWidth}px`);
  svgEl.setAttribute('height', `${wrapEl.scrollHeight}px`);

  function cy(el: Element): number {
    const r = el.getBoundingClientRect();
    return r.top - wrapRect.top + r.height / 2;
  }
  function rx(el: Element): number {
    const r = el.getBoundingClientRect();
    return r.right - wrapRect.left;
  }
  function lx(el: Element): number {
    const r = el.getBoundingClientRect();
    return r.left - wrapRect.left;
  }

  function addPath(d: string) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'rgba(255,255,255,.45)');
    p.setAttribute('stroke-width', '1.5');
    p.setAttribute('stroke-linecap', 'square');
    svgEl.appendChild(p);
  }

  for (let ri = 0; ri < colEls.length - 1; ri++) {
    const currCol = colEls[ri];
    const nextCol = colEls[ri + 1];
    const currMatchups = Array.from(currCol.querySelectorAll('.bracket-matchup'));
    const nextMatchups = Array.from(nextCol.querySelectorAll('.bracket-matchup'));

    for (let ni = 0; ni < nextMatchups.length; ni++) {
      const topFeeder = currMatchups[ni * 2];
      const botFeeder = currMatchups[ni * 2 + 1];
      const target = nextMatchups[ni];
      if (!topFeeder || !botFeeder || !target) continue;

      const x1 = rx(topFeeder);
      const y1 = cy(topFeeder);
      const y2 = cy(botFeeder);
      const x2 = lx(target);
      const yMid = (y1 + y2) / 2;
      const xMid = x1 + (x2 - x1) / 2;

      addPath(`M ${x1} ${y1} H ${xMid} V ${yMid}`);
      addPath(`M ${x1} ${y2} H ${xMid} V ${yMid}`);
      addPath(`M ${xMid} ${yMid} H ${x2}`);
    }
  }
}

// ─── Region bracket (one side: R64 → R32 → S16 → E8) ─────────────────────────
function RegionBracket({
  region,
  data,
  direction,
}: {
  region: string;
  data: { r64: (MatchupData|null)[]; r32: (MatchupData|null)[]; s16: (MatchupData|null)[]; e8: (MatchupData|null)[] };
  direction: 'ltr' | 'rtl'; // ltr = left region (R64 first), rtl = right region (E8 first)
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const MATCHUP_H = 65; // 32px strip × 2 + 1px divider
  const COL_W = 180;
  const COL_GAP = 28;

  // Gap between matchups per round (doubles each round)
  const gaps = [8, MATCHUP_H + 8, MATCHUP_H * 3 + 8, MATCHUP_H * 7 + 8];

  const rounds = direction === 'ltr'
    ? [data.r64, data.r32, data.s16, data.e8]
    : [data.e8, data.s16, data.r32, data.r64];

  const redraw = useCallback(() => {
    if (!wrapRef.current || !svgRef.current) return;
    const cols = Array.from(wrapRef.current.querySelectorAll<HTMLElement>('.round-col'));
    drawConnectors(wrapRef.current, cols, svgRef.current);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => requestAnimationFrame(redraw));
    window.addEventListener('resize', redraw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', redraw);
    };
  }, [redraw, data]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
      {/* Region label */}
      <div style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: 'rgba(255,165,50,.7)',
        marginBottom: 6,
        paddingLeft: direction === 'rtl' ? (COL_W + COL_GAP) * 3 : 0,
      }}>
        {region}
      </div>
      {/* Round labels */}
      <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 8, gap: 0 }}>
        {(direction === 'ltr'
          ? ['R64', 'R32', 'S16', 'E8']
          : ['E8', 'S16', 'R32', 'R64']
        ).map((label, i) => (
          <div key={label} style={{
            width: COL_W,
            marginRight: i < 3 ? COL_GAP : 0,
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
        ))}
      </div>
      {/* Bracket wrap with SVG connectors */}
      <div ref={wrapRef} style={{ position: 'relative', display: 'flex', alignItems: 'flex-start' }}>
        <svg ref={svgRef} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', overflow: 'visible', zIndex: 2 }} />
        {rounds.map((matchups, ri) => {
          const gapIdx = direction === 'ltr' ? ri : (3 - ri);
          return (
            <div
              key={ri}
              className="round-col"
              style={{
                width: COL_W,
                display: 'flex',
                flexDirection: 'column',
                gap: gaps[gapIdx],
                marginRight: ri < 3 ? COL_GAP : 0,
                position: 'relative',
                zIndex: 3,
                opacity: 0,
                animation: `colIn 0.5s ${0.2 + ri * 0.12}s forwards`,
              }}
            >
              {matchups.map((m, mi) => (
                <Matchup key={m?.bracketGameId ?? `tbd-${ri}-${mi}`} data={m} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Final Four + Championship ────────────────────────────────────────────────
function FinalFourSection({ ff, champ }: {
  ff: (MatchupData | null)[];
  champ: (MatchupData | null)[];
}) {
  const champGame = champ[0];
  const champTeam = useMemo(() => {
    if (!champGame || champGame.gameStatus !== 'final') return null;
    if (champGame.awayScore === null || champGame.homeScore === null) return null;
    return champGame.awayScore > champGame.homeScore ? champGame.top.slug : champGame.bottom.slug;
  }, [champGame]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, minWidth: 200 }}>
      <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,.28)', paddingBottom: 4, borderBottom: '1px solid rgba(255,255,255,.09)', width: '100%', textAlign: 'center' }}>
        FINAL FOUR
      </div>
      {/* F4 Game 601: EAST vs SOUTH */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
        <div style={{ fontSize: 7.5, color: 'rgba(255,165,50,.6)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 2 }}>
          EAST · SOUTH
        </div>
        <Matchup data={ff[0]} size="normal" />
      </div>
      {/* Championship */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,165,50,.7)' }}>
          CHAMPIONSHIP
        </div>
        <div style={{ fontSize: 22, animation: 'glow-trophy 2.2s ease-in-out infinite', lineHeight: 1 }}>🏆</div>
        <Matchup data={champGame ?? null} size="champ" />
        {champTeam && (
          <div style={{
            fontSize: 14,
            fontWeight: 900,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            background: 'linear-gradient(130deg,#FF6B1A,#FFD060)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            textAlign: 'center',
            maxWidth: 160,
            lineHeight: 1.1,
          }}>
            {TEAM_BY_SLUG.get(champTeam)?.ncaaName ?? champTeam}
          </div>
        )}
      </div>
      {/* F4 Game 602: WEST vs MIDWEST */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', marginTop: 8 }}>
        <div style={{ fontSize: 7.5, color: 'rgba(255,165,50,.6)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 2 }}>
          WEST · MIDWEST
        </div>
        <Matchup data={ff[1]} size="normal" />
      </div>
    </div>
  );
}

// ─── First Four section ──────────────────────────────────────────────────────────────────────────────────────
const FF_LABELS: Record<number, string> = {
  101: 'MIDWEST · 16-seed',
  102: 'WEST · 11-seed',
  103: 'SOUTH · 16-seed',
  104: 'MIDWEST · 11-seed',
};

function FirstFourSection({ games }: { games: (MatchupData | null)[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
      <div style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: 'rgba(255,165,50,.7)',
        borderBottom: '1px solid rgba(255,255,255,.09)',
        paddingBottom: 4,
        marginBottom: 4,
      }}>
        FIRST FOUR — DAYTON, OH (MAR 17–18)
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {games.map((g, i) => (
          <div key={g?.bracketGameId ?? i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 7.5, color: 'rgba(255,255,255,.35)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              {g ? (FF_LABELS[g.bracketGameId] ?? `Game ${g.bracketGameId}`) : 'TBD'}
            </div>
            <Matchup data={g} size="small" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Ember particles ──────────────────────────────────────────────────────────
function Embers() {
  const colors = ['#FF6B1A', '#FF9B3A', '#FFD060', '#FF4422'];
  const embers = useMemo(() => Array.from({ length: 24 }, (_, i) => ({
    id: i,
    sz: 1.5 + Math.random() * 3,
    col: colors[Math.floor(Math.random() * colors.length)],
    left: Math.random() * 100,
    bottom: Math.random() * 50,
    d: 4 + Math.random() * 9,
    delay: -Math.random() * 12,
    tx: (Math.random() - 0.5) * 90,
    ty: -(120 + Math.random() * 320),
  })), []);

  return (
    <>
      {embers.map(e => (
        <div
          key={e.id}
          style={{
            position: 'fixed',
            borderRadius: '50%',
            opacity: 0,
            width: e.sz,
            height: e.sz,
            left: `${e.left}%`,
            bottom: `${e.bottom}%`,
            background: e.col,
            boxShadow: `0 0 ${e.sz * 2.5}px ${e.col}`,
            animation: `rise ${e.d}s ${e.delay}s infinite ease-in`,
            pointerEvents: 'none',
            zIndex: 1,
            ['--tx' as string]: `${e.tx}px`,
            ['--ty' as string]: `${e.ty}px`,
          }}
        />
      ))}
    </>
  );
}

// ─── Main Bracket component ───────────────────────────────────────────────────
export function MarchMadnessBracket() {
  const { data, isLoading, error } = trpc.bracket.getGames.useQuery(undefined, {
    refetchInterval: 30_000, // refresh every 30s for live scores
    staleTime: 20_000,
  });

  const bracket = useMemo(() => {
    if (!data?.games) return null;
    return buildBracketStructure(data.games as BracketGame[]);
  }, [data]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: 'rgba(255,255,255,.5)', fontSize: 13, letterSpacing: '0.1em' }}>
        LOADING BRACKET…
      </div>
    );
  }

  if (error || !bracket) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: 'rgba(255,100,50,.7)', fontSize: 13 }}>
        {error ? `Error: ${error.message}` : 'No bracket data available.'}
      </div>
    );
  }

  return (
    <div style={{
      position: 'relative',
      background: '#0d0d0f',
      minHeight: '100vh',
      fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
      overflowX: 'auto',
      paddingBottom: 60,
    }}>
      {/* Fire background */}
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        background: `
          radial-gradient(ellipse 55% 45% at 10% 15%, rgba(255,100,20,0.28) 0%, transparent 65%),
          radial-gradient(ellipse 45% 55% at 88% 80%, rgba(180,30,30,0.22) 0%, transparent 65%),
          radial-gradient(ellipse 35% 35% at 55% 45%, rgba(255,140,40,0.10) 0%, transparent 55%)
        `,
      }} />

      <Embers />

      {/* Header */}
      <header style={{ position: 'relative', zIndex: 10, textAlign: 'center', padding: '24px 0 16px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.24em', textTransform: 'uppercase', color: '#FF7A28', marginBottom: 4 }}>
          NCAA Division I Men's Basketball
        </div>
        <div style={{ fontSize: 'clamp(32px, 6vw, 60px)', fontWeight: 900, color: '#fff', lineHeight: 0.92, textTransform: 'uppercase', letterSpacing: '-0.01em' }}>
          March{' '}
          <em style={{
            fontStyle: 'normal',
            background: 'linear-gradient(130deg,#FF6B1A,#FFCF60)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>Madness</em>
        </div>
        <div style={{ fontSize: 11, letterSpacing: '0.14em', color: 'rgba(255,255,255,.28)', marginTop: 6 }}>
          2026 Tournament · All Regions
        </div>
      </header>

      {/* Main bracket stage */}
      <div style={{ position: 'relative', zIndex: 10, padding: '12px 24px 40px', minWidth: 1400 }}>
        {/* First Four */}
        <FirstFourSection games={bracket.firstFour} />

        {/* Main bracket: LEFT (EAST + SOUTH) | CENTER (F4 + Champ) | RIGHT (WEST + MIDWEST) */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
          {/* LEFT SIDE */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            <RegionBracket region="EAST" data={bracket.regions.EAST} direction="ltr" />
            <RegionBracket region="SOUTH" data={bracket.regions.SOUTH} direction="ltr" />
          </div>

          {/* CENTER: Final Four + Championship */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', paddingTop: 60 }}>
            <FinalFourSection ff={bracket.ff} champ={bracket.champ} />
          </div>

          {/* RIGHT SIDE */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            <RegionBracket region="WEST" data={bracket.regions.WEST} direction="rtl" />
            <RegionBracket region="MIDWEST" data={bracket.regions.MIDWEST} direction="rtl" />
          </div>
        </div>
      </div>

      {/* Inline styles */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800;900&display=swap');

        @keyframes colIn {
          from { opacity: 0; transform: translateX(-6px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes rise {
          0%   { opacity: 0; transform: translate(0, 0) scale(1); }
          15%  { opacity: .8; }
          85%  { opacity: .2; }
          100% { opacity: 0; transform: translate(var(--tx, 20px), var(--ty, -280px)) scale(.2); }
        }
        @keyframes glow-trophy {
          0%, 100% { filter: drop-shadow(0 0 6px rgba(255,155,40,.5)); }
          50%       { filter: drop-shadow(0 0 16px rgba(255,155,40,.95)); }
        }

        .bracket-matchup {
          display: flex;
          flex-direction: column;
          background: #000;
          border: 1.5px solid #2a2a2a;
          border-radius: 3px;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0,0,0,.7), inset 0 0 0 1px rgba(255,255,255,.04);
          position: relative;
          width: 180px;
        }
        .bracket-matchup-small { width: 160px; }
        .bracket-matchup-champ {
          width: 180px;
          border-color: rgba(255,185,50,.5);
          box-shadow: 0 0 18px rgba(255,120,20,.3), 0 2px 8px rgba(0,0,0,.7);
        }

        .matchup-divider {
          height: 1px;
          background: #000;
          flex-shrink: 0;
        }

        .bracket-strip {
          position: relative;
          width: 100%;
          min-height: 32px;
          height: auto;
          display: flex;
          align-items: center;
          justify-content: flex-start;
          overflow: visible;
          cursor: pointer;
          transition: filter .12s;
          padding-top: 4px;
          padding-bottom: 4px;
        }
        .bracket-strip:hover { filter: brightness(1.15); z-index: 10; }
        .strip-winner { box-shadow: inset 0 0 0 1.5px rgba(255,200,80,.45); }
        .strip-loser  { filter: brightness(.55) saturate(.6); }
        .strip-tbd    { background: #111 !important; }

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
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 22px;
        }

        .logo-circle {
          width: 22px;
          height: 22px;
          border-radius: 50%;
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
          padding-left: 32px;
          padding-right: 36px;
        }

        .strip-score-right {
          position: absolute;
          right: 6px;
          top: 50%;
          transform: translateY(-50%);
          z-index: 4;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          min-width: 28px;
        }
        .strip-score-val {
          font-size: 13px;
          font-weight: 900;
          letter-spacing: 0.02em;
          line-height: 1;
          color: #fff !important;
          text-shadow: 0 1px 4px rgba(0,0,0,.9);
        }
        .strip-seed {
          font-size: 9px;
          font-weight: 800;
          min-width: 10px;
          text-align: right;
          line-height: 1;
          color: rgba(255,255,255,.6) !important;
          text-shadow: 0 1px 3px rgba(0,0,0,.8);
        }
        .strip-name {
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          text-shadow: 0 1px 4px rgba(0,0,0,.9);
          white-space: normal;
          word-break: break-word;
          line-height: 1.1;
          user-select: none;
          color: #fff !important;
        }
        .strip-score {
          font-size: 11px;
          font-weight: 800;
          margin-left: 4px;
        }

        .live-badge {
          position: absolute;
          top: 2px;
          right: 4px;
          font-size: 6px;
          font-weight: 900;
          letter-spacing: 0.1em;
          color: #39FF14;
          text-transform: uppercase;
          z-index: 10;
          animation: pulse-live 1.2s ease-in-out infinite;
        }
        @keyframes pulse-live {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }

        .round-col {
          display: flex;
          flex-direction: column;
          position: relative;
          z-index: 3;
        }
      `}</style>
    </div>
  );
}

export default MarchMadnessBracket;
