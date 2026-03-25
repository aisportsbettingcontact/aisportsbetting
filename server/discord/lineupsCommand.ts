/**
 * /lineups — Slash Command Handler
 *
 * Posts MLB lineup cards as PNG images to the target channel.
 *
 * Options:
 *   scope   — Dropdown: "TODAY" | "ALL" (7-day window) | "YYYY-MM-DD" (autocomplete)
 *   game    — Autocomplete: single game (e.g. "NYY @ SF") — filtered by scope
 *   channel — Target channel ID override (defaults to Test Channel)
 *
 * Key fixes vs v1:
 *   - Uses resolveTeam() from teamRegistry (handles abbreviations like "NYY", "SF")
 *     instead of MLB_BY_DB_SLUG (only keyed by VSiN slugs like "yankees", "giants")
 *   - formatTime() passes through already-formatted "7:05 PM ET" strings unchanged
 *   - Full dropdown UX with date scope + game autocomplete
 *
 * Default target channel: 1400758184188186744 (Test Channel)
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  TextChannel,
  AttachmentBuilder,
  type Client,
} from "discord.js";
import { listGamesByDate, listGames, getMlbLineupsByGameIds } from "../db.js";
import { resolveTeam } from "./teamRegistry.js";
import { renderLineupCard, type LineupCardData, type LineupCardPlayer, type LineupCardPitcher } from "./renderLineupCard.js";
import type { Game } from "../../drizzle/schema.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const ALLOWED_USER_ID    = "1098485718734602281";
const DEFAULT_CHANNEL_ID = "1400758184188186744"; // Test Channel
const IMAGE_DELAY_MS     = 800;

// ─── Logger ───────────────────────────────────────────────────────────────────
type LogLevel = "info" | "warn" | "error" | "debug";
function log(stage: string, msg: string, level: LogLevel = "info"): void {
  const ts     = new Date().toISOString();
  const prefix = `[${ts}][LineupsBot][${stage}]`;
  if (level === "error")      console.error(`${prefix} ❌ ${msg}`);
  else if (level === "warn")  console.warn(`${prefix} ⚠️  ${msg}`);
  else if (level === "debug") {
    if (process.env.LOG_LEVEL === "debug") console.log(`${prefix} 🔍 ${msg}`);
  } else {
    console.log(`${prefix} ${msg}`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns today's date in ET as YYYY-MM-DD */
function todayEtDate(): string {
  return new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    year:  "numeric",
    month: "2-digit",
    day:   "2-digit",
  }).replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$3-$1-$2");
}

/** Returns today's date as a human-readable label */
function todayEtLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month:   "long",
    day:     "numeric",
    year:    "numeric",
  });
}

/** Returns the next N calendar dates from today (ET) as YYYY-MM-DD strings */
function nextNDates(n: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    dates.push(d.toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      year:  "numeric",
      month: "2-digit",
      day:   "2-digit",
    }).replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$3-$1-$2"));
  }
  return dates;
}

/**
 * Formats a time string for display.
 *
 * Handles two input formats:
 *   1. Already-formatted: "7:05 PM ET" — returned as-is (MLB games store times this way)
 *   2. Raw 24-hour "HH:MM" — converted to "H:MM AM/PM ET" (NBA/NHL/NCAAM format)
 */
function formatTime(raw: string | null | undefined): string {
  if (!raw) {
    log("time", `formatTime: null/empty → TBD`, "debug");
    return "TBD";
  }
  // Pass through strings that already contain AM/PM (e.g. "7:05 PM ET")
  if (/AM|PM/i.test(raw)) {
    log("time", `formatTime: pass-through "${raw}"`, "debug");
    return raw;
  }
  // Raw 24-hour "HH:MM"
  const [hStr, mStr] = raw.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = parseInt(mStr ?? "0", 10);
  if (isNaN(h) || isNaN(m)) {
    log("time", `formatTime: unparseable "${raw}" → returned as-is`, "warn");
    return raw;
  }
  const period = h >= 12 ? "PM" : "AM";
  const h12    = h % 12 === 0 ? 12 : h % 12;
  const result = `${h12}:${String(m).padStart(2, "0")} ${period} ET`;
  log("time", `formatTime: "${raw}" → "${result}"`, "debug");
  return result;
}

