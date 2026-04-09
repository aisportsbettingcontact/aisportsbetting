/**
 * mlbModelRunner.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Reusable MLB model pipeline:
 *   1. Reads all MLB games for a given date from the DB (with book lines)
 *   2. Calls the Python MLBAIModel.project_game() via child process
 *   3. Writes results back to DB using the v2 field mapping:
 *      - modelTotal  = book O/U line (NOT proj_total)
 *      - awayModelSpread / homeModelSpread = ±1.5 book RL (NOT raw diff)
 *      - awayRunLine / homeRunLine / awayRunLineOdds / homeRunLineOdds populated
 *   4. Post-write validation gate: flags any total or RL mismatch
 *   5. Sets publishedToFeed=true and publishedModel=true for all written games
 *
 * Designed to be called from runMlbCycle() in vsinAutoRefresh.ts as Step 5.
 *
 * Usage:
 *   import { runMlbModelForDate } from "./mlbModelRunner";
 *   await runMlbModelForDate("2026-03-27");
 */

import { spawn } from "child_process";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";
import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { games, mlbPitcherStats, mlbPitcherRolling5, mlbTeamBattingSplits, mlbParkFactors, mlbBullpenStats, mlbUmpireModifiers } from "../drizzle/schema";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const ENGINE_PATH = path.join(__dirname, "MLBAIModel.py");
const PYTHON      = "/usr/bin/python3.11";

// 2025 MLB team season stats — used as model inputs
// Format: rpg, era, avg, obp, slg, k9, bb9, whip, ip_per_game
const TEAM_STATS_2025: Record<string, Record<string, number>> = {
  NYY: { rpg: 5.01, era: 3.88, avg: 0.260, obp: 0.332, slg: 0.445, k9: 9.4,  bb9: 2.9, whip: 1.20, ip_per_game: 5.6 },
  SF:  { rpg: 4.52, era: 4.12, avg: 0.251, obp: 0.320, slg: 0.415, k9: 9.1,  bb9: 3.1, whip: 1.27, ip_per_game: 5.3 },
  ATH: { rpg: 4.21, era: 4.38, avg: 0.244, obp: 0.312, slg: 0.395, k9: 8.8,  bb9: 3.3, whip: 1.30, ip_per_game: 5.1 },
  TOR: { rpg: 4.68, era: 4.05, avg: 0.255, obp: 0.325, slg: 0.422, k9: 9.2,  bb9: 3.0, whip: 1.25, ip_per_game: 5.4 },
  COL: { rpg: 5.18, era: 5.42, avg: 0.271, obp: 0.340, slg: 0.458, k9: 8.2,  bb9: 3.6, whip: 1.42, ip_per_game: 4.8 },
  MIA: { rpg: 3.89, era: 4.28, avg: 0.238, obp: 0.305, slg: 0.378, k9: 9.0,  bb9: 3.2, whip: 1.29, ip_per_game: 5.2 },
  KC:  { rpg: 4.55, era: 4.15, avg: 0.252, obp: 0.320, slg: 0.410, k9: 8.9,  bb9: 3.1, whip: 1.28, ip_per_game: 5.2 },
  ATL: { rpg: 5.08, era: 3.78, avg: 0.263, obp: 0.335, slg: 0.448, k9: 9.6,  bb9: 2.8, whip: 1.19, ip_per_game: 5.6 },
  LAA: { rpg: 4.18, era: 4.48, avg: 0.243, obp: 0.310, slg: 0.392, k9: 8.7,  bb9: 3.4, whip: 1.33, ip_per_game: 5.0 },
  HOU: { rpg: 4.71, era: 3.82, avg: 0.254, obp: 0.323, slg: 0.425, k9: 9.5,  bb9: 2.9, whip: 1.21, ip_per_game: 5.5 },
  DET: { rpg: 4.62, era: 3.98, avg: 0.251, obp: 0.319, slg: 0.416, k9: 9.1,  bb9: 3.1, whip: 1.26, ip_per_game: 5.3 },
  SD:  { rpg: 4.38, era: 4.15, avg: 0.246, obp: 0.314, slg: 0.399, k9: 9.0,  bb9: 3.2, whip: 1.28, ip_per_game: 5.2 },
  CLE: { rpg: 4.35, era: 3.88, avg: 0.247, obp: 0.315, slg: 0.398, k9: 9.3,  bb9: 2.9, whip: 1.22, ip_per_game: 5.5 },
  SEA: { rpg: 4.48, era: 3.95, avg: 0.249, obp: 0.318, slg: 0.408, k9: 9.2,  bb9: 3.0, whip: 1.24, ip_per_game: 5.4 },
  ARI: { rpg: 4.61, era: 4.05, avg: 0.252, obp: 0.321, slg: 0.418, k9: 9.1,  bb9: 3.1, whip: 1.26, ip_per_game: 5.3 },
  LAD: { rpg: 5.12, era: 3.65, avg: 0.265, obp: 0.338, slg: 0.452, k9: 9.7,  bb9: 2.8, whip: 1.18, ip_per_game: 5.7 },
  BOS: { rpg: 4.88, era: 4.02, avg: 0.258, obp: 0.328, slg: 0.432, k9: 9.3,  bb9: 3.0, whip: 1.23, ip_per_game: 5.4 },
  BAL: { rpg: 4.72, era: 3.92, avg: 0.255, obp: 0.322, slg: 0.425, k9: 9.1,  bb9: 2.9, whip: 1.22, ip_per_game: 5.5 },
  TB:  { rpg: 4.41, era: 3.98, avg: 0.248, obp: 0.316, slg: 0.405, k9: 9.2,  bb9: 3.0, whip: 1.24, ip_per_game: 5.3 },
  MIN: { rpg: 4.55, era: 4.08, avg: 0.252, obp: 0.320, slg: 0.415, k9: 9.0,  bb9: 3.1, whip: 1.26, ip_per_game: 5.3 },
  CWS: { rpg: 3.82, era: 4.98, avg: 0.235, obp: 0.298, slg: 0.375, k9: 8.5,  bb9: 3.5, whip: 1.38, ip_per_game: 4.9 },
  CHC: { rpg: 4.42, era: 4.18, avg: 0.248, obp: 0.318, slg: 0.408, k9: 9.0,  bb9: 3.1, whip: 1.27, ip_per_game: 5.2 },
  CIN: { rpg: 4.58, era: 4.32, avg: 0.251, obp: 0.320, slg: 0.415, k9: 9.1,  bb9: 3.2, whip: 1.28, ip_per_game: 5.2 },
  MIL: { rpg: 4.62, era: 3.95, avg: 0.252, obp: 0.320, slg: 0.418, k9: 9.2,  bb9: 3.0, whip: 1.24, ip_per_game: 5.4 },
  PIT: { rpg: 4.28, era: 4.12, avg: 0.245, obp: 0.312, slg: 0.398, k9: 8.9,  bb9: 3.2, whip: 1.28, ip_per_game: 5.2 },
  STL: { rpg: 4.38, era: 4.05, avg: 0.248, obp: 0.318, slg: 0.405, k9: 9.0,  bb9: 3.1, whip: 1.26, ip_per_game: 5.3 },
  WSH: { rpg: 4.12, era: 4.42, avg: 0.242, obp: 0.308, slg: 0.392, k9: 8.8,  bb9: 3.3, whip: 1.30, ip_per_game: 5.1 },
  NYM: { rpg: 4.62, era: 4.02, avg: 0.252, obp: 0.322, slg: 0.418, k9: 9.1,  bb9: 3.0, whip: 1.25, ip_per_game: 5.4 },
  PHI: { rpg: 4.88, era: 3.88, avg: 0.258, obp: 0.328, slg: 0.438, k9: 9.4,  bb9: 2.9, whip: 1.21, ip_per_game: 5.5 },
  TEX: { rpg: 4.52, era: 4.15, avg: 0.250, obp: 0.318, slg: 0.412, k9: 9.0,  bb9: 3.1, whip: 1.27, ip_per_game: 5.3 },
  OAK: { rpg: 4.21, era: 4.38, avg: 0.244, obp: 0.312, slg: 0.395, k9: 8.8,  bb9: 3.3, whip: 1.30, ip_per_game: 5.1 },
};

// Default pitcher stats for unknown/new pitchers
const DEFAULT_PITCHER_STATS: Record<string, number> = {
  era: 4.25, k9: 8.8, bb9: 3.1, whip: 1.28, ip: 140.0, gp: 25, xera: 4.25,
};

