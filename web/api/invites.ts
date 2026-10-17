/** POST /api/invites {invite} → {code, owner, url}: uzun davet için kısa kod. */

import { hashOwner, newCode, newOwner } from "../lib/code.js";
import { joinUrl } from "../lib/html.js";
import { error, json, originOf, readJson } from "../lib/http.js";
import { parseInvite } from "../lib/invite.js";
import { CREATE_RULES, TTL_SECONDS, allowed, inviteKey, redis, type InviteRecord } from "../lib/store.js";

export async function POST(req: Request): Promise<Response> {
  if (!(await allowed(req, "create", CREATE_RULES))) return error("rate_limited", 429);
  const body = await readJson(req);
  const parsed = parseInvite(body?.invite);
  if (!parsed) return error("bad_invite", 400);

  const owner = newOwner();
  const record: InviteRecord = {
    invite: parsed.code,
    ownerHash: await hashOwner(owner),
    name: parsed.invite.name,
    loader: parsed.invite.loader,
    mc: parsed.invite.mcVersion,
    loaderVersion: parsed.invite.loaderVersion,
    createdAt: Date.now(),
  };
  // ~887 milyon olasılıkta çakışma çok seyrek; olursa yeni kod denenir.
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const ok = await redis().set(inviteKey(code), record, { nx: true, ex: TTL_SECONDS });
    if (ok) return json({ code, owner, url: joinUrl(originOf(req), code) }, 201);
  }
  return error("busy", 503);
}
