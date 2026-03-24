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
// Discord rate limit for channel sends: 5 messages per 5 seconds per channel.
// 800ms between posts is safe (1.25 msg/s) and avoids the 429 rate-limit error.
const IMAGE_DELAY_MS    = 800;

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
        { name: "MLB",         value: "MLB" },
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
 * Hardcoded city/nickname display map for teams whose names don't split cleanly
 * by taking the last word as the nickname.
 * Key = full team name as stored in the DB (game.away_team / game.home_team)
 */
const TEAM_NAME_OVERRIDES: Record<string, { city: string; name: string }> = {
  // NHL — multi-word nicknames
  "Vegas Golden Knights":    { city: "Vegas",      name: "Golden Knights" },
  "Columbus Blue Jackets":   { city: "Columbus",   name: "Blue Jackets" },
  "Toronto Maple Leafs":     { city: "Toronto",    name: "Maple Leafs" },
  "New York Islanders":      { city: "New York",   name: "Islanders" },
  "New York Rangers":        { city: "New York",   name: "Rangers" },
  "New Jersey Devils":       { city: "New Jersey", name: "Devils" },
  "Los Angeles Kings":       { city: "Los Angeles",name: "Kings" },
  "San Jose Sharks":         { city: "San Jose",   name: "Sharks" },
  "Tampa Bay Lightning":     { city: "Tampa Bay",  name: "Lightning" },
  "St. Louis Blues":         { city: "St. Louis",  name: "Blues" },
  "Carolina Hurricanes":     { city: "Carolina",   name: "Hurricanes" },
  "Florida Panthers":        { city: "Florida",    name: "Panthers" },
  "Colorado Avalanche":      { city: "Colorado",   name: "Avalanche" },
  "Minnesota Wild":          { city: "Minnesota",  name: "Wild" },
  "Anaheim Ducks":           { city: "Anaheim",    name: "Ducks" },
  "Arizona Coyotes":         { city: "Arizona",    name: "Coyotes" },
  "Utah Hockey Club":        { city: "Utah",       name: "Hockey Club" },
  // NBA — multi-word nicknames or cities
  "Golden State Warriors":   { city: "Golden State",name: "Warriors" },
  "Oklahoma City Thunder":   { city: "Oklahoma City",name: "Thunder" },
  "San Antonio Spurs":       { city: "San Antonio", name: "Spurs" },
  "New York Knicks":         { city: "New York",    name: "Knicks" },
  "New Orleans Pelicans":    { city: "New Orleans", name: "Pelicans" },
  "Los Angeles Lakers":      { city: "Los Angeles", name: "Lakers" },
  "Los Angeles Clippers":    { city: "Los Angeles", name: "Clippers" },
  "Portland Trail Blazers":  { city: "Portland",    name: "Trail Blazers" },
  "Utah Jazz":               { city: "Utah",        name: "Jazz" },
  "Memphis Grizzlies":       { city: "Memphis",     name: "Grizzlies" },
  "Minnesota Timberwolves":  { city: "Minnesota",   name: "Timberwolves" },
  "Indiana Pacers":          { city: "Indiana",     name: "Pacers" },
  "Orlando Magic":           { city: "Orlando",     name: "Magic" },
  "Sacramento Kings":        { city: "Sacramento",  name: "Kings" },
  "San Francisco 49ers":     { city: "San Francisco",name: "49ers" },
};

/**
 * Splits a full team name into city + nickname.
 * Uses hardcoded overrides for teams whose names don't split cleanly
 * by taking the last word as the nickname.
 */
