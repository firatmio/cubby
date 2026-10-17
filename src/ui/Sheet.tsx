import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useT } from "../i18n";
import { spring } from "../lib/motion";
import { IconButton } from "./IconButton";
import { useScrollFade } from "./useScrollFade";
import styles from "./Sheet.module.css";

type Props = {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
};

/** Sağdan kayan panel; arkası soluklaşır, Esc ya da boşluğa tıklama kapatır. */
export function Sheet({ open, title, subtitle, onClose, children, width = 560 }: Props) {
  const t = useT();
  const fade = useScrollFade();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            className={styles.backdrop}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          />
          <motion.aside
            key="sheet"
            className={styles.sheet}
            style={{ width }}
            role="dialog"
            aria-label={title}
            initial={{ x: width + 40, opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: width + 40, opacity: 0.6 }}
            transition={spring}
          >
            <header className={styles.header}>
              <div>
                <h2 className={styles.title}>{title}</h2>
                {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
              </div>
              <IconButton icon={X} label={t.common.close} size="sm" variant="ghost" tipBelow onClick={onClose} />
            </header>
            {/* Gövde kendisi kayar: kendi kaydırma alanı olmayan paneller de küçük pencerede taşmaz. */}
            <div ref={fade} className={styles.body}>
              {children}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
