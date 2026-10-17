/**
 * Kök `/` (şimdilik kısa bir sayfa; ileride Cubby'nin tanıtım sitesi) ve bilinmeyen her adres
 * (vercel.json'daki son kural → `?notfound=1`).
 */

import { homePage, notFoundPage } from "../lib/html.js";
import { html, originOf } from "../lib/http.js";
import { pickLang } from "../lib/i18n.js";

export function GET(req: Request): Response {
  const lang = pickLang(req.headers.get("accept-language"));
  const origin = originOf(req);
  if (new URL(req.url).searchParams.has("notfound")) return html(notFoundPage(lang, origin), 404);
  return html(homePage(lang, origin));
}
