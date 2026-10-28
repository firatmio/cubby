/**
 * /api/invites/:code (vercel.json → /api/invite?code=:code)
 * GET → {invite, live} · PUT {owner, invite} içeriği ve süreyi tazeler · DELETE {owner} siler.
 * `live`: ortak dünyada şu an açık olan cihaz (`{device}`); arkadaşın uygulaması oraya bağlanır.
 */

import { error, json } from "../lib/http.js";
import { coverKey, statusKey, type StatusUpdate } from "../lib/meta.js";
import { codeOf, owned } from "../lib/owned.js";
import type { SharedState } from "../lib/shared.js";
import { parseInvite } from "../lib/invite.js";
import {
  LOOKUP_RULES,
  TTL_SECONDS,
  allowed,
  inviteKey,
  redis,
  sharedKey,
  type InviteRecord,
} from "../lib/store.js";

export async function GET(req: Request): Promise<Response> {
  if (!(await allowed(req, "lookup", LOOKUP_RULES))) return error("rate_limited", 429);
  const code = codeOf(req);
  if (!code) return error("not_found", 404);
  const [record, shared] = await Promise.all([
    redis().get<InviteRecord>(inviteKey(code)),
    redis().get<SharedState>(sharedKey(code)),
  ]);
  if (!record) return error("not_found", 404);
  const lease = shared?.lease && shared.lease.until > Date.now() / 1000 ? shared.lease : null;
  return json({ invite: record.invite, live: lease ? { device: lease.device } : null });
}

export async function PUT(req: Request): Promise<Response> {
  const o = await owned(req);
  if (o instanceof Response) return o;
  const parsed = parseInvite(o.body.invite);
  if (!parsed) return error("bad_invite", 400);
  const record: InviteRecord = {
    ...o.record,
    invite: parsed.code,
    name: parsed.invite.name,
    loader: parsed.invite.loader,
    mc: parsed.invite.mcVersion,
    loaderVersion: parsed.invite.loaderVersion,
  };
  await redis().set(inviteKey(o.code), record, { ex: TTL_SECONDS });
  // Kapak ve "kapalı" durumu davetle birlikte yaşar; "açık" kısa ömürlü kalır (uygulama çökerse düşsün).
  await redis().expire(coverKey(o.code), TTL_SECONDS);
  const status = await redis().get<StatusUpdate>(statusKey(o.code));
  if (status && !status.running) await redis().expire(statusKey(o.code), TTL_SECONDS);
  return json({ code: o.code });
}

export async function DELETE(req: Request): Promise<Response> {
  const o = await owned(req);
  if (o instanceof Response) return o;
  await redis().del(inviteKey(o.code), coverKey(o.code), statusKey(o.code), sharedKey(o.code));
  return json({ ok: true });
}
