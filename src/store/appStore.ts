import { create } from "zustand";
import {
  api,
  type InstallProgress,
  type Instance,
  type JavaProgress,
  type LogLine,
  type ProcessStats,
  type ServerSnapshot,
  type ServerStatus,
} from "../lib/api";

/** Konsolda tutulan en fazla satır. */
const MAX_LOG_LINES = 5000;

/** Tam ekran görünüm: dünyalar (ana ekran) ya da yeni dünya kurulumu. */
export type View = "home" | "setup";

/** Sağdan kayan paneller. */
export type SheetName = "advanced" | "cover" | "settings";

export interface ServerRuntime {
  status: ServerStatus;
  logs: LogLine[];
  stats: ProcessStats | null;
  players: string[];
}

const EMPTY_RUNTIME: ServerRuntime = { status: "stopped", logs: [], stats: null, players: [] };

interface AppStore {
  view: View;
  setView: (view: View) => void;

  sheet: SheetName | null;
  openSheet: (sheet: SheetName | null) => void;

  /** Kurulumda seçilen türün rengi (arka plan parlaması). */
  setupColor: string;
  setSetupColor: (color: string) => void;

  instances: Instance[];
  /** Ana ekranda odaktaki dünya. */
  selectedId: string | null;
  select: (id: string) => void;
  /** Sola/sağa komşu dünyaya geçer. */
  selectStep: (delta: number) => void;
  loadInstances: () => Promise<void>;
  addInstance: (instance: Instance) => void;
  replaceInstance: (instance: Instance) => void;
  removeInstance: (id: string) => void;

  servers: Record<string, ServerRuntime>;
  appendLogs: (id: string, lines: LogLine[]) => void;
  setStatus: (id: string, status: ServerStatus) => void;
  setStats: (id: string, stats: ProcessStats) => void;
  setPlayers: (id: string, players: string[]) => void;
  hydrateServer: (id: string, snapshot: ServerSnapshot) => void;

  installProgress: InstallProgress | null;
  setInstallProgress: (p: InstallProgress | null) => void;

  javaProgress: JavaProgress | null;
  setJavaProgress: (p: JavaProgress | null) => void;

  shuttingDown: boolean;
  setShuttingDown: (v: boolean) => void;
}

export const useAppStore = create<AppStore>((set, get) => {
  const updateServer = (id: string, fn: (s: ServerRuntime) => ServerRuntime) =>
    set((st) => ({ servers: { ...st.servers, [id]: fn(st.servers[id] ?? EMPTY_RUNTIME) } }));

  return {
    view: "home",
    setView: (view) => set({ view, sheet: null }),

    sheet: null,
    openSheet: (sheet) => set({ sheet }),

    setupColor: "#6cc04a",
    setSetupColor: (setupColor) => set({ setupColor }),

    instances: [],
    selectedId: null,
    select: (selectedId) => set({ selectedId }),
    selectStep: (delta) => {
      const { instances, selectedId } = get();
      if (instances.length === 0) return;
      const i = Math.max(0, instances.findIndex((x) => x.id === selectedId));
      const next = Math.min(instances.length - 1, Math.max(0, i + delta));
      set({ selectedId: instances[next].id });
    },
    loadInstances: async () => {
      const instances = await api.listInstances();
      set((st) => ({
        instances,
        selectedId:
          st.selectedId && instances.some((i) => i.id === st.selectedId)
            ? st.selectedId
            : (instances[0]?.id ?? null),
      }));
      // Sayfa yenilense de durum, konsol ve oyuncular Rust'taki kayıttan gelsin.
      for (const i of instances) {
        api
          .serverSnapshot(i.id)
          .then((snap) => get().hydrateServer(i.id, snap))
          .catch(console.error);
      }
    },
    addInstance: (instance) =>
      set((st) => ({ instances: [...st.instances, instance], selectedId: instance.id })),
    replaceInstance: (instance) =>
      set((st) => ({ instances: st.instances.map((i) => (i.id === instance.id ? instance : i)) })),
    removeInstance: (id) =>
      set((st) => {
        const { [id]: _removed, ...servers } = st.servers;
        const index = st.instances.findIndex((i) => i.id === id);
        const instances = st.instances.filter((i) => i.id !== id);
        const neighbour = instances[Math.min(index, instances.length - 1)];
        return {
          instances,
          servers,
          sheet: null,
          selectedId: st.selectedId === id ? (neighbour?.id ?? null) : st.selectedId,
        };
      }),

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
        players: status === "running" || status === "stopping" ? s.players : [],
      })),
    setStats: (id, stats) => updateServer(id, (s) => ({ ...s, stats })),
    setPlayers: (id, players) => updateServer(id, (s) => ({ ...s, players })),
    hydrateServer: (id, snapshot) =>
      updateServer(id, (s) => ({
        ...s,
        status: snapshot.status,
        logs: snapshot.logs,
        players: snapshot.players,
      })),

    installProgress: null,
    setInstallProgress: (installProgress) => set({ installProgress }),

    javaProgress: null,
    setJavaProgress: (javaProgress) => set({ javaProgress }),

    shuttingDown: false,
    setShuttingDown: (shuttingDown) => set({ shuttingDown }),
  };
});

export function useServer(id: string | null): ServerRuntime {
  return useAppStore((s) => (id && s.servers[id]) || EMPTY_RUNTIME);
}

export function useSelected(): Instance | undefined {
  return useAppStore((s) => s.instances.find((i) => i.id === s.selectedId));
}
