/**
 * GameCard — Model Projection Card
 *
 * Matches the reference ModelProjectionCard.tsx exactly:
 *  - Left-border color driven by max(spreadDiff, totalDiff) edge scale
 *  - Header: date · time (dark bg strip)
 *  - Column labels: BOOKS (gray) | MODEL LINE (neon green) | MODEL O/U (neon green)
 *  - Away row: logo | name | consensus (book spread if away is fav, else book total) | model spread pill | O modelTotal pill
 *  - Divider
 *  - Home row: logo | name | consensus (book spread if home is fav, else book total) | model spread pill | U modelTotal pill
 *  - Edge verdict: spread pick (white) + EDGE: N pts (edge-colored) | total pick + EDGE
 *  - Download button (top-right, low opacity)
 *  - framer-motion fade-in
 *
 * All data comes from the Model Database sync pipeline via tRPC → DB.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, Link, ImageDown } from "lucide-react";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/lib/trpc";
import { getEspnLogoUrl } from "@/lib/espnTeamIds";
import { getTeamName } from "@/lib/teamNicknames";

type RouterOutput = inferRouterOutputs<AppRouter>;
type GameRow = RouterOutput["games"]["list"][number];

// ── Team name formatting (matches reference formatTeamName) ───────────────────
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

// ── Time formatting ───────────────────────────────────────────────────────────
function formatMilitaryTime(time: string): string {
  const t = time.replace(":", "").padStart(4, "0");
  let hours = parseInt(t.slice(0, 2));
  const minutes = t.slice(2);
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm} EST`;
}

// ── Date formatting ───────────────────────────────────────────────────────────
function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

// ── Edge color scale (matches reference exactly) ──────────────────────────────
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

// ── Spread sign helper ────────────────────────────────────────────────────────
function spreadSign(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

// ── toNum helper ──────────────────────────────────────────────────────────────
function toNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === "") return NaN;
  return typeof v === "number" ? v : parseFloat(v);
}

// ── Normalize edge label (matches reference normalizeEdgeLabel) ───────────────
function normalizeEdgeLabel(label: string | null | undefined): string {
  if (!label || label.toUpperCase() === "PASS") return "PASS";
  // Replace leading slug with formatted team name: "duke (-9.5)" → "Duke (-9.5)"
  return label.replace(/^([a-z][a-z0-9_]*)(\s+\()/i, (_, slug, rest) => formatTeamName(slug) + rest);
}

// ── TeamLogo ──────────────────────────────────────────────────────────────────
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

// ── TeamRow ───────────────────────────────────────────────────────────────────
function TeamRow({
  slug, name, nickname, consensus, modelSpread, modelTotal, logoUrl,
}: {
  slug: string; name: string; nickname: string;
  consensus: string; modelSpread: string; modelTotal: string;
  logoUrl?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 py-1.5 min-w-0">
      {/* Logo */}
      <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center">
        <TeamLogo slug={slug} name={name} logoUrl={logoUrl} />
      </div>

      {/* Team name — school on top, nickname on bottom, each strictly one line */}
      <div className="flex-shrink-0 flex flex-col justify-center overflow-hidden" style={{ width: "clamp(80px, 22vw, 120px)" }}>
        <div
          className="font-bold leading-none overflow-hidden"
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

      {/* 3 data columns: BOOKS | MODEL LINE | MODEL O/U */}
      <div className="flex-1 grid min-w-0" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: "4px" }}>

        {/* BOOKS — plain white consensus number */}
        <div className="flex items-center justify-center">
          <span
            className="font-bold leading-none whitespace-nowrap"
            style={{ fontSize: "clamp(13px, 3.5vw, 16px)", color: "#D3D3D3" }}
          >
            {consensus}
          </span>
        </div>

        {/* MODEL LINE — dark pill */}
        <div className="flex items-center justify-center">
          <span
            className="flex items-center justify-center px-2 py-1.5 rounded-lg whitespace-nowrap"
            style={{ background: "rgba(255,255,255,0.08)", minWidth: "48px" }}
          >
            <span className="font-bold leading-none" style={{ fontSize: "clamp(13px, 3.5vw, 15px)", color: "#FFFFFF" }}>
              {modelSpread}
            </span>
          </span>
        </div>

        {/* MODEL O/U — dark pill */}
        <div className="flex items-center justify-center">
          <span
            className="flex items-center justify-center px-2 py-1.5 rounded-lg whitespace-nowrap"
            style={{ background: "rgba(255,255,255,0.08)", minWidth: "52px" }}
          >
            <span className="font-bold leading-none" style={{ fontSize: "clamp(13px, 3.5vw, 15px)", color: "#FFFFFF" }}>
              {modelTotal}
            </span>
          </span>
        </div>

      </div>
    </div>
  );
}

