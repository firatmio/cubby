import { convertFileSrc, invoke as tauriInvoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Geliştirirken uygulama düz tarayıcıda açıldıysa (Tauri yok) sahte verilerle çalış.
 * `import.meta.env.DEV` prod'da `false` olduğundan mock kodu pakete girmez.
 */
export const IS_MOCK = import.meta.env.DEV && !("__TAURI_INTERNALS__" in window);

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (import.meta.env.DEV && IS_MOCK) {
    const { mockInvoke } = await import("./mock");
    return (await mockInvoke(cmd, args)) as T;
  }
  return tauriInvoke<T>(cmd, args);
}

// Rust tarafındaki serde tiplerinin aynası (camelCase).

export type LoaderKind = "vanilla" | "fabric" | "paper" | "neoforge" | "forge" | "quilt";

export interface Instance {
  id: string;
  name: string;
  loader: LoaderKind;
  mcVersion: string;
  loaderVersion: string | null;
  javaPath: string | null;
  javaMajor: number;
  ramMinMb: number;
  ramMaxMb: number;
  port: number;
  createdAt: number;
  cover: Cover | null;
  /** İnternetten katılım açık mı */
  internet: boolean;
  inviteToken: string | null;
}

export interface Cover {
  /** auto: ekran görüntülerinden otomatik; manual: kullanıcı seçti */
  kind: "auto" | "manual";
  /** Görselin baskın rengi (#rrggbb) */
  color: string;
  version: number;
}

export interface Shot {
  file: string;
  takenAt: number;
}

export interface ShotList {
  matched: Shot[];
  others: Shot[];
}

export type CoverSource =
  | { type: "screenshot"; file: string }
  | { type: "file"; path: string }
  | { type: "auto" };

export interface AppSettings {
  minecraftDir: string | null;
  useScreenshots: boolean;
  eulaAccepted: boolean;
  /** Modlu dünyaların oyuncuda gereken modları kendi Minecraft'ıma da kurulsun */
  clientSync: boolean;
}

export type Launcher = "official" | "tLauncher";

/** Kendi Minecraft'ına mod eşitlemesinin durumu (host). */
export interface ClientStatus {
  state: "off" | "working" | "ok" | "error" | "";
  launcher: Launcher | null;
  /** Launcher'da seçilecek profil adı (resmi) ya da sürüm (TLauncher) */
  pick: string | null;
  mods: number;
  blocked: string[];
  message: string | null;
}

export interface ModItem {
  title: string;
  size: number;
}

export interface ModCheck {
  launcher: Launcher | null;
  /** Olmadan girilemeyecek, eksik olanlar */
  required: ModItem[];
  recommended: ModItem[];
}

export interface JoinProgress {
  id: string;
  title: string;
  index: number;
  count: number;
}

export interface Profile {
  uuid: string;
  name: string;
}

export interface AccessView {
  /** Premium olmayan oyuncular (TLauncher) girebilir mi? */
  offlineMode: boolean;
  whitelistEnabled: boolean;
  whitelist: Profile[];
  ops: string[];
  /** Bu sunucuya daha önce girenler */
  known: string[];
  /** Değişiklik yeniden başlatınca geçerliyse açıklama */
  notice: string | null;
}

/**
 * Oyuncunun (istemcinin) bu moda ihtiyacı.
 * required: oyuncuda da kurulu olmalı; recommended: sunucuda çalışır ama bazı özellikleri (ekranlar,
 * tuşlar) oyuncuda da kuruluysa görünür; none: yalnız sunucuda yeterli; clientOnly: sunucuda işe yaramaz.
 */
export type ClientNeed = "required" | "recommended" | "none" | "clientOnly" | "unknown";
export type ModSort = "relevance" | "downloads" | "updated";

export interface ModHit {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  downloads: number;
  /** `media` yolu (modicon/<id>) */
  icon: string | null;
  clientNeed: ClientNeed;
  installed: boolean;
}

export interface ModSearch {
  hits: ModHit[];
  total: number;
}

export interface ModNamed {
  projectId: string;
  title: string;
}

export interface ModDetail {
  projectId: string;
  title: string;
  description: string;
  /** Modrinth açıklaması (markdown) */
  body: string;
  downloads: number;
  license: string | null;
  url: string;
  icon: string | null;
  clientNeed: ClientNeed;
  installed: boolean;
  versionNumber: string | null;
  /** Kurulacak sürüm beta/alpha */
  unstable: boolean;
  /** Birlikte kurulacak bağımlılıklar */
  with: ModNamed[];
  missing: ModNamed[];
  conflicts: ModNamed[];
  error: string | null;
}

