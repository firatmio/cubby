import { invoke as tauriInvoke } from "@tauri-apps/api/core";
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

export type LoaderKind = "vanilla" | "fabric" | "paper";

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
}

export interface UpdateInstanceRequest {
  name?: string;
  ramMinMb?: number;
  ramMaxMb?: number;
}

export interface InstallProgress {
  id: string;
  stage: "meta" | "download" | "extract" | "done";
  /** download/extract aşamasında hangi dosya */
  file: "server" | "fabric" | "paper" | "java" | null;
  downloaded: number;
  total: number | null;
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
};

/** Klasör seçme penceresi; iptal edilirse null. */
export async function pickFolder(title: string): Promise<string | null> {
  if (import.meta.env.DEV && IS_MOCK) return "D:\\Oyunlar\\Sunucular";
  const picked = await openDialog({ directory: true, multiple: false, title });
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
