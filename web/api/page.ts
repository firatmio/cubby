/** `/` ve `/:code` (vercel.json → /api/page?code=:code): ana sayfa ve davet sayfası. */

import { normalizeCode } from "../lib/code.js";
import { homePage, invitePage, messagePage } from "../lib/html.js";
import { html, originOf } from "../lib/http.js";
import { pickLang, TEXT } from "../lib/i18n.js";
import { LOADER_LABELS } from "../lib/invite.js";
import { LOOKUP_RULES, allowed, inviteKey, redis, type InviteRecord } from "../lib/store.js";

export async function GET(req: Request): Promise<Response> {
  const lang = pickLang(req.headers.get("accept-language"));
  const t = TEXT[lang];
  const origin = originOf(req);
  const raw = new URL(req.url).searchParams.get("code");
  if (!raw) return html(homePage(lang, origin));

  const code = normalizeCode(raw);
  if (!code) return html(messagePage(lang, origin, t.notFoundTitle, t.notFoundText), 404);
  if (!(await allowed(req, "lookup", LOOKUP_RULES))) {
    return html(messagePage(lang, origin, t.notFoundTitle, t.tooMany), 429);
  }
  const record = await redis().get<InviteRecord>(inviteKey(code));
  if (!record) return html(messagePage(lang, origin, t.notFoundTitle, t.notFoundText), 404);

  const loader = LOADER_LABELS[record.loader] ?? record.loader;
  const tech =
    record.loader === "vanilla"
      ? `Minecraft ${record.mc}`
      : `${loader}${record.loaderVersion ? ` ${record.loaderVersion}` : ""} · Minecraft ${record.mc}`;
  return html(invitePage({ lang, origin, code, world: record.name, tech }));
}
