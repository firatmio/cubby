/**
 * Kök `/`: Cubby'nin tanıtım sitesi (`lib/site.ts`). Bilinmeyen her adres (vercel.json'daki son
 * kural → `?notfound=1`) 404 sayfası.
 */

import { notFoundPage } from "../lib/html.js";
import { html, originOf } from "../lib/http.js";
import { pickLang } from "../lib/i18n.js";
import { latestRelease } from "../lib/release.js";
import { sitePage } from "../lib/site.js";

export async function GET(req: Request): Promise<Response> {
  const lang = pickLang(req.headers.get("accept-language"));
  const origin = originOf(req);
  if (new URL(req.url).searchParams.has("notfound")) return html(notFoundPage(lang, origin), 404);
  return html(sitePage(lang, origin, await latestRelease()));
}
