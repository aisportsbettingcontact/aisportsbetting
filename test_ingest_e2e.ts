import { parseAnAllMarketsHtml } from "./server/anHtmlParser.ts";
import { NCAAM_TEAMS } from "./shared/ncaamTeams.ts";
import { readFileSync } from "fs";

const html = readFileSync("/home/ubuntu/upload/pasted_content_26.txt", "utf8");
const parseResult = parseAnAllMarketsHtml(html);

// Build the same slug lookup as the tRPC procedure
const byNormSlug = new Map<string, string>();
const URL_SLUG_ALIASES: Record<string, string> = {
  "wichita-state": "wichita_st",
  "san-diego-state": "san_diego_st",
  "utah-state": "utah_st",
  "prairie-view-am": "prairie_view_a_and_m",
  "southern-university": "southern_u",
  "kennesaw-state": "kennesaw_st",
  "north-carolina-central": "nc_central",
  "cal-baptist": "california_baptist",
  "utah-valley": "utah_valley",
  "penn": "pennsylvania",
  "ole-miss": "mississippi",
  "uconn": "connecticut",
  "vcu": "va_commonwealth",
};
for (const [alias, dbSlug] of Object.entries(URL_SLUG_ALIASES)) {
  byNormSlug.set(alias, dbSlug);
}
for (const t of NCAAM_TEAMS) {
  byNormSlug.set(t.dbSlug.replace(/_/g, "-"), t.dbSlug);
  byNormSlug.set(t.ncaaSlug, t.dbSlug);
  byNormSlug.set(t.vsinSlug, t.dbSlug);
  byNormSlug.set(t.anSlug, t.dbSlug);
}

function splitCombinedSlug(combined: string): [string, string] | null {
  const parts = combined.split("-");
  for (let i = 1; i < parts.length; i++) {
    const awayPart = parts.slice(0, i).join("-");
    const homePart = parts.slice(i).join("-");
    if (byNormSlug.has(awayPart) && byNormSlug.has(homePart)) {
      return [byNormSlug.get(awayPart)!, byNormSlug.get(homePart)!];
    }
  }
  return null;
}

let matched = 0;
let failed = 0;
for (const g of parseResult.games) {
  const urlParts = g.gameUrl.split("/");
  const gamePart = urlParts[2] || "";
  const combined = gamePart.replace(/-score-odds-.*$/, "");
  const slugMatch = splitCombinedSlug(combined);
  if (slugMatch) {
    matched++;
    console.log(`✓ ${slugMatch[0]} @ ${slugMatch[1]} | spread=${g.dkAwaySpread?.line}/${g.dkHomeSpread?.line} total=${g.dkOver?.line} ml=${g.dkAwayML?.line}/${g.dkHomeML?.line}`);
  } else {
    failed++;
    console.log(`✗ NO_MATCH: "${combined}" (${g.awayName} @ ${g.homeName})`);
  }
}
console.log(`\nResult: ${matched} matched, ${failed} failed out of ${parseResult.games.length} games`);
process.exit(0);
