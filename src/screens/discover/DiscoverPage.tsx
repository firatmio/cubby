import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, Compass, Info, RotateCcw, Search, Settings, Sparkles, X } from "lucide-react";
import {
  api,
  errorMessage,
  type ContentKind,
  type InstalledMod,
  type LoaderKind,
  type ModHit,
  type ModSort,
} from "../../lib/api";
import { useT } from "../../i18n";
import { categoryLabels, isModded } from "../../lib/format";
import { spring } from "../../lib/motion";
import { useMotionLevel } from "../../lib/perf";
import { useAppStore, useSelected, useSelectedJoined, useServer } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { Input } from "../../ui/Input";
import { PillTabs } from "../../ui/PillTabs";
import { InstalledView } from "./InstalledView";
import { Preview } from "./Preview";
import { ResultGrid } from "./ResultGrid";
import { Showcase } from "./Showcase";
import type { ShelfDef } from "./Shelf";
import { SkeletonTile } from "./ProjectTile";
import { useContentActions, usePreview } from "./useBrowse";
import { ClientLine, InstallToast } from "./parts";
import { WorldPicker } from "./WorldPicker";
import styles from "./Discover.module.css";

/** Keşfet görünmüyorken (Oyna açıkken) içerik bu kadar bekleyip boşta yüklenir; dünyalar arasında gezinirken istek yağmasın. */
const PREFETCH_DELAY = 900;

/**
 * Dünyanın türüne ve sahibine göre gösterilen sekmeler. Arkadaşının dünyasında değiştiremediklerin
 * (modlar, veri paketleri) hiç görünmez.
 */
function kindsFor(loader: LoaderKind, own: boolean): ContentKind[] {
  const modded = isModded(loader);
  if (!own) return modded ? ["resourcePack", "shader"] : ["resourcePack"];
  return [...(loader === "vanilla" ? [] : ["mod" as const]), "resourcePack", ...(modded ? ["shader" as const] : []), "dataPack"];
}

