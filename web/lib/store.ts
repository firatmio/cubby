/** Upstash Redis: davet kayıtları ve IP başına hız sınırları. */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { Invite } from "./invite.js";

/** Kullanılmayan davet bu kadar sonra silinir; host dünyayı açınca ya da daveti görünce tazelenir. */
export const TTL_SECONDS = 60 * 24 * 60 * 60;

export interface InviteRecord {
  /** Uygulamanın uzun davet kodu. */
  invite: string;
  ownerHash: string;
  name: string;
  loader: Invite["loader"];
  mc: string;
  loaderVersion: string | null;
  createdAt: number;
  /** Davet edenin oyundaki adı (uygulama `meta` ile gönderir). */
  host?: string | null;
  /** Kapak sürümü; kapak `cover:<code>`'da. */
  coverVersion?: number | null;
  /** Oyuncuda gereken mod sayısı. */
  mods?: number;
}

let client: Redis | null = null;

/** Vercel Marketplace (`KV_*`) ya da doğrudan Upstash (`UPSTASH_*`) değişkenleri. */
export function redis(): Redis {
  if (client) return client;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Redis is not configured");
  client = new Redis({ url, token });
  return client;
}

export const inviteKey = (code: string) => `inv:${code}`;

type Window = `${number} ${"s" | "m" | "h" | "d"}`;
const limiters = new Map<string, Ratelimit>();

function limiter(name: string, tokens: number, window: Window): Ratelimit {
  const key = `${name}:${tokens}:${window}`;
  let l = limiters.get(key);
  if (!l) {
    l = new Ratelimit({ redis: redis(), limiter: Ratelimit.slidingWindow(tokens, window), prefix: `rl:${name}` });
    limiters.set(key, l);
  }
  return l;
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/** Sınırlardan biri aşıldıysa false. */
export async function allowed(req: Request, name: string, rules: [number, Window][]): Promise<boolean> {
  const ip = clientIp(req);
  for (const [tokens, window] of rules) {
    const { success } = await limiter(name, tokens, window).limit(ip);
    if (!success) return false;
  }
  return true;
}

/** Kod bakışı (API ve sayfa ortak): tahmin denemesini anlamsız kılan sınır. */
export const LOOKUP_RULES: [number, Window][] = [
  [30, "1 m"],
  [300, "1 d"],
];
export const CREATE_RULES: [number, Window][] = [[20, "1 h"]];
export const WRITE_RULES: [number, Window][] = [[60, "1 h"]];
