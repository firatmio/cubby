import { useId } from "react";
import { LayoutGroup, motion } from "motion/react";
import { snappy } from "../lib/motion";
import styles from "./PillTabs.module.css";

type Props<T extends string> = {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
  /** Aynı ekranda birden çok sekme grubu varsa kayan arka plan karışmasın. */
  layoutId?: string;
};

/**
 * Hap sekmeler; seçili sekmenin beyaz arka planı yeni sekmeye kayar. Her örnek kendi
 * `LayoutGroup`'unda: kapanıp yeniden açılan bir grubun hapı, eskisinin son (ekran dışına kaymış
 * olabilecek) yerinden gelmez, yerinde başlar.
 */
export function PillTabs<T extends string>({ tabs, active, onChange, layoutId = "pill" }: Props<T>) {
  const group = useId();
  return (
    <LayoutGroup id={group}>
      <div className={styles.tabs} role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === active}
            className={[styles.tab, t.id === active && styles.active].filter(Boolean).join(" ")}
            onClick={() => onChange(t.id)}
          >
            {t.id === active && (
              // Düzen yalnız seçim değişince ölçülür: kayan sayfalar ve paneller (transform) yüzünden
              // hap "yer değiştirdi" sanılıp ekran dışından getirilmesin.
              <motion.span layoutId={layoutId} layoutDependency={active} className={styles.pill} transition={snappy} />
            )}
            <span className={styles.label}>{t.label}</span>
          </button>
        ))}
      </div>
    </LayoutGroup>
  );
}
