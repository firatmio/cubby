import type { ReactNode } from "react";
import { Check } from "lucide-react";
import styles from "./SelectList.module.css";

export type SelectItem = {
  key: string;
  label: ReactNode;
  /** Sağa yaslı ikincil bilgi (tarih, yol...). */
  meta?: ReactNode;
  /** Etiketin yanındaki rozetler. */
  badges?: ReactNode;
  disabled?: boolean;
  title?: string;
};

type Props = {
  items: SelectItem[];
  value: string | null;
  onSelect: (key: string) => void;
  /** Liste yüksekliği; verilmezse kapsayıcıyı doldurur. */
  maxHeight?: number;
  empty?: ReactNode;
};

/** Tek seçimli, kaydırılabilir liste (sürüm, loader, Java seçimleri). */
export function SelectList({ items, value, onSelect, maxHeight, empty }: Props) {
  return (
    <div className={styles.list} role="listbox" style={maxHeight ? { maxHeight } : undefined}>
      {items.length === 0 && empty && <div className={styles.empty}>{empty}</div>}
      {items.map((item) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="option"
            aria-selected={selected}
            title={item.title}
            disabled={item.disabled}
            className={[styles.row, selected && styles.selected].filter(Boolean).join(" ")}
            onClick={() => onSelect(item.key)}
          >
            <span className={styles.check}>{selected && <Check size={14} aria-hidden />}</span>
            <span className={styles.label}>{item.label}</span>
            {item.badges}
            {item.meta && <span className={styles.meta}>{item.meta}</span>}
          </button>
        );
      })}
    </div>
  );
}
