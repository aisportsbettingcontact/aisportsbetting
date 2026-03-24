/**
 * /splits — Slash Command Handler
 *
 * Behaviour:
 *   1. Validates that the invoking user is the allowed user ID.
 *   2. Defers the reply (ephemeral) so Discord doesn't time out.
 *   3. Fetches all daily splits directly from the database.
 *   4. Converts each GameSplits record into a SplitsCardData object using
 *      the exact same pickColor logic as the frontend GameCard.tsx.
 *   5. Renders each card to PNG via Playwright (headless Chromium).
 *   6. Posts each PNG as an attachment into the target channel.
 *   7. Adds a 1.5s delay between messages to respect Discord rate limits.
 *   8. Replies to the invoker with an ephemeral summary.
 *
 * Deep logging: every stage emits structured [SplitsBot][stage] prefixed logs.
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  TextChannel,
  AttachmentBuilder,
  type Client,
} from "discord.js";
import { fetchAllDailySplits, type GameSplits } from "./fetchSplits.js";
import { renderSplitsCard, closeSplitsRenderer, type SplitsCardData, type SplitsCardTeam } from "./renderSplitsCard.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const ALLOWED_USER_ID   = "1098485718734602281";
const SPLITS_CHANNEL_ID = "1400758184188186744";
const IMAGE_DELAY_MS    = 1_500;

// ─── Structured logger ────────────────────────────────────────────────────────
type LogLevel = "info" | "warn" | "error" | "debug";
function log(stage: string, msg: string, level: LogLevel = "info"): void {
  const ts = new Date().toISOString();
  const prefix = `[${ts}][SplitsBot][${stage}]`;
  if (level === "error")      console.error(`${prefix} ❌ ${msg}`);
  else if (level === "warn")  console.warn(`${prefix} ⚠️  ${msg}`);
  else if (level === "debug") { if (process.env.LOG_LEVEL === "debug") console.log(`${prefix} 🔍 ${msg}`); }
  else                        console.log(`${prefix} ${msg}`);
}

// ─── Command definition (used by register script) ─────────────────────────────
export const splitsCommandData = new SlashCommandBuilder()
  .setName("splits")
  .setDescription("Post today's betting splits into the splits channel")
  .addStringOption((opt) =>
    opt
      .setName("sport")
      .setDescription("Filter by sport (default: ALL)")
      .setRequired(false)
      .addChoices(
        { name: "ALL Sports",  value: "ALL" },
        { name: "NBA",         value: "NBA" },
        { name: "NHL",         value: "NHL" },
        { name: "NCAAM",       value: "NCAAM" },
      )
  )
  .addStringOption((opt) =>
    opt
      .setName("game")
      .setDescription("Post a single game (type AWAY @ HOME, e.g. OKC @ DAL) or leave blank for ALL")
      .setRequired(false)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt
      .setName("date")
      .setDescription("Optional date override in YYYY-MM-DD format (defaults to today ET)")
      .setRequired(false)
  );

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function todayEtLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month:   "long",
    day:     "numeric",
    year:    "numeric",
  });
}

function formatGameKey(g: GameSplits): string {
  return `${g.away_abbr ?? g.away_team} @ ${g.home_abbr ?? g.home_team}`;
}

/**
 * Validate that a GameSplits record has all required split fields.
 * Returns an array of missing/null field paths.
 */
function auditSplits(g: GameSplits): string[] {
  const issues: string[] = [];
  const check = (path: string, val: unknown) => {
    if (val === null || val === undefined) issues.push(path);
  };
  check("spread.away_ticket_pct",    g.spread?.away_ticket_pct);
  check("spread.away_money_pct",     g.spread?.away_money_pct);
  check("spread.home_ticket_pct",    g.spread?.home_ticket_pct);
  check("spread.home_money_pct",     g.spread?.home_money_pct);
  check("total.over_ticket_pct",     g.total?.over_ticket_pct);
  check("total.over_money_pct",      g.total?.over_money_pct);
  check("total.under_ticket_pct",    g.total?.under_ticket_pct);
  check("total.under_money_pct",     g.total?.under_money_pct);
  check("moneyline.away_ticket_pct", g.moneyline?.away_ticket_pct);
  check("moneyline.away_money_pct",  g.moneyline?.away_money_pct);
  check("moneyline.home_ticket_pct", g.moneyline?.home_ticket_pct);
  check("moneyline.home_money_pct",  g.moneyline?.home_money_pct);
  return issues;
}

