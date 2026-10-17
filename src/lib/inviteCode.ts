/** Kısa davet kodları (`K7M-2QX`): Rust `short_invite.rs` ve `web/lib/code.ts` ile aynı kurallar. */

/** Karışan karakterler (0/O, 1/I/L) yok. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LEN = 6;

/** Yalnız alfabedeki karakterler, büyük harfle (yazılırken süzgeç). */
export const cleanCode = (s: string) =>
  [...s.toUpperCase()].filter((c) => CODE_ALPHABET.includes(c)).join("");

/**
 * Yapıştırılan metinden kod: `K7M-2QX`, `k7m2qx`, `…/join/K7M2QX`, `…/join?code=K7M2QX`,
 * `cubby://join?c=K7M2QX`. Bulunamazsa null.
 */
export function extractCode(text: string): string | null {
  const t = text.trim();
  const m = t.match(/\/join\/([A-Za-z0-9-]{6,7})(?:[/?#]|$)/) ?? t.match(/[?&](?:code|c)=([A-Za-z0-9-]{6,7})(?:&|#|$)/);
  const candidate = (m ? m[1] : t).replace(/[\s-]/g, "").toUpperCase();
  return candidate.length === CODE_LEN && [...candidate].every((c) => CODE_ALPHABET.includes(c)) ? candidate : null;
}

export const formatCode = (code: string) => (code.length > 3 ? `${code.slice(0, 3)}-${code.slice(3)}` : code);
