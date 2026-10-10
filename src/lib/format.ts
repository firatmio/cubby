import type { Instance, LoaderKind } from "./api";

/** Teknik adlar (ikinci satırda, küçük). */
export const LOADER_LABELS: Record<LoaderKind, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  paper: "Paper",
};

/** Kullanıcıya görünen tür adı. */
export const KIND_LABELS: Record<LoaderKind, string> = {
  fabric: "Modlu",
  paper: "Eklentili",
  vanilla: "Saf Minecraft",
};

/** Kapak yokken arka plan parlaması ve vurgu rengi. */
export const KIND_COLORS: Record<LoaderKind, string> = {
  fabric: "#6cc04a",
  paper: "#4f9ff0",
  vanilla: "#c8955a",
};

/** Mod/plugin klasörü olan türler. */
export const CONTENT_DIR_LABEL: Partial<Record<LoaderKind, string>> = {
  fabric: "Mods",
  paper: "Plugins",
};

export function accentOf(i: Instance | undefined): string {
  return i?.cover?.color ?? (i ? KIND_COLORS[i.loader] : KIND_COLORS.fabric);
}

/** "Modlu dünya · Minecraft 26.3" */
export function kindCaption(i: Instance): string {
  return `${KIND_LABELS[i.loader]} dünya · Minecraft ${i.mcVersion}`;
}

/** Teknik özet: "Fabric 26.3 · loader 0.19.5" */
export function describeInstance(i: Instance): string {
  const base = `${LOADER_LABELS[i.loader]} ${i.mcVersion}`;
  if (!i.loaderVersion) return base;
  return `${base} · ${i.loader === "paper" ? "build" : "loader"} ${i.loaderVersion}`;
}

export function formatBytesMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

export function formatRam(mb: number): string {
  return mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024} GB` : `${mb} MB`;
}

export function formatDate(iso: string | number): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("tr-TR");
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "az önce", "12 dk önce", "3 sa önce", "dün", "4 gün önce", tarih. */
export function relativeTime(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms);
  if (diff < MIN) return "az önce";
  if (diff < HOUR) return `${Math.floor(diff / MIN)} dk önce`;
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (ms >= startOfToday) return `${Math.floor(diff / HOUR)} sa önce`;
  if (ms >= startOfToday - DAY) return "dün";
  if (diff < 7 * DAY) return `${Math.ceil(diff / DAY)} gün önce`;
  return formatDate(ms);
}

/** "2 sa 15 dk", "45 dk", "1 dk". */
export function formatDuration(ms: number): string {
  const h = Math.floor(ms / HOUR);
  const m = Math.max(1, Math.round((ms % HOUR) / MIN));
  return h > 0 ? `${h} sa ${m} dk` : `${m} dk`;
}
