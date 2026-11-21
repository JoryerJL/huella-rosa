import { env } from "./env";
import { serve } from "@hono/node-server";
import { app } from "./app";

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`Huella Rosa server on http://localhost:${info.port}`);
});
