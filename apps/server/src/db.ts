import { PrismaClient } from "@prisma/client";

// DATABASE_URL overrides the schema's dev database (tests use a throwaway copy).
export const db = new PrismaClient(process.env.DATABASE_URL ? { datasourceUrl: process.env.DATABASE_URL } : undefined);
