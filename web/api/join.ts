/**
 * Davet sayfası: `/join/:code` ve `/join?code=` (vercel.json → /api/join). Kodsuz `/join` sitedeki
 * Katıl sayfasına gider (kod orada yazılır).
 */

import { normalizeCode } from "../lib/code.js";
import { invitePage, messagePage } from "../lib/html.js";
import { html, newNonce, originOf } from "../lib/http.js";
import { langOf, TEXT } from "../lib/i18n.js";
import { loadPreview } from "../lib/preview.js";
import { formatSize, latestRelease } from "../lib/release.js";
import { LOOKUP_RULES, allowed } from "../lib/store.js";

export async function GET(req: Request): Promise<Response> {
  const { lang } = langOf(req);
  const t = TEXT[lang];
  const origin = originOf(req);
  const raw = new URL(req.url).searchParams.get("code");
  if (!raw?.trim()) return new Response(null, { status: 302, headers: { location: "/#join", "cache-control": "no-store" } });
  const code = normalizeCode(raw);
  if (!code) return html(messagePage(lang, origin, t.notFoundTitle, t.badCodeText, true), 404);
  if (!(await allowed(req, "lookup", LOOKUP_RULES))) {
    return html(messagePage(lang, origin, t.notFoundTitle, t.tooMany), 429);
  }
  const [preview, release] = await Promise.all([loadPreview(code), latestRelease()]);
  if (!preview) return html(messagePage(lang, origin, t.notFoundTitle, t.notFoundText, true), 404);

  const nonce = newNonce();
  return html(
    invitePage({
      lang,
      origin,
      code,
      ...preview,
      downloadSize: release ? formatSize(release.size) : "",
      nonce,
    }),
    200,
    nonce,
  );
}