// ── VerdictSide ───────────────────────────────────────────────────────────────
function VerdictSide({ diff, label, isStrong }: { diff: number | null; label: string | null; isStrong: boolean }) {
  const normalized = normalizeEdgeLabel(label);
  const isPass = normalized === "PASS" || (diff ?? 0) <= 0;
  const color = getEdgeColor(diff ?? 0);

  if (isPass) {
    return (
      <div className="flex flex-col items-center gap-0.5 py-0.5">
        <span
          className="text-[11px] font-medium tracking-wide"
          style={{ color: "hsl(var(--muted-foreground) / 0.35)" }}
        >
          PASS
        </span>
      </div>
    );
  }

  const betNameSize = isStrong ? "13px" : "12px";
  const showArrow = (diff ?? 0) >= 3;

  return (
    <div className="flex flex-col items-center gap-1 py-0.5">
      <span
        className="font-bold leading-none whitespace-nowrap"
        style={{ fontSize: betNameSize, color: "hsl(var(--foreground))" }}
      >
        {showArrow && (
          <span className="mr-0.5 text-[10px]" style={{ color }}>▲</span>
        )}
        {normalized}
      </span>
      <span className="text-[11px] leading-none" style={{ color: "hsl(var(--muted-foreground))", fontWeight: 500 }}>
        EDGE:{" "}
        <span style={{ color, fontWeight: 700 }}>
          {diff} {diff === 1 ? "pt" : "pts"}
        </span>
      </span>
    </div>
  );
}

// ── EdgeVerdict ───────────────────────────────────────────────────────────────
function EdgeVerdict({
  spreadDiff, spreadEdge, totalDiff, totalEdge,
}: {
  spreadDiff: number | null; spreadEdge: string | null;
  totalDiff: number | null; totalEdge: string | null;
}) {
  const spreadPass = normalizeEdgeLabel(spreadEdge) === "PASS" || (spreadDiff ?? 0) <= 0;
  const totalPass  = normalizeEdgeLabel(totalEdge)  === "PASS" || (totalDiff ?? 0)  <= 0;

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

  const spreadIsStronger = (spreadDiff ?? 0) >= (totalDiff ?? 0);

  return (
    <div
      className="mt-2 pt-2 flex items-center"
      style={{ borderTop: "1px solid hsl(var(--border))" }}
    >
      <div className="flex-1 flex items-center justify-center">
        <VerdictSide diff={spreadDiff} label={spreadEdge} isStrong={spreadIsStronger && !spreadPass} />
      </div>
      <div className="w-px self-stretch mx-2" style={{ background: "hsl(var(--border))" }} />
      <div className="flex-1 flex items-center justify-center">
        <VerdictSide diff={totalDiff} label={totalEdge} isStrong={!spreadIsStronger && !totalPass} />
      </div>
    </div>
  );
}

