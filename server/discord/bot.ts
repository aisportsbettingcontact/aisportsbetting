/**
 * Discord Bot — starts a discord.js Client alongside the Express server.
 *
 * The bot shares the same Node.js process as the Express server so it
 * automatically has access to the database and all server-side helpers.
 *
 * Call startDiscordBot() once from server/_core/index.ts after the HTTP
 * server is listening.
 */

import {
  Client,
  GatewayIntentBits,
  Events,
  type ChatInputCommandInteraction,
} from "discord.js";
import { ENV } from "../_core/env";
import { handleSplitsCommand, handleSplitsAutocomplete, closeSplitsRenderer } from "./splitsCommand";
import { handleLineupsCommand, handleLineupsAutocomplete } from "./lineupsCommand";
import { warmUpRenderer } from "./renderSplitsCard";
import { enrichTeamRegistryFromDb } from "./teamRegistry";

let botClient: Client | null = null;

// ─── Interaction deduplication guard ─────────────────────────────────────────
// Discord's gateway occasionally delivers the same interaction twice (duplicate
// delivery / retry). We track recently-seen interaction IDs for 10 seconds to
// detect and drop duplicates before they reach the command handler.
const seenInteractionIds = new Map<string, number>(); // id → timestamp
const INTERACTION_DEDUP_TTL_MS = 10_000;

function isDuplicateInteraction(id: string): boolean {
  const now = Date.now();
  // Prune stale entries
  Array.from(seenInteractionIds.entries()).forEach(([k, ts]) => {
    if (now - ts > INTERACTION_DEDUP_TTL_MS) seenInteractionIds.delete(k);
  });
  if (seenInteractionIds.has(id)) {
    console.warn(`[SplitsBot] ⚠️  Duplicate interaction detected and dropped: ${id}`);
    return true;
  }
  seenInteractionIds.set(id, now);
  return false;
}

export function startDiscordBot(): void {
  if (!ENV.discordBotToken) {
    console.warn("[SplitsBot] DISCORD_BOT_TOKEN not set — bot will not start");
    return;
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`[SplitsBot] ✅ Logged in as ${readyClient.user.tag}`);
    console.log(`[SplitsBot] Guild: ${ENV.discordGuildId}`);

    // ── Parallel startup tasks ────────────────────────────────────────────────
    // Both tasks run concurrently so the bot is fully ready as fast as possible.

    // 1. Warm up Playwright: launch Chromium, cache template, fill page pool.
    //    This eliminates the ~8-9s cold-start on the first /splits command.
    warmUpRenderer().catch((err) =>
      console.error('[SplitsBot] Renderer warm-up failed (non-fatal):', err)
    );

    // 2. Enrich team registry with abbrevs and colors from DB
    enrichTeamRegistryFromDb().catch((err) =>
      console.error('[SplitsBot] Team registry enrichment failed:', err)
    );
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    // Handle autocomplete for /splits game option
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === "splits") {
        await handleSplitsAutocomplete(interaction).catch((err) =>
          console.error("[SplitsBot] Autocomplete error:", err)
        );
      } else if (interaction.commandName === "lineups") {
        await handleLineupsAutocomplete(interaction).catch((err) =>
          console.error("[LineupsBot] Autocomplete error:", err)
        );
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // ─── Deduplication: drop duplicate gateway deliveries ───────────────────────
    // Discord occasionally retries interaction delivery over the gateway.
    // Without this guard, the second delivery hits deferReply on an already-
    // acknowledged interaction and throws, causing "application did not respond".
    if (isDuplicateInteraction(interaction.id)) {
      console.warn(`[SplitsBot] Dropped duplicate interaction ${interaction.id} for /${commandName}`);
      return;
    }

    console.log(
      `[SplitsBot] /${commandName} from ${interaction.user.id} (${interaction.user.tag}) [id=${interaction.id}]`
    );

    try {
      if (commandName === "splits") {
        await handleSplitsCommand(
          interaction as ChatInputCommandInteraction,
          client
        );
      } else if (commandName === "lineups") {
        await handleLineupsCommand(
          interaction as ChatInputCommandInteraction,
          client
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[SplitsBot] Unhandled error in /${commandName} [id=${interaction.id}]: ${msg}`);
      // Attempt to surface the error to the user — but only if we can still respond
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(`❌ Unexpected error: ${msg}`);
        } else {
          // Last-resort: try a direct reply (will fail if >3s have passed)
          await interaction.reply({ content: `❌ Unexpected error: ${msg}`, ephemeral: true });
        }
      } catch (replyErr) {
        const replyMsg = replyErr instanceof Error ? replyErr.message : String(replyErr);
        console.error(`[SplitsBot] Could not send error reply for /${commandName} [id=${interaction.id}]: ${replyMsg}`);
      }
    }
  });

  client.on(Events.Error, (err) => {
    console.error("[SplitsBot] Discord client error:", err);
  });

  client.login(ENV.discordBotToken).catch((err) => {
    console.error("[SplitsBot] Login failed:", err);
  });

  botClient = client;

  // Gracefully close the Playwright browser on process exit
  const shutdown = async () => {
    console.log('[SplitsBot] Shutting down — closing Playwright browser...');
    await closeSplitsRenderer();
    client.destroy();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT',  shutdown);
}

export function getDiscordClient(): Client | null {
  return botClient;
}
