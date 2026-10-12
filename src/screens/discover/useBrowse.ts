import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage, type InstalledMod, type ModHit, type ModInfo, type ModPlan, type ModSearch, type ModSort } from "../../lib/api";
import { fetchCached, invalidate } from "../../lib/queryCache";
import { useAppStore } from "../../store/appStore";

/** Önbellek anahtarı: raflar ve ızgara aynı aramayı paylaşır. */
export const searchKey = (id: string, query: string, category: string | null, sort: ModSort, offset: number) =>
  `${id}|mods|${query}|${category ?? ""}|${sort}|${offset}`;

export function searchMods(id: string, query: string, category: string | null, sort: ModSort, offset: number) {
  return fetchCached<ModSearch>(searchKey(id, query, category, sort, offset), () =>
    api.modsSearch(id, query, category, sort, offset),
  );
}

/** Aynı proje birden çok sayfada gelirse (Modrinth sıralaması kayarsa) bir kez gösterilir. */
export function mergeHits(prev: ModHit[], next: ModHit[]): ModHit[] {
  const seen = new Set(prev.map((h) => h.projectId));
  return [...prev, ...next.filter((h) => !seen.has(h.projectId) && seen.add(h.projectId))];
}

/** Dünyaya kurulu olanlar ve kur/güncelle/kaldır işleri. */
export function useModActions(id: string, visible: boolean) {
  const setModProgress = useAppStore((s) => s.setModProgress);
  const [installed, setInstalled] = useState<InstalledMod[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (!visible) return;
    api
      .modsInstalled(id)
      .then(setInstalled)
      .catch((e) => setError(errorMessage(e)));
  }, [id, visible]);

  const ids = useMemo(() => (installed ? new Set(installed.map((m) => m.projectId)) : null), [installed]);
  /** Liste geldiyse ona, gelmediyse aramanın söylediğine güvenilir. */
  const isInstalled = useCallback((hit: ModHit) => (ids ? ids.has(hit.projectId) : hit.installed), [ids]);

  const run = useCallback(
    async (key: string, fn: () => Promise<InstalledMod[]>) => {
      setBusy(key);
      setError(null);
      setModProgress(null);
      try {
        setInstalled(await fn());
        // Aramalardaki "kurulu" işaretleri ve planlar eskidi.
        invalidate(`${id}|`);
        setChanged(true);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(null);
        setModProgress(null);
      }
    },
    [id, setModProgress],
  );

  return {
    installed,
    isInstalled,
    busy,
    error,
    setError,
    changed,
    setChanged,
    install: (projectId: string) => void run(`install:${projectId}`, () => api.modsInstall(id, projectId)),
    update: (file: string) => void run(`update:${file}`, () => api.modsUpdate(id, file)),
    updateAll: () => void run("update-all", () => api.modsUpdateAll(id)),
    remove: (file: string) => void run(`remove:${file}`, () => api.modsRemove(id, file)),
  };
}

export type ModActions = ReturnType<typeof useModActions>;

/**
 * Sağdaki önizleme: tıklanan kutucuğun bilgisiyle hemen açılır; proje bilgisi (galeri, açıklama)
 * ve sürüm/bağımlılık planı ayrı ayrı, önbellekten ya da arkadan gelir.
 */
export function usePreview(id: string) {
  const [hit, setHit] = useState<ModHit | null>(null);
  // Kapanırken panel kayarak çıksın diye son proje bir süre daha tutulur; görünürlük ayrı.
  const [shown, setShown] = useState(false);
  const [info, setInfo] = useState<ModInfo | null>(null);
  const [plan, setPlan] = useState<ModPlan | null>(null);
  const current = useRef<string | null>(null);

  const loadInfo = useCallback(
    (projectId: string) => fetchCached(`${id}|info|${projectId}`, () => api.modsProject(id, projectId)),
    [id],
  );

  const open = useCallback(
    (h: ModHit) => {
      current.current = h.projectId;
      setHit(h);
      setShown(true);
      setInfo(null);
      setPlan(null);
      loadInfo(h.projectId)
        .then((i) => current.current === h.projectId && setInfo(i))
        .catch(console.error);
      fetchCached(`${id}|plan|${h.projectId}`, () => api.modsPlan(id, h.projectId))
        .then((p) => current.current === h.projectId && setPlan(p))
        .catch((e) =>
          current.current === h.projectId &&
          setPlan({ versionNumber: null, unstable: false, with: [], missing: [], conflicts: [], error: errorMessage(e) }),
        );
    },
    [id, loadInfo],
  );

  const close = useCallback(() => {
    current.current = null;
    setShown(false);
  }, []);

  /** Fare bir kutucukta biraz durunca proje bilgisi önden çekilir; tıklayınca hazır olur. */
  const prefetch = useCallback((projectId: string) => void loadInfo(projectId).catch(() => {}), [loadInfo]);

  /** Kurulumdan sonra plan değişir (bağımlılıklar artık kurulu). */
  const refreshPlan = useCallback(() => {
    const p = current.current;
    if (!p) return;
    api
      .modsPlan(id, p)
      .then((pl) => current.current === p && setPlan(pl))
      .catch(console.error);
  }, [id]);

  return { hit, shown, info, plan, open, close, prefetch, refreshPlan };
}

export type PreviewState = ReturnType<typeof usePreview>;
