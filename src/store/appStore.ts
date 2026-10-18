import { create } from "zustand";
import {
  api,
  type ContentKind,
  type ConnectionView,
  type InstallProgress,
  type ClientStatus,
  type JoinProgress,
  type JoinedView,
  type JoinedWorld,
  type JoinStatus,
  type ModProgress,
  type Instance,
  type JavaProgress,
  type LogLine,
  type ProcessStats,
  type ServerSnapshot,
  type ServerStatus,
  type LaunchResult,
  type GameProgress,
  type Account,
  type LoaderKind,
  type UpdateView,
  type Pregen,
  type BoostView,
} from "../lib/api";

/** Konsolda tutulan en fazla satır. */
const MAX_LOG_LINES = 5000;

/** Tam ekran görünüm: dünyalar (ana ekran) ya da yeni dünya kurulumu. */
export type View = "home" | "setup";

/** Ana görünümdeki iki sayfa: dünyalar (Oyna) ve seçili dünya için içerik (Keşfet). */
export type Page = "play" | "discover";

/** Keşfet'in sekmeleri: içerik türleri. */
export type DiscoverTab = ContentKind;

/** Sağdan kayan paneller. */
export type SheetName = "advanced" | "cover" | "settings" | "players" | "world" | "connection";

export interface ServerRuntime {
  status: ServerStatus;
  logs: LogLine[];
  stats: ProcessStats | null;
  players: string[];
  /** Beyaz listede olmadığı için atılanlar */
  rejected: string[];
}

const EMPTY_RUNTIME: ServerRuntime = { status: "stopped", logs: [], stats: null, players: [], rejected: [] };

/** Keşfet'ten "Yeni dünya olarak kur": sihirbaz bu paketle, altyapı ve sürüm sormadan açılır. */
export interface ModpackPreset {
  projectId: string;
  versionId: string;
  title: string;
  icon: string | null;
  mc: string;
  loader: LoaderKind;
  loaderVersion: string | null;
  ramMb: number;
}

interface AppStore {
  view: View;
  setView: (view: View) => void;
  setupPreset: ModpackPreset | null;
  startModpackSetup: (preset: ModpackPreset) => void;

  update: UpdateView | null;
  setUpdate: (update: UpdateView) => void;

  /** Dünya başına: sunucu zorlanıyor mu, önceden hazırlama durumu. */
  health: Record<string, { overloaded: boolean; behindMs: number }>;
  setHealth: (id: string, overloaded: boolean, behindMs: number) => void;
  pregen: Record<string, Pregen>;
  setPregen: (id: string, pregen: Pregen) => void;
  /** Hızlandırıcı durumu (Performans kartı, çöküş hapı). */
  boost: Record<string, BoostView>;
  setBoost: (id: string, boost: BoostView) => void;
  /** Dünya ayarları açılınca Performans bölümüne kaydırılsın (zorlanma hapından gelince). */
  worldFocus: "performance" | null;
  openWorldPerformance: () => void;
  clearWorldFocus: () => void;
  updateDialog: boolean;
  openUpdate: (open: boolean) => void;

  sheet: SheetName | null;
  openSheet: (sheet: SheetName | null) => void;

  page: Page;
  setPage: (page: Page) => void;
  discoverTab: DiscoverTab;
  setDiscoverTab: (tab: DiscoverTab) => void;
  /** Keşfet'i bir sekmesiyle açar (eski "Modlar" paneli yerine). */
  openDiscover: (tab: DiscoverTab) => void;

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
  setRejected: (id: string, rejected: string[]) => void;
  hydrateServer: (id: string, snapshot: ServerSnapshot) => void;

  installProgress: InstallProgress | null;
  setInstallProgress: (p: InstallProgress | null) => void;

  javaProgress: JavaProgress | null;
  setJavaProgress: (p: JavaProgress | null) => void;

  shuttingDown: boolean;
  setShuttingDown: (v: boolean) => void;

