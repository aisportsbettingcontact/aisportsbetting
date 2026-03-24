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
import { handleSplitsCommand } from "./splitsCommand";
import { enrichTeamRegistryFromDb } from "./teamRegistry";

let botClient: Client | null = null;

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
    // Enrich team registry with abbrevs and colors from DB
    enrichTeamRegistryFromDb().catch((err) =>
      console.error('[SplitsBot] Team registry enrichment failed:', err)
    );
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;
    console.log(
      `[SplitsBot] /${commandName} from ${interaction.user.id} (${interaction.user.tag})`
    );

    try {
      if (commandName === "splits") {
        await handleSplitsCommand(
          interaction as ChatInputCommandInteraction,
          client
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[SplitsBot] Unhandled error in /${commandName}: ${msg}`);
      try {
        if (interaction.deferred) {
          await interaction.editReply(`❌ Unexpected error: ${msg}`);
        } else if (!interaction.replied) {
          await interaction.reply({ content: `❌ Unexpected error: ${msg}`, ephemeral: true });
        }
      } catch { /* swallow reply errors */ }
    }
  });

  client.on(Events.Error, (err) => {
    console.error("[SplitsBot] Discord client error:", err);
  });

  client.login(ENV.discordBotToken).catch((err) => {
    console.error("[SplitsBot] Login failed:", err);
  });

  botClient = client;
}

export function getDiscordClient(): Client | null {
  return botClient;
}
