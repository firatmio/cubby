/** Davetin sayfada görünen özeti: davet sayfası (`/join/:code`) ve sitedeki Katıl (`/api/peek`) ortak. */

import { LOADER_LABELS } from "./invite.js";
import { statusKey, statusView, type StatusUpdate, type StatusView } from "./meta.js";
import { inviteKey, redis, type InviteRecord } from "./store.js";

export interface InvitePreview {
  world: string;
  /** "Fabric 0.19.5 · Minecraft 1.21.1" */
  tech: string;
  host: string | null;
  /** Kapağın adresi (göreli) ya da yok. */
  cover: string | null;
  status: StatusView | null;
  mods: number;
}

export function techOf(record: InviteRecord): string {
  const loader = LOADER_LABELS[record.loader] ?? record.loader;
  return record.loader === "vanilla"
    ? `Minecraft ${record.mc}`
    : `${loader}${record.loaderVersion ? ` ${record.loaderVersion}` : ""} · Minecraft ${record.mc}`;
}

/** Kod geçerli biçimde olmalı (`normalizeCode`); davet yoksa null. */
export async function loadPreview(code: string): Promise<InvitePreview | null> {
  const [record, status] = await Promise.all([
    redis().get<InviteRecord>(inviteKey(code)),
    redis().get<StatusUpdate>(statusKey(code)),
  ]);
  if (!record) return null;
  return {
    world: record.name,
    tech: techOf(record),
    host: record.host ?? null,
    cover: record.coverVersion ? `/api/cover?code=${code}&v=${record.coverVersion}` : null,
    status: statusView(status),
    mods: record.mods ?? 0,
  };
}
