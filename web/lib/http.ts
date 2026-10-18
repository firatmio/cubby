/** Küçük yanıt yardımcıları. */

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export const error = (code: string, status: number) => json({ error: code }, status);

/** En çok `max` baytlık JSON gövdesi; değilse null. */
export async function readJson(req: Request, max = 4096): Promise<Record<string, unknown> | null> {
  const text = await req.text().catch(() => "");
  if (!text || text.length > max) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `nonce` verilirse yalnız o nonce'lu satır içi betik çalışır (davet sayfasının kopyala/aç betiği). */
export function html(body: string, status = 200, nonce?: string): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Önbelleğe alınmaz: yenilenen kod hemen "bulunamadı" desin, dil her istekte seçilsin.
      "cache-control": "private, no-store",
      vary: "accept-language",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; ${
        nonce ? `script-src 'nonce-${nonce}'; ` : ""
      }base-uri 'none'; form-action 'none'`,
    },
  });
}

export const originOf = (req: Request) => new URL(req.url).origin;

/** Betik için tek kullanımlık nonce. */
export const newNonce = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
