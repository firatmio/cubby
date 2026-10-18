/**
 * PUT /api/invites/:code/meta {owner, host?, mods?, cover?, coverVersion?} (vercel.json →
 * /api/invite-meta?code=:code): davet sayfasının zengin bilgileri. Yalnız davetin sahibi (uygulama).
 */

import { error, json } from "../lib/http.js";
import { COVER_MAX_BYTES, coverKey, parseMeta } from "../lib/meta.js";
import { owned } from "../lib/owned.js";
import { TTL_SECONDS, inviteKey, redis, type InviteRecord } from "../lib/store.js";

/** base64 kapak (~470 KB) ve diğer alanlar. */
const BODY_MAX = Math.ceil((COVER_MAX_BYTES * 4) / 3) + 4096;

export async function PUT(req: Request): Promise<Response> {
  const o = await owned(req, BODY_MAX);
  if (o instanceof Response) return o;
  const meta = parseMeta(o.body);
  if (!meta) return error("bad_meta", 400);

  const record: InviteRecord = { ...o.record };
  if (meta.host !== undefined) record.host = meta.host;
  if (meta.mods !== undefined) record.mods = meta.mods;
  if (meta.cover === null) {
    await redis().del(coverKey(o.code));
    record.coverVersion = null;
  } else if (meta.cover) {
    await redis().set(coverKey(o.code), Buffer.from(meta.cover).toString("base64"), { ex: TTL_SECONDS });
    record.coverVersion = meta.coverVersion ?? Date.now();
  }
  await redis().set(inviteKey(o.code), record, { ex: TTL_SECONDS });
  return json({ ok: true });
}