function splitTeamName(fullName: string): { city: string; name: string } {
  const override = TEAM_NAME_OVERRIDES[fullName.trim()];
  if (override) return override;
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

  // 2. Build team objects — city/nickname come directly from the team registry
  const awayTeam: SplitsCardTeam = {
    city:      game.away_city,
    name:      game.away_nickname,
    abbr:      game.away_abbr,
    primary:   awayColor,
    secondary: isUnusable(game.away_color2) ? awayColor : game.away_color2,
    dark:      darkShade(awayColor),
    logoText:  logoTextColor(awayColor),
    logoUrl:   game.away_logo || undefined,
    logoSize:  "17px",
  };

  const homeTeam: SplitsCardTeam = {
    city:      game.home_city,
    name:      game.home_nickname,
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
  const interactionId = interaction.id;

  log("init", `Interaction ${interactionId} received — user=${interaction.user.id} (${interaction.user.tag}) deferred=${interaction.deferred} replied=${interaction.replied}`);

  // ─── STEP 1: Defer IMMEDIATELY — must happen within 3 seconds ────────────────
  // This MUST be the very first async operation. Discord will show
  // "application did not respond" if we don't acknowledge within 3s.
  // We wrap in try/catch because Discord sometimes delivers duplicate
  // interaction events (gateway retries), and calling deferReply on an
  // already-acknowledged interaction throws "Interaction has already been
  // acknowledged." — we detect this and bail out gracefully.
  if (!interaction.deferred && !interaction.replied) {
    try {
      log("defer", `Interaction ${interactionId} — calling deferReply (ephemeral)`);
      await interaction.deferReply({ ephemeral: true });
      log("defer", `Interaction ${interactionId} — deferReply succeeded (${Date.now() - t0}ms elapsed)`);
    } catch (deferErr) {
      const deferMsg = deferErr instanceof Error ? deferErr.message : String(deferErr);
      log("defer", `Interaction ${interactionId} — deferReply FAILED: ${deferMsg}`, "error");
      // If deferReply fails, Discord has already auto-acknowledged or timed out
      // this interaction. We cannot respond — bail out immediately.
      // This is a Discord gateway duplicate delivery — not a bug in our code.
      log("defer", `Interaction ${interactionId} — bailing out (duplicate delivery or already timed out)`, "warn");
      return;
    }
  } else {
    log("defer", `Interaction ${interactionId} — already deferred/replied (deferred=${interaction.deferred} replied=${interaction.replied}), skipping deferReply`, "warn");
  }

  // ─── STEP 2: Access control (AFTER defer — we can now editReply on failure) ──
  log("auth", `Interaction ${interactionId} — checking user ${interaction.user.id} (${interaction.user.tag})`);
  if (interaction.user.id !== ALLOWED_USER_ID) {
    log("auth", `Interaction ${interactionId} — REJECTED (expected ${ALLOWED_USER_ID})`, "warn");
    await interaction.editReply("❌ You are not authorised to use this command.");
    return;
  }
  log("auth", `Interaction ${interactionId} — access granted`);

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

  // 3. Resolve target channel — use the channel where the command was invoked
  log("channel", `Resolving channel from interaction: channelId=${interaction.channelId}`);
  const rawChannel = interaction.channel;
  if (!rawChannel || !rawChannel.isTextBased()) {
    log("channel", `Channel ${interaction.channelId} is not a text-based channel or is unavailable`, "error");
    await interaction.editReply("❌ Could not post here — this channel is not a text channel.");
    return;
  }
  const channel = rawChannel as TextChannel;
  log("channel", `Resolved: #${channel.name ?? interaction.channelId} in guild ${channel.guild?.name ?? "DM/unknown"}`);

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

  log("post", `Posting ${games.length} game(s) for ${dateLabel} (sport=${sportFilter})`);

  // 6. Build card data for all games (synchronous, fast)
  const errors: string[] = [];
  type RenderJob = { game: GameSplits; cardData: SplitsCardData; key: string; index: number };
  const jobs: RenderJob[] = [];

  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    const key  = formatGameKey(game);
    log("render", `[${i + 1}/${games.length}] Building card: ${key}`);
    try {
      const cardData = buildCardData(game);
      jobs.push({ game, cardData, key, index: i });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("render", `[${i + 1}/${games.length}] buildCardData FAILED for ${key}: ${msg}`, "error");
      errors.push(`${key}: buildCardData — ${msg}`);
    }
  }

  // 7. Render ALL cards in PARALLEL — Playwright handles concurrent pages
  //    Each render uses its own browser page; pages are pooled and reused.
  //    This means 4 NBA games render in ~render_time_1 instead of 4×render_time.
  log("render", `Starting parallel render of ${jobs.length} card(s)...`);
  const tRenderAll = Date.now();

  type RenderResult =
    | { ok: true;  job: RenderJob; buffer: Buffer; renderMs: number }
    | { ok: false; job: RenderJob; error: string };

  const renderResults: RenderResult[] = await Promise.all(
    jobs.map(async (job): Promise<RenderResult> => {
      const t0r = Date.now();
      log("render", `[${job.index + 1}/${games.length}] Rendering PNG: ${job.key}`);
      try {
        const buffer = await renderSplitsCard(job.cardData);
        const renderMs = Date.now() - t0r;
        log("render", `[${job.index + 1}/${games.length}] ✅ Rendered in ${renderMs}ms — ${(buffer.length / 1024).toFixed(1)} KB`);
        return { ok: true, job, buffer, renderMs };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log("render", `[${job.index + 1}/${games.length}] renderSplitsCard FAILED for ${job.key}: ${msg}`, "error");
        return { ok: false, job, error: msg };
      }
    })
  );

  log("render", `All ${jobs.length} render(s) complete in ${Date.now() - tRenderAll}ms`);

  // Collect render errors
  for (const r of renderResults) {
    if (!r.ok) errors.push(`${r.job.key}: render — ${r.error}`);
  }

  // 8. Post successful renders to channel SEQUENTIALLY with rate-limit delay
  //    Discord rate limit: 5 messages/5s per channel. 800ms gap = 1.25 msg/s (safe).
  const successfulRenders = renderResults.filter((r): r is Extract<RenderResult, { ok: true }> => r.ok);
  let posted = 0;

  for (let i = 0; i < successfulRenders.length; i++) {
    const { job, buffer } = successfulRenders[i];
    const tPost0 = Date.now();
    try {
      const attachment = new AttachmentBuilder(buffer, {
        name: `splits_${job.game.away_abbr}_vs_${job.game.home_abbr}.png`,
      });
      await channel.send({ files: [attachment] });
      posted++;
      log("post", `[${i + 1}/${successfulRenders.length}] ✅ Posted: ${job.key} (upload ${Date.now() - tPost0}ms)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("post", `[${i + 1}/${successfulRenders.length}] Discord send FAILED for ${job.key}: ${msg}`, "error");
      errors.push(`${job.key}: send — ${msg}`);
    }
    // Rate-limit gap between posts (not after the last one)
    if (i < successfulRenders.length - 1) {
      await sleep(IMAGE_DELAY_MS);
    }
  }

  // 7. Ephemeral summary
  const totalMs = Date.now() - t0;
  const summary = [
    `✅ Posted **${posted}/${games.length}** split image(s) to <#${interaction.channelId}>`,
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
