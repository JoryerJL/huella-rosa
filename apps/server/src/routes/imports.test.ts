import { afterAll, describe, expect, it, vi } from "vitest";
import { createMiddleware } from "hono/factory";
import type { ImportBatchView } from "@er/shared";

// API test against the dev database (npm run db:migrate && npm run seed). The session is stubbed
// so the test does not need Valkey; role checks still run through requireRole's contract.
vi.mock("../session", () => ({
  requireRole: (...roles: string[]) =>
    createMiddleware(async (c, next) => {
      const role = c.req.header("x-test-role") ?? "";
      if (!roles.includes(role)) return c.json({ error: "Tu rol no tiene permiso para esta acción." }, 403);
      c.set("staff", { id: "usr-intake", name: "Prueba", role });
      await next();
    }),
}));

const { importRoutes } = await import("./imports");
const { db } = await import("../db");

const created: string[] = [];

function upload(csv: string, role = "intake") {
  const form = new FormData();
  form.set("file", new File([csv], "prueba.csv", { type: "text/csv" }));
  return importRoutes.request("/", { method: "POST", body: form, headers: { "x-test-role": role } });
}

afterAll(async () => {
  await db.importRow.deleteMany({ where: { batchId: { in: created } } });
  await db.auditLog.deleteMany({ where: { entityId: { in: created } } });
  await db.importBatch.deleteMany({ where: { id: { in: created } } });
  await db.$disconnect();
});

describe("POST /api/imports", () => {
  it("creates a batch of proposals and never a patient before a decision", async () => {
    const before = await db.patient.count();
    const csv = [
      "Nombre completo,Fecha de nacimiento (DD/MM/AAAA),Celular",
      "Prueba Api Uno,01/02/1991,55-0000-0071",
      "Prueba Api Dos,31/02/1990,",
      "Juana Martinez Garcia,30/07/1972,",
    ].join("\n");
    const res = await upload(csv);
    expect(res.status).toBe(201);
    const batch = (await res.json()) as ImportBatchView;
    created.push(batch.id);

    expect(batch.source).toBe("TEMPLATE");
    expect(batch.rows.map((r) => r.status)).toEqual(["NEW", "INVALID", "POSSIBLE_MATCH"]);
    expect(await db.patient.count()).toBe(before);
    const audit = await db.auditLog.findFirst({ where: { entityId: batch.id, action: "IMPORT_UPLOADED" } });
    // Counts only: no names or dates in the audit log.
    expect(audit?.detail).toBe("rows=3 new=1 possible=1 invalid=1");
  });

  it("waits for a column mapping when headers are not the template's", async () => {
    const res = await upload("NOMBRE,F. NAC,CAPTURÓ\nPrueba Api Tres,03/03/1993,Brigada\n");
    const batch = (await res.json()) as ImportBatchView;
    created.push(batch.id);
    expect(batch.needsMapping).toBe(true);
    expect(batch.rows).toEqual([]);
    expect(batch.mapping.columns.map((c) => c.suggested)).toEqual(["fullName", "birthDate", null]);
  });

  it("refuses roles other than intake", async () => {
    const res = await upload("a\n1\n", "doctor");
    expect(res.status).toBe(403);
  });
});
