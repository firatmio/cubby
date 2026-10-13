import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { errorMessage, type ContentKind, type ModHit, type ModSearch, type ModSort } from "../../lib/api";
import { useT } from "../../i18n";
import { peek } from "../../lib/queryCache";
import { ProjectTile, SkeletonTile } from "./ProjectTile";
import { mergeHits, searchItems, searchKey, type ContentActions } from "./useBrowse";
import styles from "./Discover.module.css";

/** Yazarken her tuşta değil, bu kadar durunca ara. */
const TYPE_DELAY = 250;

type Props = {
  world: string;
  kind: ContentKind;
  plugin: boolean;
  query: string;
  category: string | null;
  sort: ModSort;
  scrollRoot: RefObject<HTMLElement | null>;
  selectedId: string | null;
  actions: ContentActions;
  onOpen: (hit: ModHit) => void;
  onPrefetch: (projectId: string) => void;
  onLoaded: (hits: ModHit[]) => void;
};

/** Arama ya da "Tümünü gör": kutucuk ızgarası, alta yaklaşınca sonraki sayfa. */
export function ResultGrid({ world, kind, plugin, query, category, sort, scrollRoot, selectedId, actions, onOpen, onPrefetch, onLoaded }: Props) {
  const tt = useT();
  const t = tt.mods;
  const q = query.trim();
  const [result, setResult] = useState<ModSearch | null>(
    () => peek<ModSearch>(searchKey(world, kind, q, category, sort, 0)) ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  // Sonraki sayfa isteği sürerken ikinci istek gitmesin (aynı sayfanın iki kez eklenmesi buradandı).
  const busyMore = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cached = peek<ModSearch>(searchKey(world, kind, q, category, sort, 0));
    setResult(cached ?? null);
    setLoading(!cached);
    setError(null);
    busyMore.current = false;
    const n = ++seq.current;
    const timer = setTimeout(
      () =>
        searchItems(world, kind, q, category, sort, 0)
          .then((r) => {
            if (n !== seq.current) return;
            setResult(r);
            onLoaded(r.hits);
          })
          .catch((e) => n === seq.current && setError(errorMessage(e)))
          .finally(() => n === seq.current && setLoading(false)),
      q ? TYPE_DELAY : 0,
    );
    scrollRoot.current?.scrollTo({ top: 0 });
    return () => clearTimeout(timer);
  }, [world, kind, q, category, sort, scrollRoot, onLoaded]);

  const loadMore = useCallback(() => {
    if (!result || busyMore.current || result.hits.length >= result.total) return;
    busyMore.current = true;
    const n = seq.current;
    setLoading(true);
    searchItems(world, kind, q, category, sort, result.hits.length)
      .then((r) => {
        if (n !== seq.current) return;
        setResult((prev) => ({ hits: mergeHits(prev?.hits ?? [], r.hits), total: r.total }));
        onLoaded(r.hits);
      })
      .catch((e) => n === seq.current && setError(errorMessage(e)))
      .finally(() => {
        if (n !== seq.current) return;
        busyMore.current = false;
        setLoading(false);
      });
  }, [result, world, kind, q, category, sort, onLoaded]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && loadMore(), {
      root: scrollRoot.current,
      rootMargin: "500px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, scrollRoot]);

  const hits = result?.hits ?? [];
  return (
    <>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.grid}>
        {hits.map((h) => (
          <ProjectTile
            key={h.projectId}
            hit={h}
            plugin={plugin}
            showNeed={kind === "mod"}
            installed={actions.isInstalled(h)}
            selected={h.projectId === selectedId}
            quickInstall={
              // Mod paketi önizlemeden (sürüm ve bilgiyle) yeni dünya olarak kurulur.
              kind === "modpack"
                ? undefined
                : {
                    installing: actions.busy === `install:${h.projectId}`,
                    disabled: actions.busy !== null,
                    onInstall: actions.install,
                  }
            }
            onOpen={onOpen}
            onPrefetch={onPrefetch}
          />
        ))}
        {loading && Array.from({ length: hits.length ? 4 : 8 }, (_, i) => <SkeletonTile key={`s${i}`} />)}
      </div>
      {!loading && hits.length === 0 && !error && <p className={styles.empty}>{kind === "modpack" ? tt.discover.noneModpacks : kind !== "mod" ? tt.discover.nonePacks : plugin ? t.noneFoundPlugins : t.noneFoundMods}</p>}
      <div ref={sentinel} className={styles.sentinel} />
    </>
  );
}