/** Seçili dünya için içerik. Sayfa hep monte; görünmüyorken ilk sonuçları sessizce önden çeker. */
export function DiscoverPage() {
  const instance = useSelected();
  const joined = useSelectedJoined();
  const selectedId = useAppStore((s) => s.selectedId);
  const t = useT().discover;

  if ((!instance && !joined) || !selectedId) {
    return (
      <div className={styles.page}>
        <div className={styles.content}>
          <div className={styles.note}>
            <Compass size={28} aria-hidden />
            <p className={styles.noteTitle}>{t.emptyTitle}</p>
            <p className={styles.noteText}>{t.emptyText}</p>
          </div>
        </div>
      </div>
    );
  }
  const loader = instance?.loader ?? joined!.world.loader;
  return (
    <div className={styles.page}>
      <ContentBrowser
        key={selectedId}
        world={selectedId}
        loader={loader}
        own={!!instance}
        kinds={kindsFor(loader, !!instance)}
      />
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

type BrowserProps = {
  /** Kendi dünyanın kimliği ya da `join:<id>`. */
  world: string;
  loader: LoaderKind;
  own: boolean;
  kinds: ContentKind[];
};

function ContentBrowser({ world, loader, own, kinds }: BrowserProps) {
  const storedTab = useAppStore((s) => s.discoverTab);
  const setTab = useAppStore((s) => s.setDiscoverTab);
  const openSheet = useAppStore((s) => s.openSheet);
  // Seçili sekme bu dünyada yoksa ilk sekmeye düşülür.
  const kind = kinds.includes(storedTab) ? storedTab : kinds[0];
  const plugin = kind === "mod" && loader === "paper";
  const visible = useAppStore((s) => s.page === "discover" && s.view === "home");
  const sheet = useAppStore((s) => s.sheet);
  const { status } = useServer(own ? world : null);
  const level = useMotionLevel();
  const tt = useT();
  const t = tt.mods;
  const d = tt.discover;
  const active = status === "running" || status === "starting";

  const actions = useContentActions(world, kind, visible);
  const preview = usePreview(world, kind);
  const [view, setView] = useState<View>("browse");
  const [query, setQuery] = useState("");
  const [grid, setGrid] = useState<Grid | null>(null);
  const [sort, setSort] = useState<ModSort>("downloads");
  const [busyRestart, setBusyRestart] = useState(false);
  // Shader için oyuncunun Minecraft'ına mod kurulumu açık olmalı (kendi dünyanda).
  const [clientSync, setClientSync] = useState(true);
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

  // Sekme değişince arama ve görünüm baştan; açık önizleme kapanır.
  const { open: openPreview, close, refreshPlan } = preview;
  useEffect(() => {
    setView("browse");
    setQuery("");
    setGrid(null);
    setSort("downloads");
    close();
    hits.current.clear();
    scroller.current?.scrollTo({ top: 0 });
  }, [kind, close]);

  // Ayarlar kapanınca (kullanıcı ayarı açmış olabilir) yeniden bakılır.
  useEffect(() => {
    if (!own || kind !== "shader" || sheet) return;
    api
      .getSettings()
      .then((v) => setClientSync(v.settings.clientSync))
      .catch(console.error);
  }, [own, kind, sheet]);

  const onLoaded = useCallback((list: ModHit[]) => {
    for (const h of list) hits.current.set(h.projectId, h);
  }, []);

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
      if (sheet || (e.target as HTMLElement | null)?.closest?.("input, textarea")) return;
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
  }, [visible, selectedId, sheet, openPreview, close, level]);

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
      await api.stopServer(world);
      await api.startServer(world);
      actions.setChanged(false);
    } catch (e) {
      actions.setError(errorMessage(e));
    } finally {
      setBusyRestart(false);
    }
  };

  const kindLabel = (k: ContentKind) =>
    k === "mod" ? (loader === "paper" ? d.kindPlugins : d.kindMods) : k === "resourcePack" ? d.kindResourcePacks : k === "shader" ? d.kindShaders : d.kindDataPacks;
  const sorts: { id: ModSort; label: string }[] = [
    { id: "downloads", label: t.sortPopular },
    { id: "relevance", label: t.sortRelevance },
    { id: "updated", label: t.sortUpdated },
  ];
  const views: { id: View; label: string }[] = [
    { id: "browse", label: d.browse },
    { id: "installed", label: t.installedTab(actions.installed ? actions.installed.length : null) },
  ];
  const installing = actions.busy?.startsWith("install:") || actions.busy?.startsWith("update");
  const category = grid?.category ?? null;
  const needsSync = own && kind === "shader" && !clientSync;
  const searchPlaceholder = kind === "mod" ? (plugin ? t.searchPlugins : t.searchMods) : `${d.searchPacks}: ${kindLabel(kind).toLocaleLowerCase()}`;

  return (
    <div className={[styles.browser, preview.shown && styles.withPreview].filter(Boolean).join(" ")}>
      <div className={styles.content}>
        <header className={styles.header}>
          <WorldPicker />
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
              placeholder={searchPlaceholder}
              aria-label={t.search}
              spellCheck={false}
              disabled={needsSync}
            />
          </div>
        </header>
        <div className={styles.kindRow}>
          {kinds.length > 1 ? (
            <PillTabs tabs={kinds.map((k) => ({ id: k, label: kindLabel(k) }))} active={kind} onChange={setTab} layoutId={`discover-kind-${world}`} />
          ) : (
            <span className={styles.kindSingle}>{kindLabel(kind)}</span>
          )}
          {!needsSync && <PillTabs tabs={views} active={view} onChange={setView} layoutId={`discover-view-${world}`} />}
        </div>
        {!own && (
          <p className={styles.friendLine}>
            <Info size={15} aria-hidden /> {d.friendLine}
          </p>
        )}

        {kind === "mod" && own && !plugin && <ClientLine id={world} />}
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
          {actions.note && (
            <motion.div
              className={styles.restart}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={spring}
            >
              <span>
                <Sparkles size={15} aria-hidden className={styles.noteIcon} /> {actions.note}
              </span>
              <IconButton icon={X} label={tt.common.close} size="sm" variant="ghost" onClick={() => actions.setNote(null)} />
            </motion.div>
          )}
        </AnimatePresence>
        {actions.error && <p className={styles.error}>{actions.error}</p>}

        {view === "browse" && showGrid && !needsSync && (
          <div className={styles.toolbar}>
            <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={backToShowcase}>
              {d.backToShowcase}
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
              {Object.entries(categoryLabels(kind)).map(([key, label]) => (
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
            <PillTabs tabs={sorts} active={sort} onChange={setSort} layoutId={`discover-sort-${world}`} />
          </div>
        )}

        <div ref={scroller} className={styles.scroll}>
          {needsSync ? (
            <div className={styles.note}>
              <Settings size={28} aria-hidden />
              <p className={styles.noteTitle}>{d.shaderNeedsSync}</p>
              <p className={styles.noteText}>{d.shaderNeedsSyncText}</p>
              <Button icon={Settings} onClick={() => openSheet("settings")}>
                {d.openSettings}
              </Button>
            </div>
          ) : view === "installed" ? (
            <InstalledView
              kind={kind}
              installed={actions.installed}
              plugin={plugin}
              busy={actions.busy}
              onUpdate={actions.update}
              onUpdateAll={actions.updateAll}
              onRemove={actions.remove}
              onActivate={actions.activateShader}
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
              key={kind}
              world={world}
              kind={kind}
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
              key={kind}
              world={world}
              kind={kind}
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
            <Preview preview={preview} kind={kind} plugin={plugin} own={own} actions={actions} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
