/**
 * Team Registry — maps DB slugs to display names, abbreviations, colors, and logo URLs.
 * NBA/NHL colors come from the live DB; NCAAM colors come from the shared registry.
 */

import { NCAAM_TEAMS } from "@shared/ncaamTeams";
import { NBA_TEAMS } from "@shared/nbaTeams";
import { NHL_TEAMS } from "@shared/nhlTeams";
import { getDb } from "../db";
import { nbaTeams, nhlTeams } from "../../drizzle/schema";

export interface TeamEntry {
  displayName: string;
  abbrev: string;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
}

// ── Static registries (NCAAM + NHL abbreviations from shared) ─────────────────
const ncaamByDbSlug = new Map<string, TeamEntry>();
for (const t of NCAAM_TEAMS) {
  ncaamByDbSlug.set(t.dbSlug, {
    displayName: t.ncaaName,
    abbrev: t.dbSlug.split("_").map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 4),
    logoUrl: t.logoUrl,
    primaryColor: (t as any).primaryColor ?? "#4A90D9",
    secondaryColor: (t as any).secondaryColor ?? "#FFFFFF",
  });
}

// NHL — abbrev from shared, colors loaded from DB at startup
const nhlByDbSlug = new Map<string, TeamEntry>();
for (const t of NHL_TEAMS) {
  nhlByDbSlug.set(t.dbSlug, {
    displayName: t.name,
    abbrev: t.abbrev,
    logoUrl: t.logoUrl,
    primaryColor: "#003087",
    secondaryColor: "#FFFFFF",
  });
}

// NBA — all data loaded from DB at startup
const nbaByDbSlug = new Map<string, TeamEntry>();
for (const t of NBA_TEAMS) {
  // Derive abbrev from name until DB load overwrites it
  const words = t.name.split(" ");
  const abbrev = words.length >= 2
    ? words.slice(-2).map((w) => w[0]).join("").toUpperCase()
    : t.name.slice(0, 3).toUpperCase();
  nbaByDbSlug.set(t.dbSlug, {
    displayName: t.name,
    abbrev,
    logoUrl: t.logoUrl,
    primaryColor: "#1D428A",
    secondaryColor: "#FFC72C",
  });
}

// ── DB-backed enrichment (called once at bot startup) ─────────────────────────
export async function enrichTeamRegistryFromDb(): Promise<void> {
  try {
    // NBA
    const db = await getDb();
    if (!db) { console.warn('[SplitsBot] DB not available for team enrichment'); return; }
    const nbaRows = await db.select({
      dbSlug: nbaTeams.dbSlug,
      abbrev: nbaTeams.abbrev,
      primaryColor: nbaTeams.primaryColor,
      secondaryColor: nbaTeams.secondaryColor,
      name: nbaTeams.name,
      logoUrl: nbaTeams.logoUrl,
    }).from(nbaTeams);

    for (const row of nbaRows) {
      const existing = nbaByDbSlug.get(row.dbSlug);
      if (existing) {
        existing.abbrev = row.abbrev ?? existing.abbrev;
        existing.primaryColor = row.primaryColor ?? existing.primaryColor;
        existing.secondaryColor = row.secondaryColor ?? existing.secondaryColor;
        if (row.logoUrl) existing.logoUrl = row.logoUrl;
      }
    }
    console.log(`[SplitsBot] Enriched ${nbaRows.length} NBA teams from DB`);

    // NHL
    const nhlRows = await db.select({
      dbSlug: nhlTeams.dbSlug,
      abbrev: nhlTeams.abbrev,
      primaryColor: nhlTeams.primaryColor,
      secondaryColor: nhlTeams.secondaryColor,
      logoUrl: nhlTeams.logoUrl,
    }).from(nhlTeams);

    for (const row of nhlRows) {
      const existing = nhlByDbSlug.get(row.dbSlug);
      if (existing) {
        existing.abbrev = row.abbrev ?? existing.abbrev;
        existing.primaryColor = row.primaryColor ?? existing.primaryColor;
        existing.secondaryColor = row.secondaryColor ?? existing.secondaryColor;
        if (row.logoUrl) existing.logoUrl = row.logoUrl;
      }
    }
    console.log(`[SplitsBot] Enriched ${nhlRows.length} NHL teams from DB`);
  } catch (err) {
    console.error("[SplitsBot] enrichTeamRegistryFromDb failed:", err);
  }
}

function fallback(dbSlug: string): TeamEntry {
  const displayName = dbSlug
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return {
    displayName,
    abbrev: dbSlug.split("_").map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 4),
    logoUrl: "",
    primaryColor: "#4A90D9",
    secondaryColor: "#FFFFFF",
  };
}

export function resolveTeam(dbSlug: string, sport: string): TeamEntry {
  switch (sport.toUpperCase()) {
    case "NBA":
      return nbaByDbSlug.get(dbSlug) ?? fallback(dbSlug);
    case "NHL":
      return nhlByDbSlug.get(dbSlug) ?? fallback(dbSlug);
    default:
      return ncaamByDbSlug.get(dbSlug) ?? fallback(dbSlug);
  }
}