/** Darken a hex color by subtracting from each channel */
function darkShade(hex: string): string {
  const clean = hex.replace("#", "");
  const r = Math.max(0, parseInt(clean.slice(0, 2), 16) - 60);
  const g = Math.max(0, parseInt(clean.slice(2, 4), 16) - 60);
  const b = Math.max(0, parseInt(clean.slice(4, 6), 16) - 60);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/** Format a game as "NYY @ SF (7:05 PM ET)" for autocomplete display */
function gameLabel(g: Game): string {
  return `${g.awayTeam} @ ${g.homeTeam} (${g.startTimeEst ?? "TBD"})`;
}

/** Format a game as "NYY @ SF" for the value field */
function gameValue(g: Game): string {
  return `${g.awayTeam} @ ${g.homeTeam}`;
}

/** Fetch MLB games for a given scope */
async function fetchGamesForScope(scope: string): Promise<Game[]> {
  if (scope === "TODAY") {
    const today = todayEtDate();
    log("fetch", `Scope=TODAY → date=${today}`);
    return listGamesByDate(today, "MLB");
  }
  if (scope === "ALL") {
    log("fetch", `Scope=ALL → listGames(MLB)`);
    return listGames({ sport: "MLB" });
  }
  // Specific date: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(scope)) {
    log("fetch", `Scope=date → date=${scope}`);
    return listGamesByDate(scope, "MLB");
  }
  log("fetch", `Unknown scope "${scope}" → defaulting to TODAY`, "warn");
  return listGamesByDate(todayEtDate(), "MLB");
}

// ─── Command definition ───────────────────────────────────────────────────────
export const lineupsCommandData = new SlashCommandBuilder()
  .setName("lineups")
  .setDescription("Post MLB lineup cards to the channel")
  // ── scope: dropdown with TODAY / ALL / date autocomplete ──
  .addStringOption((opt) =>
    opt
      .setName("scope")
      .setDescription("Which games to post: TODAY, ALL (7-day window), or a specific date")
      .setRequired(false)
      .addChoices(
        { name: "TODAY",           value: "TODAY" },
        { name: "ALL (7 days)",    value: "ALL"   },
      )
      // Note: specific dates are entered via the `date` option below (autocomplete)
  )
  // ── date: autocomplete for specific date override ──
  .addStringOption((opt) =>
    opt
      .setName("date")
      .setDescription("Specific date (YYYY-MM-DD) — overrides scope; autocomplete shows upcoming dates")
      .setRequired(false)
      .setAutocomplete(true)
  )
  // ── game: autocomplete filtered by scope/date ──
  .addStringOption((opt) =>
    opt
      .setName("game")
      .setDescription("Post a single game (e.g. NYY @ SF) — leave blank for all games")
      .setRequired(false)
      .setAutocomplete(true)
  )
  // ── channel: optional override ──
  .addStringOption((opt) =>
    opt
      .setName("channel")
      .setDescription("Target channel ID (defaults to Test Channel)")
      .setRequired(false)
  );

