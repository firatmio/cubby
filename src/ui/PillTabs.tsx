import { useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { snappy } from "../lib/motion";
import styles from "./PillTabs.module.css";

type Props<T extends string> = {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
};

/**
 * Hap sekmeler; seçili sekmenin beyaz arka planı yeni sekmeye kayar.
 * Konum sekmenin `offsetLeft`/`offsetWidth`'inden okunur: kayan sayfa ya da panelin transform'u bunu
 * etkilemez, hap açılışta hep yerinde başlar (paylaşılan `layoutId` eskisinin ekran dışındaki son
 * yerinden getiriyordu).
 */
export function PillTabs<T extends string>({ tabs, active, onChange }: Props<T>) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; width: number } | null>(null);
  const labels = tabs.map((t) => t.label).join("|");

  // Seçim ya da genişlikler (dil, yazı) değişince yeniden ölç; çizimden önce, titremesin.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const tab = el.querySelector<HTMLElement>('[aria-selected="true"]');
      if (tab) setPos((p) => (p?.x === tab.offsetLeft && p.width === tab.offsetWidth ? p : { x: tab.offsetLeft, width: tab.offsetWidth }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, labels]);

  return (
    <div ref={box} className={styles.tabs} role="tablist">
      {pos && <motion.span className={styles.pill} initial={false} animate={pos} transition={snappy} aria-hidden />}
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          className={[styles.tab, t.id === active && styles.active].filter(Boolean).join(" ")}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