export interface InstalledMod {
  file: string;
  title: string;
  projectId: string | null;
  versionNumber: string | null;
  icon: string | null;
  clientNeed: ClientNeed | null;
  /** Başka bir mod istediği için kuruldu */
  dependency: boolean;
  /** Modrinth'te tanındı (değilse elle eklenmiş) */
  known: boolean;
  /** Daha yeni sürüm numarası */
  update: string | null;
}

export interface ModProgress {
  id: string;
  title: string;
  downloaded: number;
  total: number | null;
}

export interface InviteLinks {
  code: string;
  link: string;
}

/** Bağlantı hangi yoldan gidiyor: doğrudan ya da aracı sunucu üzerinden. */
export type PathKind = "direct" | "relay" | "unknown";

export interface JoinStatus {
  /** null: henüz denenmedi */
  reachable: boolean | null;
  /** Arkadaşının dünyası şu an çalışıyor mu */
  running: boolean;
  path: PathKind | null;
  error: string | null;
  /** Arkadaşının şu anki mod listesi özeti */
  modsRev: string | null;
}

/** Arkadaşının, davetle katılınan dünyası. */
export interface JoinedWorld {
  id: string;
  name: string;
  host: string;
  world: string;
  loader: LoaderKind;
  mcVersion: string;
  loaderVersion: string | null;
  localPort: number;
  addedAt: number;
  /** Modlar kurulduysa Launcher'da seçilecek profil (ya da TLauncher sürümü) */
  profile: string | null;
  gameDir: string | null;
  modsRev: string | null;
  withRecommended: boolean;
}

export interface JoinedView {
  world: JoinedWorld;
  status: JoinStatus;
  /** Minecraft'ın sunucu listesindeki adres (127.0.0.1:port) */
  address: string;
}

export interface InvitePreview {
  name: string;
  loader: LoaderKind;
  mcVersion: string;
  loaderVersion: string | null;
  status: JoinStatus;
  /** Bu bilgisayarın kendi dünyası */
  own: boolean;
  alreadyJoined: boolean;
  minecraftDir: string | null;
  minecraftRunning: boolean;
  requiredVersion: string;
  versionInstalled: boolean;
  /** Modlu dünyada oyuncuda eksik modlar (arkadaşına ulaşılabildiyse) */
  mods: ModCheck | null;
  modsError: string | null;
}

/** off: dünya kapalı ya da internete açık değil. */
export type RouteState = "off" | "working" | "ok" | "error";

export interface Route {
  state: RouteState;
  address: string | null;
  message: string | null;
}

export interface ConnectionView {
  lan: string | null;
  internet: boolean;
  /** Modem üzerinden (UPnP) */
  direct: Route;
}

export interface PropertiesView {
  values: Record<string, string>;
  /** false: dünya hiç açılmadı, kalan ayarları sunucu ilk açılışta ekler */
  exists: boolean;
}

export interface SettingsView {
  settings: AppSettings;
  /** Kullanılan Minecraft klasörü (ayar ya da varsayılan) */
  minecraftDir: string | null;
  screenshotsFound: boolean;
}

export interface PlayStats {
  lastPlayedAt: number | null;
  totalMs: number;
}

export type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "crashed";
export type LogStream = "stdout" | "stderr" | "system";

export interface LogLine {
  stream: LogStream;
  line: string;
  ts: number;
}

export interface ServerSnapshot {
  status: ServerStatus;
  logs: LogLine[];
  players: string[];
  rejected: string[];
}

export interface ProcessStats {
  cpu: number;
  memMb: number;
}

export interface GameVersion {
  id: string;
  type: "release" | "snapshot";
  releaseTime: string;
}

export interface GameVersionList {
  latestRelease: string;
  versions: GameVersion[];
}

export interface LoaderVersion {
  version: string;
  stable: boolean;
  /** Paper: "stable" | "beta" | "alpha" */
  channel: string | null;
}

export interface LoaderVersionList {
  versions: LoaderVersion[];
  recommended: string | null;
}

export interface JavaInfo {
  path: string;
  major: number;
  version: string;
  /** Uygulamanın indirdiği JRE */
  managed: boolean;
}

export interface InstanceJava {
  required: number;
  /** Sabitlenmiş java yolu; null = otomatik */
  pinned: string | null;
  /** Başlatınca kullanılacak Java; null ise indirilmesi gerekir */
  selected: JavaInfo | null;
  error: string | null;
}

export interface JavaProgress {
  major: number;
  stage: "download" | "extract";
  downloaded: number;
  total: number | null;
}

