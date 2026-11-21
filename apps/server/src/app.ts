import { Hono } from "hono";
import { logger } from "hono/logger";
import { db } from "./db";
import { valkey } from "./valkey";
import { authRoutes } from "./routes/auth";
import { auditRoutes } from "./routes/audit";
import { campaignRoutes } from "./routes/campaigns";
import { patientRoutes } from "./routes/patients";
import { syncRoutes } from "./routes/sync";
import { deviceRoutes } from "./routes/devices";
import { queueRoutes } from "./routes/queue";
// Block 3a: form photo
import { scanRoutes } from "./routes/scans";
// Block 3b: Excel import
import { importRoutes } from "./routes/imports";
// Block 4a: administration.
import { conflictRoutes, dashboardRoutes, matchRoutes } from "./routes/admin";

export const app = new Hono()
  .use(logger())
  .get("/api/health", async (c) => {
    const [dbOk, valkeyOk] = await Promise.all([
      db.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      valkey.ping().then((r) => r === "PONG").catch(() => false),
    ]);
    return c.json({ db: dbOk, valkey: valkeyOk }, dbOk && valkeyOk ? 200 : 503);
  })
  .route("/api/auth", authRoutes)
  .route("/api/audit", auditRoutes)
  .route("/api/patients", patientRoutes)
  .route("/api/campaigns", campaignRoutes)
  .route("/api/sync", syncRoutes)
  .route("/api/devices", deviceRoutes)
  .route("/api/queue", queueRoutes)
  // Block 3a: form photo
  .route("/api/scans", scanRoutes)
  // Block 3b: Excel import
  .route("/api/imports", importRoutes)
  // Block 4a: administration.
  .route("/api/matches", matchRoutes)
  .route("/api/conflicts", conflictRoutes)
  .route("/api/dashboard", dashboardRoutes);

/** Type used by the web app's typed client (hono/client). */
export type AppType = typeof app;