// ─── pickColor logic (mirrors frontend GameCard.tsx exactly) ─────────────────

/** Relative luminance per WCAG 2.1 */
function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function isUnusable(hex: string): boolean {
  if (!hex || hex.length < 4) return true;
  const lum = luminance(hex);
  return lum < 0.04 || lum > 0.90;
}

function colorDistance(a: string, b: string): number {
  const toRgb = (h: string) => {
    const c = h.replace("#", "");
    return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)];
  };
  const [r1,g1,b1] = toRgb(a);
  const [r2,g2,b2] = toRgb(b);
  return Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2);
}

function tooSimilar(a: string, b: string): boolean {
  return colorDistance(a, b) < 80;
}

const FALLBACK_AWAY = "#EF3B24";
const FALLBACK_HOME = "#1D9BF0";

function pickColor(
  primary: string,
  secondary: string,
  tertiary: string,
  opponentChosen: string | null,
  label: string
): string {
  const candidates = [primary, secondary, tertiary].filter(Boolean);
  for (const c of candidates) {
    if (isUnusable(c)) {
      log("color", `${label}: skipping "${c}" (unusable luminance)`, "debug");
      continue;
    }
    if (opponentChosen && tooSimilar(c, opponentChosen)) {
      log("color", `${label}: skipping "${c}" (too similar to opponent ${opponentChosen})`, "debug");
      continue;
    }
    log("color", `${label}: chose "${c}"`, "debug");
    return c;
  }
  const fallback = opponentChosen === FALLBACK_AWAY ? FALLBACK_HOME : FALLBACK_AWAY;
  log("color", `${label}: all candidates unusable — using fallback ${fallback}`, "warn");
  return fallback;
}

/** Derive the darkest shade for the logo gradient background */
function darkShade(primary: string): string {
  const clean = primary.replace("#", "");
  const r = Math.max(0, parseInt(clean.slice(0,2),16) - 60);
  const g = Math.max(0, parseInt(clean.slice(2,4),16) - 60);
  const b = Math.max(0, parseInt(clean.slice(4,6),16) - 60);
  return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
}

/** Choose white or black for text inside the logo circle based on luminance */
function logoTextColor(hex: string): string {
  return luminance(hex) > 0.35 ? "#000000" : "#FFFFFF";
}

/**
 * Splits a full team name into city + nickname.
 * e.g. "Golden State Warriors" → { city: "Golden State", name: "Warriors" }
 * For single-word names (e.g. "Heat"), city = name = the full name.
 */
function splitTeamName(fullName: string): { city: string; name: string } {
  const parts = fullName.trim().split(" ");
  if (parts.length === 1) return { city: fullName, name: fullName };
  const name = parts[parts.length - 1] ?? fullName;
  const city = parts.slice(0, -1).join(" ");
  return { city, name };
}

/** Format a spread value: ensure it shows sign, e.g. "1.5" → "+1.5", "-1.5" → "-1.5" */
function fmtSpread(val: string | null): string | null {
  if (!val) return null;
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  if (n === 0) return "PK";
  return n > 0 ? `+${n}` : String(n);
}

/** Format a total value: strip trailing ".0" */
function fmtTotal(val: string | null): string | null {
  if (!val) return null;
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  return n % 1 === 0 ? String(n) : val;
}

/** Format a moneyline value: ensure sign is shown */
function fmtML(val: string | null): string | null {
  if (!val) return null;
  const n = parseInt(val, 10);
  if (isNaN(n)) return val;
  if (n > 0) return `+${n}`;
  return String(n);
}

/** Clamp a split percentage to [1, 99] for bar display */
function clampPct(val: number | null): number {
  if (val === null || val === undefined) return 50;
  return Math.max(1, Math.min(99, val));
}

// ─── Convert GameSplits → SplitsCardData ─────────────────────────────────────

