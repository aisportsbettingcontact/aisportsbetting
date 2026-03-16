import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startDailyPurgeSchedule } from "../dailyPurge";
import { startVsinAutoRefresh } from "../vsinAutoRefresh";
import { startNbaModelSyncScheduler } from "../nbaModelSync";
import { startModelWatcher } from "../ncaamModelWatcher";
import { startNhlModelSyncScheduler } from "../nhlModelSync";
import { startNhlGoalieWatcher } from "../nhlGoalieWatcher";
import { validateDiscordConfig } from "./env";

// ─── Global crash protection ─────────────────────────────────────────────────
// Prevent unhandled promise rejections and uncaught exceptions from killing the
// process. Log them instead so the server stays alive and serves requests.
process.on("unhandledRejection", (reason, promise) => {
  console.error("[CRASH GUARD] Unhandled promise rejection:", reason, "at:", promise);
});

process.on("uncaughtException", (err) => {
  console.error("[CRASH GUARD] Uncaught exception — server will continue:", err);
});

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  // ─── Discord configuration validation ──────────────────────────────────────
  // Runs before any server setup. Throws and halts startup if any required
  // Discord secret is missing. Never prints secret values.
  validateDiscordConfig();

  const app = express();
  const server = createServer(app);

  // Trust the first proxy (Cloudflare / Manus edge) so req.protocol reflects
  // the original HTTPS scheme and cookies are set correctly (sameSite+secure).
  app.set('trust proxy', 1);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // ─── Health check endpoint ────────────────────────────────────────────────
  // Lightweight endpoint for load balancer health probes and uptime monitoring.
  // Returns 200 immediately without hitting the DB so it never times out.
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", ts: Date.now() });
  });

  // ─── Request timeout middleware ───────────────────────────────────────────
  // Kill requests that take > 30s to prevent hanging connections from exhausting
  // the server's connection pool under load.
  app.use((req, res, next) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        console.error(`[TIMEOUT] Request timed out: ${req.method} ${req.path}`);
        res.status(503).json({ error: "Request timeout" });
      }
    }, 30_000);
    res.on("finish", () => clearTimeout(timeout));
    res.on("close", () => clearTimeout(timeout));
    next();
  });

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError: ({ error, path }) => {
        // Log server-side errors (not client errors like UNAUTHORIZED/NOT_FOUND)
        if (error.code === "INTERNAL_SERVER_ERROR") {
          console.error(`[tRPC ERROR] ${path}:`, error);
        }
      },
    })
  );

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // Start daily 6am EST game purge (removes previous day's games)
    startDailyPurgeSchedule();
    // Auto-refresh VSiN book odds every 30 minutes (6am–midnight PST)
    startVsinAutoRefresh();
    // Auto-sync NBA model projections from Google Sheet every 3 hours (9AM–midnight PST)
    startNbaModelSyncScheduler();
    // NCAAM model v9 watcher — polls every 60s, fires v9 on any game with lines but no projections
    startModelWatcher();
    // NHL model sync — runs every 30 min (9AM–9PM PST), models unmodeled NHL games
    startNhlModelSyncScheduler();
    // NHL goalie watcher — checks RotoWire every 10 min for goalie changes, re-runs model on scratch
    startNhlGoalieWatcher();
  });
}

startServer().catch(console.error);