// ── ShareSheet ────────────────────────────────────────────────────────────────
function ShareSheet({
  open, onClose, onCopyLink, onSavePhoto,
}: {
  open: boolean; onClose: () => void; onCopyLink: () => void; onSavePhoto: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40"
            style={{ background: "rgba(0,0,0,0.55)" }}
            onClick={onClose}
          />
          <motion.div
            key="sheet"
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl px-4 pb-10 pt-5"
            style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
          >
            <div
              className="mx-auto mb-4 h-1 w-10 rounded-full"
              style={{ background: "hsl(var(--muted-foreground) / 0.4)" }}
            />
            <p className="text-center text-sm font-semibold mb-5" style={{ color: "hsl(var(--foreground))" }}>
              Share Card
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { onCopyLink(); onClose(); }}
                className="flex items-center gap-4 w-full px-4 py-3.5 rounded-xl active:scale-[0.98]"
                style={{ background: "hsl(var(--muted) / 0.5)" }}
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(99,102,241,0.15)" }}
                >
                  <Link size={18} style={{ color: "#6366f1" }} />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>Copy Link</p>
                  <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>aisportsbettingmodels.com</p>
                </div>
              </button>
              <button
                onClick={() => { onSavePhoto(); onClose(); }}
                className="flex items-center gap-4 w-full px-4 py-3.5 rounded-xl active:scale-[0.98]"
                style={{ background: "hsl(var(--muted) / 0.5)" }}
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(57,255,20,0.15)" }}
                >
                  <ImageDown size={18} style={{ color: "#39FF14" }} />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>Save Photo</p>
                  <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Save card to your camera roll</p>
                </div>
              </button>
            </div>
            <button
              onClick={onClose}
              className="mt-3 w-full py-3 rounded-xl text-sm font-semibold"
              style={{ background: "hsl(var(--muted) / 0.3)", color: "hsl(var(--muted-foreground))" }}
            >
              Cancel
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Main GameCard ─────────────────────────────────────────────────────────────

interface GameCardProps {
  game: GameRow;
  logoMap?: Record<string, string>;
}

export function GameCard({ game, logoMap = {} }: GameCardProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const awayBookSpread = toNum(game.awayBookSpread);
  const homeBookSpread = toNum(game.homeBookSpread);
  const awayModelSpread = toNum(game.awayModelSpread);
  const homeModelSpread = toNum(game.homeModelSpread);
  const bookTotal = toNum(game.bookTotal);
  const modelTotal = toNum(game.modelTotal);
  const spreadDiff = toNum(game.spreadDiff);
  const totalDiff = toNum(game.totalDiff);

  const awayTeamName = getTeamName(game.awayTeam);
  const homeTeamName = getTeamName(game.homeTeam);
  const awayName = awayTeamName.school || formatTeamName(game.awayTeam);
  const homeName = homeTeamName.school || formatTeamName(game.homeTeam);
  const awayNickname = awayTeamName.nickname;
  const homeNickname = homeTeamName.nickname;

  // Resolve ESPN logo URLs: static ID map first, then DB logoMap as fallback
  const awayLogoUrl = getEspnLogoUrl(game.awayTeam) ?? logoMap[game.awayTeam];
  const homeLogoUrl = getEspnLogoUrl(game.homeTeam) ?? logoMap[game.homeTeam];
  const time = formatMilitaryTime(game.startTimeEst);
  const dateLabel = formatDate(game.gameDate);

  // Border color driven by max edge diff
  const maxDiff = Math.max(isNaN(spreadDiff) ? 0 : spreadDiff, isNaN(totalDiff) ? 0 : totalDiff);
  const borderColor = getEdgeColor(maxDiff);

  // Consensus column logic (matches reference):
  // Away row: show away book spread if away is the favorite (negative), else show book total
  // Home row: show home book spread if home is the favorite (negative), else show book total
  const awayConsensus = awayBookSpread < 0
    ? spreadSign(awayBookSpread)
    : `${bookTotal}`;
  const homeConsensus = homeBookSpread < 0
    ? spreadSign(homeBookSpread)
    : `${bookTotal}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText("https://aisportsbettingmodels.com");
      toast.success("Link copied!");
    } catch {
      toast.error("Could not copy link.");
    }
  };

  const handleSavePhoto = async () => {
    try {
      const html2canvas = (await import("html2canvas")).default;
      const isLight = document.documentElement.dataset.theme === "light";
      const c = isLight ? {
        card: "#ffffff", headerBg: "#0d1117", headerFg: "#f9fafb",
        subFg: "#9ca3af", fg: "#111827", mutedFg: "#9ca3af", border: "#e5e7eb",
      } : {
        card: "#111620", headerBg: "#0d1117", headerFg: "#dce3f0",
        subFg: "#8a97ad", fg: "#dce3f0", mutedFg: "#8a97ad", border: "#1e2a3a",
      };

      const spreadColor = getEdgeColor(spreadDiff);
      const totalColor  = getEdgeColor(totalDiff);
      const spreadLabel = normalizeEdgeLabel(game.spreadEdge);
      const totalLabel  = normalizeEdgeLabel(game.totalEdge);
      const spreadPass  = spreadLabel === "PASS" || spreadDiff <= 0 || !game.spreadEdge;
      const totalPass   = totalLabel  === "PASS" || totalDiff  <= 0 || !game.totalEdge;

      const verdictSideHtml = (diff: number, label: string, color: string) => {
        if (label === "PASS" || diff <= 0) {
          return `<div style="flex:1;display:flex;align-items:center;justify-content:center;"><span style="font-size:11px;font-weight:500;color:${c.mutedFg};opacity:0.5;">PASS</span></div>`;
        }
        const arrow = diff >= 3 ? `<span style="color:${color};margin-right:3px;font-size:10px;">▲</span>` : "";
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;">
          <span style="font-size:13px;font-weight:700;color:${c.fg};white-space:nowrap;line-height:1;">${arrow}${label}</span>
          <span style="font-size:12px;font-weight:700;color:${color};line-height:1;">EDGE: ${diff} pts</span>
        </div>`;
      }

      const exportEl = document.createElement("div");
      exportEl.style.cssText = `
        position:fixed;top:-9999px;left:-9999px;
        width:390px;background:${c.card};border-radius:16px;overflow:hidden;
        font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Helvetica,Arial,sans-serif;
        -webkit-font-smoothing:antialiased;border:1px solid ${c.border};
        border-left:3px solid ${borderColor};
      `;
      exportEl.innerHTML = `
        <div style="background:${c.headerBg};padding:8px 16px;display:flex;align-items:center;justify-content:center;gap:6px;border-bottom:1px solid ${c.border};">
          <span style="color:${c.headerFg};font-size:12px;font-weight:700;">${dateLabel}</span>
          <span style="color:${c.subFg};font-size:11px;">·</span>
          <span style="color:${c.subFg};font-size:12px;font-weight:500;">${time}</span>
        </div>
        <div style="padding:8px 12px 10px;background:${c.card};">
          <div style="display:flex;align-items:center;padding-bottom:6px;border-bottom:1px solid ${c.border};">
            <div style="width:36px;flex-shrink:0;"></div>
            <div style="width:90px;flex-shrink:0;"></div>
            <div style="flex:1;display:grid;grid-template-columns:1fr 1fr 1fr;text-align:center;">
              <span style="font-size:10px;color:#D3D3D3;">Books</span>
              <span style="font-size:10px;font-weight:700;color:#39FF14;">Model Line</span>
              <span style="font-size:10px;font-weight:700;color:#39FF14;">Model O/U</span>
            </div>
          </div>
          <div style="height:1px;background:${c.border};margin:0;"></div>
          <div style="display:flex;align-items:center;gap:8px;padding:8px 0;">
            <div style="width:36px;height:36px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
              <img src="${awayLogoUrl ?? ''}" width="36" height="36" style="object-fit:contain;" crossorigin="anonymous"/>
            </div>
            <div style="width:90px;flex-shrink:0;overflow:hidden;">
              <div style="font-size:13px;font-weight:700;color:${c.fg};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${awayName}</div>
            </div>
            <div style="flex:1;display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;">
              <div style="display:flex;align-items:center;justify-content:center;">
                <span style="font-size:16px;font-weight:800;color:#D3D3D3;">${awayConsensus}</span>
              </div>
              <div style="background:rgba(255,255,255,0.08);border-radius:6px;padding:4px 6px;display:flex;align-items:center;justify-content:center;">
                <span style="font-size:15px;font-weight:700;color:#FFFFFF;">${spreadSign(awayModelSpread)}</span>
              </div>
              <div style="background:rgba(255,255,255,0.08);border-radius:6px;padding:4px 6px;display:flex;align-items:center;justify-content:center;">
                <span style="font-size:15px;font-weight:700;color:#FFFFFF;">O ${modelTotal}</span>
              </div>
            </div>
          </div>
          <div style="height:1px;background:${c.border};margin:0;"></div>
          <div style="display:flex;align-items:center;gap:8px;padding:8px 0;">
            <div style="width:36px;height:36px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
              <img src="${homeLogoUrl ?? ''}" width="36" height="36" style="object-fit:contain;" crossorigin="anonymous"/>
            </div>
            <div style="width:90px;flex-shrink:0;overflow:hidden;">
              <div style="font-size:13px;font-weight:700;color:${c.fg};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${homeName}</div>
            </div>
            <div style="flex:1;display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;">
              <div style="display:flex;align-items:center;justify-content:center;">
                <span style="font-size:16px;font-weight:800;color:#D3D3D3;">${homeConsensus}</span>
              </div>
              <div style="background:rgba(255,255,255,0.08);border-radius:6px;padding:4px 6px;display:flex;align-items:center;justify-content:center;">
                <span style="font-size:15px;font-weight:700;color:#FFFFFF;">${spreadSign(homeModelSpread)}</span>
              </div>
              <div style="background:rgba(255,255,255,0.08);border-radius:6px;padding:4px 6px;display:flex;align-items:center;justify-content:center;">
                <span style="font-size:15px;font-weight:700;color:#FFFFFF;">U ${modelTotal}</span>
              </div>
            </div>
          </div>
          <div style="border-top:1px solid ${c.border};margin-top:6px;padding-top:6px;display:flex;align-items:center;">
            ${spreadPass && totalPass
              ? `<div style="flex:1;text-align:center;"><span style="font-size:11px;font-weight:500;color:${c.mutedFg};opacity:0.5;letter-spacing:0.1em;">PASS</span></div>`
              : `${verdictSideHtml(spreadDiff, spreadLabel, spreadColor)}
                 <div style="width:1px;align-self:stretch;background:${c.border};margin:0 8px;"></div>
                 ${verdictSideHtml(totalDiff, totalLabel, totalColor)}`
            }
          </div>
        </div>
      `;

      document.body.appendChild(exportEl);
      const imgs = Array.from(exportEl.querySelectorAll("img")) as HTMLImageElement[];
      await Promise.allSettled(imgs.map((img) => new Promise((res) => {
        if (img.complete) res(null);
        else { img.onload = res; img.onerror = res; }
      })));

      const canvas = await html2canvas(exportEl, {
        backgroundColor: c.card, scale: 3, useCORS: true,
        allowTaint: true, logging: false,
        width: 390, height: exportEl.scrollHeight, windowWidth: 390,
      });
      document.body.removeChild(exportEl);

      canvas.toBlob(async (blob) => {
        if (!blob) { toast.error("Failed to generate image."); return; }
        const file = new File([blob], `${awayName}-vs-${homeName}.png`, { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: `${awayName} vs ${homeName}` });
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = `${awayName}-vs-${homeName}.png`; a.click();
          URL.revokeObjectURL(url);
          toast.success("Card saved!");
        }
      }, "image/png");
    } catch (e) {
      console.error(e);
      toast.error("Export failed. Please try again.");
    }
  };

  return (
    <>
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
        {/* Download / share button */}
        <button
          onClick={() => setSheetOpen(true)}
          className="absolute top-1.5 right-2 z-10 p-1 rounded-md transition-opacity opacity-25 hover:opacity-70"
          style={{ background: "transparent" }}
          title="Share card"
        >
          <Download size={12} style={{ color: "hsl(var(--muted-foreground))" }} />
        </button>

        {/* Header */}
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
        </div>

        {/* Team rows */}
        <div className="px-3 pt-1 pb-3">
          {/* Column labels */}
          <div
            className="flex items-center gap-1.5 pb-1.5"
            style={{ borderBottom: "1px solid hsl(var(--border) / 0.5)" }}
          >
            <div className="flex-shrink-0" style={{ width: "clamp(80px, 22vw, 120px)" }} />
            <div className="w-8 flex-shrink-0" />
            <div className="flex-1 grid text-center" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
              <span className="text-[10px] uppercase tracking-widest" style={{ color: "#D3D3D3" }}>Books</span>
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#39FF14" }}>Model Line</span>
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#39FF14" }}>Model O/U</span>
            </div>
          </div>

          {/* Away row */}
          <TeamRow
            slug={game.awayTeam}
            name={awayName}
            nickname={awayNickname}
            consensus={awayConsensus}
            modelSpread={spreadSign(awayModelSpread)}
            modelTotal={`O ${modelTotal}`}
            logoUrl={awayLogoUrl}
          />

          <div className="my-0.5" style={{ height: 1, background: "hsl(var(--border))" }} />

          {/* Home row */}
          <TeamRow
            slug={game.homeTeam}
            name={homeName}
            nickname={homeNickname}
            consensus={homeConsensus}
            modelSpread={spreadSign(homeModelSpread)}
            modelTotal={`U ${modelTotal}`}
            logoUrl={homeLogoUrl}
          />

          {/* Edge verdict */}
          <EdgeVerdict
            spreadDiff={spreadDiff}
            spreadEdge={game.spreadEdge}
            totalDiff={totalDiff}
            totalEdge={game.totalEdge}
          />
        </div>
      </motion.div>

      <ShareSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onCopyLink={handleCopyLink}
        onSavePhoto={handleSavePhoto}
      />
    </>
  );
}