export interface SystemInfo {
  totalMemMb: number;
  java: JavaInfo | null;
}

export interface CreateInstanceRequest {
  name: string;
  loader: LoaderKind;
  mcVersion: string;
  loaderVersion: string | null;
  ramMinMb: number;
  ramMaxMb: number;
  /** null: uygulama veri dizini */
  parentDir: string | null;
  /** Premium olmayanlar (TLauncher) girebilsin; açıksa beyaz liste zorunlu */
  offlineMode: boolean;
  /** null: beyaz liste kapalı */
  whitelist: string[] | null;
}

export interface UpdateInstanceRequest {
  name?: string;
  ramMinMb?: number;
  ramMaxMb?: number;
}

export interface InstallProgress {
  id: string;
  stage: "meta" | "download" | "extract" | "installer" | "done";
  /** download/extract aşamasında hangi dosya */
  file: "server" | "fabric" | "paper" | "installer" | "java" | null;
  downloaded: number;
  total: number | null;
  /** installer aşamasında installer çıktısının son satırı */
  line: string | null;
}

export const api = {
  systemInfo: () => invoke<SystemInfo>("system_info"),
  listGameVersions: (loader: LoaderKind, includeSnapshots: boolean) =>
    invoke<GameVersionList>("list_game_versions", { loader, includeSnapshots }),
  listLoaderVersions: (loader: LoaderKind, game: string) =>
    invoke<LoaderVersionList>("list_loader_versions", { loader, game }),
  listInstances: () => invoke<Instance[]>("list_instances"),
  getInstance: (id: string) => invoke<Instance>("get_instance", { id }),
  createInstance: (req: CreateInstanceRequest) => invoke<Instance>("create_instance", { req }),
  updateInstance: (id: string, changes: UpdateInstanceRequest) =>
    invoke<Instance>("update_instance", { id, changes }),
  deleteInstance: (id: string) => invoke<void>("delete_instance", { id }),
  eulaStatus: (id: string) => invoke<boolean>("eula_status", { id }),
  acceptEula: (id: string) => invoke<void>("accept_eula", { id }),
  startServer: (id: string) => invoke<void>("start_server", { id }),
  stopServer: (id: string) => invoke<void>("stop_server", { id }),
  sendCommand: (id: string, command: string) => invoke<void>("send_command", { id, command }),
  serverSnapshot: (id: string) => invoke<ServerSnapshot>("server_snapshot", { id }),
  openInstanceDir: (id: string) => invoke<void>("open_instance_dir", { id }),
  openContentDir: (id: string) => invoke<void>("open_content_dir", { id }),
  listJava: (refresh: boolean) => invoke<JavaInfo[]>("list_java", { refresh }),
  instanceJava: (id: string) => invoke<InstanceJava>("instance_java", { id }),
  installJava: (major: number) => invoke<JavaInfo>("install_java", { major }),
  setInstanceJava: (id: string, path: string | null) =>
    invoke<Instance>("set_instance_java", { id, path }),
  getSettings: () => invoke<SettingsView>("get_settings"),
  updateSettings: (settings: AppSettings) => invoke<SettingsView>("update_settings", { settings }),
  listScreenshots: (id: string) => invoke<ShotList>("list_screenshots", { id }),
  setCover: (id: string, source: CoverSource) => invoke<Instance>("set_cover", { id, source }),
  playStats: (id: string) => invoke<PlayStats>("play_stats", { id }),
  lanAddress: (id: string) => invoke<string>("lan_address", { id }),
  getProperties: (id: string) => invoke<PropertiesView>("get_properties", { id }),
  updateProperties: (id: string, changes: Record<string, string>) =>
    invoke<PropertiesView>("update_properties", { id, changes }),
  worldAccess: (id: string) => invoke<AccessView>("world_access", { id }),
  lookupPlayer: (name: string, offline: boolean) => invoke<Profile>("lookup_player", { name, offline }),
  whitelistAdd: (id: string, name: string) => invoke<AccessView>("whitelist_add", { id, name }),
  whitelistRemove: (id: string, name: string) => invoke<AccessView>("whitelist_remove", { id, name }),
  setWhitelistEnabled: (id: string, on: boolean) => invoke<AccessView>("set_whitelist_enabled", { id, on }),
  setOfflineMode: (id: string, offline: boolean) => invoke<AccessView>("set_offline_mode", { id, offline }),
  setOp: (id: string, name: string, op: boolean) => invoke<AccessView>("set_op", { id, name, op }),
  kickPlayer: (id: string, name: string) => invoke<void>("kick_player", { id, name }),
  connectionStatus: (id: string) => invoke<ConnectionView>("connection_status", { id }),
  setInternet: (id: string, on: boolean) => invoke<ConnectionView>("set_internet", { id, on }),
  createInvite: (id: string) => invoke<InviteLinks>("create_invite", { id }),
  /** Yeni anahtar; eski linkler ve kodlar geçersiz olur. */
  resetInvite: (id: string) => invoke<InviteLinks>("reset_invite", { id }),
  previewInvite: (code: string) => invoke<InvitePreview>("preview_invite", { code }),
  joinWorld: (code: string, force: boolean, installRecommended: boolean) =>
    invoke<JoinedView>("join_world", { code, force, installRecommended }),
  updateJoinedMods: (id: string) => invoke<JoinedView>("update_joined_mods", { id }),
  clientStatus: (id: string) => invoke<ClientStatus>("client_status", { id }),
  clientResync: (id: string) => invoke<void>("client_resync", { id }),
  listJoined: () => invoke<JoinedView[]>("list_joined"),
  removeJoined: (id: string) => invoke<void>("remove_joined", { id }),
  readdServerEntry: (id: string, force: boolean) => invoke<void>("readd_server_entry", { id, force }),
  serverEntryExists: (id: string) => invoke<boolean>("server_entry_exists", { id }),
  refreshJoined: (id: string) => invoke<JoinedView>("refresh_joined", { id }),
  takePendingInvite: () => invoke<string | null>("take_pending_invite"),
  modsSearch: (id: string, query: string, category: string | null, sort: ModSort, offset: number) =>
    invoke<ModSearch>("mods_search", { id, query, category, sort, offset }),
  modsProject: (id: string, projectId: string) => invoke<ModDetail>("mods_project", { id, projectId }),
  modsInstall: (id: string, projectId: string) => invoke<InstalledMod[]>("mods_install", { id, projectId }),
  modsInstalled: (id: string) => invoke<InstalledMod[]>("mods_installed", { id }),
  modsRemove: (id: string, file: string) => invoke<InstalledMod[]>("mods_remove", { id, file }),
  modsUpdate: (id: string, file: string) => invoke<InstalledMod[]>("mods_update", { id, file }),
  modsUpdateAll: (id: string) => invoke<InstalledMod[]>("mods_update_all", { id }),
};

