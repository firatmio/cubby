/**
 * Ortak dünyanın grubu; yalnız davetin sahibi (uygulama, `owner` anahtarıyla):
 * - PUT /api/invites/:code/shared {owner, members}: ortak dünyayı açar (yoksa) ve üyeleri yazar.
 * - DELETE … {owner}: ortak dünyayı kapatır.
 * - POST /api/invites/:code/shared/force {owner}: en güncel hâli kalan cihaz dönmüyorsa beklemeyi
 *   kaldırır; o cihazın son ilerlemesinden vazgeçilir.
 * (vercel.json → /api/shared?code=:code[&op=force])
 */

import { error, json } from "../lib/http.js";
import { parseInvite } from "../lib/invite.js";
import { owned } from "../lib/owned.js";
import { apply, parseMembers, publicState, type Action, type SharedState } from "../lib/shared.js";
import { TTL_SECONDS, redis, sharedKey, withLock } from "../lib/store.js";

const now = () => Math.floor(Date.now() / 1000);

async function run(code: string, actions: Action[]): Promise<Response> {
  const key = sharedKey(code);
  const out = await withLock(key, async () => {
    let state = await redis().get<SharedState>(key);
    for (const a of actions) {
      const r = apply(state, a, now());
      if ("error" in r.result) return r.result;
      state = r.state;
    }
    if (state) await redis().set(key, state, { ex: TTL_SECONDS });
    return state;
  });
  if (out === null) return error("busy", 503);
  if ("error" in out) return json(out, 409);
  return json({ shared: publicState(out, now()) });
}

export async function PUT(req: Request): Promise<Response> {
  const o = await owned(req, 8192);
  if (o instanceof Response) return o;
  const owner = parseInvite(o.record.invite)?.invite.host;
  if (!owner) return error("bad_invite", 400);
  const members = parseMembers(o.body.members ?? [], owner);
  if (!members) return error("bad_members", 400);
  return run(o.code, [
    { kind: "enable", owner },
    { kind: "members", members },
  ]);
}

export async function POST(req: Request): Promise<Response> {
  if (new URL(req.url).searchParams.get("op") !== "force") return error("not_found", 404);
  const o = await owned(req);
  if (o instanceof Response) return o;
  return run(o.code, [{ kind: "force" }]);
}

export async function DELETE(req: Request): Promise<Response> {
  const o = await owned(req);
  if (o instanceof Response) return o;
  await redis().del(sharedKey(o.code));
  return json({ ok: true });
}
