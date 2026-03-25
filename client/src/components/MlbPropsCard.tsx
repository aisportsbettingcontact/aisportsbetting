/**
 * MlbPropsCard
 *
 * Displays MLB strikeout prop projections for a single game (both pitchers).
 * Styled to match MlbLineupCard — same dark theme, color top bar, matchup header.
 *
 * Layout:
 *   - Matchup header: Away @ Home with team logos and start time
 *   - Two pitcher panels (side-by-side on desktop, stacked on mobile)
 *   - Each panel: pitcher name/hand, K projection, book line, over/under probs,
 *     edge verdict, distribution bar chart, signal breakdown, matchup rows
 *
 * Color scheme: #090E14 background, #182433 borders, neon green for ELITE edges.
 */

import { useMemo } from "react";
import { MLB_BY_ABBREV } from "@shared/mlbTeams";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface StrikeoutPropRow {
  id: number;
  gameId: number;
  side: string;             // 'away' | 'home'
  pitcherName: string;
  pitcherHand: string | null;
  retrosheetId: string | null;
  mlbamId: number | null;
  kProj: string | null;     // e.g. "4.73"
  kLine: string | null;     // model recommended line e.g. "4.5"
  kPer9: string | null;
  kMedian: string | null;
  kP5: string | null;
  kP95: string | null;
  bookLine: string | null;  // e.g. "4.5"
  bookOverOdds: string | null;
  bookUnderOdds: string | null;
  pOver: string | null;     // e.g. "0.499"
  pUnder: string | null;
  modelOverOdds: string | null;
  modelUnderOdds: string | null;
  edgeOver: string | null;
  edgeUnder: string | null;
  verdict: string | null;   // 'OVER' | 'UNDER' | 'PASS'
  bestEdge: string | null;
  bestSide: string | null;
  bestMlStr: string | null;
  signalBreakdown: string | null;   // JSON
  matchupRows: string | null;       // JSON
  distribution: string | null;      // JSON
  inningBreakdown: string | null;   // JSON
  modelRunAt: number | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MlbPropsCardProps {
  awayTeam: string;   // abbreviation e.g. "NYY"
  homeTeam: string;   // abbreviation e.g. "SF"
  startTime: string;  // e.g. "7:05 PM ET"
  props: StrikeoutPropRow[] | null | undefined;  // 0-2 rows
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const mlbPhoto = (id: number | null | undefined): string | null => {
  if (!id) return null;
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_180,q_auto:best,e_background_removal,f_png/v1/people/${id}/headshot/67/current`;
};

/** Convert decimal probability (0-1) to American odds string. */
function probToAmerican(p: number): string {
  if (p <= 0 || p >= 1) return '—';
  if (p >= 0.5) {
    const odds = Math.round(-100 * p / (1 - p));
    return String(odds);
  }
  const odds = Math.round(100 * (1 - p) / p);
  return `+${odds}`;
}

/** Format a decimal probability as a percentage string. */
function fmtPct(val: string | null | undefined): string {
  if (!val) return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return `${Math.round(n * 100)}%`;
}

/** Format a numeric string to 1 decimal place. */
function fmtNum(val: string | null | undefined, decimals = 1): string {
  if (!val) return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return n.toFixed(decimals);
}

/** Edge color — matches GameCard 6-tier scale. */
function getEdgeColor(edgeStr: string | null | undefined): string {
  if (!edgeStr) return 'rgba(255,255,255,0.30)';
  const edge = parseFloat(edgeStr) * 100; // convert from decimal to pp
  if (isNaN(edge)) return 'rgba(255,255,255,0.30)';
  if (edge >= 8)   return '#39FF14';
  if (edge >= 5)   return '#7FFF00';
  if (edge >= 2.5) return '#ADFF2F';
  if (edge >= 0.5) return 'rgba(255,255,255,0.60)';
  if (edge >= -1)  return 'rgba(255,255,255,0.30)';
  return '#FF2244';
}

/** Verdict badge color. */
function getVerdictColor(verdict: string | null | undefined): string {
  if (!verdict) return 'rgba(255,255,255,0.30)';
  if (verdict === 'OVER')  return '#39FF14';
  if (verdict === 'UNDER') return '#00BFFF';
  return 'rgba(255,255,255,0.30)';
}

/** Team primary color from MLB_BY_ABBREV. */
function teamColor(abbrev: string): string {
  const info = MLB_BY_ABBREV.get(abbrev.toUpperCase());
  return info?.primaryColor ?? '#4A90D9';
}

function teamDark(abbrev: string): string {
  const info = MLB_BY_ABBREV.get(abbrev.toUpperCase());
  return info?.secondaryColor ?? '#1A3A5C';
}

// ─── Distribution Bar Chart ────────────────────────────────────────────────────

interface DistributionChartProps {
  distribution: string | null;
  bookLine: string | null;
  isMobile: boolean;
}

function DistributionChart({ distribution, bookLine, isMobile }: DistributionChartProps) {
  const parsed = useMemo(() => {
    if (!distribution) return null;
    try {
      const d = JSON.parse(distribution) as { bins: number[]; probs: number[] };
      if (!d.bins || !d.probs || d.bins.length === 0) return null;
      return d;
    } catch { return null; }
  }, [distribution]);

  if (!parsed) return null;

  const maxProb = Math.max(...parsed.probs);
  const line = bookLine ? parseFloat(bookLine) : null;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
        Distribution
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: isMobile ? 32 : 40 }}>
        {parsed.bins.map((bin, i) => {
          const h = maxProb > 0 ? (parsed.probs[i] / maxProb) * (isMobile ? 32 : 40) : 0;
          const isOver = line !== null && bin > line;
          const isAtLine = line !== null && bin === line;
          const barColor = isAtLine
            ? 'rgba(255,255,255,0.5)'
            : isOver
            ? 'rgba(57,255,20,0.7)'
            : 'rgba(0,191,255,0.6)';
          return (
            <div
              key={bin}
              title={`K=${bin}: ${(parsed.probs[i] * 100).toFixed(1)}%`}
              style={{
                flex: 1,
                height: Math.max(h, 2),
                background: barColor,
                borderRadius: '2px 2px 0 0',
                transition: 'height 0.2s',
                minWidth: 4,
              }}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)' }}>{parsed.bins[0]}K</span>
        {line !== null && (
          <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.45)' }}>Line: {line}</span>
        )}
        <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)' }}>{parsed.bins[parsed.bins.length - 1]}K</span>
      </div>
    </div>
  );
}

// ─── Signal Breakdown ──────────────────────────────────────────────────────────

interface SignalBreakdownProps {
  signalBreakdown: string | null;
  isMobile: boolean;
}

function SignalBreakdown({ signalBreakdown, isMobile }: SignalBreakdownProps) {
  const signals = useMemo(() => {
    if (!signalBreakdown) return null;
    try {
      return JSON.parse(signalBreakdown) as Record<string, number>;
    } catch { return null; }
  }, [signalBreakdown]);

  if (!signals) return null;

  // Map the actual signal keys from StrikeoutModel.py JSON output to display labels.
  // The model outputs string values like "23.8%" or "1.009x" — we display them as-is.
  const SIGNAL_DISPLAY_KEYS: Array<{ key: string; label: string }> = [
    { key: 'combined_k',   label: 'Combined K%' },
    { key: 'pit_k_ha',     label: 'Pit K (H/A)' },
    { key: 'pit_whiff',    label: 'Pit Whiff' },
    { key: 'lu_whiff',     label: 'LU Whiff' },
    { key: 'pit_f_strike', label: 'F-Strike' },
    { key: 'ff_speed',     label: 'FB Velo' },
    { key: 'whiff_mult',   label: 'Whiff Mult' },
    { key: 'zone_mult',    label: 'Zone Mult' },
    { key: 'arsenal_mult', label: 'Arsenal Mult' },
    { key: 'base_k_rate',  label: 'Base K%' },
  ];

  const entries = SIGNAL_DISPLAY_KEYS
    .map(({ key, label }) => ({ key, label, val: (signals as Record<string, string | number>)[key] }))
    .filter(e => e.val != null && e.val !== '' && e.val !== 0);

  if (entries.length === 0) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
        Signal Breakdown
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 3 : 4 }}>
        {entries.map(({ key, label, val }) => {
          // val is a string like "23.8%" or "1.009x" or a number
          const displayVal = typeof val === 'string' ? val : String(val);
          return (
            <div
              key={key}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 4,
                padding: isMobile ? '2px 5px' : '2px 6px',
              }}
            >
              <span style={{ fontSize: isMobile ? 8 : 9, color: 'rgba(255,255,255,0.45)' }}>{label}</span>
              <span style={{ fontSize: isMobile ? 8 : 9, color: 'rgba(255,255,255,0.85)', fontWeight: 700 }}>
                {displayVal}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Matchup Rows ──────────────────────────────────────────────────────────────

interface MatchupRowsProps {
  matchupRows: string | null;
  isMobile: boolean;
}

function MatchupRows({ matchupRows, isMobile }: MatchupRowsProps) {
  const rows = useMemo(() => {
    if (!matchupRows) return null;
    try {
      return JSON.parse(matchupRows) as Array<{
        spot?: number;
        order?: number;
        name: string;
        hand: string;
        kRate: number;
        adj: number;
        expK: number;
      }>;
    } catch { return null; }
  }, [matchupRows]);

  if (!rows || rows.length === 0) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
        Lineup Matchup
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: '16px 1fr 28px 28px 28px', gap: 4, paddingBottom: 3, borderBottom: '1px solid rgba(24,36,51,0.6)' }}>
          <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', textAlign: 'center' }}>#</span>
          <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)' }}>Batter</span>
          <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', textAlign: 'right' }}>K%</span>
          <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', textAlign: 'right' }}>AdjK%</span>
          <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', textAlign: 'right' }}>xK/PA</span>
        </div>
        {rows.slice(0, 9).map((row, idx) => (
          <div
            key={row.spot ?? row.order ?? idx}
            style={{
              display: 'grid',
              gridTemplateColumns: '16px 1fr 28px 28px 28px',
              gap: 4,
              padding: '2px 0',
              borderBottom: '1px solid rgba(24,36,51,0.3)',
            }}
          >
            <span style={{ fontSize: isMobile ? 8 : 9, color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>{row.spot ?? row.order ?? idx + 1}</span>
            <span style={{ fontSize: isMobile ? 8 : 9, color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.name}
              <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.3)', marginLeft: 3 }}>{row.hand}</span>
            </span>
            <span style={{ fontSize: isMobile ? 8 : 9, color: 'rgba(255,255,255,0.55)', textAlign: 'right' }}>{row.kRate.toFixed(0)}%</span>
            <span style={{ fontSize: isMobile ? 8 : 9, color: 'rgba(255,255,255,0.75)', textAlign: 'right' }}>
              {row.adj.toFixed(1)}%
            </span>
            <span style={{ fontSize: isMobile ? 8 : 9, color: 'rgba(255,255,255,0.7)', textAlign: 'right' }}>{row.expK.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Single Pitcher Panel ──────────────────────────────────────────────────────

interface PitcherPanelProps {
  prop: StrikeoutPropRow | null | undefined;
  teamAbbrev: string;
  isMobile: boolean;
  isAway: boolean;
}

function PitcherPanel({ prop, teamAbbrev, isMobile, isAway }: PitcherPanelProps) {
  const photo = mlbPhoto(prop?.mlbamId);
  const color = teamColor(teamAbbrev);

  if (!prop) {
    return (
      <div style={{
        flex: 1,
        padding: isMobile ? '10px 10px' : '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        borderLeft: !isAway ? '1px solid #182433' : undefined,
        borderRight: isAway && !isMobile ? '1px solid #182433' : undefined,
        minHeight: 120,
      }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>No projection available</span>
      </div>
    );
  }

  const kProj = fmtNum(prop.kProj, 2);
  const bookLine = prop.bookLine ? fmtNum(prop.bookLine, 1) : '—';
  const pOver = fmtPct(prop.pOver);
  const pUnder = fmtPct(prop.pUnder);
  const bestEdgeVal = prop.bestEdge ? parseFloat(prop.bestEdge) * 100 : null;
  const edgeColor = getEdgeColor(prop.bestEdge);
  const verdictColor = getVerdictColor(prop.bestSide);

  return (
    <div style={{
      flex: 1,
      padding: isMobile ? '10px 10px' : '14px 16px',
      borderLeft: !isAway ? '1px solid #182433' : undefined,
      borderRight: isAway && !isMobile ? '1px solid #182433' : undefined,
      minWidth: 0,
    }}>
      {/* Pitcher header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 7 : 10, marginBottom: 10 }}>
        {/* Headshot */}
        <div style={{
          width: isMobile ? 36 : 48,
          height: isMobile ? 36 : 48,
          borderRadius: '50%',
          background: `radial-gradient(circle at 35% 35%, ${color}, ${teamDark(teamAbbrev)})`,
          flexShrink: 0,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {photo ? (
            <img
              src={photo}
              alt={prop.pitcherName}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <span style={{ fontSize: isMobile ? 14 : 18, fontWeight: 900, color: '#fff' }}>
              {prop.pitcherName.charAt(0)}
            </span>
          )}
        </div>
        {/* Name + hand */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "'Barlow Condensed', sans-serif",
            fontSize: isMobile ? 13 : 15,
            fontWeight: 900,
            color: '#FFFFFF',
            letterSpacing: '0.3px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {prop.pitcherName}
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 2 }}>
            {prop.pitcherHand && (
              <span style={{
                fontSize: 9,
                fontWeight: 700,
                color: 'rgba(255,255,255,0.5)',
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 3,
                padding: '1px 4px',
                textTransform: 'uppercase',
                letterSpacing: '0.3px',
              }}>
                {prop.pitcherHand}HP
              </span>
            )}
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>
              {isAway ? 'Away' : 'Home'} SP
            </span>
          </div>
        </div>
      </div>

      {/* K Projection row */}
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        padding: isMobile ? '8px 10px' : '10px 12px',
        marginBottom: 8,
      }}>
        {/* Main projection */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
          <span style={{
            fontFamily: "'Barlow Condensed', sans-serif",
            fontSize: isMobile ? 28 : 34,
            fontWeight: 900,
            color: color,
            lineHeight: 1,
          }}>
            {kProj}
          </span>
          <span style={{ fontSize: isMobile ? 10 : 11, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>
            PROJ K
          </span>
          {prop.kPer9 && (
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' }}>
              {fmtNum(prop.kPer9, 1)} K/9
            </span>
          )}
        </div>

        {/* Book line vs model line */}
        <div style={{ display: 'flex', gap: isMobile ? 8 : 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Book Line</div>
            <div style={{ fontSize: isMobile ? 13 : 14, fontWeight: 700, color: '#FFFFFF', marginTop: 1 }}>
              {bookLine}
              {prop.bookOverOdds && (
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginLeft: 3 }}>
                  {prop.bookOverOdds}/{prop.bookUnderOdds}
                </span>
              )}
            </div>
          </div>
          {prop.kLine && (
            <div>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Model Line</div>
              <div style={{ fontSize: isMobile ? 13 : 14, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginTop: 1 }}>
                {fmtNum(prop.kLine, 1)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Over / Under probabilities */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 6,
        marginBottom: 8,
      }}>
        {/* Over */}
        <div style={{
          background: prop.bestSide === 'OVER' ? 'rgba(57,255,20,0.08)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${prop.bestSide === 'OVER' ? 'rgba(57,255,20,0.25)' : 'rgba(255,255,255,0.07)'}`,
          borderRadius: 6,
          padding: isMobile ? '6px 8px' : '8px 10px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Over {bookLine}</div>
          <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 900, color: prop.bestSide === 'OVER' ? '#39FF14' : 'rgba(255,255,255,0.7)' }}>
            {pOver}
          </div>
          {prop.modelOverOdds && (
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>{prop.modelOverOdds}</div>
          )}
        </div>
        {/* Under */}
        <div style={{
          background: prop.bestSide === 'UNDER' ? 'rgba(0,191,255,0.08)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${prop.bestSide === 'UNDER' ? 'rgba(0,191,255,0.25)' : 'rgba(255,255,255,0.07)'}`,
          borderRadius: 6,
          padding: isMobile ? '6px 8px' : '8px 10px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Under {bookLine}</div>
          <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 900, color: prop.bestSide === 'UNDER' ? '#00BFFF' : 'rgba(255,255,255,0.7)' }}>
            {pUnder}
          </div>
          {prop.modelUnderOdds && (
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>{prop.modelUnderOdds}</div>
          )}
        </div>
      </div>

      {/* Verdict badge */}
      {prop.bestSide && prop.bestSide !== 'PASS' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(255,255,255,0.04)',
          border: `1px solid ${verdictColor}33`,
          borderRadius: 6,
          padding: isMobile ? '5px 8px' : '6px 10px',
          marginBottom: 8,
        }}>
          <div style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: verdictColor,
            flexShrink: 0,
          }} />
          <span style={{ fontSize: isMobile ? 10 : 11, fontWeight: 700, color: verdictColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {prop.bestSide}
          </span>
          {bestEdgeVal !== null && (
            <span style={{ fontSize: 9, color: edgeColor, marginLeft: 'auto' }}>
              +{bestEdgeVal.toFixed(1)}pp edge
            </span>
          )}
          {prop.bestMlStr && (
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', marginLeft: 4 }}>
              {prop.bestMlStr}
            </span>
          )}
        </div>
      )}

      {/* Range */}
      {(prop.kP5 || prop.kP95) && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>
            5th–95th Percentile Range
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: isMobile ? 10 : 11, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{fmtNum(prop.kP5, 1)}</span>
            <div style={{ flex: 1, height: 2, background: 'rgba(255,255,255,0.1)', borderRadius: 1, position: 'relative' }}>
              {prop.kProj && prop.kP5 && prop.kP95 && (() => {
                const p5 = parseFloat(prop.kP5);
                const p95 = parseFloat(prop.kP95);
                const proj = parseFloat(prop.kProj);
                const range = p95 - p5;
                if (range <= 0) return null;
                const pct = ((proj - p5) / range) * 100;
                return (
                  <div style={{
                    position: 'absolute',
                    left: `${Math.max(0, Math.min(100, pct))}%`,
                    top: -3,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: color,
                    transform: 'translateX(-50%)',
                  }} />
                );
              })()}
            </div>
            <span style={{ fontSize: isMobile ? 10 : 11, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{fmtNum(prop.kP95, 1)}</span>
          </div>
        </div>
      )}

      {/* Distribution chart */}
      <DistributionChart distribution={prop.distribution} bookLine={prop.bookLine} isMobile={isMobile} />

      {/* Signal breakdown */}
      <SignalBreakdown signalBreakdown={prop.signalBreakdown} isMobile={isMobile} />

      {/* Matchup rows */}
      <MatchupRows matchupRows={prop.matchupRows} isMobile={isMobile} />

      {/* Model run time */}
      {prop.modelRunAt && (
        <div style={{ marginTop: 8, fontSize: 8, color: 'rgba(255,255,255,0.2)', textAlign: 'right' }}>
          Model run: {new Date(prop.modelRunAt).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })} ET
        </div>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function MlbPropsCard({ awayTeam, homeTeam, startTime, props }: MlbPropsCardProps) {
  const awayInfo = MLB_BY_ABBREV.get(awayTeam.toUpperCase());
  const homeInfo = MLB_BY_ABBREV.get(homeTeam.toUpperCase());

  const awayColor = awayInfo?.primaryColor ?? '#4A90D9';
  const awayDark  = awayInfo?.secondaryColor ?? '#1A3A5C';
  const homeColor = homeInfo?.primaryColor ?? '#4A90D9';
  const homeDark  = homeInfo?.secondaryColor ?? '#1A3A5C';

  // Use window.innerWidth to detect mobile — same approach as MlbLineupCard
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  const awayProp = props?.find(p => p.side === 'away');
  const homeProp = props?.find(p => p.side === 'home');

  const awayCity     = awayInfo?.city ?? awayTeam;
  const awayNickname = awayInfo?.nickname ?? awayTeam;
  const homeCity     = homeInfo?.city ?? homeTeam;
  const homeNickname = homeInfo?.nickname ?? homeTeam;

  return (
    <div
      style={{
        background: '#090E14',
        borderRadius: 12,
        border: '1px solid #182433',
        overflow: 'hidden',
        marginBottom: 10,
      }}
    >
      {/* Color top bar */}
      <div
        style={{
          height: 3,
          background: `linear-gradient(90deg, ${awayColor} 48%, ${homeColor} 52%)`,
        }}
      />

      {/* ── Matchup header ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          padding: isMobile ? '8px 10px 6px' : '14px 18px 12px',
          borderBottom: '1px solid #182433',
          gap: isMobile ? 6 : 10,
        }}
      >
        {/* Away team */}
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 7 : 12 }}>
          <div style={{
            width: isMobile ? 28 : 42,
            height: isMobile ? 28 : 42,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: `radial-gradient(circle at 35% 35%, ${awayColor}, ${awayDark})`,
            flexShrink: 0,
            overflow: 'hidden',
          }}>
            <img
              src={awayInfo?.logoUrl}
              alt={awayTeam}
              style={{ width: isMobile ? 18 : 28, height: isMobile ? 18 : 28, objectFit: 'contain' }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
          <div>
            <div style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: isMobile ? 11 : 13,
              fontWeight: 900,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              color: '#FFFFFF',
              lineHeight: 1.1,
            }}>
              {awayCity}
            </div>
            <div style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: isMobile ? 13 : 16,
              fontWeight: 900,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              color: awayColor,
              lineHeight: 1.1,
            }}>
              {awayNickname}
            </div>
          </div>
        </div>

        {/* Center: time + PROPS badge */}
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <div style={{
            fontFamily: "'Barlow Condensed', sans-serif",
            fontSize: isMobile ? 9 : 10,
            fontWeight: 700,
            color: 'rgba(255,255,255,0.4)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginBottom: 2,
          }}>
            K PROPS
          </div>
          <div style={{
            fontSize: isMobile ? 10 : 12,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.6)',
          }}>
            {startTime}
          </div>
        </div>

        {/* Home team */}
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 7 : 12, justifyContent: 'flex-end' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: isMobile ? 11 : 13,
              fontWeight: 900,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              color: '#FFFFFF',
              lineHeight: 1.1,
            }}>
              {homeCity}
            </div>
            <div style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: isMobile ? 13 : 16,
              fontWeight: 900,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              color: homeColor,
              lineHeight: 1.1,
            }}>
              {homeNickname}
            </div>
          </div>
          <div style={{
            width: isMobile ? 28 : 42,
            height: isMobile ? 28 : 42,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: `radial-gradient(circle at 35% 35%, ${homeColor}, ${homeDark})`,
            flexShrink: 0,
            overflow: 'hidden',
          }}>
            <img
              src={homeInfo?.logoUrl}
              alt={homeTeam}
              style={{ width: isMobile ? 18 : 28, height: isMobile ? 18 : 28, objectFit: 'contain' }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
        </div>
      </div>

      {/* ── Pitcher panels ── */}
      {(!props || props.length === 0) ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px 16px',
          flexDirection: 'column',
          gap: 8,
        }}>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', fontWeight: 600 }}>No strikeout projections yet</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>Run the model to generate K props for this game.</span>
        </div>
      ) : (
        <div style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: 'stretch',
        }}>
          <PitcherPanel prop={awayProp} teamAbbrev={awayTeam} isMobile={isMobile} isAway={true} />
          <PitcherPanel prop={homeProp} teamAbbrev={homeTeam} isMobile={isMobile} isAway={false} />
        </div>
      )}
    </div>
  );
}

export default MlbPropsCard;
