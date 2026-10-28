/**
 * POST /api/invites/:code/shared/act {payload, sig} (vercel.json → /api/shared-act?code=:code):
 * ortak dünyada cihazın kendi işlemleri, iroh anahtarıyla imzalı (`lib/shared.ts` `verifySigned`).
 * - state: tam durum (üyeler, nesil, kim açık).
 * - acquire: "Sen aç" — kira; en güncel nesil sende değilse `needSync`.
 * - renew {players?, maxPlayers?}: açıkken dakikada bir; davet sayfasının durumu da "açık" olur.
 * - publish {gen}: yeni nesil (oturum sonu ya da oyun sırasındaki anlık kopya).
 * - have {gen}: eşitleme bitti, bu nesil bende.
 * - release: kapattım; davet sayfası "kapalı" der.
 */

import { error, json, readJson } from "../lib/http.js";
import { OPEN_TTL_SECONDS, statusKey, type StatusUpdate } from "../lib/meta.js";
import { codeOf } from "../lib/owned.js";
import { apply, isMember, publicState, verifySigned, type Action, type SharedState, type Signed } from "../lib/shared.js";
import { SHARED_RULES, TTL_SECONDS, allowed, nonceKey, redis, sharedKey, withLock } from "../lib/store.js";

const now = () => Math.floor(Date.now() / 1000);

function action(p: Signed): Action | null {
  switch (p.action) {
    case "acquire":
    case "renew":
    case "release":
      return { kind: p.action, device: p.device };
    case "publish":
    case "have":
      return p.gen === undefined ? null : { kind: p.action, device: p.device, gen: p.gen };
    default:
      return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!(await allowed(req, "shared", SHARED_RULES))) return error("rate_limited", 429);
  const code = codeOf(req);
  if (!code) return error("not_found", 404);
  const p = await verifySigned(await readJson(req, 4096), code, now());
  if (typeof p === "string") return error(p, p === "bad_request" ? 400 : 401);
  if (!(await redis().set(nonceKey(code, p.nonce), 1, { nx: true, ex: 600 }))) return error("replayed", 401);

  const key = sharedKey(code);
  if (p.action === "state") {
    const state = await redis().get<SharedState>(key);
    if (!state) return error("not_shared", 404);
    if (!isMember(state, p.device)) return error("not_member", 403);
    return json({ shared: publicState(state, now()) });
  }
  const a = action(p);
  if (!a) return error("bad_request", 400);

  const out = await withLock(key, async () => {
    const r = apply(await redis().get<SharedState>(key), a, now());
    if (r.state && !("error" in r.result)) await redis().set(key, r.state, { ex: TTL_SECONDS });
    return r;
  });
  if (!out) return error("busy", 503);
  if ("error" in out.result) return json(out.result, out.result.error === "notShared" ? 404 : 409);

  // Davet sayfasındaki canlı durum: açık olan artık sahip değil, bu cihaz.
  if (p.action === "renew" && p.players !== undefined) {
    const status: StatusUpdate = { running: true, players: p.players, maxPlayers: p.maxPlayers ?? 0 };
    await redis().set(statusKey(code), status, { ex: OPEN_TTL_SECONDS });
  } else if (p.action === "release") {
    const status: StatusUpdate = { running: false, players: 0, maxPlayers: 0 };
    await redis().set(statusKey(code), status, { ex: TTL_SECONDS });
  }
  return json({ shared: publicState(out.state!, now()) });
}
