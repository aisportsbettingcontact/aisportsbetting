export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  vsinEmail: process.env.VSIN_EMAIL ?? "",
  vsinPassword: process.env.VSIN_PASSWORD ?? "",
  kenpomEmail: process.env.KENPOM_EMAIL ?? "",
  kenpomPassword: process.env.KENPOM_PASSWORD ?? "",
  // Discord integration — AI Model Bot
  discordBotToken: process.env.DISCORD_BOT_TOKEN ?? "",
  discordGuildId: process.env.DISCORD_GUILD_ID ?? "",
  discordRoleAiModelSub: process.env.DISCORD_ROLE_AI_MODEL_SUB ?? "",
  discordClientId: process.env.DISCORD_CLIENT_ID ?? "",
  discordPublicKey: process.env.DISCORD_PUBLIC_KEY ?? "",
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET ?? "",
};

// ─── Discord configuration validator ─────────────────────────────────────────
// Call once at server startup. Throws a descriptive error if any required
// Discord secret is missing. Never prints secret values.
const REQUIRED_DISCORD_VARS: { envKey: string; label: string }[] = [
  { envKey: "DISCORD_BOT_TOKEN",       label: "DISCORD_BOT_TOKEN" },
  { envKey: "DISCORD_CLIENT_ID",       label: "DISCORD_CLIENT_ID" },
  { envKey: "DISCORD_CLIENT_SECRET",   label: "DISCORD_CLIENT_SECRET" },
  { envKey: "DISCORD_PUBLIC_KEY",      label: "DISCORD_PUBLIC_KEY" },
  { envKey: "DISCORD_GUILD_ID",        label: "DISCORD_GUILD_ID" },
  { envKey: "DISCORD_ROLE_AI_MODEL_SUB", label: "DISCORD_ROLE_AI_MODEL_SUB" },
];

export function validateDiscordConfig(): void {
  const missing: string[] = [];
  for (const { envKey, label } of REQUIRED_DISCORD_VARS) {
    if (!process.env[envKey]) {
      missing.push(label);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `[Discord] Missing required environment variable(s): ${missing.join(", ")}. ` +
      `Ensure all Discord secrets are set before starting the server.`
    );
  }
  console.log("[Discord] Integration configuration loaded successfully");
}
