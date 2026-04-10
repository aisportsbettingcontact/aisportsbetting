/**
 * discordSecurityAlert.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Posts structured Discord embeds to the 🗒️-𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬-𝗘𝗩𝗘𝗡𝗧𝗦 channel
 * (ID: 1492280227567501403) from the bot (ID: 1483226227056574590).
 *
 * Three event types are supported:
 *   • CSRF_BLOCK  — Origin header mismatch on a tRPC mutation (red embed)
 *   • RATE_LIMIT  — Express rate limiter triggered (orange embed)
 *   • AUTH_FAIL   — Login attempt rejected (yellow embed)
 *
 * Design principles:
 *   1. FIRE-AND-FORGET — never awaited at call sites; never blocks the HTTP response.
 *   2. ZERO NOISE — only posts when the bot client is ready; silently skips otherwise.
 *   3. STRUCTURED LOGGING — every step emits a labeled console line so the server
 *      log is independently interpretable without opening Discord.
 *   4. DEDUP GUARD — in-memory cooldown per (eventType + IP) to prevent embed floods
 *      when a single attacker hammers an endpoint. Default: 30 s per event type per IP.
 *   5. GRACEFUL FAILURE — all errors are caught and logged; never propagate.
 *
 * ─── Embed color palette ─────────────────────────────────────────────────────
 *   CSRF_BLOCK  → 0xED4245  (Discord danger red)
 *   RATE_LIMIT  → 0xFEE75C  (Discord warning yellow)
 *   AUTH_FAIL   → 0xEB6C33  (Discord orange)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { EmbedBuilder, TextChannel } from "discord.js";
import { getDiscordClient } from "./bot";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Target channel: 🗒️-𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬-𝗘𝗩𝗘𝗡𝗧𝗦 */
const SECURITY_CHANNEL_ID = "1492280227567501403";

/** In-memory cooldown: at most 1 Discord post per (eventType + IP) per window */
const DISCORD_ALERT_DEDUP_MS = 30_000; // 30 seconds
const alertLastPosted = new Map<string, number>(); // key → timestamp

// ─── Embed color palette ──────────────────────────────────────────────────────
const EMBED_COLORS = {
  CSRF_BLOCK: 0xed4245,  // Discord danger red
  RATE_LIMIT: 0xfee75c,  // Discord warning yellow
  AUTH_FAIL:  0xeb6c33,  // Discord orange
} as const;

// ─── Emoji prefixes ───────────────────────────────────────────────────────────
const EMBED_EMOJI = {
  CSRF_BLOCK: "🚫",
  RATE_LIMIT: "⚡",
  AUTH_FAIL:  "🔐",
} as const;

// ─── Event type union ─────────────────────────────────────────────────────────
export type SecurityEventType = "CSRF_BLOCK" | "RATE_LIMIT" | "AUTH_FAIL";

// ─── Payload interface ────────────────────────────────────────────────────────
export interface SecurityAlertPayload {
  /** One of the three tracked event types */
  eventType: SecurityEventType;
  /** Client IP (may be "unknown") */
  ip: string;
  /** Origin header value (CSRF_BLOCK only; null for others) */
  blockedOrigin?: string | null;
  /** tRPC procedure path or Express route path */
  path: string;
  /** HTTP method (GET / POST / etc.) */
  method: string;
  /** User-Agent string (truncated to 120 chars for display) */
  userAgent?: string | null;
  /** Contextual label: limiter type for RATE_LIMIT, failure reason for AUTH_FAIL */
  context?: string | null;
  /** Epoch ms when the event occurred */
  occurredAt: number;
}

// ─── Dedup helper ─────────────────────────────────────────────────────────────
/**
 * Returns true if an alert for this (eventType, ip) was already posted within
 * the cooldown window. Also prunes stale entries to prevent unbounded growth.
 */
