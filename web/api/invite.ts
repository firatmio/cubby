/**
 * /api/invites/:code (vercel.json → /api/invite?code=:code)
 * GET → {invite} · PUT {owner, invite} içeriği ve süreyi tazeler · DELETE {owner} siler.
 */

import { error, json } from "../lib/http.js";
import { coverKey, statusKey } from "../lib/meta.js";
import { codeOf, owned } from "../lib/owned.js";
import { parseInvite } from "../lib/invite.js";
import {
  LOOKUP_RULES,
  TTL_SECONDS,
  allowed,
  inviteKey,
  redis,
  type InviteRecord,
} from "../lib/store.js";

export async function GET(req: Request): Promise<Response> {
  if (!(await allowed(req, "lookup", LOOKUP_RULES))) return error("rate_limited", 429);
  const code = codeOf(req);
  if (!code) return error("not_found", 404);
  const record = await redis().get<InviteRecord>(inviteKey(code));
  if (!record) return error("not_found", 404);
  return json({ invite: record.invite });
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
  // Kapak davetle birlikte yaşar.
  await redis().expire(coverKey(o.code), TTL_SECONDS);
  return json({ code: o.code });
}

export async function DELETE(req: Request): Promise<Response> {
  const o = await owned(req);
  if (o instanceof Response) return o;
  await redis().del(inviteKey(o.code), coverKey(o.code), statusKey(o.code));
  return json({ ok: true });
}