  /** Davetle katılınan arkadaş dünyaları; seçim kimliği `join:<id>`. */
  joined: JoinedView[];
  loadJoined: () => Promise<void>;
  upsertJoined: (view: JoinedView) => void;
  /** Kaydı değişen (kapak, kod) katılınan dünya. */
  updateJoinedWorld: (world: JoinedWorld) => void;
  removeJoinedLocal: (id: string) => void;
  setJoinStatus: (id: string, status: JoinStatus) => void;
  /** Katıl penceresi: null kapalı, "" boş, dolu ise davet kodu/linki. */
  joinDialog: string | null;
  openJoin: (code: string | null) => void;

  /** Dünya başına kendi Minecraft'ına mod eşitlemesi. */
  clientStatus: Record<string, ClientStatus>;
  setClientStatus: (id: string, s: ClientStatus) => void;
  /** "Başlat ve katıl" sonrası Launcher sonucu (dünya başına; kapatılınca null). */
  launchResults: Record<string, LaunchResult | null>;
  setLaunchResult: (id: string, r: LaunchResult | null) => void;
  /** Oyun Launcher'sız açılırken ilerleme (açılınca null). */
  gameProgress: GameProgress | null;
  setGameProgress: (p: GameProgress | null) => void;
  /** Oyun hatayla kapandı: çıkış kodu (mesaj kapatılınca null). */
  gameCrash: number | null;
  setGameCrash: (code: number | null) => void;
  /** Microsoft girişi az önce bağlandı: kutlama gösterilecek hesap. */
  celebrate: Account | null;
  setCelebrate: (a: Account | null) => void;
  /** Katılırken oyuncunun Minecraft'ına mod kurulumu. */
  joinProgress: JoinProgress | null;
  setJoinProgress: (p: JoinProgress | null) => void;

  /** Süren mod indirmesi. */
  modProgress: ModProgress | null;
  setModProgress: (p: ModProgress | null) => void;

  /** Dünya başına bağlantı durumu (LAN, modem). */
  connections: Record<string, ConnectionView>;
  setConnection: (id: string, view: ConnectionView) => void;
}

