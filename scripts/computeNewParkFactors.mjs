/**
 * computeNewParkFactors.mjs
 * Reads the live DB and computes what parkFactor3yr will be under the new 50/30/20 weights.
 * Run: node scripts/computeNewParkFactors.mjs
 */
import { createConnection } from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const conn = await createConnection(process.env.DATABASE_URL);

const [rows] = await conn.execute(
  'SELECT teamAbbrev, pf2024, pf2025, pf2026, parkFactor3yr FROM mlb_park_factors ORDER BY teamAbbrev'
);

const WEIGHTS_NEW = { 2024: 0.20, 2025: 0.30, 2026: 0.50 };
const WEIGHTS_OLD = { 2024: 0.15, 2025: 0.35, 2026: 0.50 };

function computePf(row, weights) {
  const avail = [];
  if (row.pf2024 != null) avail.push({ pf: row.pf2024, w: weights[2024] });
  if (row.pf2025 != null) avail.push({ pf: row.pf2025, w: weights[2025] });
  if (row.pf2026 != null) avail.push({ pf: row.pf2026, w: weights[2026] });
  const totalW = avail.reduce((s, x) => s + x.w, 0);
  return totalW > 0 ? avail.reduce((s, x) => s + x.pf * (x.w / totalW), 0) : 1.0;
}

console.log('\n[INPUT] Park factor weight comparison: OLD(50/35/15) vs NEW(50/30/20)\n');
console.log('TEAM  | pf2024   | pf2025   | pf2026   | DB(old)  | NEW(50/30/20) | DELTA');
console.log('------|----------|----------|----------|----------|---------------|-------');

for (const r of rows) {
  const oldPf = computePf(r, WEIGHTS_OLD);
  const newPf = computePf(r, WEIGHTS_NEW);
  const delta = newPf - oldPf;
  const pf24 = r.pf2024 != null ? r.pf2024.toFixed(4) : 'N/A   ';
  const pf25 = r.pf2025 != null ? r.pf2025.toFixed(4) : 'N/A   ';
  const pf26 = r.pf2026 != null ? r.pf2026.toFixed(4) : 'N/A   ';
  const dbPf = r.parkFactor3yr != null ? r.parkFactor3yr.toFixed(4) : 'N/A   ';
  console.log(
    `${r.teamAbbrev.padEnd(5)} | ${pf24.padEnd(8)} | ${pf25.padEnd(8)} | ${pf26.padEnd(8)} | ${dbPf.padEnd(8)} | ${newPf.toFixed(6).padEnd(13)} | ${delta >= 0 ? '+' : ''}${delta.toFixed(6)}`
  );
}

// Specifically output COL and SD for audit script update
const col = rows.find(r => r.teamAbbrev === 'COL');
const sd  = rows.find(r => r.teamAbbrev === 'SD');
if (col) {
  const newCol = computePf(col, WEIGHTS_NEW);
  console.log(`\n[OUTPUT] COL new pf3yr = ${newCol.toFixed(6)} (was ${col.parkFactor3yr?.toFixed(6)})`);
}
if (sd) {
  const newSd = computePf(sd, WEIGHTS_NEW);
  console.log(`[OUTPUT] SD  new pf3yr = ${newSd.toFixed(6)} (was ${sd.parkFactor3yr?.toFixed(6)})`);
}

await conn.end();
