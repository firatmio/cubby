import { useState } from "react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { Check, ChevronLeft, ChevronRight, Download, Info } from "lucide-react";
import { mediaUrl, type ModHit } from "../../lib/api";
import { useT } from "../../i18n";
import { compactCount } from "../../lib/format";
import { useMotionLevel } from "../../lib/perf";
import { Button } from "../../ui/Button";
import { ModIcon, NeedBadge } from "./parts";
import styles from "./Discover.module.css";

type Props = {
  hits: ModHit[];
  plugin: boolean;
  isInstalled: (hit: ModHit) => boolean;
  installing: string | null;
  busy: boolean;
  onInstall: (projectId: string) => void;
  onOpen: (hit: ModHit) => void;
};

/** Bant içinde yatay kayma: ileri basınca yenisi sağdan gelir, eskisi sola çıkar (geri basınca tersi). */
const slide: Variants = {
  enter: (dir: number) => ({ x: `${dir * 100}%` }),
  center: { x: "0%" },
  exit: (dir: number) => ({ x: `${-dir * 100}%` }),
};

/** Vitrinin başındaki geniş bant: popüler ve görselli ilk birkaç proje, elle geçilir (kendiliğinden dönmez). */
export function Featured({ hits, plugin, isInstalled, installing, busy, onInstall, onOpen }: Props) {
  const tt = useT();
  const t = tt.mods;
  const level = useMotionLevel();
  const [[index, dir], setPos] = useState<[number, number]>([0, 1]);
  if (hits.length === 0) return null;
  const i = Math.min(index, hits.length - 1);
  const hit = hits[i];
  const step = (d: number) => setPos([(i + d + hits.length) % hits.length, d]);
  const transition =
    level === "full"
      ? ({ type: "spring", stiffness: 300, damping: 34 } as const)
      : ({ duration: level === "simple" ? 0.24 : 0, ease: [0.25, 1, 0.5, 1] } as const);

  return (
    <section
      className={styles.featured}
      aria-label={tt.discover.featured}
      style={{ "--tint": hit.color ?? "#3d3d3d" } as React.CSSProperties}
    >
      <AnimatePresence initial={false} custom={dir}>
        <motion.div
          key={hit.projectId}
          className={styles.featuredSlide}
          custom={dir}
          variants={slide}
          initial="enter"
          animate="center"
          exit="exit"
          transition={transition}
        >
          <div className={styles.featuredArt}>
            <img src={mediaUrl(hit.image!)} alt="" draggable={false} decoding="async" />
          </div>
          <div className={styles.featuredText}>
            <span className={styles.featuredLabel}>{tt.discover.featured}</span>
            <div className={styles.featuredTitle}>
              <ModIcon icon={hit.icon} plugin={plugin} size={40} />
              <h2>{hit.title}</h2>
            </div>
            <p className={styles.featuredDesc}>{hit.description}</p>
            <span className={styles.tileMeta}>
              {t.downloads(compactCount(hit.downloads))}
              <NeedBadge need={hit.clientNeed} />
            </span>
            <div className={styles.featuredActions}>
              {isInstalled(hit) ? (
                <span className={styles.installed}>
                  <Check size={15} aria-hidden /> {t.installed}
                </span>
              ) : (
                <Button
                  variant="primary"
                  icon={Download}
                  loading={installing === hit.projectId}
                  disabled={busy}
                  onClick={() => onInstall(hit.projectId)}
                >
                  {t.install}
                </Button>
              )}
              <Button variant="ghost" icon={Info} onClick={() => onOpen(hit)}>
                {tt.discover.details}
              </Button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
      {hits.length > 1 && (
        <div className={styles.featuredNav}>
          <button type="button" aria-label={tt.discover.previous} onClick={() => step(-1)}>
            <ChevronLeft size={16} aria-hidden />
          </button>
          {hits.map((h, n) => (
            <span key={h.projectId} className={n === i ? styles.dotOn : styles.dot} />
          ))}
          <button type="button" aria-label={tt.discover.next} onClick={() => step(1)}>
            <ChevronRight size={16} aria-hidden />
          </button>
        </div>
      )}
    </section>
  );
}
