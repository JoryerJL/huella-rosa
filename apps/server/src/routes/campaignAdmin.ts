import type { Context } from "hono";
import type { Prisma } from "@prisma/client";
import {
  campaignStatus,
  createCampaignSchema,
  defaultCampaignName,
  localIsoDate,
  updateCampaignSchema,
  type CampaignListItem,
} from "@er/shared";
import { db } from "../db";
import { writeAudit } from "../audit";
import { listCampaigns } from "../campaignPackage";
import type { SessionEnv } from "../session";

// Campaign administration (SPEC 6.0): create, and edit while the campaign has not finished.

const FIELD_ERRORS: Record<string, string> = {
  name: "Escribe el nombre de la jornada.",
  municipality: "Escribe el municipio.",
  state: "Escribe el estado.",
  localityIds: "Elige las localidades de la jornada.",
  newLocalities: "Escribe el nombre de cada localidad nueva y si tiene señal.",
  date: "Escribe la fecha de inicio.",
  endDate: "Escribe la fecha de fin.",
};

class CampaignInputError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

function validationError(c: Context, issues: { path: PropertyKey[] }[]) {
  const field = String(issues[0]?.path[0] ?? "");
  return c.json({ error: FIELD_ERRORS[field] ?? "Revisa los datos de la jornada.", field }, 400);
}

function isRealDate(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

function checkDates(date: string, endDate: string) {
  if (!isRealDate(date)) throw new CampaignInputError(FIELD_ERRORS.date!);
  if (!isRealDate(endDate)) throw new CampaignInputError(FIELD_ERRORS.endDate!);
  if (endDate < date) throw new CampaignInputError("La fecha de fin no puede ser antes de la fecha de inicio.");
}

/** Existing locality ids must exist; new localities are created in the campaign's municipality. */
async function resolveLocalities(
  tx: Prisma.TransactionClient,
  localityIds: string[],
  newLocalities: { name: string; hasSignal: boolean }[],
  municipality: string,
): Promise<string[]> {
  const existing = await tx.locality.findMany({ where: { id: { in: localityIds } }, select: { id: true } });
  if (existing.length !== new Set(localityIds).size) {
    throw new CampaignInputError("Una de las localidades elegidas ya no existe. Recarga la pantalla.");
  }
  const created: string[] = [];
  for (const loc of newLocalities) {
    const row = await tx.locality.create({
      data: { id: `loc-${crypto.randomUUID()}`, name: loc.name, municipality, hasSignal: loc.hasSignal },
    });
    created.push(row.id);
  }
  const ids = [...new Set([...localityIds, ...created])];
  if (ids.length === 0) throw new CampaignInputError("Elige o agrega al menos una localidad.");
  return ids;
}

async function findItem(id: string): Promise<CampaignListItem | undefined> {
  return (await listCampaigns()).find((item) => item.id === id);
}

function fail(c: Context, error: unknown) {
  if (error instanceof CampaignInputError) return c.json({ error: error.message }, error.status);
  throw error;
}

export async function createCampaign(c: Context<SessionEnv>) {
  const parsed = createCampaignSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return validationError(c, parsed.error.issues);
  const input = parsed.data;
  const staff = c.get("staff");
  try {
    checkDates(input.date, input.endDate);
    const name = input.name?.trim() || defaultCampaignName(input.municipality, input.date);
    const id = `camp-${crypto.randomUUID()}`;
    await db.$transaction(async (tx) => {
      const localityIds = await resolveLocalities(tx, input.localityIds, input.newLocalities, input.municipality);
      await tx.campaign.create({
        data: {
          id,
          name,
          municipality: input.municipality,
          state: input.state,
          date: input.date,
          endDate: input.endDate,
          localityIds: JSON.stringify(localityIds),
          createdBy: staff.id,
        },
      });
      await writeAudit(
        {
          actorId: staff.id,
          action: "CAMPAIGN_CREATED",
          deviceId: c.req.header("x-device-id") ?? null,
          entity: "Campaign",
          entityId: id,
          detail: `localities=${localityIds.length} new=${input.newLocalities.length}`,
        },
        tx,
      );
    });
    return c.json({ campaign: await findItem(id) }, 201);
  } catch (error) {
    return fail(c, error);
  }
}

export async function updateCampaign(c: Context<SessionEnv>) {
  const parsed = updateCampaignSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return validationError(c, parsed.error.issues);
  const input = parsed.data;
  const staff = c.get("staff");
  const id = c.req.param("id")!;
  try {
    const row = await db.campaign.findUnique({ where: { id } });
    if (!row) throw new CampaignInputError("No encontramos esta jornada.", 404);
    if (campaignStatus(row.date, row.endDate, localIsoDate()) === "FINISHED") {
      throw new CampaignInputError("Esta jornada ya terminó; ya no se puede cambiar.", 409);
    }
    const date = input.date ?? row.date;
    const endDate = input.endDate ?? row.endDate;
    checkDates(date, endDate);
    const municipality = input.municipality ?? row.municipality;
    const changed = Object.keys(input).filter((k) => input[k as keyof typeof input] !== undefined);

    await db.$transaction(async (tx) => {
      const touchesLocalities = input.localityIds !== undefined || input.newLocalities !== undefined;
      const currentIds = JSON.parse(row.localityIds) as string[];
      const localityIds = touchesLocalities
        ? await resolveLocalities(tx, input.localityIds ?? currentIds, input.newLocalities ?? [], municipality)
        : currentIds;
      await tx.campaign.update({
        where: { id },
        data: {
          name: input.name ?? row.name,
          municipality,
          state: input.state ?? row.state,
          date,
          endDate,
          localityIds: JSON.stringify(localityIds),
        },
      });
      await writeAudit(
        {
          actorId: staff.id,
          action: "CAMPAIGN_UPDATED",
          deviceId: c.req.header("x-device-id") ?? null,
          entity: "Campaign",
          entityId: id,
          detail: `fields=${changed.join(",")}`,
        },
        tx,
      );
    });
    return c.json({ campaign: await findItem(id) });
  } catch (error) {
    return fail(c, error);
  }
}
