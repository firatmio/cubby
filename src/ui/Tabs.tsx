import type { LucideIcon } from "lucide-react";
import styles from "./Tabs.module.css";

type Tab<T extends string> = { id: T; label: string; icon?: LucideIcon };

type Props<T extends string> = {
  tabs: Tab<T>[];
  active: T;
  onChange: (id: T) => void;
};

export function Tabs<T extends string>({ tabs, active, onChange }: Props<T>) {
  return (
    <div className={styles.tabs} role="tablist">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={id === active}
          className={[styles.tab, id === active && styles.active].filter(Boolean).join(" ")}
          onClick={() => onChange(id)}
        >
          {Icon && <Icon size={15} aria-hidden />}
          {label}
        </button>
      ))}
    </div>
  );
}