function isDeduplicated(eventType: SecurityEventType, ip: string): boolean {
  const now = Date.now();
  const key = `${eventType}:${ip}`;

  // Prune stale entries (max 2000 entries before forced prune)
  if (alertLastPosted.size > 2000) {
    const cutoff = now - DISCORD_ALERT_DEDUP_MS;
    Array.from(alertLastPosted.entries()).forEach(([k, ts]) => {
      if (ts < cutoff) alertLastPosted.delete(k);
    });
  }

  const lastSent = alertLastPosted.get(key) ?? 0;
  if (now - lastSent < DISCORD_ALERT_DEDUP_MS) {
    const remaining = Math.ceil((DISCORD_ALERT_DEDUP_MS - (now - lastSent)) / 1000);
    console.log(
      `[DiscordSecurity][DEDUP] Skipping ${eventType} alert for IP=${ip}` +
      ` — cooldown active (${remaining}s remaining)`
    );
    return true;
  }

  alertLastPosted.set(key, now);
  return false;
}

// ─── Timestamp formatter ──────────────────────────────────────────────────────
/**
 * Formats an epoch-ms timestamp as a human-readable EST string.
 * Example: "Apr 10, 2026 · 14:32:07 EST"
 */
function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }) + " EST";
}

// ─── Embed builders ───────────────────────────────────────────────────────────

function buildCsrfBlockEmbed(p: SecurityAlertPayload): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.CSRF_BLOCK)
    .setTitle("🚫 CSRF BLOCK — Origin Mismatch Detected")
    .setDescription(
      "A tRPC mutation was rejected because the `Origin` header did not match " +
      "any allowed origin. This may indicate a cross-site request forgery attempt, " +
      "a misconfigured client, or a subdomain takeover probe."
    )
    .addFields(
      { name: "🌐 Blocked Origin",  value: `\`${p.blockedOrigin ?? "none"}\``,        inline: true  },
      { name: "🔗 tRPC Path",       value: `\`${p.path}\``,                           inline: true  },
      { name: "📡 HTTP Method",     value: `\`${p.method}\``,                         inline: true  },
      { name: "🖥️ Client IP",       value: `\`${p.ip}\``,                             inline: true  },
      { name: "🕐 Timestamp (EST)", value: formatTimestamp(p.occurredAt),             inline: true  },
      {
        name: "🔍 User-Agent",
        value: `\`${(p.userAgent ?? "none").substring(0, 120)}\``,
        inline: false,
      },
      {
        name: "⚠️ Recommended Action",
        value:
          "Review server logs for additional requests from this IP. " +
          "If legitimate, add the origin to `PUBLIC_ORIGIN`. " +
          "If malicious, block at the firewall/CDN level.",
        inline: false,
      }
    )
    .setFooter({ text: "AI Sports Betting · Security Monitor · CSRF_BLOCK" })
    .setTimestamp(p.occurredAt);
}

function buildRateLimitEmbed(p: SecurityAlertPayload): EmbedBuilder {
  const limiterLabel: Record<string, string> = {
    global:    "Global (200 req/min)",
    auth:      "Auth (5 attempts/15 min)",
    trpc_auth: "tRPC Auth (5 attempts/15 min)",
  };
  const limiterDisplay = limiterLabel[p.context ?? ""] ?? (p.context ?? "unknown");

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.RATE_LIMIT)
    .setTitle("⚡ RATE LIMIT — Request Threshold Exceeded")
    .setDescription(
      "An IP address has exceeded the allowed request rate and received a `429 Too Many Requests` " +
      "response. Repeated triggers from the same IP may indicate a brute-force or scraping attempt."
    )
    .addFields(
      { name: "🛡️ Limiter Type",    value: `\`${limiterDisplay}\``,                  inline: true  },
      { name: "🔗 Route / Path",    value: `\`${p.path}\``,                           inline: true  },
      { name: "📡 HTTP Method",     value: `\`${p.method}\``,                         inline: true  },
      { name: "🖥️ Client IP",       value: `\`${p.ip}\``,                             inline: true  },
      { name: "🕐 Timestamp (EST)", value: formatTimestamp(p.occurredAt),             inline: true  },
      {
        name: "🔍 User-Agent",
        value: `\`${(p.userAgent ?? "none").substring(0, 120)}\``,
        inline: false,
      }
    )
    .setFooter({ text: "AI Sports Betting · Security Monitor · RATE_LIMIT" })
    .setTimestamp(p.occurredAt);
}

