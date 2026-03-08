/**
 * PublishProjections — Owner-only page for entering model projections and publishing games.
 *
 * Looks IDENTICAL to the Dashboard GameCard feed. The MODEL LINE and MODEL O/U
 * pill cells are editable inputs — @prez taps/clicks them and types the value.
 * Edge verdict at the bottom auto-calculates live as values are typed.
 *
 * Access: owner role only — non-owners are immediately redirected to /dashboard.
 * Backend: all procedures use ownerProcedure (server-side owner check enforced).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2, Send, ChevronLeft, ChevronRight, Eye, EyeOff, Trophy, RefreshCw } from "lucide-react";
import { getTeamByDbSlug } from "@shared/ncaamTeams";
import { getNbaTeamByDbSlug } from "@shared/nbaTeams";
import { BettingSplitsPanel } from "@/components/BettingSplitsPanel";

// ─── Helpers (mirrors GameCard exactly) ──────────────────────────────────────

function formatTeamName(slug: string): string {
  return slug
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .replace("Mount St Marys", "Mt. St. Mary's")
    .replace("Nc Wilmington", "UNCW")
    .replace("Uab", "UAB")
    .replace("Utsa", "UTSA")
    .replace("College Of Charleston", "Charleston")
    .replace("Illinois Chicago", "UIC")
    .replace("Northern Iowa", "UNI")
    .replace("Southern Illinois", "SIU")
    .replace("Michigan State", "Michigan St.")
    .replace("Florida Atlantic", "FAU")
    .replace("Saint Peters", "Saint Peter's")
    .replace("Nc State", "NC State")
    .replace("Iupui", "IUPUI")
    .replace("Northern Arizona", "NAU")
    .replace("Iowa State", "Iowa St.")
    .replace("Eastern Washington", "EWU")
    .replace("Weber State", "Weber St.")
    .replace("Portland State", "Portland St.")
    .replace("Idaho State", "Idaho St.")
    .replace("Sacramento State", "Sac State");
}

function formatMilitaryTime(time: string): string {
  const upper = time?.toUpperCase() ?? "";
  if (!time || upper === "TBD" || upper === "TBA" || !time.includes(":")) return "TBD";
  const parts = time.split(":");
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1]?.slice(0, 2) ?? "00";
  if (isNaN(hours)) return "TBD";
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm} ET`;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function getEdgeColor(diff: number): string {
  if (diff <= 0)  return "hsl(var(--muted-foreground))";
  if (diff < 1.5) return "#FF3131";
  if (diff < 2.0) return "#FF6B00";
  if (diff < 2.5) return "#FF9500";
  if (diff < 3.0) return "#FFB800";
  if (diff < 3.5) return "#FFD700";
  if (diff < 4.0) return "#FFFF33";
  if (diff < 4.5) return "#AAFF1A";
  return "#39FF14";
}

function spreadSign(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function toNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === "") return NaN;
  return typeof v === "number" ? v : parseFloat(v as string);
}

function normalizeEdgeLabel(label: string | null | undefined): string {
  if (!label || label.toUpperCase() === "PASS") return "PASS";
  return label.replace(/^([a-z][a-z0-9_]*)(\s+\()/i, (_, slug, rest) => {
    const ncaa = getTeamByDbSlug(slug);
    if (ncaa) return ncaa.ncaaName + rest;
    const nba = getNbaTeamByDbSlug(slug);
    if (nba) return nba.name + rest;
    return formatTeamName(slug) + rest;
  });
}

// ─── TeamLogo (identical to GameCard) ────────────────────────────────────────

function TeamLogo({ slug, name, logoUrl }: { slug: string; name: string; logoUrl?: string }) {
  const [error, setError] = useState(false);
  if (!logoUrl || error) {
    return (
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
        style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}
      >
        {name.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={logoUrl}
      alt={name}
      className="w-9 h-9 object-contain flex-shrink-0"
      style={{ mixBlendMode: "screen" }}
      onError={() => setError(true)}
    />
  );
}

// ─── EditablePill — looks like the dark pill but is an input ─────────────────

function EditablePill({
  value,
  onChange,
  placeholder,
  prefix,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  prefix?: string;   // "O" or "U" shown before the number
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const hasValue = value !== "" && !isNaN(parseFloat(value));

  return (
    <div
      className="flex items-center justify-center rounded-lg"
      style={{
        background: "rgba(255,255,255,0.08)",
        minWidth: prefix ? "64px" : "48px",
        width: "auto",
        maxWidth: "90px",
        padding: "0 10px",
        height: "36px",
        cursor: "text",
      }}
    >
      {prefix && (
        <span
          className="font-bold flex-shrink-0 mr-1"
          style={{
            fontSize: "clamp(13px, 3.5vw, 15px)",
            color: hasValue ? "#FFFFFF" : "hsl(var(--muted-foreground))",
            userSelect: "none",
          }}
        >
          {prefix}
        </span>
      )}
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "—"}
        className="bg-transparent border-none outline-none text-center font-bold w-full"
        style={{
          fontSize: "clamp(13px, 3.5vw, 15px)",
          color: hasValue ? "#FFFFFF" : "hsl(var(--muted-foreground))",
          caretColor: "#39FF14",
          minWidth: 0,
        }}
      />
    </div>
  );
}

// ─── EditableTeamRow — identical layout to GameCard TeamRow ──────────────────

function EditableTeamRow({
  slug, name, nickname, consensus, modelSpread,
  logoUrl, onSpreadChange, spreadInputRef,
}: {
  slug: string; name: string; nickname?: string;
  consensus: string; modelSpread: string;
  logoUrl?: string;
  onSpreadChange: (v: string) => void;
  spreadInputRef?: React.RefObject<HTMLInputElement | null>;
}) {

  return (
    <div className="flex items-center gap-1.5 py-1.5 min-w-0">
      {/* Logo */}
      <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center">
        <TeamLogo slug={slug} name={name} logoUrl={logoUrl} />
      </div>

      {/* Team name — school on top, nickname on bottom */}
      {/* Width handles longest NBA city names: "Oklahoma City" (13 chars), "Golden State" (12 chars) */}
      <div
        className="flex-shrink-0 flex flex-col justify-center overflow-hidden"
        style={{ width: "clamp(108px, 28vw, 135px)" }}
      >
        <div
          className="font-bold leading-none"
          style={{
            fontSize: "clamp(11px, 2.8vw, 13px)",
            color: "hsl(var(--foreground))",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </div>
        {nickname && (
          <div
            className="font-medium leading-none mt-0.5"
            style={{
              fontSize: "clamp(9px, 2.2vw, 11px)",
              color: "hsl(var(--muted-foreground))",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {nickname}
          </div>
        )}
      </div>

      {/* 2 data columns: BOOKS | MODEL LINE */}
      <div className="flex-1 grid min-w-0" style={{ gridTemplateColumns: "1fr 1fr", gap: "4px" }}>

        {/* BOOKS — plain consensus number, same as GameCard */}
        <div className="flex items-center justify-center">
          <span
            className="font-bold leading-none whitespace-nowrap"
            style={{ fontSize: "clamp(13px, 3.5vw, 16px)", color: "#D3D3D3" }}
          >
            {consensus}
          </span>
        </div>

        {/* MODEL LINE — editable pill */}
        <div className="flex items-center justify-center">
          <EditablePill
            value={modelSpread}
            onChange={onSpreadChange}
            placeholder="—"
            inputRef={spreadInputRef}
          />
        </div>

      </div>
    </div>
  );
}

// ─── EdgeVerdictLive — auto-calculates as @prez types ────────────────────────

function EdgeVerdictLive({
  spreadDiff, spreadEdge, totalDiff, totalEdge,
}: {
  spreadDiff: number; spreadEdge: string;
  totalDiff: number; totalEdge: string;
}) {
  const spreadPass = normalizeEdgeLabel(spreadEdge) === "PASS" || spreadDiff <= 0;
  const totalPass  = normalizeEdgeLabel(totalEdge)  === "PASS" || totalDiff  <= 0;

  if (spreadPass && totalPass) {
    return (
      <div
        className="mt-2 pt-2 flex items-center justify-center"
        style={{ borderTop: "1px solid hsl(var(--border))" }}
      >
        <span
          className="text-xs font-medium tracking-widest uppercase"
          style={{ color: "hsl(var(--muted-foreground) / 0.35)" }}
        >
          PASS
        </span>
      </div>
    );
  }

  const spreadColor = getEdgeColor(spreadDiff);
  const totalColor  = getEdgeColor(totalDiff);
  const isSpreadStrong = spreadDiff >= 3;
  const isTotalStrong  = totalDiff  >= 3;

  return (
    <div
      className="mt-2 pt-2 flex items-center"
      style={{ borderTop: "1px solid hsl(var(--border))" }}
    >
      {!spreadPass && (
        <div className="flex-1 flex flex-col items-center gap-1 py-0.5">
          <span
            className="font-bold leading-none whitespace-nowrap"
            style={{ fontSize: isSpreadStrong ? "13px" : "12px", color: "hsl(var(--foreground))" }}
          >
            {isSpreadStrong && <span className="mr-0.5 text-[10px]" style={{ color: spreadColor }}>▲</span>}
            {normalizeEdgeLabel(spreadEdge)}
          </span>
          <span className="text-[11px] leading-none" style={{ color: "hsl(var(--muted-foreground))", fontWeight: 500 }}>
            EDGE:{" "}
            <span style={{ color: spreadColor, fontWeight: 700 }}>
              {spreadDiff} {spreadDiff === 1 ? "pt" : "pts"}
            </span>
          </span>
        </div>
      )}
      {!spreadPass && !totalPass && (
        <div style={{ width: 1, alignSelf: "stretch", background: "hsl(var(--border))", margin: "0 8px" }} />
      )}
      {!totalPass && (
        <div className="flex-1 flex flex-col items-center gap-1 py-0.5">
          <span
            className="font-bold leading-none whitespace-nowrap"
            style={{ fontSize: isTotalStrong ? "13px" : "12px", color: "hsl(var(--foreground))" }}
          >
            {isTotalStrong && <span className="mr-0.5 text-[10px]" style={{ color: totalColor }}>▲</span>}
            {normalizeEdgeLabel(totalEdge)}
          </span>
          <span className="text-[11px] leading-none" style={{ color: "hsl(var(--muted-foreground))", fontWeight: 500 }}>
            EDGE:{" "}
            <span style={{ color: totalColor, fontWeight: 700 }}>
              {totalDiff} {totalDiff === 1 ? "pt" : "pts"}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type GameRow = {
  id: number;
  awayTeam: string;
  homeTeam: string;
  awayBookSpread: string | null;
  homeBookSpread: string | null;
  bookTotal: string | null;
  awayModelSpread: string | null;
  homeModelSpread: string | null;
  modelTotal: string | null;
  spreadEdge: string | null;
  spreadDiff: string | null;
  totalEdge: string | null;
  totalDiff: string | null;
  publishedToFeed: boolean;
  startTimeEst: string;
  gameDate: string;
  gameType: "regular_season" | "conference_tournament";
  conference: string | null;
  sport: string | null;
  // Betting splits
  spreadAwayBetsPct: number | null;
  spreadAwayMoneyPct: number | null;
  totalOverBetsPct: number | null;
  totalOverMoneyPct: number | null;
  mlAwayBetsPct: number | null;
  mlAwayMoneyPct: number | null;
  awayML: string | null;
  homeML: string | null;
};

// ─── EditableGameCard ─────────────────────────────────────────────────────────

function EditableGameCard({ game, onSaved }: { game: GameRow; onSaved: () => void }) {
  const [awaySpread, setAwaySpread] = useState(game.awayModelSpread ?? "");
  const [homeSpread, setHomeSpread] = useState(game.homeModelSpread ?? "");
  const [modelTotal, setModelTotal] = useState(game.modelTotal ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Track whether this game has ever been submitted in this session
  // (or was already submitted before — i.e. has model data from the server)
  const [hasBeenSubmitted, setHasBeenSubmitted] = useState(
    !!(game.awayModelSpread || game.modelTotal)
  );
  const awaySpreadRef = useRef<HTMLInputElement | null>(null);

  const updateMutation = trpc.games.updateProjections.useMutation();
  const publishMutation = trpc.games.setPublished.useMutation();

  // Sync from server when game data refreshes (don't overwrite if user is typing)
  useEffect(() => {
    if (!dirty) {
      setAwaySpread(game.awayModelSpread ?? "");
      setHomeSpread(game.homeModelSpread ?? "");
      setModelTotal(game.modelTotal ?? "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.awayModelSpread, game.homeModelSpread, game.modelTotal]);

  // Away spread change → auto-compute home spread as inverse
  const handleAwaySpreadChange = (val: string) => {
    setAwaySpread(val);
    const n = parseFloat(val);
    if (!isNaN(n)) setHomeSpread(n === 0 ? "0" : String(-n));
    setDirty(true);
  };

  // Home spread change → auto-compute away spread as inverse
  const handleHomeSpreadChange = (val: string) => {
    setHomeSpread(val);
    const n = parseFloat(val);
    if (!isNaN(n)) setAwaySpread(n === 0 ? "0" : String(-n));
    setDirty(true);
  };

  const handleTotalChange = (val: string) => {
    setModelTotal(val);
    setDirty(true);
  };

  // Compute edge labels live from current input values
  function computeEdges() {
    const awayN    = parseFloat(awaySpread);
    const homeN    = parseFloat(homeSpread);
    const totalN   = parseFloat(modelTotal);
    const awayBook = toNum(game.awayBookSpread);
    const homeBook = toNum(game.homeBookSpread);
    const bookTot  = toNum(game.bookTotal);

    let spreadEdge: string | null = null;
    let spreadDiff: string | null = null;
    let totalEdge: string | null  = null;
    let totalDiffVal: string | null = null;

    if (!isNaN(awayN) && !isNaN(homeN) && !isNaN(awayBook) && !isNaN(homeBook)) {
      // Positive diff = model is more favorable for that team vs book
      const awayDiff = awayBook - awayN;
      const homeDiff = homeBook - homeN;
      const useAway  = Math.abs(awayDiff) >= Math.abs(homeDiff);
      const bestDiff = useAway ? awayDiff : homeDiff;
      const edgeTeam   = useAway ? game.awayTeam : game.homeTeam;
      const edgeSpread = useAway ? awayN : homeN;

      if (Math.abs(bestDiff) > 0) {
        spreadEdge = `${edgeTeam} (${edgeSpread > 0 ? "+" : ""}${edgeSpread})`;
        spreadDiff = String(Math.round(Math.abs(bestDiff) * 10) / 10);
      } else {
        spreadEdge = "PASS";
        spreadDiff = "0";
      }
    }

    if (!isNaN(totalN) && !isNaN(bookTot)) {
      const diff = Math.round((totalN - bookTot) * 10) / 10;
      if (diff > 0) {
        totalEdge    = `OVER ${totalN}`;
        totalDiffVal = String(Math.abs(diff));
      } else if (diff < 0) {
        totalEdge    = `UNDER ${totalN}`;
        totalDiffVal = String(Math.abs(diff));
      } else {
        totalEdge    = "PASS";
        totalDiffVal = "0";
      }
    }

    return { spreadEdge, spreadDiff, totalEdge, totalDiff: totalDiffVal };
  }

  const handleSave = async () => {
    setSaving(true);
    const isFirstSubmit = !hasBeenSubmitted;
    try {
      const edges = computeEdges();
      await updateMutation.mutateAsync({
        id: game.id,
        awayModelSpread: awaySpread || null,
        homeModelSpread: homeSpread || null,
        modelTotal: modelTotal || null,
        ...edges,
      });
      setDirty(false);
      setHasBeenSubmitted(true);
      toast.success(isFirstSubmit ? "Projections submitted ✓" : "Projections saved");
      onSaved();
    } catch {
      toast.error(isFirstSubmit ? "Failed to submit projections" : "Failed to save projections");
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePublish = async () => {
    // Auto-save unsaved changes before toggling publish
    if (dirty) await handleSave();
    try {
      await publishMutation.mutateAsync({ id: game.id, published: !game.publishedToFeed });
      toast.success(game.publishedToFeed ? "Removed from feed" : "Published to feed ✓");
      onSaved();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update publish status";
      toast.error(msg.includes("no live VSiN odds") ? "No VSiN odds yet — cannot publish" : "Failed to update publish status");
    }
  };

  // ── Derived display values ──────────────────────────────────────────────────
  const awayBookSpread = toNum(game.awayBookSpread);
  const homeBookSpread = toNum(game.homeBookSpread);
  const bookTotal      = toNum(game.bookTotal);

  // BOOKS column: show spread for the favorite, total for the underdog (same as GameCard)
  const awayConsensus = awayBookSpread < 0 ? spreadSign(awayBookSpread) : isNaN(bookTotal) ? "—" : `${bookTotal}`;
  const homeConsensus = homeBookSpread < 0 ? spreadSign(homeBookSpread) : isNaN(bookTotal) ? "—" : `${bookTotal}`;

  // Live edge preview
  const edges = computeEdges();
  const previewSpreadDiff = parseFloat(edges.spreadDiff ?? "0") || 0;
  const previewTotalDiff  = parseFloat(edges.totalDiff  ?? "0") || 0;
  const maxDiff = Math.max(previewSpreadDiff, previewTotalDiff);

  // Border color: green if published, edge-colored if has model data, dim if empty
  const borderColor = game.publishedToFeed
    ? "#39FF14"
    : maxDiff > 0
      ? getEdgeColor(maxDiff)
      : "hsl(var(--border))";

  const awayNcaa = getTeamByDbSlug(game.awayTeam);
  const homeNcaa = getTeamByDbSlug(game.homeTeam);
  const awayNba  = !awayNcaa ? getNbaTeamByDbSlug(game.awayTeam) : null;
  const homeNba  = !homeNcaa ? getNbaTeamByDbSlug(game.homeTeam) : null;
  // For NBA: show city on line 1, nickname on line 2 (mirrors NCAAM school/nickname layout)
  const awayName     = awayNcaa?.ncaaName ?? awayNba?.city ?? formatTeamName(game.awayTeam);
  const homeName     = homeNcaa?.ncaaName ?? homeNba?.city ?? formatTeamName(game.homeTeam);
  const awayNickname = awayNcaa?.ncaaNickname ?? awayNba?.nickname ?? undefined;
  const homeNickname = homeNcaa?.ncaaNickname ?? homeNba?.nickname ?? undefined;
  const awayLogoUrl  = awayNcaa?.logoUrl ?? awayNba?.logoUrl ?? undefined;
  const homeLogoUrl  = homeNcaa?.logoUrl ?? homeNba?.logoUrl ?? undefined;
  const time      = formatMilitaryTime(game.startTimeEst);
  // Midnight ET games (startTimeEst = "00:00") are stored under the actual play date (e.g. Mar 5)
  // but the ET clock has rolled over to the next day (e.g. Fri, Mar 6 · 12:00 AM ET).
  const displayDate = (() => {
    if (game.startTimeEst === "00:00") {
      const d = new Date(game.gameDate + "T00:00:00");
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    }
    return game.gameDate;
  })();
  const dateLabel = formatDate(displayDate);

  const hasAnyModel = awaySpread !== "" || modelTotal !== "";
  const hasOdds = !isNaN(awayBookSpread) || !isNaN(bookTotal);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full rounded-xl overflow-hidden relative"
      style={{
        background: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))",
        borderLeft: `3px solid ${borderColor}`,
      }}
    >
      {/* Publish toggle — top right (mirrors the download button position in GameCard) */}
      <button
        onClick={handleTogglePublish}
        disabled={publishMutation.isPending || saving || (!game.publishedToFeed && !hasOdds)}
        className="absolute top-1.5 right-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all"
        style={game.publishedToFeed
          ? { background: "rgba(57,255,20,0.15)", color: "#39FF14", border: "1px solid rgba(57,255,20,0.35)" }
          : !hasOdds
            ? { background: "rgba(255,255,255,0.03)", color: "rgba(156,163,175,0.4)", border: "1px solid rgba(255,255,255,0.06)", cursor: "not-allowed" }
            : { background: "rgba(255,255,255,0.06)", color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))" }
        }
        title={game.publishedToFeed ? "Remove from feed" : !hasOdds ? "No VSiN odds yet — cannot publish" : "Publish to feed"}
      >
        {publishMutation.isPending || saving
          ? <Loader2 size={9} className="animate-spin" />
          : game.publishedToFeed
            ? <><Eye size={9} /> Live</>
            : !hasOdds
              ? <><EyeOff size={9} /> No Odds</>
              : <><EyeOff size={9} /> Off</>
        }
      </button>

      {/* Header — identical to GameCard */}
      <div
        className="flex items-center justify-center gap-1.5 px-4 py-2"
        style={{ background: "hsl(var(--background))", borderBottom: "1px solid hsl(var(--border))" }}
      >
        <span className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>
          {dateLabel}
        </span>
        <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>·</span>
        <span className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>
          {time}
        </span>
        {/* VSiN odds status indicator */}
        <span
          title={hasOdds ? "VSiN odds loaded" : "No VSiN odds yet"}
          className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: hasOdds ? "#39FF14" : "#FF3131", marginLeft: 2 }}
        />
        {game.gameType === "conference_tournament" && game.conference && (
          <>
            <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>·</span>
            <span className="text-[10px] font-medium flex items-center gap-0.5" style={{ color: "#FFB800" }}>
              <Trophy size={9} />
              {game.conference}
            </span>
          </>
        )}
      </div>

      {/* ── Two-column body: model inputs left (50%), splits right (50%) ── */}
      <div className="flex flex-col sm:flex-row min-h-0" style={{ borderTop: "1px solid hsl(var(--border))" }}>

        {/* LEFT: model inputs */}
        <div className="flex-1 min-w-0 px-3 pt-2 pb-3 flex flex-col justify-between" style={{ borderRight: "1px solid hsl(var(--border) / 0.5)" }}>
          {/* Column labels */}
          <div>
            <div
              className="flex items-center gap-1.5 pb-1.5"
              style={{ borderBottom: "1px solid hsl(var(--border) / 0.5)" }}
            >
              <div className="w-8 flex-shrink-0" />
              <div className="flex-shrink-0" style={{ width: "clamp(90px, 22vw, 120px)" }} />
              <div className="flex-1 grid text-center" style={{ gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
                <span className="text-[10px] uppercase tracking-widest" style={{ color: "#D3D3D3" }}>Books</span>
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#39FF14" }}>Model Line</span>
              </div>
              <div className="flex-shrink-0 text-center" style={{ width: "clamp(48px, 12vw, 72px)" }}>
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#39FF14" }}>O/U</span>
              </div>
            </div>
            {/* Team rows */}
            <div className="flex gap-1.5 min-w-0 mt-1">
              <div className="flex-1 min-w-0 flex flex-col">
                <EditableTeamRow
                  slug={game.awayTeam}
                  name={awayName}
                  nickname={awayNickname}
                  consensus={awayConsensus}
                  modelSpread={awaySpread}
                  logoUrl={awayLogoUrl}
                  onSpreadChange={handleAwaySpreadChange}
                  spreadInputRef={awaySpreadRef}
                />
                <div className="my-0.5" style={{ height: 1, background: "hsl(var(--border))" }} />
                <EditableTeamRow
                  slug={game.homeTeam}
                  name={homeName}
                  nickname={homeNickname}
                  consensus={homeConsensus}
                  modelSpread={homeSpread}
                  logoUrl={homeLogoUrl}
                  onSpreadChange={handleHomeSpreadChange}
                />
              </div>
              <div className="flex-shrink-0 flex items-center justify-center" style={{ width: "clamp(48px, 12vw, 72px)" }}>
                <EditablePill value={modelTotal} onChange={handleTotalChange} placeholder="—" />
              </div>
            </div>
          </div>
          {/* Save button + edge verdict */}
          <div>
            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || !dirty}
                className="h-7 px-4 text-xs gap-1.5 font-bold transition-all"
                style={dirty
                  ? { background: "#39FF14", color: "#000" }
                  : { background: "rgba(57,255,20,0.12)", color: "rgba(57,255,20,0.45)", border: "1px solid rgba(57,255,20,0.2)" }
                }
              >
                {saving && <Loader2 size={10} className="animate-spin" />}
                {saving
                  ? (hasBeenSubmitted ? "Saving…" : "Submitting…")
                  : dirty
                    ? (hasBeenSubmitted ? "Save" : "Submit")
                    : (hasBeenSubmitted ? "Saved" : "Submit")
                }
              </Button>
            </div>
            {hasAnyModel && (
              <EdgeVerdictLive
                spreadDiff={previewSpreadDiff}
                spreadEdge={edges.spreadEdge ?? "PASS"}
                totalDiff={previewTotalDiff}
                totalEdge={edges.totalEdge ?? "PASS"}
              />
            )}
          </div>
        </div>

        {/* RIGHT: betting splits — always visible */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <BettingSplitsPanel
            game={game}
            awayLabel={awayName}
            homeLabel={homeName}
          />
        </div>

      </div>
    </motion.div>
  );
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function todayPst(): string {
  const now = new Date();
  const pst = now.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
  const [mm, dd, yyyy] = pst.split("/");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function formatDateNav(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PublishProjections() {
  const [, setLocation] = useLocation();
  const { appUser, isOwner, loading: authLoading } = useAppAuth();
  const [filter, setFilter] = useState<"all" | "regular_season" | "conference_tournament">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "upcoming" | "live" | "final">("all");
  const [selectedSport, setSelectedSport] = useState<"NCAAM" | "NBA">("NCAAM");
  const [gameDate, setGameDate] = useState(() => todayPst());
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Reset status filter when sport changes to NBA (no status tracking yet)
  useEffect(() => {
    if (selectedSport === "NBA") setStatusFilter("all");
  }, [selectedSport]);

  // ── Strict owner-only guard ─────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && (!appUser || !isOwner)) {
      setLocation("/dashboard");
    }
  }, [authLoading, appUser, isOwner, setLocation]);

  const utils = trpc.useUtils();

  const {
    data: games,
    isLoading,
    refetch,
  } = trpc.games.listStaging.useQuery(
    { gameDate, sport: selectedSport },
    { enabled: !!appUser && isOwner, refetchOnWindowFocus: false }
  );

  const publishAllMutation = trpc.games.publishAll.useMutation({
    onSuccess: () => {
      toast.success("All games published to feed!");
      refetch();
    },
    onError: () => toast.error("Failed to publish all games"),
  });

  const triggerRefreshMutation = trpc.games.triggerRefresh.useMutation({
    onMutate: () => setIsRefreshing(true),
    onSuccess: (result) => {
      setIsRefreshing(false);
      const oddsMsg = result.updated + result.nbaUpdated > 0
        ? `${result.updated + result.nbaUpdated} odds updated`
        : "odds refreshed";
      toast.success(`Full refresh complete — ${oddsMsg}, scores updated`);
      // Invalidate all staging queries so all dates refresh
      utils.games.listStaging.invalidate();
      utils.games.lastRefresh.invalidate();
      refetch();
    },
    onError: () => {
      setIsRefreshing(false);
      toast.error("Refresh failed");
    },
  });

  // ── Auto-refresh status (server-driven, every 30 min) ──────────────────────
  const { data: lastRefresh } = trpc.games.lastRefresh.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  // Re-fetch game list whenever the server completes a new refresh
  const lastRefreshKey = lastRefresh?.refreshedAt ?? null;
  const prevRefreshKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastRefreshKey && lastRefreshKey !== prevRefreshKey.current) {
      prevRefreshKey.current = lastRefreshKey;
      refetch();
    }
  }, [lastRefreshKey, refetch]);

  const handleRefetch = useCallback(() => { refetch(); }, [refetch]);

  // Count live games for the LIVE badge
  const liveCount = (games ?? []).filter((g) => (g as GameRow & { gameStatus?: string }).gameStatus === 'live').length;

  const filtered = (games ?? []).filter((g) => {
    const typeOk = filter === "all" ? true : g.gameType === filter;
    const statusOk = statusFilter === "all" ? true : (g as GameRow & { gameStatus?: string }).gameStatus === statusFilter;
    return typeOk && statusOk;
  });

  // Stats scoped to the current league+date (games is already filtered by listStaging with {gameDate, sport})
  const publishedCount   = (games ?? []).filter((g) => g.publishedToFeed).length;
  const totalCount       = games?.length ?? 0;
  // "Modeled" = has both away spread AND total entered
  const withModelCount   = (games ?? []).filter((g) => g.awayModelSpread && g.modelTotal).length;
  // "All Odds" = has both spread AND total from VSiN/books
  const withOddsCount    = (games ?? []).filter((g) => g.awayBookSpread !== null && g.bookTotal !== null).length;
  const missingOddsCount = totalCount - withOddsCount;

  // Show loading spinner while auth resolves
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "hsl(var(--background))" }}>
        <Loader2 className="animate-spin" style={{ color: "#39FF14" }} />
      </div>
    );
  }

  // Render nothing while redirect fires
  if (!isOwner) return null;

  return (
    <div className="min-h-screen" style={{ background: "hsl(var(--background))" }}>

      {/* Sticky header — mirrors Dashboard header style */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
        {/* Top row: back + brand + publish all */}
        <div className="relative flex items-center px-4 py-2 max-w-3xl mx-auto">

          {/* Back button */}
          <button
            onClick={() => setLocation("/dashboard")}
            className="p-1.5 rounded-lg transition-colors hover:bg-white/10 mr-2 flex-shrink-0"
          >
            <ChevronLeft size={18} style={{ color: "hsl(var(--muted-foreground))" }} />
          </button>

          {/* Centered brand */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-none">
            <span
              className="font-black text-white whitespace-nowrap"
              style={{ fontSize: "clamp(13px, 3vw, 20px)", letterSpacing: "0.08em" }}
            >
              PREZ BETS
            </span>
            <span className="text-border" style={{ fontSize: "clamp(10px, 2vw, 14px)" }}>|</span>
            <span
              className="font-medium whitespace-nowrap"
              style={{ fontSize: "clamp(11px, 2.4vw, 16px)", letterSpacing: "0.1em", color: "#9CA3AF" }}
            >
              PUBLISH PROJECTIONS
            </span>
          </div>

          {/* Right: Publish All */}
          <div className="flex-1" />
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              size="sm"
              onClick={() => publishAllMutation.mutate({ gameDate, sport: selectedSport })}
              disabled={publishAllMutation.isPending || totalCount === 0}
              className="gap-1.5 text-xs h-8 font-bold"
              style={{ background: "#39FF14", color: "#000" }}
            >
              {publishAllMutation.isPending
                ? <Loader2 size={12} className="animate-spin" />
                : <Send size={12} />
              }
              Publish All
            </Button>
          </div>
        </div>

        {/* Date navigation row */}
        <div className="px-4 pb-1.5 max-w-3xl mx-auto flex items-center gap-2">
          {/* Prev day */}
          <button
            onClick={() => setGameDate(d => addDays(d, -1))}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-white/10 flex-shrink-0"
          >
            <ChevronLeft size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
          </button>

          {/* Date display — centered */}
          <div className="flex-1 flex items-center justify-center gap-2">
            <span className="text-xs font-bold text-foreground tracking-wide">
              {formatDateNav(gameDate)}
            </span>
            {gameDate === todayPst() && (
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                style={{ background: "rgba(57,255,20,0.15)", color: "#39FF14" }}
              >
                TODAY
              </span>
            )}
          </div>

          {/* Next day */}
          <button
            onClick={() => setGameDate(d => addDays(d, 1))}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-white/10 flex-shrink-0"
          >
            <ChevronRight size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
          </button>

          {/* Refresh Now button */}
          <button
            onClick={() => triggerRefreshMutation.mutate()}
            disabled={isRefreshing || triggerRefreshMutation.isPending}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all flex-shrink-0"
            style={isRefreshing || triggerRefreshMutation.isPending
              ? { background: "rgba(57,255,20,0.08)", color: "rgba(57,255,20,0.4)", border: "1px solid rgba(57,255,20,0.15)" }
              : { background: "rgba(57,255,20,0.12)", color: "#39FF14", border: "1px solid rgba(57,255,20,0.3)" }
            }
            title="Trigger immediate VSiN + NCAA refresh"
          >
            <RefreshCw
              size={11}
              className={isRefreshing || triggerRefreshMutation.isPending ? "animate-spin" : ""}
            />
            {isRefreshing || triggerRefreshMutation.isPending ? "Refreshing…" : "Refresh Now"}
          </button>
        </div>

        {/* Sport filter toggle */}
        <div className="px-4 pb-1 max-w-3xl mx-auto flex items-center gap-2">
          {/* NCAAM button */}
          <button
            onClick={() => setSelectedSport("NCAAM")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all"
            style={selectedSport === "NCAAM"
              ? { background: "rgba(57,255,20,0.15)", color: "#39FF14", border: "1px solid rgba(57,255,20,0.4)" }
              : { background: "hsl(var(--card))", color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))" }
            }
          >
            <img
              src="https://www.ncaa.com/march-madness-live/assets/icons/ncaa/disc.svg"
              alt="NCAA"
              width={16}
              height={16}
              style={{ opacity: selectedSport === "NCAAM" ? 1 : 0.5 }}
            />
            NCAAM
          </button>
          {/* NBA button */}
          <button
            onClick={() => setSelectedSport("NBA")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all"
            style={selectedSport === "NBA"
              ? { background: "rgba(200,16,46,0.15)", color: "#C8102E", border: "1px solid rgba(200,16,46,0.5)" }
              : { background: "hsl(var(--card))", color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))" }
            }
          >
            <img
              src="https://cdn.nba.com/logos/leagues/logo-nba.svg"
              alt="NBA"
              width={16}
              height={16}
              style={{ opacity: selectedSport === "NBA" ? 1 : 0.5 }}
            />
            NBA
          </button>
        </div>

        {/* Status filter tabs (NCAAM only) */}
        {selectedSport === "NCAAM" && (
          <div className="px-4 pb-1 max-w-3xl mx-auto flex items-center gap-1.5">
            {([
              { key: "all", label: "ALL" },
              { key: "upcoming", label: "UPCOMING" },
              { key: "live", label: "LIVE" },
              { key: "final", label: "FINAL" },
            ] as const).map(({ key, label }) => {
              const isActive = statusFilter === key;
              const isLive = key === "live";
              return (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  className="relative flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide transition-all"
                  style={isActive
                    ? isLive
                      ? { background: "rgba(239,68,68,0.18)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.45)" }
                      : { background: "rgba(57,255,20,0.12)", color: "#39FF14", border: "1px solid rgba(57,255,20,0.35)" }
                    : { background: "hsl(var(--card))", color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))" }
                  }
                >
                  {isLive && liveCount > 0 && (
                    <span
                      className="inline-block rounded-full"
                      style={{
                        width: 6, height: 6, flexShrink: 0,
                        background: "#ef4444",
                        boxShadow: isActive ? "0 0 6px #ef4444" : "none",
                        animation: "pulse 1.5s ease-in-out infinite",
                      }}
                    />
                  )}
                  {label}
                  {isLive && liveCount > 0 && (
                    <span
                      className="ml-0.5 text-[10px] font-black"
                      style={{ color: isActive ? "#ef4444" : "hsl(var(--muted-foreground))" }}
                    >
                      {liveCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Stats bar — slate completeness + refresh timestamps */}
        <div className="px-4 pb-3 max-w-3xl mx-auto">
          <div
            className="rounded-lg px-4 py-2.5 grid gap-x-4 gap-y-1.5"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              gridTemplateColumns: "repeat(2, 1fr)",
            }}
          >
            {/* Context label spanning both columns */}
            <div className="col-span-2 flex items-center gap-1.5 pb-1" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: selectedSport === "NBA" ? "#C8102E" : "#39FF14" }}>
                {selectedSport}
              </span>
              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>·</span>
              <span className="text-[10px] font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>
                {formatDateNav(gameDate)}
              </span>
              {totalCount > 0 && (
                <>
                  <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>·</span>
                  <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>{totalCount} games</span>
                </>
              )}
            </div>
            {/* Row 1: Odds count | Modeled count */}
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-[13px] font-black tabular-nums"
                style={{ color: withOddsCount === totalCount ? "#39FF14" : missingOddsCount > 0 ? "#FF6B00" : "hsl(var(--muted-foreground))" }}
              >
                {withOddsCount}/{totalCount}
              </span>
              <span className="text-[10px] uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>
                Games with All Odds
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-[13px] font-black tabular-nums"
                style={{ color: withModelCount === totalCount ? "#39FF14" : withModelCount > 0 ? "#FFB800" : "hsl(var(--muted-foreground))" }}
              >
                {withModelCount}/{totalCount}
              </span>
              <span className="text-[10px] uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>
                Games Modeled
              </span>
            </div>

            {/* Divider */}
            <div className="col-span-2" style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />

            {/* Row 2: Odds timestamp | Scores timestamp */}
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-widest" style={{ color: "hsl(var(--muted-foreground))" }}>
                Odds Last Updated
              </span>
              <span className="text-[11px] font-mono" style={{ color: lastRefresh?.refreshedAt ? "rgba(255,255,255,0.75)" : "hsl(var(--muted-foreground))" }}>
                {lastRefresh?.refreshedAt
                  ? new Date(lastRefresh.refreshedAt).toLocaleTimeString("en-US", {
                      hour: "2-digit", minute: "2-digit", second: "2-digit",
                      timeZone: "America/New_York", hour12: true,
                    }) + " EST"
                  : "—"}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase tracking-widest" style={{ color: "hsl(var(--muted-foreground))" }}>
                Scores Last Updated
              </span>
              <span className="text-[11px] font-mono" style={{ color: lastRefresh?.scoresRefreshedAt ? "rgba(255,255,255,0.75)" : "hsl(var(--muted-foreground))" }}>
                {lastRefresh?.scoresRefreshedAt
                  ? new Date(lastRefresh.scoresRefreshedAt).toLocaleTimeString("en-US", {
                      hour: "2-digit", minute: "2-digit", second: "2-digit",
                      timeZone: "America/New_York", hour12: true,
                    }) + " EST"
                  : "—"}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Game cards — same max-width and padding as Dashboard */}
      <main className="max-w-3xl mx-auto px-4 pb-8 pt-3 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="animate-spin" style={{ color: "#39FF14" }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-2">
            <span className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
              {statusFilter !== "all"
                ? `No ${statusFilter} ${selectedSport} games on ${formatDateNav(gameDate)}`
                : `No games found for ${formatDateNav(gameDate)}`
              }
            </span>
          </div>
        ) : (
          filtered.map((game) => (
            <EditableGameCard
              key={game.id}
              game={game as GameRow}
              onSaved={handleRefetch}
            />
          ))
        )}
      </main>
    </div>
  );
}
