import { create } from "zustand";
import {
  api,
  type InstallProgress,
  type Instance,
  type LogLine,
  type ProcessStats,
  type ServerSnapshot,
  type ServerStatus,
} from "../lib/api";

/** Konsolda tutulan en fazla satır. */
const MAX_LOG_LINES = 5000;

export type View = { name: "home" } | { name: "wizard" } | { name: "instance"; id: string };

export interface ServerRuntime {
  status: ServerStatus;
  logs: LogLine[];
  stats: ProcessStats | null;
}

const EMPTY_RUNTIME: ServerRuntime = { status: "stopped", logs: [], stats: null };

interface AppStore {
  view: View;
  navigate: (view: View) => void;

  instances: Instance[];
  loadInstances: () => Promise<void>;
  addInstance: (instance: Instance) => void;

  servers: Record<string, ServerRuntime>;
  appendLogs: (id: string, lines: LogLine[]) => void;
  setStatus: (id: string, status: ServerStatus) => void;
  setStats: (id: string, stats: ProcessStats) => void;
  hydrateServer: (id: string, snapshot: ServerSnapshot) => void;

  installProgress: InstallProgress | null;
  setInstallProgress: (p: InstallProgress | null) => void;

  shuttingDown: boolean;
  setShuttingDown: (v: boolean) => void;
}

export const useAppStore = create<AppStore>((set) => {
  const updateServer = (id: string, fn: (s: ServerRuntime) => ServerRuntime) =>
    set((st) => ({ servers: { ...st.servers, [id]: fn(st.servers[id] ?? EMPTY_RUNTIME) } }));

  return {
    view: { name: "home" },
    navigate: (view) => set({ view }),

    instances: [],
    loadInstances: async () => set({ instances: await api.listInstances() }),
    addInstance: (instance) => set((st) => ({ instances: [...st.instances, instance] })),

    servers: {},
    appendLogs: (id, lines) =>
      updateServer(id, (s) => {
        const logs = s.logs.concat(lines);
        if (logs.length > MAX_LOG_LINES) logs.splice(0, logs.length - MAX_LOG_LINES);
        return { ...s, logs };
      }),
    setStatus: (id, status) =>
      updateServer(id, (s) => ({
        ...s,
        status,
        // Yeni başlatmada eski log temizlenir (Rust tarafı da temizliyor).
        logs: status === "starting" ? [] : s.logs,
        stats: status === "running" || status === "starting" ? s.stats : null,
      })),
    setStats: (id, stats) => updateServer(id, (s) => ({ ...s, stats })),
    hydrateServer: (id, snapshot) =>
      updateServer(id, (s) => ({ ...s, status: snapshot.status, logs: snapshot.logs })),

    installProgress: null,
    setInstallProgress: (installProgress) => set({ installProgress }),

    shuttingDown: false,
    setShuttingDown: (shuttingDown) => set({ shuttingDown }),
  };
});

export function useServer(id: string): ServerRuntime {
  return useAppStore((s) => s.servers[id] ?? EMPTY_RUNTIME);
}
