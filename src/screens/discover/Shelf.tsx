import { useEffect, useRef, useState, type RefObject } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ContentKind, ModHit, ModSearch, ModSort } from "../../lib/api";
import { useT } from "../../i18n";
import { peek } from "../../lib/queryCache";
import { ProjectTile, SkeletonTile } from "./ProjectTile";
import { searchItems, searchKey } from "./useBrowse";
import styles from "./Discover.module.css";

export type ShelfDef = { key: string; title: string; category: string | null; sort: ModSort };

type Props = {
  world: string;
  kind: ContentKind;
  def: ShelfDef;
  plugin: boolean;
  /** Raf, bu kaydırma alanında görünür olmaya yaklaşınca yüklenir. */
  scrollRoot: RefObject<HTMLElement | null>;
  selectedId: string | null;
  isInstalled: (hit: ModHit) => boolean;
  onOpen: (hit: ModHit) => void;
  onPrefetch: (projectId: string) => void;
  onSeeAll: (def: ShelfDef) => void;
  onLoaded?: (hits: ModHit[]) => void;
};

/** Yatay kayan tek raf: başlık, "Tümünü gör", kutucuklar ve kenarlarda ‹ › düğmeleri. */
export function Shelf({ world, kind, def, plugin, scrollRoot, selectedId, isInstalled, onOpen, onPrefetch, onSeeAll, onLoaded }: Props) {
  const t = useT().discover;
  const key = searchKey(world, kind, "", def.category, def.sort, 0);
  const [hits, setHits] = useState<ModHit[] | null>(() => peek<ModSearch>(key)?.hits ?? null);
  const [near, setNear] = useState(hits !== null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const root = useRef<HTMLElement>(null);
  const row = useRef<HTMLDivElement>(null);

  // Ekrana yaklaşınca yükle (önbellekte varsa zaten hazır).
  useEffect(() => {
    if (near || !root.current) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), {
      root: scrollRoot.current,
      rootMargin: "400px 0px",
    });
    io.observe(root.current);
    return () => io.disconnect();
  }, [near, scrollRoot]);

  useEffect(() => {
    if (!near) return;
    let live = true;
    searchItems(world, kind, "", def.category, def.sort, 0)
      .then((r) => {
        if (!live) return;
        setHits(r.hits);
        onLoaded?.(r.hits);
      })
      .catch(() => live && setHits([]));
    return () => {
      live = false;
    };
  }, [near, world, kind, def.category, def.sort, onLoaded]);

  const measure = () => {
    const el = row.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(measure, [hits]);

  const page = (dir: number) => {
    const el = row.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  // Boş raf (bu sürüm için o kategoride hiçbir şey yok) hiç gösterilmez.
  if (hits && hits.length === 0) return null;

  return (
    <section ref={root} className={styles.shelf} data-shelf={def.key}>
      <header className={styles.shelfHead}>
        <h3>{def.title}</h3>
        <button type="button" className={styles.seeAll} onClick={() => onSeeAll(def)}>
          {t.seeAll} <ChevronRight size={14} aria-hidden />
        </button>
      </header>
      <div className={styles.shelfFrame}>
        <div ref={row} className={styles.shelfRow} onScroll={measure} data-edge-left={edges.left || undefined} data-edge-right={edges.right || undefined}>
          {hits
            ? hits.map((h) => (
                <ProjectTile
                  key={h.projectId}
                  hit={h}
                  plugin={plugin}
                  showNeed={kind === "mod"}
                  installed={isInstalled(h)}
                  selected={h.projectId === selectedId}
                  onOpen={onOpen}
                  onPrefetch={onPrefetch}
                />
              ))
            : Array.from({ length: 6 }, (_, i) => <SkeletonTile key={i} still={!near} />)}
        </div>
        {edges.left && (
          <button type="button" className={[styles.shelfArrow, styles.shelfArrowLeft].join(" ")} aria-label={t.scrollLeft} onClick={() => page(-1)}>
            <ChevronLeft size={20} aria-hidden />
          </button>
        )}
        {edges.right && (
          <button type="button" className={[styles.shelfArrow, styles.shelfArrowRight].join(" ")} aria-label={t.scrollRight} onClick={() => page(1)}>
            <ChevronRight size={20} aria-hidden />
          </button>
        )}
      </div>
    </section>
  );
}
