/**
 * Kök `/`: Cubby'nin tanıtım sitesi (`lib/site.ts`). Bilinmeyen her adres (vercel.json'daki son
 * kural → `?notfound=1`) 404 sayfası.
 */

import { notFoundPage } from "../lib/html.js";
import { html, newNonce, originOf } from "../lib/http.js";
import { langCookie, langOf } from "../lib/i18n.js";
import { latestRelease } from "../lib/release.js";
import { sitePage } from "../lib/site.js";

export async function GET(req: Request): Promise<Response> {
  const { lang, chosen } = langOf(req);
  const origin = originOf(req);
  if (new URL(req.url).searchParams.has("notfound")) return html(notFoundPage(lang, origin), 404);
  const nonce = newNonce();
  const res = html(sitePage(lang, origin, await latestRelease(), nonce), 200, nonce);
  if (chosen) res.headers.append("set-cookie", langCookie(chosen));
  return res;
}
