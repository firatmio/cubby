import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./Dialog.module.css";

type Props = {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
};

/** Sayfa düzeninden etkilenmesin diye `body`'ye portal ile çizilir. */
export function Dialog({ title, children, actions }: Props) {
  return createPortal(
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label={title}>
      <div className={styles.dialog}>
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.body}>{children}</div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </div>,
    document.body,
  );
}
