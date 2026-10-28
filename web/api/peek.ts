/**
 * GET /api/peek?code=… → {invite: InvitePreview}: sitedeki Katıl sayfası yazılan kodun dünyasını
 * gösterir. Kod tahmini için kullanılmasın diye davet sayfasıyla aynı sınır.
 */

import { statusLine } from "../lib/html.js";
import { error, json } from "../lib/http.js";
import { codeOf } from "../lib/owned.js";
import { loadPreview } from "../lib/preview.js";
import { LOOKUP_RULES, allowed } from "../lib/store.js";

export async function GET(req: Request): Promise<Response> {
  const code = codeOf(req);
  if (!code) return error("not_found", 404);
  if (!(await allowed(req, "lookup", LOOKUP_RULES))) return error("rate_limited", 429);
  const invite = await loadPreview(code);
  if (!invite) return error("not_found", 404);
  // Durum satırı iki dilde hazır gelir; Katıl kartı dili değişince yenisini seçer.
  const line = { tr: statusLine("tr", invite.status, invite.shared), en: statusLine("en", invite.status, invite.shared) };
  return json({ code, invite: { ...invite, line } });
}
