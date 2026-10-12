import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useMotionValue, useTransform, useVelocity } from "motion/react";
import { useMotionLevel, watchFrames } from "../lib/perf";
import { useAppStore, type Page } from "../store/appStore";
import styles from "./Pages.module.css";

/** Yerine otururken hafifçe aşar: esneme geri toplanırken bir kez jöle gibi sallanır. */
const SLIME = { type: "spring", stiffness: 240, damping: 22, mass: 0.9 } as const;
/** Sade mod: kısa, düz kayma. */
const PLAIN = { type: "tween", duration: 0.28, ease: [0.25, 1, 0.5, 1] } as const;

/**
 * Oyna ve Keşfet yan yana bir şeritte, ikisi de hep açık: geçişte yeniden yükleme olmaz, kaydırma
 * ve arama yerinde kalır. Tam modda şerit hızına göre yatay esner ve hafif eğilir (yalnız transform,
 * ekran kartında ucuz); sade modda düz kayar; animasyonlar kapalıysa yalnız belirir.
 */
export function Pages({ play, discover }: { play: ReactNode; discover: ReactNode }) {
  const page = useAppStore((s) => s.page);
  const setPage = useAppStore((s) => s.setPage);
  const level = useMotionLevel();
  const root = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const speed = useVelocity(x);
  const stretch = useTransform(speed, [-7000, 0, 7000], [1.05, 1, 1.05], { clamp: true });
  const skew = useTransform(speed, [-7000, 0, 7000], [2.5, 0, -2.5], { clamp: true });
  const fade = useMotionValue(1);
  // Geçiş bitince görünmeyen sayfa çizilmez (visibility), ama monte kalır.
  const [settled, setSettled] = useState<Page>(page);
  const first = useRef(true);

  useLayoutEffect(() => {
    const w = root.current?.clientWidth ?? window.innerWidth;
    const target = page === "play" ? 0 : -w;
    if (first.current) {
      first.current = false;
      x.jump(target);
      return;
    }
    let stop = () => {};
    if (level === "off") {
      x.jump(target);
      fade.jump(0);
      stop = animate(fade, 1, { duration: 0.18 }).stop;
      setSettled(page);
    } else {
      const c = animate(x, target, level === "full" ? SLIME : PLAIN);
      c.then(() => setSettled(page));
      stop = c.stop;
      watchFrames(650);
    }
    return () => stop();
  }, [page, level, x, fade]);

  // Pencere boyutu değişirse (geliştirirken) şerit yerinde kalsın.
  useEffect(() => {
    const onResize = () => x.jump(page === "play" ? 0 : -(root.current?.clientWidth ?? 0));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [page, x]);

  // Ctrl+1 / Ctrl+2 ve farenin geri tuşu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key === "1") setPage("play");
      else if (e.key === "2") setPage("discover");
      else return;
      e.preventDefault();
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) setPage("play");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
    };
  }, [setPage]);

  const full = level === "full";
  const visible = (p: Page) => p === page || p === settled;

  return (
    <div ref={root} className={styles.root}>
      <motion.div className={styles.strip} style={{ x, opacity: fade }}>
        {(["play", "discover"] as const).map((p) => (
          <motion.section
            key={p}
            className={styles.page}
            style={full ? { scaleX: stretch, skewX: skew } : undefined}
            inert={p !== page}
            aria-hidden={p !== page}
            data-hidden={!visible(p) || undefined}
          >
            {p === "play" ? play : discover}
          </motion.section>
        ))}
      </motion.div>
    </div>
  );
}
