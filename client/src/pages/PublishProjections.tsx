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
import { Loader2, Send, ChevronLeft, Eye, EyeOff, Trophy } from "lucide-react";
import { getEspnLogoUrl } from "@/lib/espnTeamIds";
import { getTeamName } from "@/lib/teamNicknames";

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
  const t = time.replace(":", "").padStart(4, "0");
  let hours = parseInt(t.slice(0, 2));
  const minutes = t.slice(2);
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm} EST`;
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
  return label.replace(/^([a-z][a-z0-9_]*)(\s+\()/i, (_, slug, rest) => formatTeamName(slug) + rest);
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
  slug: string; name: string; nickname: string;
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
      <div
        className="flex-shrink-0 flex flex-col justify-center overflow-hidden"
        style={{ width: "clamp(80px, 22vw, 120px)" }}
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
};

// ─── EditableGameCard ─────────────────────────────────────────────────────────

function EditableGameCard({ game, onSaved }: { game: GameRow; onSaved: () => void }) {
  const [awaySpread, setAwaySpread] = useState(game.awayModelSpread ?? "");
  const [homeSpread, setHomeSpread] = useState(game.homeModelSpread ?? "");
  const [modelTotal, setModelTotal] = useState(game.modelTotal ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
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
      toast.success("Projections saved");
      onSaved();
    } catch {
      toast.error("Failed to save projections");
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
    } catch {
      toast.error("Failed to update publish status");
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

  const awayTeamName = getTeamName(game.awayTeam);
  const homeTeamName = getTeamName(game.homeTeam);
  const awayName     = awayTeamName.school || formatTeamName(game.awayTeam);
  const homeName     = homeTeamName.school || formatTeamName(game.homeTeam);
  const awayNickname = awayTeamName.nickname;
  const homeNickname = homeTeamName.nickname;
  const awayLogoUrl  = getEspnLogoUrl(game.awayTeam) ?? undefined;
  const homeLogoUrl  = getEspnLogoUrl(game.homeTeam) ?? undefined;
  const time      = formatMilitaryTime(game.startTimeEst);
  const dateLabel = formatDate(game.gameDate);

  const hasAnyModel = awaySpread !== "" || modelTotal !== "";

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
        disabled={publishMutation.isPending || saving}
        className="absolute top-1.5 right-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all"
        style={game.publishedToFeed
          ? { background: "rgba(57,255,20,0.15)", color: "#39FF14", border: "1px solid rgba(57,255,20,0.35)" }
          : { background: "rgba(255,255,255,0.06)", color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))" }
        }
        title={game.publishedToFeed ? "Remove from feed" : "Publish to feed"}
      >
        {publishMutation.isPending || saving
          ? <Loader2 size={9} className="animate-spin" />
          : game.publishedToFeed
            ? <><Eye size={9} /> Live</>
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

      {/* Team rows — restructured so O/U pill spans both rows */}
      <div className="px-3 pt-1 pb-3">

        {/* Column labels — mirrors body layout exactly */}
        <div
          className="flex items-center gap-1.5 pb-1.5"
          style={{ borderBottom: "1px solid hsl(var(--border) / 0.5)" }}
        >
          {/* Logo spacer */}
          <div className="w-8 flex-shrink-0" />
          {/* Team name spacer */}
          <div className="flex-shrink-0" style={{ width: "clamp(80px, 22vw, 120px)" }} />
          {/* Books + Model Line headers — same flex-1 + 1fr 1fr grid as the row */}
          <div className="flex-1 grid text-center" style={{ gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
            <span className="text-[10px] uppercase tracking-widest" style={{ color: "#D3D3D3" }}>Books</span>
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#39FF14" }}>Model Line</span>
          </div>
          {/* Model O/U header — same fixed width as the pill column */}
          <div
            className="flex-shrink-0 text-center"
            style={{ width: "clamp(52px, 14vw, 80px)" }}
          >
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#39FF14" }}>O/U</span>
          </div>
        </div>

        {/* Two-row layout: left side has away+home rows, right side has a single O/U pill spanning both */}
        <div className="flex gap-1.5 min-w-0">

          {/* Left side: away row + divider + home row */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Away row */}
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
            {/* Home row */}
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

          {/* Right side: single O/U pill centered between both rows */}
          <div
            className="flex-shrink-0 flex items-center justify-center"
            style={{ width: "clamp(52px, 14vw, 80px)" }}
          >
            <EditablePill
              value={modelTotal}
              onChange={handleTotalChange}
              placeholder="—"
            />
          </div>

        </div>

        {/* Save button — always visible; bright green when dirty, dimmed when saved */}
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
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </Button>
        </div>

        {/* Edge verdict — live preview as @prez types */}
        {hasAnyModel && (
          <EdgeVerdictLive
            spreadDiff={previewSpreadDiff}
            spreadEdge={edges.spreadEdge ?? "PASS"}
            totalDiff={previewTotalDiff}
            totalEdge={edges.totalEdge ?? "PASS"}
          />
        )}
      </div>
    </motion.div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PublishProjections() {
  const [, setLocation] = useLocation();
  const { appUser, isOwner, loading: authLoading } = useAppAuth();
  const [filter, setFilter] = useState<"all" | "regular_season" | "conference_tournament">("all");
  const [gameDate] = useState("2026-03-04");

  // ── Strict owner-only guard ─────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && (!appUser || !isOwner)) {
      setLocation("/dashboard");
    }
  }, [authLoading, appUser, isOwner, setLocation]);

  const {
    data: games,
    isLoading,
    refetch,
  } = trpc.games.listStaging.useQuery(
    { gameDate },
    { enabled: !!appUser && isOwner, refetchOnWindowFocus: false }
  );

  const publishAllMutation = trpc.games.publishAll.useMutation({
    onSuccess: () => {
      toast.success("All games published to feed!");
      refetch();
    },
    onError: () => toast.error("Failed to publish all games"),
  });

  // ── Refresh Books: SSE-based live progress ────────────────────────────────
  type GameProgress = {
    index: number;
    total: number;
    awayTeam: string;
    homeTeam: string;
    awaySpread: number | null;
    homeSpread: number | null;
    bookTotal: number | null;
    status: "ok" | "no_match";
  };
  const [refreshing, setRefreshing] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState<GameProgress[]>([]);
  const [refreshTotal, setRefreshTotal] = useState(0);
  const [refreshDone, setRefreshDone] = useState(false);
  const [showProgressPanel, setShowProgressPanel] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  const handleRefreshBooks = useCallback(() => {
    setRefreshing(true);
    setRefreshProgress([]);
    setRefreshTotal(0);
    setRefreshDone(false);
    setShowProgressPanel(true);

    const url = `/api/refresh-books?gameDate=${encodeURIComponent(gameDate)}`;
    const es = new EventSource(url, { withCredentials: true });

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "start") {
          setRefreshTotal(msg.total);
        } else if (msg.type === "game") {
          setRefreshProgress((prev) => [...prev, msg as GameProgress]);
        } else if (msg.type === "done") {
          setRefreshDone(true);
          setRefreshing(false);
          if (msg.refreshedAt) setLastRefreshedAt(msg.refreshedAt as string);
          refetch();
          es.close();
        } else if (msg.type === "error") {
          toast.error(msg.message ?? "Refresh failed");
          setRefreshing(false);
          es.close();
        }
      } catch {}
    };

    es.onerror = () => {
      toast.error("Connection lost during refresh");
      setRefreshing(false);
      es.close();
    };
  }, [gameDate, refetch]);

  const handleRefetch = useCallback(() => { refetch(); }, [refetch]);

  const filtered = (games ?? []).filter((g) =>
    filter === "all" ? true : g.gameType === filter
  );

  const publishedCount  = (games ?? []).filter((g) => g.publishedToFeed).length;
  const totalCount      = games?.length ?? 0;
  const withModelCount  = (games ?? []).filter((g) => g.awayModelSpread || g.modelTotal).length;

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
        <div className="relative flex items-center px-4 py-2 max-w-3xl mx-auto">

          {/* Back button */}
          <button
            onClick={() => setLocation("/dashboard")}
            className="p-1.5 rounded-lg transition-colors hover:bg-white/10 mr-2 flex-shrink-0"
          >
            <ChevronLeft size={18} style={{ color: "hsl(var(--muted-foreground))" }} />
          </button>

          {/* Centered brand — mirrors Dashboard header */}
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

          {/* Spacer + action buttons — right */}
          <div className="flex-1" />
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={handleRefreshBooks}
              disabled={refreshing || totalCount === 0}
              className="gap-1.5 text-xs h-8 font-semibold border-border"
              style={{ color: "#FFB800" }}
            >
              {refreshing
                ? <Loader2 size={12} className="animate-spin" />
                : <span style={{ fontSize: 12 }}>↻</span>
              }
              {refreshing ? "Refreshing…" : "Refresh Books"}
            </Button>
            <Button
              size="sm"
              onClick={() => publishAllMutation.mutate({ gameDate })}
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

        {/* Stats row + filter tabs */}
        <div className="px-4 pb-2 max-w-3xl mx-auto space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px]" style={{ color: "#39FF14" }}>
              {publishedCount}/{totalCount} live
            </span>
            <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>·</span>
            <span className="text-[11px]" style={{ color: "#FFB800" }}>
              {withModelCount} with model data
            </span>
            {lastRefreshedAt && (
              <>
                <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>·</span>
                <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Books updated {new Date(lastRefreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </>
            )}
          </div>
          <div className="flex gap-2">
            {(["all", "regular_season", "conference_tournament"] as const).map((f) => {
              const count = f === "all" ? totalCount
                : (games ?? []).filter((g) => g.gameType === f).length;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className="px-3 py-1 rounded-full text-xs font-semibold transition-all"
                  style={filter === f
                    ? { background: "#39FF14", color: "#000" }
                    : { background: "hsl(var(--card))", color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))" }
                  }
                >
                  {f === "all" ? `All (${count})` : f === "regular_season" ? `Regular (${count})` : `Conf. Tourney (${count})`}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* ── Refresh Books progress panel ────────────────────────────────────────── */}
      {showProgressPanel && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={(e) => {
            // Close only when clicking the backdrop (not the panel itself)
            if (e.target === e.currentTarget && !refreshing) setShowProgressPanel(false);
          }}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl overflow-hidden flex flex-col"
            style={{ background: "#111", border: "1px solid #222", maxHeight: "70vh" }}
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "#222" }}>
              <div className="flex items-center gap-2">
                {refreshing
                  ? <Loader2 size={14} className="animate-spin" style={{ color: "#FFB800" }} />
                  : <span style={{ color: refreshDone ? "#39FF14" : "#FFB800", fontSize: 14 }}>{refreshDone ? "✓" : "↻"}</span>
                }
                <span className="text-sm font-semibold" style={{ color: "#fff" }}>
                  {refreshing
                    ? `Refreshing Books… ${refreshProgress.length}/${refreshTotal}`
                    : refreshDone
                    ? `Done — ${refreshProgress.filter((g) => g.status === "ok").length}/${refreshTotal} updated`
                    : "Refresh Books"}
                </span>
              </div>
              {!refreshing && (
                <button
                  onClick={() => setShowProgressPanel(false)}
                  className="text-xs px-2 py-1 rounded"
                  style={{ color: "#9CA3AF", background: "#1a1a1a" }}
                >
                  Close
                </button>
              )}
            </div>

            {/* Progress bar */}
            {refreshTotal > 0 && (
              <div className="h-1 w-full" style={{ background: "#222" }}>
                <div
                  className="h-1 transition-all duration-300"
                  style={{
                    width: `${Math.round((refreshProgress.length / refreshTotal) * 100)}%`,
                    background: refreshDone ? "#39FF14" : "#FFB800",
                  }}
                />
              </div>
            )}

            {/* Game list */}
            <div className="overflow-y-auto flex-1 px-2 py-2 space-y-1">
              {refreshProgress.map((g) => (
                <div
                  key={g.index}
                  className="flex items-center justify-between px-3 py-2 rounded-lg"
                  style={{ background: g.status === "ok" ? "rgba(57,255,20,0.06)" : "rgba(255,255,255,0.03)" }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="text-xs font-bold w-5 text-right flex-shrink-0"
                      style={{ color: "#9CA3AF" }}
                    >{g.index}</span>
                    <span className="text-xs font-medium truncate" style={{ color: "#fff" }}>
                      {g.awayTeam} <span style={{ color: "#9CA3AF" }}>vs</span> {g.homeTeam}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                    {g.status === "ok" ? (
                      <>
                        <span className="text-xs font-mono" style={{ color: "#39FF14" }}>
                          {g.awaySpread != null ? (g.awaySpread > 0 ? `+${g.awaySpread}` : `${g.awaySpread}`) : "—"}
                        </span>
                        <span className="text-xs font-mono" style={{ color: "#FFB800" }}>
                          {g.bookTotal != null ? `O/U ${g.bookTotal}` : "—"}
                        </span>
                        <span style={{ color: "#39FF14", fontSize: 12 }}>✓</span>
                      </>
                    ) : (
                      <span className="text-xs" style={{ color: "#9CA3AF" }}>no match</span>
                    )}
                  </div>
                </div>
              ))}
              {refreshing && refreshProgress.length < refreshTotal && (
                <div className="flex items-center gap-2 px-3 py-2">
                  <Loader2 size={12} className="animate-spin" style={{ color: "#FFB800" }} />
                  <span className="text-xs" style={{ color: "#9CA3AF" }}>Fetching next game…</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Game cards — same max-width and padding as Dashboard */}
      <main className="max-w-3xl mx-auto px-4 pb-8 pt-3 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="animate-spin" style={{ color: "#39FF14" }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-2">
            <span className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>No games found</span>
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
