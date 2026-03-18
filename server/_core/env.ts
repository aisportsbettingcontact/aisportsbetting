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
  // ── Canonical public origin for OAuth redirect URIs ────────────────────────
  // CRITICAL: Never derive this from x-forwarded-host or req.host.
  // Behind Cloudflare → Cloud Run, x-forwarded-host resolves to the internal
  // Cloud Run hostname (*.a.run.app), NOT the public domain. Discord (and any
  // other OAuth provider) will reject the redirect_uri if it doesn't exactly
  // match a registered URI. Set PUBLIC_ORIGIN to https://aisportsbettingmodels.com
  // in production secrets, or leave empty to fall back to request-derived origin
  // (safe for local dev where there is no proxy).
  publicOrigin: process.env.PUBLIC_ORIGIN ?? "",
  // Discord integration
  discordBotToken: process.env.DISCORD_BOT_TOKEN ?? "",
  discordClientId: process.env.DISCORD_CLIENT_ID ?? "",
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET ?? "",
  discordPublicKey: process.env.DISCORD_PUBLIC_KEY ?? "",
  discordGuildId: process.env.DISCORD_GUILD_ID ?? "",
  discordRoleAiModelSub: process.env.DISCORD_ROLE_AI_MODEL_SUB ?? "",
};
