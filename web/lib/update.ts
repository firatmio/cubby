/** Güncelleme ucu için saf işlevler: kanala göre GitHub sürümü seçimi ve semver karşılaştırma. */

export const REPO = "firatmio/mc-server-client";

export interface GhAsset {
  name: string;
  browser_download_url: string;
}

export interface GhRelease {
  tag_name: string;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: GhAsset[];
}

export type Channel = "stable" | "beta";

type Parsed = { core: [number, number, number]; pre: (string | number)[] };

/** `v0.2.0-beta.1` → { core: [0,2,0], pre: ["beta", 1] }; geçersizse null. */
export function parseVersion(v: string): Parsed | null {
  const m = v.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!m) return null;
  const pre = m[4] ? m[4].split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [];
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre };
}

/** Semver sırası: a < b → negatif. Ön sürüm, aynı çekirdekli kararlı sürümden küçüktür. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === "number" && typeof q === "number") return p - q;
    if (typeof p === "number") return -1;
    if (typeof q === "number") return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/** Kurulum dosyası ve imzası (Windows x64 NSIS). */
export function installerAssets(r: GhRelease): { exe: GhAsset; sig: GhAsset } | null {
  const exe = r.assets.find((a) => /_x64-setup\.exe$/i.test(a.name));
  const sig = exe && r.assets.find((a) => a.name === `${exe.name}.sig`);
  return exe && sig ? { exe, sig } : null;
}

/** Kanalın en yeni, kurulabilir sürümü: kararlıda pre-release'ler sayılmaz, taslaklar hiç sayılmaz. */
export function pickRelease(releases: GhRelease[], channel: Channel): GhRelease | null {
  return (
    releases
      .filter((r) => !r.draft && (channel === "beta" || !r.prerelease))
      .filter((r) => parseVersion(r.tag_name) && installerAssets(r))
      .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0] ?? null
  );
}

/** Tauri güncelleyicisinin beklediği yanıt (dinamik sunucu biçimi). */
export function updateBody(r: GhRelease, signature: string) {
  return {
    version: r.tag_name.replace(/^v/i, ""),
    notes: r.body ?? "",
    pub_date: r.published_at ?? undefined,
    url: installerAssets(r)!.exe.browser_download_url,
    signature: signature.trim(),
  };
}
