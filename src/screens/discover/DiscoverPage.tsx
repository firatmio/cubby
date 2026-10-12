import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Compass, Package, RotateCcw, Search, Users } from "lucide-react";
import {
  api,
  errorMessage,
  type Instance,
  type InstalledMod,
  type ModDetail,
  type ModHit,
  type ModSearch,
  type ModSort,
} from "../../lib/api";
import { useT } from "../../i18n";
import { categoryLabels } from "../../lib/format";
import { spring } from "../../lib/motion";
import { fetchCached, invalidate, peek } from "../../lib/queryCache";
import { useAppStore, useSelected, useSelectedJoined, useServer } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { PillTabs } from "../../ui/PillTabs";
import { InstalledView } from "./InstalledView";
import { ProjectCard, SkeletonCard } from "./ProjectCard";
import { ProjectDetail } from "./ProjectDetail";
import { ClientLine, InstallToast } from "./parts";
import { WorldPicker } from "./WorldPicker";
import styles from "./Discover.module.css";

/** Keşfet görünmüyorken (Oyna açıkken) önden yükleme bu kadar bekler; dünyalar arasında gezinirken istek yağmasın. */
const PREFETCH_DELAY = 900;
/** Yazarken her tuşta değil, bu kadar durunca ara. */
const TYPE_DELAY = 250;

/** Seçili dünya için içerik. Sayfa hep monte; görünmüyorken ilk sonuçları sessizce önden çeker. */
export function DiscoverPage() {
  const instance = useSelected();
  const joined = useSelectedJoined();
  const t = useT().discover;

  let body: React.ReactNode;
  if (!instance && !joined) {
    body = <Note icon={Compass} title={t.emptyTitle} text={t.emptyText} />;
  } else if (joined) {
    body = <Note icon={Users} title={t.friendNote} text={t.friendSoon} />;
  } else if (instance!.loader === "vanilla") {
    body = <Note icon={Package} title={t.vanillaTitle} text={t.vanillaText} />;
  } else {
    body = <ModsBrowser key={instance!.id} instance={instance!} />;
  }

  return (
    <div className={styles.page}>
      {body}
    </div>
  );
}

function Note({ icon: Icon, title, text }: { icon: typeof Compass; title: string; text: string }) {
  return (
    <div className={styles.content}>
      <header className={styles.header}>
        <WorldPicker />
      </header>
      <div className={styles.note}>
        <Icon size={28} aria-hidden />
        <p className={styles.noteTitle}>{title}</p>
        <p className={styles.noteText}>{text}</p>
      </div>
    </div>
  );
}

type View = "browse" | "installed";

