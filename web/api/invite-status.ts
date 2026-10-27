/**
 * PUT /api/invites/:code/status {owner, running, players, maxPlayers} (vercel.json →
 * /api/invite-status?code=:code): dünyanın canlı durumu. Açıkken uygulama birkaç dakikada bir
 * tazeler; tazelenmezse durum düşer ve sayfa bir şey söylemez. Kapalı durumu davetle birlikte kalır.
 */

import { error, json } from "../lib/http.js";
import { OPEN_TTL_SECONDS, parseStatus, statusKey } from "../lib/meta.js";
import { owned } from "../lib/owned.js";
import { STATUS_RULES, TTL_SECONDS, redis } from "../lib/store.js";

export async function PUT(req: Request): Promise<Response> {
  const o = await owned(req, 4096, ["status", STATUS_RULES]);
  if (o instanceof Response) return o;
  const status = parseStatus(o.body);
  if (!status) return error("bad_status", 400);
  await redis().set(statusKey(o.code), status, { ex: status.running ? OPEN_TTL_SECONDS : TTL_SECONDS });
  return json({ ok: true });
}
