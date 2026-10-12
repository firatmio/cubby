import { useLayoutEffect, useRef, useState } from "react";
import { animate, motion, useMotionValue, useTransform, useVelocity } from "motion/react";
import { Compass, Gamepad2 } from "lucide-react";
import { useT } from "../i18n";
import { useMotionLevel, watchFrames } from "../lib/perf";
import { useAppStore, type Page } from "../store/appStore";
import styles from "./PageSwitch.module.css";

const PAGES: Page[] = ["play", "discover"];

/** Önde giden kenar: hızlı ve kararlı. */
const LEAD = { type: "spring", stiffness: 520, damping: 34 } as const;
/** Arkadan gelen kenar: yumuşak ve hafif aşan, damlanın jöle gibi oturması bundan. */
const TRAIL = { type: "spring", stiffness: 150, damping: 12, mass: 0.9, delay: 0.05 } as const;
/** Sade modda iki kenar birlikte kayar. */
const PLAIN = { type: "spring", stiffness: 420, damping: 40 } as const;

type Box = { left: number; width: number };

/**
 * Başlık çubuğunun ortasındaki Oyna / Keşfet hapları.
 * Seçili arka plan bir damla: önde giden kenar hızlı, arkadaki yavaş gider; yolda uzar, varınca
 * jöle gibi sallanıp oturur. Goo filtresi (bulanıklaştır + alfayı keskinleştir) kalkış noktasında
 * küçülerek kaybolan ikinci damlayla birleşip kopan bir "boyun" oluşturur. Yazılar filtrenin
 * üstünde, keskin kalır. Sade modda filtre yok, düz kayar.
 */
export function PageSwitch() {
  const page = useAppStore((s) => s.page);
  const setPage = useAppStore((s) => s.setPage);
  const t = useT().pages;
  const level = useMotionLevel();
  const goo = level === "full";

  const refs = useRef<Record<Page, HTMLButtonElement | null>>({ play: null, discover: null });
  const [boxes, setBoxes] = useState<Record<Page, Box> | null>(null);
  const left = useMotionValue(0);
  const right = useMotionValue(0);
  const width = useTransform(() => right.get() - left.get());
  // Hızla incelir, durunca yay ile eski kalınlığına döner (jöle).
  const speed = useVelocity(left);
  const scaleY = useTransform(speed, [-2400, 0, 2400], [0.78, 1, 0.78], { clamp: true });
  const drop = useMotionValue(0);
  const dropX = useMotionValue(0);
  const dropLeft = useTransform(dropX, (v) => v - 12);
  const shown = useRef<Page | null>(null);

  // Hap genişlikleri dile göre değişir: ölç, değişince yeniden ölç.
  useLayoutEffect(() => {
    const measure = () => {
      const b = {} as Record<Page, Box>;
      for (const p of PAGES) {
        const el = refs.current[p];
        if (!el) return;
        b[p] = { left: el.offsetLeft, width: el.offsetWidth };
      }
      setBoxes(b);
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const p of PAGES) if (refs.current[p]) ro.observe(refs.current[p]!);
    return () => ro.disconnect();
  }, [t.play, t.discover]);

  useLayoutEffect(() => {
    if (!boxes) return;
    const to = boxes[page];
    const from = shown.current ? boxes[shown.current] : null;
    shown.current = page;
    if (!from || level === "off") {
      left.jump(to.left);
      right.jump(to.left + to.width);
      return;
    }
    if (!goo) {
      animate(left, to.left, PLAIN);
      animate(right, to.left + to.width, PLAIN);
      return;
    }
    const forward = to.left > from.left;
    animate(left, to.left, forward ? TRAIL : LEAD);
    animate(right, to.left + to.width, forward ? LEAD : TRAIL);
    // Kalkış noktasında kalıp küçülen damla: goo ile ana damlaya bağlı bir boyun gibi görünür.
    dropX.jump(from.left + from.width / 2);
    drop.jump(1);
    animate(drop, 0, { duration: 0.42, ease: [0.4, 0, 0.2, 1] });
    watchFrames(700);
  }, [page, boxes, goo, level, left, right, drop, dropX]);

  return (
    <div className={styles.switch} role="tablist" aria-label={t.label}>
      <div className={styles.blobs} style={goo ? { filter: "url(#cubby-goo)" } : undefined} aria-hidden>
        <motion.span className={styles.blob} style={{ x: left, width, scaleY: goo ? scaleY : 1 }} />
        {goo && (
          <motion.span
            className={styles.drop}
            style={{ x: dropLeft, scale: drop, opacity: drop }}
          />
        )}
      </div>
      {PAGES.map((p) => {
        const Icon = p === "play" ? Gamepad2 : Compass;
        return (
          <button
            key={p}
            ref={(el) => {
              refs.current[p] = el;
            }}
            type="button"
            role="tab"
            aria-selected={page === p}
            className={[styles.tab, page === p && styles.active].filter(Boolean).join(" ")}
            onClick={() => setPage(p)}
          >
            <Icon size={14} aria-hidden />
            {p === "play" ? t.play : t.discover}
          </button>
        );
      })}
      {goo && (
        <svg className={styles.defs} aria-hidden>
          <defs>
            <filter id="cubby-goo" x="-20%" y="-60%" width="140%" height="220%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="4.5" result="blur" />
              <feColorMatrix
                in="blur"
                mode="matrix"
                values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"
                result="goo"
              />
              <feComposite in="SourceGraphic" in2="goo" operator="atop" />
            </filter>
          </defs>
        </svg>
      )}
    </div>
  );
}
