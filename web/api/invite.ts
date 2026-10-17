/**
 * /api/invites/:code (vercel.json → /api/invite?code=:code)
 * GET → {invite} · PUT {owner, invite} içeriği ve süreyi tazeler · DELETE {owner} siler.
 */

import { hashOwner, normalizeCode } from "../lib/code.js";
import { error, json, readJson } from "../lib/http.js";
import { parseInvite } from "../lib/invite.js";
import {
  LOOKUP_RULES,
  TTL_SECONDS,
  WRITE_RULES,
  allowed,
  inviteKey,
  redis,
  type InviteRecord,
} from "../lib/store.js";

const codeOf = (req: Request) => normalizeCode(new URL(req.url).searchParams.get("code"));

export async function GET(req: Request): Promise<Response> {
  if (!(await allowed(req, "lookup", LOOKUP_RULES))) return error("rate_limited", 429);
  const code = codeOf(req);
  if (!code) return error("not_found", 404);
  const record = await redis().get<InviteRecord>(inviteKey(code));
  if (!record) return error("not_found", 404);
  return json({ invite: record.invite });
}

/** Kayıt ve sahiplik; sahibi değilse hata yanıtı. */
async function owned(req: Request): Promise<{ code: string; record: InviteRecord; body: Record<string, unknown> } | Response> {
  if (!(await allowed(req, "write", WRITE_RULES))) return error("rate_limited", 429);
  const code = codeOf(req);
  const body = await readJson(req);
  if (!code || !body || typeof body.owner !== "string") return error("bad_request", 400);
  const record = await redis().get<InviteRecord>(inviteKey(code));
  if (!record) return error("not_found", 404);
  if ((await hashOwner(body.owner)) !== record.ownerHash) return error("forbidden", 403);
  return { code, record, body };
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
  return json({ code: o.code });
}

export async function DELETE(req: Request): Promise<Response> {
  const o = await owned(req);
  if (o instanceof Response) return o;
  await redis().del(inviteKey(o.code));
  return json({ ok: true });
}
