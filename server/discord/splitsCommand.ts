/**
 * /splits — Slash Command Handler
 *
 * Behaviour:
 *   1. Validates that the invoking user is the allowed user ID.
 *   2. Defers the reply (ephemeral) so Discord doesn't time out.
 *   3. Fetches all daily splits directly from the database.
 *   4. Generates a PNG image per game using the Python image generator.
 *   5. Posts each image as an attachment into the target channel.
 *   6. Adds a 1.2s delay between messages to respect Discord rate limits.
 *   7. Replies to the invoker with an ephemeral summary.
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
const __dirname = dirname(__filename);

// ─── Constants ────────────────────────────────────────────────────────────────
const ALLOWED_USER_ID  = "1098485718734602281";
const SPLITS_CHANNEL_ID = "1400758184188186744";
const IMAGE_DELAY_MS   = 1_500;
const PYTHON_BIN       = "python3.11";
const GENERATOR_SCRIPT = join(__dirname, "generate_splits_image.py");

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
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Calls the Python image generator and returns the path to the generated PNG.
 * Throws on non-zero exit code or stderr output.
 */
function generateSplitsImage(game: GameSplits, outputPath: string): Promise<void> {
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
      away_logo:   game.away_logo,
      home_logo:   game.home_logo,
      league:      game.league,
      game_date:   game.game_date,
      start_time:  game.start_time,
      spread:      game.spread,
      total:       game.total,
      moneyline:   game.moneyline,
    });

    const proc = spawn(PYTHON_BIN, [GENERATOR_SCRIPT, payload, outputPath], {
      timeout: 30_000,
    });

    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Image generator exited ${code}: ${stderr.trim()}`));
      }
    });

    proc.on("error", reject);
  });
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export async function handleSplitsCommand(
  interaction: ChatInputCommandInteraction,
  client: Client
): Promise<void> {
  // 1. Access control
  if (interaction.user.id !== ALLOWED_USER_ID) {
    await interaction.reply({
      content: "❌ You are not authorised to use this command.",
      ephemeral: true,
    });
    console.warn(
      `[SplitsBot] Unauthorised /splits attempt by ${interaction.user.id} (${interaction.user.tag})`
    );
    return;
  }

  // 2. Defer reply (up to 15 min to respond)
  await interaction.deferReply({ ephemeral: true });

  const dateOverride = interaction.options.getString("date") ?? undefined;

  if (dateOverride && !/^\d{4}-\d{2}-\d{2}$/.test(dateOverride)) {
    await interaction.editReply("❌ Invalid date format. Use YYYY-MM-DD (e.g. 2026-03-23).");
    return;
  }

  // 3. Resolve target channel
  let channel: TextChannel;
  try {
    const ch = await client.channels.fetch(SPLITS_CHANNEL_ID);
    if (!ch || !ch.isTextBased()) {
      throw new Error(`Channel ${SPLITS_CHANNEL_ID} is not a text channel`);
    }
    channel = ch as TextChannel;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[SplitsBot] Failed to fetch channel: ${msg}`);
    await interaction.editReply(`❌ Could not access the target channel: ${msg}`);
    return;
  }

  // 4. Fetch splits data from DB
  let games: GameSplits[];
  try {
    games = await fetchAllDailySplits(dateOverride);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[SplitsBot] Data fetch failed: ${msg}`);
    await interaction.editReply(`❌ Failed to fetch splits data: ${msg}`);
    return;
  }

  if (games.length === 0) {
    const dateLabel = dateOverride ?? todayEtLabel();
    await interaction.editReply(`ℹ️ No games found for ${dateLabel}.`);
    return;
  }

  // 5. Post header message
  const dateLabel = dateOverride
    ? new Date(dateOverride + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : todayEtLabel();

  try {
    await channel.send({
      content: `## 📊 Daily Betting Splits — ${dateLabel}\n${games.length} game${games.length !== 1 ? "s" : ""} today`,
    });
    await sleep(IMAGE_DELAY_MS);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[SplitsBot] Header send failed: ${msg}`);
  }

  // 6. Generate and post one image per game
  let posted = 0;
  const errors: string[] = [];
  const tmpFiles: string[] = [];

  for (const game of games) {
    const tmpPath = join(tmpdir(), `splits_${game.id}_${Date.now()}.png`);
    tmpFiles.push(tmpPath);

    try {
      // Generate PNG
      await generateSplitsImage(game, tmpPath);

      // Post as attachment
      const attachment = new AttachmentBuilder(tmpPath, {
        name: `splits_${game.away_abbr}_vs_${game.home_abbr}.png`,
      });
      await channel.send({ files: [attachment] });
      posted++;
      console.log(
        `[SplitsBot] Posted image ${posted}/${games.length}: ${game.away_team} @ ${game.home_team}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[SplitsBot] Failed image for ${game.away_team} @ ${game.home_team}: ${msg}`);
      errors.push(`${game.away_team} @ ${game.home_team}: ${msg}`);
    }

    await sleep(IMAGE_DELAY_MS);
  }

  // 7. Cleanup temp files
  for (const f of tmpFiles) {
    fs.unlink(f).catch(() => {});
  }

  // 8. Ephemeral summary
  const summary = [
    `✅ Posted **${posted}/${games.length}** split images to <#${SPLITS_CHANNEL_ID}>`,
    `📅 Date: **${dateLabel}**`,
    errors.length > 0
      ? `⚠️ ${errors.length} image(s) failed:\n${errors.map((e) => `• ${e}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  await interaction.editReply(summary);
  console.log(
    `[SplitsBot] /splits complete — ${posted}/${games.length} images posted` +
      (errors.length > 0 ? ` (${errors.length} errors)` : "")
  );
}
