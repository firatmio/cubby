import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../store/appStore";
import type { InstallProgress, JavaProgress, LogLine, ProcessStats, ServerStatus } from "./api";

// Rust'taki event adlarıyla aynı olmalı (server/mod.rs, commands.rs, lib.rs).
const EVENT_LOG = "server://log";
const EVENT_STATUS = "server://status";
const EVENT_STATS = "server://stats";
const EVENT_INSTALL_PROGRESS = "install://progress";
const EVENT_JAVA_PROGRESS = "java://progress";
const EVENT_SHUTTING_DOWN = "app://shutting-down";

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
    listen<JavaProgress>(EVENT_JAVA_PROGRESS, ({ payload }) => {
      store().setJavaProgress(payload);
    }),
    listen(EVENT_SHUTTING_DOWN, () => store().setShuttingDown(true)),
  ]);

  return () => {
    if (frame) cancelAnimationFrame(frame);
    unlisteners.forEach((un) => un());
  };
}
