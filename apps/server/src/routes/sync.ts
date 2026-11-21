import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  syncPushSchema,
  type OpResult,
  type PullResponse,
  type SyncChangedEvent,
  type SyncPushResponse,
} from "@er/shared";
import { applySyncOp } from "../sync";
import { requireRole, type SessionEnv } from "../session";
import { buildChangesSince, currentCursor, loadCampaignScope, parseCursor } from "../campaignPackage";
import { openChangeSubscription, publishChange } from "../changes";

const HEARTBEAT_MS = 25_000;

export const syncRoutes = new Hono<SessionEnv>()
  .post("/push", requireRole("intake"), async (c) => {
    const parsed = syncPushSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Los datos enviados no tienen el formato esperado." }, 400);
    }
    const staff = c.get("staff");
    // Sequential on purpose: ops from one device depend on each other (create patient, then visit).
    const results: OpResult[] = [];
    for (const op of parsed.data.ops) {
      results.push(await applySyncOp(op, staff));
    }
    // A CONFLICT op may still have applied its other fields, so it also counts as a change.
    if (results.some((r) => r.status === "APPLIED" || r.status === "CONFLICT")) {
      await publishChange(await currentCursor());
    }
    const response: SyncPushResponse = { results };
    return c.json(response);
  })
  // Changes made by anyone since the device's cursor, limited to the campaign's scope.
  .get("/pull", requireRole("intake"), async (c) => {
    const scope = await loadCampaignScope(c.req.query("campaignId") ?? "");
    if (!scope) return c.json({ error: "No encontramos esta jornada." }, 404);
    const since = parseCursor(c.req.query("cursor"));
    if (!since) {
      return c.json({ error: "Falta el punto de sincronización. Descarga de nuevo el paquete de jornada." }, 400);
    }
    // Read the cursor first: anything written during the query comes back on the next pull.
    const latest = await currentCursor();
    const changes = await buildChangesSince(scope, since);
    const cursor = new Date(Math.max(since.getTime(), new Date(latest).getTime())).toISOString();
    const response: PullResponse = { ...changes, cursor };
    return c.json(response);
  })
  // Server-Sent Events: "changed" with { cursor } after any push that changed data.
  .get("/events", requireRole("intake", "clinician", "admin"), (c) =>
    streamSSE(c, async (stream) => {
      const subscription = openChangeSubscription((cursor) => {
        const event: SyncChangedEvent = { cursor };
        void stream.writeSSE({ event: "changed", data: JSON.stringify(event) }).catch(() => undefined);
      });
      stream.onAbort(() => subscription.close());
      try {
        await subscription.ready;
        await stream.write(": connected\n\n");
        while (!stream.aborted) {
          await stream.sleep(HEARTBEAT_MS);
          if (!stream.aborted) await stream.write(": heartbeat\n\n");
        }
      } finally {
        await subscription.close();
      }
    }),
  );
