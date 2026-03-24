/**
 * MlbLineupCard
 *
 * Displays a single MLB game's confirmed starting lineups, pitchers, and weather.
 * Design matches mlb_lineup_feed.html mockup:
 *   - Dark card with team-color top bar
 *   - Pitcher headshots from img.mlbstatic.com
 *   - 9-man batting order with position badges and L/R/S handedness
 *   - Weather strip at bottom
 */

import { useMemo } from "react";
import { MLB_BY_ABBREV } from "@shared/mlbTeams";
// Types matching the DB schema (defined locally to avoid cross-boundary imports)
export interface LineupPlayer {
  battingOrder: number;
  position: string;
  name: string;
  bats: string; // 'R' | 'L' | 'S'
  rotowireId: number | null;
  mlbamId: number | null;
}

export interface MlbLineupRow {
  id: number;
  gameId: number;
  scrapedAt: number;
  awayPitcherName: string | null;
  awayPitcherHand: string | null;
  awayPitcherEra: string | null;
  awayPitcherRotowireId: number | null;
  awayPitcherMlbamId: number | null;
  awayPitcherConfirmed: boolean | null;
  homePitcherName: string | null;
  homePitcherHand: string | null;
  homePitcherEra: string | null;
  homePitcherRotowireId: number | null;
  homePitcherMlbamId: number | null;
  homePitcherConfirmed: boolean | null;
  awayLineup: string | null;
  homeLineup: string | null;
  awayLineupConfirmed: boolean | null;
  homeLineupConfirmed: boolean | null;
  weatherIcon: string | null;
  weatherTemp: string | null;
  weatherWind: string | null;
  weatherPrecip: number | null;
  weatherDome: boolean | null;
  umpire: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── MLB headshot CDN ──────────────────────────────────────────────────────────
const mlbPhoto = (id: number | null | undefined): string | null => {
  if (!id) return null;
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/${id}/headshot/67/current`;
};

// ─── Types ─────────────────────────────────────────────────────────────────────
interface MlbLineupCardProps {
  awayTeam: string;   // abbreviation e.g. "NYY"
  homeTeam: string;   // abbreviation e.g. "SF"
  startTime: string;  // e.g. "7:05 PM ET"
  lineup: MlbLineupRow | null | undefined;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function PlayerAvatar({ mlbamId, size }: { mlbamId: number | null | undefined; size: number }) {
  const url = mlbPhoto(mlbamId);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        flexShrink: 0,
        border: "1px solid #1E3048",
        background: "#101820",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          style={{ width: "130%", height: "130%", objectFit: "cover", objectPosition: "center 20%", marginTop: "-8%", marginLeft: "-15%" }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <div style={{ width: "100%", height: "100%", background: "#101820" }} />
      )}
    </div>
  );
}

function PitcherCol({
  name,
  hand,
  era,
  mlbamId,
  confirmed,
  align,
}: {
  name: string | null | undefined;
  hand: string | null | undefined;
  era: string | null | undefined;
  mlbamId: number | null | undefined;
  confirmed: boolean | null | undefined;
  align: "left" | "right";
}) {
  const isRight = align === "right";
  const displayName = name ?? "TBD";
  const displayEra = era ?? "—";

  return (
    <div
      style={{
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        alignItems: isRight ? "flex-end" : "flex-start",
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: "2px",
          textTransform: "uppercase",
          color: "#3A5A7A",
          marginBottom: 5,
        }}
      >
        Starting Pitcher
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexDirection: isRight ? "row-reverse" : "row",
        }}
      >
        <PlayerAvatar mlbamId={mlbamId} size={40} />
        <div style={{ textAlign: isRight ? "right" : "left" }}>
          <div
            style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: 16,
              fontWeight: 800,
              color: "#FFFFFF",
              lineHeight: 1.1,
            }}
          >
            {displayName}
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>
            {displayEra}
          </div>
          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              justifyContent: isRight ? "flex-end" : "flex-start",
              marginTop: 5,
            }}
          >
            {isRight && confirmed && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                  color: "#39FF14",
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "#39FF14",
                    display: "inline-block",
                  }}
                />
                Confirmed
              </span>
            )}
            {hand && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: "1.5px",
                  textTransform: "uppercase",
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: "#101820",
                  color: "#3A5A7A",
                  border: "1px solid #182433",
                  display: "inline-block",
                }}
              >
                {hand}HP
              </span>
            )}
            {!isRight && confirmed && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                  color: "#39FF14",
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "#39FF14",
                    display: "inline-block",
                  }}
                />
                Confirmed
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LineupRows({ players, align }: { players: LineupPlayer[]; align: "left" | "right" }) {
  if (players.length === 0) {
    return (
      <div
        style={{
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          minHeight: 80,
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: "#3A5A7A",
            fontWeight: 600,
            letterSpacing: "1px",
            textTransform: "uppercase",
          }}
        >
          Lineup Pending
        </span>
      </div>
    );
  }

  const isRight = align === "right";

  return (
    <div style={{ padding: "10px 14px" }}>
      {players.map((p, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "5px 0",
            borderBottom: i < players.length - 1 ? "1px solid rgba(24,36,51,0.6)" : "none",
            // Both sides use left-to-right order; home side content is right-aligned via flex
            flexDirection: "row",
            justifyContent: isRight ? "flex-end" : "flex-start",
          }}
        >
          {/* Away (left) layout: number | photo | position | name | bats */}
          {/* Home (right) layout: bats | name | position | photo | number — true mirror */}

          {/* Batting order number — left side of away, right side of home */}
          {!isRight && (
            <span
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: 11,
                fontWeight: 700,
                color: "#3A5A7A",
                minWidth: 14,
                flexShrink: 0,
                textAlign: "right",
              }}
            >
              {p.battingOrder}
            </span>
          )}

          {/* Bats indicator — only on home side, leftmost position */}
          {isRight && (
            <span style={{ fontSize: 9, color: "#3A5A7A", fontWeight: 600, flexShrink: 0, minWidth: 10, textAlign: "right" }}>
              {p.bats}
            </span>
          )}

          {/* Photo — left of position/name on away; right of name/position on home */}
          {!isRight && <PlayerAvatar mlbamId={p.mlbamId} size={32} />}

          {/* Position badge */}
          {!isRight && (
            <span
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.5px",
                textTransform: "uppercase",
                color: "#3A5A7A",
                minWidth: 22,
                flexShrink: 0,
              }}
            >
              {p.position}
            </span>
          )}

          {/* Player name — flex-1 to fill space */}
          <span
            style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: 14,
              fontWeight: 800,
              color: "#FFFFFF",
              flex: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              textAlign: isRight ? "right" : "left",
            }}
          >
            {p.name}
          </span>

          {/* Position badge — home side: after name */}
          {isRight && (
            <span
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.5px",
                textTransform: "uppercase",
                color: "#3A5A7A",
                minWidth: 22,
                flexShrink: 0,
                textAlign: "left",
              }}
            >
              {p.position}
            </span>
          )}

          {/* Photo — home side: after position */}
          {isRight && <PlayerAvatar mlbamId={p.mlbamId} size={32} />}

          {/* Batting order number — home side: rightmost */}
          {isRight && (
            <span
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: 11,
                fontWeight: 700,
                color: "#3A5A7A",
                minWidth: 14,
                flexShrink: 0,
                textAlign: "left",
              }}
            >
              {p.battingOrder}
            </span>
          )}

          {/* Bats indicator — away side: rightmost */}
          {!isRight && (
            <span style={{ fontSize: 9, color: "#3A5A7A", fontWeight: 600, flexShrink: 0, minWidth: 10 }}>
              {p.bats}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function WeatherStrip({ lineup }: { lineup: MlbLineupRow }) {
  const { weatherIcon, weatherTemp, weatherWind, weatherPrecip, weatherDome } = lineup;

  if (weatherDome) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: "10px 18px",
          background: "#0C1219",
        }}
      >
        <span style={{ fontSize: 16 }}>🏟️</span>
        <span
          style={{
            fontFamily: "'Barlow Condensed', sans-serif",
            fontSize: 13,
            fontWeight: 700,
            color: "#FFFFFF",
          }}
        >
          Dome
        </span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Indoor stadium</span>
      </div>
    );
  }

  if (!weatherTemp && !weatherWind && weatherPrecip == null) return null;

  const precipColor =
    weatherPrecip == null
      ? "#3A5A7A"
      : weatherPrecip === 0
      ? "#39FF14"
      : weatherPrecip < 30
      ? "#FFCC00"
      : "#FF2D55";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        padding: "10px 18px",
        background: "#0C1219",
      }}
    >
      {(weatherIcon || weatherTemp || weatherWind) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {weatherIcon && <span style={{ fontSize: 20, lineHeight: 1 }}>{weatherIcon}</span>}
          <div>
            {weatherTemp && (
              <div
                style={{
                  fontFamily: "'Barlow Condensed', sans-serif",
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#FFFFFF",
                }}
              >
                {weatherTemp}
              </div>
            )}
            {weatherWind && (
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
                {weatherWind}
              </div>
            )}
          </div>
        </div>
      )}
      {weatherPrecip != null && (
        <>
          <div style={{ width: 1, height: 28, background: "#1E3048" }} />
          <div>
            <div
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: 13,
                fontWeight: 700,
                textAlign: "center",
                color: precipColor,
              }}
            >
              {weatherPrecip}%
            </div>
            <div
              style={{
                fontSize: 9,
                color: "rgba(255,255,255,0.3)",
                letterSpacing: "1px",
                textTransform: "uppercase",
                marginTop: 1,
                textAlign: "center",
              }}
            >
              Precip
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function MlbLineupCard({ awayTeam, homeTeam, startTime, lineup }: MlbLineupCardProps) {
  const awayInfo = MLB_BY_ABBREV.get(awayTeam);
  const homeInfo = MLB_BY_ABBREV.get(homeTeam);

  const awayColor = awayInfo?.primaryColor ?? "#444";
  const awayDark = awayInfo?.secondaryColor ?? "#222";
  const homeColor = homeInfo?.primaryColor ?? "#444";
  const homeDark = homeInfo?.secondaryColor ?? "#222";

  const awayLineup = useMemo((): LineupPlayer[] => {
    if (!lineup?.awayLineup) return [];
    try { return JSON.parse(lineup.awayLineup) as LineupPlayer[]; } catch { return []; }
  }, [lineup?.awayLineup]);

  const homeLineup = useMemo((): LineupPlayer[] => {
    if (!lineup?.homeLineup) return [];
    try { return JSON.parse(lineup.homeLineup) as LineupPlayer[]; } catch { return []; }
  }, [lineup?.homeLineup]);

  const awayCity = awayInfo?.city ?? awayTeam;
  const awayNickname = awayInfo?.nickname ?? awayTeam;
  const homeCity = homeInfo?.city ?? homeTeam;
  const homeNickname = homeInfo?.nickname ?? homeTeam;

  return (
    <div
      style={{
        background: "#090E14",
        borderRadius: 12,
        border: "1px solid #182433",
        overflow: "hidden",
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

      {/* Matchup header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          padding: "14px 18px 12px",
          borderBottom: "1px solid #182433",
          gap: 10,
        }}
      >
        {/* Away team */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: `radial-gradient(circle at 35% 35%, ${awayColor}, ${awayDark})`,
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: 11,
              fontWeight: 800,
              color: "#fff",
              flexShrink: 0,
              overflow: "hidden",
            }}
          >
            <img
              src={awayInfo?.logoUrl}
              alt={awayTeam}
              style={{ width: 28, height: 28, objectFit: "contain" }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>
          <div>
            <div
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: 13,
                fontWeight: 900,
                letterSpacing: "0.5px",
                textTransform: "uppercase",
                color: "#FFFFFF",
                lineHeight: 1.1,
              }}
            >
              {awayCity}
            </div>
            <div
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: 11,
                fontWeight: 400,
                color: "rgba(255,255,255,0.5)",
                letterSpacing: "0.5px",
                marginTop: 1,
              }}
            >
              {awayNickname}
            </div>
            <div
              style={{
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: "1.5px",
                textTransform: "uppercase",
                padding: "1px 6px",
                borderRadius: 3,
                marginTop: 4,
                display: "inline-block",
                background: `${awayColor}22`,
                color: awayColor,
                border: `1px solid ${awayColor}44`,
              }}
            >
              Away
            </div>
          </div>
        </div>

        {/* Center: time + @ */}
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: 12,
              fontWeight: 700,
              color: "#FFFFFF",
              letterSpacing: "1px",
            }}
          >
            {startTime}
          </div>
          <div
            style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: 10,
              color: "#3A5A7A",
              letterSpacing: "3px",
              marginTop: 3,
            }}
          >
            @
          </div>
        </div>

        {/* Home team */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexDirection: "row-reverse" }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: `radial-gradient(circle at 35% 35%, ${homeColor}, ${homeDark})`,
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: 11,
              fontWeight: 800,
              color: "#fff",
              flexShrink: 0,
              overflow: "hidden",
            }}
          >
            <img
              src={homeInfo?.logoUrl}
              alt={homeTeam}
              style={{ width: 28, height: 28, objectFit: "contain" }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: 13,
                fontWeight: 900,
                letterSpacing: "0.5px",
                textTransform: "uppercase",
                color: "#FFFFFF",
                lineHeight: 1.1,
              }}
            >
              {homeCity}
            </div>
            <div
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: 11,
                fontWeight: 400,
                color: "rgba(255,255,255,0.5)",
                letterSpacing: "0.5px",
                marginTop: 1,
              }}
            >
              {homeNickname}
            </div>
            <div
              style={{
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: "1.5px",
                textTransform: "uppercase",
                padding: "1px 6px",
                borderRadius: 3,
                marginTop: 4,
                display: "inline-block",
                background: `${homeColor}22`,
                color: homeColor,
                border: `1px solid ${homeColor}44`,
              }}
            >
              Home
            </div>
          </div>
        </div>
      </div>

      {/* Pitchers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1px 1fr",
          borderBottom: "1px solid #182433",
        }}
      >
        <PitcherCol
          name={lineup?.awayPitcherName}
          hand={lineup?.awayPitcherHand}
          era={lineup?.awayPitcherEra}
          mlbamId={lineup?.awayPitcherMlbamId}
          confirmed={lineup?.awayPitcherConfirmed}
          align="left"
        />
        <div style={{ background: "#182433" }} />
        <PitcherCol
          name={lineup?.homePitcherName}
          hand={lineup?.homePitcherHand}
          era={lineup?.homePitcherEra}
          mlbamId={lineup?.homePitcherMlbamId}
          confirmed={lineup?.homePitcherConfirmed}
          align="right"
        />
      </div>

      {/* Batting lineups */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1px 1fr",
          borderBottom: "1px solid #182433",
        }}
      >
        <LineupRows players={awayLineup} align="left" />
        <div style={{ background: "#182433" }} />
        <LineupRows players={homeLineup} align="right" />
      </div>

      {/* Weather */}
      {lineup && <WeatherStrip lineup={lineup} />}
    </div>
  );
}
