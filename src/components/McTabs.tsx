import styles from "./McTabs.module.css";

type Tab<T extends string> = { id: T; label: string };

type Props<T extends string> = {
  tabs: Tab<T>[];
  active: T;
  onChange: (id: T) => void;
};

export function McTabs<T extends string>({ tabs, active, onChange }: Props<T>) {
  return (
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
          {t.label}
        </button>
      ))}
    </div>
  );
}
