/**
 * seedNrfi3yr.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Seeds 3-year rolling NRFI calibration data (2024+2025+2026, n=5109 games)
 * from pitcher_nrfi_stats.json into mlb_pitcher_stats.nrfi* columns.
 *
 * Strategy:
 *   1. Load pitcher_nrfi_stats.json (390 pitchers, keyed by mlbamId)
 *   2. For each pitcher: UPSERT into mlb_pitcher_stats by mlbamId
 *      - If row exists (matched by mlbamId): UPDATE nrfi* columns only
 *      - If row does NOT exist: INSERT stub row with nrfi* + fullName + mlbamId
 *        (teamAbbrev = 'UNK' for stubs — will be filled by next mlbScheduler run)
 *   3. Validate every upserted row by re-reading from DB
 *   4. Emit full structured audit log
 *
 * Run: pnpm tsx server/seedNrfi3yr.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import { getDb } from './db';
import { mlbPitcherStats } from '../drizzle/schema';
import { eq, sql, inArray } from 'drizzle-orm';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const NRFI_JSON_PATH = '/home/ubuntu/mlb_3yr_backtest/data/analysis/pitcher_nrfi_stats.json';
const CALIB_VERSION  = '2026-04-14-3yr-v1';
const MIN_STARTS_FOR_SEED = 3;  // seed all pitchers with >= 3 starts
const TAG = '[SEED-NRFI-3YR]';

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface NrfiEntry {
  name: string;
  seasons: number[];
  starts: number;
  nrfi: number;
  yrfi: number;
  nrfi_rate: number;
  f5_runs_allowed_mean: number;
  fg_runs_allowed_mean: number;
  ip_mean: number;
}

interface AuditRow {
  mlbamId: number;
  name: string;
  action: 'UPDATE' | 'INSERT_STUB' | 'SKIP_LOW_SAMPLE' | 'VERIFY_FAIL';
  starts: number;
  nrfiRate: number;
  dbNrfiRate: number | null;
  match: boolean;
  error?: string;
}

// ─── LOGGER ──────────────────────────────────────────────────────────────────
function log(tag: string, msg: string) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${tag} ${msg}`);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  log(TAG, '═══════════════════════════════════════════════════════════');
  log(TAG, 'START: 3-Year NRFI Pitcher Seed (2024+2025+2026, n=5109)');
  log(TAG, `[INPUT] Source: ${NRFI_JSON_PATH}`);
  log(TAG, `[INPUT] Calibration version: ${CALIB_VERSION}`);
  log(TAG, `[INPUT] Min starts threshold: ${MIN_STARTS_FOR_SEED}`);

  // ─── STEP 1: Load JSON ────────────────────────────────────────────────────
  log(TAG, '[STEP 1] Loading pitcher_nrfi_stats.json...');
  if (!fs.existsSync(NRFI_JSON_PATH)) {
    log(TAG, `[ERROR] File not found: ${NRFI_JSON_PATH}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(NRFI_JSON_PATH, 'utf-8');
  const nrfiData: Record<string, NrfiEntry> = JSON.parse(raw);
  const totalPitchers = Object.keys(nrfiData).length;
  log(TAG, `[STATE] Loaded ${totalPitchers} pitchers from JSON`);

  // Validate JSON structure
  let jsonErrors = 0;
  for (const [id, entry] of Object.entries(nrfiData)) {
    const mlbamId = parseInt(id, 10);
    if (isNaN(mlbamId) || mlbamId <= 0) { log(TAG, `[WARN] Invalid mlbamId key: ${id}`); jsonErrors++; continue; }
    if (!entry.name || typeof entry.name !== 'string') { log(TAG, `[WARN] Missing name for mlbamId=${id}`); jsonErrors++; }
    if (typeof entry.starts !== 'number' || entry.starts < 0) { log(TAG, `[WARN] Invalid starts for mlbamId=${id}: ${entry.starts}`); jsonErrors++; }
    if (typeof entry.nrfi_rate !== 'number' || entry.nrfi_rate < 0 || entry.nrfi_rate > 1) {
      log(TAG, `[WARN] Invalid nrfi_rate for mlbamId=${id}: ${entry.nrfi_rate}`); jsonErrors++;
    }
    // Verify nrfi_rate = nrfi / starts
    if (entry.starts > 0) {
      const computed = entry.nrfi / entry.starts;
      const delta = Math.abs(computed - entry.nrfi_rate);
      if (delta > 0.001) {
        log(TAG, `[WARN] nrfi_rate mismatch for ${entry.name}: stored=${entry.nrfi_rate.toFixed(4)} computed=${computed.toFixed(4)} delta=${delta.toFixed(4)}`);
        jsonErrors++;
      }
    }
  }
  log(TAG, `[VERIFY] JSON validation: ${jsonErrors === 0 ? 'PASS' : 'FAIL'} — ${jsonErrors} errors`);

  // Filter by min starts
  const eligible = Object.entries(nrfiData).filter(([, e]) => e.starts >= MIN_STARTS_FOR_SEED);
  const skipped  = totalPitchers - eligible.length;
  log(TAG, `[STATE] Eligible (>= ${MIN_STARTS_FOR_SEED} starts): ${eligible.length} | Skipped: ${skipped}`);

  // ─── STEP 2: Connect to DB ────────────────────────────────────────────────
  log(TAG, '[STEP 2] Connecting to database...');
  const db = await getDb();
  log(TAG, '[STATE] DB connection established');

  // Get all existing mlbamIds in DB
  const existingRows = await db
    .select({ mlbamId: mlbPitcherStats.mlbamId, fullName: mlbPitcherStats.fullName, teamAbbrev: mlbPitcherStats.teamAbbrev })
    .from(mlbPitcherStats);
  const existingMap = new Map<number, { fullName: string; teamAbbrev: string }>();
  for (const row of existingRows) {
    existingMap.set(row.mlbamId, { fullName: row.fullName, teamAbbrev: row.teamAbbrev });
  }
  log(TAG, `[STATE] Existing DB rows: ${existingRows.length} | Unique mlbamIds: ${existingMap.size}`);

  // ─── STEP 3: Upsert NRFI data ─────────────────────────────────────────────
  log(TAG, '[STEP 3] Beginning upsert loop...');
  const seededAt = Date.now();
  const audit: AuditRow[] = [];
  let updated = 0, inserted = 0, skippedCount = 0, errors = 0;

  for (const [idStr, entry] of eligible) {
    const mlbamId = parseInt(idStr, 10);
    const nrfiRateRounded = parseFloat(entry.nrfi_rate.toFixed(6));
    const f5Mean = parseFloat(entry.f5_runs_allowed_mean.toFixed(4));
    const fgMean = parseFloat(entry.fg_runs_allowed_mean.toFixed(4));
    const ipMean = parseFloat(entry.ip_mean.toFixed(4));
    const seasons = entry.seasons.join(',');

    try {
      if (existingMap.has(mlbamId)) {
        // UPDATE existing row — only nrfi* columns
        await db
          .update(mlbPitcherStats)
          .set({
            nrfiStarts:         entry.starts,
            nrfiCount:          entry.nrfi,
            nrfiRate:           nrfiRateRounded,
            f5RunsAllowedMean:  f5Mean,
            fgRunsAllowedMean:  fgMean,
            ipMean3yr:          ipMean,
            nrfiSampleSeasons:  seasons,
            nrfiCalibVersion:   CALIB_VERSION,
            nrfiSeededAt:       seededAt,
          })
          .where(eq(mlbPitcherStats.mlbamId, mlbamId));
        updated++;
        audit.push({ mlbamId, name: entry.name, action: 'UPDATE', starts: entry.starts, nrfiRate: nrfiRateRounded, dbNrfiRate: null, match: false });
        if (updated <= 5 || updated % 50 === 0) {
          log(TAG, `[STATE] UPDATE #${updated}: ${entry.name} (${mlbamId}) | starts=${entry.starts} nrfi_rate=${nrfiRateRounded.toFixed(4)}`);
        }
      } else {
        // INSERT stub row — pitcher exists in 3yr backtest but not in DB (e.g. retired/traded)
        await db.insert(mlbPitcherStats).values({
          mlbamId,
          fullName:           entry.name,
          teamAbbrev:         'UNK',  // will be resolved by next scheduler run
          nrfiStarts:         entry.starts,
          nrfiCount:          entry.nrfi,
          nrfiRate:           nrfiRateRounded,
          f5RunsAllowedMean:  f5Mean,
          fgRunsAllowedMean:  fgMean,
          ipMean3yr:          ipMean,
          nrfiSampleSeasons:  seasons,
          nrfiCalibVersion:   CALIB_VERSION,
          nrfiSeededAt:       seededAt,
          lastFetchedAt:      seededAt,
        }).onDuplicateKeyUpdate({
          set: {
            nrfiStarts:         entry.starts,
            nrfiCount:          entry.nrfi,
            nrfiRate:           nrfiRateRounded,
            f5RunsAllowedMean:  f5Mean,
            fgRunsAllowedMean:  fgMean,
            ipMean3yr:          ipMean,
            nrfiSampleSeasons:  seasons,
            nrfiCalibVersion:   CALIB_VERSION,
            nrfiSeededAt:       seededAt,
          }
        });
        inserted++;
        audit.push({ mlbamId, name: entry.name, action: 'INSERT_STUB', starts: entry.starts, nrfiRate: nrfiRateRounded, dbNrfiRate: null, match: false });
        if (inserted <= 5 || inserted % 20 === 0) {
          log(TAG, `[STATE] INSERT_STUB #${inserted}: ${entry.name} (${mlbamId}) | starts=${entry.starts} nrfi_rate=${nrfiRateRounded.toFixed(4)}`);
        }
      }
    } catch (err: any) {
      errors++;
      log(TAG, `[ERROR] Failed to upsert ${entry.name} (${mlbamId}): ${err.message}`);
      audit.push({ mlbamId, name: entry.name, action: 'VERIFY_FAIL', starts: entry.starts, nrfiRate: nrfiRateRounded, dbNrfiRate: null, match: false, error: err.message });
    }
  }

  // Skipped low-sample pitchers
  for (const [idStr, entry] of Object.entries(nrfiData)) {
    if (entry.starts < MIN_STARTS_FOR_SEED) {
      skippedCount++;
      audit.push({ mlbamId: parseInt(idStr, 10), name: entry.name, action: 'SKIP_LOW_SAMPLE', starts: entry.starts, nrfiRate: entry.nrfi_rate, dbNrfiRate: null, match: false });
    }
  }

  log(TAG, `[OUTPUT] Upsert complete: updated=${updated} inserted=${inserted} skipped=${skippedCount} errors=${errors}`);

  // ─── STEP 4: Verification — re-read all seeded rows ──────────────────────
  log(TAG, '[STEP 4] Verification: re-reading all seeded rows from DB...');
  const seededIds = eligible.map(([id]) => parseInt(id, 10));

  // Read in batches of 100
  const BATCH = 100;
  let verifyPass = 0, verifyFail = 0;
  const failedVerify: string[] = [];

  for (let i = 0; i < seededIds.length; i += BATCH) {
    const batch = seededIds.slice(i, i + BATCH);
    const dbRows = await db
      .select({
        mlbamId:    mlbPitcherStats.mlbamId,
        fullName:   mlbPitcherStats.fullName,
        nrfiStarts: mlbPitcherStats.nrfiStarts,
        nrfiCount:  mlbPitcherStats.nrfiCount,
        nrfiRate:   mlbPitcherStats.nrfiRate,
        nrfiCalibVersion: mlbPitcherStats.nrfiCalibVersion,
      })
      .from(mlbPitcherStats)
      .where(inArray(mlbPitcherStats.mlbamId, batch));

    type DbRow = { mlbamId: number; fullName: string | null; nrfiStarts: number | null; nrfiCount: number | null; nrfiRate: number | null; nrfiCalibVersion: string | null };
    const dbMap = new Map((dbRows as DbRow[]).map(r => [r.mlbamId, r]));

    for (const id of batch) {
      const entry = nrfiData[String(id)];
      const dbRow = dbMap.get(id);
      if (!dbRow) {
        verifyFail++;
        failedVerify.push(`${entry.name} (${id}): NOT FOUND IN DB`);
        // Update audit
        const auditEntry = audit.find(a => a.mlbamId === id);
        if (auditEntry) { auditEntry.match = false; auditEntry.error = 'NOT FOUND IN DB'; }
        continue;
      }
      // Validate nrfi_rate matches (within floating point tolerance)
      const expectedRate = parseFloat(entry.nrfi_rate.toFixed(6));
      const dbRate = dbRow.nrfiRate ?? -1;
      const delta = Math.abs(dbRate - expectedRate);
      const rateOk = delta < 0.000001;
      const startsOk = dbRow.nrfiStarts === entry.starts;
      const countOk  = dbRow.nrfiCount  === entry.nrfi;
      const calibOk  = dbRow.nrfiCalibVersion === CALIB_VERSION;

      if (rateOk && startsOk && countOk && calibOk) {
        verifyPass++;
        const auditEntry = audit.find(a => a.mlbamId === id);
        if (auditEntry) { auditEntry.dbNrfiRate = dbRate; auditEntry.match = true; }
      } else {
        verifyFail++;
        const reason = [
          !rateOk    ? `rate: expected=${expectedRate.toFixed(6)} got=${dbRate.toFixed(6)} delta=${delta.toFixed(8)}` : '',
          !startsOk  ? `starts: expected=${entry.starts} got=${dbRow.nrfiStarts}` : '',
          !countOk   ? `count: expected=${entry.nrfi} got=${dbRow.nrfiCount}` : '',
          !calibOk   ? `calibVer: expected=${CALIB_VERSION} got=${dbRow.nrfiCalibVersion}` : '',
        ].filter(Boolean).join(' | ');
        failedVerify.push(`${entry.name} (${id}): ${reason}`);
        const auditEntry = audit.find(a => a.mlbamId === id);
        if (auditEntry) { auditEntry.dbNrfiRate = dbRate; auditEntry.match = false; auditEntry.error = reason; }
      }
    }
  }

  log(TAG, `[VERIFY] DB verification: PASS=${verifyPass} FAIL=${verifyFail}`);
  if (failedVerify.length > 0) {
    log(TAG, '[VERIFY] FAILED rows:');
    failedVerify.forEach(f => log(TAG, `  ✗ ${f}`));
  }

  // ─── STEP 5: Summary Statistics ───────────────────────────────────────────
  log(TAG, '[STEP 5] Computing summary statistics...');
  const allSeeded = await db
    .select({
      nrfiRate:   mlbPitcherStats.nrfiRate,
      nrfiStarts: mlbPitcherStats.nrfiStarts,
      nrfiCalibVersion: mlbPitcherStats.nrfiCalibVersion,
    })
    .from(mlbPitcherStats)
    .where(sql`nrfiCalibVersion = ${CALIB_VERSION}`);

  const rates = allSeeded.map((r: { nrfiRate: number | null }) => r.nrfiRate ?? 0).filter((r: number) => r > 0);
  const starts = allSeeded.map((r: { nrfiStarts: number | null }) => r.nrfiStarts ?? 0).filter((s: number) => s > 0);
  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const std  = (arr: number[]) => {
    const m = mean(arr);
    return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
  };

  log(TAG, `[OUTPUT] Seeded rows with calibVersion=${CALIB_VERSION}: ${allSeeded.length}`);
  log(TAG, `[OUTPUT] NRFI Rate: mean=${mean(rates).toFixed(4)} std=${std(rates).toFixed(4)} min=${Math.min(...rates).toFixed(4)} max=${Math.max(...rates).toFixed(4)}`);
  log(TAG, `[OUTPUT] Starts: mean=${mean(starts).toFixed(1)} min=${Math.min(...starts)} max=${Math.max(...starts)}`);

  // Distribution buckets
  const buckets = [
    { label: '< 0.40 (YRFI-prone)', min: 0, max: 0.40 },
    { label: '0.40–0.50 (below avg)', min: 0.40, max: 0.50 },
    { label: '0.50–0.55 (avg)', min: 0.50, max: 0.55 },
    { label: '0.55–0.60 (above avg)', min: 0.55, max: 0.60 },
    { label: '0.60–0.65 (strong NRFI)', min: 0.60, max: 0.65 },
    { label: '>= 0.65 (elite NRFI)', min: 0.65, max: 1.01 },
  ];
  log(TAG, '[OUTPUT] NRFI Rate Distribution:');
  for (const b of buckets) {
    const count = rates.filter((r: number) => r >= b.min && r < b.max).length;
    const pct = (count / rates.length * 100).toFixed(1);
    log(TAG, `  ${b.label}: ${count} pitchers (${pct}%)`);
  }

  // Top 10 NRFI pitchers (min 10 starts)
  const top10 = Object.entries(nrfiData)
    .filter(([, e]) => e.starts >= 10)
    .sort(([, a], [, b]) => b.nrfi_rate - a.nrfi_rate)
    .slice(0, 10);
  log(TAG, '[OUTPUT] Top 10 NRFI Pitchers (min 10 starts):');
  top10.forEach(([id, e], i) => {
    log(TAG, `  #${i + 1} ${e.name} (${id}): ${(e.nrfi_rate * 100).toFixed(1)}% NRFI | ${e.starts} starts | F5 RA=${e.f5_runs_allowed_mean.toFixed(2)}`);
  });

  // Bottom 10 NRFI pitchers (min 10 starts)
  const bot10 = Object.entries(nrfiData)
    .filter(([, e]) => e.starts >= 10)
    .sort(([, a], [, b]) => a.nrfi_rate - b.nrfi_rate)
    .slice(0, 10);
  log(TAG, '[OUTPUT] Bottom 10 NRFI Pitchers (min 10 starts):');
  bot10.forEach(([id, e], i) => {
    log(TAG, `  #${i + 1} ${e.name} (${id}): ${(e.nrfi_rate * 100).toFixed(1)}% NRFI | ${e.starts} starts | F5 RA=${e.f5_runs_allowed_mean.toFixed(2)}`);
  });

  // ─── STEP 6: Write audit log ──────────────────────────────────────────────
  const auditPath = '/home/ubuntu/mlb_3yr_backtest/data/analysis/seed_nrfi_audit.json';
  const auditOutput = {
    runAt: new Date().toISOString(),
    calibVersion: CALIB_VERSION,
    source: NRFI_JSON_PATH,
    totalInJson: totalPitchers,
    eligible: eligible.length,
    skippedLowSample: skippedCount,
    updated,
    insertedStubs: inserted,
    errors,
    verifyPass,
    verifyFail,
    dbRowsWithCalibVersion: allSeeded.length,
    nrfiRateStats: {
      mean: parseFloat(mean(rates).toFixed(4)),
      std:  parseFloat(std(rates).toFixed(4)),
      min:  parseFloat(Math.min(...rates).toFixed(4)),
      max:  parseFloat(Math.max(...rates).toFixed(4)),
    },
    failedVerify,
    audit: audit.slice(0, 50),  // first 50 for brevity
  };
  fs.writeFileSync(auditPath, JSON.stringify(auditOutput, null, 2));
  log(TAG, `[OUTPUT] Audit log written: ${auditPath}`);

  // ─── FINAL VERDICT ────────────────────────────────────────────────────────
  const success = errors === 0 && verifyFail === 0 && jsonErrors === 0;
  log(TAG, '─────────────────────────────────────────────────────────');
  log(TAG, `[VERIFY] FINAL: ${success ? '✅ PASS' : '❌ FAIL'}`);
  log(TAG, `  JSON errors:    ${jsonErrors}`);
  log(TAG, `  DB upsert errors: ${errors}`);
  log(TAG, `  Verify failures:  ${verifyFail}`);
  log(TAG, `  Total seeded:     ${updated + inserted}`);
  log(TAG, `  Verify passed:    ${verifyPass}`);
  log(TAG, '═══════════════════════════════════════════════════════════');

  process.exit(success ? 0 : 1);
}

main().catch(e => {
  console.error(`[${new Date().toISOString()}] ${TAG} [FATAL]`, e.message);
  process.exit(1);
});
