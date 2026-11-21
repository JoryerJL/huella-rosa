import { normalizePhone } from "@er/shared";

// TODO(block 2 integration): replace with `hashPhone` from @er/shared once the server worker lands it.
// Same rule as the contract: SHA-256 hex of normalizePhone(phone). Empty input has no hash.
export async function hashPhone(phone: string | null | undefined): Promise<string | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Last 4 digits for the visual check on the match card. */
export function phoneLast4(phone: string | null | undefined): string | null {
  const normalized = normalizePhone(phone);
  return normalized.length >= 4 ? normalized.slice(-4) : null;
}