function buildCardData(game: GameSplits): SplitsCardData {
  const key = formatGameKey(game);
  log("card", `Building card data for: ${key}`);

  // 1. Pick display colors using the same logic as GameCard.tsx
  const homeColor = pickColor(
    game.home_color, game.home_color2, game.home_color3,
    null,
    `${key} HOME`
  );
  const awayColor = pickColor(
    game.away_color, game.away_color2, game.away_color3,
    homeColor,
    `${key} AWAY`
  );

  log("card", `${key} — awayColor=${awayColor} homeColor=${homeColor}`);

  // 2. Build team objects
  const awayNames = splitTeamName(game.away_team);
  const homeNames = splitTeamName(game.home_team);

  const awayTeam: SplitsCardTeam = {
    city:      awayNames.city,
    name:      awayNames.name,
    abbr:      game.away_abbr,
    primary:   awayColor,
    secondary: isUnusable(game.away_color2) ? awayColor : game.away_color2,
    dark:      darkShade(awayColor),
    logoText:  logoTextColor(awayColor),
    logoUrl:   game.away_logo || undefined,
    logoSize:  "17px",
  };

  const homeTeam: SplitsCardTeam = {
    city:      homeNames.city,
    name:      homeNames.name,
    abbr:      game.home_abbr,
    primary:   homeColor,
    secondary: isUnusable(game.home_color2) ? homeColor : game.home_color2,
    dark:      darkShade(homeColor),
    logoText:  logoTextColor(homeColor),
    logoUrl:   game.home_logo || undefined,
    logoSize:  "17px",
  };

  // 3. Format date
  const dateLabel = (() => {
    try {
      return new Date(game.game_date + "T12:00:00").toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
      });
    } catch {
      return game.game_date;
    }
  })();

  // 4. Log line values
  log("card", `${key} — lines: spread=${game.away_book_spread}/${game.home_book_spread} total=${game.book_total} ml=${game.away_ml}/${game.home_ml}`, "debug");

  // 5. Log split values
  const sp = game.spread;
  const to = game.total;
  const ml = game.moneyline;
  log("card", `${key} — spread tix: ${sp.away_ticket_pct}%/${sp.home_ticket_pct}%  money: ${sp.away_money_pct}%/${sp.home_money_pct}%`, "debug");
  log("card", `${key} — total  tix: ${to.over_ticket_pct}%/${to.under_ticket_pct}%  money: ${to.over_money_pct}%/${to.under_money_pct}%`, "debug");
  log("card", `${key} — ml     tix: ${ml.away_ticket_pct}%/${ml.home_ticket_pct}%  money: ${ml.away_money_pct}%/${ml.home_money_pct}%`, "debug");

  const card: SplitsCardData = {
    away: awayTeam,
    home: homeTeam,
    league:     game.league,
    time:       game.start_time,
    date:       dateLabel,
    liveSplits: false,

    spread: {
      awayLine: fmtSpread(game.away_book_spread),
      homeLine: fmtSpread(game.home_book_spread),
      tickets: {
        away: clampPct(sp.away_ticket_pct),
        home: clampPct(sp.home_ticket_pct),
      },
      money: {
        away: clampPct(sp.away_money_pct),
        home: clampPct(sp.home_money_pct),
      },
    },
    total: {
      line: fmtTotal(game.book_total),
      tickets: {
        over:  clampPct(to.over_ticket_pct),
        under: clampPct(to.under_ticket_pct),
      },
      money: {
        over:  clampPct(to.over_money_pct),
        under: clampPct(to.under_money_pct),
      },
    },
    moneyline: {
      awayLine: fmtML(game.away_ml),
      homeLine: fmtML(game.home_ml),
      tickets: {
        away: clampPct(ml.away_ticket_pct),
        home: clampPct(ml.home_ticket_pct),
      },
      money: {
        away: clampPct(ml.away_money_pct),
        home: clampPct(ml.home_money_pct),
      },
    },
  };

  return card;
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export async function handleSplitsCommand(
  interaction: ChatInputCommandInteraction,
  client: Client
): Promise<void> {
  const t0 = Date.now();

  // 1. Access control
  log("auth", `User ${interaction.user.id} (${interaction.user.tag}) invoked /splits`);
  if (interaction.user.id !== ALLOWED_USER_ID) {
    log("auth", `REJECTED — expected ${ALLOWED_USER_ID}`, "warn");
    await interaction.reply({
      content: "❌ You are not authorised to use this command.",
      ephemeral: true,
    });
    return;
  }
  log("auth", "Access granted");

  // 2. Defer reply
  await interaction.deferReply({ ephemeral: true });

  const dateOverride = interaction.options.getString("date") ?? undefined;
  const sportFilter  = interaction.options.getString("sport") ?? "ALL";
  const gameFilter   = interaction.options.getString("game")?.trim() ?? undefined;

  if (dateOverride) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOverride)) {
      log("input", `Invalid date override: "${dateOverride}"`, "warn");
      await interaction.editReply("❌ Invalid date format. Use YYYY-MM-DD (e.g. 2026-03-23).");
      return;
    }
    log("input", `Date override: ${dateOverride}`);
  } else {
    log("input", "No date override — using today ET");
  }
  log("input", `Sport filter: ${sportFilter}${gameFilter ? ` | Game filter: ${gameFilter}` : ""}`);

  // 3. Resolve target channel
  log("channel", `Fetching channel ${SPLITS_CHANNEL_ID}`);
  let channel: TextChannel;
  try {
    const ch = await client.channels.fetch(SPLITS_CHANNEL_ID);
    if (!ch || !ch.isTextBased()) {
      throw new Error(`Channel ${SPLITS_CHANNEL_ID} is not a text channel`);
    }
    channel = ch as TextChannel;
    log("channel", `Resolved: #${channel.name} in guild ${channel.guild?.name ?? "?"}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("channel", `Fetch failed: ${msg}`, "error");
    await interaction.editReply(`❌ Could not access the target channel: ${msg}`);
    return;
  }

  // 4. Fetch splits data
  log("fetch", "Fetching daily splits from DB...");
  let games: GameSplits[];
  try {
    const sportArg = sportFilter === "ALL" ? undefined : sportFilter;
    games = await fetchAllDailySplits(dateOverride, sportArg);
    log("fetch", `Fetched ${games.length} game(s) (sport=${sportFilter})`);

    // Apply single-game filter if specified
    if (gameFilter) {
      const filterLower = gameFilter.toLowerCase();
      games = games.filter((g) => {
        const key = formatGameKey(g).toLowerCase();
        return key.includes(filterLower) ||
          g.away_abbr.toLowerCase().includes(filterLower) ||
          g.home_abbr.toLowerCase().includes(filterLower) ||
          g.away_team.toLowerCase().includes(filterLower) ||
          g.home_team.toLowerCase().includes(filterLower);
      });
      log("fetch", `After game filter "${gameFilter}": ${games.length} game(s) remaining`);
    }

    for (const g of games) {
      const key    = formatGameKey(g);
      const issues = auditSplits(g);
      if (issues.length > 0) {
        log("fetch", `${key} — MISSING FIELDS: ${issues.join(", ")}`, "warn");
      } else {
        log("fetch", `${key} — all split fields present ✓`, "debug");
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("fetch", `Failed: ${msg}`, "error");
    await interaction.editReply(`❌ Failed to fetch splits data: ${msg}`);
    return;
  }

  if (games.length === 0) {
    const dateLabel = dateOverride ?? todayEtLabel();
    const sportMsg  = sportFilter !== "ALL" ? ` (${sportFilter})` : "";
    const gameMsg   = gameFilter ? ` matching "${gameFilter}"` : "";
    log("fetch", `No games found for ${dateLabel}${sportMsg}${gameMsg}`, "warn");
    await interaction.editReply(`ℹ️ No games found for ${dateLabel}${sportMsg}${gameMsg}.`);
    return;
  }

  // 5. Post header message
  const dateLabel = dateOverride
    ? new Date(dateOverride + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric", year: "numeric",
      })
    : todayEtLabel();

  const sportTag = sportFilter !== "ALL" ? ` · ${sportFilter}` : "";
  const gameTag  = gameFilter ? ` · ${gameFilter}` : "";
  const headerCount = games.length === 1
    ? "1 game"
    : `${games.length} games`;

  log("post", `Sending header for ${dateLabel} (${games.length} games, sport=${sportFilter})`);
  try {
    await channel.send({
      content: `## 📊 Daily Betting Splits — ${dateLabel}${sportTag}${gameTag}\n${headerCount}`,
    });
    await sleep(IMAGE_DELAY_MS);
  } catch (err) {
    log("post", `Header send failed: ${err instanceof Error ? err.message : String(err)}`, "warn");
  }

  // 6. Render and post one image per game
  let posted = 0;
  const errors: string[] = [];

  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    const key  = formatGameKey(game);
    log("render", `[${i + 1}/${games.length}] Building card: ${key}`);

    let cardData: SplitsCardData;
    try {
      cardData = buildCardData(game);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("render", `[${i + 1}/${games.length}] buildCardData FAILED for ${key}: ${msg}`, "error");
      errors.push(`${key}: buildCardData — ${msg}`);
      continue;
    }

    log("render", `[${i + 1}/${games.length}] Rendering PNG: ${key}`);
    const renderStart = Date.now();
    let pngBuffer: Buffer;
    try {
      pngBuffer = await renderSplitsCard(cardData);
      const renderMs = Date.now() - renderStart;
      log("render", `[${i + 1}/${games.length}] Rendered in ${renderMs}ms — ${(pngBuffer.length / 1024).toFixed(1)} KB`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("render", `[${i + 1}/${games.length}] renderSplitsCard FAILED for ${key}: ${msg}`, "error");
      errors.push(`${key}: render — ${msg}`);
      if (i < games.length - 1) await sleep(IMAGE_DELAY_MS);
      continue;
    }

    // Post to channel
    try {
      const attachment = new AttachmentBuilder(pngBuffer, {
        name: `splits_${game.away_abbr}_vs_${game.home_abbr}.png`,
      });
      await channel.send({ files: [attachment] });
      posted++;
      log("post", `[${i + 1}/${games.length}] ✅ Posted: ${key}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("post", `[${i + 1}/${games.length}] Discord send FAILED for ${key}: ${msg}`, "error");
      errors.push(`${key}: send — ${msg}`);
    }

    // Rate-limit delay between messages
    if (i < games.length - 1) {
      await sleep(IMAGE_DELAY_MS);
    }
  }

  // 7. Ephemeral summary
  const totalMs = Date.now() - t0;
  const summary = [
    `✅ Posted **${posted}/${games.length}** split images to <#${SPLITS_CHANNEL_ID}>`,
    `📅 Date: **${dateLabel}**`,
    `⏱ Completed in **${(totalMs / 1000).toFixed(1)}s**`,
    errors.length > 0
      ? `⚠️ ${errors.length} image(s) failed:\n${errors.map((e) => `• ${e}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  await interaction.editReply(summary);
  log("done", `Complete — ${posted}/${games.length} posted in ${(totalMs / 1000).toFixed(1)}s` +
    (errors.length > 0 ? ` (${errors.length} errors)` : ""));
}

/**
 * Autocomplete handler for the `game` option.
 * Returns up to 25 matching games from today's DB as choices.
 */
export async function handleSplitsAutocomplete(
  interaction: import("discord.js").AutocompleteInteraction
): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();
  const sportFilter = interaction.options.getString("sport") ?? "ALL";
  const dateOverride = interaction.options.getString("date") ?? undefined;
  try {
    const sportArg = sportFilter === "ALL" ? undefined : sportFilter;
    const games = await fetchAllDailySplits(dateOverride, sportArg);
    const choices = games
      .map((g) => ({
        name: `${g.away_abbr} @ ${g.home_abbr} (${g.league} ${g.start_time})`,
        value: formatGameKey(g),
      }))
      .filter((c) =>
        !focused ||
        c.name.toLowerCase().includes(focused) ||
        c.value.toLowerCase().includes(focused)
      )
      .slice(0, 25);
    await interaction.respond(choices);
  } catch {
    await interaction.respond([]);
  }
}

// Re-export for bot.ts shutdown hook
export { closeSplitsRenderer };
