import { NCAAM_TEAMS } from "./shared/ncaamTeams.ts";

// Build a normalized slug lookup: normalize dbSlug (replace _ with -) -> team
const byNormSlug = new Map<string, (typeof NCAAM_TEAMS)[0]>();
for (const t of NCAAM_TEAMS) {
  const norm = t.dbSlug.replace(/_/g, "-");
  byNormSlug.set(norm, t);
  // Also add ncaaSlug as a key
  byNormSlug.set(t.ncaaSlug, t);
  // Also add vsinSlug
  byNormSlug.set(t.vsinSlug, t);
  // Add anSlug (without the nickname suffix, e.g. "saint-josephs-pa-hawks" -> "saint-josephs-pa")
  byNormSlug.set(t.anSlug, t);
}

// Try to split a combined slug into two team slugs
function splitCombinedSlug(combined: string): [string, string] | null {
  const parts = combined.split("-");
  // Try all split points
  for (let i = 1; i < parts.length; i++) {
    const awayPart = parts.slice(0, i).join("-");
    const homePart = parts.slice(i).join("-");
    if (byNormSlug.has(awayPart) && byNormSlug.has(homePart)) {
      return [byNormSlug.get(awayPart)!.dbSlug, byNormSlug.get(homePart)!.dbSlug];
    }
  }
  return null;
}

// Test with all 21 game slugs from the HTML
const testSlugs = [
  "saint-josephs-vcu",
  "tulsa-wichita-state",
  "houston-arizona",
  "san-diego-state-utah-state",
  "uconn-st-johns",
  "prairie-view-am-southern-university",
  "toledo-akron",
  "kennesaw-state-louisiana-tech",
  "virginia-duke",
  "hawaii-uc-irvine",
  "california-baptist-utah-valley",
  "penn-harvard",
  "charlotte-south-florida",
  "purdue-ucla",
  "ole-miss-arkansas",
  "cornell-yale",
  "vermont-umbc",
  "dayton-saint-louis",
  "wisconsin-michigan",
  "vanderbilt-florida",
  "north-carolina-central-howard",
];

let matched = 0;
testSlugs.forEach((slug) => {
  const result = splitCombinedSlug(slug);
  if (result) matched++;
  console.log(slug, "->", result ? result.join(" @ ") : "NO MATCH");
});

console.log(`\nMatched: ${matched}/${testSlugs.length}`);

// Show what keys are available for some unmatched teams
const unmatched = ["saint-josephs", "vcu", "wichita-state", "san-diego-state", "utah-state", "uconn", "st-johns", "prairie-view-am", "southern-university", "kennesaw-state", "uc-irvine", "california-baptist", "utah-valley", "south-florida", "ole-miss", "saint-louis", "north-carolina-central"];
console.log("\nChecking individual slugs:");
unmatched.forEach(s => {
  const t = byNormSlug.get(s);
  console.log(`  "${s}" ->`, t ? t.dbSlug : "NOT FOUND");
});
