import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, Compass, Package, RotateCcw, Search, Users } from "lucide-react";
import { api, errorMessage, type InstalledMod, type Instance, type ModHit, type ModSort } from "../../lib/api";
import { useT } from "../../i18n";
import { categoryLabels } from "../../lib/format";
import { spring } from "../../lib/motion";
import { useMotionLevel } from "../../lib/perf";
import { useAppStore, useSelected, useSelectedJoined, useServer } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { PillTabs } from "../../ui/PillTabs";
import { InstalledView } from "./InstalledView";
import { Preview } from "./Preview";
import { ResultGrid } from "./ResultGrid";
import { Showcase } from "./Showcase";
import type { ShelfDef } from "./Shelf";
import { SkeletonTile } from "./ProjectTile";
import { useModActions, usePreview } from "./useBrowse";
import { ClientLine, InstallToast } from "./parts";
import { WorldPicker } from "./WorldPicker";
import styles from "./Discover.module.css";

/** Keşfet görünmüyorken (Oyna açıkken) içerik bu kadar bekleyip boşta yüklenir; dünyalar arasında gezinirken istek yağmasın. */
const PREFETCH_DELAY = 900;

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

  return <div className={styles.page}>{body}</div>;
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
/** "Tümünü gör" ile açılan ızgara; null = vitrin (arama da boşsa). */
type Grid = { category: string | null };

/** Kurulu listesindeki bir satırdan önizleme için kutucuk bilgisi. */
const hitOf = (m: InstalledMod): ModHit => ({
  projectId: m.projectId!,
  slug: "",
  title: m.title,
  description: "",
  downloads: 0,
  icon: m.icon,
  author: "",
  image: null,
  color: null,
  clientNeed: m.clientNeed ?? "unknown",
  installed: true,
});

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Klavyeyle komşu kutucuk: ←/→ aynı sıradaki kardeş, ↑/↓ üst/alt sıradaki en yakın (raf ya da ızgara satırı). */
function neighbour(tiles: HTMLElement[], cur: HTMLElement, [dx, dy]: [number, number]): HTMLElement | undefined {
  if (dx) {
    const sib = dx > 0 ? cur.nextElementSibling : cur.previousElementSibling;
    return sib instanceof HTMLElement && sib.dataset.project ? sib : undefined;
  }
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  return tiles
    .map((el) => ({ el, b: el.getBoundingClientRect() }))
    .filter(({ b }) => (dy > 0 ? b.top > r.top + 8 : b.top < r.top - 8))
    .sort(
      (a, b) =>
        Math.abs(a.b.top - r.top) - Math.abs(b.b.top - r.top) ||
        Math.abs(a.b.left + a.b.width / 2 - cx) - Math.abs(b.b.left + b.b.width / 2 - cx),
    )[0]?.el;
}

