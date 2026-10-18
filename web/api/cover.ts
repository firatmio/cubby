/**
 * GET /api/cover?code=…&v=… : davetin kapağı (JPEG). Link önizlemesi ve davet sayfası kullanır.
 * `v` kapağın sürümü: değişince adres değişir, bu yüzden tarayıcıda uzun süre önbelleklenebilir. Ortak
 * önbelleğe (Vercel'in kenarı) girmez: davet silinince ya da kod yenilenince kapak da hemen gider. Kod
 * tahmini için kullanılmasın diye davet sayfasıyla aynı sınır.
 */

import { coverKey } from "../lib/meta.js";
import { codeOf } from "../lib/owned.js";
import { LOOKUP_RULES, allowed, redis } from "../lib/store.js";

export async function GET(req: Request): Promise<Response> {
  const code = codeOf(req);
  if (!code) return new Response(null, { status: 404 });
  if (!(await allowed(req, "cover", LOOKUP_RULES))) return new Response(null, { status: 429 });
  const b64 = await redis().get<string>(coverKey(code));
  if (!b64) return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  const versioned = new URL(req.url).searchParams.has("v");
  return new Response(Buffer.from(b64, "base64"), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": versioned ? "private, max-age=31536000, immutable" : "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
