import { hashPhone as sharedHashPhone, normalizePhone } from "@er/shared";

// Uses the shared rule so device-side hashes match the server's campaign package exactly.
// Returns null when the phone is too short to hash.
export async function hashPhone(phone: string | null | undefined): Promise<string | null> {
  const hash = await sharedHashPhone(phone);
  return hash || null;
}

/** Last 4 digits for the visual check on the match card. */
export function phoneLast4(phone: string | null | undefined): string | null {
  const normalized = normalizePhone(phone);
  return normalized.length >= 4 ? normalized.slice(-4) : null;
}
