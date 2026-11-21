import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

// Each test file gets a fresh SQLite database outside the worktree: migrations + demo seed.
const serverDir = fileURLToPath(new URL("..", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "huella-server-test-"));
const url = `file:${join(dir, "test.db")}`;
process.env.DATABASE_URL = url;

const migrationsDir = join(serverDir, "prisma", "migrations");
const client = new PrismaClient({ datasourceUrl: url });
for (const name of readdirSync(migrationsDir).filter((n) => /^\d+_/.test(n)).sort()) {
  const sql = readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");
  for (const statement of sql.split(/;\s*\n/)) {
    if (statement.replace(/--.*$/gm, "").trim()) await client.$executeRawUnsafe(statement);
  }
}
await client.$disconnect();
execFileSync("npx", ["tsx", "prisma/seed.ts"], { cwd: serverDir, env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
