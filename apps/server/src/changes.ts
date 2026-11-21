import { valkey } from "./valkey";

// Live change notifications over Valkey pub/sub. Only a cursor travels: never patient data.
// Devices that hear about a change call GET /api/sync/pull with their own cursor and role checks.

export const CHANGES_CHANNEL = "sync:changes";

/** Best effort: a missed event is recovered by the next pull, so Valkey errors never fail a push. */
export async function publishChange(cursor: string) {
  await valkey.publish(CHANGES_CHANNEL, cursor).catch(() => undefined);
}

/**
 * Opens a dedicated subscriber connection (a connection in SUBSCRIBE mode cannot run other
 * commands, so the shared client is never used for it). `close` is idempotent.
 */
export function openChangeSubscription(onCursor: (cursor: string) => void) {
  const subscriber = valkey.duplicate();
  let closed = false;
  subscriber.on("message", (channel: string, message: string) => {
    if (channel === CHANGES_CHANNEL && !closed) onCursor(message);
  });
  // Without a listener, connection errors would crash the process.
  subscriber.on("error", () => undefined);
  const ready = subscriber.subscribe(CHANGES_CHANNEL).then(() => undefined);
  const close = async () => {
    if (closed) return;
    closed = true;
    await subscriber.unsubscribe(CHANGES_CHANNEL).catch(() => undefined);
    subscriber.disconnect();
  };
  return { ready, close };
}
