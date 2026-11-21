// PIN verifier for offline unlock (SPEC 6.8 item 1): PBKDF2-SHA-256 with a random salt.
// The PIN itself is never stored or logged; only the derived bits are kept in IndexedDB.

export const PBKDF2_ITERATIONS = 150_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

export interface PinVerifier {
  salt: string;
  pinHash: string;
}

export async function createPinVerifier(pin: string): Promise<PinVerifier> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return { salt: toBase64(salt), pinHash: toBase64(await derive(pin, salt)) };
}

export async function verifyPin(pin: string, verifier: PinVerifier): Promise<boolean> {
  const expected = fromBase64(verifier.pinHash);
  const actual = await derive(pin, fromBase64(verifier.salt));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}
