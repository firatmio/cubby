/** Kısa davet kodları: 6 karakter, karışan karakterler (0/O, 1/I/L) yok. */

export const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LEN = 6;
/** 31'in katı olan en büyük bayt sınırı: sapmasız seçim için üstü atılır. */
const LIMIT = 256 - (256 % ALPHABET.length);

type Fill = (bytes: Uint8Array) => Uint8Array;
const fill: Fill = (b) => crypto.getRandomValues(b);

export function newCode(random: Fill = fill): string {
  let out = "";
  while (out.length < CODE_LEN) {
    for (const b of random(new Uint8Array(16))) {
      if (b < LIMIT && out.length < CODE_LEN) out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out;
}

/** `k7m-2qx`, ` K7M 2QX ` → `K7M2QX`; geçersizse null. */
export function normalizeCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== CODE_LEN) return null;
  return [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

/** Okunur biçim: `K7M-2QX`. */
export const formatCode = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`;

/** Sahiplik anahtarı (host'ta durur) ve sunucuda tutulan özeti. */
export function newOwner(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashOwner(owner: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(owner));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
