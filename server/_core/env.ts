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
};