// Known pitcher stats registry — keyed by "Name (TEAM)"
// Updated with 2025 season stats
const PITCHER_REGISTRY: Record<string, Record<string, number>> = {
  // March 28, 2026 starters (Baseball Savant 2025 season stats)
  "Joe Boyle (TB)":            { era: 4.67, k9: 10.0, bb9: 4.8,  whip: 1.35, ip: 52.0,  gp: 13, xera: 4.04 },
  "Michael McGreevy (STL)":    { era: 4.42, k9: 5.5,  bb9: 1.9,  whip: 1.30, ip: 95.7,  gp: 17, xera: 4.67 },
  "Miles Mikolas (WSH)":       { era: 4.84, k9: 5.8,  bb9: 2.1,  whip: 1.35, ip: 156.3, gp: 31, xera: 5.27 },
  "Cade Horton (CHC)":         { era: 2.67, k9: 7.4,  bb9: 2.5,  whip: 1.12, ip: 118.0, gp: 23, xera: 3.88 },
  "Jeffrey Springs (ATH)":     { era: 4.11, k9: 7.3,  bb9: 2.8,  whip: 1.21, ip: 171.0, gp: 32, xera: 4.30 },
  "Dylan Cease (TOR)":         { era: 4.55, k9: 11.5, bb9: 3.8,  whip: 1.33, ip: 168.0, gp: 32, xera: 3.46 },
  "Taj Bradley (MIN)":         { era: 5.05, k9: 8.0,  bb9: 3.5,  whip: 1.38, ip: 142.7, gp: 27, xera: 4.10 },
  "Kyle Bradish (BAL)":        { era: 2.53, k9: 9.8,  bb9: 2.8,  whip: 1.10, ip: 32.0,  gp: 6,  xera: 3.09 },
  "Jacob Latz (TEX)":          { era: 2.84, k9: 8.0,  bb9: 3.9,  whip: 1.22, ip: 85.7,  gp: 33, xera: 4.13 },
  "Aaron Nola (PHI)":          { era: 6.01, k9: 9.3,  bb9: 2.7,  whip: 1.42, ip: 94.3,  gp: 17, xera: 4.13 },
  "Sonny Gray (BOS)":          { era: 4.28, k9: 10.0, bb9: 1.9,  whip: 1.23, ip: 180.7, gp: 32, xera: 3.88 },
  "Brady Singer (CIN)":        { era: 4.03, k9: 8.6,  bb9: 3.2,  whip: 1.24, ip: 169.7, gp: 32, xera: 4.27 },
  "Mitch Keller (PIT)":        { era: 4.19, k9: 7.7,  bb9: 2.6,  whip: 1.26, ip: 176.3, gp: 32, xera: 4.45 },
  "David Peterson (NYM)":      { era: 4.22, k9: 8.0,  bb9: 3.5,  whip: 1.37, ip: 168.7, gp: 30, xera: 4.61 },
  "Michael Lorenzen (COL)":    { era: 4.64, k9: 8.1,  bb9: 2.5,  whip: 1.32, ip: 141.7, gp: 27, xera: 4.61 },
  "Eury Pérez (MIA)":          { era: 4.50, k9: 9.2,  bb9: 3.5,  whip: 1.30, ip: 45.0,  gp: 10, xera: 4.50 },
  "Reid Detmers (LAA)":        { era: 3.96, k9: 11.3, bb9: 3.5,  whip: 1.28, ip: 63.7,  gp: 14, xera: 3.61 },
  "Cristian Javier (HOU)":     { era: 4.62, k9: 8.3,  bb9: 3.6,  whip: 1.30, ip: 37.0,  gp: 8,  xera: 3.36 },
  "Sean Burke (CWS)":          { era: 4.22, k9: 8.9,  bb9: 4.2,  whip: 1.38, ip: 134.3, gp: 28, xera: 4.96 },
  "Chad Patrick (MIL)":        { era: 3.53, k9: 9.6,  bb9: 3.0,  whip: 1.25, ip: 119.7, gp: 27, xera: 3.88 },
  "Michael Wacha (KC)":        { era: 3.86, k9: 6.6,  bb9: 2.4,  whip: 1.22, ip: 172.7, gp: 31, xera: 4.19 },
  "Reynaldo López (ATL)":      { era: 4.08, k9: 11.0, bb9: 3.6,  whip: 1.28, ip: 92.7,  gp: 21, xera: 3.64 },
  "Will Warren (NYY)":         { era: 4.44, k9: 9.5,  bb9: 3.6,  whip: 1.37, ip: 162.3, gp: 33, xera: 4.58 },
  "Tyler Mahle (SF)":          { era: 2.18, k9: 6.9,  bb9: 3.0,  whip: 1.10, ip: 86.7,  gp: 16, xera: 4.24 },
  "Jack Flaherty (DET)":       { era: 4.64, k9: 10.5, bb9: 3.3,  whip: 1.32, ip: 161.0, gp: 31, xera: 3.99 },
  "Randy Vásquez (SD)":        { era: 4.85, k9: 8.2,  bb9: 3.8,  whip: 1.38, ip: 62.0,  gp: 14, xera: 4.95 },
  "Joey Cantillo (CLE)":       { era: 3.21, k9: 10.2, bb9: 4.0,  whip: 1.28, ip: 95.3,  gp: 34, xera: 3.71 },
  "Bryan Woo (SEA)":           { era: 2.94, k9: 9.5,  bb9: 1.7,  whip: 0.93, ip: 186.7, gp: 30, xera: 3.07 },
  "Eduardo Rodriguez (ARI)":   { era: 5.02, k9: 8.3,  bb9: 3.5,  whip: 1.38, ip: 154.3, gp: 29, xera: 4.51 },
  "Tyler Glasnow (LAD)":       { era: 3.19, k9: 10.6, bb9: 4.3,  whip: 1.22, ip: 90.3,  gp: 18, xera: 3.33 },
  // March 29, 2026 starters (MLB Stats API 2025 season stats)
  "Bailey Ober (MIN)":          { era: 5.10, k9: 7.39,  bb9: 1.91, whip: 1.30, ip: 146.1, gp: 27, xera: 5.10 },
  "Shane Baz (BAL)":            { era: 4.87, k9: 9.54,  bb9: 3.47, whip: 1.33, ip: 166.1, gp: 31, xera: 4.87 },
  "MacKenzie Gore (TEX)":       { era: 4.17, k9: 10.46, bb9: 3.62, whip: 1.35, ip: 159.2, gp: 30, xera: 4.17 },
  "Jesús Luzardo (PHI)":        { era: 3.92, k9: 10.61, bb9: 2.80, whip: 1.22, ip: 183.2, gp: 32, xera: 3.92 },
  "Seth Lugo (KC)":             { era: 4.15, k9: 7.75,  bb9: 3.41, whip: 1.29, ip: 145.1, gp: 26, xera: 4.15 },
  "Grant Holmes (ATL)":         { era: 3.99, k9: 9.63,  bb9: 4.23, whip: 1.34, ip: 115.0, gp: 22, xera: 3.99 },
  "Eric Lauer (ATH)":           { era: 3.18, k9: 8.81,  bb9: 2.25, whip: 1.11, ip: 104.2, gp: 28, xera: 3.18 },
  "Connelly Early (BOS)":       { era: 2.33, k9: 13.66, bb9: 1.88, whip: 1.09, ip: 19.1,  gp: 4,  xera: 2.33 },
  "Rhett Lowder (CIN)":         { era: 1.17, k9: 6.46,  bb9: 4.11, whip: 1.27, ip: 30.2,  gp: 6,  xera: 3.50 },
  "Carmen Mlodzinski (PIT)":    { era: 3.55, k9: 8.09,  bb9: 2.45, whip: 1.30, ip: 99.0,  gp: 34, xera: 3.55 },
  "Nolan McLean (NYM)":         { era: 2.06, k9: 10.69, bb9: 3.00, whip: 1.04, ip: 48.0,  gp: 8,  xera: 2.06 },
  "Max Meyer (MIA)":            { era: 4.73, k9: 9.53,  bb9: 2.80, whip: 1.42, ip: 64.2,  gp: 12, xera: 4.73 },
  "Tatsuya Imai (HOU)":         { era: 4.25, k9: 8.80,  bb9: 3.10, whip: 1.28, ip: 0.0,   gp: 0,  xera: 4.25 },
  "Anthony Kay (CWS)":          { era: 6.14, k9: 6.75,  bb9: 5.52, whip: 1.50, ip: 14.2,  gp: 16, xera: 5.80 },
  "Brandon Sproat (MIL)":       { era: 4.79, k9: 7.57,  bb9: 3.12, whip: 1.21, ip: 20.2,  gp: 4,  xera: 4.79 },
  "Steven Matz (TB)":           { era: 3.05, k9: 6.97,  bb9: 1.30, whip: 1.10, ip: 76.2,  gp: 53, xera: 3.05 },
  "Dustin May (STL)":           { era: 4.96, k9: 8.38,  bb9: 3.82, whip: 1.42, ip: 132.1, gp: 25, xera: 4.96 },
  "Jake Irvin (WSH)":           { era: 5.70, k9: 6.20,  bb9: 3.10, whip: 1.43, ip: 180.0, gp: 33, xera: 5.70 },
  "Shota Imanaga (CHC)":        { era: 3.73, k9: 7.30,  bb9: 1.62, whip: 0.99, ip: 144.2, gp: 25, xera: 3.73 },
  "Slade Cecconi (CLE)":        { era: 4.30, k9: 7.43,  bb9: 2.18, whip: 1.19, ip: 132.0, gp: 23, xera: 4.30 },
  "Emerson Hancock (SEA)":      { era: 4.90, k9: 6.40,  bb9: 3.10, whip: 1.38, ip: 90.0,  gp: 22, xera: 4.90 },
  // March 27 starters
  "Cam Schlittler (NYY)":   { era: 2.96, k9: 8.8,  bb9: 3.1, whip: 1.18, ip: 91.1,  gp: 16, xera: 4.11 },
  "Robbie Ray (SF)":        { era: 3.42, k9: 10.2, bb9: 3.4, whip: 1.22, ip: 158.1, gp: 27, xera: 3.65 },
  "Luis Severino (ATH)":    { era: 4.52, k9: 6.8,  bb9: 3.2, whip: 1.35, ip: 142.0, gp: 25, xera: 4.38 },
  "Kevin Gausman (TOR)":    { era: 3.28, k9: 9.4,  bb9: 1.8, whip: 1.10, ip: 193.0, gp: 32, xera: 3.41 },
  "Kyle Freeland (COL)":    { era: 5.18, k9: 7.2,  bb9: 3.5, whip: 1.44, ip: 138.0, gp: 25, xera: 5.02 },
  "Sandy Alcantara (MIA)":  { era: 3.88, k9: 8.9,  bb9: 2.4, whip: 1.22, ip: 162.0, gp: 28, xera: 3.72 },
  "Cole Ragans (KC)":       { era: 4.67, k9: 10.1, bb9: 3.0, whip: 1.28, ip: 168.0, gp: 29, xera: 2.67 },
  "Chris Sale (ATL)":       { era: 2.58, k9: 9.8,  bb9: 2.2, whip: 1.02, ip: 178.0, gp: 30, xera: 2.85 },
  "Yusei Kikuchi (LAA)":    { era: 4.22, k9: 9.1,  bb9: 3.2, whip: 1.28, ip: 152.0, gp: 27, xera: 4.01 },
  "Mike Burrows (HOU)":     { era: 3.92, k9: 9.4,  bb9: 3.1, whip: 1.24, ip: 118.0, gp: 22, xera: 3.78 },
  "Framber Valdez (DET)":   { era: 3.45, k9: 8.9,  bb9: 2.6, whip: 1.18, ip: 178.0, gp: 30, xera: 3.38 },
  "Michael King (SD)":      { era: 3.12, k9: 10.8, bb9: 2.8, whip: 1.08, ip: 168.0, gp: 29, xera: 3.24 },
  "Gavin Williams (CLE)":   { era: 3.05, k9: 9.2,  bb9: 3.4, whip: 1.18, ip: 148.0, gp: 26, xera: 4.29 },
  "George Kirby (SEA)":     { era: 3.38, k9: 8.8,  bb9: 1.4, whip: 1.05, ip: 192.0, gp: 32, xera: 3.21 },
  "Ryne Nelson (ARI)":      { era: 3.39, k9: 8.4,  bb9: 2.8, whip: 1.18, ip: 158.0, gp: 28, xera: 3.93 },
  "Emmet Sheehan (LAD)":    { era: 3.62, k9: 10.3, bb9: 3.2, whip: 1.22, ip: 128.0, gp: 24, xera: 3.48 },
  // March 26 starters
  "Garrett Crochet (BOS)":  { era: 3.58, k9: 11.4, bb9: 2.8, whip: 1.12, ip: 162.0, gp: 28, xera: 3.42 },
  "Gerrit Cole (NYY)":      { era: 2.63, k9: 11.2, bb9: 2.1, whip: 0.98, ip: 188.0, gp: 32, xera: 2.78 },
  "Paul Skenes (PIT)":      { era: 1.90, k9: 11.8, bb9: 2.0, whip: 0.95, ip: 133.0, gp: 23, xera: 2.12 },
  "Tarik Skubal (DET)":     { era: 2.39, k9: 11.1, bb9: 1.8, whip: 0.98, ip: 192.0, gp: 32, xera: 2.55 },
  "Logan Gilbert (SEA)":    { era: 3.24, k9: 9.8,  bb9: 2.1, whip: 1.08, ip: 185.0, gp: 31, xera: 3.38 },
  "Yoshinobu Yamamoto (LAD)": { era: 3.00, k9: 10.4, bb9: 2.2, whip: 1.05, ip: 182.0, gp: 31, xera: 3.12 },
  "Nathan Eovaldi (TEX)":   { era: 3.98, k9: 8.2,  bb9: 2.4, whip: 1.22, ip: 168.0, gp: 29, xera: 4.05 },
  "Zac Gallen (ARI)":       { era: 3.62, k9: 9.2,  bb9: 2.5, whip: 1.15, ip: 172.0, gp: 30, xera: 3.75 },
  "Freddy Peralta (NYM)":   { era: 3.28, k9: 10.8, bb9: 3.0, whip: 1.12, ip: 158.0, gp: 27, xera: 3.42 },
  "Joe Ryan (MIN)":         { era: 3.45, k9: 9.8,  bb9: 1.8, whip: 1.08, ip: 178.0, gp: 30, xera: 3.58 },
  "Cristopher Sanchez (PHI)": { era: 3.42, k9: 8.8, bb9: 2.6, whip: 1.18, ip: 162.0, gp: 28, xera: 3.55 },
  "Tanner Bibee (CLE)":     { era: 3.58, k9: 9.4,  bb9: 2.8, whip: 1.18, ip: 168.0, gp: 29, xera: 3.72 },
  "Jose Soriano (LAA)":     { era: 3.88, k9: 9.8,  bb9: 3.2, whip: 1.22, ip: 142.0, gp: 25, xera: 3.95 },
  "Hunter Brown (HOU)":     { era: 3.78, k9: 9.6,  bb9: 3.0, whip: 1.22, ip: 162.0, gp: 28, xera: 3.88 },
  "Matthew Boyd (CHC)":     { era: 3.92, k9: 9.2,  bb9: 2.8, whip: 1.25, ip: 148.0, gp: 26, xera: 4.05 },
  "Andrew Abbott (CIN)":    { era: 3.72, k9: 9.8,  bb9: 3.1, whip: 1.22, ip: 152.0, gp: 27, xera: 3.85 },
  "Trevor Rogers (BAL)":    { era: 4.12, k9: 9.0,  bb9: 3.4, whip: 1.28, ip: 138.0, gp: 25, xera: 4.25 },
  "Drew Rasmussen (TB)":    { era: 3.62, k9: 8.8,  bb9: 2.4, whip: 1.18, ip: 148.0, gp: 26, xera: 3.75 },
  "Shane Smith (CWS)":      { era: 4.42, k9: 8.4,  bb9: 3.2, whip: 1.32, ip: 132.0, gp: 24, xera: 4.55 },
  "Matthew Liberatore (STL)": { era: 4.18, k9: 8.8, bb9: 3.1, whip: 1.28, ip: 142.0, gp: 25, xera: 4.32 },
  "Jacob Misiorowski (MIL)": { era: 3.88, k9: 10.8, bb9: 3.8, whip: 1.22, ip: 98.0,  gp: 18, xera: 3.95 },
  "Cade Cavalli (WSH)":     { era: 4.52, k9: 9.2,  bb9: 3.8, whip: 1.35, ip: 88.0,  gp: 16, xera: 4.65 },
  // March 30, 2026 starters (MLB Stats API 2025 season stats; * = 2024 fallback; ** = league-average default)
  "Simeon Woods Richardson (MIN)": { era: 4.04, k9: 8.6,  bb9: 3.7, whip: 1.28, ip: 111.3, gp: 22, xera: 4.15 },
  "Kris Bubic (KC)":               { era: 2.55, k9: 9.0,  bb9: 3.0, whip: 1.18, ip: 116.3, gp: 20, xera: 2.68 },
  "Jack Leiter (TEX)":             { era: 3.86, k9: 8.8,  bb9: 4.0, whip: 1.28, ip: 151.7, gp: 29, xera: 3.98 },
  "Chris Bassitt (BAL)":           { era: 3.96, k9: 8.8,  bb9: 2.7, whip: 1.33, ip: 170.3, gp: 31, xera: 4.05 },
  "Braxton Ashcraft (PIT)":        { era: 2.71, k9: 9.2,  bb9: 3.1, whip: 1.25, ip: 69.7,  gp: 8,  xera: 2.85 },
  "Chase Burns (CIN)":             { era: 4.57, k9: 13.9, bb9: 3.3, whip: 1.32, ip: 43.3,  gp: 8,  xera: 4.12 },
  "Foster Griffin (WSH)":          { era: 4.50, k9: 8.0,  bb9: 3.5, whip: 1.35, ip: 80.0,  gp: 15, xera: 4.50 }, // ** league-avg default
  "Taijuan Walker (PHI)":          { era: 4.08, k9: 6.3,  bb9: 3.1, whip: 1.41, ip: 123.7, gp: 21, xera: 4.22 },
  "Davis Martin (CWS)":            { era: 4.10, k9: 6.6,  bb9: 3.0, whip: 1.29, ip: 142.7, gp: 25, xera: 4.18 },
  "Chris Paddack (MIA)":           { era: 5.35, k9: 6.4,  bb9: 2.1, whip: 1.28, ip: 158.0, gp: 28, xera: 5.10 },
  "Tomoyuki Sugano (COL)":         { era: 4.64, k9: 6.1,  bb9: 2.1, whip: 1.33, ip: 157.0, gp: 30, xera: 4.72 },
  "Cody Ponce (TOR)":              { era: 4.50, k9: 7.5,  bb9: 3.0, whip: 1.35, ip: 60.0,  gp: 10, xera: 4.50 }, // ** league-avg default
  "Jacob Lopez (ATH)":             { era: 4.08, k9: 11.0, bb9: 3.6, whip: 1.27, ip: 92.7,  gp: 17, xera: 3.95 },
  "Bryce Elder (ATL)":             { era: 5.30, k9: 7.5,  bb9: 2.9, whip: 1.39, ip: 156.3, gp: 28, xera: 5.15 },
  "Ryan Johnson (LAA)":            { era: 4.50, k9: 8.5,  bb9: 3.2, whip: 1.35, ip: 40.0,  gp: 8,  xera: 4.50 }, // ** limited MLB data; debut-level default
  "Edward Cabrera (CHC)":          { era: 3.53, k9: 9.8,  bb9: 3.1, whip: 1.23, ip: 137.7, gp: 26, xera: 3.62 },
  "Nick Martinez (TB)":            { era: 4.45, k9: 6.3,  bb9: 2.3, whip: 1.21, ip: 165.7, gp: 26, xera: 4.38 },
  "Kyle Harrison (MIL)":           { era: 4.04, k9: 9.6,  bb9: 3.5, whip: 1.37, ip: 35.7,  gp: 6,  xera: 4.12 },
  "Clay Holmes (NYM)":             { era: 3.53, k9: 7.0,  bb9: 3.6, whip: 1.30, ip: 165.7, gp: 31, xera: 3.62 },
  "Kyle Leahy (STL)":              { era: 3.07, k9: 8.2,  bb9: 2.9, whip: 1.23, ip: 88.0,  gp: 1,  xera: 3.18 },
  "Ranger Suarez (BOS)":           { era: 3.20, k9: 8.6,  bb9: 2.2, whip: 1.22, ip: 157.3, gp: 26, xera: 3.28 },
  "Lance McCullers Jr. (HOU)":     { era: 6.51, k9: 9.9,  bb9: 6.3, whip: 1.81, ip: 55.3,  gp: 13, xera: 6.25 },
  "Landen Roupp (SF)":             { era: 3.80, k9: 8.6,  bb9: 3.8, whip: 1.48, ip: 106.7, gp: 22, xera: 3.92 },
  "Walker Buehler (SD)":           { era: 4.93, k9: 6.6,  bb9: 4.4, whip: 1.52, ip: 126.0, gp: 24, xera: 5.05 },
  "Ryan Weathers (NYY)":           { era: 3.99, k9: 8.7,  bb9: 2.8, whip: 1.28, ip: 38.3,  gp: 8,  xera: 4.08 },
  "Luis Castillo (SEA)":           { era: 3.54, k9: 8.1,  bb9: 2.3, whip: 1.18, ip: 180.7, gp: 32, xera: 3.62 },
  "Parker Messick (CLE)":          { era: 2.72, k9: 8.6,  bb9: 1.4, whip: 1.31, ip: 39.7,  gp: 7,  xera: 2.85 },
  "Roki Sasaki (LAD)":             { era: 4.46, k9: 6.9,  bb9: 5.4, whip: 1.43, ip: 36.3,  gp: 8,  xera: 4.58 },
  "Justin Verlander (DET)":        { era: 3.85, k9: 8.1,  bb9: 3.1, whip: 1.36, ip: 152.0, gp: 29, xera: 3.95 },
  "Michael Soroka (ARI)":          { era: 4.52, k9: 9.5,  bb9: 2.9, whip: 1.13, ip: 89.7,  gp: 17, xera: 4.38 },
};

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface MlbModelResult {
  ok: boolean;
  db_id: number;
  game: string;
  away_abbrev: string;
  home_abbrev: string;
  away_pitcher: string;
  home_pitcher: string;
    // Projected runs
  proj_away_runs: number;
  proj_home_runs: number;
  proj_total: number;
  // Moneyline
  away_ml: number;
  home_ml: number;
  away_win_pct: number;
  home_win_pct: number;
  // Run line (book ±1.5)
  away_run_line: string;
  home_run_line: string;
  away_rl_odds: number;
  home_rl_odds: number;
  away_rl_cover_pct: number;
  home_rl_cover_pct: number;
  // Total (book-anchored)
  total_line: number;
  over_odds: number;
  under_odds: number;
  over_pct: number;
  under_pct: number;
  // Model spread
  model_spread: number;
  // F5 (First Five Innings)
  p_f5_home_win: number;
  p_f5_away_win: number;
  f5_ml_home: number;
  f5_ml_away: number;
  p_f5_home_rl: number;
  p_f5_away_rl: number;
  f5_rl_home_odds: number;
  f5_rl_away_odds: number;
  f5_total_key: number;
  f5_over_odds: number;
  f5_under_odds: number;
  p_f5_over: number;
  p_f5_under: number;
  exp_f5_home_runs: number;
  exp_f5_away_runs: number;
  exp_f5_total: number;
  // NRFI / YRFI
  p_nrfi: number;
  p_yrfi: number;
  nrfi_odds: number;
  yrfi_odds: number;
  exp_first_inn_total: number;
  // HR Props (team-level)
  p_home_hr_any: number;
  p_away_hr_any: number;
  p_both_hr: number;
  exp_home_hr: number;
  exp_away_hr: number;
  // Meta
  simulations: number;
  elapsed_sec: number;
  error: string | null;
}

