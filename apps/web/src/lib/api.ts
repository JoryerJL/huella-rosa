import { hc } from "hono/client";
import type { AppType } from "@er/server/src/app";
import { getDeviceId } from "./device";

// Typed client: route and payload types come straight from the Hono server.
export const api = hc<AppType>("/", {
  headers: () => ({ "x-device-id": getDeviceId() }),
  init: { credentials: "include" },
});
