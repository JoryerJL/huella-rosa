import { env } from "./env";
import { serve } from "@hono/node-server";
import { app } from "./app";
import { withWebStatics } from "./web";

// Production (SERVE_WEB=1): the same process serves the built web app next to /api.
const handler = process.env.SERVE_WEB === "1" ? withWebStatics(app) : app;

serve({ fetch: handler.fetch, port: env.port }, (info) => {
  console.log(`Huella Rosa server on http://localhost:${info.port}${process.env.SERVE_WEB === "1" ? " (with web app)" : ""}`);
});
