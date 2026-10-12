/**
 * Küçük bellek içi önbellek: aynı istek tekrar gelince eski sonuç anında döner, arkada yenilenir.
 * Aynı anda giden aynı istekler tekilleştirilir.
 */

/** Bu süreden eski sonuçlar gösterilir ama arkada yenilenir. */
const FRESH_MS = 5 * 60 * 1000;
/** Bellekte en fazla bu kadar sonuç kalır (en eskisi atılır). */
const MAX_ENTRIES = 200;

interface Entry<T> {
  value: T;
  at: number;
}

const entries = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export function peek<T>(key: string): T | undefined {
  return entries.get(key)?.value as T | undefined;
}

export function isFresh(key: string): boolean {
  const e = entries.get(key);
  return !!e && Date.now() - e.at < FRESH_MS;
}

export function put<T>(key: string, value: T) {
  entries.delete(key);
  entries.set(key, { value, at: Date.now() });
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
}

/** Önbellekte tazeyse onu, değilse isteği (tekilleştirilmiş) döner. */
export function fetchCached<T>(key: string, load: () => Promise<T>, force = false): Promise<T> {
  if (!force && isFresh(key)) return Promise.resolve(peek<T>(key)!);
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = load()
    .then((v) => {
      put(key, v);
      return v;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Bir öneke uyan kayıtları siler (ör. bir dünyada mod kurulunca "kurulu" işaretleri değişir). */
export function invalidate(prefix: string) {
  for (const k of [...entries.keys()]) if (k.startsWith(prefix)) entries.delete(k);
}
