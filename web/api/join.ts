/** Davet sayfası: `/join/:code` ve `/join?code=` (vercel.json → /api/join). */

import { normalizeCode } from "../lib/code.js";
import { invitePage, messagePage } from "../lib/html.js";
import { html, newNonce, originOf } from "../lib/http.js";
import { langOf, TEXT } from "../lib/i18n.js";
import { LOADER_LABELS } from "../lib/invite.js";
import { statusKey, statusView, type StatusUpdate } from "../lib/meta.js";
import { formatSize, latestRelease } from "../lib/release.js";
import { LOOKUP_RULES, allowed, inviteKey, redis, type InviteRecord } from "../lib/store.js";

export async function GET(req: Request): Promise<Response> {
  const { lang } = langOf(req);
  const t = TEXT[lang];
  const origin = originOf(req);
  const code = normalizeCode(new URL(req.url).searchParams.get("code"));
  if (!code) return html(messagePage(lang, origin, t.notFoundTitle, t.notFoundText), 404);
  if (!(await allowed(req, "lookup", LOOKUP_RULES))) {
    return html(messagePage(lang, origin, t.notFoundTitle, t.tooMany), 429);
  }
  const [record, status, release] = await Promise.all([
    redis().get<InviteRecord>(inviteKey(code)),
    redis().get<StatusUpdate>(statusKey(code)),
    latestRelease(),
  ]);
  if (!record) return html(messagePage(lang, origin, t.notFoundTitle, t.notFoundText), 404);

  const loader = LOADER_LABELS[record.loader] ?? record.loader;
  const tech =
    record.loader === "vanilla"
      ? `Minecraft ${record.mc}`
      : `${loader}${record.loaderVersion ? ` ${record.loaderVersion}` : ""} · Minecraft ${record.mc}`;
  const nonce = newNonce();
  return html(
    invitePage({
      lang,
      origin,
      code,
      world: record.name,
      tech,
      host: record.host ?? null,
      cover: record.coverVersion ? `/api/cover?code=${code}&v=${record.coverVersion}` : null,
      status: statusView(status),
      mods: record.mods ?? 0,
      downloadSize: release ? formatSize(release.size) : "",
      nonce,
    }),
    200,
    nonce,
  );
}
