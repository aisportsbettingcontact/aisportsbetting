import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// Read the CSV (tab-separated)
const csv = readFileSync('/home/ubuntu/upload/pasted_content_9.txt', 'utf-8');
const lines = csv.trim().split('\n').slice(1); // skip header

// Build a map: ncaaSlug -> { primaryColor, secondaryColor, tertiaryColor }
// Columns: 0=CONFERENCE, 1=NCAA NAME, 2=NCAA NICKNAME, 3=PRIMARY, 4=SECONDARY, 5=TERTIARY, 6=NCAA SLUG, 7=VSiN Slug
const colorMap = new Map();
for (const line of lines) {
  const cols = line.split('\t');
  if (cols.length < 7) continue;
  const ncaaSlug = cols[6]?.trim();
  const primary = cols[3]?.trim();
  const secondary = cols[4]?.trim();
  const tertiary = cols[5]?.trim();
  if (ncaaSlug && primary) {
    colorMap.set(ncaaSlug, { primaryColor: primary, secondaryColor: secondary, tertiaryColor: tertiary });
  }
}

console.log(`Total teams in CSV: ${colorMap.size}`);

// Read existing ncaamTeams.ts
const teamsPath = resolve('/home/ubuntu/ai-sports-betting/shared/ncaamTeams.ts');
let src = readFileSync(teamsPath, 'utf-8');

let matched = 0;
let unmatched = [];

// For each team in the color map, find the team entry by ncaaSlug and inject colors
// Pattern: find `ncaaSlug: "slug",` and add colors after the logoUrl line
for (const [ncaaSlug, colors] of colorMap.entries()) {
  const escapedSlug = ncaaSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Check if already has primaryColor
  const alreadyHasColors = new RegExp(`ncaaSlug:\\s*"${escapedSlug}"[^}]*primaryColor`).test(src);
  if (alreadyHasColors) {
    matched++;
    continue;
  }
  
  // Find the team block: ncaaSlug: "slug", and inject colors before the closing }
  // We look for the logoUrl line within the same team block and add colors after it
  const logoLineRegex = new RegExp(
    `(ncaaSlug:\\s*"${escapedSlug}"[^}]*?logoUrl:\\s*"[^"]*")`,
    's'
  );
  
  if (logoLineRegex.test(src)) {
    src = src.replace(logoLineRegex, (match) => {
      return match + `,\n    primaryColor: "${colors.primaryColor}",\n    secondaryColor: "${colors.secondaryColor}",\n    tertiaryColor: "${colors.tertiaryColor}"`;
    });
    matched++;
  } else {
    unmatched.push(ncaaSlug);
  }
}

console.log(`Matched and injected: ${matched}/${colorMap.size}`);
if (unmatched.length > 0) {
  console.log(`Unmatched (${unmatched.length}):`, unmatched);
}

writeFileSync(teamsPath, src, 'utf-8');
console.log('Done! Written to ncaamTeams.ts');
