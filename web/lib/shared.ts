/**
 * Ortak dünya: dünyayı kimler açabilir (grup), en güncel hâli hangi nesil ve kimde (nesil), şu an kim
 * açık (kira). Web sunucusu hakemdir; kurallar burada, Redis'siz bir saf fonksiyonda (`apply`).
 *
 * Cihaz kimliği iroh `EndpointId`: 64 haneli küçük harf hex, Ed25519 açık anahtarı. Grubu sahip yönetir
 * (davetin `owner` anahtarıyla); kira ve nesil işlemlerini cihaz kendisi, imzalı istekle yapar.
 */

import { cleanHost } from "./meta.js";

/** Açık olan cihaz bu kadar tazelemezse kira düşer (uygulama çöktü, internet gitti). */
export const LEASE_SECONDS = 180;
/** Sahip hariç en çok bu kadar üye. */
export const MAX_MEMBERS = 16;
/** İmzalı isteğin saati bu kadar saparsa reddedilir. */
export const MAX_SKEW_SECONDS = 300;

export interface Member {
  device: string;
  name: string;
}

export interface Lease {
  device: string;
  gen: number;
  /** Unix saniye. */
  until: number;
}

export interface SharedState {
  /** Sahibin cihazı (uzun davetin `host` alanı). */
  owner: string;
  /** Sahip hariç, dünyayı açabilen arkadaşlar. */
  members: Member[];
  /** En güncel nesil. */
  gen: number;
  /** Cihaz → elindeki nesil. */
  holders: Record<string, number>;
  lease: Lease | null;
  /**
   * Kirası temiz bırakılmadan düşen cihaz: en güncel hâl onda olabilir, o dönene kadar başkası açamaz.
   * Sahip `force` ile kaldırabilir.
   */
  dirty: string | null;
  updatedAt: number;
}

export type Action =
  | { kind: "enable"; owner: string }
  | { kind: "members"; members: Member[] }
  | { kind: "force" }
  | { kind: "acquire"; device: string }
  | { kind: "renew"; device: string }
  | { kind: "publish"; device: string; gen: number }
  | { kind: "have"; device: string; gen: number }
  | { kind: "release"; device: string };

export type Refusal =
  | { error: "notShared" }
  | { error: "notMember" }
  | { error: "busy"; device: string }
  | { error: "waitFor"; device: string }
  | { error: "needSync"; gen: number; from: string[] }
  | { error: "noLease" }
  | { error: "badGen"; gen: number }
  | { error: "noCopy" };

export type Outcome = { state: SharedState | null; result: { ok: true } | Refusal };

export const isDevice = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

export const isMember = (s: SharedState, device: string) =>
  device === s.owner || s.members.some((m) => m.device === device);

const genOf = (s: SharedState, device: string) => s.holders[device] ?? -1;

/** `PUT …/shared` gövdesindeki üye listesi; geçersizse null. Sahibin kendisi ve tekrarlar atılır. */
export function parseMembers(v: unknown, owner: string): Member[] | null {
  if (!Array.isArray(v) || v.length > MAX_MEMBERS + 1) return null;
  const out: Member[] = [];
  for (const m of v) {
    if (!m || typeof m !== "object") return null;
    const { device, name } = m as Record<string, unknown>;
    if (!isDevice(device)) return null;
    if (device === owner || out.some((x) => x.device === device)) continue;
    out.push({ device, name: cleanHost(name) ?? "" });
  }
  return out.length > MAX_MEMBERS ? null : out;
}

/** Süresi dolan kira düşer; tutan cihaz "kirli" olur (en güncel hâl onda kalmış olabilir). */
function expire(s: SharedState, now: number): SharedState {
  if (!s.lease || s.lease.until > now) return s;
  return { ...s, lease: null, dirty: s.lease.device };
}