interface ValidationResult {
  passed: boolean;
  issues: string[];
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function fmtMl(val: number): string {
  const rounded = Math.round(val);
  return rounded >= 0 ? `+${rounded}` : `${rounded}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRECISION SIGNAL HELPERS: Park Factors, Bullpen Stats, Umpire Modifiers
// ─────────────────────────────────────────────────────────────────────────────

/** Default bullpen stats (league-average fallback) */
const DEFAULT_BULLPEN: Record<string, number> = {
  era: 4.20, fip: 4.10, k9: 9.0, bb9: 3.2, hr9: 1.2, whip: 1.28,
  kBbRatio: 2.8, relieverCount: 7, totalIp: 300,
};

/**
 * Fetch park factors for all home teams in today's games from DB.
 * Returns a Map<teamAbbrev, parkFactor3yr>.
 */
async function fetchParkFactors(
  homeTeams: string[],
  dbInstance: Awaited<ReturnType<typeof getDb>>
): Promise<Map<string, number>> {
  const TAG = '[ParkFactors]';
  const result = new Map<string, number>();
  if (homeTeams.length === 0) return result;

  try {
    const rows = await dbInstance.select({
      teamAbbrev: mlbParkFactors.teamAbbrev,
      parkFactor3yr: mlbParkFactors.parkFactor3yr,
      pf2026: mlbParkFactors.pf2026,
      pf2025: mlbParkFactors.pf2025,
      pf2024: mlbParkFactors.pf2024,
      venueName: mlbParkFactors.venueName,
    }).from(mlbParkFactors)
      .where(inArray(mlbParkFactors.teamAbbrev, homeTeams));

    for (const row of rows) {
      const pf = row.parkFactor3yr ?? 1.0;
      result.set(row.teamAbbrev.toUpperCase(), pf);
      console.log(
        `${TAG} ${row.teamAbbrev} (${row.venueName}): ` +
        `3yr=${pf.toFixed(4)} | 2024=${row.pf2024?.toFixed(4) ?? 'N/A'} ` +
        `2025=${row.pf2025?.toFixed(4) ?? 'N/A'} 2026=${row.pf2026?.toFixed(4) ?? 'N/A'}`
      );
    }
    console.log(`${TAG} [INPUT] Loaded ${rows.length}/${homeTeams.length} park factors from DB`);
  } catch (err) {
    console.error(`${TAG} DB error — using neutral (1.0) for all:`, err);
  }
  return result;
}

/**
 * Fetch bullpen stats for all teams in today's games from DB.
 * Returns a Map<teamAbbrev, bullpenStatsRecord>.
 */
async function fetchBullpenStats(
  teams: string[],
  dbInstance: Awaited<ReturnType<typeof getDb>>
): Promise<Map<string, Record<string, number>>> {
  const TAG = '[BullpenStats]';
  const result = new Map<string, Record<string, number>>();
  if (teams.length === 0) return result;

  try {
    const rows = await dbInstance.select({
      teamAbbrev: mlbBullpenStats.teamAbbrev,
      eraBullpen: mlbBullpenStats.eraBullpen,
      fipBullpen: mlbBullpenStats.fipBullpen,
      k9Bullpen: mlbBullpenStats.k9Bullpen,
      bb9Bullpen: mlbBullpenStats.bb9Bullpen,
      hr9Bullpen: mlbBullpenStats.hr9Bullpen,
      whipBullpen: mlbBullpenStats.whipBullpen,
      kBbRatio: mlbBullpenStats.kBbRatio,
      relieverCount: mlbBullpenStats.relieverCount,
      totalIp: mlbBullpenStats.totalIp,
    }).from(mlbBullpenStats)
      .where(inArray(mlbBullpenStats.teamAbbrev, teams));

    for (const row of rows) {
      const stats: Record<string, number> = {
        era:          row.eraBullpen   ?? DEFAULT_BULLPEN.era,
        fip:          row.fipBullpen   ?? DEFAULT_BULLPEN.fip,
        k9:           row.k9Bullpen    ?? DEFAULT_BULLPEN.k9,
        bb9:          row.bb9Bullpen   ?? DEFAULT_BULLPEN.bb9,
        hr9:          row.hr9Bullpen   ?? DEFAULT_BULLPEN.hr9,
        whip:         row.whipBullpen  ?? DEFAULT_BULLPEN.whip,
        kBbRatio:     row.kBbRatio     ?? DEFAULT_BULLPEN.kBbRatio,
        relieverCount: row.relieverCount ?? DEFAULT_BULLPEN.relieverCount,
        totalIp:      row.totalIp      ?? DEFAULT_BULLPEN.totalIp,
      };
      result.set(row.teamAbbrev.toUpperCase(), stats);
      console.log(
        `${TAG} ${row.teamAbbrev}: ERA=${stats.era.toFixed(2)} FIP=${stats.fip.toFixed(2)} ` +
        `K/9=${stats.k9.toFixed(2)} BB/9=${stats.bb9.toFixed(2)} ` +
        `K/BB=${stats.kBbRatio.toFixed(2)} relievers=${stats.relieverCount}`
      );
    }
    console.log(`${TAG} [INPUT] Loaded ${rows.length}/${teams.length} bullpen rows from DB`);
  } catch (err) {
    console.error(`${TAG} DB error — using league-average defaults:`, err);
  }
  return result;
}

/**
 * Fetch HP umpire assignments for today's games from MLB Stats API,
 * then look up kModifier/bbModifier from DB.
 * Returns a Map<mlbGamePk, { umpireName, kMod, bbMod }>.
 */
async function fetchUmpireModifiers(
  gamePks: number[],
  dbInstance: Awaited<ReturnType<typeof getDb>>
): Promise<Map<number, { umpireName: string; kMod: number; bbMod: number }>> {
  const TAG = '[UmpireModifiers]';
  const result = new Map<number, { umpireName: string; kMod: number; bbMod: number }>();
  if (gamePks.length === 0) return result;

  // Step 1: Fetch HP umpire assignments from MLB Stats API
  const pksStr = gamePks.join(',');
  const apiUrl = `https://statsapi.mlb.com/api/v1/schedule?gamePks=${pksStr}&hydrate=officials`;
  console.log(`${TAG} [STEP] Fetching HP umpires for ${gamePks.length} games from MLB API...`);

  let scheduleData: Record<string, unknown>;
  try {
    scheduleData = await new Promise<Record<string, unknown>>((resolve, reject) => {
      https.get(apiUrl, (res) => {
        let raw = '';
        res.on('data', (d: Buffer) => { raw += d.toString(); });
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
  } catch (err) {
    console.error(`${TAG} MLB API error — no umpire modifiers applied:`, err);
    return result;
  }

  // Step 2: Extract HP umpire ID per gamePk
  const umpireIdMap = new Map<number, { id: number; name: string }>();
  const dates = (scheduleData as Record<string, unknown[]>).dates ?? [];
  for (const d of dates as Record<string, unknown>[]) {
    for (const g of (d.games ?? []) as Record<string, unknown>[]) {
      const pk = g.gamePk as number;
      const officials = (g.officials ?? []) as Record<string, unknown>[];
      const hp = officials.find((o) => o.officialType === 'Home Plate');
      if (hp) {
        const official = hp.official as Record<string, unknown>;
        umpireIdMap.set(pk, { id: official.id as number, name: official.fullName as string });
      }
    }
  }
  console.log(`${TAG} [STATE] HP umpires found: ${umpireIdMap.size}/${gamePks.length} games`);

  // Step 3: Batch-fetch umpire modifiers from DB
  const umpireIds = Array.from(new Set(Array.from(umpireIdMap.values()).map(u => u.id)));
  if (umpireIds.length === 0) {
    console.warn(`${TAG} No HP umpires assigned yet — using league-average (kMod=1.0, bbMod=1.0)`);
    return result;
  }

  let dbRows: Array<{ umpireId: number; umpireName: string; kModifier: number | null; bbModifier: number | null; gamesHp: number }> = [];
  try {
    dbRows = await dbInstance.select({
      umpireId: mlbUmpireModifiers.umpireId,
      umpireName: mlbUmpireModifiers.umpireName,
      kModifier: mlbUmpireModifiers.kModifier,
      bbModifier: mlbUmpireModifiers.bbModifier,
      gamesHp: mlbUmpireModifiers.gamesHp,
    }).from(mlbUmpireModifiers)
      .where(inArray(mlbUmpireModifiers.umpireId, umpireIds));
  } catch (err) {
    console.error(`${TAG} DB error fetching umpire modifiers:`, err);
    return result;
  }

  const umpireDbMap = new Map(dbRows.map(r => [r.umpireId, r]));

  // Step 4: Build result map per gamePk
  for (const [pk, ump] of Array.from(umpireIdMap)) {
    const dbRow = umpireDbMap.get(ump.id);
    if (dbRow) {
      const kMod  = dbRow.kModifier  ?? 1.0;
      const bbMod = dbRow.bbModifier ?? 1.0;
      result.set(pk, { umpireName: dbRow.umpireName, kMod, bbMod });
      console.log(
        `${TAG} gamePk=${pk} HP=${dbRow.umpireName} (id=${ump.id}) ` +
        `kMod=${kMod.toFixed(4)} bbMod=${bbMod.toFixed(4)} games=${dbRow.gamesHp}`
      );
    } else {
      // Umpire not in DB (new umpire or insufficient sample) — use league-average
      result.set(pk, { umpireName: ump.name, kMod: 1.0, bbMod: 1.0 });
      console.warn(
        `${TAG} gamePk=${pk} HP=${ump.name} (id=${ump.id}) NOT in DB — using kMod=1.0 bbMod=1.0`
      );
    }
  }

  console.log(`${TAG} [OUTPUT] Umpire modifiers resolved: ${result.size}/${gamePks.length} games`);
  return result;
}

/**
 * Compute per-team SP averages from all rows in the DB for a given team.
 * Used as fallback when a specific pitcher is not found in the DB.
 * IP-weighted average for ERA, K/9, BB/9, HR/9, WHIP.
 */
function computeTeamSpAverage(
  teamAbbrev: string,
  allRows: Array<{
    teamAbbrev: string;
    era: number | null;
    k9: number | null;
    bb9: number | null;
    hr9: number | null;
    whip: number | null;
    ip: number | null;
    gamesStarted: number | null;
    xera: number | null;
    fip: number | null;
    xfip: number | null;
  }>
): Record<string, number> {
  const teamRows = allRows.filter(
    r => r.teamAbbrev.toUpperCase() === teamAbbrev.toUpperCase() &&
         r.gamesStarted !== null && (r.gamesStarted ?? 0) >= 1
  );

  if (teamRows.length === 0) {
    // No team data at all — use league-average defaults
    return { ...DEFAULT_PITCHER_STATS };
  }

  // IP-weighted average for rate stats
  let totalIP = 0;
  let sumEra = 0, sumK9 = 0, sumBb9 = 0, sumHr9 = 0, sumWhip = 0, sumXera = 0;
  let sumFip = 0, sumXfip = 0;
  let countXera = 0, countFip = 0, countXfip = 0;

  for (const r of teamRows) {
    const ip = r.ip ?? 0;
    totalIP += ip;
    sumEra  += (r.era  ?? DEFAULT_PITCHER_STATS.era)  * ip;
    sumK9   += (r.k9   ?? DEFAULT_PITCHER_STATS.k9)   * ip;
    sumBb9  += (r.bb9  ?? DEFAULT_PITCHER_STATS.bb9)  * ip;
    sumHr9  += (r.hr9  ?? DEFAULT_PITCHER_STATS.hr9)  * ip;
    sumWhip += (r.whip ?? DEFAULT_PITCHER_STATS.whip) * ip;
    if (r.xera !== null) { sumXera += r.xera * ip; countXera++; }
    if (r.fip  !== null) { sumFip  += r.fip  * ip; countFip++;  }
    if (r.xfip !== null) { sumXfip += r.xfip * ip; countXfip++; }
  }

  if (totalIP === 0) return { ...DEFAULT_PITCHER_STATS };

  const avgIP = totalIP / teamRows.length;
  return {
    era:  sumEra  / totalIP,
    k9:   sumK9   / totalIP,
    bb9:  sumBb9  / totalIP,
    hr9:  sumHr9  / totalIP,
    whip: sumWhip / totalIP,
    ip:   avgIP,
    gp:   teamRows.reduce((s, r) => s + (r.gamesStarted ?? 0), 0) / teamRows.length,
    xera: countXera > 0 ? sumXera / (countXera * avgIP) : DEFAULT_PITCHER_STATS.xera,
    fip:  countFip  > 0 ? sumFip  / totalIP : DEFAULT_PITCHER_STATS.era,
    xfip: countXfip > 0 ? sumXfip / totalIP : DEFAULT_PITCHER_STATS.era,
    throwsHand: 0, // team avg has no single hand
  };
}

/**
 * Batch-fetch pitcher stats from mlb_pitcher_stats table for all pitchers in a game set.
 * Returns a Map keyed by "name|teamAbbrev".
 *
 * Fallback priority:
 *   1. Exact DB match: name + team
 *   2. DB match: name only (handles team transfers)
 *   3. Legacy PITCHER_REGISTRY: name + team
 *   4. Legacy PITCHER_REGISTRY: name prefix
 *   5. Team SP average (computed from all starters for that team in DB)
 *
 * @param pitcherNames - Array of { name, teamAbbrev } pairs
 * @param dbInstance   - Drizzle DB instance (already resolved)
 */
async function batchFetchPitcherStats(
  pitcherNames: Array<{ name: string; teamAbbrev: string }>,
  dbInstance: Awaited<ReturnType<typeof getDb>>
): Promise<Map<string, Record<string, number>>> {
  const result = new Map<string, Record<string, number>>();
  if (!dbInstance || pitcherNames.length === 0) return result;

  // ── DB round-trip 1: fetch all pitcher season stats + sabermetrics ─────────
  const allRows = await dbInstance
    .select({
      mlbamId:      mlbPitcherStats.mlbamId,
      fullName:     mlbPitcherStats.fullName,
      teamAbbrev:   mlbPitcherStats.teamAbbrev,
      era:          mlbPitcherStats.era,
      k9:           mlbPitcherStats.k9,
      bb9:          mlbPitcherStats.bb9,
      hr9:          mlbPitcherStats.hr9,
      whip:         mlbPitcherStats.whip,
      ip:           mlbPitcherStats.ip,
      gamesStarted: mlbPitcherStats.gamesStarted,
      gamesPlayed:  mlbPitcherStats.gamesPlayed,
      xera:         mlbPitcherStats.xera,
      fip:          mlbPitcherStats.fip,
      xfip:         mlbPitcherStats.xfip,
      fipMinus:     mlbPitcherStats.fipMinus,
      eraMinus:     mlbPitcherStats.eraMinus,
      war:          mlbPitcherStats.war,
      throwsHand:   mlbPitcherStats.throwsHand,
    })
    .from(mlbPitcherStats);

  // ── DB round-trip 2: fetch all rolling-5 stats ─────────────────────────────
  const rolling5Rows = await dbInstance
    .select({
      mlbamId:        mlbPitcherRolling5.mlbamId,
      startsIncluded: mlbPitcherRolling5.startsIncluded,
      ip5:            mlbPitcherRolling5.ip5,
      era5:           mlbPitcherRolling5.era5,
      k9_5:           mlbPitcherRolling5.k9_5,
      bb9_5:          mlbPitcherRolling5.bb9_5,
      hr9_5:          mlbPitcherRolling5.hr9_5,
      whip5:          mlbPitcherRolling5.whip5,
      fip5:           mlbPitcherRolling5.fip5,
    })
    .from(mlbPitcherRolling5);

  // Build rolling-5 lookup by mlbamId
  const rolling5Map = new Map<number, typeof rolling5Rows[0]>();
  for (const r of rolling5Rows) rolling5Map.set(r.mlbamId, r);

  // ── DB round-trip 3: fetch all team batting splits (vs LHP + vs RHP) ───────
  const battingSplitRows = await dbInstance
    .select({
      teamAbbrev: mlbTeamBattingSplits.teamAbbrev,
      hand:       mlbTeamBattingSplits.hand,
      avg:        mlbTeamBattingSplits.avg,
      obp:        mlbTeamBattingSplits.obp,
      slg:        mlbTeamBattingSplits.slg,
      ops:        mlbTeamBattingSplits.ops,
      woba:       mlbTeamBattingSplits.woba,
      hr9:        mlbTeamBattingSplits.hr9,
      bb9:        mlbTeamBattingSplits.bb9,
      k9:         mlbTeamBattingSplits.k9,
    })
    .from(mlbTeamBattingSplits);

  // Build batting splits lookup: teamAbbrev → { L: splits, R: splits }
  const battingSplitsLookup = new Map<string, { L: Record<string, number>; R: Record<string, number> }>();
  for (const r of battingSplitRows) {
    const team = r.teamAbbrev.toUpperCase();
    if (!battingSplitsLookup.has(team)) battingSplitsLookup.set(team, { L: {}, R: {} });
    const entry = battingSplitsLookup.get(team)!;
    const splits = {
      avg:  r.avg  ?? 0.250,
      obp:  r.obp  ?? 0.318,
      slg:  r.slg  ?? 0.410,
      ops:  r.ops  ?? 0.728,
      woba: r.woba ?? 0.312,
      hr9:  r.hr9  ?? 1.0,
      bb9:  r.bb9  ?? 3.1,
      k9:   r.k9   ?? 9.0,
    };
    if (r.hand === 'L') entry.L = splits;
    else                entry.R = splits;
  }

  console.log(`[MLBModelRunner] [BATCH] Loaded: ${allRows.length} pitcher rows, ${rolling5Rows.length} rolling-5 rows, ${battingSplitRows.length} batting split rows`);

  // ── Helper: blend season + rolling-5 stats ─────────────────────────────────
  // Weights: 70% season, 30% rolling-5 (if ≥3 starts in window)
  const SEASON_W  = 0.70;
  const ROLLING_W = 0.30;
  const MIN_ROLLING_STARTS = 3;

  function blendWithRolling(
    season: Record<string, number>,
    r5: typeof rolling5Rows[0] | undefined
  ): Record<string, number> {
    if (!r5 || (r5.startsIncluded ?? 0) < MIN_ROLLING_STARTS || !r5.era5) {
      // Not enough rolling data — use season stats only
      return season;
    }
    const blended = { ...season };
    // Blend ERA, K/9, BB/9, HR/9, WHIP
    blended.era  = SEASON_W * season.era  + ROLLING_W * (r5.era5  ?? season.era);
    blended.k9   = SEASON_W * season.k9   + ROLLING_W * (r5.k9_5  ?? season.k9);
    blended.bb9  = SEASON_W * season.bb9  + ROLLING_W * (r5.bb9_5 ?? season.bb9);
    blended.hr9  = SEASON_W * season.hr9  + ROLLING_W * (r5.hr9_5 ?? season.hr9);
    blended.whip = SEASON_W * season.whip + ROLLING_W * (r5.whip5 ?? season.whip);
    // Blend FIP if rolling FIP available
    if (r5.fip5 !== null && season.fip) {
      blended.fip = SEASON_W * season.fip + ROLLING_W * r5.fip5;
    }
    blended.rolling_starts = r5.startsIncluded ?? 0;
    blended.rolling_era    = r5.era5  ?? season.era;
    blended.rolling_k9     = r5.k9_5  ?? season.k9;
    blended.rolling_bb9    = r5.bb9_5 ?? season.bb9;
    blended.rolling_whip   = r5.whip5 ?? season.whip;
    blended.rolling_fip    = r5.fip5  ?? season.fip ?? season.era;
    return blended;
  }

  // Build name → stats lookup map (includes FIP, xFIP, throwsHand)
  const dbMap = new Map<string, { stats: Record<string, number>; mlbamId: number }>();
  for (const row of allRows) {
    const normName = row.fullName.toLowerCase().trim();
    // Season stats base
    const seasonStats: Record<string, number> = {
      era:       row.era       ?? DEFAULT_PITCHER_STATS.era,
      k9:        row.k9        ?? DEFAULT_PITCHER_STATS.k9,
      bb9:       row.bb9       ?? DEFAULT_PITCHER_STATS.bb9,
      hr9:       row.hr9       ?? DEFAULT_PITCHER_STATS.hr9,
      whip:      row.whip      ?? DEFAULT_PITCHER_STATS.whip,
      ip:        row.ip        ?? DEFAULT_PITCHER_STATS.ip,
      gp:        row.gamesStarted ?? DEFAULT_PITCHER_STATS.gp,
      xera:      row.xera      ?? DEFAULT_PITCHER_STATS.xera,
      fip:       row.fip       ?? row.era ?? DEFAULT_PITCHER_STATS.era,
      xfip:      row.xfip      ?? row.era ?? DEFAULT_PITCHER_STATS.era,
      fipMinus:  row.fipMinus  ?? 100,
      eraMinus:  row.eraMinus  ?? 100,
      war:       row.war       ?? 0,
      // throwsHand encoded as number: 0=R, 1=L, 2=S (Python reads as string via pitch_hand)
      throwsHand: row.throwsHand === 'L' ? 1 : row.throwsHand === 'S' ? 2 : 0,
      throwsHandStr: 0, // placeholder, actual string passed separately
    };
    // Blend with rolling-5 if available
    const r5 = rolling5Map.get(row.mlbamId);
    const blended = blendWithRolling(seasonStats, r5);
    // Store the actual hand string for Python
    blended.throwsHandStr = 0; // unused numeric placeholder
    const entry = { stats: blended, mlbamId: row.mlbamId };
    // Primary key: "name (TEAM)"
    dbMap.set(`${normName} (${row.teamAbbrev.toUpperCase()})`, entry);
    // Secondary key: name only (team-agnostic, first occurrence wins)
    if (!dbMap.has(normName)) dbMap.set(normName, entry);
  }

  // Pre-compute team SP averages for all teams that appear in the request
  const teamsNeeded = Array.from(new Set(pitcherNames.map(p => p.teamAbbrev.toUpperCase())));
  const teamAvgCache = new Map<string, Record<string, number>>();
  for (const team of teamsNeeded) {
    teamAvgCache.set(team, computeTeamSpAverage(team, allRows));
  }

  // Resolve each requested pitcher
  for (const { name, teamAbbrev } of pitcherNames) {
    const normName = name.toLowerCase().trim();
    const teamKey = `${normName} (${teamAbbrev.toUpperCase()})`;

    let stats: Record<string, number> | undefined;
    let resolvedMlbamId: number | undefined;
    let source = '';

    // 1. Exact DB match: name + team
    if (dbMap.has(teamKey)) {
      const entry = dbMap.get(teamKey)!;
      stats = entry.stats;
      resolvedMlbamId = entry.mlbamId;
      source = 'DB (exact)';
    }
    // 2. DB match: name only (handles team transfers mid-season)
    else if (dbMap.has(normName)) {
      const entry = dbMap.get(normName)!;
      stats = entry.stats;
      resolvedMlbamId = entry.mlbamId;
      source = 'DB (name-only)';
    }
    // 3. Legacy PITCHER_REGISTRY: name + team
    else {
      const legacyKey = `${name} (${teamAbbrev})`;
      if (PITCHER_REGISTRY[legacyKey]) {
        stats = PITCHER_REGISTRY[legacyKey];
        source = 'Registry (exact)';
      } else {
        // 4. Legacy PITCHER_REGISTRY: name prefix
        for (const [k, v] of Object.entries(PITCHER_REGISTRY)) {
          if (k.startsWith(name)) {
            stats = v;
            source = 'Registry (prefix)';
            break;
          }
        }
      }
    }

    // 5. Team SP average fallback — no league-average defaults
    if (!stats) {
      const teamAvg = teamAvgCache.get(teamAbbrev.toUpperCase());
      if (teamAvg) {
        stats = teamAvg;
        source = `Team SP avg (${teamAbbrev})`;
        console.log(`[MLBModelRunner] ↩ Team SP avg fallback: "${name}" (${teamAbbrev})`);
      } else {
        stats = { ...DEFAULT_PITCHER_STATS };
        source = 'league-avg default';
        console.warn(`[MLBModelRunner] ⚠ No team data for "${name}" (${teamAbbrev}) — using league-avg defaults`);
      }
    } else {
      const handStr = stats.throwsHand === 1 ? 'L' : stats.throwsHand === 2 ? 'S' : 'R';
      const rollingInfo = stats.rolling_starts
        ? ` | rolling-5: ERA=${stats.rolling_era?.toFixed(2)} K/9=${stats.rolling_k9?.toFixed(2)} (${stats.rolling_starts} starts)`
        : ' | no rolling-5 blend';
      console.log(
        `[MLBModelRunner] ✓ ${source}: "${name}" (${teamAbbrev}) | ` +
        `ERA=${stats.era?.toFixed(2)} FIP=${stats.fip?.toFixed(2)} xFIP=${stats.xfip?.toFixed(2)} ` +
        `K/9=${stats.k9?.toFixed(2)} BB/9=${stats.bb9?.toFixed(2)} WHIP=${stats.whip?.toFixed(3)} ` +
        `hand=${handStr} WAR=${stats.war?.toFixed(2)}${rollingInfo}`
      );
    }

    // Attach batting splits for the opposing team keyed by this pitcher's hand
    // These are stored in the stats dict so the Python engine can use them
    // via team_stats dict (passed separately in engineInputs)
    result.set(`${name}|${teamAbbrev}`, stats);
  }

  // Also expose battingSplitsLookup so Step 3 can attach to team_stats
  (result as any).__battingSplits = battingSplitsLookup;

  return result;
}

function getTeamStats(abbrev: string): Record<string, number> {
  if (TEAM_STATS_2025[abbrev]) return TEAM_STATS_2025[abbrev];
  console.warn(`[MLBModelRunner] ⚠ Unknown team "${abbrev}" — using league-average stats`);
  return { rpg: 4.50, era: 4.20, avg: 0.250, obp: 0.318, slg: 0.410, k9: 9.0, bb9: 3.1, whip: 1.26, ip_per_game: 5.3 };
}

// ─────────────────────────────────────────────────────────────────────────────
// PYTHON ENGINE CALLER
// ─────────────────────────────────────────────────────────────────────────────

interface EngineInput {
  db_id: number;
  away_abbrev: string;
  home_abbrev: string;
  away_pitcher_name: string;
  home_pitcher_name: string;
  away_team_stats: Record<string, number>;
  home_team_stats: Record<string, number>;
  away_pitcher_stats: Record<string, number>;
  home_pitcher_stats: Record<string, number>;
  book_lines: {
    ml_away: number;
    ml_home: number;
    ou_line: number;
    over_odds: number;
    under_odds: number;
    rl_home_spread: number;
    rl_home: number;
    rl_away: number;
  };
  game_date: string;
  // ── New precision signals ────────────────────────────────────────────────
  park_factor_3yr: number;        // 3-year weighted park run factor (1.0 = neutral)
  away_bullpen: Record<string, number>;  // bullpen ERA/FIP/K9/BB9 for away team
  home_bullpen: Record<string, number>;  // bullpen ERA/FIP/K9/BB9 for home team
  umpire_k_mod: number;           // HP umpire K-rate modifier (1.0 = league avg)
  umpire_bb_mod: number;          // HP umpire BB-rate modifier (1.0 = league avg)
  umpire_name: string;            // HP umpire name for logging
  mlb_game_pk: number | null;     // MLB Stats API gamePk for traceability
}

async function runPythonEngine(inputs: EngineInput[]): Promise<MlbModelResult[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, ["-c", `
import sys, json, os
sys.path.insert(0, "${__dirname.replace(/\\/g, '/')}")
from MLBAIModel import project_game
from datetime import datetime

inputs = json.load(sys.stdin)
results = []
for inp in inputs:
    try:
        r = project_game(
            away_abbrev=inp['away_abbrev'],
            home_abbrev=inp['home_abbrev'],
            away_team_stats=inp['away_team_stats'],
            home_team_stats=inp['home_team_stats'],
            away_pitcher_stats=inp['away_pitcher_stats'],
            home_pitcher_stats=inp['home_pitcher_stats'],
            book_lines=inp['book_lines'],
            game_date=datetime.strptime(inp['game_date'], '%Y-%m-%d'),
            park_factor_3yr=inp.get('park_factor_3yr', 1.0),
            away_bullpen=inp.get('away_bullpen'),
            home_bullpen=inp.get('home_bullpen'),
            umpire_k_mod=inp.get('umpire_k_mod', 1.0),
            umpire_bb_mod=inp.get('umpire_bb_mod', 1.0),
            umpire_name=inp.get('umpire_name', 'UNKNOWN'),
            mlb_game_pk=inp.get('mlb_game_pk'),
            verbose=True,
        )
        r['db_id'] = inp['db_id']
        r['away_pitcher'] = inp['away_pitcher_name']
        r['home_pitcher'] = inp['home_pitcher_name']
        results.append(r)
    except Exception as e:
        results.append({
            'db_id': inp['db_id'],
            'ok': False,
            'error': str(e),
            'game': f"{inp['away_abbrev']} @ {inp['home_abbrev']}",
        })
print(json.dumps(results))
`], {
      env: (() => {
        // Build a clean env for python3.11:
        // 1. Start from process.env (inherits PATH, HOME, etc.)
        // 2. DELETE PYTHONHOME entirely — setting it to undefined in JS passes the
        //    string "undefined" to the child process, which breaks stdlib lookup.
        //    We must use delete to actually remove it from the env object.
        // 3. Override PYTHONPATH to point at the correct python3.11 site-packages.
        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env)) {
          if (v !== undefined && k !== 'PYTHONHOME') env[k] = v;
        }
        env['PYTHONPATH'] = '/usr/local/lib/python3.11/dist-packages:/usr/lib/python3/dist-packages';
        env['PYTHONDONTWRITEBYTECODE'] = '1';
        return env;
      })(),
      cwd: __dirname,
    });

    let stdout = "";
    let stderrBuf = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    // Stream stderr line-by-line so verbose engine diagnostics appear in real-time
    proc.stderr.on("data", (d: Buffer) => {
      stderrBuf += d.toString();
      const lines = stderrBuf.split("\n");
      stderrBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) console.log(`[ENGINE] ${line}`);
      }
    });

