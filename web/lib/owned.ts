/** Davetin sahibi (uygulama) mi: `owner` anahtarı kayıttaki özetle karşılaştırılır. */

import { hashOwner, normalizeCode } from "./code.js";
import { error, readJson } from "./http.js";
import { WRITE_RULES, allowed, inviteKey, redis, type InviteRecord, type Window } from "./store.js";

export const codeOf = (req: Request) => normalizeCode(new URL(req.url).searchParams.get("code"));

/**
 * Kayıt ve gövde; sahibi değilse hata yanıtı. `max`: gövdenin en çok bayt sayısı; `bucket`: istek
 * sınırının adı ve kuralları (canlı durum kendi kovasında, yoksa açık dünyalar diğer yazmaları tüketir).
 */
export async function owned(
  req: Request,
  max = 4096,
  bucket: [string, [number, Window][]] = ["write", WRITE_RULES],
): Promise<{ code: string; record: InviteRecord; body: Record<string, unknown> } | Response> {
  if (!(await allowed(req, bucket[0], bucket[1]))) return error("rate_limited", 429);
  const code = codeOf(req);
  const body = await readJson(req, max);
  if (!code || !body || typeof body.owner !== "string") return error("bad_request", 400);
  const record = await redis().get<InviteRecord>(inviteKey(code));
  if (!record) return error("not_found", 404);
  if ((await hashOwner(body.owner)) !== record.ownerHash) return error("forbidden", 403);
  return { code, record, body };
}
