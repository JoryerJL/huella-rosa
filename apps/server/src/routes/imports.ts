import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  importMappingSchema,
  importRowDecisionSchema,
  type ImportBatchList,
  type ImportRegisterNewResponse,
} from "@er/shared";
import { requireRole, type SessionEnv } from "../session";
import { decodeCsv, parseCsv } from "../imports/csv";
import { buildTemplateXlsx, readXlsx, XLSX_MIME } from "../imports/xlsx";
import {
  confirmMapping,
  createBatchFromTable,
  decideRow,
  getBatchView,
  ImportError,
  listBatches,
  registerAllNew,
} from "../imports/service";

// Excel/CSV import (SPEC 6.7, 8). Intake only; online only. A batch proposes, a person decides.

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const TOO_BIG = "El archivo pesa más de 2 MB. Divídelo en varios archivos.";

const deviceIdOf = (header: string | undefined) => header?.slice(0, 64) ?? null;

function isZip(bytes: Uint8Array) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK": .xlsx is a zip file
}

/** Reads an uploaded .xlsx or .csv into rows of text cells. */
async function readUpload(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (name.endsWith(".xlsx")) {
    if (!isZip(bytes)) throw new ImportError("Este archivo no es un Excel válido. Guárdalo de nuevo como .xlsx.");
    try {
      return await readXlsx(bytes);
    } catch {
      throw new ImportError("No pudimos abrir este Excel. Guárdalo de nuevo como .xlsx e intenta otra vez.");
    }
  }
  if (name.endsWith(".csv")) return parseCsv(decodeCsv(bytes));
  throw new ImportError("Sube un archivo de Excel (.xlsx) o CSV (.csv).");
}

export const importRoutes = new Hono<SessionEnv>()
  .use(requireRole("intake"))
  .onError((error, c) => {
    if (error instanceof ImportError) return c.json({ error: error.message }, error.status);
    throw error;
  })
  .get("/template", async (c) => {
    const body = await buildTemplateXlsx();
    return c.body(new Uint8Array(body), 200, {
      "content-type": XLSX_MIME,
      "content-disposition": 'attachment; filename="plantilla-huella-rosa.xlsx"',
    });
  })
  .get("/", async (c) => {
    const response: ImportBatchList = { batches: await listBatches() };
    return c.json(response);
  })
  .post(
    "/",
    bodyLimit({ maxSize: MAX_IMPORT_BYTES + 64 * 1024, onError: (c) => c.json({ error: TOO_BIG }, 413) }),
    async (c) => {
      const form = await c.req.parseBody().catch(() => null);
      const file = form?.file;
      if (!(file instanceof File)) return c.json({ error: "Elige un archivo para subir." }, 400);
      if (file.size > MAX_IMPORT_BYTES) return c.json({ error: TOO_BIG }, 413);
      const table = await readUpload(file);
      const batch = await createBatchFromTable({
        table,
        fileName: file.name.slice(0, 200),
        staff: c.get("staff"),
        deviceId: deviceIdOf(c.req.header("x-device-id")),
      });
      return c.json(batch, 201);
    },
  )
  .get("/:id", async (c) => c.json(await getBatchView(c.req.param("id"))))
  .post("/:id/mapping", async (c) => {
    const parsed = importMappingSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Las columnas enviadas no tienen el formato esperado." }, 400);
    const batch = await confirmMapping(
      c.req.param("id"),
      parsed.data.columns,
      c.get("staff"),
      deviceIdOf(c.req.header("x-device-id")),
    );
    return c.json(batch);
  })
  .post("/:id/register-new", async (c) => {
    const result: ImportRegisterNewResponse = await registerAllNew(c.req.param("id"), {
      staff: c.get("staff"),
      deviceId: deviceIdOf(c.req.header("x-device-id")),
    });
    return c.json(result);
  })
  .post("/:id/rows/:rowId", async (c) => {
    const parsed = importRowDecisionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "La decisión enviada no tiene el formato esperado." }, 400);
    const batch = await decideRow(c.req.param("id"), c.req.param("rowId"), parsed.data, {
      staff: c.get("staff"),
      deviceId: deviceIdOf(c.req.header("x-device-id")),
    });
    return c.json(batch);
  });