/**
 * `media://` protokolünden görsel adresi: `cover/<id>`, `thumb/<id>`, `shot/<dosya>`.
 * `v` önbellek kırıcı (kapak sürümü).
 */
export function mediaUrl(path: string, v?: number | string): string {
  if (import.meta.env.DEV && IS_MOCK) return mockMediaUrl(path);
  const base = convertFileSrc("", "media");
  return `${base}${path}${v !== undefined ? `?v=${v}` : ""}`;
}

/** Mock modunda gerçek görsel yok: dosya adından üretilen degrade manzara. */
function mockMediaUrl(path: string): string {
  let h = 0;
  for (const c of path.replace(/^(cover|thumb)\//, "")) h = (h * 31 + c.charCodeAt(0)) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90" preserveAspectRatio="none">
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h},55%,62%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360},45%,35%)"/></linearGradient></defs>
    <rect width="160" height="90" fill="url(#s)"/>
    <path d="M0 62 L30 48 L55 58 L85 38 L115 54 L160 42 L160 90 L0 90Z" fill="hsl(${(h + 90) % 360},40%,28%)"/>
    <path d="M0 74 L40 64 L80 72 L120 60 L160 70 L160 90 L0 90Z" fill="hsl(${(h + 100) % 360},35%,18%)"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Klasör seçme penceresi; iptal edilirse null. */
export async function pickFolder(title: string): Promise<string | null> {
  if (import.meta.env.DEV && IS_MOCK) return "D:\\Oyunlar\\Sunucular";
  const picked = await openDialog({ directory: true, multiple: false, title });
  return typeof picked === "string" ? picked : null;
}

/** Resim dosyası seçme penceresi; iptal edilirse null. */
export async function pickImage(title: string): Promise<string | null> {
  if (import.meta.env.DEV && IS_MOCK) return "C:\\Resimler\\kapak.png";
  const picked = await openDialog({
    multiple: false,
    title,
    filters: [{ name: "Resim", extensions: ["png", "jpg", "jpeg"] }],
  });
  return typeof picked === "string" ? picked : null;
}

/** Varsayılan tarayıcıda açar. */
export function openExternal(url: string) {
  if (import.meta.env.DEV && IS_MOCK) {
    window.open(url, "_blank");
    return;
  }
  openUrl(url).catch(console.error);
}

/** Rust hataları string olarak gelir. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
