import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  errorMessage,
  type ContentKind,
  type InstalledMod,
  type ModHit,
  type ModInfo,
  type ModPlan,
  type ModSearch,
  type ModSort,
  type PackList,
} from "../../lib/api";
import { fetchCached, invalidate } from "../../lib/queryCache";
import { useAppStore } from "../../store/appStore";

/**
 * Önbellek anahtarı: raflar ve ızgara aynı aramayı paylaşır.
 * `world`: kendi dünyanın kimliği ya da `join:<id>`.
 */
export const searchKey = (
  world: string,
  kind: ContentKind,
  query: string,
  category: string | null,
  sort: ModSort,
  offset: number,
) => `${world}|${kind}|${query}|${category ?? ""}|${sort}|${offset}`;

/** Türe göre arama: modlar mevcut mod komutlarıyla, paketler içerik komutlarıyla. */
export function searchItems(
  world: string,
  kind: ContentKind,
  query: string,
  category: string | null,
  sort: ModSort,
  offset: number,
) {
  return fetchCached<ModSearch>(searchKey(world, kind, query, category, sort, offset), () =>
    kind === "mod"
      ? api.modsSearch(world, query, category, sort, offset)
      : api.contentSearch(world, kind, query, category, sort, offset),
  );
}

/** Aynı proje birden çok sayfada gelirse (Modrinth sıralaması kayarsa) bir kez gösterilir. */
export function mergeHits(prev: ModHit[], next: ModHit[]): ModHit[] {
  const seen = new Set(prev.map((h) => h.projectId));
  return [...prev, ...next.filter((h) => !seen.has(h.projectId) && seen.add(h.projectId))];
}

/** Dünyaya (ya da oyuncunun Minecraft'ına) kurulu olanlar ve kur/güncelle/kaldır işleri. */
export function useContentActions(world: string, kind: ContentKind, visible: boolean) {
  const setModProgress = useAppStore((s) => s.setModProgress);
  const [installed, setInstalled] = useState<InstalledMod[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const mod = kind === "mod";

  useEffect(() => {
    if (!visible) return;
    const load: Promise<InstalledMod[]> = mod
      ? api.modsInstalled(world)
      : api.contentInstalled(world, kind).then((l) => l.items);
    load.then(setInstalled).catch((e) => setError(errorMessage(e)));
  }, [world, kind, mod, visible]);

  const ids = useMemo(() => (installed ? new Set(installed.map((m) => m.projectId)) : null), [installed]);
  /** Liste geldiyse ona, gelmediyse aramanın söylediğine güvenilir. */
  const isInstalled = useCallback((hit: ModHit) => (ids ? ids.has(hit.projectId) : hit.installed), [ids]);

  const run = useCallback(
    async (key: string, fn: () => Promise<InstalledMod[] | PackList>) => {
      setBusy(key);
      setError(null);
      setNote(null);
      setModProgress(null);
      try {
        const r = await fn();
        if (Array.isArray(r)) {
          setInstalled(r);
        } else {
          setInstalled(r.items);
          setNote(r.note);
        }
        // Aramalardaki "kurulu" işaretleri ve planlar eskidi.
        invalidate(`${world}|`);
        // Yeniden başlatma yalnız modlarda gerekir; veri paketleri `reload` ile hemen geçerli.
        if (mod) setChanged(true);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(null);
        setModProgress(null);
      }
    },
    [world, mod, setModProgress],
  );

  return {
    kind,
    installed,
    isInstalled,
    busy,
    error,
    setError,
    note,
    setNote,
    changed,
    setChanged,
    install: (projectId: string) =>
      void run(`install:${projectId}`, () =>
        mod ? api.modsInstall(world, projectId) : api.contentInstall(world, kind, projectId),
      ),
    update: (file: string) =>
      void run(`update:${file}`, () => (mod ? api.modsUpdate(world, file) : api.contentUpdate(world, kind, file))),
    updateAll: () => void run("update-all", () => api.modsUpdateAll(world)),
    remove: (file: string) =>
      void run(`remove:${file}`, () => (mod ? api.modsRemove(world, file) : api.contentRemove(world, kind, file))),
    activateShader: (file: string) => void run(`activate:${file}`, () => api.contentActivateShader(world, file)),
    forcePack: (file: string | null) => void run(`force:${file ?? ""}`, () => api.contentForcePack(world, file)),
  };
}

export type ContentActions = ReturnType<typeof useContentActions>;

/**
 * Sağdaki önizleme: tıklanan kutucuğun bilgisiyle hemen açılır; proje bilgisi (galeri, açıklama)
 * ve sürüm/bağımlılık planı ayrı ayrı, önbellekten ya da arkadan gelir.
 */
export function usePreview(world: string, kind: ContentKind) {
  const [hit, setHit] = useState<ModHit | null>(null);
  // Kapanırken panel kayarak çıksın diye son proje bir süre daha tutulur; görünürlük ayrı.
  const [shown, setShown] = useState(false);
  const [info, setInfo] = useState<ModInfo | null>(null);
  const [plan, setPlan] = useState<ModPlan | null>(null);
  const current = useRef<string | null>(null);
  const mod = kind === "mod";

  const loadInfo = useCallback(
    (projectId: string) =>
      fetchCached(`${world}|${kind}|info|${projectId}`, () =>
        mod ? api.modsProject(world, projectId) : api.contentProject(world, kind, projectId),
      ),
    [world, kind, mod],
  );
  const loadPlan = useCallback(
    (projectId: string) => (mod ? api.modsPlan(world, projectId) : api.contentPlan(world, kind, projectId)),
    [world, kind, mod],
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
      fetchCached(`${world}|${kind}|plan|${h.projectId}`, () => loadPlan(h.projectId))
        .then((p) => current.current === h.projectId && setPlan(p))
        .catch(
          (e) =>
            current.current === h.projectId &&
            setPlan({ versionNumber: null, unstable: false, with: [], missing: [], conflicts: [], error: errorMessage(e) }),
        );
    },
    [world, kind, loadInfo, loadPlan],
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
    loadPlan(p)
      .then((pl) => current.current === p && setPlan(pl))
      .catch(console.error);
  }, [loadPlan]);

  return { hit, shown, info, plan, open, close, prefetch, refreshPlan };
}

export type PreviewState = ReturnType<typeof usePreview>;