function ModsBrowser({ instance }: { instance: Instance }) {
  const id = instance.id;
  const plugin = instance.loader === "paper";
  const visible = useAppStore((s) => s.page === "discover" && s.view === "home");
  const setModProgress = useAppStore((s) => s.setModProgress);
  const { status } = useServer(id);
  const tt = useT();
  const t = tt.mods;
  const active = status === "running" || status === "starting";

  const [view, setView] = useState<View>("browse");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<ModSort>("downloads");
  const [result, setResult] = useState<ModSearch | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<InstalledMod[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [openHit, setOpenHit] = useState<ModHit | null>(null);
  const [detail, setDetail] = useState<ModDetail | null>(null);
  const seq = useRef(0);
  const openId = useRef<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const keyOf = useCallback(
    (offset: number) => `${id}|mods|${query.trim()}|${category ?? ""}|${sort}|${offset}`,
    [id, query, category, sort],
  );

  // İlk sayfa: önbellekte varsa anında göster, sonra (gerekirse) arkada yenile.
  useEffect(() => {
    const key = keyOf(0);
    const cached = peek<ModSearch>(key);
    setResult(cached ?? null);
    setLoading(!cached);
    setError(null);
    const n = ++seq.current;
    const load = () =>
      fetchCached(key, () => api.modsSearch(id, query.trim(), category, sort, 0))
        .then((r) => n === seq.current && setResult(r))
        .catch((e) => n === seq.current && setError(errorMessage(e)))
        .finally(() => n === seq.current && setLoading(false));
    const delay = visible ? (query ? TYPE_DELAY : 0) : PREFETCH_DELAY;
    const timer = setTimeout(() => {
      if (visible || !("requestIdleCallback" in window)) load();
      else requestIdleCallback(() => load(), { timeout: 2000 });
    }, delay);
    return () => clearTimeout(timer);
  }, [keyOf, id, query, category, sort, visible]);

  // Arama değişince listenin başına dön.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [query, category, sort]);

  const loadMore = useCallback(() => {
    if (!result || loading || result.hits.length >= result.total) return;
    const offset = result.hits.length;
    const n = seq.current;
    setLoading(true);
    fetchCached(keyOf(offset), () => api.modsSearch(id, query.trim(), category, sort, offset))
      .then((r) => {
        if (n !== seq.current) return;
        setResult((prev) => {
          const next = { hits: [...(prev?.hits ?? []), ...r.hits], total: r.total };
          return next;
        });
      })
      .catch((e) => n === seq.current && setError(errorMessage(e)))
      .finally(() => n === seq.current && setLoading(false));
  }, [result, loading, keyOf, id, query, category, sort]);

  // Alta yaklaşınca sonraki sayfa.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || view !== "browse") return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && loadMore(), {
      root: scroller.current,
      rootMargin: "600px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, view]);

  const loadInstalled = useCallback(() => {
    api
      .modsInstalled(id)
      .then(setInstalled)
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  useEffect(() => {
    if (!visible) return;
    loadInstalled();
  }, [visible, loadInstalled]);

  const markInstalled = (list: InstalledMod[]) => {
    const ids = new Set(list.map((m) => m.projectId));
    setInstalled(list);
    invalidate(`${id}|`);
    setResult((r) => (r ? { ...r, hits: r.hits.map((h) => ({ ...h, installed: ids.has(h.projectId) })) } : r));
    setOpenHit((h) => (h ? { ...h, installed: ids.has(h.projectId) } : h));
    setDetail((d) => (d ? { ...d, installed: ids.has(d.projectId) } : d));
    setChanged(true);
  };

  const run = async (key: string, fn: () => Promise<InstalledMod[]>) => {
    setBusy(key);
    setError(null);
    setModProgress(null);
    try {
      markInstalled(await fn());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      setModProgress(null);
    }
  };

  const install = useCallback(
    (projectId: string) => void run(`install:${projectId}`, () => api.modsInstall(id, projectId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );

  const openDetail = useCallback(
    (hit: ModHit) => {
      openId.current = hit.projectId;
      setOpenHit(hit);
      setDetail(null);
      fetchCached(`${id}|detail|${hit.projectId}`, () => api.modsProject(id, hit.projectId))
        .then((d) => openId.current === hit.projectId && setDetail(d))
        .catch((e) => setError(errorMessage(e)));
    },
    [id],
  );

  const restart = async () => {
    setBusy("restart");
    try {
      await api.stopServer(id);
      await api.startServer(id);
      setChanged(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const sorts: { id: ModSort; label: string }[] = [
    { id: "downloads", label: t.sortPopular },
    { id: "relevance", label: t.sortRelevance },
    { id: "updated", label: t.sortUpdated },
  ];
  const views: { id: View; label: string }[] = [
    { id: "browse", label: plugin ? t.titlePlugins : t.titleMods },
    { id: "installed", label: t.installedTab(installed ? installed.length : null) },
  ];
  const hits = result?.hits ?? [];
  const installing = busy?.startsWith("install:") || busy?.startsWith("update");

  return (
    <div className={styles.content}>
      <header className={styles.header}>
        <WorldPicker />
        <PillTabs tabs={views} active={view} onChange={setView} layoutId="discover-view" />
        <div className={styles.search}>
          <Search size={17} aria-hidden />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setView("browse");
            }}
            placeholder={plugin ? t.searchPlugins : t.searchMods}
            aria-label={t.search}
            spellCheck={false}
          />
        </div>
      </header>

      {!plugin && <ClientLine id={id} />}
      <AnimatePresence>
        {changed && active && (
          <motion.div
            className={styles.restart}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={spring}
          >
            <span>{t.restartHint}</span>
            <Button size="sm" variant="primary" icon={RotateCcw} loading={busy === "restart"} onClick={restart}>
              {t.restartNow}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      {error && <p className={styles.error}>{error}</p>}

      {view === "browse" && (
        <div className={styles.toolbar}>
          <div
            className={styles.chips}
            // Dikey tekerlek de yatay kaydırsın.
            onWheel={(e) => {
              if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
            }}
          >
            <button
              type="button"
              className={[styles.chip, category === null && styles.chipOn].filter(Boolean).join(" ")}
              onClick={() => setCategory(null)}
            >
              {t.all}
            </button>
            {Object.entries(categoryLabels()).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={[styles.chip, category === key && styles.chipOn].filter(Boolean).join(" ")}
                onClick={() => setCategory(category === key ? null : key)}
              >
                {label}
              </button>
            ))}
          </div>
          <PillTabs tabs={sorts} active={sort} onChange={setSort} layoutId="discover-sort" />
        </div>
      )}

      <div ref={scroller} className={styles.scroll}>
        {view === "browse" ? (
          <>
            <div className={styles.grid}>
              {hits.map((h) => (
                <ProjectCard
                  key={h.projectId}
                  hit={h}
                  plugin={plugin}
                  installing={busy === `install:${h.projectId}`}
                  disabled={busy !== null}
                  onOpen={openDetail}
                  onInstall={install}
                />
              ))}
              {loading && Array.from({ length: hits.length ? 3 : 6 }, (_, i) => <SkeletonCard key={`s${i}`} />)}
            </div>
            {!loading && hits.length === 0 && !error && (
              <p className={styles.empty}>{plugin ? t.noneFoundPlugins : t.noneFoundMods}</p>
            )}
            <div ref={sentinel} className={styles.sentinel} />
          </>
        ) : (
          <InstalledView
            installed={installed}
            plugin={plugin}
            busy={busy}
            onUpdate={(file) => void run(`update:${file}`, () => api.modsUpdate(id, file))}
            onUpdateAll={() => void run("update-all", () => api.modsUpdateAll(id))}
            onRemove={(file) => void run(`remove:${file}`, () => api.modsRemove(id, file))}
          />
        )}
      </div>

      <AnimatePresence>
        {installing && (
          <motion.div
            className={styles.toastWrap}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={spring}
          >
            <InstallToast />
          </motion.div>
        )}
      </AnimatePresence>

      <ProjectDetail
        hit={openHit}
        detail={detail}
        plugin={plugin}
        installing={!!openHit && busy === `install:${openHit.projectId}`}
        disabled={busy !== null}
        onClose={() => {
          openId.current = null;
          setOpenHit(null);
        }}
        onInstall={install}
      />
    </div>
  );
}
