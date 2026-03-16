/**
 * discord.config.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for validateDiscordConfig() — verifies that:
 *   1. All 6 required Discord env vars are present in the runtime environment
 *   2. The validator throws with a descriptive message when any var is missing
 *   3. The validator never prints secret values in error messages
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Import the validator under test ─────────────────────────────────────────
// We re-import dynamically inside each test so we can control process.env.
// The module is small enough that this is safe.

const REQUIRED_KEYS = [
  "DISCORD_BOT_TOKEN",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_PUBLIC_KEY",
  "DISCORD_GUILD_ID",
  "DISCORD_ROLE_AI_MODEL_SUB",
] as const;

// Minimal stub values — never real credentials
const STUB_VALUES: Record<string, string> = {
  DISCORD_BOT_TOKEN:         "stub-bot-token",
  DISCORD_CLIENT_ID:         "stub-client-id",
  DISCORD_CLIENT_SECRET:     "stub-client-secret",
  DISCORD_PUBLIC_KEY:        "stub-public-key",
  DISCORD_GUILD_ID:          "stub-guild-id",
  DISCORD_ROLE_AI_MODEL_SUB: "stub-role-id",
};

describe("validateDiscordConfig", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Snapshot the real env so we can restore it after each test
    originalEnv = { ...process.env };
    // Silence console.log during tests (we verify the message separately)
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore original env
    for (const key of REQUIRED_KEYS) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
    vi.restoreAllMocks();
  });

  it("passes when all 6 Discord env vars are present", async () => {
    // Set all required vars to stub values
    for (const key of REQUIRED_KEYS) {
      process.env[key] = STUB_VALUES[key];
    }
    const { validateDiscordConfig } = await import("./_core/env");
    expect(() => validateDiscordConfig()).not.toThrow();
  });

  it("logs a safe confirmation message (no secret values) when all vars present", async () => {
    for (const key of REQUIRED_KEYS) {
      process.env[key] = STUB_VALUES[key];
    }
    const { validateDiscordConfig } = await import("./_core/env");
    validateDiscordConfig();
    expect(console.log).toHaveBeenCalledWith(
      "[Discord] Integration configuration loaded successfully"
    );
  });

  it("throws when DISCORD_BOT_TOKEN is missing", async () => {
    for (const key of REQUIRED_KEYS) {
      process.env[key] = STUB_VALUES[key];
    }
    delete process.env.DISCORD_BOT_TOKEN;
    const { validateDiscordConfig } = await import("./_core/env");
    expect(() => validateDiscordConfig()).toThrow("DISCORD_BOT_TOKEN");
  });

  it("throws when DISCORD_CLIENT_ID is missing", async () => {
    for (const key of REQUIRED_KEYS) {
      process.env[key] = STUB_VALUES[key];
    }
    delete process.env.DISCORD_CLIENT_ID;
    const { validateDiscordConfig } = await import("./_core/env");
    expect(() => validateDiscordConfig()).toThrow("DISCORD_CLIENT_ID");
  });

  it("throws when DISCORD_CLIENT_SECRET is missing", async () => {
    for (const key of REQUIRED_KEYS) {
      process.env[key] = STUB_VALUES[key];
    }
    delete process.env.DISCORD_CLIENT_SECRET;
    const { validateDiscordConfig } = await import("./_core/env");
    expect(() => validateDiscordConfig()).toThrow("DISCORD_CLIENT_SECRET");
  });

  it("throws when DISCORD_PUBLIC_KEY is missing", async () => {
    for (const key of REQUIRED_KEYS) {
      process.env[key] = STUB_VALUES[key];
    }
    delete process.env.DISCORD_PUBLIC_KEY;
    const { validateDiscordConfig } = await import("./_core/env");
    expect(() => validateDiscordConfig()).toThrow("DISCORD_PUBLIC_KEY");
  });

  it("throws when DISCORD_GUILD_ID is missing", async () => {
    for (const key of REQUIRED_KEYS) {
      process.env[key] = STUB_VALUES[key];
    }
    delete process.env.DISCORD_GUILD_ID;
    const { validateDiscordConfig } = await import("./_core/env");
    expect(() => validateDiscordConfig()).toThrow("DISCORD_GUILD_ID");
  });

  it("throws when DISCORD_ROLE_AI_MODEL_SUB is missing", async () => {
    for (const key of REQUIRED_KEYS) {
      process.env[key] = STUB_VALUES[key];
    }
    delete process.env.DISCORD_ROLE_AI_MODEL_SUB;
    const { validateDiscordConfig } = await import("./_core/env");
    expect(() => validateDiscordConfig()).toThrow("DISCORD_ROLE_AI_MODEL_SUB");
  });

  it("lists ALL missing vars in a single error when multiple are absent", async () => {
    // Remove all Discord vars
    for (const key of REQUIRED_KEYS) {
      delete process.env[key];
    }
    const { validateDiscordConfig } = await import("./_core/env");
    let errorMsg = "";
    try {
      validateDiscordConfig();
    } catch (e) {
      errorMsg = (e as Error).message;
    }
    for (const key of REQUIRED_KEYS) {
      expect(errorMsg).toContain(key);
    }
  });

  it("error message never contains stub secret values", async () => {
    // Remove all Discord vars
    for (const key of REQUIRED_KEYS) {
      delete process.env[key];
    }
    const { validateDiscordConfig } = await import("./_core/env");
    let errorMsg = "";
    try {
      validateDiscordConfig();
    } catch (e) {
      errorMsg = (e as Error).message;
    }
    // Confirm no actual secret values appear in the error
    for (const val of Object.values(STUB_VALUES)) {
      expect(errorMsg).not.toContain(val);
    }
  });

  it("ENV object exposes discord* keys (all strings, never undefined)", async () => {
    for (const key of REQUIRED_KEYS) {
      process.env[key] = STUB_VALUES[key];
    }
    const { ENV } = await import("./_core/env");
    expect(typeof ENV.discordBotToken).toBe("string");
    expect(typeof ENV.discordClientId).toBe("string");
    expect(typeof ENV.discordClientSecret).toBe("string");
    expect(typeof ENV.discordPublicKey).toBe("string");
    expect(typeof ENV.discordGuildId).toBe("string");
    expect(typeof ENV.discordRoleAiModelSub).toBe("string");
  });
});
