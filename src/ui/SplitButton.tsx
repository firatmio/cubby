import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Loader2, type LucideIcon } from "lucide-react";
import { spring } from "../lib/motion";
import styles from "./SplitButton.module.css";

type Option<T extends string> = { id: T; label: string; icon: LucideIcon };

type Props<T extends string> = {
  options: Option<T>[];
  /** Ana butonun yaptığı (son seçilen). */
  value: T;
  /** Bir seçenek çalıştırıldı (ana buton ya da menüden); menüden seçilen yeni varsayılan olur. */
  onRun: (id: T) => void;
  loading?: boolean;
  className?: string;
};

/** Ana eylem + ▾ menü. Menü yukarı açılır; dışarı tıklayınca ya da Esc ile kapanır. */
export function SplitButton<T extends string>({ options, value, onRun, loading, className }: Props<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.id === value) ?? options[0];
  const Icon = loading ? Loader2 : current.icon;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={[styles.split, className].filter(Boolean).join(" ")}>
      <motion.button
        type="button"
        className={styles.main}
        disabled={loading}
        whileTap={{ scale: 0.97 }}
        onClick={() => onRun(current.id)}
      >
        <Icon size={20} aria-hidden className={loading ? styles.spin : undefined} />
        {current.label}
      </motion.button>
      <motion.button
        type="button"
        className={styles.more}
        disabled={loading}
        aria-label="Diğer seçenekler"
        aria-haspopup="menu"
        aria-expanded={open}
        whileTap={{ scale: 0.92 }}
        onClick={() => setOpen((v) => !v)}
      >
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={spring} className={styles.chevron}>
          <ChevronDown size={18} aria-hidden />
        </motion.span>
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            className={styles.menu}
            role="menu"
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={spring}
          >
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => {
                  setOpen(false);
                  onRun(o.id);
                }}
              >
                <o.icon size={16} aria-hidden />
                <span>{o.label}</span>
                {o.id === value && <Check size={16} aria-hidden className={styles.check} />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
