import { Hono } from "hono";
import { logger } from "hono/logger";
import { db } from "./db";
import { valkey } from "./valkey";
import { authRoutes } from "./routes/auth";
import { auditRoutes } from "./routes/audit";

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
  .route("/api/audit", auditRoutes);

/** Type used by the web app's typed client (hono/client). */
export type AppType = typeof app;
