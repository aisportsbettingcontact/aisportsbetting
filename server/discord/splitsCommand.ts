/**
 * /splits — Slash Command Handler
 *
 * Behaviour:
 *   1. Validates that the invoking user is the allowed user ID.
 *   2. Defers the reply (ephemeral) so Discord doesn't time out.
 *   3. Fetches all daily splits directly from the database.
 *   4. Generates a PNG image per game using the Python image generator.
 *   5. Posts each image as an attachment into the target channel.
 *   6. Adds a 1.5s delay between messages to respect Discord rate limits.
 *   7. Replies to the invoker with an ephemeral summary.
 *
 * Deep logging: every stage emits structured [SplitsBot][stage] prefixed logs.
 * Set LOG_LEVEL=debug in env for Python-level image generation logs.
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  TextChannel,
  AttachmentBuilder,
  type Client,
} from "discord.js";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fetchAllDailySplits, type GameSplits } from "./fetchSplits";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ─── Constants ────────────────────────────────────────────────────────────────
const ALLOWED_USER_ID   = "1098485718734602281";
const SPLITS_CHANNEL_ID = "1400758184188186744";
const IMAGE_DELAY_MS    = 1_500;
const PYTHON_BIN        = "python3.11";
const GENERATOR_SCRIPT  = join(__dirname, "generate_splits_image.py");
const DEBUG_PYTHON      = process.env.LOG_LEVEL === "debug";

// ─── Structured logger ────────────────────────────────────────────────────────
type LogLevel = "info" | "warn" | "error" | "debug";
function log(stage: string, msg: string, level: LogLevel = "info"): void {
  const ts = new Date().toISOString();
  const prefix = `[${ts}][SplitsBot][${stage}]`;
  if (level === "error") {
    console.error(`${prefix} ❌ ${msg}`);
  } else if (level === "warn") {
    console.warn(`${prefix} ⚠️  ${msg}`);
  } else if (level === "debug") {
    if (process.env.LOG_LEVEL === "debug") console.log(`${prefix} 🔍 ${msg}`);
  } else {
    console.log(`${prefix} ${msg}`);
  }
}

// ─── Command definition (used by register script) ─────────────────────────────
export const splitsCommandData = new SlashCommandBuilder()
  .setName("splits")
  .setDescription("Post today's full daily betting splits into the splits channel")
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
  check("spread.away_ticket_pct",  g.spread?.away_ticket_pct);
  check("spread.away_money_pct",   g.spread?.away_money_pct);
  check("spread.home_ticket_pct",  g.spread?.home_ticket_pct);
  check("spread.home_money_pct",   g.spread?.home_money_pct);
  check("total.over_ticket_pct",   g.total?.over_ticket_pct);
  check("total.over_money_pct",    g.total?.over_money_pct);
  check("total.under_ticket_pct",  g.total?.under_ticket_pct);
  check("total.under_money_pct",   g.total?.under_money_pct);
  check("moneyline.away_ticket_pct", g.moneyline?.away_ticket_pct);
  check("moneyline.away_money_pct",  g.moneyline?.away_money_pct);
  check("moneyline.home_ticket_pct", g.moneyline?.home_ticket_pct);
  check("moneyline.home_money_pct",  g.moneyline?.home_money_pct);
  return issues;
}

/**
 * Calls the Python image generator and returns the path to the generated PNG.
 * Streams Python stderr to console when LOG_LEVEL=debug.
 * Throws on non-zero exit code.
 */
