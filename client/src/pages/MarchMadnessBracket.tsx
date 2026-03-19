/**
 * MarchMadnessBracket.tsx — 2026 NCAA Tournament Bracket
 *
 * Architecture matches bracket-v2.html EXACTLY:
 *   - Flex column with explicit CSS gap per round:
 *       R64: gap=10px  R32: gap=85px  S16: gap=235px  E8: gap=0px
 *   - Status label is OUTSIDE the flex item (rendered as a separate absolute overlay)
 *     so it does NOT affect gap geometry
 *   - SVG connectors drawn via getBoundingClientRect() after layout paint
 *     (double rAF, same as bracket-v2.html)
 *   - LEFT  half: EAST (top) + SOUTH (bottom) — LTR
 *   - RIGHT half: WEST (top) + MIDWEST (bottom) — RTL (column order reversed)
 *   - CENTER: First Four results + Final Four + Championship
 *
 * Visual features (matching bracket-v2.html):
 *   - Fire background with radial gradient overlays + grain texture
 *   - Animated ember particles (30 floating fire embers)
 *   - Column entrance animations (fade + slide in with staggered delays)
 *   - Round label headers above each column (R64, R32, S16, E8)
 *   - First Four section showing game results
 *   - Champion column with trophy emoji + glowing animation
 *   - Winner/loser strip visual states (gold border / dimmed)
 *   - Right logo circle on each team strip (dual logos)
 *   - Laminate sheen effect on strips
 */
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { NCAAM_TEAMS } from "@shared/ncaamTeams";

// ─── Constants ────────────────────────────────────────────────────────────────
const STRIP_H   = 32;   // px — height of each team strip row
const DIVIDER_H = 1;    // px — divider between top and bottom strip
const CARD_H    = STRIP_H * 2 + DIVIDER_H; // 65px — matchup card body
const COL_W     = 190;  // px — matchup card width
const COL_GAP   = 40;   // px — horizontal gap between round columns (connector zone)

// Gap between matchup CARDS in each round column.
const ROUND_GAP: Record<string, number> = {
  r64: 10,
  r32: 85,
  s16: 235,
  e8:  0,
};
// Per-round padding-top so card[0] center aligns with feeder midpoint
const ROUND_PADDING_TOP: Record<string, number> = {
  r64: 18,
  r32: 55.5,
  s16: 130.5,
  e8:  280.5,
};

// ─── Team registry ────────────────────────────────────────────────────────────
const TEAM_BY_SLUG = new Map(NCAAM_TEAMS.map(t => [t.dbSlug, t]));

// ─── Slug aliases ─────────────────────────────────────────────────────────────
const SLUG_ALIAS: Record<string, string> = {
  'north_carolina_st': 'nc_state',
  's_florida':         'south_florida',
  'north_dakota_st':   'n_dakota_st',
  'vcu':               'va_commonwealth',
  'penn':              'pennsylvania',
  'texas_am':          'texas_a_and_m',
  'saint_marys':       'st_marys',
  'liu':               'liu_brooklyn',
  'byu':               'brigham_young',
};
function resolveSlug(s: string): string { return SLUG_ALIAS[s] ?? s; }
function isTbd(s: string): boolean { return s.startsWith('tbd_') || s === 'tbd' || s === ''; }

// ─── Seed map ─────────────────────────────────────────────────────────────────
const SEED_MAP: Record<number, { away: number; home: number }> = {
  101: { away:16, home:16 }, 102: { away:11, home:11 },
  103: { away:16, home:16 }, 104: { away:11, home:11 },
  201: { away:16, home:1  }, 202: { away:9,  home:8  },
  203: { away:12, home:5  }, 204: { away:13, home:4  },
  205: { away:11, home:6  }, 206: { away:14, home:3  },
  207: { away:10, home:7  }, 208: { away:15, home:2  },
  209: { away:16, home:1  }, 210: { away:9,  home:8  },
  211: { away:12, home:5  }, 212: { away:13, home:4  },
  213: { away:11, home:6  }, 214: { away:14, home:3  },
  215: { away:10, home:7  }, 216: { away:15, home:2  },
  217: { away:16, home:1  }, 218: { away:9,  home:8  },
  219: { away:12, home:5  }, 220: { away:13, home:4  },
  221: { away:11, home:6  }, 222: { away:14, home:3  },
  223: { away:10, home:7  }, 224: { away:15, home:2  },
  225: { away:16, home:1  }, 226: { away:9,  home:8  },
  227: { away:12, home:5  }, 228: { away:13, home:4  },
  229: { away:11, home:6  }, 230: { away:14, home:3  },
  231: { away:10, home:7  }, 232: { away:15, home:2  },
};

