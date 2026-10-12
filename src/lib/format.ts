import { getT, locale } from "../i18n";
import type { ContentKind, Instance, LoaderKind } from "./api";

/** Teknik adlar (ikinci satırda, küçük). */
export const LOADER_LABELS: Record<LoaderKind, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  paper: "Paper",
  neoforge: "NeoForge",
  forge: "Forge",
  quilt: "Quilt",
};

/** Mod kurulabilen türler; oyuncunun Minecraft'ına da aynı altyapı ve modlar gerekir. */
export const MOD_LOADERS: LoaderKind[] = ["fabric", "neoforge", "forge", "quilt"];

export function isModded(kind: LoaderKind): boolean {
  return MOD_LOADERS.includes(kind);
}

/** Kullanıcıya görünen tür adı ("Modlu", "Eklentili", "Saf Minecraft"). */
export function kindLabel(kind: LoaderKind): string {
  const t = getT().kind;
  return kind === "paper" ? t.plugins : kind === "vanilla" ? t.vanilla : t.modded;
}

/** Kapak yokken arka plan parlaması ve vurgu rengi. */
export const KIND_COLORS: Record<LoaderKind, string> = {
  fabric: "#6cc04a",
  neoforge: "#e8803a",
  forge: "#5b7fc4",
  quilt: "#a07ad8",
  paper: "#4f9ff0",
  vanilla: "#c8955a",
};

/** Mod/plugin klasörü olan türler. */
export const CONTENT_DIR_LABEL: Partial<Record<LoaderKind, string>> = {
  fabric: "Mods",
  neoforge: "Mods",
  forge: "Mods",
  quilt: "Mods",
  paper: "Plugins",
};

export function accentOf(i: Instance | undefined): string {
  return i?.cover?.color ?? (i ? KIND_COLORS[i.loader] : KIND_COLORS.fabric);
}

/** "Modlu dünya · Minecraft 26.3" */
export function kindCaption(i: Instance): string {
  return getT().kind.caption(kindLabel(i.loader), i.mcVersion);
}

/** Teknik özet: "Fabric 26.3 · loader 0.19.5", "NeoForge 26.3 · 26.3.0.76" */
export function describeInstance(i: Instance): string {
  const base = `${LOADER_LABELS[i.loader]} ${i.mcVersion}`;
  if (!i.loaderVersion) return base;
  const prefix = i.loader === "paper" ? "build " : i.loader === "fabric" || i.loader === "quilt" ? "loader " : "";
  return `${base} · ${prefix}${i.loaderVersion}`;
}

export function formatBytesMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

export function formatRam(mb: number): string {
  return mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024} GB` : `${mb} MB`;
}

export function formatDate(iso: string | number): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(locale());
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "az önce", "12 dk önce", "3 sa önce", "dün", "4 gün önce", tarih. */
export function relativeTime(ms: number, now = Date.now()): string {
  const t = getT().time;
  const diff = Math.max(0, now - ms);
  if (diff < MIN) return t.justNow;
  if (diff < HOUR) return t.minutesAgo(Math.floor(diff / MIN));
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (ms >= startOfToday) return t.hoursAgo(Math.floor(diff / HOUR));
  if (ms >= startOfToday - DAY) return t.yesterday;
  if (diff < 7 * DAY) return t.daysAgo(Math.ceil(diff / DAY));
  return formatDate(ms);
}

/** "2 sa 15 dk", "45 dk", "1 dk". */
export function formatDuration(ms: number): string {
  const h = Math.floor(ms / HOUR);
  const m = Math.max(1, Math.round((ms % HOUR) / MIN));
  return getT().time.duration(h, m);
}

/** Modrinth kategorileri (mod ve eklentiler için ortak), etkin dilde. */
/** Türün Modrinth kategorileri (çipler ve raflar için), sırayla. */
const CATEGORY_KEYS: Record<ContentKind, string[]> = {
  mod: ["optimization", "utility", "worldgen", "technology", "magic", "adventure", "decoration", "game-mechanics", "mobs", "equipment", "storage", "transportation", "food", "economy", "management", "minigame", "social", "library"],
  resourcePack: ["vanilla-like", "realistic", "simplistic", "themed", "decoration", "combat", "tweaks", "utility", "gui", "fonts", "audio", "blocks", "items", "entities", "modded", "cursed"],
  shader: ["realistic", "semi-realistic", "fantasy", "cartoon", "vanilla-like", "potato", "low", "medium", "high"],
  dataPack: ["adventure", "worldgen", "game-mechanics", "utility", "magic", "mobs", "equipment", "decoration", "storage", "technology"],
};

/** Türün kategorileri: anahtar → görünen ad. */
export function categoryLabels(kind: ContentKind = "mod"): Record<string, string> {
  const all = getT().categories;
  return Object.fromEntries(CATEGORY_KEYS[kind].map((k) => [k, all[k] ?? k]));
}

/** "2,7 Mn", "48 B", "312" */
export function compactCount(n: number): string {
  const t = getT().time;
  const f = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 1 });
  if (n >= 1_000_000) return `${f(n / 1_000_000)} ${t.million}`;
  if (n >= 1_000) return `${f(n / 1_000)} ${t.thousand}`;
  return String(n);
}