export const useAppStore = create<AppStore>((set, get) => {
  const updateServer = (id: string, fn: (s: ServerRuntime) => ServerRuntime) =>
    set((st) => ({ servers: { ...st.servers, [id]: fn(st.servers[id] ?? EMPTY_RUNTIME) } }));

  return {
    view: "home",
    setView: (view) =>
      set((st) => ({
        view,
        sheet: null,
        page: view === "setup" ? "play" : st.page,
        setupPreset: view === "setup" ? st.setupPreset : null,
      })),
    setupPreset: null,
    startModpackSetup: (setupPreset) => set({ setupPreset, view: "setup", sheet: null, page: "play" }),

    update: null,
    setUpdate: (update) => set({ update }),

    health: {},
    setHealth: (id, overloaded, behindMs) => set((st) => ({ health: { ...st.health, [id]: { overloaded, behindMs } } })),
    pregen: {},
    boost: {},
    setBoost: (id, boost) => set((st) => ({ boost: { ...st.boost, [id]: boost } })),
    setPregen: (id, pregen) => set((st) => ({ pregen: { ...st.pregen, [id]: pregen } })),
    worldFocus: null,
    openWorldPerformance: () => set({ worldFocus: "performance", sheet: "world" }),
    clearWorldFocus: () => set({ worldFocus: null }),
    updateDialog: false,
    openUpdate: (updateDialog) => set({ updateDialog }),

    sheet: null,
    openSheet: (sheet) => set({ sheet }),

    page: "play",
    setPage: (page) => set({ page, sheet: null }),
    discoverTab: "mod",
    setDiscoverTab: (discoverTab) => set({ discoverTab }),
    openDiscover: (discoverTab) => set({ page: "discover", discoverTab, sheet: null }),

    setupColor: "#6cc04a",
    setSetupColor: (setupColor) => set({ setupColor }),

    instances: [],
    selectedId: null,
    select: (selectedId) => set({ selectedId }),
    selectStep: (delta) => {
      const ids = allIds(get());
      if (ids.length === 0) return;
      const i = Math.max(0, ids.indexOf(get().selectedId ?? ""));
      set({ selectedId: ids[Math.min(ids.length - 1, Math.max(0, i + delta))] });
    },
    loadInstances: async () => {
      const instances = await api.listInstances();
      set((st) => {
        const ids = allIds({ instances, joined: st.joined });
        return { instances, selectedId: st.selectedId && ids.includes(st.selectedId) ? st.selectedId : (ids[0] ?? null) };
      });
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
        rejected: status === "starting" ? [] : s.rejected,
      })),
    setStats: (id, stats) => updateServer(id, (s) => ({ ...s, stats })),
    setPlayers: (id, players) => updateServer(id, (s) => ({ ...s, players })),
    setRejected: (id, rejected) => updateServer(id, (s) => ({ ...s, rejected })),
    hydrateServer: (id, snapshot) =>
      updateServer(id, (s) => ({
        ...s,
        status: snapshot.status,
        logs: snapshot.logs,
        players: snapshot.players,
        rejected: snapshot.rejected,
      })),

    installProgress: null,
    setInstallProgress: (installProgress) => set({ installProgress }),

    javaProgress: null,
    setJavaProgress: (javaProgress) => set({ javaProgress }),

    shuttingDown: false,
    setShuttingDown: (shuttingDown) => set({ shuttingDown }),

    joined: [],
    loadJoined: async () => {
      const joined = await api.listJoined();
      set((st) => {
        const ids = allIds({ instances: st.instances, joined });
        return { joined, selectedId: st.selectedId && ids.includes(st.selectedId) ? st.selectedId : (ids[0] ?? null) };
      });
    },
    updateJoinedWorld: (world) =>
      set((st) => ({ joined: st.joined.map((j) => (j.world.id === world.id ? { ...j, world } : j)) })),
    upsertJoined: (view) =>
      set((st) => {
        const exists = st.joined.some((j) => j.world.id === view.world.id);
        return {
          joined: exists ? st.joined.map((j) => (j.world.id === view.world.id ? view : j)) : [...st.joined, view],
          selectedId: joinKey(view.world.id),
        };
      }),
    removeJoinedLocal: (id) =>
      set((st) => {
        const index = allIds(st).indexOf(joinKey(id));
        const joined = st.joined.filter((j) => j.world.id !== id);
        const rest = allIds({ instances: st.instances, joined });
        return {
          joined,
          selectedId: st.selectedId === joinKey(id) ? (rest[Math.min(index, rest.length - 1)] ?? null) : st.selectedId,
        };
      }),
    setJoinStatus: (id, status) =>
      set((st) => ({ joined: st.joined.map((j) => (j.world.id === id ? { ...j, status } : j)) })),
    clientStatus: {},
    setClientStatus: (id, s) => set((st) => ({ clientStatus: { ...st.clientStatus, [id]: s } })),
    launchResults: {},
    setLaunchResult: (id, r) => set((st) => ({ launchResults: { ...st.launchResults, [id]: r } })),
    gameProgress: null,
    setGameProgress: (gameProgress) => set({ gameProgress }),
    gameCrash: null,
    setGameCrash: (gameCrash) => set({ gameCrash }),
    celebrate: null,
    setCelebrate: (celebrate) => set({ celebrate }),
    joinProgress: null,
    setJoinProgress: (joinProgress) => set({ joinProgress }),
    modProgress: null,
    setModProgress: (modProgress) => set({ modProgress }),
    joinDialog: null,
    openJoin: (joinDialog) => set({ joinDialog, sheet: null }),

    connections: {},
    setConnection: (id, view) => set((st) => ({ connections: { ...st.connections, [id]: view } })),
  };
});

/** Katılınan dünyaların seçim kimliği; kendi dünyalarının kimlikleriyle karışmaz. */
export const joinKey = (id: string) => `join:${id}`;

function allIds(st: { instances: Instance[]; joined: JoinedView[] }): string[] {
  return [...st.instances.map((i) => i.id), ...st.joined.map((j) => joinKey(j.world.id))];
}

export function useSelectedJoined(): JoinedView | undefined {
  return useAppStore((s) => s.joined.find((j) => joinKey(j.world.id) === s.selectedId));
}

export function useServer(id: string | null): ServerRuntime {
  return useAppStore((s) => (id && s.servers[id]) || EMPTY_RUNTIME);
}

export function useSelected(): Instance | undefined {
  return useAppStore((s) => s.instances.find((i) => i.id === s.selectedId));
}