// ─── Region game ID map ───────────────────────────────────────────────────────
const REGION_IDS = {
  EAST:    { r64:[201,202,203,204,205,206,207,208], r32:[301,302,303,304], s16:[401,402], e8:[501] },
  SOUTH:   { r64:[209,210,211,212,213,214,215,216], r32:[305,306,307,308], s16:[403,404], e8:[502] },
  WEST:    { r64:[217,218,219,220,221,222,223,224], r32:[309,310,311,312], s16:[405,406], e8:[503] },
  MIDWEST: { r64:[225,226,227,228,229,230,231,232], r32:[313,314,315,316], s16:[407,408], e8:[504] },
} as const;
type RegionKey = keyof typeof REGION_IDS;

// First Four game IDs and their region associations
const FIRST_FOUR_IDS = [101, 102, 103, 104];

// ─── Types ────────────────────────────────────────────────────────────────────
interface BracketGame {
  bracketGameId: number;
  awayTeam: string;
  homeTeam: string;
  startTimeEst: string;
  gameStatus: string;
  awayScore: number | null;
  homeScore: number | null;
}

interface Strip {
  slug: string;
  seed: number;
  score: number | null;
  winner: boolean | null;
}

interface Matchup {
  id: number;
  top: Strip;
  bot: Strip;
  status: string;
  timeLabel: string;
  placeholder: boolean; // both teams are TBD
}

// ─── Build bracket data ───────────────────────────────────────────────────────
function buildBracket(games: BracketGame[]) {
  const byId = new Map(games.map(g => [g.bracketGameId, g]));

  function makeMatchup(id: number): Matchup | null {
    const g = byId.get(id);
    if (!g) return null;

    const seeds = SEED_MAP[id] ?? { away: 0, home: 0 };
    const aSlug = resolveSlug(g.awayTeam);
    const hSlug = resolveSlug(g.homeTeam);

    const isFinal = g.gameStatus === 'final';
    const isLive  = g.gameStatus === 'live' || g.gameStatus === 'in_progress';

    let aWin: boolean | null = null;
    let hWin: boolean | null = null;
    if (isFinal && g.awayScore !== null && g.homeScore !== null) {
      aWin = g.awayScore > g.homeScore;
      hWin = !aWin;
    }

    // Top = lower seed number (better seed)
    const awayIsTop = seeds.away <= seeds.home;
    const top: Strip = {
      slug:   awayIsTop ? aSlug : hSlug,
      seed:   awayIsTop ? seeds.away : seeds.home,
      score:  (isFinal || isLive) ? (awayIsTop ? g.awayScore : g.homeScore) : null,
      winner: awayIsTop ? aWin : hWin,
    };
    const bot: Strip = {
      slug:   awayIsTop ? hSlug : aSlug,
      seed:   awayIsTop ? seeds.home : seeds.away,
      score:  (isFinal || isLive) ? (awayIsTop ? g.homeScore : g.awayScore) : null,
      winner: awayIsTop ? hWin : aWin,
    };

    const placeholder = isTbd(aSlug) && isTbd(hSlug);
    let timeLabel = '';
    if (isFinal)       timeLabel = 'FINAL';
    else if (isLive)   timeLabel = 'LIVE';
    else if (!placeholder && g.startTimeEst && g.startTimeEst !== 'TBD')
      timeLabel = g.startTimeEst + ' EST';

    return { id, top, bot, status: g.gameStatus, timeLabel, placeholder };
  }

  const regions = {} as Record<RegionKey, { r64:(Matchup|null)[]; r32:(Matchup|null)[]; s16:(Matchup|null)[]; e8:(Matchup|null)[] }>;
  for (const [key, ids] of Object.entries(REGION_IDS) as [RegionKey, typeof REGION_IDS[RegionKey]][]) {
    regions[key] = {
      r64: ids.r64.map(makeMatchup),
      r32: ids.r32.map(makeMatchup),
      s16: ids.s16.map(makeMatchup),
      e8:  ids.e8.map(makeMatchup),
    };
  }

  const firstFour = FIRST_FOUR_IDS.map(makeMatchup);
  const ff        = [601, 602].map(makeMatchup);
  const champ     = [701].map(makeMatchup);

  return { regions, firstFour, ff, champ };
}

