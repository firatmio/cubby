import { invoke } from "@tauri-apps/api/core";

// Rust tarafındaki serde tiplerinin aynası (camelCase).

export type LoaderKind = "vanilla";

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

export interface JavaInfo {
  path: string;
  major: number;
  version: string;
}

export interface SystemInfo {
  totalMemMb: number;
  java: JavaInfo | null;
}

export interface CreateInstanceRequest {
  name: string;
  mcVersion: string;
  ramMinMb: number;
  ramMaxMb: number;
}

export interface InstallProgress {
  id: string;
  stage: "meta" | "download" | "done";
  downloaded: number;
  total: number | null;
}

export const api = {
  systemInfo: () => invoke<SystemInfo>("system_info"),
  listMcVersions: (includeSnapshots: boolean) =>
    invoke<GameVersionList>("list_mc_versions", { includeSnapshots }),
  listInstances: () => invoke<Instance[]>("list_instances"),
  getInstance: (id: string) => invoke<Instance>("get_instance", { id }),
  createInstance: (req: CreateInstanceRequest) => invoke<Instance>("create_instance", { req }),
  eulaStatus: (id: string) => invoke<boolean>("eula_status", { id }),
  acceptEula: (id: string) => invoke<void>("accept_eula", { id }),
  startServer: (id: string) => invoke<void>("start_server", { id }),
  stopServer: (id: string) => invoke<void>("stop_server", { id }),
  sendCommand: (id: string, command: string) => invoke<void>("send_command", { id, command }),
  serverSnapshot: (id: string) => invoke<ServerSnapshot>("server_snapshot", { id }),
  openInstanceDir: (id: string) => invoke<void>("open_instance_dir", { id }),
};

/** Rust hataları string olarak gelir. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