// ─── Autocomplete handler ─────────────────────────────────────────────────────
export async function handleLineupsAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const focused      = interaction.options.getFocused(true);
  const focusedValue = focused.value.toLowerCase();

  log("autocomplete", `field="${focused.name}" value="${focusedValue}"`);

  try {
    // ── date field: suggest upcoming YYYY-MM-DD values ──
    if (focused.name === "date") {
      const upcoming = nextNDates(14); // next 14 days
      const choices = upcoming
        .filter((d) => !focusedValue || d.includes(focusedValue))
        .slice(0, 25)
        .map((d) => {
          const label = new Date(d + "T12:00:00").toLocaleDateString("en-US", {
            weekday: "short", month: "short", day: "numeric",
          });
          return { name: `${d} (${label})`, value: d };
        });
      log("autocomplete", `date: returning ${choices.length} choices`);
      await interaction.respond(choices);
      return;
    }

    // ── game field: suggest MLB games filtered by scope/date ──
    if (focused.name === "game") {
      const scope       = interaction.options.getString("scope") ?? "TODAY";
      const dateOverride = interaction.options.getString("date") ?? undefined;
      const effectiveScope = dateOverride ?? scope;

      log("autocomplete", `game: scope="${scope}" date="${dateOverride}" effective="${effectiveScope}"`);

      const games = await fetchGamesForScope(effectiveScope);
      log("autocomplete", `game: fetched ${games.length} MLB game(s)`);

      const choices = games
        .map((g) => ({
          name:  gameLabel(g),
          value: gameValue(g),
        }))
        .filter((c) =>
          !focusedValue ||
          c.name.toLowerCase().includes(focusedValue) ||
          c.value.toLowerCase().includes(focusedValue)
        )
        .slice(0, 25);

      log("autocomplete", `game: returning ${choices.length} choices`);
      await interaction.respond(choices);
      return;
    }

    await interaction.respond([]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("autocomplete", `Error: ${msg}`, "error");
    try { await interaction.respond([]); } catch { /* ignore */ }
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function handleLineupsCommand(
  interaction: ChatInputCommandInteraction,
  client: Client
): Promise<void> {
  const t0            = Date.now();
  const interactionId = interaction.id;

  log("init", `Interaction ${interactionId} — user=${interaction.user.id} (${interaction.user.tag})`);

  // ── STEP 1: Defer immediately ──────────────────────────────────────────────
  if (!interaction.deferred && !interaction.replied) {
    try {
      await interaction.deferReply({ ephemeral: true });
      log("defer", `Deferred in ${Date.now() - t0}ms`);
    } catch (deferErr) {
      const msg = deferErr instanceof Error ? deferErr.message : String(deferErr);
      log("defer", `deferReply FAILED: ${msg} — bailing out`, "error");
      return;
    }
  }

  // ── STEP 2: Access control ─────────────────────────────────────────────────
  if (interaction.user.id !== ALLOWED_USER_ID) {
    log("auth", `REJECTED user ${interaction.user.id}`, "warn");
    await interaction.editReply("❌ You are not authorised to use this command.");
    return;
  }

  // ── STEP 3: Parse options ──────────────────────────────────────────────────
  const scope          = interaction.options.getString("scope") ?? "TODAY";
  const dateOverride   = interaction.options.getString("date")  ?? undefined;
  const gameFilter     = interaction.options.getString("game")  ?? undefined;
  const channelOverride = interaction.options.getString("channel") ?? undefined;

  // Validate date override format
  if (dateOverride && !/^\d{4}-\d{2}-\d{2}$/.test(dateOverride)) {
    await interaction.editReply("❌ Invalid date format. Use YYYY-MM-DD (e.g. 2026-03-25).");
    return;
  }

  const effectiveScope  = dateOverride ?? scope;
  const targetChannelId = channelOverride ?? DEFAULT_CHANNEL_ID;

  log("input", `scope="${scope}" date="${dateOverride ?? 'none'}" game="${gameFilter ?? 'ALL'}" channel=${targetChannelId} → effectiveScope="${effectiveScope}"`);

  // ── STEP 4: Resolve target channel ────────────────────────────────────────
  let channel: TextChannel;
  try {
    const rawChannel = await client.channels.fetch(targetChannelId);
    if (!rawChannel || !rawChannel.isTextBased()) {
      await interaction.editReply(`❌ Channel ${targetChannelId} is not a text channel or could not be fetched.`);
      return;
    }
    channel = rawChannel as TextChannel;
    log("channel", `Resolved: #${channel.name} in ${channel.guild?.name ?? "unknown"}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("channel", `Failed to fetch channel ${targetChannelId}: ${msg}`, "error");
    await interaction.editReply(`❌ Could not access channel ${targetChannelId}: ${msg}`);
    return;
  }

  // ── STEP 5: Fetch MLB games ────────────────────────────────────────────────
  log("fetch", `Fetching MLB games for scope="${effectiveScope}"...`);
  let allGames: Game[];
  try {
    allGames = await fetchGamesForScope(effectiveScope);
    log("fetch", `Found ${allGames.length} MLB game(s) before game filter`);
    allGames.forEach((g, i) =>
      log("fetch", `  [${i + 1}] id=${g.id} date=${g.gameDate} "${g.awayTeam} @ ${g.homeTeam}" time="${g.startTimeEst}"`)
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("fetch", `DB error: ${msg}`, "error");
    await interaction.editReply(`❌ Failed to fetch MLB games: ${msg}`);
    return;
  }

  // ── STEP 6: Apply game filter ──────────────────────────────────────────────
  let games = allGames;
  if (gameFilter) {
    const filterLower = gameFilter.toLowerCase();
    games = allGames.filter((g) => {
      const key = `${g.awayTeam} @ ${g.homeTeam}`.toLowerCase();
      return key === filterLower || key.includes(filterLower);
    });
    log("filter", `Game filter "${gameFilter}" → ${games.length}/${allGames.length} game(s) match`);
    if (games.length === 0) {
      await interaction.editReply(`ℹ️ No MLB games match filter "${gameFilter}" for scope "${effectiveScope}".`);
      return;
    }
  }

  if (games.length === 0) {
    const label = effectiveScope === "TODAY"
      ? todayEtLabel()
      : effectiveScope === "ALL"
        ? "the next 7 days"
        : new Date(effectiveScope + "T12:00:00").toLocaleDateString("en-US", {
            weekday: "long", month: "long", day: "numeric", year: "numeric",
          });
    await interaction.editReply(`ℹ️ No MLB games found for ${label}.`);
    return;
  }

  // ── STEP 7: Fetch lineup records ──────────────────────────────────────────
  const gameIds = games.map((g) => g.id);
  log("lineups", `Fetching lineups for ${gameIds.length} game(s): [${gameIds.join(", ")}]`);
  let lineupsMap: Map<number, Awaited<ReturnType<typeof getMlbLineupsByGameIds>> extends Map<number, infer V> ? V : never>;
  try {
    lineupsMap = await getMlbLineupsByGameIds(gameIds) as any;
    log("lineups", `Got ${lineupsMap.size}/${gameIds.length} lineup records`);
    Array.from(lineupsMap.entries()).forEach(([gid, lu]) => {
      log("lineups", `  gameId=${gid} awayPitcher="${lu.awayPitcherName ?? 'TBD'}" homePitcher="${lu.homePitcherName ?? 'TBD'}" awayLineupLen=${lu.awayLineup ? JSON.parse(lu.awayLineup).length : 0} homeLineupLen=${lu.homeLineup ? JSON.parse(lu.homeLineup).length : 0}`);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("lineups", `DB error fetching lineups: ${msg} — proceeding without lineup data`, "warn");
    lineupsMap = new Map();
  }

  // ── STEP 8: Post header ───────────────────────────────────────────────────
  const dateLabel = effectiveScope === "TODAY"
    ? todayEtLabel()
    : effectiveScope === "ALL"
      ? "Upcoming MLB Games"
      : new Date(effectiveScope + "T12:00:00").toLocaleDateString("en-US", {
          weekday: "long", month: "long", day: "numeric", year: "numeric",
        });

  await channel.send({
    content: `⚾ **MLB LINEUPS — ${dateLabel.toUpperCase()}** ⚾\n${games.length} game${games.length !== 1 ? "s" : ""}`,
  });

  // ── STEP 9: Resolve teams, render, and post each card ─────────────────────
  let posted = 0;
  const errors: string[] = [];

  for (const game of games) {
    const matchup = `${game.awayTeam} @ ${game.homeTeam}`;
    log("card", `Processing ${matchup} (gameId=${game.id} date=${game.gameDate})`);

    // ── Team resolution via resolveTeam() ──
    // CRITICAL: The games DB stores team values as MLB abbreviations (e.g. "NYY", "SF"),
    // NOT as VSiN slugs (e.g. "yankees", "giants"). resolveTeam() handles both lookup paths.
    log("team", `${matchup} — resolving: away="${game.awayTeam}" home="${game.homeTeam}" sport="MLB"`);
    const awayEntry = resolveTeam(game.awayTeam, "MLB");
    const homeEntry = resolveTeam(game.homeTeam, "MLB");

    // Deep audit: log full resolved entry so any future mapping issues are immediately visible
    log("team", `${matchup} — away: city="${awayEntry.city}" nickname="${awayEntry.nickname}" abbrev="${awayEntry.abbrev}" color="${awayEntry.primaryColor}" logo="${awayEntry.logoUrl ? awayEntry.logoUrl.slice(0, 55) + '...' : 'NONE'}"`);
    log("team", `${matchup} — home: city="${homeEntry.city}" nickname="${homeEntry.nickname}" abbrev="${homeEntry.abbrev}" color="${homeEntry.primaryColor}" logo="${homeEntry.logoUrl ? homeEntry.logoUrl.slice(0, 55) + '...' : 'NONE'}"`);

    // Warn if fallback was used (fallback has empty logoUrl and #4A90D9 primaryColor)
    const awayFallback = awayEntry.logoUrl === "" || awayEntry.primaryColor === "#4A90D9";
    const homeFallback = homeEntry.logoUrl === "" || homeEntry.primaryColor === "#4A90D9";
    if (awayFallback) {
      log("team", `${matchup} — ⚠️ AWAY FALLBACK: "${game.awayTeam}" not in MLB registry — check mlbTeams.ts abbrev list`, "warn");
    }
    if (homeFallback) {
      log("team", `${matchup} — ⚠️ HOME FALLBACK: "${game.homeTeam}" not in MLB registry — check mlbTeams.ts abbrev list`, "warn");
    }

    // ── Lineup data ──
    const lineup = lineupsMap.get(game.id);
    log("lineup", `${matchup} — lineup record: ${lineup ? "FOUND" : "NOT FOUND (will render empty lineup)"}`);

    let awayPlayers: LineupCardPlayer[] = [];
    let homePlayers: LineupCardPlayer[] = [];
    try {
      if (lineup?.awayLineup) {
        awayPlayers = JSON.parse(lineup.awayLineup) as LineupCardPlayer[];
        log("lineup", `${matchup} — away lineup: ${awayPlayers.length} players`);
      }
    } catch (parseErr) {
      log("lineup", `${matchup} — failed to parse awayLineup JSON: ${parseErr}`, "warn");
    }
    try {
      if (lineup?.homeLineup) {
        homePlayers = JSON.parse(lineup.homeLineup) as LineupCardPlayer[];
        log("lineup", `${matchup} — home lineup: ${homePlayers.length} players`);
      }
    } catch (parseErr) {
      log("lineup", `${matchup} — failed to parse homeLineup JSON: ${parseErr}`, "warn");
    }

    const awayPitcher: LineupCardPitcher = {
      name:      lineup?.awayPitcherName      ?? null,
      hand:      lineup?.awayPitcherHand      ?? null,
      era:       lineup?.awayPitcherEra       ?? null,
      mlbamId:   lineup?.awayPitcherMlbamId   ?? null,
      confirmed: lineup?.awayPitcherConfirmed ?? false,
    };
    const homePitcher: LineupCardPitcher = {
      name:      lineup?.homePitcherName      ?? null,
      hand:      lineup?.homePitcherHand      ?? null,
      era:       lineup?.homePitcherEra       ?? null,
      mlbamId:   lineup?.homePitcherMlbamId   ?? null,
      confirmed: lineup?.homePitcherConfirmed ?? false,
    };

    log("lineup", `${matchup} — awayPitcher="${awayPitcher.name ?? 'TBD'}" homePitcher="${homePitcher.name ?? 'TBD'}"`);

    // ── Build card data ──
    const cardData: LineupCardData = {
      away: {
        city:           awayEntry.city,
        nickname:       awayEntry.nickname,
        abbrev:         awayEntry.abbrev,
        primaryColor:   awayEntry.primaryColor,
        secondaryColor: awayEntry.secondaryColor,
        tertiaryColor:  awayEntry.tertiaryColor,
        darkColor:      darkShade(awayEntry.primaryColor),
        logoUrl:        awayEntry.logoUrl,
      },
      home: {
        city:           homeEntry.city,
        nickname:       homeEntry.nickname,
        abbrev:         homeEntry.abbrev,
        primaryColor:   homeEntry.primaryColor,
        secondaryColor: homeEntry.secondaryColor,
        tertiaryColor:  homeEntry.tertiaryColor,
        darkColor:      darkShade(homeEntry.primaryColor),
        logoUrl:        homeEntry.logoUrl,
      },
      startTime: formatTime(game.startTimeEst),
      lineup: {
        awayPitcher,
        homePitcher,
        awayPlayers,
        homePlayers,
        awayLineupConfirmed: lineup?.awayLineupConfirmed ?? false,
        homeLineupConfirmed: lineup?.homeLineupConfirmed ?? false,
        weather: lineup ? {
          icon:   lineup.weatherIcon   ?? null,
          temp:   lineup.weatherTemp   ?? null,
          wind:   lineup.weatherWind   ?? null,
          precip: lineup.weatherPrecip ?? null,
          dome:   lineup.weatherDome   ?? false,
        } : null,
      },
    };

    log("render", `${matchup} — rendering PNG...`);
    const renderStart = Date.now();

    try {
      const pngBuffer = await renderLineupCard(cardData);
      const renderMs  = Date.now() - renderStart;
      log("render", `${matchup} — rendered in ${renderMs}ms (${pngBuffer.length} bytes)`);

      const attachment = new AttachmentBuilder(pngBuffer, {
        name: `lineup_${awayEntry.abbrev}_${homeEntry.abbrev}.png`,
      });
      await channel.send({ files: [attachment] });
      posted++;
      log("post", `${matchup} — posted ✅ (${posted}/${games.length})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("render", `${matchup} — FAILED: ${msg}`, "error");
      errors.push(`${matchup}: ${msg}`);
    }

    if (posted + errors.length < games.length) await sleep(IMAGE_DELAY_MS);
  }

  // ── STEP 10: Ephemeral summary ────────────────────────────────────────────
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const summary = [
    `✅ Posted **${posted}/${games.length}** lineup card${posted !== 1 ? "s" : ""} to <#${targetChannelId}>`,
    `⏱️ Completed in ${elapsed}s`,
    errors.length > 0
      ? `⚠️ ${errors.length} error(s):\n${errors.map((e) => `• ${e}`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n");

  await interaction.editReply(summary);
  log("done", `Complete — posted=${posted} errors=${errors.length} elapsed=${elapsed}s`);
}
