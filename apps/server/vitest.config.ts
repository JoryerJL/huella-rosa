import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setupDb.ts"],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