function generateSplitsImage(game: GameSplits, outputPath: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      away_team:   game.away_team,
      home_team:   game.home_team,
      away_abbr:   game.away_abbr,
      home_abbr:   game.home_abbr,
      away_color:  game.away_color,
      home_color:  game.home_color,
      away_color2: game.away_color2,
      home_color2: game.home_color2,
      away_color3: game.away_color3,
      home_color3: game.home_color3,
      away_logo:   game.away_logo,
      home_logo:   game.home_logo,
      league:      game.league,
      game_date:   game.game_date,
      start_time:  game.start_time,
      spread:      game.spread,
      total:       game.total,
      moneyline:   game.moneyline,
    });

    const env = { ...process.env, SPLITS_DEBUG: DEBUG_PYTHON ? "1" : "0" };
    const proc = spawn(PYTHON_BIN, [GENERATOR_SCRIPT, payload, outputPath], {
      timeout: 30_000,
      env,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => {
      const chunk = d.toString();
      stderr += chunk;
      if (DEBUG_PYTHON) {
        chunk.split("\n").filter(Boolean).forEach((line) =>
          log("py-generator", line, "debug")
        );
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error(`Python exited ${code}:\n${stderr.trim()}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn Python: ${err.message}`));
    });
  });
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
    games = await fetchAllDailySplits(dateOverride);
    log("fetch", `Fetched ${games.length} game(s)`);

    // Deep audit of each game's data completeness
    for (const g of games) {
      const key    = formatGameKey(g);
      const issues = auditSplits(g);
      if (issues.length > 0) {
        log("fetch", `${key} — MISSING FIELDS: ${issues.join(", ")}`, "warn");
      } else {
        log("fetch", `${key} — all split fields present ✓`, "debug");
      }
      log("fetch", `${key} — colors: away=(${g.away_color},${g.away_color2},${g.away_color3}) home=(${g.home_color},${g.home_color2},${g.home_color3})`, "debug");
      log("fetch", `${key} — logos: away=${g.away_logo ?? "NONE"} home=${g.home_logo ?? "NONE"}`, "debug");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("fetch", `Failed: ${msg}`, "error");
    await interaction.editReply(`❌ Failed to fetch splits data: ${msg}`);
    return;
  }

  if (games.length === 0) {
    const dateLabel = dateOverride ?? todayEtLabel();
    log("fetch", `No games found for ${dateLabel}`, "warn");
    await interaction.editReply(`ℹ️ No games found for ${dateLabel}.`);
    return;
  }

  // 5. Post header message
  const dateLabel = dateOverride
    ? new Date(dateOverride + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric", year: "numeric",
      })
    : todayEtLabel();

  log("post", `Sending header for ${dateLabel} (${games.length} games)`);
  try {
    await channel.send({
      content: `## 📊 Daily Betting Splits — ${dateLabel}\n${games.length} game${games.length !== 1 ? "s" : ""} today`,
    });
    await sleep(IMAGE_DELAY_MS);
  } catch (err) {
    log("post", `Header send failed: ${err instanceof Error ? err.message : String(err)}`, "warn");
  }

  // 6. Generate and post one image per game
  let posted = 0;
  const errors: string[] = [];
  const tmpFiles: string[] = [];

  for (let i = 0; i < games.length; i++) {
    const game    = games[i];
    const key     = formatGameKey(game);
    const tmpPath = join(tmpdir(), `splits_${game.id}_${Date.now()}.png`);
    tmpFiles.push(tmpPath);

    log("image", `[${i + 1}/${games.length}] Generating: ${key}`);
    const genStart = Date.now();

    try {
      const { stdout } = await generateSplitsImage(game, tmpPath);
      const genMs = Date.now() - genStart;
      log("image", `[${i + 1}/${games.length}] Generated in ${genMs}ms — ${stdout}`);

      // Verify file exists and has reasonable size
      const stat = await fs.stat(tmpPath);
      if (stat.size < 1000) {
        throw new Error(`Generated file is suspiciously small: ${stat.size} bytes`);
      }
      log("image", `[${i + 1}/${games.length}] File size: ${(stat.size / 1024).toFixed(1)} KB`);

      // Post to channel
      const attachment = new AttachmentBuilder(tmpPath, {
        name: `splits_${game.away_abbr}_vs_${game.home_abbr}.png`,
      });
      await channel.send({ files: [attachment] });
      posted++;
      log("post", `[${i + 1}/${games.length}] ✅ Posted: ${key}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("image", `[${i + 1}/${games.length}] FAILED for ${key}: ${msg}`, "error");
      errors.push(`${key}: ${msg}`);
    }

    // Rate-limit delay between messages
    if (i < games.length - 1) {
      await sleep(IMAGE_DELAY_MS);
    }
  }

  // 7. Cleanup temp files
  log("cleanup", `Removing ${tmpFiles.length} temp file(s)`);
  for (const f of tmpFiles) {
    fs.unlink(f).catch((e) => log("cleanup", `Could not delete ${f}: ${e.message}`, "warn"));
  }

  // 8. Ephemeral summary
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