    proc.on("close", (code: number) => {
      // Flush any remaining stderr buffer
      if (stderrBuf.trim()) console.log(`[ENGINE] ${stderrBuf.trim()}`);
      const stderr = stderrBuf;
      if (code !== 0) {
        return reject(new Error(`Python engine exited with code ${code}: ${stderr.slice(0, 500)}`));
      }
      try {
        const results = JSON.parse(stdout.trim()) as MlbModelResult[];
        resolve(results);
      } catch (e) {
        reject(new Error(`Failed to parse Python output: ${stdout.slice(0, 500)}`));
      }
    });

    proc.on("error", (err: Error) => reject(err));
    proc.stdin.write(JSON.stringify(inputs));
    proc.stdin.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST-WRITE VALIDATION GATE
// ─────────────────────────────────────────────────────────────────────────────

export async function validateMlbModelResults(dateStr: string): Promise<ValidationResult> {
  const db = await getDb();
  const rows = await db.select({
    id:              games.id,
    away:            games.awayTeam,
    home:            games.homeTeam,
    bookTotal:       games.bookTotal,
    modelTotal:      games.modelTotal,
    awayBookSpread:  games.awayBookSpread,
    awayModelSpread: games.awayModelSpread,
    homeModelSpread: games.homeModelSpread,
    awayRunLine:     games.awayRunLine,
    homeRunLine:     games.homeRunLine,
    awayRunLineOdds: games.awayRunLineOdds,
    homeRunLineOdds: games.homeRunLineOdds,
    modelOverOdds:   games.modelOverOdds,
    modelUnderOdds:  games.modelUnderOdds,
    publishedToFeed: games.publishedToFeed,
    publishedModel:  games.publishedModel,
  }).from(games)
    .where(and(
      eq(games.gameDate, dateStr),
      eq(games.sport, "MLB"),
    ));

  const issues: string[] = [];
  const warnings: string[] = [];

  for (const g of rows as Array<typeof rows[0]>) {
    const label = `[${g.id}] ${g.away} @ ${g.home}`;

    // 1. Total must match book
    const bookT  = parseFloat(String(g.bookTotal  ?? "0"));
    const modelT = parseFloat(String(g.modelTotal ?? "0"));
    if (Math.abs(bookT - modelT) > 0.01) {
      issues.push(`${label}: modelTotal=${modelT} ≠ bookTotal=${bookT}`);
    }

    // 2. RL spread must be ±1.5 or 0 (pick'em — DK occasionally posts even-spread RL)
    const awayRL = String(g.awayModelSpread ?? "");
    const validRL = awayRL.includes("1.5") || ["0", "0.0", "+0", "-0"].includes(awayRL);
    if (!validRL) {
      issues.push(`${label}: awayModelSpread="${awayRL}" — expected ±1.5 or 0 (pick'em)`);
    }

    // 3. RL odds must be populated
    if (!g.awayRunLineOdds || g.awayRunLineOdds === "NULL") {
      issues.push(`${label}: awayRunLineOdds is NULL`);
    }
    if (!g.homeRunLineOdds || g.homeRunLineOdds === "NULL") {
      issues.push(`${label}: homeRunLineOdds is NULL`);
    }

    // 4. awayRunLine / homeRunLine must be populated
    if (!g.awayRunLine) {
      issues.push(`${label}: awayRunLine is NULL`);
    }
    if (!g.homeRunLine) {
      issues.push(`${label}: homeRunLine is NULL`);
    }

    // 5. Feed flags
    if (!g.publishedToFeed || !g.publishedModel) {
      issues.push(`${label}: publishedToFeed=${g.publishedToFeed} publishedModel=${g.publishedModel}`);
    }

    // 6. Warn on whole-number totals (push probability > 0)
    if (bookT === Math.floor(bookT)) {
      warnings.push(`${label}: bookTotal=${bookT} is a whole number — push probability applies`);
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT: runMlbModelForDate
// ─────────────────────────────────────────────────────────────────────────────

export interface MlbModelRunSummary {
  date: string;
  total: number;
  written: number;
  skipped: number;
  errors: number;
  validation: ValidationResult;
}

export async function runMlbModelForDate(dateStr: string): Promise<MlbModelRunSummary> {
  const TAG = `[MLBModelRunner][${dateStr}]`;
  console.log(`${TAG} ► START`);

  const db = await getDb();

  // ── Step 1: Fetch all MLB games for the date with book lines ────────────────
  const dbGames = await db.select({
    id:              games.id,
    awayTeam:        games.awayTeam,
    homeTeam:        games.homeTeam,
    awayML:          games.awayML,
    homeML:          games.homeML,
    awayBookSpread:  games.awayBookSpread,
    homeBookSpread:  games.homeBookSpread,
    awaySpreadOdds:  games.awaySpreadOdds,
    homeSpreadOdds:  games.homeSpreadOdds,
    bookTotal:       games.bookTotal,
    overOdds:        games.overOdds,
    underOdds:       games.underOdds,
    awayRunLine:     games.awayRunLine,
    homeRunLine:     games.homeRunLine,
    awayRunLineOdds: games.awayRunLineOdds,
    homeRunLineOdds: games.homeRunLineOdds,
    awayStartingPitcher: games.awayStartingPitcher,
    homeStartingPitcher: games.homeStartingPitcher,
    startTimeEst:    games.startTimeEst,
    mlbGamePk:       games.mlbGamePk,
  }).from(games)
    .where(and(
      eq(games.gameDate, dateStr),
      eq(games.sport, "MLB"),
    ));

  console.log(`${TAG} Found ${dbGames.length} MLB games in DB`);

  // ── Step 2: Filter games that have enough data to model ─────────────────────
  const modelable = dbGames.filter((g: typeof dbGames[0]) => {
    const hasLines = g.bookTotal && g.awayML && g.homeML;
    const hasPitchers = g.awayStartingPitcher && g.homeStartingPitcher;
    if (!hasLines) {
      console.warn(`${TAG} SKIP [${g.id}] ${g.awayTeam}@${g.homeTeam} — missing book lines`);
    }
    if (!hasPitchers) {
      console.warn(`${TAG} SKIP [${g.id}] ${g.awayTeam}@${g.homeTeam} — missing starters`);
    }
    return hasLines && hasPitchers;
  });

  console.log(`${TAG} Modelable: ${modelable.length}/${dbGames.length}`);

  if (modelable.length === 0) {
    console.log(`${TAG} No games to model — exiting`);
    return { date: dateStr, total: dbGames.length, written: 0, skipped: dbGames.length, errors: 0, validation: { passed: true, issues: [], warnings: [] } };
  }

  // ── Step 2b: Batch-fetch precision signals (park factors, bullpen, umpires) ──
  const homeTeams: string[]  = Array.from(new Set(modelable.map((g: typeof dbGames[0]) => g.homeTeam!.toUpperCase())));
  const allTeams: string[]   = Array.from(new Set(modelable.flatMap((g: typeof dbGames[0]) => [g.awayTeam!.toUpperCase(), g.homeTeam!.toUpperCase()])));
  const gamePks    = modelable.map((g: typeof dbGames[0]) => g.mlbGamePk).filter((pk: number | null | undefined): pk is number => pk !== null && pk !== undefined);

  console.log(`${TAG} [STEP] Fetching precision signals: ${homeTeams.length} park factors, ${allTeams.length} bullpens, ${gamePks.length} umpires...`);

  const [parkFactorMap, bullpenMap, umpireMap] = await Promise.all([
    fetchParkFactors(homeTeams, db),
    fetchBullpenStats(allTeams, db),
    fetchUmpireModifiers(gamePks, db),
  ]);

  console.log(
    `${TAG} [STATE] Signals loaded: parkFactors=${parkFactorMap.size}/${homeTeams.length} ` +
    `bullpens=${bullpenMap.size}/${allTeams.length} umpires=${umpireMap.size}/${gamePks.length}`
  );

  // ── Step 3: Batch-fetch pitcher stats from DB, then build engine inputs ────────
  // Collect all unique pitcher/team pairs for a single DB round-trip
  const pitcherPairs: Array<{ name: string; teamAbbrev: string }> = [];
  for (const g of modelable) {
    pitcherPairs.push({ name: g.awayStartingPitcher!, teamAbbrev: g.awayTeam! });
    pitcherPairs.push({ name: g.homeStartingPitcher!, teamAbbrev: g.homeTeam! });
  }
  const pitcherStatsMap = await batchFetchPitcherStats(pitcherPairs, db);

  const engineInputs: EngineInput[] = modelable.map((g: typeof dbGames[0]) => {
    const awayAbbrev = g.awayTeam!;
    const homeAbbrev = g.homeTeam!;
    const awayPitcher = g.awayStartingPitcher!;
    const homePitcher = g.homeStartingPitcher!;

    // Determine RL home spread from DB awayRunLine / homeRunLine
    // awayRunLine = "+1.5" means away is the RL underdog → home is RL fav → rl_home_spread = -1.5
    // awayRunLine = "-1.5" means away is the RL fav → rl_home_spread = +1.5
    let rlHomeSpread = -1.5; // default: home is RL favorite
    if (g.awayRunLine) {
      const awayRLNum = parseFloat(String(g.awayRunLine));
      rlHomeSpread = -awayRLNum; // invert: if away is -1.5, home is +1.5
    } else if (g.awayML) {
      // Fallback: infer from ML
      const awayMLNum = parseFloat(String(g.awayML));
      rlHomeSpread = awayMLNum < 0 ? 1.5 : -1.5;
    }

    const bookLines = {
      ml_away:       parseFloat(String(g.awayML ?? "100")),
      ml_home:       parseFloat(String(g.homeML ?? "-120")),
      ou_line:       parseFloat(String(g.bookTotal ?? "8.5")),
      over_odds:     parseFloat(String(g.overOdds ?? "-110")),
      under_odds:    parseFloat(String(g.underOdds ?? "-110")),
      rl_home_spread: rlHomeSpread,
      rl_home:       parseFloat(String(g.homeRunLineOdds ?? "-150")),
      rl_away:       parseFloat(String(g.awayRunLineOdds ?? "130")),
    };

    // Retrieve pitcher stats (season + rolling-5 blended, with FIP/xFIP/hand)
    const awayPitcherStats = pitcherStatsMap.get(`${awayPitcher}|${awayAbbrev}`) ?? { ...DEFAULT_PITCHER_STATS };
    const homePitcherStats = pitcherStatsMap.get(`${homePitcher}|${homeAbbrev}`) ?? { ...DEFAULT_PITCHER_STATS };

    // Determine pitcher hands for batting split selection
    // throwsHand: 0=R, 1=L, 2=S (switch)
    const awayHand: 'L' | 'R' = awayPitcherStats.throwsHand === 1 ? 'L' : 'R';
    const homeHand: 'L' | 'R' = homePitcherStats.throwsHand === 1 ? 'L' : 'R';

    // Retrieve batting splits lookup from pitcherStatsMap side-channel
    const battingSplits = (pitcherStatsMap as any).__battingSplits as
      Map<string, { L: Record<string, number>; R: Record<string, number> }> | undefined;

    // Base team stats (season-level)
    const awayBaseStats = getTeamStats(awayAbbrev);
    const homeBaseStats = getTeamStats(homeAbbrev);

    // Augment team stats with hand-specific batting splits vs the opposing pitcher
    // Away team bats against HOME pitcher (homeHand)
    // Home team bats against AWAY pitcher (awayHand)
    const awayBattingSplit = battingSplits?.get(awayAbbrev)?.[homeHand];
    const homeBattingSplit = battingSplits?.get(homeAbbrev)?.[awayHand];

    const awayTeamStats = awayBattingSplit
      ? {
          ...awayBaseStats,
          avg:  awayBattingSplit.avg,
          obp:  awayBattingSplit.obp,
          slg:  awayBattingSplit.slg,
          woba: awayBattingSplit.woba,
          // Override K/BB/HR rates from hand-specific splits
          batting_k9:  awayBattingSplit.k9,
          batting_bb9: awayBattingSplit.bb9,
          batting_hr9: awayBattingSplit.hr9,
          split_hand:  homeHand === 'L' ? 1 : 0,
        }
      : awayBaseStats;

    const homeTeamStats = homeBattingSplit
      ? {
          ...homeBaseStats,
          avg:  homeBattingSplit.avg,
          obp:  homeBattingSplit.obp,
          slg:  homeBattingSplit.slg,
          woba: homeBattingSplit.woba,
          batting_k9:  homeBattingSplit.k9,
          batting_bb9: homeBattingSplit.bb9,
          batting_hr9: homeBattingSplit.hr9,
          split_hand:  awayHand === 'L' ? 1 : 0,
        }
      : homeBaseStats;

    // ── Precision signals: park factor, bullpen, umpire ─────────────────────────────────
    const parkFactor3yr = parkFactorMap.get(homeAbbrev.toUpperCase()) ?? 1.0;
    const awayBullpen   = bullpenMap.get(awayAbbrev.toUpperCase()) ?? { ...DEFAULT_BULLPEN };
    const homeBullpen   = bullpenMap.get(homeAbbrev.toUpperCase()) ?? { ...DEFAULT_BULLPEN };
    const umpireData    = g.mlbGamePk ? umpireMap.get(g.mlbGamePk) : undefined;
    const umpireKMod    = umpireData?.kMod  ?? 1.0;
    const umpireBBMod   = umpireData?.bbMod ?? 1.0;
    const umpireName    = umpireData?.umpireName ?? 'UNKNOWN (league-avg)';

    console.log(
      `${TAG} [${g.id}] ${awayAbbrev}@${homeAbbrev} | ` +
      `SP: ${awayPitcher}(${awayHand}) vs ${homePitcher}(${homeHand}) | ` +
      `RL home: ${rlHomeSpread} | O/U: ${bookLines.ou_line} | ` +
      `away split: vs${homeHand}=${awayBattingSplit ? `avg=${awayBattingSplit.avg?.toFixed(3)} wOBA=${awayBattingSplit.woba?.toFixed(3)}` : 'season'} | ` +
      `home split: vs${awayHand}=${homeBattingSplit ? `avg=${homeBattingSplit.avg?.toFixed(3)} wOBA=${homeBattingSplit.woba?.toFixed(3)}` : 'season'}`
    );
    console.log(
      `${TAG} [${g.id}] PRECISION: ` +
      `parkFactor=${parkFactor3yr.toFixed(4)} (${parkFactorMap.has(homeAbbrev.toUpperCase()) ? 'DB' : 'neutral'}) | ` +
      `awayBullpen ERA=${awayBullpen.era.toFixed(2)} FIP=${awayBullpen.fip.toFixed(2)} (${bullpenMap.has(awayAbbrev.toUpperCase()) ? 'DB' : 'default'}) | ` +
      `homeBullpen ERA=${homeBullpen.era.toFixed(2)} FIP=${homeBullpen.fip.toFixed(2)} (${bullpenMap.has(homeAbbrev.toUpperCase()) ? 'DB' : 'default'}) | ` +
      `umpire=${umpireName} kMod=${umpireKMod.toFixed(4)} bbMod=${umpireBBMod.toFixed(4)}`
    );

    return {
      db_id:              g.id,
      away_abbrev:        awayAbbrev,
      home_abbrev:        homeAbbrev,
      away_pitcher_name:  awayPitcher,
      home_pitcher_name:  homePitcher,
      away_team_stats:    awayTeamStats,
      home_team_stats:    homeTeamStats,
      away_pitcher_stats: awayPitcherStats,
      home_pitcher_stats: homePitcherStats,
      book_lines:         bookLines,
      game_date:          dateStr,
      // ── Precision signals ──
      park_factor_3yr:    parkFactor3yr,
      away_bullpen:       awayBullpen,
      home_bullpen:       homeBullpen,
      umpire_k_mod:       umpireKMod,
      umpire_bb_mod:      umpireBBMod,
      umpire_name:        umpireName,
      mlb_game_pk:        g.mlbGamePk ?? null,
    };
  });

  // ── Step 4: Run Python engine ────────────────────────────────────────────────
  console.log(`${TAG} Spawning Python engine for ${engineInputs.length} games...`);
  const t0 = Date.now();
  let engineResults: MlbModelResult[];
  try {
    engineResults = await runPythonEngine(engineInputs);
  } catch (err) {
    console.error(`${TAG} Python engine failed:`, err);
    return { date: dateStr, total: dbGames.length, written: 0, skipped: modelable.length, errors: modelable.length, validation: { passed: false, issues: [`Python engine error: ${err}`], warnings: [] } };
  }
  console.log(`${TAG} Engine completed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // ── Step 5: Write results to DB (v2 field mapping) ───────────────────────────
  let written = 0;
  let errors  = 0;

  for (const r of engineResults) {
    if (!r.ok || r.error) {
      console.error(`${TAG} [${r.db_id}] ${r.game} — engine error: ${r.error}`);
      errors++;
      continue;
    }

    console.log(`\n${TAG} [${r.db_id}] ${r.game}`);
    console.log(`  Proj: ${r.proj_away_runs.toFixed(2)}–${r.proj_home_runs.toFixed(2)} (total: ${r.proj_total.toFixed(2)})`);
    console.log(`  Book total: ${r.total_line} | Over: ${r.over_pct.toFixed(2)}% (${fmtMl(r.over_odds)}) | Under: ${r.under_pct.toFixed(2)}% (${fmtMl(r.under_odds)})`);
    console.log(`  ML: ${fmtMl(r.away_ml)}/${fmtMl(r.home_ml)} | Win%: ${r.away_win_pct.toFixed(2)}%/${r.home_win_pct.toFixed(2)}%`);
    console.log(`  RL: ${r.away_run_line} (${fmtMl(r.away_rl_odds)}) / ${r.home_run_line} (${fmtMl(r.home_rl_odds)})`);
    console.log(`  Cover%: away=${r.away_rl_cover_pct.toFixed(2)}% home=${r.home_rl_cover_pct.toFixed(2)}%`);
    console.log(`  Model spread: ${r.model_spread.toFixed(3)} | Sims: ${r.simulations} | Elapsed: ${r.elapsed_sec}s`);

    try {
      await db.update(games)
        .set({
          // ── Run line ─────────────────────────────────────────────────────
          // awayModelSpread/homeModelSpread: signed RL label used by GameCard spread section
          // awayRunLine/homeRunLine: same label stored in the book RL field for reference
          // awayRunLineOdds/homeRunLineOdds: model-computed RL odds (raw storage)
          // modelAwaySpreadOdds/modelHomeSpreadOdds: MUST also receive RL odds so GameCard
          //   renders them in the MLB spread section (GameCard checks isMlbGame && modelAwaySpreadOdds)
          awayModelSpread:      r.away_run_line,        // e.g. "+1.5" or "-1.5"
          homeModelSpread:      r.home_run_line,        // e.g. "-1.5" or "+1.5"
          awayRunLine:          r.away_run_line,        // book RL label (reference copy)
          homeRunLine:          r.home_run_line,        // book RL label (reference copy)
          awayRunLineOdds:      fmtMl(r.away_rl_odds), // raw RL odds storage
          homeRunLineOdds:      fmtMl(r.home_rl_odds), // raw RL odds storage
          modelAwaySpreadOdds:  fmtMl(r.away_rl_odds), // ← GameCard MLB spread odds display
          modelHomeSpreadOdds:  fmtMl(r.home_rl_odds), // ← GameCard MLB spread odds display
          // ── Total (anchored to book O/U) ─────────────────────────────────
          modelTotal:           String(r.total_line),
          modelOverOdds:        fmtMl(r.over_odds),
          modelUnderOdds:       fmtMl(r.under_odds),
          modelOverRate:        String(r.over_pct.toFixed(2)),
          modelUnderRate:       String(r.under_pct.toFixed(2)),
          // ── Moneyline ────────────────────────────────────────────────────
          modelAwayML:          fmtMl(r.away_ml),
          modelHomeML:          fmtMl(r.home_ml),
          // ── Scores ───────────────────────────────────────────────────────
          modelAwayScore:       String(r.proj_away_runs.toFixed(2)),
          modelHomeScore:       String(r.proj_home_runs.toFixed(2)),
          modelAwayWinPct:      String(r.away_win_pct.toFixed(2)),
          modelHomeWinPct:      String(r.home_win_pct.toFixed(2)),
          // ── F5 (First Five Innings) model output ───────────────────────────────
          modelF5AwayML:        fmtMl(r.f5_ml_away),
          modelF5HomeML:        fmtMl(r.f5_ml_home),
          modelF5AwayScore:     String(r.exp_f5_away_runs.toFixed(3)),
          modelF5HomeScore:     String(r.exp_f5_home_runs.toFixed(3)),
          modelF5Total:         String(r.f5_total_key),
          modelF5OverOdds:      fmtMl(r.f5_over_odds),
          modelF5UnderOdds:     fmtMl(r.f5_under_odds),
          modelF5OverRate:      String(r.p_f5_over.toFixed(4)),
          modelF5UnderRate:     String(r.p_f5_under.toFixed(4)),
          modelF5AwayRunLine:   '-0.5',
          modelF5HomeRunLine:   '+0.5',
          modelF5AwayRlOdds:    fmtMl(r.f5_rl_away_odds),
          modelF5HomeRlOdds:    fmtMl(r.f5_rl_home_odds),
          // ── NRFI / YRFI model output ─────────────────────────────────────
          modelPNrfi:           String(r.p_nrfi.toFixed(4)),
          modelNrfiOdds:        fmtMl(r.nrfi_odds),
          modelPYrfi:           String(r.p_yrfi.toFixed(4)),
          modelYrfiOdds:        fmtMl(r.yrfi_odds),
          // ── HR Props (team-level) model output ─────────────────────────────
          modelPHomeHrAny:      String(r.p_home_hr_any.toFixed(4)),
          modelPAwayHrAny:      String(r.p_away_hr_any.toFixed(4)),
          modelPBothHr:         String(r.p_both_hr.toFixed(4)),
          modelExpHomeHr:       String(r.exp_home_hr.toFixed(3)),
          modelExpAwayHr:       String(r.exp_away_hr.toFixed(3)),
          // ── Meta ──────────────────────────────────────────────────────────────────────────
          modelSpreadClamped:   false,
          modelTotalClamped:    false,
          modelRunAt:           BigInt(Date.now()),
          awayStartingPitcher:  r.away_pitcher,
          homeStartingPitcher:  r.home_pitcher,
          awayPitcherConfirmed: true,
          homePitcherConfirmed: true,
          publishedToFeed:      true,
          publishedModel:       true,
        })
        .where(eq(games.id, r.db_id));

      console.log(`  [DB] ✓ Written id=${r.db_id}`);
      written++;
    } catch (err) {
      console.error(`  [DB] ✗ ERROR id=${r.db_id}: ${err}`);
      errors++;
    }
  }

  console.log(`\n${TAG} DB writes: ${written} written, ${errors} errors, ${dbGames.length - modelable.length} skipped (no lines/pitchers)`);

  // ── Step 6: Post-write validation gate ──────────────────────────────────────
  console.log(`\n${TAG} Running post-write validation gate...`);
  const validation = await validateMlbModelResults(dateStr);

  if (validation.passed) {
    console.log(`${TAG} ✅ VALIDATION PASSED — all ${written} games correct`);
  } else {
    console.error(`${TAG} ❌ VALIDATION FAILED — ${validation.issues.length} issues:`);
    for (const issue of validation.issues) {
      console.error(`  ✗ ${issue}`);
    }
  }
  if (validation.warnings.length > 0) {
    console.warn(`${TAG} ⚠ ${validation.warnings.length} warnings:`);
    for (const w of validation.warnings) {
      console.warn(`  ⚠ ${w}`);
    }
  }

  console.log(`\n${TAG} ✅ DONE`);

  return {
    date:       dateStr,
    total:      dbGames.length,
    written,
    skipped:    dbGames.length - modelable.length,
    errors,
    validation,
  };
}
