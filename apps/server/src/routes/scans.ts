import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { FormScan, Prisma } from "@prisma/client";
import { CLINICAL_ROLES, isClinicalRole, scanConfirmSchema, type Role, type ScanView } from "@er/shared";
import { db } from "../db";
import { writeAudit } from "../audit";
import { requireRole, type SessionEnv } from "../session";
import { getTemplate, templateIdForService, type Template } from "../templates";
import { filterForRole, sanitizeExtraction, visibleKeys, type Extraction } from "../scans/fields";
import { ocrReader } from "../scans/ocr";
import { imageStorage } from "../scans/storage";

// Form photos (SPEC 6.4, 8). The reading only proposes values; confirmed values are saved through
// the normal paths (identification -> search/registration; clinical -> UPDATE_SERVICE_FIELDS ops).
// Never log or audit field values: audits carry field names only.

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};
const STAFF: Role[] = ["intake", ...CLINICAL_ROLES];

function parseRoles(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function extractionOf(scan: FormScan, template: Template): Extraction {
  if (!scan.extracted) return {};
  try {
    return sanitizeExtraction(JSON.parse(scan.extracted), template);
  } catch {
    return {};
  }
}

export function toScanView(scan: FormScan, role: Role): ScanView {
  const template = getTemplate(scan.templateId);
  return {
    id: scan.id,
    templateId: scan.templateId,
    status: scan.status,
    visitId: scan.visitId,
    campaignId: scan.campaignId,
    folio: scan.folio,
    createdAt: scan.createdAt.toISOString(),
    imageUrl: `/api/scans/${scan.id}/image`,
    fields: template ? filterForRole(extractionOf(scan, template), template, role) : {},
    confirmedRoles: parseRoles(scan.confirmedRoles),
  };
}

/** Roles that still have read values to confirm. Intake only for "Identificar con foto" (no visit yet). */
export function rolesToConfirm(extraction: Extraction, template: Template, linkedToVisit: boolean): Role[] {
  const filled = new Set(Object.entries(extraction).filter(([, v]) => v.value.trim() !== "").map(([k]) => k));
  const roles: Role[] = [];
  if (!linkedToVisit && [...visibleKeys(template, "intake")].some((k) => filled.has(k))) roles.push("intake");
  for (const role of CLINICAL_ROLES) {
    const own = template.campos.filter((f) => f.filledBy === role && filled.has(f.clave));
    if (own.length > 0) roles.push(role);
  }
  return roles;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export const scanRoutes = new Hono<SessionEnv>()
  // Intake uploads a photo (online "Identificar con foto", or a queued "Adjuntar foto" at sync).
  .post("/", requireRole("intake"), bodyLimit({ maxSize: MAX_IMAGE_BYTES + 64 * 1024, onError: (c) => c.json({ error: "La foto es muy pesada. Toma otra." }, 413) }), async (c) => {
    const staff = c.get("staff");
    const body = await c.req.parseBody().catch(() => null);
    const image = body?.image;
    if (!body || !(image instanceof File)) return c.json({ error: "Falta la foto del formato." }, 400);
    const ext = IMAGE_TYPES[image.type];
    if (!ext) return c.json({ error: "Ese archivo no es una foto. Usa JPG o PNG." }, 400);
    if (image.size > MAX_IMAGE_BYTES) return c.json({ error: "La foto es muy pesada. Toma otra." }, 413);

    const campaignId = text(body.campaignId);
    const folio = text(body.folio);
    let visitId = text(body.visitId);
    if (!visitId && campaignId && folio) {
      visitId = (await db.visit.findFirst({ where: { campaignId, folio }, select: { id: true } }))?.id ?? null;
    }

    const template = getTemplate(templateIdForService("BREAST_REVIEW"));
    if (!template) return c.json({ error: "No encontramos la plantilla del formato." }, 500);
    const bytes = new Uint8Array(await image.arrayBuffer());
    const id = randomUUID();
    const imageRef = await imageStorage().put(`${id}.${ext}`, bytes, image.type);

    let status = "READ";
    let extracted: Extraction | null = null;
    try {
      extracted = await ocrReader()({ bytes, originalName: image.name, template });
    } catch {
      status = "FAILED"; // The photo is kept; specialists still see it and type their fields.
    }

    const scan = await db.$transaction(async (tx) => {
      const created = await tx.formScan.create({
        data: {
          id,
          imageRef,
          templateId: template.id,
          status,
          extracted: extracted ? JSON.stringify(extracted) : null,
          visitId,
          campaignId,
          folio,
          originalName: image.name.slice(0, 120),
          mimeType: image.type,
          uploadedBy: staff.id,
        },
      });
      await writeAudit(
        {
          actorId: staff.id,
          action: "SCAN_UPLOADED",
          deviceId: c.req.header("x-device-id") ?? null,
          entity: "FormScan",
          entityId: id,
          detail: `status: ${status}`,
        },
        tx,
      );
      return created;
    });
    return c.json(toScanView(scan, staff.role), 201);
  })
  // Scans of a visit (by id or campaign + folio) or by status, fields filtered by role.
  .get("/", requireRole(...STAFF), async (c) => {
    const staff = c.get("staff");
    const { visitId, campaignId, folio, status } = c.req.query();
    const or: Prisma.FormScanWhereInput[] = [];
    if (visitId) or.push({ visitId });
    if (campaignId && folio) {
      or.push({ campaignId, folio });
      const visit = await db.visit.findFirst({ where: { campaignId, folio }, select: { id: true } });
      if (visit) or.push({ visitId: visit.id });
    }
    if (or.length === 0 && !status) return c.json({ error: "Indica la visita o el estado." }, 400);
    const where: Prisma.FormScanWhereInput = { ...(or.length > 0 ? { OR: or } : {}), ...(status ? { status } : {}) };
    const scans = await db.formScan.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 });
    return c.json(scans.map((s) => toScanView(s, staff.role)));
  })
  .get("/:id", requireRole(...STAFF), async (c) => {
    const scan = await db.formScan.findUnique({ where: { id: c.req.param("id") } });
    if (!scan) return c.json({ error: "No encontramos esta foto." }, 404);
    return c.json(toScanView(scan, c.get("staff").role));
  })
  // Streams the photo to signed-in staff only; never a public URL.
  .get("/:id/image", requireRole(...STAFF), async (c) => {
    const scan = await db.formScan.findUnique({ where: { id: c.req.param("id") } });
    if (!scan) return c.json({ error: "No encontramos esta foto." }, 404);
    const stored = await imageStorage().get(scan.imageRef, scan.mimeType ?? "image/jpeg");
    if (!stored) return c.json({ error: "No encontramos esta foto." }, 404);
    return c.body(new Uint8Array(stored.bytes), 200, {
      "content-type": stored.contentType,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      // SVG samples must never run scripts on our origin.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
  })
  // The caller confirms its part (identification for intake, its own fields for a specialist).
  .post("/:id/confirm", requireRole(...STAFF), async (c) => {
    const staff = c.get("staff");
    const parsed = scanConfirmSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Los datos enviados no tienen el formato esperado." }, 400);
    const scan = await db.formScan.findUnique({ where: { id: c.req.param("id") } });
    const template = scan ? getTemplate(scan.templateId) : null;
    if (!scan || !template) return c.json({ error: "No encontramos esta foto." }, 404);
    if (staff.role !== "intake" && !isClinicalRole(staff.role)) {
      return c.json({ error: "Tu rol no tiene permiso para esta acción." }, 403);
    }
    const allowed = visibleKeys(template, staff.role);
    const fields = [...new Set(parsed.data.fields)];
    if (fields.some((f) => !allowed.has(f))) {
      return c.json({ error: "Solo puedes confirmar los datos de tu paso." }, 403);
    }

    const confirmed = new Set(parseRoles(scan.confirmedRoles));
    confirmed.add(staff.role);
    const linked = scan.visitId !== null || scan.folio !== null;
    const pending = rolesToConfirm(extractionOf(scan, template), template, linked).filter((r) => !confirmed.has(r));
    const status = scan.status === "READ" && pending.length === 0 ? "CONFIRMED" : scan.status;

    const updated = await db.$transaction(async (tx) => {
      const row = await tx.formScan.update({
        where: { id: scan.id },
        data: { confirmedRoles: JSON.stringify([...confirmed]), status },
      });
      await writeAudit(
        {
          actorId: staff.id,
          action: "SCAN_CONFIRMED",
          deviceId: c.req.header("x-device-id") ?? null,
          entity: "FormScan",
          entityId: scan.id,
          detail: fields.length > 0 ? `fields: ${fields.join(", ")}` : "fields: none",
        },
        tx,
      );
      return row;
    });
    return c.json(toScanView(updated, staff.role));
  });