/** Kuralların hepsi: eski durum + işlem → yeni durum ve sonuç. `now` unix saniye. */
export function apply(prev: SharedState | null, action: Action, now: number): Outcome {
  if (action.kind === "enable") {
    if (prev) return { state: prev, result: { ok: true } };
    const state: SharedState = {
      owner: action.owner,
      members: [],
      gen: 0,
      holders: { [action.owner]: 0 },
      lease: null,
      dirty: null,
      updatedAt: now,
    };
    return { state, result: { ok: true } };
  }
  if (!prev) return { state: null, result: { error: "notShared" } };
  const s = expire(prev, now);
  const done = (state: SharedState): Outcome => ({ state: { ...state, updatedAt: now }, result: { ok: true } });
  const refuse = (r: Refusal): Outcome => ({ state: s, result: r });

  switch (action.kind) {
    case "members": {
      const keep = new Set([s.owner, ...action.members.map((m) => m.device)]);
      const holders = Object.fromEntries(Object.entries(s.holders).filter(([d]) => keep.has(d)));
      return done({
        ...s,
        members: action.members,
        holders,
        lease: s.lease && keep.has(s.lease.device) ? s.lease : null,
        dirty: s.dirty && keep.has(s.dirty) ? s.dirty : null,
      });
    }
    case "force": {
      if (!s.dirty) return done(s);
      // Kirli cihazın son ilerlemesinden vazgeçilir: elde olan en yeni kopya yeni nesil sayılır.
      // Kirli cihaz döndüğünde kendi kopyası artık eski; yeni nesli çekmek zorunda.
      const others = Object.entries(s.holders).filter(([d, g]) => d !== s.dirty && g >= 0);
      if (others.length === 0) return refuse({ error: "noCopy" });
      const best = Math.max(...others.map(([, g]) => g));
      const gen = s.gen + 1;
      const holders: Record<string, number> = {};
      for (const [d, g] of others) holders[d] = g === best ? gen : g;
      return done({ ...s, gen, holders, dirty: null });
    }
    case "acquire": {
      const d = action.device;
      if (!isMember(s, d)) return refuse({ error: "notMember" });
      if (s.lease && s.lease.device !== d) return refuse({ error: "busy", device: s.lease.device });
      if (s.dirty && s.dirty !== d) return refuse({ error: "waitFor", device: s.dirty });
      if (genOf(s, d) < s.gen) {
        const from = Object.entries(s.holders)
          .filter(([, g]) => g === s.gen)
          .map(([x]) => x);
        return refuse({ error: "needSync", gen: s.gen, from });
      }
      return done({ ...s, lease: { device: d, gen: s.gen, until: now + LEASE_SECONDS }, dirty: null });
    }
    case "renew": {
      if (s.lease?.device !== action.device) return refuse({ error: "noLease" });
      return done({ ...s, lease: { ...s.lease, until: now + LEASE_SECONDS } });
    }
    case "publish": {
      if (s.lease?.device !== action.device) return refuse({ error: "noLease" });
      if (action.gen !== s.gen + 1) return refuse({ error: "badGen", gen: s.gen });
      return done({
        ...s,
        gen: action.gen,
        holders: { ...s.holders, [action.device]: action.gen },
        lease: { ...s.lease, gen: action.gen },
      });
    }
    case "have": {
      const d = action.device;
      if (!isMember(s, d)) return refuse({ error: "notMember" });
      if (!Number.isInteger(action.gen) || action.gen < 0 || action.gen > s.gen) {
        return refuse({ error: "badGen", gen: s.gen });
      }
      return done({ ...s, holders: { ...s.holders, [d]: Math.max(genOf(s, d), action.gen) } });
    }
    case "release": {
      // Kısa bir kopukluktan sonra temiz kapanış: kira düşmüş olsa da tutan cihaz kirliliği kaldırır.
      if (s.lease?.device === action.device) return done({ ...s, lease: null });
      if (s.dirty === action.device) return done({ ...s, dirty: null });
      return refuse({ error: "noLease" });
    }
  }
}

// ---- İmzalı istekler ----

export const SIGNED_ACTIONS = ["state", "acquire", "renew", "publish", "have", "release"] as const;
export type SignedAction = (typeof SIGNED_ACTIONS)[number];

export interface Signed {
  v: 1;
  action: SignedAction;
  code: string;
  device: string;
  /** Unix saniye. */
  t: number;
  /** 16 bayt hex: aynı istek ikinci kez kabul edilmez. */
  nonce: string;
  gen?: number;
  players?: number;
  maxPlayers?: number;
}

const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));

/**
 * `{payload, sig}`: imzalanan, `payload` metninin baytlarının kendisi (JSON biçim farkı sorun olmaz).
 * Geçerliyse içerik, değilse hatanın adı. Nonce'un daha önce görülmediğini çağıran denetler.
 */
export async function verifySigned(
  body: Record<string, unknown> | null,
  code: string,
  now: number,
): Promise<Signed | "bad_request" | "bad_signature" | "stale"> {
  if (!body || typeof body.payload !== "string" || typeof body.sig !== "string") return "bad_request";
  if (body.payload.length > 1024 || !/^[0-9a-f]{128}$/.test(body.sig)) return "bad_request";
  let p: Record<string, unknown>;
  try {
    const parsed = JSON.parse(body.payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "bad_request";
    p = parsed as Record<string, unknown>;
  } catch {
    return "bad_request";
  }
  const int = (v: unknown, max: number) => v === undefined || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max);
  if (
    p.v !== 1 ||
    !SIGNED_ACTIONS.includes(p.action as SignedAction) ||
    p.code !== code ||
    !isDevice(p.device) ||
    !Number.isInteger(p.t) ||
    typeof p.nonce !== "string" ||
    !/^[0-9a-f]{32}$/.test(p.nonce) ||
    !int(p.gen, Number.MAX_SAFE_INTEGER) ||
    !int(p.players, 10000) ||
    !int(p.maxPlayers, 10000)
  ) {
    return "bad_request";
  }
  if (Math.abs(now - (p.t as number)) > MAX_SKEW_SECONDS) return "stale";
  try {
    const key = await crypto.subtle.importKey("raw", fromHex(p.device as string), { name: "Ed25519" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, fromHex(body.sig), new TextEncoder().encode(body.payload));
    if (!ok) return "bad_signature";
  } catch {
    return "bad_signature";
  }
  return p as unknown as Signed;
}

// ---- Sayfada gösterilecek özet ----

export interface SharedView {
  /** Şu an açık olanın adı. */
  host: string | null;
  /** En güncel hâl kimde kaldıysa onun adı (o açana kadar kimse açamaz). */
  waitFor: string | null;
  /** Dünyayı açabilenlerin adları (sahip ilk). */
  names: string[];
}

/** `ownerName`: sahibin oyundaki adı (davet kaydındaki `host`). Adı bilinmeyenler listede yer almaz. */
export function sharedView(s: SharedState | null, ownerName: string | null, now: number): SharedView | null {
  if (!s) return null;
  const state = expire(s, now);
  const name = (d: string) => (d === state.owner ? ownerName : state.members.find((m) => m.device === d)?.name) || null;
  return {
    host: state.lease ? name(state.lease.device) : null,
    waitFor: state.dirty ? name(state.dirty) : null,
    names: [ownerName, ...state.members.map((m) => m.name)].filter((n): n is string => !!n),
  };
}

/** Uygulamaya giden tam durum (üye adlarıyla). */
export function publicState(s: SharedState, now: number) {
  const state = expire(s, now);
  return {
    owner: state.owner,
    members: state.members,
    gen: state.gen,
    holders: state.holders,
    lease: state.lease,
    dirty: state.dirty,
  };
}
