/**
 * GET /api/update?channel=stable|beta&target=…&arch=…&current=… — Cubby'nin güncelleme ucu.
 * GitHub Releases'tan kanalın en yeni sürümünü bulur; `current`'tan yeniyse Tauri'nin beklediği
 * JSON'u, değilse 204 döner. CDN'de 5 dk önbelleklenir (GitHub hız sınırına takılmasın).
 */

import { github } from "../lib/release.js";
import { REPO, compareVersions, installerAssets, pickRelease, updateBody, type Channel, type GhRelease } from "../lib/update.js";

const CACHE = "public, s-maxage=300, stale-while-revalidate=600";

const noUpdate = () => new Response(null, { status: 204, headers: { "cache-control": CACHE } });

export async function GET(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const channel: Channel = q.get("channel") === "beta" ? "beta" : "stable";
  const current = q.get("current") ?? "";
  // Şimdilik yalnız Windows x64 derleniyor.
  if (q.get("target") !== "windows" || (q.get("arch") ?? "x86_64") !== "x86_64") return noUpdate();

  const res = await github(`https://api.github.com/repos/${REPO}/releases?per_page=30`);
  if (!res.ok) return new Response(null, { status: 502, headers: { "cache-control": "no-store" } });
  const release = pickRelease((await res.json()) as GhRelease[], channel);
  if (!release || compareVersions(release.tag_name, current) <= 0) return noUpdate();

  const sigRes = await fetch(installerAssets(release)!.sig.browser_download_url, { headers: { "user-agent": "cubby-update" } });
  if (!sigRes.ok) return new Response(null, { status: 502, headers: { "cache-control": "no-store" } });
  return new Response(JSON.stringify(updateBody(release, await sigRes.text())), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": CACHE },
  });
}
