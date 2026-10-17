import { listen as tauriListen } from "@tauri-apps/api/event";
import { useAppStore } from "../store/appStore";
import {
  api,
  IS_MOCK,
  type InstallProgress,
  type JavaProgress,
  type LogLine,
  type ProcessStats,
  type ServerStatus,
  type ConnectionView,
  type JoinStatus,
  type ModProgress,
  type ClientStatus,
  type JoinProgress,
  type LaunchResult,
  type GameProgress,
  type UpdateView,
  type JoinedWorld,
  type Pregen,
} from "./api";

type Unlisten = () => void;

/** Bileşen içinden tek bir Rust event'ini dinlemek için (mock'ta da çalışır). */
export async function listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<Unlisten> {
  if (import.meta.env.DEV && IS_MOCK) {
    const { mockListen } = await import("./mock");
    return mockListen(event, handler as (e: { payload: unknown }) => void);
  }
  return tauriListen<T>(event, handler);
}

// Rust'taki event adlarıyla aynı olmalı (server/mod.rs, commands.rs, lib.rs).
const EVENT_LOG = "server://log";
const EVENT_STATUS = "server://status";
const EVENT_STATS = "server://stats";
const EVENT_INSTALL_PROGRESS = "install://progress";
const EVENT_JAVA_PROGRESS = "java://progress";
const EVENT_PLAYERS = "server://players";
const EVENT_REJECTED = "server://rejected";
const EVENT_COVER_CHANGED = "cover://changed";
const EVENT_SHUTTING_DOWN = "app://shutting-down";
const EVENT_NET = "net://status";
const EVENT_JOIN_STATUS = "join://status";
const EVENT_JOIN_WORLD = "join://world";
const EVENT_HEALTH = "server://health";
const EVENT_PREGEN = "server://pregen";
const EVENT_MODS_PROGRESS = "mods://progress";
const EVENT_CLIENT_STATUS = "client://status";
const EVENT_JOIN_PROGRESS = "join://progress";
const EVENT_CLIENT_LAUNCH = "client://launch";
const EVENT_GAME_PROGRESS = "game://progress";
const EVENT_GAME_STATE = "game://state";
const EVENT_INVITE = "join://invite";
const EVENT_UPDATE = "update://state";
/** Kısa davet kodu kendiliğinden yenilendi (join_cmds.rs). */
export const EVENT_INVITE_SHORT = "invite://short";

type WithId<T> = T & { id: string };

/**
 * Rust event'lerini store'a bağlar. Başlangıçta yüzlerce log satırı gelebildiği için
 * satırlar her karede (requestAnimationFrame) toplu eklenir.
 * Dönen fonksiyon dinleyicileri kaldırır.
 */
export async function bindBackendEvents(): Promise<() => void> {
  const store = useAppStore.getState;
  const pending = new Map<string, LogLine[]>();
  let frame = 0;

  const flush = () => {
    frame = 0;
    for (const [id, lines] of pending) store().appendLogs(id, lines);
    pending.clear();
  };

  const unlisteners = await Promise.all([
    listen<WithId<LogLine>>(EVENT_LOG, ({ payload: { id, ...line } }) => {
      const list = pending.get(id);
      if (list) list.push(line);
      else pending.set(id, [line]);
      if (!frame) frame = requestAnimationFrame(flush);
    }),
    listen<{ id: string; status: ServerStatus }>(EVENT_STATUS, ({ payload }) => {
      // Bu duruma kadar gelen satırlar önce yazılsın, sıra bozulmasın.
      if (payload.status !== "starting") flush();
      else pending.delete(payload.id);
      store().setStatus(payload.id, payload.status);
    }),
    listen<WithId<ProcessStats>>(EVENT_STATS, ({ payload: { id, ...stats } }) => {
      store().setStats(id, stats);
    }),
    listen<InstallProgress>(EVENT_INSTALL_PROGRESS, ({ payload }) => {
      store().setInstallProgress(payload);
    }),
    listen<{ id: string; overloaded: boolean; behindMs: number }>(EVENT_HEALTH, ({ payload }) => {
      store().setHealth(payload.id, payload.overloaded, payload.behindMs);
    }),
    listen<{ id: string; pregen: Pregen }>(EVENT_PREGEN, ({ payload }) => {
      store().setPregen(payload.id, payload.pregen);
    }),
    listen<JoinedWorld>(EVENT_JOIN_WORLD, ({ payload }) => {
      store().updateJoinedWorld(payload);
    }),
    listen<UpdateView>(EVENT_UPDATE, ({ payload }) => {
      store().setUpdate(payload);
    }),
    listen<JavaProgress>(EVENT_JAVA_PROGRESS, ({ payload }) => {
      store().setJavaProgress(payload);
    }),
    listen<{ id: string; players: string[] }>(EVENT_PLAYERS, ({ payload }) => {
      store().setPlayers(payload.id, payload.players);
    }),
    listen<{ id: string; players: string[] }>(EVENT_REJECTED, ({ payload }) => {
      store().setRejected(payload.id, payload.players);
    }),
    // Oturum sonunda Rust kapağı güncelledi: yeni sürümü çek, arka plan geçsin.
    listen<string>(EVENT_COVER_CHANGED, ({ payload: id }) => {
      api.getInstance(id).then(store().replaceInstance).catch(console.error);
    }),
    listen(EVENT_SHUTTING_DOWN, () => store().setShuttingDown(true)),
    listen<{ id: string; view: ConnectionView }>(EVENT_NET, ({ payload }) => {
      store().setConnection(payload.id, payload.view);
    }),
    listen<ModProgress>(EVENT_MODS_PROGRESS, ({ payload }) => store().setModProgress(payload)),
    listen<{ id: string; status: ClientStatus }>(EVENT_CLIENT_STATUS, ({ payload }) =>
      store().setClientStatus(payload.id, payload.status),
    ),
    listen<{ id: string; result: LaunchResult }>(EVENT_CLIENT_LAUNCH, ({ payload }) =>
      store().setLaunchResult(payload.id, payload.result),
    ),
    listen<GameProgress>(EVENT_GAME_PROGRESS, ({ payload }) => store().setGameProgress(payload)),
    listen<{ state: "running" | "exited"; code: number | null }>(EVENT_GAME_STATE, ({ payload }) => {
      store().setGameProgress(null);
      // 0: oyuncu kapattı; başka kod: çöktü.
      if (payload.state === "exited" && payload.code !== null && payload.code !== 0) store().setGameCrash(payload.code);
    }
    ),
    listen<JoinProgress>(EVENT_JOIN_PROGRESS, ({ payload }) => store().setJoinProgress(payload)),
    listen<{ id: string; status: JoinStatus }>(EVENT_JOIN_STATUS, ({ payload }) => {
      store().setJoinStatus(payload.id, payload.status);
    }),
    // Davet linkine tıklandı: bekleyen daveti al, Katıl penceresini aç.
    listen(EVENT_INVITE, () => {
      api
        .takePendingInvite()
        .then((code) => code && store().openJoin(code))
        .catch(console.error);
    }),
  ]);

  return () => {
    if (frame) cancelAnimationFrame(frame);
    unlisteners.forEach((un) => un());
  };
}
