import { fileURLToPath } from "node:url";

// Load the repository-level .env if it exists (Node >= 21.7). Real environment variables win.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch {
  // No .env file: defaults below are enough for local development.
}

export const env = {
  port: Number(process.env.PORT ?? 3001),
  valkeyUrl: process.env.VALKEY_URL ?? "redis://localhost:6379",
  isProduction: process.env.NODE_ENV === "production",
};