function buildAuthFailEmbed(p: SecurityAlertPayload): EmbedBuilder {
  const reasonLabel: Record<string, string> = {
    user_not_found:          "User Not Found",
    account_access_disabled: "Account Access Disabled",
    account_expired:         "Account Expired",
    invalid_password:        "Invalid Password",
  };
  const reasonDisplay = reasonLabel[p.context ?? ""] ?? (p.context ?? "unknown");

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.AUTH_FAIL)
    .setTitle("🔐 AUTH FAIL — Login Attempt Rejected")
    .setDescription(
      "A login attempt was rejected by the authentication system. " +
      "Multiple failures from the same IP may indicate a credential stuffing or brute-force attack."
    )
    .addFields(
      { name: "❌ Failure Reason",  value: `\`${reasonDisplay}\``,                   inline: true  },
      { name: "🔗 Procedure",       value: `\`${p.path}\``,                           inline: true  },
      { name: "📡 HTTP Method",     value: `\`${p.method}\``,                         inline: true  },
      { name: "🖥️ Client IP",       value: `\`${p.ip}\``,                             inline: true  },
      { name: "🕐 Timestamp (EST)", value: formatTimestamp(p.occurredAt),             inline: true  },
      {
        name: "🔍 User-Agent",
        value: `\`${(p.userAgent ?? "none").substring(0, 120)}\``,
        inline: false,
      }
    )
    .setFooter({ text: "AI Sports Betting · Security Monitor · AUTH_FAIL" })
    .setTimestamp(p.occurredAt);
}

// ─── Embed dispatcher ─────────────────────────────────────────────────────────
function buildEmbed(p: SecurityAlertPayload): EmbedBuilder {
  switch (p.eventType) {
    case "CSRF_BLOCK":  return buildCsrfBlockEmbed(p);
    case "RATE_LIMIT":  return buildRateLimitEmbed(p);
    case "AUTH_FAIL":   return buildAuthFailEmbed(p);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Posts a structured security embed to the 🗒️-𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬-𝗘𝗩𝗘𝗡𝗧𝗦 channel.
 *
 * MUST be called as fire-and-forget:
 *   postSecurityAlert({ ... }).catch(() => {});
 *
 * Never awaited at call sites — the HTTP response is always sent first.
 */
export async function postSecurityAlert(payload: SecurityAlertPayload): Promise<void> {
  const tag = `[DiscordSecurity][${payload.eventType}]`;

  // [STEP] Validate bot client is available
  const client = getDiscordClient();
  if (!client) {
    console.log(`${tag} Bot client not available — skipping Discord alert | IP=${payload.ip}`);
    return;
  }
  if (!client.isReady()) {
    console.log(`${tag} Bot client not ready — skipping Discord alert | IP=${payload.ip}`);
    return;
  }

  // [STEP] Deduplication check
  if (isDeduplicated(payload.eventType, payload.ip)) return;

  // [STEP] Log the alert attempt
  console.log(
    `${tag} Posting security alert to channel ${SECURITY_CHANNEL_ID}` +
    ` | IP=${payload.ip}` +
    ` path="${payload.path}"` +
    ` method=${payload.method}` +
    (payload.blockedOrigin ? ` blockedOrigin="${payload.blockedOrigin}"` : "") +
    (payload.context ? ` context="${payload.context}"` : "") +
    ` occurredAt=${formatTimestamp(payload.occurredAt)}`
  );

  // [STEP] Fetch the target channel
  let channel: TextChannel;
  try {
    const rawChannel = await client.channels.fetch(SECURITY_CHANNEL_ID);
    if (!rawChannel || !(rawChannel instanceof TextChannel)) {
      console.error(
        `${tag} Channel ${SECURITY_CHANNEL_ID} is not a TextChannel or could not be fetched` +
        ` | IP=${payload.ip}`
      );
      return;
    }
    channel = rawChannel;
    console.log(
      `${tag} Channel resolved: #${channel.name} in ${channel.guild?.name ?? "unknown"}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `${tag} Failed to fetch channel ${SECURITY_CHANNEL_ID}: ${msg} | IP=${payload.ip}`
    );
    return;
  }

  // [STEP] Build and send the embed
  const embed = buildEmbed(payload);
  try {
    await channel.send({ embeds: [embed] });
    console.log(
      `${tag} [OUTPUT] Alert posted successfully` +
      ` | IP=${payload.ip}` +
      ` channel=#${channel.name}` +
      ` eventType=${payload.eventType}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `${tag} Failed to send embed to channel ${SECURITY_CHANNEL_ID}: ${msg}` +
      ` | IP=${payload.ip}`
    );
  }
}