function ModsBrowser({ instance }: { instance: Instance }) {
  const id = instance.id;
  const plugin = instance.loader === "paper";
  const visible = useAppStore((s) => s.page === "discover" && s.view === "home");
  const sheetOpen = useAppStore((s) => s.sheet !== null);
  const { status } = useServer(id);
  const level = useMotionLevel();
  const tt = useT();
  const t = tt.mods;
  const active = status === "running" || status === "starting";

  const actions = useModActions(id, visible);
  const preview = usePreview(id);
  const [view, setView] = useState<View>("browse");
  const [query, setQuery] = useState("");
  const [grid, setGrid] = useState<Grid | null>(null);
  const [sort, setSort] = useState<ModSort>("downloads");
  const [busyRestart, setBusyRestart] = useState(false);
  // Görünmüyorken hemen değil, kısa bir bekleme ve boşta kalınca yükle.
  const [armed, setArmed] = useState(visible);
  const scroller = useRef<HTMLDivElement>(null);
  const hits = useRef(new Map<string, ModHit>());
  // Aynı mod birden çok rafta olabilir: klavye gezintisi kimliğe değil, odaktaki kutucuğun kendisine bakar.
  const focused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (armed) return;
    if (visible) {
      setArmed(true);
      return;
    }
    const timer = setTimeout(() => {
      if ("requestIdleCallback" in window) requestIdleCallback(() => setArmed(true), { timeout: 2000 });
      else setArmed(true);
    }, PREFETCH_DELAY);
    return () => clearTimeout(timer);
  }, [armed, visible]);

  const onLoaded = useCallback((list: ModHit[]) => {
    for (const h of list) hits.current.set(h.projectId, h);
  }, []);

  const { open: openPreview, close, refreshPlan } = preview;
  /** Tıklanan kutucuk (odak alan düğme) gezintinin başlangıcı olur. */
  const open = useCallback(
    (hit: ModHit) => {
      focused.current = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-project]") ?? null;
      openPreview(hit);
    },
    [openPreview],
  );
  const showGrid = query.trim() !== "" || grid !== null;
  const selectedId = preview.shown ? (preview.hit?.projectId ?? null) : null;

  // Kurulumdan sonra açık önizlemenin planı yenilenir (bağımlılıklar artık kurulu olabilir).
  useEffect(() => {
    if (actions.installed) refreshPlan();
  }, [actions.installed, refreshPlan]);

  // Önizleme açıkken ok tuşlarıyla kutucuklar arasında gezilir; Esc kapatır.
  useEffect(() => {
    if (!visible || !selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (sheetOpen || (e.target as HTMLElement | null)?.closest?.("input, textarea")) return;
      if (e.key === "Escape") {
        close();
        return;
      }
      const dir = ARROWS[e.key];
      const root = scroller.current;
      if (!dir || !root) return;
      const tiles = [...root.querySelectorAll<HTMLElement>("[data-project]")];
      const cur =
        focused.current?.isConnected && focused.current.dataset.project === selectedId
          ? focused.current
          : tiles.find((el) => el.dataset.project === selectedId);
      if (!cur) return;
      e.preventDefault();
      const target = neighbour(tiles, cur, dir);
      const hit = target && hits.current.get(target.dataset.project!);
      if (!target || !hit) return;
      focused.current = target;
      openPreview(hit);
      target.querySelector("button")?.focus({ preventScroll: true });
      target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: level === "full" ? "smooth" : "auto" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selectedId, sheetOpen, openPreview, close, level]);

  const seeAll = useCallback((def: ShelfDef) => {
    setGrid({ category: def.category });
    setSort(def.sort);
  }, []);

  const backToShowcase = () => {
    setGrid(null);
    setQuery("");
    setSort("downloads");
  };

  const restart = async () => {
    setBusyRestart(true);
    try {
      await api.stopServer(id);
      await api.startServer(id);
      actions.setChanged(false);
    } catch (e) {
      actions.setError(errorMessage(e));
    } finally {
      setBusyRestart(false);
    }
  };

  const sorts: { id: ModSort; label: string }[] = [
    { id: "downloads", label: t.sortPopular },
    { id: "relevance", label: t.sortRelevance },
    { id: "updated", label: t.sortUpdated },
  ];
  const views: { id: View; label: string }[] = [
    { id: "browse", label: plugin ? t.titlePlugins : t.titleMods },
    { id: "installed", label: t.installedTab(actions.installed ? actions.installed.length : null) },
  ];
  const installing = actions.busy?.startsWith("install:") || actions.busy?.startsWith("update");
  const category = grid?.category ?? null;

  return (
    <div className={[styles.browser, preview.shown && styles.withPreview].filter(Boolean).join(" ")}>
      <div className={styles.content}>
        <header className={styles.header}>
          <WorldPicker />
          <PillTabs tabs={views} active={view} onChange={setView} layoutId="discover-view" />
          <div className={styles.search}>
            <Search size={17} aria-hidden />
            <Input
              value={query}
              onChange={(e) => {
                const v = e.target.value;
                // Aramada en uygun sonuçlar önce gelsin.
                if (!query.trim() && v.trim() && !grid) setSort("relevance");
                setQuery(v);
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
          {actions.changed && active && (
            <motion.div
              className={styles.restart}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={spring}
            >
              <span>{t.restartHint}</span>
              <Button size="sm" variant="primary" icon={RotateCcw} loading={busyRestart} onClick={restart}>
                {t.restartNow}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
        {actions.error && <p className={styles.error}>{actions.error}</p>}

        {view === "browse" && showGrid && (
          <div className={styles.toolbar}>
            <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={backToShowcase}>
              {tt.discover.backToShowcase}
            </Button>
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
                onClick={() => setGrid({ category: null })}
              >
                {t.all}
              </button>
              {Object.entries(categoryLabels()).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={[styles.chip, category === key && styles.chipOn].filter(Boolean).join(" ")}
                  onClick={() => setGrid({ category: category === key ? null : key })}
                >
                  {label}
                </button>
              ))}
            </div>
            <PillTabs tabs={sorts} active={sort} onChange={setSort} layoutId="discover-sort" />
          </div>
        )}

        <div ref={scroller} className={styles.scroll}>
          {view === "installed" ? (
            <InstalledView
              installed={actions.installed}
              plugin={plugin}
              busy={actions.busy}
              onUpdate={actions.update}
              onUpdateAll={actions.updateAll}
              onRemove={actions.remove}
              onOpen={(m) => open(hits.current.get(m.projectId!) ?? hitOf(m))}
              selectedId={selectedId}
            />
          ) : !armed ? (
            <div className={styles.grid}>
              {Array.from({ length: 8 }, (_, i) => (
                <SkeletonTile key={i} />
              ))}
            </div>
          ) : showGrid ? (
            <ResultGrid
              world={id}
              plugin={plugin}
              query={query}
              category={category}
              sort={sort}
              scrollRoot={scroller}
              selectedId={selectedId}
              actions={actions}
              onOpen={open}
              onPrefetch={preview.prefetch}
              onLoaded={onLoaded}
            />
          ) : (
            <Showcase
              world={id}
              plugin={plugin}
              scrollRoot={scroller}
              selectedId={selectedId}
              actions={actions}
              onOpen={open}
              onPrefetch={preview.prefetch}
              onSeeAll={seeAll}
              onLoaded={onLoaded}
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
      </div>

      <AnimatePresence>
        {preview.shown && (
          <motion.div
            className={styles.previewWrap}
            initial={{ x: level === "off" ? 0 : 48, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: level === "off" ? 0 : 48, opacity: 0 }}
            transition={level === "full" ? spring : { duration: 0.18 }}
          >
            <Preview preview={preview} plugin={plugin} actions={actions} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
