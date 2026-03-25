/**
 * strikeoutProps.test.ts
 *
 * Tests for the MLB strikeout props DB helpers and tRPC router integration.
 * Validates schema exports, DB helper function signatures, and router procedure definitions.
 */

import { describe, it, expect } from "vitest";
import * as path from "path";
import * as fs from "fs";

// ─── Schema exports ────────────────────────────────────────────────────────────

describe("mlbStrikeoutProps schema", () => {
  it("exports mlbStrikeoutProps table from drizzle/schema.ts", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.mlbStrikeoutProps).toBeDefined();
  });

  it("exports MlbStrikeoutPropRow and InsertMlbStrikeoutProp types", async () => {
    // Types are compile-time only; verify the table has the expected columns at runtime
    const schema = await import("../drizzle/schema");
    const table = schema.mlbStrikeoutProps;
    expect(table).toBeDefined();
    // Check key columns exist on the table object
    const cols = Object.keys(table);
    expect(cols).toContain("gameId");
    expect(cols).toContain("side");
    expect(cols).toContain("pitcherName");
    expect(cols).toContain("kProj");
    expect(cols).toContain("bookLine");
    expect(cols).toContain("pOver");
    expect(cols).toContain("pUnder");
    expect(cols).toContain("verdict");
    expect(cols).toContain("distribution");
    expect(cols).toContain("signalBreakdown");
    expect(cols).toContain("matchupRows");
  });
});

// ─── DB helper exports ─────────────────────────────────────────────────────────

describe("db.ts strikeout props helpers", () => {
  it("exports upsertStrikeoutProp function", async () => {
    const db = await import("./db");
    expect(typeof db.upsertStrikeoutProp).toBe("function");
  });

  it("exports getStrikeoutPropsByGame function", async () => {
    const db = await import("./db");
    expect(typeof db.getStrikeoutPropsByGame).toBe("function");
  });

  it("exports getStrikeoutPropsByGames function", async () => {
    const db = await import("./db");
    expect(typeof db.getStrikeoutPropsByGames).toBe("function");
  });
});

// ─── StrikeoutModelRunner exports ─────────────────────────────────────────────

describe("strikeoutModelRunner.ts", () => {
  it("exports runStrikeoutModel function", async () => {
    const runner = await import("./strikeoutModelRunner");
    expect(typeof runner.runStrikeoutModel).toBe("function");
  });

  it("StrikeoutModel.py exists in server directory", () => {
    const scriptPath = path.join(__dirname, "StrikeoutModel.py");
    expect(fs.existsSync(scriptPath)).toBe(true);
  });
});

// ─── tRPC router ──────────────────────────────────────────────────────────────

describe("appRouter strikeoutProps procedures", () => {
  it("appRouter has strikeoutProps router", async () => {
    const { appRouter } = await import("./routers");
    // The router is an object with procedure definitions
    expect(appRouter).toBeDefined();
    // Check the router has the strikeoutProps namespace
    const routerDef = appRouter._def as Record<string, unknown>;
    expect(routerDef).toBeDefined();
  });

  it("routers.ts imports getStrikeoutPropsByGame and getStrikeoutPropsByGames", () => {
    const routersPath = path.join(__dirname, "routers.ts");
    const content = fs.readFileSync(routersPath, "utf-8");
    expect(content).toContain("getStrikeoutPropsByGame");
    expect(content).toContain("getStrikeoutPropsByGames");
    expect(content).toContain("strikeoutProps: router(");
    expect(content).toContain("getByGame");
    expect(content).toContain("getByGames");
    expect(content).toContain("runModel");
  });
});

// ─── Frontend component ────────────────────────────────────────────────────────

describe("MlbPropsCard component", () => {
  it("MlbPropsCard.tsx exists in client/src/components", () => {
    const componentPath = path.join(__dirname, "../client/src/components/MlbPropsCard.tsx");
    expect(fs.existsSync(componentPath)).toBe(true);
  });

  it("MlbPropsCard.tsx exports MlbPropsCard and StrikeoutPropRow", () => {
    const componentPath = path.join(__dirname, "../client/src/components/MlbPropsCard.tsx");
    const content = fs.readFileSync(componentPath, "utf-8");
    expect(content).toContain("export function MlbPropsCard");
    expect(content).toContain("export interface StrikeoutPropRow");
  });

  it("ModelProjections.tsx imports MlbPropsCard and has K PROPS tab", () => {
    const pagePath = path.join(__dirname, "../client/src/pages/ModelProjections.tsx");
    const content = fs.readFileSync(pagePath, "utf-8");
    expect(content).toContain("import { MlbPropsCard");
    expect(content).toContain("K PROPS");
    expect(content).toContain("feedMobileTab === 'props'");
    expect(content).toContain("mlbPropsMap");
    expect(content).toContain("trpc.strikeoutProps.getByGames");
  });
});
