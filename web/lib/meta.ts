/**
 * Davetin zengin bilgileri (uygulama gönderir, sayfa gösterir): davet edenin adı, kapak, oyuncuda
 * gereken mod sayısı ve canlı durum. Saf doğrulama işlevleri; Redis işleri uçlarda.
 */

/** Kapak: 1200×630 JPEG, base64'süz en çok bu kadar. */
export const COVER_MAX_BYTES = 350 * 1024;
/** Açık dünyanın durumu bu kadar tazelenmezse (uygulama kapandı, internet gitti) bilinmiyor sayılır. */
export const OPEN_TTL_SECONDS = 6 * 60;

export interface MetaUpdate {
  /** `undefined`: değişmez; `null`: silinir. */
  host?: string | null;
  mods?: number;
  /** JPEG baytları; `null`: kapak kaldırıldı. */
  cover?: Uint8Array | null;
  coverVersion?: number;
}

export interface StatusUpdate {
  running: boolean;
  players: number;
  maxPlayers: number;
}

/** Sayfada gösterilecek durum; bilinmiyorsa null. */
export type StatusView = { state: "open"; players: number; maxPlayers: number } | { state: "closed" };

const count = (v: unknown, max = 10000): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null;

/** Oyundaki ad: kontrol karakterleri atılır, en çok 24 karakter; boşsa null. */
export function cleanHost(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 24);
  return s || null;
}

export function decodeBase64(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  try {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** `PUT …/meta` gövdesi; geçersizse null. */
export function parseMeta(body: Record<string, unknown>): MetaUpdate | null {
  const out: MetaUpdate = {};
  if ("host" in body) {
    if (body.host !== null && typeof body.host !== "string") return null;
    out.host = cleanHost(body.host);
  }
  if ("mods" in body) {
    const n = count(body.mods);
    if (n === null) return null;
    out.mods = n;
  }
  if ("cover" in body) {
    if (body.cover === null) out.cover = null;
    else {
      const bytes = typeof body.cover === "string" ? decodeBase64(body.cover) : null;
      if (!bytes || bytes.length > COVER_MAX_BYTES || !isJpeg(bytes)) return null;
      out.cover = bytes;
    }
  }
  if ("coverVersion" in body) {
    const n = count(body.coverVersion, Number.MAX_SAFE_INTEGER);
    if (n === null) return null;
    out.coverVersion = n;
  }
  return out;
}

/** `PUT …/status` gövdesi; geçersizse null. */
export function parseStatus(body: Record<string, unknown>): StatusUpdate | null {
  const players = count(body.players);
  const maxPlayers = count(body.maxPlayers);
  if (typeof body.running !== "boolean" || players === null || maxPlayers === null) return null;
  return { running: body.running, players, maxPlayers };
}

/** Saklanan durumdan sayfadaki görünüm. */
export function statusView(s: StatusUpdate | null): StatusView | null {
  if (!s) return null;
  return s.running ? { state: "open", players: s.players, maxPlayers: s.maxPlayers } : { state: "closed" };
}

export const coverKey = (code: string) => `cover:${code}`;
export const statusKey = (code: string) => `status:${code}`;