// ─── Luminance helpers ────────────────────────────────────────────────────────
function lum(hex: string): number {
  const h = hex.replace('#','');
  const r = parseInt(h.slice(0,2),16)/255;
  const g = parseInt(h.slice(2,4),16)/255;
  const b = parseInt(h.slice(4,6),16)/255;
  return 0.2126*r + 0.7152*g + 0.0722*b;
}
// Always white — team names are always white regardless of background
function txtColor(_hex: string): string { return '#fff'; }

// ─── StripRow ─────────────────────────────────────────────────────────────────
function StripRow({ s, compact = false }: { s: Strip; compact?: boolean }) {
  const placeholder = isTbd(s.slug);
  const team   = placeholder ? null : TEAM_BY_SLUG.get(s.slug);
  const bg     = placeholder ? '#111318' : (team?.primaryColor ?? '#1a1a2e');
  const tc     = placeholder ? '#fff'    : txtColor(bg);
  const name   = placeholder ? '' : (team?.ncaaName ?? s.slug.replace(/_/g,' ').toUpperCase());
  const logo   = placeholder ? null : (team?.logoUrl ?? null);
  const bright = lum(bg) > 0.45;
  const circleBg     = bright ? 'rgba(0,0,0,.2)'     : 'rgba(255,255,255,.18)';
  const circleBorder = bright ? 'rgba(0,0,0,.35)'    : 'rgba(255,255,255,.35)';
  const seedTc       = bright ? 'rgba(0,0,0,.45)'    : 'rgba(255,255,255,.55)';

  const stateClass =
    s.winner === true  ? 'strip-winner' :
    s.winner === false ? 'strip-loser'  : '';

  const logoEl = (side: 'left' | 'right') => (
    !placeholder ? (
      <div className={`bk-logo bk-logo-${side}`}>
        <div className="bk-circle" style={{ background: circleBg, borderColor: circleBorder }}>
          {logo ? (
            <img
              src={logo} alt={name}
              width={16} height={16}
              style={{ objectFit:'contain', display:'block' }}
              onError={e => {
                const el = e.currentTarget;
                el.style.display = 'none';
                if (el.parentElement) {
                  el.parentElement.innerHTML =
                    `<span style="font-size:5.5px;font-weight:900;color:#fff;letter-spacing:-.3px;line-height:1">${name.replace(/[^A-Za-z]/g,'').slice(0,4).toUpperCase()}</span>`;
                }
              }}
            />
          ) : (
            <span style={{ fontSize:5.5, fontWeight:900, color:'#fff', letterSpacing:-.3, lineHeight:1 }}>
              {name.replace(/[^A-Za-z]/g,'').slice(0,4).toUpperCase()}
            </span>
          )}
        </div>
      </div>
    ) : null
  );

  return (
    <div className={`bk-strip ${stateClass}`} style={{ background: bg }}>
      {/* Sheen overlay */}
      <div className="bk-sheen" />

      {/* Left logo circle */}
      {logoEl('left')}

      {/* Seed + Name */}
      <div className="bk-center" style={{ paddingLeft: placeholder ? 8 : 36, paddingRight: placeholder ? 8 : (s.score !== null ? 36 : 8) }}>
        {!placeholder && s.seed > 0 && (
          <span className="bk-seed" style={{ color: 'rgba(255,255,255,.55)' }}>{s.seed}</span>
        )}
        {!placeholder && (
          <span className="bk-name" style={{ color: '#fff' }}>{name}</span>
        )}
      </div>

      {/* Score — sits at far right edge */}
      {s.score !== null && (
        <div className="bk-score">
          <span style={{ color: '#fff', fontSize:13, fontWeight:900, textShadow:'0 1px 4px rgba(0,0,0,.9)' }}>
            {s.score}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── MatchupCard ──────────────────────────────────────────────────────────────
function MatchupCard({ m, champ = false }: { m: Matchup | null; champ?: boolean }) {
  const cls = `bk-card${champ ? ' bk-card-champ' : ''}`;
  if (!m) {
    return (
      <div className={cls}>
        <div className="bk-strip bk-placeholder"><div className="bk-sheen" /></div>
        <div className="bk-divider" />
        <div className="bk-strip bk-placeholder"><div className="bk-sheen" /></div>
      </div>
    );
  }
  return (
    <div className={cls}>
      <StripRow s={m.top} />
      <div className="bk-divider" />
      <StripRow s={m.bot} />
    </div>
  );
}

// ─── RoundColumn ─────────────────────────────────────────────────────────────
function RoundColumn({ matchups, roundKey, colRef, animDelay = 0 }: {
  matchups: (Matchup | null)[];
  roundKey: string;
  colRef?: React.RefObject<HTMLDivElement | null>;
  animDelay?: number;
}) {
  const gap = ROUND_GAP[roundKey] ?? 10;
  const paddingTop = ROUND_PADDING_TOP[roundKey] ?? 18;

  return (
    <div
      ref={colRef}
      className="bk-round-col"
      data-round={roundKey}
      style={{
        gap: `${gap}px`,
        paddingTop: `${paddingTop}px`,
        animationDelay: `${animDelay}s`,
      }}
    >
      {matchups.map((m, i) => {
        const tl = m?.timeLabel ?? '';
        const statusCls =
          tl === 'LIVE'  ? 'bk-status-live'  :
          tl === 'FINAL' ? 'bk-status-final' :
          tl             ? 'bk-status-time'  : '';

        return (
          <div key={m?.id ?? `ph-${i}`} className="bk-matchup-item">
            {/* Status label — absolutely positioned above the card */}
            <div className={`bk-status ${statusCls}`}>{tl}</div>
            <MatchupCard m={m} />
          </div>
        );
      })}
    </div>
  );
}

// ─── SVG Connector drawing ────────────────────────────────────────────────────
function drawConnectors(
  svg: SVGSVGElement,
  wrap: HTMLElement,
  cols: (HTMLElement | null)[],
  dir: 'ltr' | 'rtl'
) {
  svg.innerHTML = '';
  const wr = wrap.getBoundingClientRect();
  svg.setAttribute('width',  `${wrap.scrollWidth}`);
  svg.setAttribute('height', `${wrap.scrollHeight}`);

  const cy = (el: Element) => { const r = el.getBoundingClientRect(); return r.top  - wr.top  + r.height / 2; };
  const rx = (el: Element) => { const r = el.getBoundingClientRect(); return r.right - wr.left; };
  const lx = (el: Element) => { const r = el.getBoundingClientRect(); return r.left  - wr.left; };

  function line(d: string) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', 'bk-connector');
    svg.appendChild(p);
  }

  const validCols = cols.filter(Boolean) as HTMLElement[];

  for (let ci = 0; ci < validCols.length - 1; ci++) {
    const curr = validCols[ci];
    const next = validCols[ci + 1];
    const currCards = Array.from(curr.querySelectorAll('.bk-card'));
    const nextCards = Array.from(next.querySelectorAll('.bk-card'));

    if (dir === 'ltr') {
      for (let ni = 0; ni < nextCards.length; ni++) {
        const top = currCards[ni * 2];
        const bot = currCards[ni * 2 + 1];
        const tgt = nextCards[ni];
        if (!top || !bot || !tgt) continue;
        const x1   = rx(top);
        const y1   = cy(top);
        const y2   = cy(bot);
        const x2   = lx(tgt);
        const xMid = x1 + (x2 - x1) / 2;
        const yMid = (y1 + y2) / 2;
        line(`M ${x1} ${y1} H ${xMid} V ${yMid}`);
        line(`M ${x1} ${y2} H ${xMid} V ${yMid}`);
        line(`M ${xMid} ${yMid} H ${x2}`);
      }
    } else {
      for (let ni = 0; ni < currCards.length; ni++) {
        const tgt = currCards[ni];
        const top = nextCards[ni * 2];
        const bot = nextCards[ni * 2 + 1];
        if (!top || !bot || !tgt) continue;
        const x1   = lx(top);
        const y1   = cy(top);
        const y2   = cy(bot);
        const x2   = rx(tgt);
        const xMid = x2 + (x1 - x2) / 2;
        const yMid = (y1 + y2) / 2;
        line(`M ${x1} ${y1} H ${xMid} V ${yMid}`);
        line(`M ${x1} ${y2} H ${xMid} V ${yMid}`);
        line(`M ${xMid} ${yMid} H ${x2}`);
      }
    }
  }
}

// ─── RegionBracket ────────────────────────────────────────────────────────────
function RegionBracket({ region, data, dir, baseDelay = 0 }: {
  region: string;
  data: { r64:(Matchup|null)[]; r32:(Matchup|null)[]; s16:(Matchup|null)[]; e8:(Matchup|null)[] };
  dir: 'ltr' | 'rtl';
  baseDelay?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef  = useRef<SVGSVGElement>(null);
  const c0 = useRef<HTMLDivElement>(null);
  const c1 = useRef<HTMLDivElement>(null);
  const c2 = useRef<HTMLDivElement>(null);
  const c3 = useRef<HTMLDivElement>(null);

  // LTR: [R64, R32, S16, E8]   RTL: [E8, S16, R32, R64]
  const rounds     = dir === 'ltr'
    ? [data.r64, data.r32, data.s16, data.e8]
    : [data.e8,  data.s16, data.r32, data.r64];
  const roundKeys  = dir === 'ltr'
    ? ['r64','r32','s16','e8']
    : ['e8','s16','r32','r64'];
  const roundLabels = dir === 'ltr'
    ? ['R64','R32','S16','E8']
    : ['E8','S16','R32','R64'];
  const colRefs = [c0, c1, c2, c3];

  const redraw = useCallback(() => {
    if (!svgRef.current || !wrapRef.current) return;
    drawConnectors(svgRef.current, wrapRef.current, [c0.current, c1.current, c2.current, c3.current], dir);
  }, [dir]);

  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(redraw));
    return () => cancelAnimationFrame(id);
  }, [redraw, data]);

  useEffect(() => {
    window.addEventListener('resize', redraw);
    return () => window.removeEventListener('resize', redraw);
  }, [redraw]);

  return (
    <div style={{ display:'flex', flexDirection:'column' }}>
      {/* Region label */}
      <div style={{ fontSize:9, fontWeight:700, letterSpacing:'0.22em', textTransform:'uppercase', color:'rgba(255,165,50,.7)', marginBottom:4 }}>
        {region}
      </div>

      {/* Round header labels */}
      <div style={{ display:'flex', marginBottom:6 }}>
        {roundLabels.map((lbl, i) => (
          <React.Fragment key={lbl}>
            <div style={{ width:COL_W, fontSize:8.5, fontWeight:700, letterSpacing:'0.2em', textTransform:'uppercase', color:'rgba(255,255,255,.28)', paddingBottom:4, borderBottom:'1px solid rgba(255,255,255,.09)', textAlign:'center', flexShrink:0 }}>
              {lbl}
            </div>
            {i < 3 && <div style={{ width:COL_GAP, flexShrink:0 }} />}
          </React.Fragment>
        ))}
      </div>

      {/* Columns + SVG overlay */}
      <div ref={wrapRef} style={{ position:'relative', display:'flex', alignItems:'flex-start' }}>
        <svg ref={svgRef} style={{ position:'absolute', top:0, left:0, pointerEvents:'none', overflow:'visible', zIndex:10 }} />
        {rounds.map((matchups, ri) => (
          <React.Fragment key={ri}>
            <RoundColumn
              matchups={matchups}
              roundKey={roundKeys[ri]}
              colRef={colRefs[ri] as React.RefObject<HTMLDivElement | null>}
              animDelay={baseDelay + ri * 0.12}
            />
            {ri < 3 && <div style={{ width:COL_GAP, flexShrink:0 }} />}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ─── FirstFourSection ─────────────────────────────────────────────────────────
function FirstFourSection({ games }: { games: (Matchup|null)[] }) {
  return (
    <div className="bk-firstfour">
      <div className="bk-firstfour-label">FIRST FOUR</div>
      <div className="bk-firstfour-games">
        {games.map((m, i) => {
          if (!m) return null;
          const tl = m.timeLabel;
          const statusCls =
            tl === 'LIVE'  ? 'bk-status-live'  :
            tl === 'FINAL' ? 'bk-status-final' :
            tl             ? 'bk-status-time'  : '';
          return (
            <div key={m.id} className="bk-firstfour-game">
              <div className={`bk-ff-status ${statusCls}`}>{tl}</div>
              <MatchupCard m={m} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── FinalFourSection ─────────────────────────────────────────────────────────
function FinalFourSection({ ff, champ }: {
  ff: (Matchup|null)[];
  champ: (Matchup|null)[];
}) {
  const champGame = champ[0];
  const champSlug = useMemo(() => {
    if (!champGame || champGame.status !== 'final') return null;
    if (champGame.top.score === null || champGame.bot.score === null) return null;
    return champGame.top.score > champGame.bot.score ? champGame.top.slug : champGame.bot.slug;
  }, [champGame]);
  const champTeam = champSlug ? TEAM_BY_SLUG.get(champSlug) : null;

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:20, flexShrink:0, paddingTop:16 }}>
      <div style={{ fontSize:9, fontWeight:700, letterSpacing:'0.22em', textTransform:'uppercase', color:'rgba(255,165,50,.7)' }}>
        FINAL FOUR
      </div>

      {/* FF Game 1: EAST vs SOUTH */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
        <div style={{ fontSize:8, color:'rgba(255,255,255,.28)', letterSpacing:'0.15em', textTransform:'uppercase' }}>EAST · SOUTH</div>
        <MatchupCard m={ff[0] ?? null} />
      </div>

      {/* Championship */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
        <div style={{ fontSize:9, fontWeight:700, letterSpacing:'0.22em', textTransform:'uppercase', color:'rgba(255,165,50,.7)' }}>CHAMPIONSHIP</div>
        <div className="bk-trophy">🏆</div>
        <MatchupCard m={champGame ?? null} champ />
        {champTeam && (
          <div style={{ marginTop:6, textAlign:'center' }}>
            <div style={{ fontSize:9, color:'rgba(255,165,50,.7)', letterSpacing:'0.2em', textTransform:'uppercase', marginBottom:3 }}>2026 CHAMPION</div>
            <div className="bk-champ-name">
              {champTeam.ncaaName}
            </div>
          </div>
        )}
      </div>

      {/* FF Game 2: WEST vs MIDWEST */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
        <div style={{ fontSize:8, color:'rgba(255,255,255,.28)', letterSpacing:'0.15em', textTransform:'uppercase' }}>WEST · MIDWEST</div>
        <MatchupCard m={ff[1] ?? null} />
      </div>
    </div>
  );
}

// ─── Ember particles ──────────────────────────────────────────────────────────
const EMBER_DATA = Array.from({ length: 30 }, (_, i) => {
  const sz = 1.5 + (i * 0.17) % 3;
  const colors = ['#FF6B1A','#FF9B3A','#FFD060','#FF4422'];
  const col = colors[i % colors.length];
  return {
    key: i,
    sz,
    col,
    left: `${(i * 3.33) % 100}%`,
    bottom: `${(i * 7.7) % 50}%`,
    d: `${4 + (i * 0.6) % 9}s`,
    delay: `${-((i * 0.4) % 12)}s`,
    tx: `${((i % 9) - 4) * 10}px`,
    ty: `${-(120 + (i * 20) % 320)}px`,
  };
});

// ─── Main export ──────────────────────────────────────────────────────────────
export default function MarchMadnessBracket() {
  const { data: result, isLoading, error } = trpc.bracket.getGames.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const bracket = useMemo(() => {
    if (!result?.games) return null;
    return buildBracket(result.games as unknown as BracketGame[]);
  }, [result]);

  if (isLoading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:300, color:'rgba(255,255,255,.5)', fontSize:14 }}>
      Loading bracket…
    </div>
  );
  if (error || !bracket) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:300, color:'#f87171', fontSize:14 }}>
      Failed to load bracket data.
    </div>
  );

  return (
    <div className="bk-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800;900&display=swap');

        .bk-root {
          background: #0d0d0f;
          padding: 20px 16px 60px;
          overflow-x: auto;
          overflow-y: auto;
          font-family: 'Barlow Condensed', 'Inter', sans-serif;
          position: relative;
        }

        /* ── Fire background ── */
        .bk-fire-bg {
          position: absolute;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          background:
            radial-gradient(ellipse 55% 45% at 10% 15%, rgba(255,100,20,0.28) 0%, transparent 65%),
            radial-gradient(ellipse 45% 55% at 88% 80%, rgba(180,30,30,0.22) 0%, transparent 65%),
            radial-gradient(ellipse 35% 35% at 55% 45%, rgba(255,140,40,0.10) 0%, transparent 55%);
        }

        /* ── Grain texture ── */
        .bk-grain {
          position: absolute;
          inset: 0;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
          opacity: 0.03;
          pointer-events: none;
          z-index: 1;
        }

        /* ── Ember particles ── */
        .bk-ember {
          position: absolute;
          border-radius: 50%;
          opacity: 0;
          animation: bk-rise var(--d,7s) var(--delay,0s) infinite ease-in;
          z-index: 2;
          pointer-events: none;
        }
        @keyframes bk-rise {
          0%   { opacity:0; transform:translate(0,0) scale(1); }
          15%  { opacity:.8; }
          85%  { opacity:.2; }
          100% { opacity:0; transform:translate(var(--tx,20px),var(--ty,-280px)) scale(.2); }
        }

        /* ── Content wrapper (above bg) ── */
        .bk-content {
          position: relative;
          z-index: 10;
        }

        /* ── Header ── */
        .bk-header {
          text-align: center;
          padding: 12px 0 20px;
        }
        .bk-header-sub {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .24em;
          text-transform: uppercase;
          color: #FF7A28;
          margin-bottom: 4px;
        }
        .bk-header-main {
          font-size: clamp(28px, 5vw, 52px);
          font-weight: 900;
          color: #fff;
          line-height: .92;
          text-transform: uppercase;
          letter-spacing: -.01em;
        }
        .bk-header-fire {
          background: linear-gradient(130deg,#FF6B1A,#FFCF60);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .bk-header-year {
          font-size: 11px;
          letter-spacing: .14em;
          color: rgba(255,255,255,.28);
          margin-top: 7px;
        }

        /* ── Card ── */
        .bk-card {
          display: flex;
          flex-direction: column;
          width: ${COL_W}px;
          background: #000;
          border: 1.5px solid #2a2a2a;
          border-radius: 3px;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0,0,0,.7), inset 0 0 0 1px rgba(255,255,255,.04);
          flex-shrink: 0;
          position: relative;
          z-index: 3;
        }
        .bk-card-champ {
          border-color: rgba(255,185,50,.5);
          box-shadow: 0 0 18px rgba(255,120,20,.3), 0 2px 8px rgba(0,0,0,.7);
        }
        .bk-divider {
          height: ${DIVIDER_H}px;
          background: #000;
          flex-shrink: 0;
        }

        /* ── Strip ── */
        .bk-strip {
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
        .bk-strip:hover { filter: brightness(1.15); z-index: 10; }
        .bk-placeholder { background: #111318 !important; }
        .strip-winner   { box-shadow: inset 0 0 0 1.5px rgba(255,200,80,.45); }
        /* Loser: dim brightness + desaturate, but keep hover override above it */
        .strip-loser    { filter: brightness(.45) saturate(.4) !important; }
        .strip-loser:hover { filter: brightness(.6) saturate(.5) !important; }

        /* Sheen — laminate/plastic feel */
        .bk-sheen {
          position: absolute; inset: 0;
          background: linear-gradient(180deg, rgba(255,255,255,.22) 0%, rgba(255,255,255,.06) 30%, rgba(0,0,0,.18) 100%);
          z-index: 2; pointer-events: none;
        }

        /* Logo zones — left and right */
        .bk-logo {
          position: absolute;
          top: 50%; transform: translateY(-50%);
          z-index: 4; width: 28px; height: 22px;
          display: flex; align-items: center; justify-content: center;
        }
        .bk-logo-left  { left: 4px; }
        .bk-logo-right { right: 4px; }
        .bk-circle {
          width: 20px; height: 20px; border-radius: 50%;
          border: 1px solid rgba(255,255,255,.3);
          display: flex; align-items: center; justify-content: center; overflow: hidden;
        }

        /* Seed + Name */
        .bk-center {
          position: relative; z-index: 4;
          display: flex; align-items: center; gap: 4px;
          flex: 1; min-width: 0;
        }
        .bk-seed {
          font-size: 9px; font-weight: 800;
          min-width: 10px; text-align: right; line-height: 1;
          text-shadow: 0 1px 3px rgba(0,0,0,.8); flex-shrink: 0;
        }
        .bk-name {
          font-size: 13px; font-weight: 900; letter-spacing: 0.04em;
          text-transform: uppercase; text-shadow: 0 1px 4px rgba(0,0,0,.9);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.1;
        }

        /* Score — sits at far right edge of the strip */
        .bk-score {
          position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
          z-index: 4; min-width: 26px; text-align: right;
        }

        /* ── Matchup item wrapper ── */
        /* paddingTop creates the space for the status label above the card */
        .bk-matchup-item {
          position: relative;
          flex-shrink: 0;
          padding-top: 16px;
        }

        /* Status label — sits inside the padding-top space above the card */
        .bk-status {
          position: absolute;
          top: 0;
          left: 0; right: 0;
          height: 16px;
          display: flex; align-items: center; justify-content: center;
          font-size: 9px; font-weight: 700; letter-spacing: 0.12em;
          text-transform: uppercase;
          color: rgba(255,255,255,.35);
          pointer-events: none;
        }
        .bk-status-live  { color: #4ade80; text-shadow: 0 0 6px rgba(74,222,128,.6); }
        .bk-status-final { color: rgba(255,255,255,.5); }
        .bk-status-time  { color: rgba(255,255,255,.38); font-weight: 600; }

        /* ── Round column — entrance animation ── */
        .bk-round-col {
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          position: relative;
          z-index: 3;
          opacity: 0;
          animation: bk-colIn .5s forwards;
        }
        @keyframes bk-colIn {
          from { opacity:0; transform:translateX(-6px); }
          to   { opacity:1; transform:translateX(0); }
        }

        /* ── SVG connector lines ── */
        .bk-connector {
          fill: none;
          stroke: rgba(255,255,255,.5);
          stroke-width: 1.5px;
          stroke-linecap: square;
        }

        /* ── Bracket layout ── */
        .bk-layout {
          display: flex;
          align-items: flex-start;
          gap: 20px;
          min-width: max-content;
        }
        .bk-half {
          display: flex;
          flex-direction: column;
          gap: 36px;
        }

        /* ── First Four section ── */
        .bk-firstfour {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          margin-bottom: 20px;
        }
        .bk-firstfour-label {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: .22em;
          text-transform: uppercase;
          color: rgba(255,165,50,.7);
          padding-bottom: 4px;
          border-bottom: 1px solid rgba(255,255,255,.09);
          width: 100%;
          text-align: center;
        }
        .bk-firstfour-games {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          justify-content: center;
        }
        .bk-firstfour-game {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }
        .bk-ff-status {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: rgba(255,255,255,.35);
          height: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
        }

        /* ── Champion trophy ── */
        .bk-trophy {
          font-size: 26px;
          line-height: 1;
          animation: bk-glow-trophy 2.2s ease-in-out infinite;
        }
        @keyframes bk-glow-trophy {
          0%,100% { filter: drop-shadow(0 0 6px rgba(255,155,40,.5)); }
          50%      { filter: drop-shadow(0 0 16px rgba(255,155,40,.95)); }
        }

        /* ── Champion name gradient ── */
        .bk-champ-name {
          font-size: 15px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .06em;
          background: linear-gradient(130deg,#FF6B1A,#FFD060);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          text-align: center;
          max-width: 160px;
          line-height: 1.1;
        }
      `}</style>

      {/* Fire background */}
      <div className="bk-fire-bg" />
      <div className="bk-grain" />

      {/* Ember particles */}
      {EMBER_DATA.map(e => (
        <div
          key={e.key}
          className="bk-ember"
          style={{
            width: e.sz,
            height: e.sz,
            left: e.left,
            bottom: e.bottom,
            background: e.col,
            boxShadow: `0 0 ${e.sz * 2.5}px ${e.col}`,
            ['--d' as string]: e.d,
            ['--delay' as string]: e.delay,
            ['--tx' as string]: e.tx,
            ['--ty' as string]: e.ty,
          } as React.CSSProperties}
        />
      ))}

      {/* Content */}
      <div className="bk-content">
        {/* Header */}
        <div className="bk-header">
          <div className="bk-header-sub">NCAA Division I Men's Basketball</div>
          <div className="bk-header-main">
            March <span className="bk-header-fire">Madness</span>
          </div>
          <div className="bk-header-year">2026 Tournament · All Regions</div>
        </div>

        {/* First Four Results */}
        <FirstFourSection games={bracket.firstFour} />

        {/* Main bracket */}
        <div className="bk-layout">
          {/* LEFT: EAST + SOUTH */}
          <div className="bk-half">
            <RegionBracket region="EAST"  data={bracket.regions.EAST}  dir="ltr" baseDelay={0.2} />
            <RegionBracket region="SOUTH" data={bracket.regions.SOUTH} dir="ltr" baseDelay={0.2} />
          </div>

          {/* CENTER: Final Four + Championship */}
          <FinalFourSection ff={bracket.ff} champ={bracket.champ} />

          {/* RIGHT: WEST + MIDWEST (RTL) */}
          <div className="bk-half">
            <RegionBracket region="WEST"    data={bracket.regions.WEST}    dir="rtl" baseDelay={0.2} />
            <RegionBracket region="MIDWEST" data={bracket.regions.MIDWEST} dir="rtl" baseDelay={0.2} />
          </div>
        </div>
      </div>
    </div>
  );
}
