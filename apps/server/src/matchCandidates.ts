import type { Prisma } from "@prisma/client";
import { nameTokens, normalizePhone, scoreCandidate, type MatchScore, type SearchQuery } from "@er/shared";
import { db } from "./db";

// Server-side candidate lookup shared by GET /api/patients/search and duplicate detection on sync.
// A cheap DB prefilter narrows the rows; the decision is always scoreCandidate (same rules offline).

const PREFILTER_LIMIT = 500;

/** Rows that could match: same birth date, same formId, same phone tail or a shared name token. */
function prefilterWhere(query: SearchQuery): Prisma.PatientWhereInput {
  const or: Prisma.PatientWhereInput[] = [{ birthDate: query.birthDate }];
  const formId = query.formId?.trim();
  if (formId) or.push({ formId }, { formId: formId.toUpperCase() });
  const phone = normalizePhone(query.phone);
  if (phone.length >= 7) {
    const last4 = phone.slice(-4);
    or.push({ phone: { contains: last4 } }, { mobile: { contains: last4 } });
  }
  for (const token of nameTokens(query.fullName).filter((t) => t.length >= 3)) {
    or.push({ fullName: { contains: token } });
  }
  return { OR: or };
}

/**
 * Scores every prefiltered patient against the query. Linked records resolve to their main
 * record, keeping the best score per main record. Returns main record id -> score (score > 0).
 */
export async function scoreMainCandidates(
  query: SearchQuery,
  options: { client?: Prisma.TransactionClient; excludeIds?: string[] } = {},
): Promise<Map<string, MatchScore>> {
  const client = options.client ?? db;
  const exclude = new Set(options.excludeIds ?? []);
  const rows = await client.patient.findMany({
    where: prefilterWhere(query),
    select: {
      id: true,
      fullName: true,
      birthDate: true,
      formId: true,
      phone: true,
      mobile: true,
      birthState: true,
      linkedToId: true,
    },
    take: PREFILTER_LIMIT,
  });

  const best = new Map<string, MatchScore>();
  for (const row of rows) {
    const mainId = row.linkedToId ?? row.id;
    if (exclude.has(row.id) || exclude.has(mainId)) continue;
    const result = scoreCandidate(query, row);
    if (result.score <= 0) continue;
    const current = best.get(mainId);
    if (!current || result.score > current.score) best.set(mainId, result);
  }
  return best;
}
