/**
 * Son sürüm: indirme düğmesi (sürüm ve boyut) ve `/api/download` yönlendirmesi. GitHub'a her istekte
 * gidilmez; Redis'te 10 dk saklanır.
 */

import { REPO, installerAssets, pickRelease, type GhRelease } from "./update.js";
import { redis } from "./store.js";

export interface LatestRelease {
  version: string;
  url: string;
  /** Bayt. */
  size: number;
  prerelease: boolean;
}

const CACHE_KEY = "release:latest";
const CACHE_SECONDS = 10 * 60;

export function github(url: string): Promise<Response> {
  const headers: Record<string, string> = { "user-agent": "cubby-web", accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return fetch(url, { headers });
}

/** Önce kararlı sürüm; henüz yoksa deneme sürümü (şimdilik hepsi deneme). */
export function latestFrom(releases: GhRelease[]): LatestRelease | null {
  const r = pickRelease(releases, "stable") ?? pickRelease(releases, "beta");
  const exe = r && installerAssets(r)?.exe;
  if (!r || !exe) return null;
  return { version: r.tag_name.replace(/^v/i, ""), url: exe.browser_download_url, size: exe.size ?? 0, prerelease: r.prerelease };
}

export async function latestRelease(): Promise<LatestRelease | null> {
  try {
    const cached = await redis().get<LatestRelease>(CACHE_KEY);
    if (cached) return cached;
  } catch {
    /* Redis yoksa doğrudan GitHub */
  }
  try {
    const res = await github(`https://api.github.com/repos/${REPO}/releases?per_page=30`);
    if (!res.ok) return null;
    const latest = latestFrom((await res.json()) as GhRelease[]);
    if (latest) await redis().set(CACHE_KEY, latest, { ex: CACHE_SECONDS }).catch(() => {});
    return latest;
  } catch {
    return null;
  }
}

/** 12 MB gibi; boyut bilinmiyorsa boş. */
export function formatSize(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
