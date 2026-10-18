/** GET /api/download : Cubby'nin en son kurulum dosyasına yönlendirir (bulunamazsa sürümler sayfası). */

import { DOWNLOAD_URL } from "../lib/html.js";
import { latestRelease } from "../lib/release.js";

export async function GET(): Promise<Response> {
  const latest = await latestRelease();
  return new Response(null, {
    status: 302,
    headers: { location: latest?.url ?? DOWNLOAD_URL, "cache-control": "no-store" },
  });
}
